import en from './en.json';
import ru from './ru.json';
import af from './af.json';
import ar from './ar.json';
import az from './az.json';
import bg from './bg.json';
import bn from './bn.json';
import ca from './ca.json';
import cs from './cs.json';
import da from './da.json';
import de from './de.json';
import el from './el.json';
import es from './es.json';
import et from './et.json';
import fi from './fi.json';
import fil from './fil.json';
import fr from './fr.json';
import gu from './gu.json';
import he from './he.json';
import hi from './hi.json';
import hr from './hr.json';
import hu from './hu.json';
import id from './id.json';
import it from './it.json';
import ja from './ja.json';
import kk from './kk.json';
import kn from './kn.json';
import ko from './ko.json';
import lt from './lt.json';
import lv from './lv.json';
import ml from './ml.json';
import mr from './mr.json';
import ms from './ms.json';
import nl from './nl.json';
import no from './no.json';
import pa from './pa.json';
import pl from './pl.json';
import pt from './pt.json';
import ro from './ro.json';
import sk from './sk.json';
import sl from './sl.json';
import sr from './sr.json';
import sv from './sv.json';
import ta from './ta.json';
import te from './te.json';
import th from './th.json';
import tr from './tr.json';
import uk from './uk.json';
import vi from './vi.json';
import zh from './zh.json';

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
const CATALOGS: Record<string, unknown> = {
  en,
  ru,
  af,
  ar,
  az,
  bg,
  bn,
  ca,
  cs,
  da,
  de,
  el,
  es,
  et,
  fi,
  fil,
  fr,
  gu,
  he,
  hi,
  hr,
  hu,
  id,
  it,
  ja,
  kk,
  kn,
  ko,
  lt,
  lv,
  ml,
  mr,
  ms,
  nl,
  no,
  pa,
  pl,
  pt,
  ro,
  sk,
  sl,
  sr,
  sv,
  ta,
  te,
  th,
  tr,
  uk,
  vi,
  zh,
};

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
