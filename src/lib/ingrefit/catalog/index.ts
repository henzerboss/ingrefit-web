import en from './en.json';
import ru from './ru.json';

/**
 * Translation catalog for everything the assessment engine says to the user.
 *
 * Strings live in JSON, one file per language, so translating IngreFit never
 * requires touching TypeScript. Adding a language is two steps:
 *
 *   1. copy `en.json`, translate the values, keep every {placeholder} intact;
 *   2. import it here and add it to CATALOGS.
 *
 * Nothing else changes. Any key a translation has not caught up with falls back
 * to English per key, so a partial file is safe to ship.
 */

export type Catalog = typeof en;

/** Languages with a catalog file. Everything else is served in English. */
const CATALOGS: Record<string, unknown> = { en, ru };

export const CATALOG_LANGUAGES = Object.keys(CATALOGS);

/**
 * Maps a request locale onto a catalog language: exact match first, then the
 * base language (`pt-BR` -> `pt`), then English.
 */
export function resolveCatalogLanguage(locale: string): string {
  const normalized = locale.trim().toLowerCase().replace('_', '-');
  if (CATALOGS[normalized]) return normalized;
  const base = normalized.split('-')[0]!;
  return CATALOGS[base] ? base : 'en';
}

/**
 * Resolve a dotted path where the keys themselves may contain dots.
 *
 * Signal ids like `base.nutrition_profile` are single JSON keys, so a naive
 * split on '.' walks into a nested object that does not exist. Each candidate
 * prefix is therefore tried as a literal key, longest first.
 */
function lookup(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object') return undefined;
  const record = source as Record<string, unknown>;
  if (path in record) return record[path];

  // Try progressively longer prefixes as a literal key, then recurse.
  const parts = path.split('.');
  for (let take = parts.length - 1; take >= 1; take -= 1) {
    const key = parts.slice(0, take).join('.');
    if (key in record) {
      const resolved = lookup(record[key], parts.slice(take).join('.'));
      if (resolved !== undefined) return resolved;
    }
  }
  return undefined;
}

/** Resolve a dotted path, falling back to English for that single key. */
export function phrase(language: string, path: string): string {
  const value = lookup(CATALOGS[language], path) ?? lookup(en, path);
  return typeof value === 'string' ? value : path;
}

/** Same as `phrase`, but returns undefined instead of the path when missing. */
export function optionalPhrase(language: string, path: string): string | undefined {
  const value = lookup(CATALOGS[language], path) ?? lookup(en, path);
  return typeof value === 'string' ? value : undefined;
}

/** Fill `{placeholders}`. Unknown placeholders are left untouched, never blanked. */
export function fill(template: string, params: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

/** Localized decimal formatting, driven by the catalog rather than hardcoded. */
export function formatNumber(language: string, value: number, digits = 1): string {
  const separator = phrase(language, 'decimalSeparator');
  const text = value.toFixed(digits).replace(/\.0$/, digits === 1 ? '.0' : '');
  return separator === '.' ? text : text.replace('.', separator);
}

export { en as englishCatalog };
