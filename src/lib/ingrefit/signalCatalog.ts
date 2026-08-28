import type { AdditiveBasis } from './additives';
import { CATALOG_LANGUAGES, fill, phrase, resolveCatalogLanguage } from './catalog';
import type { DietId, GoalId, ScoreSignal } from './types';

/**
 * Deterministic rendering of score signals.
 *
 * Every user-facing sentence the free tier shows is produced here, in the
 * user's language, with no model call. Gemini only ever rewrites this text for
 * Premium; it never produces the only available version of it.
 *
 * This module holds no strings of its own: all wording lives in
 * `catalog/<language>.json`. See catalog/index.ts for how to add a language.
 */

export type CatalogLanguage = string;

export { CATALOG_LANGUAGES };

export function catalogLanguage(locale: string): CatalogLanguage {
  return resolveCatalogLanguage(locale);
}

export function goalName(goal: GoalId, language: CatalogLanguage): string {
  return phrase(language, `goals.${goal}`);
}

export function dietName(diet: DietId, language: CatalogLanguage): string {
  return phrase(language, `diets.${diet}`);
}

export function allergenName(allergen: string, language: CatalogLanguage): string {
  const key = allergen.toLowerCase().replace(/[\s-]/g, '_');
  const value = phrase(language, `allergens.${key}`);
  return value === `allergens.${key}` ? allergen : value;
}

export function additiveBasisText(basis: AdditiveBasis, language: CatalogLanguage): string {
  return phrase(language, `additiveBasis.${basis}`);
}

/**
 * Open Food Facts tag -> profile allergen key.
 *
 * Tags arrive canonicalized as `en:eggs`, `en:sesame-seeds`, and for products
 * whose ingredients did not match the taxonomy, in the source language instead
 * (`ru:глютен`). Stripping the prefix alone therefore shows an English word to a
 * Russian user whenever the tag did match, which is the bug this map fixes.
 */
const TAG_TO_ALLERGEN: Record<string, string> = {
  'en:milk': 'milk',
  'en:eggs': 'eggs',
  'en:peanuts': 'peanuts',
  'en:nuts': 'tree_nuts',
  'en:tree-nuts': 'tree_nuts',
  'en:almonds': 'tree_nuts',
  'en:hazelnuts': 'tree_nuts',
  'en:walnuts': 'tree_nuts',
  'en:cashew-nuts': 'tree_nuts',
  'en:pistachio-nuts': 'tree_nuts',
  'en:soybeans': 'soy',
  'en:gluten': 'gluten',
  'en:wheat': 'wheat',
  'en:fish': 'fish',
  'en:crustaceans': 'crustaceans',
  'en:sesame-seeds': 'sesame',
  'en:celery': 'celery',
  'en:mustard': 'mustard',
  'en:sulphur-dioxide-and-sulphites': 'sulphites',
  'en:lupin': 'lupin',
  'en:molluscs': 'molluscs',
};

function prettifySlug(tag: string): string {
  return tag
    .replace(/^[a-z]{2}:/i, '')
    .replaceAll('-', ' ')
    .trim();
}

/** Localized name for an allergen or traces tag. */
export function allergenTagName(tag: string, language: CatalogLanguage): string {
  const key = TAG_TO_ALLERGEN[tag];
  return key ? allergenName(key, language) : prettifySlug(tag);
}

/** Localized name for a label tag. */
export function labelTagName(tag: string, language: CatalogLanguage): string {
  const value = phrase(language, `labels.${tag}`);
  return value === `labels.${tag}` ? prettifySlug(tag) : value;
}

function referenceName(params: Record<string, string | number>, language: CatalogLanguage): string {
  const value = String(params.reference ?? '100g');
  return phrase(language, `references.${value === '100ml' || value === 'serving' ? value : '100g'}`);
}

function direction(params: Record<string, string | number>): 'good' | 'ok' | 'bad' {
  const value = String(params.direction ?? 'ok');
  return value === 'good' || value === 'bad' ? value : 'ok';
}

/** Nutrient rule ids that share one evidence sentence. */
const NUTRIENT_RULES: Record<string, string> = {
  'personal.protein': 'protein',
  'personal.sugars': 'sugars',
  'personal.fiber': 'fiber',
  'personal.salt': 'salt',
  'personal.saturated_fat': 'saturated_fat',
  'personal.carbs': 'carbs',
  'personal.energy': 'energy',
};

/**
 * Renders the compact `key=value;key=value` detail string the scorer produces.
 * The scorer stays language-neutral; the words are chosen here.
 */
function renderNutrientDetail(detail: string, language: CatalogLanguage): string {
  const separator = phrase(language, 'decimalSeparator');
  return detail
    .split(';')
    .map((part) => {
      const [key, rawValue] = part.split('=');
      if (!key || rawValue === undefined) return null;
      const value = separator === '.' ? rawValue : rawValue.replace('.', separator);
      const name = phrase(language, `nutrients.${key}.name`);
      const unit = phrase(language, `nutrients.${key}.unit`);
      return name.startsWith('nutrients.') ? `${key} ${value}` : `${name} ${value} ${unit}`;
    })
    .filter(Boolean)
    .join(', ');
}

export function renderSignal(signal: ScoreSignal, language: CatalogLanguage): { label: string; evidence: string } {
  const params = signal.params;
  const nutrientRule = NUTRIENT_RULES[signal.code];

  // Shared parameter set, so a translator writes each sentence once.
  const values: Record<string, string | number | undefined> = {
    ...params,
    reference: referenceName(params, language),
    goal: params.goal === undefined ? undefined : goalName(String(params.goal) as GoalId, language),
    diet: params.diet === undefined ? undefined : dietName(String(params.diet) as DietId, language),
    allergen: params.allergen === undefined ? undefined : allergenName(String(params.allergen), language),
    allergens:
      params.allergens === undefined
        ? undefined
        : String(params.allergens)
            .split(',')
            .map((item) => allergenName(item.trim(), language))
            .filter(Boolean)
            .join(', '),
    grade: params.grade === undefined ? undefined : String(params.grade).toUpperCase(),
    basis: params.basis === undefined ? undefined : additiveBasisText(String(params.basis) as AdditiveBasis, language),
    detail: params.detail === undefined ? undefined : renderNutrientDetail(String(params.detail), language),
    novaLabel: params.group === undefined ? undefined : phrase(language, `nova.${params.group}`),
  };

  let label: string;
  let evidence: string;

  if (nutrientRule) {
    label = phrase(language, `signals.${signal.code}.label.${direction(params)}`);
    // The same nutrient name is used mid-sentence in the derived-baseline detail
    // and at the start of this one, so the catalog stores it lowercase and the
    // sentence-initial form is produced here.
    const nutrient = phrase(language, `nutrients.${nutrientRule}.name`);
    evidence = fill(phrase(language, 'signals.personal.nutrientEvidence'), {
      ...values,
      nutrient: nutrient.charAt(0).toLocaleUpperCase(language) + nutrient.slice(1),
      unit: phrase(language, `nutrients.${nutrientRule}.unit`),
    });
  } else if (signal.code === 'personal.processing') {
    label = phrase(language, `signals.personal.processing.label.${direction(params)}`);
    evidence = fill(phrase(language, 'signals.personal.processing.evidence'), values);
  } else {
    const labelTemplate = phrase(language, `signals.${signal.code}.label`);
    const evidenceTemplate = phrase(language, `signals.${signal.code}.evidence`);
    const known = !labelTemplate.startsWith('signals.');
    label = fill(known ? labelTemplate : phrase(language, 'signals.fallback.label'), values);
    evidence = fill(known ? evidenceTemplate : phrase(language, 'signals.fallback.evidence'), values);
  }

  if (params.estimated === 1) {
    evidence = fill(phrase(language, 'estimatePrefix'), { text: evidence });
  }
  return { label, evidence };
}
