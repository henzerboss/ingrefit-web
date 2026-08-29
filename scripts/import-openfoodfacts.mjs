#!/usr/bin/env node
/**
 * Open Food Facts dataset importer.
 *
 *   node scripts/import-openfoodfacts.mjs --full
 *   node scripts/import-openfoodfacts.mjs --delta
 *   node scripts/import-openfoodfacts.mjs --backfill-countries
 *   node scripts/import-openfoodfacts.mjs --backfill-languages
 *   node scripts/import-openfoodfacts.mjs --backfill-nutrition-basis
 *
 * `--full` streams the complete JSONL export into the OffProduct table. It is
 * intended to run once, and then again every few months.
 *
 * `--delta` applies the daily delta exports published by Open Food Facts. It is
 * the mode a nightly cron should use: it downloads only what changed, so a
 * normal night is a few megabytes rather than tens of gigabytes.
 *
 * Safety properties this script deliberately has:
 *  - It never truncates the table. A failed or partial run leaves the previous
 *    dataset intact and simply gets re-run.
 *  - It writes in batches inside transactions, so a crash cannot leave a row
 *    half-written.
 *  - It records progress to a state file, so an interrupted full import resumes
 *    instead of starting over.
 *  - Only the fields the app actually reads are stored. The raw export contains
 *    hundreds of fields per product and would otherwise bloat the database by
 *    an order of magnitude.
 *
 * LICENCE: the dataset is published under the Open Database License (ODbL).
 * Attribution is required wherever the data is shown, and share-alike applies
 * to any derived database that is redistributed. Keep the attribution in the
 * app and on the website.
 */

import { createGunzip } from 'node:zlib';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import process from 'node:process';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const WORK_DIR = process.env.OFF_IMPORT_DIR ?? '/var/lib/ingrefit/off';
const STATE_FILE = path.join(WORK_DIR, 'import-state.json');
const FULL_EXPORT_URL = process.env.OFF_FULL_EXPORT_URL ?? 'https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz';
const DELTA_INDEX_URL = process.env.OFF_DELTA_INDEX_URL ?? 'https://static.openfoodfacts.org/data/delta/index.txt';
const DELTA_BASE_URL = process.env.OFF_DELTA_BASE_URL ?? 'https://static.openfoodfacts.org/data/delta/';
const USER_AGENT = process.env.OPEN_FOOD_FACTS_USER_AGENT ?? 'IngreFit/1.0 (https://ingrefit.com)';
const BATCH_SIZE = Number(process.env.OFF_IMPORT_BATCH ?? '2000');

/**
 * Languages whose localized name and ingredient fields are kept.
 *
 * Mirrors src/i18n/locales.ts. Kept as a literal rather than imported because
 * this script runs under plain node without the TypeScript path aliases.
 *
 * Storing these is what lets a Spanish user read a Spanish ingredient list
 * without a Gemini call: the string is already in the record, it was simply
 * being thrown away at import time. Products carry variants only for the
 * languages actually printed on the package — typically two or three — so this
 * costs a few hundred bytes per row, not fifty copies of the ingredient list.
 */
const KEPT_LANGUAGES = [
  'af', 'ar', 'az', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'gu',
  'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kk', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'ms', 'nl',
  'no', 'pa', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh',
];

const LOCALIZED_FIELDS = KEPT_LANGUAGES.flatMap((code) => [`product_name_${code}`, `ingredients_text_${code}`]);

/** Only the fields the scorer and the UI read. Everything else is discarded. */
const KEPT_FIELDS = [
  'code', 'product_name', 'generic_name', 'brands', 'quantity',
  'image_front_url', 'image_front_small_url',
  'ingredients_text', 'ingredients', ...LOCALIZED_FIELDS,
  'allergens_tags', 'traces_tags', 'additives_tags', 'labels_tags', 'categories_tags', 'countries_tags',
  'ingredients_analysis_tags', 'nutrient_levels',
  'nutriscore_grade', 'nutrition_grades', 'nova_group', 'ecoscore_grade', 'environmental_score_grade',
  'alcohol_by_volume', 'alcohol_value', 'alcohol_unit',
  'nutriments', 'serving_size', 'nutrition_data_per', 'nutrition_data_prepared_per',
  'product_quantity', 'product_quantity_unit', 'last_modified_t', 'no_nutriments',
];

/** Nutriment keys the app uses; the raw object routinely holds 200+. */
const KEPT_NUTRIMENTS = [
  'energy-kcal_100g', 'proteins_100g', 'carbohydrates_100g', 'sugars_100g', 'fat_100g',
  'saturated-fat_100g', 'fiber_100g', 'salt_100g', 'sodium_100g', 'alcohol_100g',
  'fruits-vegetables-nuts-estimate-from-ingredients_100g', 'fruits-vegetables-nuts_100g',
];

/** Base nutrient names, without the per-quantity suffix. */
const KEPT_NUTRIMENT_BASES = KEPT_NUTRIMENTS.map((key) => key.replace(/_100g$/, ''));

function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/**
 * Normalize `nutriments` into the `<name>_100g` dictionary the backend reads.
 *
 * The JSONL export does not always match the API response shape: depending on
 * the export generation it can be a flat dictionary with `_100g` suffixes, a
 * dictionary keyed by bare nutrient name, or a list of per-nutrient objects.
 * Assuming one shape silently produced an empty object and made every imported
 * product fail the "at least four nutrient values" threshold, so all three are
 * handled here and the outcome is counted rather than trusted.
 */
/** Serving weight in grams/millilitres, when it is usable for conversion. */
function servingQuantity(record) {
  const unit = String(record?.serving_quantity_unit ?? 'g').toLowerCase();
  if (unit && unit !== 'g' && unit !== 'ml') return undefined;
  const quantity = numeric(record?.serving_quantity);
  return quantity && quantity > 0 && quantity < 2000 ? quantity : undefined;
}

function normalizeNutriments(raw, dataPer, servingGrams) {
  const output = {};
  if (!raw) return output;

  // Shape 3: list of { name | id, 100g | value, ... }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const name = String(item.name ?? item.id ?? '').replace(/^[a-z]{2}:/, '');
      if (!name || !KEPT_NUTRIMENT_BASES.includes(name)) continue;
      const value = numeric(item['100g'] ?? item.per_100g ?? item.value_100g ?? item.value);
      if (value !== undefined) output[`${name}_100g`] = value;
    }
    return output;
  }

  if (typeof raw !== 'object') return output;

  // Values declared per serving are only usable if the serving weight is known;
  // with it they convert exactly, without it they must be ignored rather than
  // silently treated as per-100 values.
  const perServing = String(dataPer ?? '').toLowerCase() === 'serving';
  const servingFactor = servingGrams ? 100 / servingGrams : undefined;
  const fromServing = (value) => (value === undefined || !servingFactor ? undefined : value * servingFactor);

  // Convert an "as entered" value using its declared unit. Open Food Facts
  // stores *_100g in grams, but *_value in whatever the label used.
  const convert = (value, unit) => {
    if (value === undefined) return undefined;
    switch (String(unit ?? '').toLowerCase()) {
      case 'mg': return value / 1000;
      case 'µg':
      case 'ug':
      case 'mcg': return value / 1_000_000;
      case 'kg': return value * 1000;
      default: return value;
    }
  };

  for (const base of KEPT_NUTRIMENT_BASES) {
    const key = `${base}_100g`;

    // 1. Explicit per-100g value, always authoritative.
    let value = numeric(raw[key]);

    // 2. Explicit per-serving value, converted with the known serving weight.
    if (value === undefined) {
      const converted = fromServing(numeric(raw[`${base}_serving`]));
      if (converted !== undefined) value = Math.round(converted * 1000) / 1000;
    }

    // 3. Bare name, or a nested per-quantity object.
    if (value === undefined && !perServing) {
      const candidate = raw[base];
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        value = numeric(candidate['100g'] ?? candidate.per_100g ?? candidate.value);
      } else {
        value = numeric(candidate);
      }
    }

    // 4. The "as entered" value, converted from its declared unit, and from the
    //    serving basis when that is what the label used.
    if (value === undefined) {
      const entered = convert(numeric(raw[`${base}_value`]), raw[`${base}_unit`]);
      if (entered !== undefined) {
        const scaled = perServing ? fromServing(entered) : entered;
        if (scaled !== undefined) value = Math.round(scaled * 1000) / 1000;
      }
    }

    if (value !== undefined) output[key] = value;
  }

  // Energy in kJ is common when kcal is absent; 1 kcal = 4.184 kJ.
  if (output['energy-kcal_100g'] === undefined) {
    const kj = numeric(
      raw['energy-kj_100g'] ??
      (perServing ? undefined : raw['energy-kj'] ?? raw['energy-kj_value'] ?? raw.energy_100g ?? (perServing ? undefined : raw.energy)),
    );
    if (kj !== undefined) output['energy-kcal_100g'] = Math.round((kj / 4.184) * 10) / 10;
  }

  // Salt and sodium are interchangeable: salt = sodium x 2.5.
  if (output.salt_100g === undefined && output.sodium_100g !== undefined) {
    output.salt_100g = Math.round(output.sodium_100g * 2.5 * 1000) / 1000;
  }
  if (output.sodium_100g === undefined && output.salt_100g !== undefined) {
    output.sodium_100g = Math.round((output.salt_100g / 2.5) * 1000) / 1000;
  }

  return output;
}

/**
 * PostgreSQL rejects U+0000 inside jsonb ("\\u0000 cannot be converted to
 * text"), and the export does contain records with stray NUL bytes in text
 * fields. Strip them recursively, from keys as well as values, before the row
 * ever reaches the driver.
 */
function stripNul(value) {
  if (typeof value === 'string') {
    return value.includes('\u0000') ? value.replaceAll('\u0000', '') : value;
  }
  if (Array.isArray(value)) return value.map(stripNul);
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      output[stripNul(key)] = stripNul(nested);
    }
    return output;
  }
  return value;
}

/**
 * Recover the declared nutrition basis from either the legacy top-level field
 * or OFF's newer nutrition input-set structure. This is display metadata: the
 * normalized nutrient keys keep the historical *_100g naming even when the
 * label basis is actually 100 ml.
 */
function nutritionBasisFromRecord(record) {
  const direct = typeof record?.nutrition_data_per === 'string'
    ? record.nutrition_data_per.trim().toLowerCase()
    : '';
  if (direct === '100g' || direct === '100ml' || direct === 'serving') return direct;

  const nutrition = record?.nutrition;
  if (!nutrition || typeof nutrition !== 'object') return undefined;
  const aggregated = nutrition.aggregated_set;
  const sets = [
    ...(Array.isArray(nutrition.input_sets) ? nutrition.input_sets : []),
    ...(aggregated && typeof aggregated === 'object' ? [aggregated] : []),
  ];
  const chosen = sets.find((set) => set?.source === 'manufacturer') ?? sets[0];
  const per = typeof chosen?.per === 'string' ? chosen.per.trim().toLowerCase() : '';
  if (per === '100g' || per === '100ml' || per === 'serving') return per;
  if (Number(chosen?.per_quantity) === 100) {
    const unit = String(chosen?.per_unit ?? '').trim().toLowerCase();
    if (unit === 'ml') return '100ml';
    if (unit === 'g') return '100g';
  }
  return undefined;
}

/** Remove localized variants that merely repeat the default field verbatim. */
function dropDuplicateLocalizations(output) {
  for (const [base, fallback] of [['product_name', output.product_name], ['ingredients_text', output.ingredients_text]]) {
    if (typeof fallback !== 'string') continue;
    const normalized = fallback.trim();
    for (const code of KEPT_LANGUAGES) {
      const key = `${base}_${code}`;
      const value = output[key];
      if (typeof value === 'string' && value.trim() === normalized) delete output[key];
    }
  }
  for (const code of KEPT_LANGUAGES) {
    for (const base of ['product_name', 'ingredients_text']) {
      const key = `${base}_${code}`;
      if (typeof output[key] === 'string' && !output[key].trim()) delete output[key];
    }
  }
}

/** Reduce a raw export record to the fields the backend actually reads. */
function slim(record) {
  const output = {};
  for (const field of KEPT_FIELDS) {
    if (record[field] === undefined || record[field] === null) continue;
    output[field] = record[field];
  }
  if (Array.isArray(record.ingredients)) {
    // Keep only the display text; the nested parse tree is large and unused.
    output.ingredients = record.ingredients.slice(0, 120).map((item) => ({ text: item?.text, id: item?.id }));
  }

  // Open Food Facts routinely copies the default text into the field for the
  // package's own language, so most records would otherwise store the same
  // ingredient list twice. Dropping exact duplicates removes the bulk of what
  // the localized fields would add, and the reader falls back to
  // `ingredients_text` anyway when a variant is absent.
  dropDuplicateLocalizations(output);

  const recoveredBasis = nutritionBasisFromRecord(record);
  if (recoveredBasis) output.nutrition_data_per = recoveredBasis;

  output.nutriments = extractNutriments(record);
  Object.assign(output, deriveImageUrls(record));

  // Also keep the raw per-nutrient subset. Re-deriving values later then costs a
  // SQL update instead of another multi-hour pass over a 50 GB archive, which is
  // exactly the price paid for the first wrong guess about this field's shape.
  if (record.nutriments && typeof record.nutriments === 'object' && !Array.isArray(record.nutriments)) {
    const source = {};
    for (const [key, value] of Object.entries(record.nutriments)) {
      const base = key.replace(/_(100g|serving|value|unit|prepared)$/, '');
      if (KEPT_NUTRIMENT_BASES.includes(base)) source[key] = value;
    }
    if (Object.keys(source).length) output.nutriments_source = source;
  }

  return stripNul(output);
}

/**
 * Open Food Facts is migrating nutrition onto a new `nutrition.input_sets`
 * structure, and for products already migrated the legacy `nutriments` object is
 * left empty. That is why roughly one record in six looked like it had no
 * nutrition at all: the values had simply moved.
 *
 * Set shape: { source, per, per_quantity, per_unit,
 *              nutrients: { "saturated-fat": { value, unit, value_computed } } }
 */
function fromNutritionSets(nutrition) {
  const output = {};
  if (!nutrition || typeof nutrition !== 'object') return output;

  // `aggregated_set` is the reconciled view Open Food Facts computes from the
  // input sets; some products carry only that one.
  const aggregated = nutrition.aggregated_set;
  const sets = [
    ...(Array.isArray(nutrition.input_sets) ? nutrition.input_sets : []),
    ...(aggregated && typeof aggregated === 'object' ? [aggregated] : []),
  ];
  if (!sets.length) return output;

  // Only per-100 sets are usable without a serving weight. A manufacturer set
  // is preferred over an estimate when both are present.
  const usable = sets.filter((set) => {
    const per = String(set?.per ?? '').toLowerCase();
    return per === '100g' || per === '100ml' || Number(set?.per_quantity) === 100;
  });
  const chosen = usable.find((set) => set?.source === 'manufacturer') ?? usable[0];
  const nutrients = chosen?.nutrients;
  if (!nutrients || typeof nutrients !== 'object') return output;

  for (const [name, entry] of Object.entries(nutrients)) {
    if (!entry || typeof entry !== 'object') continue;
    const value = numeric(entry.value ?? entry.value_computed);
    if (value === undefined) continue;
    if (name === 'energy-kj') {
      if (output['energy-kcal_100g'] === undefined) output['energy-kcal_100g'] = Math.round((value / 4.184) * 10) / 10;
      continue;
    }
    if (KEPT_NUTRIMENT_BASES.includes(name)) output[`${name}_100g`] = value;
  }
  return output;
}

/**
 * Last-resort source: the values Open Food Facts fed into Nutri-Score. They are
 * the declared per-100 values, so they are trustworthy, but the set is smaller
 * and the units differ (energy in kJ, sodium in mg in the 2021 block).
 */
function fromNutriscore(record) {
  const output = {};

  const legacy = record?.nutriscore?.['2021']?.data;
  if (legacy && typeof legacy === 'object') {
    const map = { sugars: 'sugars', saturated_fat: 'saturated-fat', proteins: 'proteins', fiber: 'fiber' };
    for (const [key, base] of Object.entries(map)) {
      const value = numeric(legacy[key]);
      if (value !== undefined) output[`${base}_100g`] = Math.round(value * 100) / 100;
    }
    const energyKj = numeric(legacy.energy);
    if (energyKj !== undefined) output['energy-kcal_100g'] = Math.round((energyKj / 4.184) * 10) / 10;
    // The 2021 block reports sodium in mg per 100 g.
    const sodiumMg = numeric(legacy.sodium);
    if (sodiumMg !== undefined) output.sodium_100g = Math.round((sodiumMg / 1000) * 1000) / 1000;
  }

  const components = record?.nutriscore_data?.components;
  if (components && typeof components === 'object') {
    const ids = { energy: 'energy', sugars: 'sugars', saturated_fat: 'saturated-fat', salt: 'salt', fiber: 'fiber', proteins: 'proteins' };
    for (const group of ['negative', 'positive']) {
      for (const item of Array.isArray(components[group]) ? components[group] : []) {
        const base = ids[item?.id];
        const value = numeric(item?.value);
        if (!base || value === undefined) continue;
        if (base === 'energy') {
          if (output['energy-kcal_100g'] === undefined) {
            const kcal = String(item.unit ?? '').toLowerCase() === 'kcal' ? value : value / 4.184;
            output['energy-kcal_100g'] = Math.round(kcal * 10) / 10;
          }
          continue;
        }
        if (output[`${base}_100g`] === undefined) output[`${base}_100g`] = value;
      }
    }
  }

  return output;
}

/**
 * Collect nutrition from every place Open Food Facts may store it, in order of
 * trustworthiness, and fill in what can be derived. Earlier sources win.
 */
function extractNutriments(record) {
  const servingGrams = servingQuantity(record);
  const output = { ...normalizeNutriments(record.nutriments, record.nutrition_data_per, servingGrams) };

  const merge = (source) => {
    for (const [key, value] of Object.entries(source)) {
      if (output[key] === undefined) output[key] = value;
    }
  };

  if (Object.keys(output).length < 4) merge(fromNutritionSets(record.nutrition));
  if (Object.keys(output).length < 4) merge(fromNutriscore(record));

  // The fruit/vegetable estimate also exists as a top-level field.
  if (output['fruits-vegetables-nuts-estimate-from-ingredients_100g'] === undefined) {
    const estimate =
      numeric(record['fruits-vegetables-nuts_100g_estimate']) ??
      numeric(record.nutrition_score_warning_fruits_vegetables_nuts_estimate_from_ingredients_value);
    if (estimate !== undefined) output['fruits-vegetables-nuts-estimate-from-ingredients_100g'] = estimate;
  }

  // Salt and sodium are interchangeable: salt = sodium x 2.5.
  if (output.salt_100g === undefined && output.sodium_100g !== undefined) {
    output.salt_100g = Math.round(output.sodium_100g * 2.5 * 1000) / 1000;
  }
  if (output.sodium_100g === undefined && output.salt_100g !== undefined) {
    output.sodium_100g = Math.round((output.salt_100g / 2.5) * 1000) / 1000;
  }

  return output;
}

const IMAGE_BASE_URL = (process.env.OFF_IMAGE_BASE_URL ?? 'https://images.openfoodfacts.org').replace(/\/$/, '');

/**
 * Build the product image URLs.
 *
 * `image_front_url` and `image_front_small_url` are computed fields the API adds
 * on the fly; the raw export only carries the `images` object. Importing without
 * deriving them left every mirrored product with no picture at all, so they are
 * reconstructed here from the image revision.
 *
 * Path rule: codes of nine digits or more are split 3/3/3/rest after padding to
 * 13, shorter codes are used as-is. 3017620422003 -> 301/762/042/2003
 */
function imagePath(code) {
  if (code.length < 9) return code;
  const padded = code.padStart(13, '0');
  return `${padded.slice(0, 3)}/${padded.slice(3, 6)}/${padded.slice(6, 9)}/${padded.slice(9)}`;
}

function deriveImageUrls(record) {
  const images = record?.images;
  const code = typeof record?.code === 'string' ? record.code.trim() : '';
  if (!images || typeof images !== 'object' || !code) return {};

  const language = String(record.lc ?? record.lang ?? '').toLowerCase();
  const base = `${IMAGE_BASE_URL}/images/products/${imagePath(code)}`;
  const urls = (name) => ({ image_front_url: `${base}/${name}.400.jpg`, image_front_small_url: `${base}/${name}.200.jpg` });

  // Two shapes exist, because Open Food Facts is migrating this field too:
  //
  //   legacy: images["front_fr"] = { rev, sizes }   (also a bare "front")
  //   new:    images.selected.front.fr = { rev, imgid, sizes }
  //
  // Supporting only the legacy one produced an image for fewer than a fifth of
  // the dataset, which is what made mirrored products look picture-less.
  const candidates = [];

  const selected = images.selected?.front;
  if (selected && typeof selected === 'object') {
    for (const lang of [language, 'en', ...Object.keys(selected)].filter(Boolean)) {
      const entry = selected[lang];
      if (entry && typeof entry === 'object') candidates.push({ name: `front_${lang}`, entry });
    }
  }

  const legacyKeys = Object.keys(images).filter((name) => name === 'front' || name.startsWith('front_'));
  for (const name of [
    ...(language ? legacyKeys.filter((key) => key === `front_${language}`) : []),
    ...legacyKeys.filter((key) => key === 'front_en'),
    ...legacyKeys,
  ]) {
    const entry = images[name];
    if (entry && typeof entry === 'object') candidates.push({ name, entry });
  }

  for (const { name, entry } of candidates) {
    const revision = entry.rev ?? entry.revision;
    if (revision === undefined || revision === null || revision === '') continue;
    return urls(`${name}.${revision}`);
  }

  // Last resort: a product with uploaded photos but no selected front image.
  // Uploaded images are served by their numeric id, and by convention the first
  // upload is the package front. Better than showing no picture at all, and it
  // is only reached when no front has been selected by a contributor.
  const uploaded = images.uploaded && typeof images.uploaded === 'object' ? images.uploaded : images;
  const numericIds = Object.keys(uploaded)
    .filter((key) => /^\d+$/.test(key))
    .map(Number)
    .sort((left, right) => left - right);
  if (numericIds.length) return urls(String(numericIds[0]));

  return {};
}

function readState() {
  if (!existsSync(STATE_FILE)) return { lastFullImport: null, appliedDeltas: [], processedLines: 0 };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastFullImport: null, appliedDeltas: [], processedLines: 0 };
  }
}

function writeState(state) {
  mkdirSync(WORK_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function download(url, destination) {
  console.log(`[off] downloading ${url}`);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
  mkdirSync(path.dirname(destination), { recursive: true });
  await pipeline(response.body, createWriteStream(destination));
  return destination;
}

function upsertRow(row) {
  return prisma.offProduct.upsert({
    where: { barcode: row.barcode },
    create: row,
    update: { data: row.data, lastModified: row.lastModified },
  });
}

let rejected = 0;
let withoutNutrients = 0;

async function flush(batch) {
  if (!batch.length) return;
  // upsert-per-row inside one transaction: slower than COPY, but it is
  // restartable, keeps existing rows on conflict, and never locks the table
  // that live traffic is reading from.
  try {
    await prisma.$transaction(batch.map(upsertRow));
    return;
  } catch (error) {
    // One malformed record out of three million must not discard hours of work.
    // Retry the batch row by row, skip whatever the database refuses, and keep
    // going. Anything skipped is reported at the end.
    console.warn(`[off] batch failed, retrying ${batch.length} rows individually: ${error?.message ?? error}`);
  }

  for (const row of batch) {
    try {
      await upsertRow(row);
    } catch (rowError) {
      rejected += 1;
      console.warn(`[off] rejected barcode ${row.barcode}: ${rowError?.message ?? rowError}`);
    }
  }
}

async function importJsonl(filePath, { resumeFrom = 0, onProgress } = {}) {
  const stream = createReadStream(filePath).pipe(createGunzip());
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  let index = 0;
  let imported = 0;
  let skipped = 0;
  let batch = [];

  for await (const line of lines) {
    index += 1;
    if (index <= resumeFrom) continue;
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }

    const barcode = typeof record.code === 'string' ? record.code.trim() : '';
    if (!/^\d{6,18}$/.test(barcode)) {
      skipped += 1;
      continue;
    }

    const slimmed = slim(record);
    if (Object.keys(slimmed.nutriments ?? {}).length < 4) withoutNutrients += 1;

    const lastModifiedSeconds = Number(record.last_modified_t);
    batch.push({
      barcode,
      data: slimmed,
      lastModified: Number.isFinite(lastModifiedSeconds) ? new Date(lastModifiedSeconds * 1000) : new Date(0),
    });

    if (batch.length >= BATCH_SIZE) {
      await flush(batch);
      imported += batch.length;
      batch = [];
      onProgress?.(index, imported, skipped);
    }
  }

  await flush(batch);
  imported += batch.length;
  onProgress?.(index, imported, skipped);
  return { lines: index, imported, skipped };
}

async function runFull() {
  const state = readState();
  const archive = path.join(WORK_DIR, 'openfoodfacts-products.jsonl.gz');

  if (!existsSync(archive) || process.env.OFF_FORCE_DOWNLOAD === 'true') {
    await download(FULL_EXPORT_URL, archive);
    state.processedLines = 0;
  }

  const resumeFrom = state.processedLines ?? 0;
  if (resumeFrom) console.log(`[off] resuming after line ${resumeFrom}`);

  const result = await importJsonl(archive, {
    resumeFrom,
    onProgress: (line, imported, skipped) => {
      state.processedLines = line;
      writeState(state);
      if (imported % (BATCH_SIZE * 10) === 0) {
        console.log(`[off] line ${line}, imported ${imported}, skipped ${skipped}`);
      }
    },
  });

  state.lastFullImport = new Date().toISOString();
  state.processedLines = 0;
  writeState(state);
  console.log(
    `[off] full import finished: ${result.imported} products, ${result.skipped} skipped, ` +
    `${rejected} rejected by the database, ${withoutNutrients} with fewer than four nutrient values`,
  );
  if (withoutNutrients > result.imported * 0.5) {
    console.warn('[off] WARNING: most products carry no usable nutrition. Run --inspect and check the nutriments shape.');
  }
}

async function flushCountryTags(batch) {
  if (!batch.length) return 0;
  const params = [];
  const values = batch.map((row, index) => {
    const offset = index * 2;
    params.push(row.barcode, JSON.stringify(row.countriesTags));
    return `($${offset + 1}::text, $${offset + 2}::jsonb)`;
  }).join(', ');
  return prisma.$executeRawUnsafe(
    `UPDATE "OffProduct" AS product
     SET data = jsonb_set(product.data, '{countries_tags}', input.countries, true)
     FROM (VALUES ${values}) AS input(barcode, countries)
     WHERE product.barcode = input.barcode
       AND (product.data->'countries_tags') IS DISTINCT FROM input.countries`,
    ...params,
  );
}

/**
 * One-time lightweight enrichment for mirrors imported before countries_tags
 * was retained. It reuses the already-downloaded full OFF archive and updates
 * only the JSON countries_tags field; nutrition, images and timestamps are not
 * rewritten. Progress is resumable independently from --full.
 */
async function runCountriesBackfill() {
  const state = readState();
  const archive = path.join(WORK_DIR, 'openfoodfacts-products.jsonl.gz');
  if (!existsSync(archive)) {
    console.log('[off] full archive is not present locally; downloading it once for countries backfill');
    await download(FULL_EXPORT_URL, archive);
    state.countriesProcessedLines = 0;
  }

  const resumeFrom = state.countriesProcessedLines ?? 0;
  if (resumeFrom) console.log(`[off] countries backfill resuming after line ${resumeFrom}`);
  const lines = createInterface({ input: createReadStream(archive).pipe(createGunzip()), crlfDelay: Infinity });
  let index = 0;
  let matched = 0;
  let updated = 0;
  let batch = [];

  const checkpoint = () => {
    state.countriesProcessedLines = index;
    writeState(state);
  };

  for await (const line of lines) {
    index += 1;
    if (index <= resumeFrom) continue;
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const barcode = typeof record.code === 'string' ? record.code.trim() : '';
    const countriesTags = Array.isArray(record.countries_tags)
      ? [...new Set(record.countries_tags.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
      : [];
    if (/^\d{6,18}$/.test(barcode) && countriesTags.length) {
      batch.push({ barcode, countriesTags });
      matched += 1;
    }

    if (batch.length >= BATCH_SIZE) {
      updated += await flushCountryTags(batch);
      batch = [];
      checkpoint();
      if (matched % (BATCH_SIZE * 10) === 0) {
        console.log(`[off] countries: line ${index}, tagged ${matched}, rows changed ${updated}`);
      }
    } else if (index % 100_000 === 0) {
      checkpoint();
      console.log(`[off] countries: line ${index}, tagged ${matched}, rows changed ${updated}`);
    }
  }

  updated += await flushCountryTags(batch);
  state.countriesProcessedLines = 0;
  state.lastCountriesBackfill = new Date().toISOString();
  writeState(state);
  console.log(`[off] countries backfill finished: ${matched} tagged records seen, ${updated} database rows changed`);
}

async function flushLocalizations(batch) {
  if (!batch.length) return 0;
  const params = [];
  const values = batch
    .map((row, index) => {
      const offset = index * 2;
      params.push(row.barcode, JSON.stringify(row.strings));
      return `($${offset + 1}::text, $${offset + 2}::jsonb)`;
    })
    .join(', ');
  // Merge rather than replace: only the localized keys are touched, so
  // nutrition, tags, images and timestamps in the same row are left alone.
  return prisma.$executeRawUnsafe(
    `UPDATE "OffProduct" AS product
     SET data = product.data || input.strings
     FROM (VALUES ${values}) AS input(barcode, strings)
     WHERE product.barcode = input.barcode
       AND NOT (product.data @> input.strings)`,
    ...params,
  );
}

/**
 * Fill in localized name and ingredient fields on a mirror imported before they
 * were retained.
 *
 * Reuses the already-downloaded full archive and rewrites nothing else, so it
 * is far cheaper than a fresh --full run. Resumable independently, like the
 * other backfills.
 *
 * After this finishes, a user scanning a product printed in their own language
 * reads it straight from the mirror, with no translation call at all.
 */
async function runLocalizationBackfill() {
  const state = readState();
  const archive = path.join(WORK_DIR, 'openfoodfacts-products.jsonl.gz');
  if (!existsSync(archive)) {
    console.log('[off] full archive is not present locally; downloading it once for localization backfill');
    await download(FULL_EXPORT_URL, archive);
    state.localizationProcessedLines = 0;
  }

  const resumeFrom = state.localizationProcessedLines ?? 0;
  if (resumeFrom) console.log(`[off] localization backfill resuming after line ${resumeFrom}`);
  const lines = createInterface({ input: createReadStream(archive).pipe(createGunzip()), crlfDelay: Infinity });
  let index = 0;
  let matched = 0;
  let updated = 0;
  let batch = [];

  const checkpoint = () => {
    state.localizationProcessedLines = index;
    writeState(state);
  };

  for await (const line of lines) {
    index += 1;
    if (index <= resumeFrom) continue;
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const barcode = typeof record.code === 'string' ? record.code.trim() : '';
    if (!/^\d{6,18}$/.test(barcode)) continue;

    const strings = {};
    for (const field of LOCALIZED_FIELDS) {
      const value = record[field];
      if (typeof value === 'string' && value.trim()) strings[field] = value;
    }
    if (typeof record.product_name === 'string') strings.product_name = record.product_name;
    if (typeof record.ingredients_text === 'string') strings.ingredients_text = record.ingredients_text;
    dropDuplicateLocalizations(strings);
    delete strings.product_name;
    delete strings.ingredients_text;

    if (Object.keys(strings).length) {
      batch.push({ barcode, strings });
      matched += 1;
    }

    if (batch.length >= BATCH_SIZE) {
      updated += await flushLocalizations(batch);
      batch = [];
      checkpoint();
      if (matched % (BATCH_SIZE * 10) === 0) {
        console.log(`[off] localization: line ${index}, localized ${matched}, rows changed ${updated}`);
      }
    } else if (index % 100_000 === 0) {
      checkpoint();
      console.log(`[off] localization: line ${index}, localized ${matched}, rows changed ${updated}`);
    }
  }

  updated += await flushLocalizations(batch);
  state.localizationProcessedLines = 0;
  state.lastLocalizationBackfill = new Date().toISOString();
  writeState(state);
  console.log(`[off] localization backfill finished: ${matched} localized records seen, ${updated} database rows changed`);
}

async function flushNutritionBasis(batch) {
  if (!batch.length) return 0;
  const params = [];
  const values = batch.map((row, index) => {
    const offset = index * 2;
    params.push(row.barcode, JSON.stringify(row.patch));
    return `($${offset + 1}::text, $${offset + 2}::jsonb)`;
  }).join(', ');
  return prisma.$executeRawUnsafe(
    `UPDATE "OffProduct" AS product
     SET data = product.data || input.patch
     FROM (VALUES ${values}) AS input(barcode, patch)
     WHERE product.barcode = input.barcode
       AND COALESCE(product.data->>'nutrition_data_per', '') = ''
       AND NOT (product.data @> input.patch)`,
    ...params,
  );
}

function nutritionBasisPatch(record) {
  const basis = nutritionBasisFromRecord(record);
  if (!basis) return {};

  const patch = { nutrition_data_per: basis };
  for (const field of ['nutrition_data_prepared_per', 'serving_size']) {
    const value = typeof record?.[field] === 'string' ? record[field].trim() : '';
    if (value) patch[field] = value;
  }
  return stripNul(patch);
}

/**
 * One-time enrichment for mirrors imported before nutrition basis metadata was
 * retained. It reuses the existing full OFF archive and touches only display
 * metadata (100 g vs 100 ml, prepared basis and serving size).
 * Nutrient values, images and timestamps are deliberately left unchanged.
 */
async function runNutritionBasisBackfill() {
  const state = readState();
  const archive = path.join(WORK_DIR, 'openfoodfacts-products.jsonl.gz');
  if (!existsSync(archive)) {
    console.log('[off] full archive is not present locally; downloading it once for nutrition-basis backfill');
    await download(FULL_EXPORT_URL, archive);
    state.nutritionBasisProcessedLines = 0;
  }

  const resumeFrom = state.nutritionBasisProcessedLines ?? 0;
  if (resumeFrom) console.log(`[off] nutrition-basis backfill resuming after line ${resumeFrom}`);
  const lines = createInterface({ input: createReadStream(archive).pipe(createGunzip()), crlfDelay: Infinity });
  let index = 0;
  let tagged = 0;
  let updated = 0;
  let batch = [];

  const checkpoint = () => {
    state.nutritionBasisProcessedLines = index;
    writeState(state);
  };

  for await (const line of lines) {
    index += 1;
    if (index <= resumeFrom) continue;
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const barcode = typeof record.code === 'string' ? record.code.trim() : '';
    if (!/^\d{6,18}$/.test(barcode)) continue;
    const patch = nutritionBasisPatch(record);
    if (!Object.keys(patch).length) continue;

    batch.push({ barcode, patch });
    tagged += 1;

    if (batch.length >= BATCH_SIZE) {
      updated += await flushNutritionBasis(batch);
      batch = [];
      checkpoint();
      if (tagged % (BATCH_SIZE * 10) === 0) {
        console.log(`[off] nutrition basis: line ${index}, tagged ${tagged}, rows changed ${updated}`);
      }
    } else if (index % 100_000 === 0) {
      checkpoint();
      console.log(`[off] nutrition basis: line ${index}, tagged ${tagged}, rows changed ${updated}`);
    }
  }

  updated += await flushNutritionBasis(batch);
  state.nutritionBasisProcessedLines = 0;
  state.lastNutritionBasisBackfill = new Date().toISOString();
  writeState(state);
  console.log(`[off] nutrition-basis backfill finished: ${tagged} tagged records seen, ${updated} database rows changed`);
}

async function runDelta() {
  const state = readState();
  const applied = new Set(state.appliedDeltas ?? []);

  const response = await fetch(DELTA_INDEX_URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Delta index failed: HTTP ${response.status}`);
  const files = (await response.text())
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.json.gz'))
    .sort();

  const pending = files.filter((file) => !applied.has(file));
  if (!pending.length) {
    console.log('[off] no new delta files');
    return;
  }

  console.log(`[off] applying ${pending.length} delta file(s)`);
  for (const file of pending) {
    const destination = path.join(WORK_DIR, 'delta', file);
    await download(`${DELTA_BASE_URL}${file}`, destination);
    const result = await importJsonl(destination);
    if (rejected) console.warn(`[off] ${rejected} row(s) rejected so far`);
    applied.add(file);
    // Keep the applied list bounded; older entries can never be pending again.
    state.appliedDeltas = [...applied].sort().slice(-400);
    writeState(state);
    console.log(`[off] ${file}: ${result.imported} products updated`);
  }
}

/**
 * Print the raw shape of records. With no argument it reads the file head; with
 * a barcode it scans until that product is found, which is the fast way to see
 * why one specific scan came back without nutrition.
 */
async function runInspect(targetBarcode) {
  const archive = path.join(WORK_DIR, 'openfoodfacts-products.jsonl.gz');
  if (!existsSync(archive)) {
    console.error(`[off] archive not found at ${archive}`);
    process.exit(1);
  }
  const lines = createInterface({ input: createReadStream(archive).pipe(createGunzip()), crlfDelay: Infinity });
  let seen = 0;
  let scanned = 0;
  if (targetBarcode) console.log(`[off] scanning for barcode ${targetBarcode}, this reads the archive sequentially...`);

  for await (const line of lines) {
    if (!line.trim()) continue;

    if (targetBarcode) {
      scanned += 1;
      if (scanned % 500_000 === 0) console.log(`[off]   ...${scanned} lines scanned`);
      // Cheap pre-filter: avoid parsing every one of millions of lines.
      if (!line.includes(`"${targetBarcode}"`)) continue;
    }

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (targetBarcode && String(record.code ?? '').trim() !== targetBarcode) continue;
    const raw = record.nutriments;
    console.log(`--- ${record.code} ${record.product_name ?? ''}`);
    console.log(`    nutriments type: ${Array.isArray(raw) ? 'array' : typeof raw}`);
    if (raw && typeof raw === 'object') {
      const keys = Array.isArray(raw) ? raw.slice(0, 6).map((item) => item?.name ?? item?.id) : Object.keys(raw).slice(0, 12);
      console.log(`    sample keys: ${JSON.stringify(keys)}`);
      console.log(`    raw sample: ${JSON.stringify(raw).slice(0, 400)}`);
    }
    console.log(`    nutrition_data_per: ${record.nutrition_data_per ?? '(unset)'}`);
    console.log(`    normalized: ${JSON.stringify(extractNutriments(record))}`);
    if (targetBarcode) {
      console.log(`    FULL nutriments: ${JSON.stringify(raw)}`);

      // When `nutriments` is empty the values may live in another top-level
      // field that the importer neither keeps nor previously inspected. Dump
      // every key, then the full value of anything nutrition-shaped, so a
      // recoverable source can be identified instead of guessed at.
      const keys = Object.keys(record).sort();
      console.log(`\n    ALL TOP-LEVEL KEYS (${keys.length}):`);
      console.log(`      ${keys.join(', ')}`);

      console.log(`\n    IMAGES: ${JSON.stringify(record.images).slice(0, 600)}`);
      console.log(`    derived: ${JSON.stringify(deriveImageUrls(record))}`);

      const interesting = keys.filter((key) => /nutr|energ|kcal|kj|serving|quantity/i.test(key));
      console.log(`\n    NUTRITION-SHAPED FIELDS (${interesting.length}):`);
      for (const key of interesting) {
        const value = JSON.stringify(record[key]);
        console.log(`      ${key} = ${value && value.length > 700 ? `${value.slice(0, 700)}...(truncated)` : value}`);
      }

      lines.close();
      return;
    }
    seen += 1;
    if (seen >= 3) break;
  }
  lines.close();
  if (targetBarcode) console.log(`[off] barcode ${targetBarcode} not found in the archive`);
}

/**
 * Report how much of the archive carries usable nutrition.
 *
 * By default this reads the WHOLE archive, because the head of the file is not
 * representative: an early-lines sample once read 96% usable where the complete
 * dataset was 72%. Pass a line count to sample the head instead, but treat that
 * number as a smoke test only, never as a statistic.
 */
async function runStats(sampleSize) {
  const archive = path.join(WORK_DIR, 'openfoodfacts-products.jsonl.gz');
  if (!existsSync(archive)) {
    console.error(`[off] archive not found at ${archive}`);
    process.exit(1);
  }
  const stats = statSync(archive);
  console.log(`[off] archive: ${(stats.size / 1024 ** 3).toFixed(2)} GB, modified ${stats.mtime.toISOString()}`);

  if (sampleSize) {
    console.log(`[off] HEAD SAMPLE of ${sampleSize} lines. The head of the archive is not`);
    console.log('[off] representative of the whole dataset; omit the count for exact figures.');
  } else {
    console.log('[off] full pass over the archive, this takes several minutes');
  }

  const lines = createInterface({ input: createReadStream(archive).pipe(createGunzip()), crlfDelay: Infinity });
  let total = 0;
  let emptyRaw = 0;
  let usable = 0;
  let named = 0;
  let recoverable = 0;

  for await (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    total += 1;
    if (record.product_name) named += 1;
    const raw = record.nutriments;
    const legacyEmpty = !raw || (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0);
    if (legacyEmpty) emptyRaw += 1;
    const extracted = extractNutriments(record);
    if (Object.keys(extracted).length >= 4) {
      usable += 1;
      if (legacyEmpty) recoverable += 1;
    }
    if (sampleSize && total >= sampleSize) break;
    if (!sampleSize && total % 500_000 === 0) console.log(`[off]   ...${total} records scanned`);
  }
  lines.close();

  const percent = (value) => `${((value / total) * 100).toFixed(1)}%`;
  console.log(`[off] sampled ${total} records`);
  console.log(`[off]   with a product name              : ${named} (${percent(named)})`);
  console.log(`[off]   legacy nutriments empty          : ${emptyRaw} (${percent(emptyRaw)})`);
  console.log(`[off]   4+ usable nutrients after merge  : ${usable} (${percent(usable)})`);
  console.log(`[off]   recovered from the new structure : ${recoverable} (${percent(recoverable)})`);
  console.log(`[off]   genuinely without nutrition      : ${total - usable} (${percent(total - usable)})`);
  // An empty legacy `nutriments` is normal for products migrated to the newer
  // `nutrition.input_sets` structure, so only the post-merge figure indicates a
  // problem worth acting on.
  if (usable / total < 0.5) {
    console.warn('[off] WARNING: fewer than half the sampled records yield usable nutrition.');
    console.warn('[off] Run --inspect <barcode> on a well-known product before importing.');
  }
}

/**
 * Find where nutrition and images actually live, instead of guessing.
 *
 * Scans the archive, and for every record the importer FAILS to extract from,
 * records which nutrition-shaped fields are non-empty and what shape the
 * `images` object has. The report tells you exactly which structures are still
 * unsupported and how much of the dataset each one is worth, so one pass
 * replaces a series of speculative re-imports.
 *
 *   node scripts/import-openfoodfacts.mjs --discover           # whole archive
 *   node scripts/import-openfoodfacts.mjs --discover 200000    # quick look
 */
async function runDiscover(sampleSize) {
  const archive = path.join(WORK_DIR, 'openfoodfacts-products.jsonl.gz');
  if (!existsSync(archive)) {
    console.error(`[off] archive not found at ${archive}`);
    process.exit(1);
  }

  const lines = createInterface({ input: createReadStream(archive).pipe(createGunzip()), crlfDelay: Infinity });

  let total = 0;
  let nutritionOk = 0;
  let imageOk = 0;
  const nutritionFields = new Map();   // field name -> { count, sample }
  const imageShapes = new Map();       // shape signature -> { count, sample }
  const nutritionShapes = new Map();

  // Bounded on purpose. A shape signature enumerates every key it saw, so on a
  // full pass nearly every record produced a unique kilobyte-long string and the
  // process ran out of memory before finishing. Rare shapes are not interesting
  // anyway: they are collapsed into one bucket.
  const MAX_TRACKED_SHAPES = 400;
  const bump = (map, key, sample) => {
    const bounded = key.length > 140 ? `${key.slice(0, 140)}...` : key;
    const finalKey = map.has(bounded) || map.size < MAX_TRACKED_SHAPES ? bounded : '(other, rare shapes)';
    const entry = map.get(finalKey) ?? { count: 0, sample: undefined };
    entry.count += 1;
    if (entry.sample === undefined && sample !== undefined) entry.sample = String(sample).slice(0, 160);
    map.set(finalKey, entry);
  };

  const nonEmpty = (value) => {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  };

  /** Compact description of an object's shape, not its values. */
  const shapeOf = (value) => {
    if (value === null || value === undefined) return 'missing';
    if (Array.isArray(value)) return value.length ? `array[${typeof value[0]}]` : 'array(empty)';
    if (typeof value !== 'object') return typeof value;
    const keys = Object.keys(value);
    if (!keys.length) return 'object(empty)';
    const kinds = new Set(
      keys.map((key) => {
        if (/^\d+$/.test(key)) return '<number>';
        if (/^front_[a-z]{2}/.test(key)) return 'front_<lang>';
        if (/^(ingredients|nutrition|packaging|other)_[a-z]{2}/.test(key)) return '<type>_<lang>';
        return key;
      }),
    );
    return [...kinds].sort().join('+');
  };

  for await (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    total += 1;

    const nutrients = extractNutriments(record);
    if (Object.keys(nutrients).length >= 4) {
      nutritionOk += 1;
    } else {
      // Which nutrition-shaped fields carry something we are not reading?
      for (const [key, value] of Object.entries(record)) {
        if (!/nutr|energ|kcal|kj/i.test(key)) continue;
        if (!nonEmpty(value)) continue;
        bump(nutritionFields, key, typeof value === 'object' ? JSON.stringify(value) : value);
      }
      bump(nutritionShapes, `nutrition=${shapeOf(record.nutrition)} | nutriments=${shapeOf(record.nutriments)}`,
        JSON.stringify(record.nutrition ?? record.nutriments));
    }

    const images = deriveImageUrls(record);
    if (images.image_front_url) {
      imageOk += 1;
    } else {
      bump(imageShapes, shapeOf(record.images), JSON.stringify(record.images));
    }

    if (sampleSize && total >= sampleSize) break;
    if (total % 250_000 === 0) {
      const used = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      console.log(`[off]   ...${total} records scanned (nutrition ${nutritionOk}, images ${imageOk}, heap ${used} MB)`);
    }
  }
  lines.close();

  const percent = (value) => `${((value / total) * 100).toFixed(1)}%`;
  const top = (map, limit) => [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, limit);

  console.log(`\n[off] scanned ${total} records`);
  console.log(`[off] nutrition extracted : ${nutritionOk} (${percent(nutritionOk)})`);
  console.log(`[off] image URL derived   : ${imageOk} (${percent(imageOk)})`);

  console.log(`\n=== records WITHOUT usable nutrition: which fields still hold something ===`);
  for (const [field, entry] of top(nutritionFields, 20)) {
    console.log(`  ${String(entry.count).padStart(8)} (${percent(entry.count)})  ${field}`);
    console.log(`           e.g. ${entry.sample}`);
  }

  console.log(`\n=== records WITHOUT usable nutrition: shape of nutrition/nutriments ===`);
  for (const [shape, entry] of top(nutritionShapes, 10)) {
    console.log(`  ${String(entry.count).padStart(8)} (${percent(entry.count)})  ${shape}`);
  }

  console.log(`\n=== records WITHOUT an image: shape of the images field ===`);
  for (const [shape, entry] of top(imageShapes, 12)) {
    console.log(`  ${String(entry.count).padStart(8)} (${percent(entry.count)})  ${shape}`);
    if (shape !== 'missing' && shape !== 'object(empty)') console.log(`           e.g. ${entry.sample}`);
  }

  console.log('\nA shape listed above with a large count is an unsupported structure worth adding.');
  console.log('"missing" and "object(empty)" mean the data is genuinely absent.');
}


async function main() {
  const mode = process.argv.includes('--full')
    ? 'full'
    : process.argv.includes('--delta')
      ? 'delta'
      : process.argv.includes('--backfill-countries')
        ? 'backfill-countries'
        : process.argv.includes('--backfill-languages')
          ? 'backfill-languages'
        : process.argv.includes('--backfill-nutrition-basis')
          ? 'backfill-nutrition-basis'
        : process.argv.includes('--inspect')
        ? 'inspect'
        : process.argv.includes('--stats')
          ? 'stats'
          : process.argv.includes('--discover')
            ? 'discover'
            : null;
  if (!mode) {
    console.error('Usage: node scripts/import-openfoodfacts.mjs --full | --delta | --backfill-countries | --backfill-languages | --backfill-nutrition-basis | --inspect [barcode] | --stats [head-sample] | --discover [sample]');
    process.exit(1);
  }
  if (mode === 'discover') {
    const index = process.argv.indexOf('--discover');
    const size = Number(process.argv[index + 1]);
    await runDiscover(Number.isFinite(size) && size > 0 ? size : 0);
    await prisma.$disconnect();
    return;
  }
  if (mode === 'stats') {
    const index = process.argv.indexOf('--stats');
    const size = Number(process.argv[index + 1]);
    // No count means a full, exact pass. A count means an explicitly biased
    // head sample, which is fine for a smoke test and misleading as a metric.
    await runStats(Number.isFinite(size) && size > 0 ? size : 0);
    await prisma.$disconnect();
    return;
  }
  if (mode === 'inspect') {
    const index = process.argv.indexOf('--inspect');
    const candidate = process.argv[index + 1];
    await runInspect(candidate && /^\d{6,18}$/.test(candidate) ? candidate : undefined);
    await prisma.$disconnect();
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }

  const started = Date.now();
  try {
    if (mode === 'full') await runFull();
    else if (mode === 'backfill-countries') await runCountriesBackfill();
    else if (mode === 'backfill-languages') await runLocalizationBackfill();
    else if (mode === 'backfill-nutrition-basis') await runNutritionBasisBackfill();
    else await runDelta();
    console.log(`[off] done in ${Math.round((Date.now() - started) / 1000)}s`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[off] import failed', error);
  process.exit(1);
});
