#!/usr/bin/env node
/**
 * Translation completeness report.
 *
 *   node scripts/i18n-status.mjs            # summary
 *   node scripts/i18n-status.mjs --missing  # list every missing key per locale
 *
 * Covers both translatable surfaces of the website:
 *   - src/messages/<locale>.json        website UI
 *   - src/lib/ingrefit/catalog/*.json   product assessment wording (the API's output)
 *
 * English is the reference for both. A missing key is not a crash: it falls back
 * to English at runtime. This report exists so the fallback never goes unnoticed.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const showMissing = process.argv.includes('--missing');

function flatten(value, prefix = '', out = new Set()) {
  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith('_')) continue;
    const full = prefix ? `${prefix}>${key}` : key;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) flatten(nested, full, out);
    else out.add(full);
  }
  return out;
}

function read(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function report(title, directory, referenceLocale = 'en') {
  const files = readdirSync(directory).filter((name) => name.endsWith('.json'));
  if (!files.includes(`${referenceLocale}.json`)) {
    console.log(`\n${title}: no ${referenceLocale}.json reference, skipping`);
    return;
  }
  const reference = flatten(read(path.join(directory, `${referenceLocale}.json`)));
  console.log(`\n${title}`);
  console.log(`  reference: ${referenceLocale}.json with ${reference.size} keys, ${files.length} locale file(s)`);

  const rows = [];
  for (const file of files.sort()) {
    const locale = file.replace('.json', '');
    if (locale === referenceLocale) continue;
    const present = flatten(read(path.join(directory, file)));
    const missing = [...reference].filter((key) => !present.has(key));
    rows.push({ locale, missing });
  }

  const complete = rows.filter((row) => row.missing.length === 0).map((row) => row.locale);
  const partial = rows.filter((row) => row.missing.length > 0);

  console.log(`  complete: ${complete.length ? complete.join(', ') : 'none'}`);
  if (partial.length) {
    console.log('  incomplete:');
    for (const row of partial) {
      console.log(`    ${row.locale.padEnd(5)} missing ${row.missing.length}/${reference.size}`);
      if (showMissing) for (const key of row.missing) console.log(`        ${key.replaceAll('>', '.')}`);
    }
  }
}

report('Website UI (src/messages)', 'src/messages');
report('Assessment catalog (src/lib/ingrefit/catalog)', 'src/lib/ingrefit/catalog');
console.log('\nLocales absent from the catalog are served in English by design.');
