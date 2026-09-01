#!/usr/bin/env node
/**
 * Sends each response schema to Gemini with a trivial prompt and prints what
 * comes back.
 *
 * A rejected schema surfaces in production as "Request contains an invalid
 * argument" wrapped in AI_UNAVAILABLE, three models deep, with nothing naming
 * the offending field. This isolates one schema per request, so the answer is
 * unambiguous and costs a fraction of a cent.
 *
 *   node scripts/gemini-check.mjs
 *   node scripts/gemini-check.mjs --model gemini-3.1-flash-lite
 */

import { readFileSync, existsSync } from 'node:fs';
import process from 'node:process';

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv('.env');
loadEnv('.env.local');

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set (looked in the environment, .env and .env.local).');
  process.exit(1);
}

const modelArgument = process.argv.indexOf('--model');
const configured = (process.env.INGREFIT_GEMINI_MODELS ?? 'gemini-3.1-flash-lite,gemini-3.5-flash-lite')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const models = modelArgument > -1 ? [process.argv[modelArgument + 1]] : configured;

/**
 * The schemas are re-declared here rather than imported: this script has to run
 * under plain node against a built server, where the TypeScript sources are not
 * loadable. Keep them in step with recognition.ts when either changes — the
 * point is to reproduce the exact shape that is being rejected.
 */
const source = readFileSync('src/lib/ingrefit/recognition.ts', 'utf8');

function extractSchema(name) {
  const match = source.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\}) as const;`));
  if (!match) return null;
  // The literals reference constant arrays; resolve them by evaluating the file's
  // enum declarations alongside the schema.
  const constants = [...source.matchAll(/const ([A-Z_]+_VALUES) = \[([\s\S]*?)\] as const;/g)]
    .map((entry) => `const ${entry[1]} = [${entry[2]}];`)
    .join('\n');
  try {
    // eslint-disable-next-line no-new-func
    return new Function(`${constants}\nreturn ${match[1]};`)();
  } catch (error) {
    console.error(`could not read ${name}:`, error.message);
    return null;
  }
}

const schemas = [
  ['responseSchema (label)', extractSchema('responseSchema')],
  ['textEnrichmentResponseSchema', extractSchema('textEnrichmentResponseSchema')],
  ['foodPhotoResponseSchema', extractSchema('foodPhotoResponseSchema')],
].filter(([, schema]) => Boolean(schema));

function countEnums(schema) {
  let total = 0;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.enum)) total += node.enum.length;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else walk(value);
    }
  };
  walk(schema);
  return total;
}

let failures = 0;

for (const model of models) {
  console.log(`\n=== ${model} ===`);
  for (const [name, schema] of schemas) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: 'Return empty or null values for every field.' }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0,
        maxOutputTokens: 256,
      },
    };
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    const payload = await response.json().catch(() => ({}));
    const enums = countEnums(schema);
    if (response.ok) {
      console.log(`  ok    ${name} (${enums} enum values)`);
      continue;
    }
    failures += 1;
    console.error(`  FAIL  ${name} (${enums} enum values) — HTTP ${response.status}`);
    console.error(`        ${payload.error?.message ?? 'no message'}`);
    if (payload.error?.details) console.error(`        ${JSON.stringify(payload.error.details)}`);
  }
}

if (failures) {
  console.error(`\n${failures} schema(s) rejected. The message above names what Gemini objected to.`);
  process.exit(1);
}
console.log('\nEvery schema was accepted.');
