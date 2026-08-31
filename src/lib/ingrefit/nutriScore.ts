import type { OpenFoodFactsProduct } from './openFoodFacts';

/**
 * Nutri-Score, computed from the declared nutrition panel.
 *
 * Open Food Facts publishes a grade for its own records; a community record has
 * none, and the scorer leans on it heavily. Rather than ask the model for a
 * grade — which would be a guess dressed as a fact — this implements the
 * published 2023 algorithm.
 *
 * Two tables are implemented: general foods and beverages. The special tables
 * for added fats/oils/nuts and for cheeses are NOT implemented, and products
 * detected as belonging to them return `null` instead of an approximation. A
 * missing grade costs a little confidence; a wrong grade would quietly move
 * every score that depends on it.
 */

interface NutriScoreInput {
  energyKj: number | null;
  sugars: number | null;
  saturatedFat: number | null;
  salt: number | null;
  protein: number | null;
  fiber: number | null;
  /** Percentage of fruit, vegetables, pulses and nuts, 0..100. */
  fruitsVegetables: number | null;
}

export type NutriScoreGrade = 'a' | 'b' | 'c' | 'd' | 'e';

/** Points awarded by a step table: the first threshold not exceeded wins. */
function pointsFor(value: number, thresholds: number[]): number {
  let points = 0;
  for (const threshold of thresholds) {
    if (value > threshold) points += 1;
    else break;
  }
  return points;
}

const GENERAL = {
  energyKj: [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350],
  sugars: [3.4, 6.8, 10, 14, 17, 20, 24, 27, 31, 34, 37, 41, 44, 48, 51],
  saturatedFat: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  salt: [0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 3, 3.2, 3.4, 3.6, 3.8, 4],
  protein: [2.4, 4.8, 7.2, 9.6, 12, 14, 17],
  fiber: [3, 4.1, 5.2, 6.3, 7.4],
  fruits: [40, 60, 80],
} as const;

const BEVERAGE = {
  energyKj: [30, 90, 150, 210, 240, 270, 300, 330, 360, 390],
  sugars: [0.5, 2, 3.5, 5, 6, 7, 8, 9, 10, 11],
  saturatedFat: GENERAL.saturatedFat,
  salt: GENERAL.salt,
  protein: [1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3],
  fiber: [3, 4.1, 5.2, 6.3, 7.4],
  fruits: [40, 60, 80],
} as const;

/** Grade cut-offs. Beverages and water use their own scale. */
function gradeFor(score: number, beverage: boolean): NutriScoreGrade {
  if (beverage) {
    if (score <= 2) return 'b';
    if (score <= 6) return 'c';
    if (score <= 9) return 'd';
    return 'e';
  }
  if (score <= 0) return 'a';
  if (score <= 2) return 'b';
  if (score <= 10) return 'c';
  if (score <= 18) return 'd';
  return 'e';
}

/**
 * Categories whose grade uses a table this module does not implement.
 * Detected conservatively: a false positive costs a grade, a false negative
 * would publish a wrong one.
 */
const UNSUPPORTED_CATEGORY_MARKERS = [
  'cheese',
  'fromage',
  'queso',
  'fats',
  'oils',
  'butter',
  'margarine',
  'huile',
  'aceite',
  'nuts',
  'seeds',
  'almonds',
  'peanut-butter',
];

const BEVERAGE_MARKERS = ['beverages', 'drinks', 'sodas', 'juices', 'waters', 'nectars', 'iced-teas'];

function hasMarker(tags: string[], markers: string[]): boolean {
  return tags.some((tag) => {
    const body = tag.replace(/^[a-z]{2}:/, '');
    return markers.some((marker) => body.includes(marker));
  });
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export interface NutriScoreResult {
  grade: NutriScoreGrade;
  score: number;
  beverage: boolean;
}

/**
 * Returns null when the grade cannot be computed honestly: a missing nutrient,
 * or a category that needs one of the unimplemented tables.
 */
export function computeNutriScore(raw: OpenFoodFactsProduct): NutriScoreResult | null {
  const tags = Array.isArray(raw.categories_tags) ? raw.categories_tags : [];
  if (hasMarker(tags, UNSUPPORTED_CATEGORY_MARKERS)) return null;

  const nutriments = (raw.nutriments ?? {}) as Record<string, unknown>;
  const kcal = number(nutriments['energy-kcal_100g']);
  const input: NutriScoreInput = {
    energyKj: number(nutriments['energy-kj_100g']) ?? (kcal === null ? null : kcal * 4.184),
    sugars: number(nutriments.sugars_100g),
    saturatedFat: number(nutriments['saturated-fat_100g']),
    salt: number(nutriments.salt_100g),
    protein: number(nutriments.proteins_100g),
    fiber: number(nutriments.fiber_100g),
    fruitsVegetables: number(nutriments['fruits-vegetables-nuts-estimate-from-ingredients_100g']),
  };

  // Every negative-point nutrient must be present. Treating a missing value as
  // zero would systematically flatter incomplete records.
  if (
    input.energyKj === null ||
    input.sugars === null ||
    input.saturatedFat === null ||
    input.salt === null ||
    input.protein === null
  ) {
    return null;
  }

  const beverage = hasMarker(tags, BEVERAGE_MARKERS);
  const table = beverage ? BEVERAGE : GENERAL;

  const negative =
    pointsFor(input.energyKj, [...table.energyKj]) +
    pointsFor(input.sugars, [...table.sugars]) +
    pointsFor(input.saturatedFat, [...table.saturatedFat]) +
    pointsFor(input.salt, [...table.salt]);

  const fruitPoints = input.fruitsVegetables === null ? 0 : pointsFor(input.fruitsVegetables, [...table.fruits]);
  const fiberPoints = input.fiber === null ? 0 : pointsFor(input.fiber, [...table.fiber]);
  const proteinPoints = pointsFor(input.protein, [...table.protein]);

  // Protein points are withheld from high-negative products unless the fruit
  // content already earns full marks — the rule that stops a salty cured meat
  // from being rescued by its protein.
  const positive =
    negative >= 11 && fruitPoints < 3 ? fruitPoints + fiberPoints : fruitPoints + fiberPoints + proteinPoints;

  const score = negative - positive;
  return { grade: gradeFor(score, beverage), score, beverage };
}
