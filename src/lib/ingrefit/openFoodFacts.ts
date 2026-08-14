import type { NutritionFacts, ProductFacts } from './types';

interface OpenFoodFactsProduct {
  code?: string;
  product_name?: string;
  generic_name?: string;
  brands?: string;
  quantity?: string;
  image_front_url?: string;
  image_front_small_url?: string;
  ingredients_text?: string;
  ingredients?: Array<{ text?: string; id?: string }>;
  allergens_tags?: string[];
  traces_tags?: string[];
  additives_tags?: string[];
  labels_tags?: string[];
  categories_tags?: string[];
  nutriscore_grade?: string;
  nutrition_grades?: string;
  nova_group?: number;
  nutriments?: Record<string, unknown>;
  serving_size?: string;
}

interface OpenFoodFactsResponse {
  status?: number | string;
  code?: string;
  product?: OpenFoodFactsProduct;
}

const fields = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'quantity',
  'image_front_url',
  'image_front_small_url',
  'ingredients_text',
  'ingredients',
  'allergens_tags',
  'traces_tags',
  'additives_tags',
  'labels_tags',
  'categories_tags',
  'nutriscore_grade',
  'nutrition_grades',
  'nova_group',
  'nutriments',
  'serving_size',
].join(',');

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/^[a-z]{2}:/i, '').replaceAll('-', ' ').trim())
    .filter(Boolean);
}

function normalizeNutrition(product: OpenFoodFactsProduct): NutritionFacts {
  const nutrients = product.nutriments ?? {};
  return {
    energyKcal100g: number(nutrients['energy-kcal_100g']),
    protein100g: number(nutrients.proteins_100g),
    carbohydrates100g: number(nutrients.carbohydrates_100g),
    sugars100g: number(nutrients.sugars_100g),
    fat100g: number(nutrients.fat_100g),
    saturatedFat100g: number(nutrients['saturated-fat_100g']),
    fiber100g: number(nutrients.fiber_100g),
    salt100g: number(nutrients.salt_100g),
    sodium100g: number(nutrients.sodium_100g),
    servingSize: text(product.serving_size),
  };
}

function computeCompleteness(product: Pick<ProductFacts, 'name' | 'brand' | 'quantity' | 'ingredientsText' | 'nutrition'>): number {
  const fieldsToCheck: unknown[] = [
    product.name,
    product.brand,
    product.quantity,
    product.ingredientsText,
    product.nutrition.energyKcal100g,
    product.nutrition.protein100g,
    product.nutrition.carbohydrates100g,
    product.nutrition.sugars100g,
    product.nutrition.fat100g,
    product.nutrition.saturatedFat100g,
    product.nutrition.fiber100g,
    product.nutrition.salt100g ?? product.nutrition.sodium100g,
  ];
  return Math.round((fieldsToCheck.filter((value) => value !== null && value !== undefined).length / fieldsToCheck.length) * 100);
}

function unknownFields(product: ProductFacts): string[] {
  const missing: string[] = [];
  if (!product.name) missing.push('product name');
  if (!product.brand) missing.push('brand');
  if (!product.ingredientsText) missing.push('ingredients');
  if (product.nutrition.energyKcal100g === null) missing.push('energy');
  if (product.nutrition.protein100g === null) missing.push('protein');
  if (product.nutrition.sugars100g === null) missing.push('sugars');
  if (product.nutrition.salt100g === null && product.nutrition.sodium100g === null) missing.push('salt or sodium');
  return missing;
}

export function hasEnoughFacts(product: ProductFacts): boolean {
  const nutritionCount = Object.entries(product.nutrition)
    .filter(([key]) => key !== 'servingSize')
    .filter(([, value]) => typeof value === 'number').length;
  return Boolean(product.name && (product.ingredientsText || nutritionCount >= 4));
}

export async function findProductByBarcode(barcode: string): Promise<ProductFacts | null> {
  const userAgent = process.env.OPEN_FOOD_FACTS_USER_AGENT;
  if (!userAgent && process.env.NODE_ENV === 'production') {
    throw new Error('OPEN_FOOD_FACTS_USER_AGENT must be configured in production');
  }

  const response = await fetch(
    `https://world.openfoodfacts.org/api/v3/product/${barcode}?fields=${encodeURIComponent(fields)}`,
    {
      headers: { 'User-Agent': userAgent ?? 'IngreFit-Development/1.0 (https://ingrefit.com)' },
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Open Food Facts returned HTTP ${response.status}`);

  const payload = (await response.json()) as OpenFoodFactsResponse;
  if (!payload.product || payload.status === 0 || payload.status === 'failure') return null;
  const raw = payload.product;
  const nutrition = normalizeNutrition(raw);
  const facts: ProductFacts = {
    source: 'openfoodfacts',
    barcode: text(raw.code) ?? text(payload.code) ?? barcode,
    name: text(raw.product_name) ?? text(raw.generic_name),
    brand: text(raw.brands),
    quantity: text(raw.quantity),
    imageUrl: text(raw.image_front_url) ?? text(raw.image_front_small_url),
    ingredientsText: text(raw.ingredients_text),
    ingredients: Array.isArray(raw.ingredients)
      ? raw.ingredients.map((item) => text(item.text) ?? text(item.id)).filter((item): item is string => Boolean(item))
      : [],
    allergens: cleanTags(raw.allergens_tags),
    traces: cleanTags(raw.traces_tags),
    additives: cleanTags(raw.additives_tags),
    labels: cleanTags(raw.labels_tags),
    categories: cleanTags(raw.categories_tags),
    nutriScore: text(raw.nutriscore_grade) ?? text(raw.nutrition_grades),
    novaGroup: number(raw.nova_group),
    nutrition,
    completeness: 0,
    unknownFields: [],
  };
  facts.completeness = computeCompleteness(facts);
  facts.unknownFields = unknownFields(facts);
  return facts;
}
