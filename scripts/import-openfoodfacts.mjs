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
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
];

/** Nutriment keys the app uses; the raw object routinely holds 200+. */
const KEPT_NUTRIMENTS = [
  'energy-kcal_100g', 'proteins_100g', 'carbohydrates_100g', 'sugars_100g', 'fat_100g',
  'saturated-fat_100g', 'fiber_100g', 'salt_100g', 'sodium_100g', 'alcohol_100g',
  'fruits-vegetables-nuts-estimate-from-ingredients_100g', 'fruits-vegetables-nuts_100g',
];

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
  if (record.nutriments && typeof record.nutriments === 'object') {
    const nutriments = {};
    for (const key of KEPT_NUTRIMENTS) {
      if (record.nutriments[key] !== undefined) nutriments[key] = record.nutriments[key];
    }
    output.nutriments = nutriments;
  }
  return stripNul(output);
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

    const lastModifiedSeconds = Number(record.last_modified_t);
    batch.push({
      barcode,
      data: slim(record),
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
    `[off] full import finished: ${result.imported} products, ${result.skipped} skipped, ${rejected} rejected by the database`,
  );
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

async function main() {
  const mode = process.argv.includes('--full') ? 'full' : process.argv.includes('--delta') ? 'delta' : null;
  if (!mode) {
    console.error('Usage: node scripts/import-openfoodfacts.mjs --full | --delta');
    process.exit(1);
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
