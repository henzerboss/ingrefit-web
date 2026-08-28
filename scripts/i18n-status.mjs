#!/usr/bin/env node
/**
 * Translation completeness report for the backend.
 *
 *   node scripts/i18n-status.mjs            # summary
 *   node scripts/i18n-status.mjs --missing  # list every missing key per locale
 *
 * Three independent string sets ship with the server and they drift apart
 * silently, because every one of them falls back to English per key at runtime:
 *
 *   src/messages                     marketing site
 *   src/lib/ingrefit/catalog         score explanations shown in the app
 *   src/lib/ingrefit/catalog/additives  additive names and their basis text
 *
 * A missing key is never a crash, which is exactly why it needs a report.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SETS = [
  { label: 'Marketing site', directory: 'src/messages' },
  { label: 'Score catalog', directory: 'src/lib/ingrefit/catalog' },
  { label: 'Additives', directory: 'src/lib/ingrefit/catalog/additives' },
];

const showMissing = process.argv.includes('--missing');

function flatten(value, prefix = '', out = new Set()) {
  for (const [key, nested] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) flatten(nested, full, out);
    else out.add(full);
  }
  return out;
}

let incomplete = 0;

for (const set of SETS) {
  const files = readdirSync(set.directory)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const reference = flatten(JSON.parse(readFileSync(path.join(set.directory, 'en.json'), 'utf8')));

  const complete = [];
  const partial = [];

  for (const file of files) {
    const code = file.replace(/\.json$/, '');
    if (code === 'en') continue;
    const keys = flatten(JSON.parse(readFileSync(path.join(set.directory, file), 'utf8')));
    const missing = [...reference].filter((key) => !keys.has(key));
    if (!missing.length) {
      complete.push(code);
      continue;
    }
    partial.push({ code, missing });
    incomplete += 1;
  }

  console.log(`\n${set.label}: reference en.json with ${reference.size} keys, ${files.length} locale file(s)`);
  if (complete.length) console.log(`  complete: ${complete.join(', ')}`);
  for (const entry of partial) {
    console.log(`  ${entry.code}: ${entry.missing.length} missing`);
    if (showMissing) for (const key of entry.missing) console.log(`      ${key}`);
  }
}

if (incomplete) {
  console.log(`\n${incomplete} locale file(s) fall back to English for at least one key.`);
}
