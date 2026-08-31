import { Prisma } from '@prisma/client';

import { GREAT_CONFIDENCE, recommendationQualityGate } from './dataQuality';
import { safeDb } from './db';
import {
  categoryTagsFromRaw,
  hasEnoughFacts,
  hasEnoughNutritionFacts,
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

// The client pages through these five at a time, so the ceiling is what the
// user can reach by tapping "show more" rather than what fits on one screen.
const MAX_RECOMMENDATIONS = 50;
// A gain smaller than this is inside the noise of the model itself.
const MIN_SCORE_GAIN = 0.5;
// The alternative must be better as a product, not only better for this
// profile — otherwise "healthier" would just mean "matches your goals".
const MIN_BASE_GAIN = 0.2;
const MIN_CONFIDENCE = GREAT_CONFIDENCE;
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
    ? new Set(
        raw.countries_tags
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim().toLowerCase()),
      )
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

/**
 * Whether a product is eaten as sold or has to be cooked first.
 *
 * Open Food Facts puts sliced cured ham and a raw pork tenderloin under the
 * same `en:meats` / `en:pork` branch, so "most specific shared tag" happily
 * matches them to each other. Nutritionally that swap is defensible — raw meat
 * really does beat a NOVA 4 cold cut — but it is not an alternative the user
 * can act on: one goes straight into a sandwich, the other needs a pan. The
 * suggestion reads as a mistake even though every number behind it is right.
 *
 * Only applied when both sides are known, so an unclassified product is never
 * excluded by it.
 */
type PreparationClass = 'ready' | 'raw' | 'unknown';

const READY_TO_EAT_MARKERS = [
  'prepared-meats',
  'charcuterie',
  'delicatessen',
  'cold-cuts',
  'hams',
  'cooked-ham',
  'cured-',
  'sausages',
  'salami',
  'pates',
  'pate',
  'canned-',
  'tinned-',
  'prepared-meals',
  'ready-',
  'smoked-',
  'dried-',
  'sandwich',
  'salads',
  'desserts',
  'snacks',
  'biscuits',
  'cheeses',
  'yogurts',
];

const RAW_MARKERS = [
  'fresh-meats',
  'fresh-poultry',
  'fresh-fish',
  'fresh-seafood',
  'raw-',
  'meat-cuts',
  'fresh-vegetables',
  'fresh-fruits',
  'flours',
  'dried-legumes',
  'frozen-raw-',
];

function preparationClass(tags: string[]): PreparationClass {
  let ready = false;
  let raw = false;
  for (const tag of tags) {
    const body = tag.replace(/^[a-z]{2}:/, '');
    if (READY_TO_EAT_MARKERS.some((marker) => body.includes(marker))) ready = true;
    if (RAW_MARKERS.some((marker) => body.includes(marker))) raw = true;
  }
  // A product marked both ways (a cooked ham inside "fresh meats") tells us
  // nothing, so it is left unknown rather than guessed.
  if (ready === raw) return 'unknown';
  return ready ? 'ready' : 'raw';
}

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
  const specific = [...tags].reverse().filter((tag) => tag.startsWith('en:') && !BROAD_CATEGORY_TAGS.has(tag));
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
    return local ? (local.data as unknown as OpenFoodFactsProduct) : null;
  });
}

/**
 * Candidate sourcing.
 *
 * Both tables are queried with the SAME two gates the ranker would apply
 * anyway — category containment and market availability — so the rows that come
 * back are already plausible. Previously the cache table was read as "the 400
 * most recently refreshed products, whatever they are" and almost all of them
 * were thrown away after a full `productFactsFromRaw` deserialize.
 *
 * `focusTags` is ordered most-specific first. The primary tag is tried alone;
 * if it yields too few candidates the parent tags are added, which is what
 * keeps the alternatives block from being empty for niche categories.
 */
// Enough candidates to fill the 50-item ceiling after every gate has taken its
// share, without going back to reading the whole table.
const CANDIDATE_TARGET = 150;
const CANDIDATE_HARD_LIMIT = 400;

interface IndexAvailability {
  mirror: boolean;
  cache: boolean;
}

let indexAvailability: { value: IndexAvailability; checkedAt: number } | null = null;
const INDEX_CHECK_TTL_MS = 10 * 60_000;

/**
 * Which GIN indexes exist. Cached: the answer changes at most once per
 * deployment, and this used to run a catalog query on every single request.
 */
async function recommendationIndexes(): Promise<IndexAvailability> {
  if (indexAvailability && Date.now() - indexAvailability.checkedAt < INDEX_CHECK_TTL_MS) {
    return indexAvailability.value;
  }
  const rows = await safeDb(
    (db) => db.$queryRaw<
      Array<{
        categories: string | null;
        countries: string | null;
        cacheCategories: string | null;
        cacheCountries: string | null;
      }>
    >`
    SELECT
      to_regclass('public.off_product_categories_tags_gin')::text AS categories,
      to_regclass('public.off_product_countries_tags_gin')::text AS countries,
      to_regclass('public.product_cache_categories_tags_gin')::text AS "cacheCategories",
      to_regclass('public.product_cache_countries_tags_gin')::text AS "cacheCountries"
  `,
  );
  const value: IndexAvailability = {
    mirror: Boolean(rows?.[0]?.categories && rows?.[0]?.countries),
    cache: Boolean(rows?.[0]?.cacheCategories && rows?.[0]?.cacheCountries),
  };
  indexAvailability = { value, checkedAt: Date.now() };
  return value;
}

/**
 * Category-containment OR market-availability filter, expressed so PostgreSQL
 * can serve both halves from the GIN indexes (`@>` is index-backed, unlike a
 * function call on the JSON value).
 */
function tagFilterSql(column: 'facts' | 'data', tags: string[], marketTag: string): Prisma.Sql {
  const json = Prisma.raw(`"${column}"`);
  const categoryClauses = tags.map(
    (tag) => Prisma.sql`(${json}->'categories_tags') @> ${JSON.stringify([tag])}::jsonb`,
  );
  return Prisma.sql`
    (${Prisma.join(categoryClauses, ' OR ')})
    AND (
      (${json}->'countries_tags') @> ${JSON.stringify([marketTag])}::jsonb
      OR (${json}->'countries_tags') @> ${JSON.stringify([WORLD_MARKET_TAG])}::jsonb
    )
  `;
}

async function cachedCandidates(barcode: string, tags: string[], marketTag: string): Promise<RawProductRow[]> {
  if (!tags.length) return [];
  const indexes = await recommendationIndexes();
  if (indexes.cache) {
    return (
      (await safeDb((db) =>
        db.$queryRaw<RawProductRow[]>(Prisma.sql`
      SELECT barcode, facts AS data
      FROM "ProductCache"
      WHERE barcode <> ${barcode}
        AND ${tagFilterSql('facts', tags, marketTag)}
      ORDER BY "refreshedAt" DESC
      LIMIT ${CANDIDATE_HARD_LIMIT}
    `),
      )) ?? []
    );
  }
  // No index yet: keep the old behaviour so the feature still works during a
  // deploy, but read far fewer rows since they are filtered in JS anyway.
  const rows = await safeDb((db) =>
    db.productCache.findMany({
      where: { barcode: { not: barcode } },
      orderBy: { refreshedAt: 'desc' },
      take: CANDIDATE_HARD_LIMIT,
      select: { barcode: true, facts: true },
    }),
  );
  return (rows ?? []).map((row: { barcode: string; facts: unknown }) => ({ barcode: row.barcode, data: row.facts }));
}

let mirrorIndexWarned = false;

async function mirrorCandidates(barcode: string, tags: string[], marketTag: string): Promise<RawProductRow[]> {
  if (process.env.OPEN_FOOD_FACTS_LOCAL !== 'true' || !tags.length) return [];
  if (!(await recommendationIndexes()).mirror) {
    // Without the GIN indexes the mirror cannot be queried at acceptable cost,
    // so it is skipped entirely — and that silently reduces the candidate pool
    // to whatever happens to be in the request cache. Say so once per process
    // instead of letting it look like "no better product exists".
    if (!mirrorIndexWarned) {
      mirrorIndexWarned = true;
      console.warn(
        '[ingrefit] Local Open Food Facts mirror is enabled but its recommendation indexes are missing; ' +
          'candidates come from the request cache only. Run scripts/add-recommendation-index.sql.',
      );
    }
    return [];
  }
  return (
    (await safeDb((db) =>
      db.$queryRaw<RawProductRow[]>(Prisma.sql`
    SELECT barcode, data
    FROM "OffProduct"
    WHERE barcode <> ${barcode}
      AND ${tagFilterSql('data', tags, marketTag)}
      AND COALESCE(data->>'product_name', data->>'product_name_en', data->>'generic_name', '') <> ''
    LIMIT ${CANDIDATE_HARD_LIMIT}
  `),
    )) ?? []
  );
}

async function collectCandidates(
  barcode: string,
  focusTags: string[],
  marketTag: string,
): Promise<{ pool: Map<string, RawProductRow>; tagsUsed: number }> {
  const pool = new Map<string, RawProductRow>();
  // Widen one parent tag at a time. Precision still wins the ranking — a
  // candidate sharing the primary tag always outranks one that only shares a
  // parent — but an empty block helps nobody, and niche categories (a single
  // "en:green-beans" product in the market) used to produce exactly that.
  let tagsUsed = 0;
  for (let depth = 1; depth <= focusTags.length; depth += 1) {
    const tags = focusTags.slice(0, depth);
    tagsUsed = depth;
    const [cached, mirrored] = await Promise.all([
      cachedCandidates(barcode, tags, marketTag),
      mirrorCandidates(barcode, tags, marketTag),
    ]);
    for (const row of cached) pool.set(row.barcode, row);
    for (const row of mirrored) pool.set(row.barcode, row);
    if (pool.size >= CANDIDATE_TARGET) break;
  }
  return { pool, tagsUsed };
}

/**
 * How close a candidate is to the scanned product.
 *
 * The primary (most specific) shared tag is worth an order of magnitude more
 * than a parent tag, so a like-for-like match always outranks a near-miss. A
 * parent-only match is allowed rather than rejected outright: refusing it made
 * the alternatives block empty for any category with a single product in the
 * market, which reads to the user as "nothing better exists".
 */
const PRIMARY_TAG_WEIGHT = 100;

function categorySimilarity(sourceTags: string[], focusTags: string[], candidateRaw: OpenFoodFactsProduct): number {
  const candidateTags = new Set(categoryTagsFromRaw(candidateRaw));
  const primaryTag = focusTags[0];
  if (!primaryTag) return 0;

  let similarity = candidateTags.has(primaryTag) ? PRIMARY_TAG_WEIGHT : 0;
  focusTags.forEach((tag, index) => {
    if (index > 0 && candidateTags.has(tag)) similarity += Math.max(1, 5 - index);
  });
  for (const tag of sourceTags) if (candidateTags.has(tag)) similarity += 0.1;
  // A candidate that shares nothing but generic aisles is not an alternative.
  return similarity >= 1 ? similarity : 0;
}

/** Why a candidate was dropped. Logged in aggregate so an empty block is diagnosable. */
type RejectionReason =
  | 'market'
  | 'category'
  | 'preparation'
  | 'sparse_facts'
  | 'quality_gate'
  | 'blocked'
  | 'low_confidence'
  | 'no_gain'
  | 'duplicate';

export interface RecommendationDiagnostics {
  /** Set when the whole request could not produce anything, with the reason. */
  outcome: 'ok' | 'no_market' | 'unknown_source' | 'no_category' | 'sparse_source' | 'empty';
  candidates: number;
  tagsUsed: number;
  accepted: number;
  rejected: Partial<Record<RejectionReason, number>>;
}

export async function findHealthierRecommendations(input: {
  barcode: string;
  locale: string;
  marketCountry?: string;
  profile: AnalysisProfile;
}): Promise<ProductRecommendation[]> {
  return (await findHealthierRecommendationsWithDiagnostics(input)).recommendations;
}

/**
 * Same as `findHealthierRecommendations`, but also reports why candidates were
 * dropped.
 *
 * Six independent gates sit between a scan and a suggestion, each defensible on
 * its own. Their combined effect on real traffic was never measured, so an
 * empty alternatives block was indistinguishable from "nothing better exists".
 * The counters below are what makes that difference visible in the logs.
 */
export async function findHealthierRecommendationsWithDiagnostics(input: {
  barcode: string;
  locale: string;
  marketCountry?: string;
  profile: AnalysisProfile;
}): Promise<{ recommendations: ProductRecommendation[]; diagnostics: RecommendationDiagnostics }> {
  const rejected: Partial<Record<RejectionReason, number>> = {};
  const drop = (reason: RejectionReason) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  const done = (
    outcome: RecommendationDiagnostics['outcome'],
    recommendations: ProductRecommendation[],
    candidates = 0,
    tagsUsed = 0,
  ) => {
    const diagnostics: RecommendationDiagnostics = {
      outcome,
      candidates,
      tagsUsed,
      accepted: recommendations.length,
      rejected,
    };
    console.info('[ingrefit] Recommendations', JSON.stringify({ barcode: input.barcode, ...diagnostics }));
    return { recommendations, diagnostics };
  };

  const marketTag = marketTagForCountry(input.marketCountry);
  if (!marketTag) return done('no_market', []);

  const sourceRaw = await readSourceRaw(input.barcode);
  if (!sourceRaw) return done('unknown_source', []);

  const sourceTags = categoryTagsFromRaw(sourceRaw);
  const focusTags = focusCategoryTags(sourceRaw);
  if (!focusTags.length) return done('no_category', []);

  const sourceFacts = productFactsFromRaw(sourceRaw, input.barcode, input.locale);
  // Nutrition only. Requiring a name here rejected products the user had just
  // been given a score for; candidates below are still held to the full check,
  // because those do have to be displayed.
  if (!hasEnoughNutritionFacts(sourceFacts)) return done('sparse_source', []);
  const sourceScore = scoreProduct(sourceFacts, input.profile);

  const sourcePreparation = preparationClass(sourceTags);
  const { pool, tagsUsed } = await collectCandidates(input.barcode, focusTags, marketTag);

  const ranked: Array<{ product: ProductFacts; score: number; baseScore: number; delta: number; similarity: number }> =
    [];
  const seenIdentities = new Set<string>();
  for (const row of pool.values()) {
    const raw = row.data as OpenFoodFactsProduct;
    // Unknown market is treated as unavailable. This intentionally prefers an
    // empty recommendation block over suggesting a product the user may not be
    // able to buy in their country.
    if (!hasMarketAvailability(raw, marketTag)) {
      drop('market');
      continue;
    }
    const similarity = categorySimilarity(sourceTags, focusTags, raw);
    if (!similarity) {
      drop('category');
      continue;
    }
    if (sourcePreparation !== 'unknown') {
      const candidatePreparation = preparationClass(categoryTagsFromRaw(raw));
      if (candidatePreparation !== 'unknown' && candidatePreparation !== sourcePreparation) {
        drop('preparation');
        continue;
      }
    }

    const product = productFactsFromRaw(raw, row.barcode, input.locale);
    if (!hasEnoughFacts(product)) {
      drop('sparse_facts');
      continue;
    }
    if (!recommendationQualityGate(product, input.profile)) {
      drop('quality_gate');
      continue;
    }
    const scored = scoreProduct(product, input.profile);
    if (scored.blocked) {
      drop('blocked');
      continue;
    }
    if (scored.confidence < MIN_CONFIDENCE) {
      drop('low_confidence');
      continue;
    }

    const delta = Math.round((scored.score - sourceScore.score) * 10) / 10;
    const baseGain = scored.baseScore - sourceScore.baseScore;
    if (sourceScore.blocked) {
      // The scanned product is unusable for this user, so anything genuinely
      // safe and decent is an improvement, whatever the numeric delta says.
      if (scored.score < 4.5) {
        drop('no_gain');
        continue;
      }
    } else if (delta < MIN_SCORE_GAIN || baseGain < MIN_BASE_GAIN) {
      drop('no_gain');
      continue;
    }

    const identity = `${normalizeIdentity(product.brand)}|${normalizeIdentity(product.name)}`;
    if (!identity || seenIdentities.has(identity)) {
      drop('duplicate');
      continue;
    }
    seenIdentities.add(identity);
    ranked.push({ product, score: scored.score, baseScore: scored.baseScore, delta, similarity });
  }

  ranked.sort((a, b) => b.similarity - a.similarity || b.score - a.score || b.delta - a.delta);
  const recommendations = ranked.slice(0, MAX_RECOMMENDATIONS).map(({ product, score, baseScore, delta }) => ({
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

  return done(recommendations.length ? 'ok' : 'empty', recommendations, pool.size, tagsUsed);
}
