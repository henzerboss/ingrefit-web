#!/usr/bin/env node
/**
 * Open Food Facts dataset importer.
 *
 *   node scripts/import-openfoodfacts.mjs --full
 *   node scripts/import-openfoodfacts.mjs --delta
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

/** Only the fields the scorer and the UI read. Everything else is discarded. */
const KEPT_FIELDS = [
  'code', 'product_name', 'product_name_en', 'product_name_ru', 'generic_name', 'brands', 'quantity',
  'image_front_url', 'image_front_small_url',
  'ingredients_text', 'ingredients_text_en', 'ingredients_text_ru', 'ingredients',
  'allergens_tags', 'traces_tags', 'additives_tags', 'labels_tags', 'categories_tags',
  'ingredients_analysis_tags', 'nutrient_levels',
  'nutriscore_grade', 'nutrition_grades', 'nova_group', 'ecoscore_grade', 'environmental_score_grade',
  'alcohol_by_volume', 'alcohol_value', 'alcohol_unit',
  'nutriments', 'serving_size', 'nutrition_data_per', 'last_modified_t',
  'nutrition_data_per', 'no_nutriments',
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
function normalizeNutriments(raw, dataPer) {
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

  // Values declared per serving cannot be reinterpreted as per 100 g without a
  // serving weight, so in that case only explicit *_100g keys are trustworthy.
  const perServing = String(dataPer ?? '').toLowerCase() === 'serving';

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

    // 2. Bare name, or a nested per-quantity object.
    if (value === undefined && !perServing) {
      const candidate = raw[base];
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        value = numeric(candidate['100g'] ?? candidate.per_100g ?? candidate.value);
      } else {
        value = numeric(candidate);
      }
    }

    // 3. The "as entered" value, converted from its declared unit.
    if (value === undefined && !perServing) {
      value = convert(numeric(raw[`${base}_value`]), raw[`${base}_unit`]);
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

  output.nutriments = extractNutriments(record);

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
  const sets = nutrition && typeof nutrition === 'object' ? nutrition.input_sets : undefined;
  if (!Array.isArray(sets)) return output;

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
  const output = { ...normalizeNutriments(record.nutriments, record.nutrition_data_per) };

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
 * Sample the archive and report how much of it carries usable nutrition.
 *
 * A published export can contain records whose `nutriments` object is empty even
 * though the API serves full values for the same barcode. This tells you whether
 * the archive on disk is worth importing before spending hours on it.
 */
async function runStats(sampleSize) {
  const archive = path.join(WORK_DIR, 'openfoodfacts-products.jsonl.gz');
  if (!existsSync(archive)) {
    console.error(`[off] archive not found at ${archive}`);
    process.exit(1);
  }
  const stats = statSync(archive);
  console.log(`[off] archive: ${(stats.size / 1024 ** 3).toFixed(2)} GB, modified ${stats.mtime.toISOString()}`);

  const lines = createInterface({ input: createReadStream(archive).pipe(createGunzip()), crlfDelay: Infinity });
  let total = 0;
  let emptyRaw = 0;
  let usable = 0;
  let named = 0;

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
    if (!raw || (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0)) emptyRaw += 1;
    if (Object.keys(extractNutriments(record)).length >= 4) usable += 1;
    if (total >= sampleSize) break;
  }
  lines.close();

  const percent = (value) => `${((value / total) * 100).toFixed(1)}%`;
  console.log(`[off] sampled ${total} records`);
  console.log(`[off]   with a product name              : ${named} (${percent(named)})`);
  console.log(`[off]   legacy nutriments empty          : ${emptyRaw} (${percent(emptyRaw)})`);
  console.log(`[off]   4+ usable nutrients after merge  : ${usable} (${percent(usable)})`);
  // An empty legacy `nutriments` is normal for products migrated to the newer
  // `nutrition.input_sets` structure, so only the post-merge figure indicates a
  // problem worth acting on.
  if (usable / total < 0.5) {
    console.warn('[off] WARNING: fewer than half the sampled records yield usable nutrition.');
    console.warn('[off] Run --inspect <barcode> on a well-known product before importing.');
  }
}

async function main() {
  const mode = process.argv.includes('--full')
    ? 'full'
    : process.argv.includes('--delta')
      ? 'delta'
      : process.argv.includes('--inspect')
        ? 'inspect'
        : process.argv.includes('--stats')
          ? 'stats'
          : null;
  if (!mode) {
    console.error('Usage: node scripts/import-openfoodfacts.mjs --full | --delta | --inspect [barcode] | --stats [sample]');
    process.exit(1);
  }
  if (mode === 'stats') {
    const index = process.argv.indexOf('--stats');
    const size = Number(process.argv[index + 1]);
    await runStats(Number.isFinite(size) && size > 0 ? size : 50_000);
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
