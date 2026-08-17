import { classifyAdditives } from './additives';
import { additiveBasisText, allergenTagName, catalogLanguage, labelTagName } from './signalCatalog';
import { safeDb } from './db';
import type { IngredientAnalysis, NutrientLevel, NutrientLevels, NutritionFacts, ProductFacts } from './types';

interface OpenFoodFactsProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  product_name_ru?: string;
  generic_name?: string;
  brands?: string;
  quantity?: string;
  image_front_url?: string;
  image_front_small_url?: string;
  ingredients_text?: string;
  ingredients_text_en?: string;
  ingredients_text_ru?: string;
  ingredients?: Array<{ text?: string; id?: string }>;
  allergens_tags?: string[];
  traces_tags?: string[];
  additives_tags?: string[];
  labels_tags?: string[];
  categories_tags?: string[];
  ingredients_analysis_tags?: string[];
  nutrient_levels?: Record<string, string>;
  nutriscore_grade?: string;
  nutrition_grades?: string;
  nova_group?: number;
  ecoscore_grade?: string;
  environmental_score_grade?: string;
  alcohol_by_volume?: number | string;
  alcohol_value?: number | string;
  alcohol_unit?: string;
  nutriments?: Record<string, unknown>;
  serving_size?: string;
  nutrition_data_per?: string;
}

interface OpenFoodFactsResponse {
  status?: number | string;
  code?: string;
  product?: OpenFoodFactsProduct;
}

const FIELDS = [
  'code', 'product_name', 'product_name_en', 'product_name_ru', 'generic_name', 'brands', 'quantity',
  'image_front_url', 'image_front_small_url',
  'ingredients_text', 'ingredients_text_en', 'ingredients_text_ru', 'ingredients',
  'allergens_tags', 'traces_tags', 'additives_tags', 'labels_tags', 'categories_tags',
  'ingredients_analysis_tags', 'nutrient_levels',
  'nutriscore_grade', 'nutrition_grades', 'nova_group', 'ecoscore_grade', 'environmental_score_grade',
  'alcohol_by_volume', 'alcohol_value', 'alcohol_unit',
  'nutriments', 'serving_size', 'nutrition_data_per',
].join(',');

const CACHE_TTL_DAYS = Number(process.env.INGREFIT_PRODUCT_CACHE_DAYS ?? '30');

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 1000) / 1000;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.round(Number(value) * 1000) / 1000;
  return null;
}

/** Keep canonical `en:` tags for matching. */
function canonicalTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

/** Human-readable version of the same tags. */
function displayTags(tags: string[]): string[] {
  return tags.map((tag) => tag.replace(/^[a-z]{2}:/i, '').replaceAll('-', ' ').trim()).filter(Boolean);
}

function nutrientLevel(value: unknown): NutrientLevel | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'low' || normalized === 'moderate' || normalized === 'high' ? normalized : null;
}

function readNutrientLevels(product: OpenFoodFactsProduct): NutrientLevels {
  const levels = product.nutrient_levels ?? {};
  return {
    fat: nutrientLevel(levels.fat),
    saturatedFat: nutrientLevel(levels['saturated-fat']),
    sugars: nutrientLevel(levels.sugars),
    salt: nutrientLevel(levels.salt),
  };
}

function analysisValue(tags: string[], subject: 'vegan' | 'vegetarian' | 'palm-oil'): IngredientAnalysis['vegan'] {
  if (subject === 'palm-oil') {
    if (tags.includes('en:palm-oil')) return 'yes';
    if (tags.includes('en:palm-oil-free')) return 'no';
    if (tags.includes('en:may-contain-palm-oil') || tags.includes('en:palm-oil-content-unknown')) return 'maybe';
    return null;
  }
  if (tags.includes(`en:${subject}`)) return 'yes';
  if (tags.includes(`en:non-${subject}`)) return 'no';
  if (tags.includes(`en:maybe-${subject}`) || tags.includes(`en:${subject}-status-unknown`)) return 'maybe';
  return null;
}

function extractAlcoholPercent(product: OpenFoodFactsProduct): number | null {
  const direct = number(product.alcohol_by_volume) ?? number(product.nutriments?.alcohol_100g);
  if (direct !== null) return direct;
  const alcoholValue = number(product.alcohol_value);
  if (alcoholValue !== null && /%|vol/i.test(product.alcohol_unit ?? '')) return alcoholValue;
  const searchable = [product.ingredients_text, product.ingredients_text_en, product.ingredients_text_ru, ...(product.labels_tags ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const contextual = searchable.match(/(?:alc(?:ohol)?\.?|алк(?:оголь)?\.?)\s*[:/]?\s*(\d+(?:[.,]\d+)?)\s*%|(?:\b(\d+(?:[.,]\d+)?)\s*%\s*(?:vol|об\.?))/i);
  return number((contextual?.[1] ?? contextual?.[2])?.replace(',', '.'));
}

function structuredIngredients(product: OpenFoodFactsProduct): string[] {
  if (!Array.isArray(product.ingredients)) return [];
  return product.ingredients
    .map((item) => text(item.text) ?? text(item.id)?.replace(/^[a-z]{2}:/i, '').replaceAll('-', ' ') ?? null)
    .filter((item): item is string => Boolean(item));
}

export function hasContaminatedIngredients(value: string | null): boolean {
  if (!value) return false;
  return value.length > 1_200 || /(?:https?:\/\/|www\.|\b(?:infoline|distributor|recommended retail price|best before|consumir preferentemente|produced by|manufactured by)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test(value);
}

export function nutritionFieldCount(product: ProductFacts): number {
  return Object.entries(product.nutrition)
    .filter(([key]) => key !== 'servingSize')
    .filter(([, value]) => typeof value === 'number').length;
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

export function computeCompleteness(product: Pick<ProductFacts, 'name' | 'brand' | 'quantity' | 'ingredientsText' | 'nutrition'>): number {
  const fieldsToCheck: unknown[] = [
    product.name, product.brand, product.quantity, product.ingredientsText,
    product.nutrition.energyKcal100g, product.nutrition.protein100g, product.nutrition.carbohydrates100g,
    product.nutrition.sugars100g, product.nutrition.fat100g, product.nutrition.saturatedFat100g,
    product.nutrition.fiber100g, product.nutrition.salt100g ?? product.nutrition.sodium100g,
  ];
  return Math.round((fieldsToCheck.filter((value) => value !== null && value !== undefined).length / fieldsToCheck.length) * 100);
}

export function unknownFields(product: ProductFacts): string[] {
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
  // An ingredient string alone cannot support weight, protein, sugar, salt or
  // heart-related goals. Do not turn a sparse database record into a neutral
  // result: require an identifiable product and a useful nutrient set.
  return Boolean(product.name && nutritionFieldCount(product) >= 4);
}

/** Localized display strings are derived per request; facts themselves are cached once. */
function toFacts(raw: OpenFoodFactsProduct, barcode: string, locale: string): ProductFacts {
  const language = locale.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  const localizedName = language === 'ru' ? raw.product_name_ru : raw.product_name_en;
  const localizedIngredients = language === 'ru' ? raw.ingredients_text_ru : raw.ingredients_text_en;
  const nutrition = normalizeNutrition(raw);
  const ingredientItems = structuredIngredients(raw);
  const rawIngredientsText = text(localizedIngredients) ?? text(raw.ingredients_text);
  const cleanIngredientsText = hasContaminatedIngredients(rawIngredientsText) && ingredientItems.length >= 2
    ? ingredientItems.join(', ')
    : rawIngredientsText;

  const allergenTags = canonicalTags(raw.allergens_tags);
  const traceTags = canonicalTags(raw.traces_tags);
  const labelTags = canonicalTags(raw.labels_tags);
  const analysisTags = canonicalTags(raw.ingredients_analysis_tags);
  const additives = classifyAdditives(canonicalTags(raw.additives_tags)).map((additive) => ({
    code: additive.code,
    name: language === 'ru' ? additive.nameRu : additive.nameEn,
    risk: additive.risk,
    basis: additive.basis,
    basisText: additiveBasisText(additive.basis, catalogLanguage(locale)),
    known: additive.known,
  }));

  const facts: ProductFacts = {
    source: 'openfoodfacts',
    barcode: text(raw.code) ?? barcode,
    name: text(localizedName) ?? text(raw.product_name) ?? text(raw.generic_name),
    brand: text(raw.brands),
    quantity: text(raw.quantity),
    imageUrl: text(raw.image_front_url) ?? text(raw.image_front_small_url),
    ingredientsText: cleanIngredientsText,
    ingredients: ingredientItems,
    // Display names come from the catalog, not from stripping the tag prefix:
    // `en:eggs` must read "яйца" for a Russian user even when no translation
    // call happens (which is the normal case for a Russian-language product).
    allergens: allergenTags.map((tag) => allergenTagName(tag, catalogLanguage(locale))),
    traces: traceTags.map((tag) => allergenTagName(tag, catalogLanguage(locale))),
    allergenTags,
    traceTags,
    additives,
    labels: labelTags.map((tag) => labelTagName(tag, catalogLanguage(locale))),
    labelTags,
    categories: displayTags(canonicalTags(raw.categories_tags)),
    ingredientAnalysis: {
      vegan: analysisValue(analysisTags, 'vegan'),
      vegetarian: analysisValue(analysisTags, 'vegetarian'),
      palmOil: analysisValue(analysisTags, 'palm-oil'),
    },
    nutrientLevels: readNutrientLevels(raw),
    fruitsVegetablesNuts100g:
      number(raw.nutriments?.['fruits-vegetables-nuts-estimate-from-ingredients_100g']) ??
      number(raw.nutriments?.['fruits-vegetables-nuts_100g']),
    nutriScore: text(raw.nutriscore_grade) ?? text(raw.nutrition_grades),
    novaGroup: number(raw.nova_group),
    ecoScore: text(raw.environmental_score_grade) ?? text(raw.ecoscore_grade),
    organic: labelTags.some((tag) => tag.includes('organic') || tag.includes('bio')),
    alcoholPercent: extractAlcoholPercent(raw),
    nutrition,
    nutritionReference: raw.nutrition_data_per?.toLowerCase() === '100ml' ? '100ml' : '100g',
    nutritionBasis: 'declared',
    completeness: 0,
    unknownFields: [],
  };
  facts.completeness = computeCompleteness(facts);
  facts.unknownFields = unknownFields(facts);
  return facts;
}

/**
 * Optional local mirror. When the full Open Food Facts dataset has been
 * imported (see docs/DATABASE.md) barcode lookups are answered from our own
 * PostgreSQL instance, so the upstream rate limit stops being a runtime risk
 * and cold-cache scans stop costing a network round trip.
 */
async function readLocalDataset(barcode: string): Promise<OpenFoodFactsProduct | null> {
  if (process.env.OPEN_FOOD_FACTS_LOCAL !== 'true') return null;
  const row = await safeDb((db) => db.offProduct.findUnique({ where: { barcode } }));
  return row ? (row.data as OpenFoodFactsProduct) : null;
}

async function readCachedRaw(barcode: string): Promise<OpenFoodFactsProduct | null> {
  const row = await safeDb((db) => db.productCache.findUnique({ where: { barcode } }));
  if (!row) return null;
  const ageDays = (Date.now() - new Date(row.refreshedAt).getTime()) / 86_400_000;
  if (ageDays > CACHE_TTL_DAYS) return null;
  return row.facts as OpenFoodFactsProduct;
}

async function writeCachedRaw(barcode: string, raw: OpenFoodFactsProduct): Promise<void> {
  // Round-trip through JSON before storing. This both satisfies Prisma's Json
  // input type and guarantees the value is plain JSON: the upstream payload can
  // carry `undefined` entries that would otherwise be silently dropped or
  // rejected at the driver level.
  const facts = JSON.parse(JSON.stringify(raw));
  await safeDb((db) =>
    db.productCache.upsert({
      where: { barcode },
      create: { barcode, facts },
      update: { facts },
    }),
  );
}

/**
 * Barcode lookup with a database cache in front of Open Food Facts.
 *
 * Open Food Facts rate-limits product reads per IP address, and every request
 * from this backend shares one IP. The cache is therefore not only a cost
 * optimization, it is what keeps the server from being throttled or banned.
 */
export async function findProductByBarcode(barcode: string, locale = 'en'): Promise<ProductFacts | null> {
  const cached = await readCachedRaw(barcode);
  if (cached) return toFacts(cached, barcode, locale);

  const local = await readLocalDataset(barcode);
  if (local) return toFacts(local, barcode, locale);

  // With a complete local mirror, a miss is a genuine "product not in the
  // dataset" answer. Falling through to the network would only reintroduce the
  // rate limit for barcodes we already know are absent.
  if (process.env.OPEN_FOOD_FACTS_LOCAL === 'true' && process.env.OPEN_FOOD_FACTS_LOCAL_ONLY === 'true') {
    return null;
  }

  const userAgent = process.env.OPEN_FOOD_FACTS_USER_AGENT;
  if (!userAgent && process.env.NODE_ENV === 'production') {
    throw new Error('OPEN_FOOD_FACTS_USER_AGENT must be configured in production');
  }
  const base = (process.env.OPEN_FOOD_FACTS_BASE_URL ?? 'https://world.openfoodfacts.org').replace(/\/$/, '');

  const response = await fetch(`${base}/api/v3/product/${barcode}?fields=${encodeURIComponent(FIELDS)}`, {
    headers: { 'User-Agent': userAgent ?? 'IngreFit-Development/1.0 (https://ingrefit.com)' },
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 404) return null;
  if (response.status === 429) throw new Error('Open Food Facts rate limit reached');
  if (!response.ok) throw new Error(`Open Food Facts returned HTTP ${response.status}`);

  const payload = (await response.json()) as OpenFoodFactsResponse;
  if (!payload.product || payload.status === 0 || payload.status === 'failure') return null;

  await writeCachedRaw(barcode, payload.product);
  return toFacts(payload.product, barcode, locale);
}
