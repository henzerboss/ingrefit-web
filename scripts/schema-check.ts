/**
 * Guards the one mistake that silently breaks every AI path: a field added to
 * the zod schema but not to the Gemini response schema's `required` list.
 *
 * Gemini only guarantees a property it was told is required. The parser then
 * rejects every response for the missing field, retries, and the whole
 * operation surfaces as AI_UNAVAILABLE — with nothing in the message pointing
 * at the actual cause.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync('src/lib/ingrefit/recognition.ts', 'utf8');

function objectKeys(block: string): string[] {
  return [...block.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*):/gm)].map((match) => match[1]!);
}

let failures = 0;
const pairs: Array<[string, string]> = [
  ['extractedSchema', 'responseSchema'],
  ['textEnrichmentSchema', 'textEnrichmentResponseSchema'],
  ['foodPhotoSchema', 'foodPhotoResponseSchema'],
];

for (const [zodName, geminiName] of pairs) {
  const zodBlock = source.match(new RegExp(`const ${zodName} = z\\.object\\(\\{([\\s\\S]*?)\\n\\}\\);`))?.[1];
  const geminiBlock = source.match(new RegExp(`const ${geminiName} = \\{([\\s\\S]*?)\\n\\} as const;`))?.[1];
  if (!zodBlock || !geminiBlock) {
    console.log(`skip  ${zodName} / ${geminiName} (not found)`);
    continue;
  }
  const required = new Set(
    [...(geminiBlock.match(/required: \[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!),
  );
  const missing = objectKeys(zodBlock).filter((key) => !required.has(key));
  if (missing.length) {
    failures += 1;
    console.error(`FAIL  ${zodName}: not required in ${geminiName}: ${missing.join(', ')}`);
  } else {
    console.log(`ok    ${zodName} matches ${geminiName}`);
  }
}

if (failures) process.exit(1);
