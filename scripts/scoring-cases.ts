/**
 * Scoring regression suite.
 *
 * Run with `npm run test:scoring`. Every case here exists because a real
 * product produced an indefensible answer at some point. Add a case before
 * changing a threshold, never after.
 */

import { recommendationQualityGate } from '../src/lib/ingrefit/dataQuality';
import { scoreProduct } from '../src/lib/ingrefit/scoring';
import type { AnalysisProfile, DietId, GoalId, ProductFacts } from '../src/lib/ingrefit/types';

const emptyNutrition = {
  energyKcal100g: null, protein100g: null, carbohydrates100g: null, sugars100g: null,
  fat100g: null, saturatedFat100g: null, fiber100g: null, salt100g: null, sodium100g: null, servingSize: null,
};

function product(over: Partial<ProductFacts> = {}): ProductFacts {
  return {
    source: 'openfoodfacts', barcode: '000', name: 'Test', brand: null, quantity: null, imageUrl: null,
    ingredientsText: null, ingredients: [], allergens: [], traces: [], allergenTags: [], traceTags: [],
    additives: [], labels: [], labelTags: [], categories: [],
    ingredientAnalysis: { vegan: null, vegetarian: null, palmOil: null },
    nutrientLevels: { fat: null, saturatedFat: null, sugars: null, salt: null },
    fruitsVegetablesNuts100g: null, nutriScore: null, novaGroup: null, ecoScore: null, organic: false,
    alcoholPercent: null, nutrition: { ...emptyNutrition }, nutritionReference: '100g', nutritionBasis: 'declared',
    completeness: 100, unknownFields: [], ...over,
  };
}

function profile(goals: GoalId[], over: Partial<AnalysisProfile> = {}): AnalysisProfile {
  return { goals, diet: 'none' as DietId, allergens: [], avoidedIngredients: [], ...over };
}

const SALAMI = product({
  name: 'Salami', nutriScore: 'e', novaGroup: 4,
  additives: [{ code: 'e250', name: 'Sodium nitrite', risk: 'high', basis: 'iarc_2a', basisText: '', known: true }],
  nutrition: { ...emptyNutrition, energyKcal100g: 450, sugars100g: 0.5, protein100g: 22, fat100g: 40, saturatedFat100g: 15, fiber100g: 0, salt100g: 4 },
});

const BROCCOLI = product({
  name: 'Broccoli', nutriScore: 'a', novaGroup: 1, fruitsVegetablesNuts100g: 100,
  nutrition: { ...emptyNutrition, energyKcal100g: 34, sugars100g: 1.7, protein100g: 2.8, fat100g: 0.4, saturatedFat100g: 0.1, fiber100g: 2.6, salt100g: 0.03 },
});

const COLA = product({
  name: 'Cola', nutriScore: 'e', novaGroup: 4, nutritionReference: '100ml', categories: ['beverages'],
  additives: [{ code: 'e150d', name: 'Sulphite ammonia caramel', risk: 'moderate', basis: 'iarc_2b', basisText: '', known: true }],
  nutrition: { ...emptyNutrition, energyKcal100g: 42, sugars100g: 10.6, carbohydrates100g: 10.6, protein100g: 0, fat100g: 0, saturatedFat100g: 0, fiber100g: 0, salt100g: 0.01 },
});

const OATS = product({
  name: 'Oats', nutriScore: 'a', novaGroup: 1,
  nutrition: { ...emptyNutrition, energyKcal100g: 370, sugars100g: 1, protein100g: 13, fat100g: 7, saturatedFat100g: 1.2, fiber100g: 10, salt100g: 0.01 },
});


const SERVIVITA_ZERO_SAUCE = product({
  barcode: '8413412209763', name: 'BBQ Sauce Spicy 0%', brand: 'servivita', quantity: '320ml',
  categories: ['condiments', 'sauces', 'barbecue sauces', 'groceries'], nutriScore: 'a',
  nutrition: { ...emptyNutrition, energyKcal100g: 0, protein100g: 0, carbohydrates100g: 0, sugars100g: 0, fat100g: 0, saturatedFat100g: 0, salt100g: 0.2, sodium100g: 0.08 },
  completeness: 65,
});

const PLAIN_WATER = product({
  name: 'Mineral water', categories: ['beverages', 'waters', 'mineral waters'], nutriScore: 'a', nutritionReference: '100ml',
  nutrition: { ...emptyNutrition, energyKcal100g: 0, protein100g: 0, carbohydrates100g: 0, sugars100g: 0, fat100g: 0, saturatedFat100g: 0, salt100g: 0.02 },
  completeness: 65,
});

const ALL_GOALS: GoalId[] = ['balanced', 'weight_loss', 'muscle_gain', 'high_protein', 'low_sugar', 'low_sodium', 'high_fiber', 'minimally_processed', 'heart_health', 'steady_energy', 'digestive_wellness', 'low_saturated_fat'];

interface Case {
  title: string;
  facts: ProductFacts;
  profile: AnalysisProfile;
  expect: (result: ReturnType<typeof scoreProduct>) => string | null;
}

const cases: Case[] = [
  {
    title: 'Salami never reads as a great fit for a protein goal',
    facts: SALAMI, profile: profile(['high_protein', 'low_sugar']),
    expect: (r) => (r.score <= 5 ? null : `expected <= 5, got ${r.score}`),
  },
  {
    title: 'Broccoli stays acceptable even for a protein-focused user',
    facts: BROCCOLI, profile: profile(['high_protein']),
    expect: (r) => (r.score >= 6 ? null : `expected >= 6, got ${r.score}`),
  },
  {
    title: 'Cola is never a good fit, whichever single goal is selected',
    facts: COLA, profile: profile(['low_sodium']),
    expect: (r) => (r.score <= 4 ? null : `expected <= 4, got ${r.score}`),
  },
  {
    title: 'Cola is never a good fit for a heart goal either',
    facts: COLA, profile: profile(['heart_health']),
    expect: (r) => (r.score <= 4 ? null : `expected <= 4, got ${r.score}`),
  },
  {
    title: 'Selecting more goals does not inflate the score',
    facts: OATS, profile: profile(['balanced']),
    expect: (r) => {
      const withAll = scoreProduct(OATS, profile(ALL_GOALS));
      return Math.abs(withAll.score - r.score) <= 1.5
        ? null
        : `1 goal gave ${r.score}, 12 goals gave ${withAll.score}`;
    },
  },
  {
    title: 'Baseline quality is evaluated even with no matching goal data',
    facts: COLA, profile: profile(['muscle_gain']),
    expect: (r) => (r.baseScore <= 4.5 ? null : `expected baseline <= 4.5, got ${r.baseScore}`),
  },
  {
    title: 'A declared allergen blocks the product',
    facts: product({ name: 'Milk chocolate', allergenTags: ['en:milk'], nutriScore: 'e', nutrition: { ...emptyNutrition, sugars100g: 55, protein100g: 6, fat100g: 30, saturatedFat100g: 18, salt100g: 0.2 } }),
    profile: profile(['balanced'], { allergens: ['milk'] }),
    expect: (r) => (r.blocked && r.verdict === 'blocked' ? null : `expected blocked, got ${r.verdict}`),
  },
  {
    title: 'Traces warn without blocking',
    facts: product({ name: 'Cookies', traceTags: ['en:peanuts'], nutriScore: 'd', nutrition: { ...emptyNutrition, sugars100g: 20, protein100g: 6, fat100g: 18, saturatedFat100g: 9, salt100g: 0.5 } }),
    profile: profile(['balanced'], { allergens: ['peanuts'] }),
    expect: (r) => (!r.blocked && r.signals.some((s) => s.code === 'warning.allergen_traces') ? null : 'expected a non-blocking traces warning'),
  },
  {
    title: 'Non-vegan ingredient analysis blocks a vegan profile',
    facts: product({ name: 'Pesto', ingredientAnalysis: { vegan: 'no', vegetarian: 'yes', palmOil: 'no' }, nutriScore: 'c', nutrition: { ...emptyNutrition, sugars100g: 2, protein100g: 5, fat100g: 40, saturatedFat100g: 7, salt100g: 2 } }),
    profile: profile(['balanced'], { diet: 'vegan' }),
    expect: (r) => (r.blocked ? null : 'expected the vegan conflict to block'),
  },
  {
    title: 'Gluten allergen tag blocks a gluten-free profile',
    facts: product({ name: 'Bread', allergenTags: ['en:gluten'], nutriScore: 'b', nutrition: { ...emptyNutrition, sugars100g: 3, protein100g: 9, fat100g: 2, saturatedFat100g: 0.5, fiber100g: 4, salt100g: 1.1 } }),
    profile: profile(['balanced'], { diet: 'gluten_free' }),
    expect: (r) => (r.blocked ? null : 'expected the gluten conflict to block'),
  },
  {
    title: 'A high-risk additive caps the baseline',
    facts: product({
      name: 'Cured ham', nutriScore: 'c', novaGroup: 4,
      additives: [{ code: 'e250', name: 'Sodium nitrite', risk: 'high', basis: 'iarc_2a', basisText: '', known: true }],
      nutrition: { ...emptyNutrition, energyKcal100g: 200, sugars100g: 1, protein100g: 25, fat100g: 10, saturatedFat100g: 4, salt100g: 3.5 },
    }),
    profile: profile(['high_protein']),
    expect: (r) => (r.baseScore <= 4.5 ? null : `expected baseline <= 4.5, got ${r.baseScore}`),
  },
  {
    title: 'Signal impacts add up to the final score (outside the clamp)',
    facts: product({
      name: 'Cookies', nutriScore: 'd', novaGroup: 4,
      nutrition: { ...emptyNutrition, energyKcal100g: 480, sugars100g: 24, protein100g: 6, fat100g: 22, saturatedFat100g: 11, fiber100g: 2.5, salt100g: 0.6 },
    }),
    profile: profile(['high_fiber', 'low_sugar']),
    expect: (r) => {
      if (r.score <= 1 || r.score >= 10) return null;
      const total = r.signals.reduce((sum, signal) => sum + signal.impact, 0);
      const expected = 5.5 + total;
      return Math.abs(expected - r.score) <= 0.35 ? null : `signals sum to ${expected.toFixed(2)} but score is ${r.score}`;
    },
  },
  {
    title: 'A visual estimate is pulled towards neutral',
    facts: product({
      source: 'ai_photo', name: 'Fried chicken', nutritionBasis: 'estimated_visual',
      nutrition: { ...emptyNutrition, energyKcal100g: 300, protein100g: 25, sugars100g: 0, saturatedFat100g: 6, fiber100g: 0, salt100g: 1.8 },
    }),
    profile: profile(['high_protein', 'heart_health']),
    expect: (r) => (r.confidence <= 0.6 ? null : `expected low confidence, got ${r.confidence}`),
  },
  {
    title: 'Sparse all-zero sauce cannot present as a fully trusted 10/10',
    facts: SERVIVITA_ZERO_SAUCE, profile: profile(['low_sugar', 'low_saturated_fat']),
    expect: (r) => (r.confidence <= 0.55 && r.score <= 8 && r.verdict !== 'great'
      ? null
      : `expected confidence <= 0.55, score <= 8 and non-great verdict, got ${r.confidence} / ${r.score} / ${r.verdict}`),
  },
  {
    title: 'Plain water is not treated as a suspicious all-zero food',
    facts: PLAIN_WATER, profile: profile(['low_sugar']),
    expect: (r) => (r.confidence >= 0.9 ? null : `expected water confidence >= 0.9, got ${r.confidence}`),
  },
  {
    title: 'Sparse all-zero sauce is rejected as a recommendation',
    facts: SERVIVITA_ZERO_SAUCE, profile: profile(['balanced']),
    expect: () => (!recommendationQualityGate(SERVIVITA_ZERO_SAUCE, profile(['balanced'])) ? null : 'expected recommendation quality gate to reject'),
  },
  {
    title: 'Ingredient-sensitive profiles reject candidates without composition evidence',
    facts: product({ name: 'Well-labelled nutrition', nutriScore: 'a', nutrition: { ...emptyNutrition, energyKcal100g: 120, protein100g: 6, carbohydrates100g: 15, sugars100g: 3, fat100g: 4, saturatedFat100g: 1, salt100g: 0.3 } }),
    profile: profile(['balanced'], { allergens: ['milk'] }),
    expect: () => {
      const candidate = product({ name: 'Well-labelled nutrition', nutriScore: 'a', nutrition: { ...emptyNutrition, energyKcal100g: 120, protein100g: 6, carbohydrates100g: 15, sugars100g: 3, fat100g: 4, saturatedFat100g: 1, salt100g: 0.3 } });
      return !recommendationQualityGate(candidate, profile(['balanced'], { allergens: ['milk'] })) ? null : 'expected missing ingredients to reject for allergen profile';
    },
  },
  {
    title: 'Alcohol is penalised regardless of goals',
    facts: product({ name: 'Beer', alcoholPercent: 5, nutritionReference: '100ml', categories: ['beverages'], nutrition: { ...emptyNutrition, energyKcal100g: 43, sugars100g: 0.5, carbohydrates100g: 3.6, protein100g: 0.5, salt100g: 0 } }),
    profile: profile(['balanced']),
    expect: (r) => (r.score <= 6 ? null : `expected <= 6, got ${r.score}`),
  },
];

let failures = 0;
for (const testCase of cases) {
  const result = scoreProduct(testCase.facts, testCase.profile);
  const problem = testCase.expect(result);
  if (problem) {
    failures += 1;
    console.error(`FAIL  ${testCase.title}\n      ${problem}`);
  } else {
    console.log(`ok    ${testCase.title}  (${result.score}/10, base ${result.baseScore}, personal ${result.personalDelta})`);
  }
}

if (failures) {
  console.error(`\n${failures} scoring case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} scoring cases passed.`);
