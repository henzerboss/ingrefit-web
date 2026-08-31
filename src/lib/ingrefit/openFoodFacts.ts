import { classifyAdditives } from './additives';
import { additiveName } from './catalog';
import { additiveBasisText, allergenTagName, catalogLanguage, labelTagName } from './signalCatalog';
import { safeDb } from './db';
import { LOCALE_CODES } from '@/i18n/locales';
import type { IngredientAnalysis, NutrientLevel, NutrientLevels, NutritionFacts, ProductFacts } from './types';

export interface OpenFoodFactsProduct {
  /**
   * Open Food Facts publishes one `product_name_<lang>` and one
   * `ingredients_text_<lang>` per language actually printed on the package.
   * Those are read dynamically for all supported locales, so the type has to
   * admit keys that are not known statically.
   */
  [key: `product_name_${string}`]: string | undefined;
  [key: `ingredients_text_${string}`]: string | undefined;
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
  /** Coarser grouping, used when categories_tags is absent. */
  food_groups_tags?: string[];
  countries_tags?: string[];
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
  nutrition_data_prepared_per?: string;
  product_quantity?: number | string;
  product_quantity_unit?: string;
}

interface OpenFoodFactsResponse {
  status?: number | string;
  code?: string;
  product?: OpenFoodFactsProduct;
}

/**
 * Open Food Facts language codes we ask for.
 *
 * Derived from the locales the app ships, minus the ones whose OFF code differs
 * from ours. Asking for a language OFF does not know is harmless — the field is
 * simply absent from the response.
 */
const OFF_LANGUAGES = LOCALE_CODES.filter((code) => code !== 'fil');

// Asking for every language makes the query string about 2.6 KB, which is well
// inside the 8 KB header buffer Open Food Facts' nginx allows. It is requested
// for all languages rather than only the caller's because one fetch populates
// ProductCache for every user of that barcode: narrowing the request would save
// a little bandwidth once and cost a translation call for the next user in a
// different language.

const FIELDS = [
  'code',
  'product_name',
  ...OFF_LANGUAGES.map((code) => `product_name_${code}`),
  'generic_name',
  'brands',
  'quantity',
  'image_front_url',
  'image_front_small_url',
  'ingredients_text',
  ...OFF_LANGUAGES.map((code) => `ingredients_text_${code}`),
  'ingredients',
  'allergens_tags',
  'traces_tags',
  'additives_tags',
  'labels_tags',
  'categories_tags',
  'food_groups_tags',
  'countries_tags',
  'ingredients_analysis_tags',
  'nutrient_levels',
  'nutriscore_grade',
  'nutrition_grades',
  'nova_group',
  'ecoscore_grade',
  'environmental_score_grade',
  'alcohol_by_volume',
  'alcohol_value',
  'alcohol_unit',
  'nutriments',
  'serving_size',
  'nutrition_data_per',
  'nutrition_data_prepared_per',
  'product_quantity',
  'product_quantity_unit',
].join(',');

const CACHE_TTL_DAYS = Number(process.env.INGREFIT_PRODUCT_CACHE_DAYS ?? '30');

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 1000) / 1000;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
    return Math.round(Number(value) * 1000) / 1000;
  return null;
}

/** Keep canonical `en:` tags for matching. */
function canonicalTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/** Human-readable version of the same tags. */
function displayTags(tags: string[]): string[] {
  return tags
    .map((tag) =>
      tag
        .replace(/^[a-z]{2}:/i, '')
        .replaceAll('-', ' ')
        .trim(),
    )
    .filter(Boolean);
}

/**
 * Category tags, with `food_groups_tags` as a fallback.
 *
 * Fewer than half of the records in the full export carry `categories_tags`,
 * and without them a product cannot be compared to anything — the user sees an
 * empty alternatives block for a product that is otherwise fully described.
 *
 * `food_groups_tags` is Open Food Facts' own coarser grouping and is populated
 * for a different, overlapping set of records. It is deliberately used only as
 * a fallback: it is broad enough that matching on it alone would pair loosely
 * related products, so the ranker's parent-tag weighting keeps such matches far
 * below a real category match.
 */
export function categoryTagsFromRaw(product: OpenFoodFactsProduct): string[] {
  const categories = canonicalTags(product.categories_tags);
  if (categories.length) return categories;
  return canonicalTags(product.food_groups_tags);
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
  const searchable = [
    product.ingredients_text,
    product.ingredients_text_en,
    product.ingredients_text_ru,
    ...(product.labels_tags ?? []),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const contextual = searchable.match(
    /(?:alc(?:ohol)?\.?|алк(?:оголь)?\.?)\s*[:/]?\s*(\d+(?:[.,]\d+)?)\s*%|(?:\b(\d+(?:[.,]\d+)?)\s*%\s*(?:vol|об\.?))/i,
  );
  return number((contextual?.[1] ?? contextual?.[2])?.replace(',', '.'));
}

function structuredIngredients(product: OpenFoodFactsProduct): string[] {
  if (!Array.isArray(product.ingredients)) return [];
  return product.ingredients
    .map(
      (item) =>
        text(item.text) ??
        text(item.id)
          ?.replace(/^[a-z]{2}:/i, '')
          .replaceAll('-', ' ') ??
        null,
    )
    .filter((item): item is string => Boolean(item));
}

export function hasContaminatedIngredients(value: string | null): boolean {
  if (!value) return false;
  return (
    value.length > 1_200 ||
    /(?:https?:\/\/|www\.|\b(?:infoline|distributor|recommended retail price|best before|consumir preferentemente|produced by|manufactured by)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test(
      value,
    )
  );
}

export function nutritionFieldCount(product: ProductFacts): number {
  // Salt and sodium describe the same underlying fact and must not count twice.
  const values: unknown[] = [
    product.nutrition.energyKcal100g,
    product.nutrition.protein100g,
    product.nutrition.carbohydrates100g,
    product.nutrition.sugars100g,
    product.nutrition.fat100g,
    product.nutrition.saturatedFat100g,
    product.nutrition.fiber100g,
    product.nutrition.salt100g ?? product.nutrition.sodium100g,
  ];
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value)).length;
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

export function computeCompleteness(
  product: Pick<ProductFacts, 'name' | 'brand' | 'quantity' | 'ingredientsText' | 'ingredients' | 'nutrition'>,
): number {
  // Completeness is intentionally weighted by usefulness. A product name and
  // brand should not compensate for a missing ingredient list, and salt/sodium
  // represent one fact rather than two. Total weight is exactly 10.
  const weighted: Array<[unknown, number]> = [
    [product.name, 0.5],
    [product.brand, 0.25],
    [product.quantity, 0.25],
    [product.ingredientsText || product.ingredients.length > 0 ? true : null, 3],
    [product.nutrition.energyKcal100g, 1],
    [product.nutrition.protein100g, 0.8],
    [product.nutrition.carbohydrates100g, 0.8],
    [product.nutrition.sugars100g, 0.8],
    [product.nutrition.fat100g, 0.8],
    [product.nutrition.saturatedFat100g, 0.8],
    [product.nutrition.fiber100g, 0.5],
    [product.nutrition.salt100g ?? product.nutrition.sodium100g, 0.5],
  ];
  const available = weighted.reduce(
    (sum, [value, weight]) => sum + (value !== null && value !== undefined ? weight : 0),
    0,
  );
  return Math.round((available / 10) * 100);
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
  return Boolean(product.name && hasEnoughNutritionFacts(product));
}

/**
 * The nutrient half of `hasEnoughFacts`, without the name requirement.
 *
 * A name is needed to *show* a product, which is why candidates and analysis
 * results must have one. It is not needed to *compare against* one: the user is
 * holding the package and already knows what it is.
 *
 * Open Food Facts carries plenty of records with a full nutrition panel and an
 * empty `product_name` — barcode 7622210114730 is one. Analysis handled those
 * fine because Premium enrichment fills the name in, but the recommendation
 * endpoint reads the record directly and rejected them as `sparse_source`,
 * so the same product was scoreable and yet had no alternatives.
 */
export function hasEnoughNutritionFacts(product: ProductFacts): boolean {
  return nutritionFieldCount(product) >= 4;
}

/** Localized display strings are derived per request; facts themselves are cached once. */
export function productFactsFromRaw(raw: OpenFoodFactsProduct, barcode: string, locale: string): ProductFacts {
  // Prefer the user's own language, then English, then whatever the record's
  // default field holds.
  //
  // This used to be `startsWith('ru') ? 'ru' : 'en'`, so a Spanish user got the
  // English name even when product_name_es sat in the same record. Every
  // non-Russian, non-English user was shown foreign text on the free tier and
  // had a Gemini translation bought for them on Premium — for a string the
  // database already had.
  // Fallback order is target language, then the record's default field, then
  // English — and that middle step matters.
  //
  // Open Food Facts usually copies the default text into the field for the
  // package's own language, and the importer drops those exact duplicates to
  // keep the mirror small. So for a Spanish product `ingredients_text_es` is
  // often absent while `ingredients_text` holds the Spanish text. Reaching for
  // English before the default would hand a Spanish user an English list and
  // then buy a translation back into Spanish.
  const language = catalogLanguage(locale);
  const localizedName = text(raw[`product_name_${language}`]) ?? text(raw.product_name) ?? text(raw.product_name_en);
  const localizedIngredients =
    text(raw[`ingredients_text_${language}`]) ?? text(raw.ingredients_text) ?? text(raw.ingredients_text_en);
  const nutrition = normalizeNutrition(raw);
  const ingredientItems = structuredIngredients(raw);
  const rawIngredientsText = localizedIngredients;
  const cleanIngredientsText =
    hasContaminatedIngredients(rawIngredientsText) && ingredientItems.length >= 2
      ? ingredientItems.join(', ')
      : rawIngredientsText;

  const allergenTags = canonicalTags(raw.allergens_tags);
  const traceTags = canonicalTags(raw.traces_tags);
  const labelTags = canonicalTags(raw.labels_tags);
  const analysisTags = canonicalTags(raw.ingredients_analysis_tags);
  const catalog = catalogLanguage(locale);
  const additives = classifyAdditives(canonicalTags(raw.additives_tags)).map((additive) => ({
    code: additive.code,
    name: additiveName(additive.code, catalog),
    risk: additive.risk,
    basis: additive.basis,
    basisText: additiveBasisText(additive.basis, catalog),
    known: additive.known,
  }));

  const facts: ProductFacts = {
    source: 'openfoodfacts',
    barcode: text(raw.code) ?? barcode,
    name: localizedName ?? text(raw.generic_name),
    brand: text(raw.brands),
    quantity: text(raw.quantity),
    // The app renders product artwork at <=82 px and persists a 256 px thumbnail.
    // Prefer OFF's 200 px derivative so even the one-time network transfer stays small.
    imageUrl: text(raw.image_front_small_url) ?? text(raw.image_front_url),
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

/**
 * PostgreSQL rejects U+0000 inside jsonb, and the Open Food Facts corpus does
 * contain stray NUL bytes in free-text fields. The importer has always stripped
 * them; the network path now requests ninety-eight more text fields, so it needs
 * the same guard rather than relying on never having hit one.
 */
function stripNul<T>(value: T): T {
  if (typeof value === 'string') {
    return (value.includes('\u0000') ? value.replaceAll('\u0000', '') : value) as T;
  }
  if (Array.isArray(value)) return value.map(stripNul) as T;
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[stripNul(key)] = stripNul(nested);
    }
    return output as T;
  }
  return value;
}

async function writeCachedRaw(barcode: string, raw: OpenFoodFactsProduct): Promise<void> {
  // Round-trip through JSON before storing. This both satisfies Prisma's Json
  // input type and guarantees the value is plain JSON: the upstream payload can
  // carry `undefined` entries that would otherwise be silently dropped or
  // rejected at the driver level.
  const facts = stripNul(JSON.parse(JSON.stringify(raw)));
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
/**
 * Where a product's facts came from. Reported so the mirror can be verified in
 * production without guessing from timing or side effects.
 *
 *   cache       our ProductCache row, written by an earlier network response
 *   mirror      the imported Open Food Facts dataset, usable as-is
 *   mirror_thin the mirror row was too sparse to score and was used only
 *               because LOCAL_ONLY is set or the network failed
 *   network     a live call to the Open Food Facts API
 */
export type FactsOrigin = 'cache' | 'mirror' | 'mirror_thin' | 'network';

export interface FactsLookup {
  facts: ProductFacts | null;
  origin: FactsOrigin | null;
}

export async function findProductByBarcode(barcode: string, locale = 'en'): Promise<FactsLookup> {
  const cached = await readCachedRaw(barcode);
  if (cached) return { facts: productFactsFromRaw(cached, barcode, locale), origin: 'cache' };

  const localOnly = process.env.OPEN_FOOD_FACTS_LOCAL_ONLY === 'true';
  const local = await readLocalDataset(barcode);
  let localFacts: ProductFacts | null = null;
  if (local) {
    localFacts = productFactsFromRaw(local, barcode, locale);
    // A mirror row can be present but thin: the published exports contain
    // records whose nutriments object is empty even though the API serves full
    // values for the same barcode. Treating such a row as authoritative turned
    // every scan into "insufficient data", so an unusable local record counts as
    // a miss and the request falls through to the API. The thin record is still
    // kept as a last resort if the network then fails.
    if (hasEnoughFacts(localFacts)) return { facts: localFacts, origin: 'mirror' };
    if (localOnly) return { facts: localFacts, origin: 'mirror_thin' };
  }

  // With a complete local mirror, a miss is a genuine "product not in the
  // dataset" answer. Falling through to the network would only reintroduce the
  // rate limit for barcodes we already know are absent.
  if (process.env.OPEN_FOOD_FACTS_LOCAL === 'true' && localOnly) {
    return { facts: null, origin: null };
  }

  const userAgent = process.env.OPEN_FOOD_FACTS_USER_AGENT;
  if (!userAgent && process.env.NODE_ENV === 'production') {
    throw new Error('OPEN_FOOD_FACTS_USER_AGENT must be configured in production');
  }
  const base = (process.env.OPEN_FOOD_FACTS_BASE_URL ?? 'https://world.openfoodfacts.org').replace(/\/$/, '');

  let response: Response;
  try {
    response = await fetch(`${base}/api/v3/product/${barcode}?fields=${encodeURIComponent(FIELDS)}`, {
      headers: { 'User-Agent': userAgent ?? 'IngreFit-Development/1.0 (https://ingrefit.com)' },
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    if (localFacts) return { facts: localFacts, origin: 'mirror_thin' };
    throw error;
  }

  if (response.status === 404) return { facts: localFacts, origin: localFacts ? 'mirror_thin' : null };
  if (!response.ok) {
    if (localFacts) return { facts: localFacts, origin: 'mirror_thin' };
    if (response.status === 429) throw new Error('Open Food Facts rate limit reached');
    throw new Error(`Open Food Facts returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as OpenFoodFactsResponse;
  if (!payload.product || payload.status === 0 || payload.status === 'failure') {
    return { facts: localFacts, origin: localFacts ? 'mirror_thin' : null };
  }

  await writeCachedRaw(barcode, payload.product);
  return { facts: productFactsFromRaw(payload.product, barcode, locale), origin: 'network' };
}
