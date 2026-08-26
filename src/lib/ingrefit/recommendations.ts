import { Prisma } from '@prisma/client';

import { safeDb } from './db';
import {
  categoryTagsFromRaw,
  hasEnoughFacts,
  productFactsFromRaw,
  type OpenFoodFactsProduct,
} from './openFoodFacts';
import { scoreProduct } from './scoring';
import type { AnalysisProfile, ProductFacts } from './types';

interface RawProductRow {
  barcode: string;
  data: unknown;
}

export interface ProductRecommendation {
  product: Pick<ProductFacts, 'source' | 'barcode' | 'name' | 'brand' | 'quantity' | 'imageUrl'>;
  score: number;
  baseScore: number;
  delta: number;
}

const MAX_RECOMMENDATIONS = 3;
const MIN_SCORE_GAIN = 0.7;
const MIN_BASE_GAIN = 0.3;
const MIN_CONFIDENCE = 0.55;
const WORLD_MARKET_TAG = 'en:world';

const COUNTRY_TAG_OVERRIDES: Record<string, string> = {
  CI: 'en:ivory-coast',
  CD: 'en:democratic-republic-of-the-congo',
  CG: 'en:republic-of-the-congo',
  CZ: 'en:czech-republic',
  LA: 'en:laos',
  KR: 'en:south-korea',
  KP: 'en:north-korea',
  MD: 'en:moldova',
  RU: 'en:russia',
  SY: 'en:syria',
  TW: 'en:taiwan',
  TZ: 'en:tanzania',
  TR: 'en:turkey',
  US: 'en:united-states',
  VE: 'en:venezuela',
  VN: 'en:vietnam',
};

function marketTagForCountry(countryCode?: string | null): string | null {
  const code = countryCode?.trim().toUpperCase() ?? '';
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const override = COUNTRY_TAG_OVERRIDES[code];
  if (override) return override;
  const label = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
  if (!label || label === code) return null;
  const slug = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `en:${slug}` : null;
}

function hasMarketAvailability(raw: OpenFoodFactsProduct, marketTag: string): boolean {
  const tags = Array.isArray(raw.countries_tags)
    ? new Set(raw.countries_tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim().toLowerCase()))
    : new Set<string>();
  return tags.has(marketTag) || tags.has(WORLD_MARKET_TAG);
}

// These tags describe aisles rather than product types. Matching on one of them
// would allow exactly the bad recommendations we want to prevent (for example,
// milk to an unrelated dairy product or chips to another generic snack).
const BROAD_CATEGORY_TAGS = new Set([
  'en:foods',
  'en:beverages',
  'en:groceries',
  'en:snacks',
  'en:sweet-snacks',
  'en:salty-snacks',
  'en:desserts',
  'en:breakfasts',
  'en:dairies',
  'en:plant-based-foods',
  'en:plant-based-foods-and-beverages',
  'en:frozen-foods',
  'en:canned-foods',
  'en:fresh-foods',
  'en:meals',
  'en:prepared-meals',
  'en:spreads',
  'en:sauces',
  'en:condiments',
  'en:confectioneries',
  'en:cereals-and-potatoes',
  'en:biscuits-and-cakes',
  'en:chips-and-fries',
  'en:bread-and-bakery-products',
]);

function normalizeIdentity(value: string | null): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** OFF emits category tags from broad to specific in normal product records. */
function focusCategoryTags(raw: OpenFoodFactsProduct): string[] {
  const tags = categoryTagsFromRaw(raw);
  const specific = [...tags]
    .reverse()
    .filter((tag) => tag.startsWith('en:') && !BROAD_CATEGORY_TAGS.has(tag));
  return [...new Set(specific)].slice(0, 4);
}

async function readSourceRaw(barcode: string): Promise<OpenFoodFactsProduct | null> {
  return safeDb(async (db) => {
    // Follow the same precedence as barcode analysis: a recent network/cache
    // record wins, and the local mirror is consulted only when it is enabled.
    const cached = await db.productCache.findUnique({ where: { barcode }, select: { facts: true } });
    if (cached) return cached.facts as unknown as OpenFoodFactsProduct;
    if (process.env.OPEN_FOOD_FACTS_LOCAL !== 'true') return null;
    const local = await db.offProduct.findUnique({ where: { barcode }, select: { data: true } });
    return local ? local.data as unknown as OpenFoodFactsProduct : null;
  });
}

async function recentCachedCandidates(barcode: string): Promise<RawProductRow[]> {
  return (await safeDb((db) => db.productCache.findMany({
    where: { barcode: { not: barcode } },
    orderBy: { refreshedAt: 'desc' },
    take: 400,
    select: { barcode: true, facts: true },
  }).then((rows) => rows.map((row) => ({ barcode: row.barcode, data: row.facts }))))) ?? [];
}

async function recommendationIndexesReady(): Promise<boolean> {
  const rows = await safeDb((db) => db.$queryRaw<Array<{ categories: string | null; countries: string | null }>>`
    SELECT
      to_regclass('public.off_product_categories_tags_gin')::text AS categories,
      to_regclass('public.off_product_countries_tags_gin')::text AS countries
  `);
  return Boolean(rows?.[0]?.categories && rows?.[0]?.countries);
}

async function mirrorCandidates(barcode: string, focusTags: string[], marketTag: string): Promise<RawProductRow[]> {
  if (process.env.OPEN_FOOD_FACTS_LOCAL !== 'true' || !focusTags.length || !(await recommendationIndexesReady())) return [];

  const found = new Map<string, RawProductRow>();
  // Query the most specific tag first. Each query is backed by the expression
  // GIN index from scripts/add-recommendation-index.sql and is capped tightly.
  for (const tag of focusTags.slice(0, 3)) {
    const tagJson = JSON.stringify([tag]);
    const marketJson = JSON.stringify([marketTag]);
    const worldJson = JSON.stringify([WORLD_MARKET_TAG]);
    const rows = await safeDb((db) => db.$queryRaw<RawProductRow[]>(Prisma.sql`
      SELECT barcode, data
      FROM "OffProduct"
      WHERE barcode <> ${barcode}
        AND (data->'categories_tags') @> ${tagJson}::jsonb
        AND ((data->'countries_tags') @> ${marketJson}::jsonb OR (data->'countries_tags') @> ${worldJson}::jsonb)
        AND COALESCE(data->>'product_name', data->>'product_name_en', data->>'generic_name', '') <> ''
      LIMIT 100
    `));
    for (const row of rows ?? []) found.set(row.barcode, row);
    if (found.size >= 140) break;
  }
  return [...found.values()];
}

function categorySimilarity(sourceTags: string[], focusTags: string[], candidateRaw: OpenFoodFactsProduct): number {
  const candidateTags = new Set(categoryTagsFromRaw(candidateRaw));
  // At least one *specific* exact OFF category is mandatory. This hard gate is
  // what prevents cross-category suggestions even when nutrition looks alike.
  if (!focusTags.some((tag) => candidateTags.has(tag))) return 0;

  let similarity = 0;
  focusTags.forEach((tag, index) => {
    if (candidateTags.has(tag)) similarity += Math.max(1, 5 - index);
  });
  for (const tag of sourceTags) if (candidateTags.has(tag)) similarity += 0.1;
  return similarity;
}

export async function findHealthierRecommendations(input: {
  barcode: string;
  locale: string;
  marketCountry?: string;
  profile: AnalysisProfile;
}): Promise<ProductRecommendation[]> {
  const marketTag = marketTagForCountry(input.marketCountry);
  if (!marketTag) return [];

  const sourceRaw = await readSourceRaw(input.barcode);
  if (!sourceRaw) return [];

  const sourceTags = categoryTagsFromRaw(sourceRaw);
  const focusTags = focusCategoryTags(sourceRaw);
  if (!focusTags.length) return [];

  const sourceFacts = productFactsFromRaw(sourceRaw, input.barcode, input.locale);
  if (!hasEnoughFacts(sourceFacts)) return [];
  const sourceScore = scoreProduct(sourceFacts, input.profile);

  const pool = new Map<string, RawProductRow>();
  for (const row of await recentCachedCandidates(input.barcode)) pool.set(row.barcode, row);
  for (const row of await mirrorCandidates(input.barcode, focusTags, marketTag)) pool.set(row.barcode, row);

  const ranked: Array<{ product: ProductFacts; score: number; baseScore: number; delta: number; similarity: number }> = [];
  const seenIdentities = new Set<string>();
  for (const row of pool.values()) {
    const raw = row.data as OpenFoodFactsProduct;
    // Unknown market is treated as unavailable. This intentionally prefers an
    // empty recommendation block over suggesting a product the user may not be
    // able to buy in their country.
    if (!hasMarketAvailability(raw, marketTag)) continue;
    const similarity = categorySimilarity(sourceTags, focusTags, raw);
    if (!similarity) continue;

    const product = productFactsFromRaw(raw, row.barcode, input.locale);
    if (!hasEnoughFacts(product)) continue;
    const scored = scoreProduct(product, input.profile);
    if (scored.blocked || scored.confidence < MIN_CONFIDENCE) continue;

    const delta = Math.round((scored.score - sourceScore.score) * 10) / 10;
    const baseGain = scored.baseScore - sourceScore.baseScore;
    if (sourceScore.blocked) {
      if (delta < 1 || scored.score < 4.5) continue;
    } else if (delta < MIN_SCORE_GAIN || baseGain < MIN_BASE_GAIN) {
      continue;
    }

    const identity = `${normalizeIdentity(product.brand)}|${normalizeIdentity(product.name)}`;
    if (!identity || seenIdentities.has(identity)) continue;
    seenIdentities.add(identity);
    ranked.push({ product, score: scored.score, baseScore: scored.baseScore, delta, similarity });
  }

  ranked.sort((a, b) => b.similarity - a.similarity || b.score - a.score || b.delta - a.delta);
  return ranked.slice(0, MAX_RECOMMENDATIONS).map(({ product, score, baseScore, delta }) => ({
    product: {
      source: product.source,
      barcode: product.barcode,
      name: product.name,
      brand: product.brand,
      quantity: product.quantity,
      imageUrl: product.imageUrl,
    },
    score,
    baseScore,
    delta,
  }));
}
