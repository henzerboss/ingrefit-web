import { createHash } from 'node:crypto';

import type {
  AnalysisProfile,
  DietId,
  GoalId,
  ProductFacts,
  ScoreSignal,
  ScoredProduct,
  Verdict,
} from './types';

/**
 * Deterministic personal fit score.
 *
 * Two properties this file must always preserve:
 *
 *  1. Baseline quality is ALWAYS evaluated. A product is never rewarded just
 *     because the user's goals happen not to cover its weaknesses. (Previously
 *     salami scored 8.2/10 for a "more protein" user because salt, saturated
 *     fat and NOVA 4 were only inspected when other goals were selected.)
 *
 *  2. Personalization is a NORMALIZED weighted average, not a sum. Selecting
 *     twelve goals must not add twelve bonuses. The personal part is a weighted
 *     mean of rule fits in [-1, 1], mapped onto a fixed +/-PERSONAL_RANGE band,
 *     so scores stay comparable between users and between products.
 */

const NEUTRAL_BASE = 5.5;
const PERSONAL_RANGE = 2.5;
const HIGH_RISK_ADDITIVE_CEILING = 4.5;
const BLOCKED_CEILING = 2.0;
/**
 * Nutri-Score deliberately does not rate alcoholic drinks on nutrition, because
 * "low sugar, low salt, few calories" describes vodka. IngreFit follows the same
 * principle with a hard ceiling instead of a nutrition-only judgement.
 */
const ALCOHOL_CEILING = 4.0;
const ALCOHOL_CEILING_ABV = 1.2;

type Direction = 'good' | 'ok' | 'bad';

function directionOf(fit: number): Direction {
  return fit >= 0.25 ? 'good' : fit <= -0.25 ? 'bad' : 'ok';
}

function severityOf(fit: number): ScoreSignal['severity'] {
  return fit >= 0.25 ? 'positive' : fit <= -0.25 ? 'caution' : 'neutral';
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizedText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsTerm(haystack: string, term: string): boolean {
  const source = ` ${normalizedText(haystack)} `;
  const needle = normalizedText(term);
  return Boolean(needle && source.includes(` ${needle} `));
}

function saltEquivalent(facts: ProductFacts): number | null {
  const { salt100g, sodium100g } = facts.nutrition;
  if (typeof salt100g === 'number') return salt100g;
  if (typeof sodium100g === 'number') return sodium100g * 2.5;
  return null;
}

/**
 * Beverages carry far less nutritional weight per 100 units than solids, which
 * is why Nutri-Score scores them on a separate scale. Without this correction a
 * cola with 10.6 g sugar per 100 ml reads as "moderate".
 */
function isBeverage(facts: ProductFacts): boolean {
  if (facts.nutritionReference === '100ml') return true;
  const categories = facts.categories.map(normalizedText).join(' ');
  return /\b(beverage|beverages|drink|drinks|soda|juice|napitki|napitok)\b/.test(categories);
}

// ---------------------------------------------------------------------------
// Allergen matching
// ---------------------------------------------------------------------------

/** Canonical Open Food Facts allergen tags per profile allergen id. */
const ALLERGEN_TAGS: Record<string, string[]> = {
  milk: ['en:milk'],
  eggs: ['en:eggs'],
  peanuts: ['en:peanuts'],
  tree_nuts: ['en:nuts'],
  soy: ['en:soybeans'],
  wheat: ['en:gluten', 'en:wheat'],
  gluten: ['en:gluten'],
  fish: ['en:fish'],
  crustaceans: ['en:crustaceans'],
  sesame: ['en:sesame-seeds'],
  celery: ['en:celery'],
  mustard: ['en:mustard'],
  sulphites: ['en:sulphur-dioxide-and-sulphites'],
  lupin: ['en:lupin'],
  molluscs: ['en:molluscs'],
};

/**
 * Fallback ingredient terms, used only when no normalized allergen tag exists
 * (AI label reading, AI photo, or an Open Food Facts record with no allergen
 * declaration). Covers the languages most likely to appear on packaging in our
 * launch markets.
 */
const ALLERGEN_TERMS: Record<string, string[]> = {
  milk: ['milk', 'lait', 'leche', 'latte', 'milch', 'leite', 'mleko', 'молоко', 'сливки', 'whey', 'casein', 'lactose', 'сыворотка', 'казеин', 'лактоза', 'butter', 'сливочное масло', 'cheese', 'сыр'],
  eggs: ['egg', 'eggs', 'oeuf', 'huevo', 'uovo', 'ei', 'jajko', 'яйцо', 'яйца', 'albumin', 'яичный'],
  peanuts: ['peanut', 'peanuts', 'arachide', 'cacahuete', 'erdnuss', 'orzech ziemny', 'арахис'],
  tree_nuts: ['almond', 'hazelnut', 'walnut', 'cashew', 'pistachio', 'pecan', 'macadamia', 'amande', 'noisette', 'nuez', 'mandel', 'миндаль', 'фундук', 'грецкий орех', 'кешью', 'фисташк', 'орех'],
  soy: ['soy', 'soya', 'soja', 'soybean', 'соя', 'соев'],
  wheat: ['wheat', 'ble', 'trigo', 'frumento', 'weizen', 'pszenica', 'пшениц', 'gluten', 'глютен', 'клейковин'],
  gluten: ['gluten', 'wheat', 'barley', 'rye', 'spelt', 'глютен', 'пшениц', 'ячмен', 'рожь', 'клейковин'],
  fish: ['fish', 'poisson', 'pescado', 'pesce', 'fisch', 'ryba', 'рыба', 'anchovy', 'анчоус', 'tuna', 'тунец', 'salmon', 'лосось'],
  crustaceans: ['shrimp', 'prawn', 'crab', 'lobster', 'crevette', 'gamba', 'krabbe', 'креветк', 'краб', 'омар', 'ракообразн'],
  sesame: ['sesame', 'sesamo', 'sesam', 'кунжут', 'сезам'],
  celery: ['celery', 'celeri', 'apio', 'sellerie', 'сельдерей'],
  mustard: ['mustard', 'moutarde', 'mostaza', 'senf', 'горчиц'],
  sulphites: ['sulphite', 'sulphites', 'sulfite', 'sulfites', 'sulfito', 'сульфит', 'e220', 'e221', 'e222', 'e223', 'e224', 'e226', 'e227', 'e228'],
  lupin: ['lupin', 'lupine', 'altramuz', 'люпин'],
  molluscs: ['mollusc', 'mollusk', 'squid', 'octopus', 'mussel', 'oyster', 'clam', 'моллюск', 'кальмар', 'мидии', 'устриц'],
};

function allergenKey(value: string): string {
  return value.toLowerCase().trim().replace(/[\s-]+/g, '_');
}

interface AllergenHit {
  kind: 'declared' | 'ingredient' | 'traces';
  match: string;
}

function findAllergen(facts: ProductFacts, allergen: string): AllergenHit | null {
  const key = allergenKey(allergen);
  const tags = ALLERGEN_TAGS[key] ?? [];

  const declared = facts.allergenTags.find((tag) => tags.includes(tag));
  if (declared) return { kind: 'declared', match: declared.replace(/^en:/, '') };

  const trace = facts.traceTags.find((tag) => tags.includes(tag));
  if (trace) return { kind: 'traces', match: trace.replace(/^en:/, '') };

  // Only fall back to raw text when no normalized declaration exists at all.
  const haystack = [facts.ingredientsText, ...facts.ingredients, ...facts.allergens, ...facts.traces]
    .filter(Boolean)
    .join(' ');
  if (!haystack) return null;
  const term = (ALLERGEN_TERMS[key] ?? [allergen]).find((candidate) => containsTerm(haystack, candidate));
  return term ? { kind: 'ingredient', match: term } : null;
}

// ---------------------------------------------------------------------------
// Diet conflicts
// ---------------------------------------------------------------------------

const DIET_FALLBACK_TERMS: Partial<Record<DietId, string[]>> = {
  vegan: ['milk', 'whey', 'casein', 'butter', 'cream', 'cheese', 'egg', 'eggs', 'honey', 'gelatin', 'gelatine', 'fish', 'chicken', 'beef', 'pork', 'lard', 'carmine', 'lait', 'leche', 'huevo', 'miel', 'молоко', 'сыворотка', 'казеин', 'сливочное масло', 'сливки', 'сыр', 'яйцо', 'яйца', 'мёд', 'мед', 'желатин', 'рыба', 'курица', 'говядина', 'свинина', 'сало'],
  vegetarian: ['gelatin', 'gelatine', 'fish', 'anchovy', 'anchovies', 'chicken', 'beef', 'pork', 'lard', 'rennet', 'carmine', 'желатин', 'рыба', 'анчоус', 'курица', 'говядина', 'свинина', 'сало', 'сычужн'],
  pescatarian: ['chicken', 'beef', 'pork', 'lard', 'turkey', 'gelatin', 'poulet', 'boeuf', 'cerdo', 'курица', 'говядина', 'свинина', 'сало', 'индейка'],
  gluten_free: ['wheat', 'barley', 'rye', 'gluten', 'spelt', 'malt', 'пшениц', 'ячмен', 'рожь', 'глютен', 'солод'],
  dairy_free: ['milk', 'whey', 'casein', 'butter', 'cream', 'cheese', 'lactose', 'молоко', 'сыворотка', 'казеин', 'сливочное масло', 'сливки', 'сыр', 'лактоза'],
};

type DietVerdict = { status: 'conflict' | 'uncertain'; evidence: string } | null;

function evaluateDiet(facts: ProductFacts, diet: DietId): DietVerdict {
  const analysis = facts.ingredientAnalysis;

  if (diet === 'vegan') {
    if (analysis.vegan === 'no') return { status: 'conflict', evidence: 'Open Food Facts ingredient analysis' };
    if (analysis.vegan === 'maybe') return { status: 'uncertain', evidence: 'Open Food Facts ingredient analysis' };
  }
  if (diet === 'vegetarian') {
    if (analysis.vegetarian === 'no') return { status: 'conflict', evidence: 'Open Food Facts ingredient analysis' };
    if (analysis.vegetarian === 'maybe') return { status: 'uncertain', evidence: 'Open Food Facts ingredient analysis' };
  }
  if (diet === 'gluten_free') {
    if (facts.allergenTags.includes('en:gluten')) return { status: 'conflict', evidence: 'declared allergens' };
    if (facts.labelTags.some((tag) => tag.includes('gluten-free'))) return null;
  }
  if (diet === 'dairy_free') {
    if (facts.allergenTags.includes('en:milk')) return { status: 'conflict', evidence: 'declared allergens' };
  }
  if (diet === 'pescatarian') {
    const isFish = facts.allergenTags.includes('en:fish') || facts.allergenTags.includes('en:crustaceans');
    if (analysis.vegetarian === 'no' && !isFish) {
      return { status: 'uncertain', evidence: 'Open Food Facts ingredient analysis' };
    }
  }

  // Text fallback for AI-read labels and records without normalized analysis.
  const terms = DIET_FALLBACK_TERMS[diet];
  const hasStructuredAnswer =
    (diet === 'vegan' && analysis.vegan !== null) ||
    (diet === 'vegetarian' && analysis.vegetarian !== null) ||
    ((diet === 'gluten_free' || diet === 'dairy_free') && facts.allergenTags.length > 0);
  if (!terms || hasStructuredAnswer) return null;

  const haystack = [facts.ingredientsText, ...facts.ingredients].filter(Boolean).join(' ');
  if (!haystack) return null;
  const hit = terms.find((term) => containsTerm(haystack, term));
  // Text matching cannot see through translations, so it warns rather than blocks.
  return hit ? { status: 'uncertain', evidence: hit } : null;
}

// ---------------------------------------------------------------------------
// Personal rules
// ---------------------------------------------------------------------------

type RuleId = 'protein' | 'sugars' | 'fiber' | 'salt' | 'saturated_fat' | 'energy' | 'carbs' | 'processing';

/** How strongly each goal cares about each rule. Weight = max, never a sum. */
const GOAL_INTEREST: Record<RuleId, Partial<Record<GoalId, number>>> = {
  protein: { high_protein: 1, muscle_gain: 1, steady_energy: 0.4, weight_loss: 0.3 },
  sugars: { low_sugar: 1, steady_energy: 0.7, weight_loss: 0.5, balanced: 0.5, heart_health: 0.3, digestive_wellness: 0.2 },
  fiber: { high_fiber: 1, digestive_wellness: 0.9, heart_health: 0.4, steady_energy: 0.4, balanced: 0.4, weight_loss: 0.3 },
  salt: { low_sodium: 1, heart_health: 0.7, balanced: 0.3 },
  saturated_fat: { low_saturated_fat: 1, heart_health: 0.8, balanced: 0.3, weight_loss: 0.2 },
  energy: { weight_loss: 1, balanced: 0.2 },
  carbs: {},
  processing: { minimally_processed: 1, balanced: 0.4, digestive_wellness: 0.3, heart_health: 0.2 },
};

const DIET_INTEREST: Partial<Record<RuleId, Partial<Record<DietId, number>>>> = {
  carbs: { low_carb: 1 },
  processing: { mediterranean: 0.5 },
  fiber: { mediterranean: 0.5 },
  saturated_fat: { mediterranean: 0.3 },
};

function ruleWeight(rule: RuleId, profile: AnalysisProfile): { weight: number; goal: GoalId | null } {
  let weight = 0;
  let goal: GoalId | null = null;
  for (const selected of profile.goals) {
    const interest = GOAL_INTEREST[rule][selected] ?? 0;
    if (interest > weight) {
      weight = interest;
      goal = selected;
    }
  }
  const dietInterest = DIET_INTEREST[rule]?.[profile.diet] ?? 0;
  if (dietInterest > weight) weight = dietInterest;
  return { weight, goal };
}

function band(value: number, thresholds: Array<[number, number]>, fallback: number): number {
  for (const [limit, fit] of thresholds) {
    if (value <= limit) return fit;
  }
  return fallback;
}

interface RuleOutcome {
  rule: RuleId;
  code: string;
  fit: number;
  params: Record<string, string | number>;
}

function evaluateRules(facts: ProductFacts, profile: AnalysisProfile): RuleOutcome[] {
  const outcomes: RuleOutcome[] = [];
  const beverage = isBeverage(facts);
  const reference = facts.nutritionReference ?? '100g';
  const nutrition = facts.nutrition;

  const push = (rule: RuleId, code: string, fit: number, value: number | string, extra: Record<string, string | number> = {}) => {
    outcomes.push({
      rule,
      code,
      fit,
      params: { value, reference, direction: directionOf(fit), ...extra },
    });
  };

  if (typeof nutrition.protein100g === 'number') {
    const value = nutrition.protein100g;
    push('protein', 'personal.protein', band(value, [[5, -0.6], [8, -0.1], [12, 0.25], [20, 0.6]], 1), round(value));
  }

  if (typeof nutrition.sugars100g === 'number') {
    const value = nutrition.sugars100g;
    const scaled = beverage ? value * 2 : value;
    push('sugars', 'personal.sugars', band(scaled, [[2, 1], [5, 0.7], [10, 0.2], [15, -0.3], [25, -0.7]], -1), round(value));
  }

  if (typeof nutrition.fiber100g === 'number') {
    const value = nutrition.fiber100g;
    push('fiber', 'personal.fiber', band(value, [[1.5, -0.6], [3, 0], [6, 0.5]], 1), round(value));
  }

  const salt = saltEquivalent(facts);
  if (salt !== null) {
    push('salt', 'personal.salt', band(salt, [[0.3, 1], [0.75, 0.4], [1.25, 0], [1.5, -0.4]], -1), round(salt, 2));
  }

  if (typeof nutrition.saturatedFat100g === 'number') {
    const value = nutrition.saturatedFat100g;
    push('saturated_fat', 'personal.saturated_fat', band(value, [[1.5, 1], [3, 0.4], [5, -0.1], [10, -0.6]], -1), round(value));
  }

  if (typeof nutrition.energyKcal100g === 'number') {
    const value = nutrition.energyKcal100g;
    const scaled = beverage ? value * 2.5 : value;
    push('energy', 'personal.energy', band(scaled, [[80, 1], [150, 0.6], [250, 0.2], [400, -0.3]], -0.8), Math.round(value));
  }

  if (typeof nutrition.carbohydrates100g === 'number') {
    const value = nutrition.carbohydrates100g;
    push('carbs', 'personal.carbs', band(value, [[5, 1], [10, 0.6], [20, 0], [40, -0.6]], -1), round(value));
  }

  if (facts.novaGroup !== null) {
    const group = facts.novaGroup;
    const fit = group === 1 ? 1 : group === 2 ? 0.5 : group === 3 ? -0.2 : -1;
    outcomes.push({
      rule: 'processing',
      code: 'personal.processing',
      fit,
      params: { group, direction: directionOf(fit) },
    });
  }

  return outcomes;
}

// ---------------------------------------------------------------------------
// Baseline quality
// ---------------------------------------------------------------------------

const NUTRISCORE_BASE: Record<string, number> = { a: 8.6, b: 7.2, c: 5.8, d: 4.2, e: 2.6 };

interface BaseResult {
  score: number;
  signals: ScoreSignal[];
  /** 0-1 confidence in the baseline itself. */
  confidence: number;
}

function computeBase(facts: ProductFacts): BaseResult {
  const signals: ScoreSignal[] = [];
  let score = NEUTRAL_BASE;
  let confidence = 1;

  const add = (id: string, code: string, impact: number, severity: ScoreSignal['severity'], params: Record<string, string | number> = {}) => {
    const rounded = round(impact);
    signals.push({ id, code, scope: 'base', impact: rounded, severity, params });
    score += rounded;
  };

  const estimated = facts.nutritionBasis === 'estimated_visual' || facts.nutritionBasis === 'estimated_text';
  const estimateFlag: Record<string, string | number> = estimated ? { estimated: 1 } : {};

  const grade = facts.nutriScore?.toLowerCase().trim();
  if (grade && NUTRISCORE_BASE[grade] !== undefined) {
    add('base:nutriscore', 'base.nutriscore', NUTRISCORE_BASE[grade] - NEUTRAL_BASE, grade <= 'b' ? 'positive' : grade === 'c' ? 'neutral' : 'caution', { grade });
  } else {
    const proxy = nutritionProxy(facts);
    if (proxy) {
      add('base:profile', 'base.nutrition_profile', proxy.impact, proxy.impact > 0.3 ? 'positive' : proxy.impact < -0.3 ? 'caution' : 'neutral', { detail: proxy.detail, ...estimateFlag });
      confidence = Math.min(confidence, 0.85);
    } else {
      signals.push({ id: 'base:unknown', code: 'base.nutrition_unknown', scope: 'base', impact: 0, severity: 'neutral', params: {} });
      confidence = Math.min(confidence, 0.4);
    }
  }

  if (facts.novaGroup !== null) {
    const group = facts.novaGroup;
    const impact = group === 1 ? 0.5 : group === 2 ? 0.2 : group === 3 ? -0.3 : -0.9;
    add('base:nova', 'base.nova', impact, impact > 0 ? 'positive' : impact < 0 ? 'caution' : 'neutral', { group });
  }

  const high = facts.additives.filter((additive) => additive.risk === 'high');
  const moderate = facts.additives.filter((additive) => additive.risk === 'moderate');
  if (high.length) {
    add('base:additive-high', 'base.additive_high', -1.5, 'critical', {
      names: high.map((additive) => `${additive.code.toUpperCase()} ${additive.name}`).join(', '),
      count: high.length,
      basis: high[0]!.basis,
    });
  }
  if (moderate.length) {
    const impact = Math.max(-1.2, -0.35 * moderate.length);
    add('base:additive-moderate', 'base.additive_moderate', impact, 'caution', {
      names: moderate.map((additive) => `${additive.code.toUpperCase()} ${additive.name}`).join(', '),
      count: moderate.length,
    });
  }
  if (!high.length && !moderate.length && facts.additives.length === 0 && facts.source === 'openfoodfacts' && facts.ingredientsText) {
    add('base:additives-clean', 'base.additives_clean', 0.2, 'positive');
  }

  if (facts.ingredientAnalysis.palmOil === 'yes') {
    add('base:palm-oil', 'base.palm_oil', -0.3, 'caution');
  }

  if (typeof facts.fruitsVegetablesNuts100g === 'number' && facts.fruitsVegetablesNuts100g >= 40) {
    const impact = facts.fruitsVegetablesNuts100g >= 80 ? 0.5 : 0.3;
    add('base:fruit-veg', 'base.fruit_veg', impact, 'positive', { percent: Math.round(facts.fruitsVegetablesNuts100g) });
  }

  if (facts.organic) {
    add('base:organic', 'base.organic', 0.15, 'positive');
  }

  if (typeof facts.alcoholPercent === 'number' && facts.alcoholPercent > 0) {
    const percent = facts.alcoholPercent;
    const impact = percent <= 1.2 ? -0.5 : percent <= 6 ? -1.5 : percent <= 15 ? -2.2 : -3;
    add('base:alcohol', 'base.alcohol', impact, 'caution', { percent });
  }

  if (high.length) score = Math.min(score, HIGH_RISK_ADDITIVE_CEILING);
  if (typeof facts.alcoholPercent === 'number' && facts.alcoholPercent > ALCOHOL_CEILING_ABV) {
    score = Math.min(score, ALCOHOL_CEILING);
  }
  return { score: Math.max(1, Math.min(10, score)), signals, confidence };
}

/** Nutri-Score-like fallback used when no official grade is published. */
function nutritionProxy(facts: ProductFacts): { impact: number; detail: string } | null {
  const nutrition = facts.nutrition;
  const beverage = isBeverage(facts);
  // Detail is emitted as `key=value` pairs, never as prose: this module must
  // stay language-neutral so the same signal can render in any language.
  const parts: string[] = [];
  let impact = 0;
  let known = 0;

  const salt = saltEquivalent(facts);
  const push = (value: number, delta: number, text: string) => {
    impact += delta;
    known += 1;
    parts.push(text);
    return value;
  };

  if (typeof nutrition.sugars100g === 'number') {
    const scaled = beverage ? nutrition.sugars100g * 2 : nutrition.sugars100g;
    push(scaled, band(scaled, [[5, 0.5], [10, 0.1], [22.5, -0.7]], -1.3), `sugars=${round(nutrition.sugars100g)}`);
  }
  if (typeof nutrition.saturatedFat100g === 'number') {
    push(nutrition.saturatedFat100g, band(nutrition.saturatedFat100g, [[1.5, 0.4], [5, -0.2], [10, -0.7]], -1.1), `saturated_fat=${round(nutrition.saturatedFat100g)}`);
  }
  if (salt !== null) {
    push(salt, band(salt, [[0.3, 0.4], [1, 0], [1.5, -0.5]], -0.9), `salt=${round(salt, 2)}`);
  }
  if (typeof nutrition.fiber100g === 'number') {
    push(nutrition.fiber100g, band(nutrition.fiber100g, [[1.5, -0.3], [3, 0.2], [6, 0.5]], 0.8), `fiber=${round(nutrition.fiber100g)}`);
  }
  if (typeof nutrition.protein100g === 'number') {
    push(nutrition.protein100g, band(nutrition.protein100g, [[3, -0.2], [8, 0.1], [15, 0.4]], 0.6), `protein=${round(nutrition.protein100g)}`);
  }
  if (typeof nutrition.energyKcal100g === 'number') {
    const scaled = beverage ? nutrition.energyKcal100g * 2.5 : nutrition.energyKcal100g;
    push(scaled, band(scaled, [[150, 0.3], [300, 0], [450, -0.4]], -0.7), `energy=${Math.round(nutrition.energyKcal100g)}`);
  }

  if (known < 3) return null;
  return { impact: Math.max(-2.5, Math.min(2, impact)), detail: parts.join(';') };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function scoreProduct(facts: ProductFacts, profile: AnalysisProfile): ScoredProduct {
  const signals: ScoreSignal[] = [];
  let blocked = false;

  // --- 1. Blockers ---------------------------------------------------------
  for (const allergen of profile.allergens) {
    const hit = findAllergen(facts, allergen);
    if (!hit) continue;
    if (hit.kind === 'traces') {
      signals.push({
        id: `traces:${allergenKey(allergen)}`,
        code: 'warning.allergen_traces',
        scope: 'blocker',
        impact: -0.3,
        severity: 'caution',
        params: { allergen: allergenKey(allergen) },
      });
      continue;
    }
    blocked = true;
    signals.push({
      id: `allergen:${allergenKey(allergen)}`,
      code: hit.kind === 'declared' ? 'blocker.allergen_declared' : 'blocker.allergen_ingredient',
      scope: 'blocker',
      impact: 0,
      severity: 'critical',
      params: { allergen: allergenKey(allergen), match: hit.match },
    });
  }

  if (profile.allergens.length && !facts.allergenTags.length && !facts.ingredientsText && facts.source !== 'openfoodfacts') {
    signals.push({
      id: 'allergen:no-data',
      code: 'warning.allergen_data_missing',
      scope: 'blocker',
      impact: 0,
      severity: 'caution',
      params: {},
    });
  }

  const ingredientHaystack = [facts.ingredientsText, ...facts.ingredients].filter(Boolean).join(' ');
  for (const avoided of profile.avoidedIngredients) {
    if (avoided && containsTerm(ingredientHaystack, avoided)) {
      blocked = true;
      signals.push({
        id: `avoid:${normalizedText(avoided)}`,
        code: 'blocker.avoid_ingredient',
        scope: 'blocker',
        impact: 0,
        severity: 'critical',
        params: { ingredient: avoided },
      });
    }
  }

  if (profile.diet !== 'none') {
    const verdict = evaluateDiet(facts, profile.diet);
    if (verdict?.status === 'conflict') {
      blocked = true;
      signals.push({
        id: `diet:${profile.diet}`,
        code: 'blocker.diet_conflict',
        scope: 'blocker',
        impact: 0,
        severity: 'critical',
        params: { diet: profile.diet, evidence: verdict.evidence },
      });
    } else if (verdict?.status === 'uncertain') {
      signals.push({
        id: `diet-uncertain:${profile.diet}`,
        code: 'warning.diet_uncertain',
        scope: 'blocker',
        impact: -0.5,
        severity: 'caution',
        params: { diet: profile.diet },
      });
    }
  }

  // --- 2. Baseline quality (always) ---------------------------------------
  const base = computeBase(facts);
  signals.push(...base.signals);

  // --- 3. Normalized personalization --------------------------------------
  const estimated = facts.nutritionBasis === 'estimated_visual' || facts.nutritionBasis === 'estimated_text';
  const dataConfidence = facts.nutritionBasis === 'estimated_visual' ? 0.55 : facts.nutritionBasis === 'estimated_text' ? 0.75 : 1;
  const confidence = round(Math.min(base.confidence, dataConfidence), 2);

  const outcomes = evaluateRules(facts, profile);
  let weightSum = 0;
  let weightedFit = 0;
  const applicable: Array<{ outcome: RuleOutcome; weight: number; goal: GoalId | null }> = [];

  for (const outcome of outcomes) {
    const { weight, goal } = ruleWeight(outcome.rule, profile);
    if (weight <= 0) continue;
    applicable.push({ outcome, weight, goal });
    weightSum += weight;
    weightedFit += weight * outcome.fit;
  }

  // Coverage damping: a single matching rule is weaker evidence about the user
  // than six matching rules, so it should not swing the score by the full band.
  const coverage = Math.min(1, 0.5 + weightSum / 4);

  let personalDelta = 0;
  if (weightSum > 0) {
    personalDelta = round((weightedFit / weightSum) * PERSONAL_RANGE * confidence * coverage, 2);
    for (const { outcome, weight, goal } of applicable) {
      // Each signal's displayed impact is its exact share of personalDelta, so
      // the numbers on screen add up to the number in the badge.
      const share = round(((weight * outcome.fit) / weightSum) * PERSONAL_RANGE * confidence * coverage);
      signals.push({
        id: `personal:${outcome.rule}`,
        code: outcome.code,
        scope: 'personal',
        impact: share,
        severity: severityOf(outcome.fit),
        params: { ...outcome.params, goal: goal ?? profile.goals[0] ?? 'balanced', ...(estimated ? { estimated: 1 } : {}) },
      });
    }
  } else {
    signals.push({ id: 'personal:none', code: 'personal.no_data', scope: 'personal', impact: 0, severity: 'neutral', params: {} });
  }

  // --- 4. Final score ------------------------------------------------------
  const baseAfterConfidence = NEUTRAL_BASE + (base.score - NEUTRAL_BASE) * (facts.nutritionBasis === 'declared' ? 1 : confidence);
  const warningPenalty = signals
    .filter((signal) => signal.scope === 'blocker' && signal.impact < 0)
    .reduce((total, signal) => total + signal.impact, 0);

  let score = baseAfterConfidence + personalDelta + warningPenalty;
  if (typeof facts.alcoholPercent === 'number' && facts.alcoholPercent > ALCOHOL_CEILING_ABV) {
    score = Math.min(score, ALCOHOL_CEILING);
  }
  score = Math.max(1, Math.min(10, score));
  if (blocked) score = Math.min(score, BLOCKED_CEILING);
  score = round(score);

  const verdict: Verdict = blocked ? 'blocked' : score >= 8 ? 'great' : score >= 6 ? 'good' : score >= 4 ? 'mixed' : 'poor';

  return {
    score,
    verdict,
    baseScore: round(baseAfterConfidence),
    personalDelta: round(personalDelta),
    confidence,
    blocked,
    signals,
    fingerprint: fingerprintOf(score, verdict, signals, facts),
  };
}

/**
 * Explanation cache key. Two scans that produce the same signals in the same
 * language deserve the same words, so this must cover everything the prompt
 * sees and nothing else.
 */
function fingerprintOf(score: number, verdict: Verdict, signals: ScoreSignal[], facts: ProductFacts): string {
  const payload = JSON.stringify({
    v: 2,
    score,
    verdict,
    source: facts.source,
    basis: facts.nutritionBasis ?? 'declared',
    signals: signals
      .map((signal) => ({ c: signal.code, i: signal.impact, s: signal.severity, p: signal.params }))
      .sort((left, right) => left.c.localeCompare(right.c)),
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 40);
}
