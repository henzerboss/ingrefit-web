import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const activeLocaleSource = fs.readFileSync(path.join(root, 'src/i18n/locales.ts'), 'utf8');
const localeArray = activeLocaleSource.match(/LOCALE_CODES\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
const activeLocales = [...localeArray.matchAll(/'([^']+)'/g)].map((match) => match[1]);
if (activeLocales.length !== 50) throw new Error(`Expected 50 active locales, found ${activeLocales.length}`);

const requiredKeys = [
  ['gallery', 'previous'],
  ['gallery', 'next'],
  ['gallery', 'screenAlt'],
  ['cookies', 'text'],
  ['cookies', 'accept'],
  ['cookies', 'reject'],
];

for (const locale of activeLocales) {
  const messages = JSON.parse(fs.readFileSync(path.join(root, `src/messages/${locale}.json`), 'utf8'));
  for (const [namespace, key] of requiredKeys) {
    if (!messages[namespace]?.[key]?.trim()) throw new Error(`Missing ${namespace}.${key} in ${locale}`);
  }
  if (!messages.features?.f5Body?.includes('50') && locale !== 'bn') {
    throw new Error(`The completed 50-language statement is missing in ${locale}`);
  }
}

const privacy = JSON.parse(fs.readFileSync(path.join(root, 'src/content/legal/privacy.json'), 'utf8'));
const terms = JSON.parse(fs.readFileSync(path.join(root, 'src/content/legal/terms.json'), 'utf8'));
if (privacy.sections.length !== 19 || privacy.sections[1]?.subsections?.length !== 7) throw new Error('Privacy document structure is incomplete');
if (terms.sections.length !== 31) throw new Error('Terms document structure is incomplete');
if (!privacy.intro.includes('August 18, 2026') || !terms.intro.includes('August 18, 2026')) throw new Error('Legal document dates are invalid');
if (!privacy.sections.at(-1)?.body.includes('support@evsi.store') || !terms.sections.at(-1)?.body.includes('support@evsi.store')) {
  throw new Error('Legal document contact information is incomplete');
}

for (const asset of ['public/products/cereal.webp', 'public/products/barcode.webp']) {
  if (!fs.existsSync(path.join(root, asset)) || fs.statSync(path.join(root, asset)).size < 1000) throw new Error(`Missing gallery asset ${asset}`);
}

const routeFiles = [
  'src/app/[locale]/page.tsx',
  'src/app/[locale]/privacy/page.tsx',
  'src/app/[locale]/terms/page.tsx',
  'src/app/api/ingrefit/analyze/route.ts',
  'src/app/api/ingrefit/health/route.ts',
  'src/app/api/ingrefit/usage/route.ts',
  'src/app/api/ingrefit/version/route.ts',
];
for (const route of routeFiles) if (!fs.existsSync(path.join(root, route))) throw new Error(`Missing route ${route}`);

const frontendFiles = [
  'README.md',
  'src/app/globals.css',
  ...walk(path.join(root, 'src/components')),
  ...walk(path.join(root, 'src/messages')),
  ...walk(path.join(root, 'src/content/legal')),
];
for (const file of frontendFiles) {
  const filePath = path.isAbsolute(file) ? file : path.join(root, file);
  if (/[\u2013\u2014]/.test(fs.readFileSync(filePath, 'utf8'))) throw new Error(`Long dash found in ${path.relative(root, filePath)}`);
}

const analytics = fs.readFileSync(path.join(root, 'src/components/GoogleAnalytics.tsx'), 'utf8');
if (!analytics.includes('if (!allowed) return null') || !analytics.includes('COOKIE_CONSENT_KEY')) {
  throw new Error('Google Analytics is not gated by cookie consent');
}

console.log(`Validated landing UI, English legal documents, cookie consent and localized gallery for ${activeLocales.length} locales.`);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(item));
    else files.push(item);
  }
  return files;
}

