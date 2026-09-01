import { createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { getDb, safeDb } from './db';
import { detectLanguage } from './localization';
import { computeNutriScore } from './nutriScore';
import type { OpenFoodFactsProduct } from './openFoodFacts';
import type { ProductFacts } from './types';

/**
 * Products contributed by users.
 *
 * The single architectural decision here is that a community record is stored
 * in the **Open Food Facts shape**, not in our own. `productFactsFromRaw`,
 * `categoryTagsFromRaw`, `hasMarketAvailability`, the scorer and the
 * recommendation SQL then all work on it unchanged, and there is exactly one
 * normalizer in the system rather than two that must be kept in step.
 *
 * Records are written server-side, from the photos a label scan already
 * uploads. Nothing was added to the client protocol, so an app build that
 * predates this feature contributes on every successful label scan without
 * knowing that the feature exists.
 */

/**
 * Where front-photo thumbnails live. Served through /api/ingrefit/community-image.
 *
 * Defaults to a sibling of the checkout — `../ingrefit-data/community-images`
 * — rather than somewhere under it. Two reasons, and only the second is really
 * about the path:
 *
 *  - A deploy that rebuilds the directory from git (a fresh clone, an rsync
 *    with --delete, a container image) would take the photos with it. Nothing
 *    else in the app is unrecoverable; these are.
 *  - Anything inside `public/` is served by the static handler, which knows
 *    nothing about moderation. Hiding a record in the admin would leave its
 *    photo reachable by URL. Going through an API route is what makes `hidden`
 *    mean hidden.
 *
 * It is deliberately NOT under /var/lib: a directory the app user already owns
 * needs no root to create, and a feature that requires sudo to switch on tends
 * not to get switched on.
 */
function imageRoot(): string {
  const configured = process.env.INGREFIT_COMMUNITY_IMAGE_DIR?.trim();
  if (configured) return configured;
  return path.join(process.cwd(), '..', 'ingrefit-data', 'community-images');
}

function publicImageUrl(barcode: string): string {
  const base = (process.env.INGREFIT_PUBLIC_URL ?? 'https://ingrefit.com').replace(/\/$/, '');
  return `${base}/api/ingrefit/community-image/${barcode}`;
}

export function imageFilePath(relative: string): string {
  // Defend against traversal: only a bare file name is ever accepted.
  return path.join(imageRoot(), path.basename(relative));
}

/**
 * Whether contributed records are served immediately.
 *
 * Default is on: an unreviewed record is still far better than "product not
 * found", and every record carries its provenance in the UI. Turn it off to
 * run the queue in review-first mode.
 */
function autoPublish(): boolean {
  return process.env.INGREFIT_COMMUNITY_AUTOPUBLISH !== 'false';
}

/** Community records may be disabled entirely without a code change. */
export function communityEnabled(): boolean {
  return process.env.INGREFIT_COMMUNITY_ENABLED !== 'false';
}

function hashContributor(installationId: string): string {
  const secret = process.env.INGREFIT_IP_HASH_SECRET ?? 'ingrefit';
  return createHash('sha256').update(`${secret}:${installationId}`).digest('hex').slice(0, 32);
}

/**
 * Build the Open-Food-Facts-shaped record.
 *
 * `facts` is what recognition produced; everything below maps our normalized
 * field names back onto the upstream ones. Nutri-Score is computed here rather
 * than taken from the model — see nutriScore.ts for why.
 */
export function communityRecordFromFacts(
  facts: ProductFacts,
  options: {
    barcode: string;
    marketCountry?: string | null;
    imageUrl?: string | null;
    /** Two-letter code of the language printed on the package, when detected. */
    sourceLanguage?: string | null;
  },
): OpenFoodFactsProduct {
  const marketTag = options.marketCountry
    ? `en:${options.marketCountry.toLowerCase() === 'gb' ? 'united-kingdom' : options.marketCountry.toLowerCase()}`
    : null;

  // Text is stored exactly as printed on the package, never in the
  // contributor's app language. `recognizeLabel` transcribes rather than
  // translates for this reason: a Spanish package contributed by a Russian user
  // has to read as Spanish, because that is what the next person will be
  // holding — and because Open Food Facts records work the same way, the same
  // per-language display path applies to both without a special case.
  const record: OpenFoodFactsProduct = {
    code: options.barcode,
    product_name: facts.name ?? undefined,
    brands: facts.brand ?? undefined,
    quantity: facts.quantity ?? undefined,
    ingredients_text: facts.ingredientsText ?? undefined,
    // Stored under the package's own language too when we can tell what it is,
    // so a later reader picks it up through the normal localized-field path.
    ...(options.sourceLanguage
      ? { [`ingredients_text_${options.sourceLanguage}`]: facts.ingredientsText ?? undefined }
      : {}),
    ingredients: facts.ingredients.map((text) => ({ text })),
    allergens_tags: facts.allergenTags,
    traces_tags: facts.traceTags,
    additives_tags: facts.additives.map((additive) => `en:${additive.code}`),
    labels_tags: facts.labelTags,
    categories_tags: facts.categories,
    countries_tags: marketTag ? [marketTag] : [],
    nova_group: facts.novaGroup ?? undefined,
    image_front_url: options.imageUrl ?? undefined,
    image_front_small_url: options.imageUrl ?? undefined,
    nutrition_data_per: facts.nutritionReference === '100ml' ? '100ml' : '100g',
    nutriments: {
      'energy-kcal_100g': facts.nutrition.energyKcal100g ?? undefined,
      proteins_100g: facts.nutrition.protein100g ?? undefined,
      carbohydrates_100g: facts.nutrition.carbohydrates100g ?? undefined,
      sugars_100g: facts.nutrition.sugars100g ?? undefined,
      fat_100g: facts.nutrition.fat100g ?? undefined,
      'saturated-fat_100g': facts.nutrition.saturatedFat100g ?? undefined,
      fiber_100g: facts.nutrition.fiber100g ?? undefined,
      salt_100g: facts.nutrition.salt100g ?? undefined,
    },
    alcohol_by_volume: facts.alcoholPercent ?? undefined,
    serving_size: facts.nutrition.servingSize ?? undefined,
  } as OpenFoodFactsProduct;

  const nutriScore = computeNutriScore(record);
  if (nutriScore) {
    record.nutriscore_grade = nutriScore.grade;
    // Marks the grade as ours rather than Open Food Facts'. Nothing reads it
    // yet; the admin surfaces it so a reviewer can tell them apart.
    (record as Record<string, unknown>).nutriscore_source = 'ingrefit_computed';
  }
  (record as Record<string, unknown>).ingrefit_source = 'community';
  return record;
}

async function storeThumbnail(barcode: string, jpegBase64: string): Promise<string | null> {
  try {
    const directory = imageRoot();
    await mkdir(directory, { recursive: true });
    const file = `${barcode}.jpg`;
    const target = path.join(directory, file);
    await writeFile(target, Buffer.from(jpegBase64, 'base64'));
    console.info(`[ingrefit] Stored community thumbnail at ${target}`);
    return file;
  } catch (error) {
    // A missing image is cosmetic; never fail a contribution over it.
    // Loud, because the usual cause is a directory the node user cannot write
    // to, and the symptom otherwise is only "contributed products have no
    // photo" noticed weeks later.
    console.error(`[ingrefit] Could not store community thumbnail in ${imageRoot()}`, error);
    return null;
  }
}

export interface ContributionInput {
  barcode: string;
  facts: ProductFacts;
  installationId: string;
  marketCountry?: string | null;
  /** Base64 JPEG of the front photo, when the scan supplied one. */
  frontPhotoBase64?: string | null;
  confidence: number;
}

/**
 * Record a contributed product.
 *
 * Never throws: a failed contribution must not turn a successful scan into an
 * error for the user who made it.
 */
export async function contributeProduct(input: ContributionInput): Promise<void> {
  if (!communityEnabled()) return;
  const db = getDb();
  if (!db) return;

  try {
    const existing = await db.communityProduct.findUnique({
      where: { barcode: input.barcode },
      select: { imagePath: true, status: true, confidence: true, data: true },
    });

    // A record with no category can never be compared to anything, so a later
    // reading that does have one is an improvement regardless of how the two
    // confidences compare. Without this, the first scan's failure to classify a
    // product was permanent: every later scan was discarded as "not more
    // confident" and the product had no alternatives forever.
    const existingCategories = existing
      ? ((existing.data as { categories_tags?: unknown })?.categories_tags ?? [])
      : [];
    const existingHasCategory = Array.isArray(existingCategories) && existingCategories.length > 0;
    const incomingHasCategory = input.facts.categories.length > 0;
    const addsCategory = !existingHasCategory && incomingHasCategory;

    // Otherwise an existing record is only replaced by a more confident
    // reading, and a record a human has hidden or edited is never overwritten.
    if (existing && !addsCategory && (existing.status !== 'published' || existing.confidence >= input.confidence)) {
      await db.communityProduct.update({
        where: { barcode: input.barcode },
        data: { views: { increment: 0 }, updatedAt: new Date() },
      });
      return;
    }

    if (!input.frontPhotoBase64) {
      console.info(`[ingrefit] Community record ${input.barcode} has no front photo; storing without an image`);
    }
    const imagePath = input.frontPhotoBase64
      ? await storeThumbnail(input.barcode, input.frontPhotoBase64)
      : (existing?.imagePath ?? null);

    const record = communityRecordFromFacts(input.facts, {
      barcode: input.barcode,
      marketCountry: input.marketCountry,
      imageUrl: imagePath ? publicImageUrl(input.barcode) : null,
      sourceLanguage: detectLanguage(input.facts.ingredientsText ?? ''),
    });

    await db.communityProduct.upsert({
      where: { barcode: input.barcode },
      create: {
        barcode: input.barcode,
        data: record as never,
        status: autoPublish() ? 'published' : 'pending',
        confidence: input.confidence,
        contributorId: hashContributor(input.installationId),
        name: input.facts.name,
        brands: input.facts.brand,
        imagePath,
      },
      update: {
        data: record as never,
        confidence: input.confidence,
        name: input.facts.name,
        brands: input.facts.brand,
        imagePath,
      },
    });
    console.info(`[ingrefit] Community record stored for ${input.barcode}`);
  } catch (error) {
    console.error('[ingrefit] Community contribution failed', error);
  }
}

/** Look up a contributed product. Only published records are served. */
export async function findCommunityRecord(barcode: string): Promise<OpenFoodFactsProduct | null> {
  if (!communityEnabled()) {
    console.info('[ingrefit] Community lookup skipped: INGREFIT_COMMUNITY_ENABLED=false');
    return null;
  }
  const row = await safeDb((db) =>
    db.communityProduct.findFirst({
      where: { barcode, status: 'published' },
      select: { data: true },
    }),
  );
  if (!row) {
    // Distinguishes "no such record" from "record exists but is hidden", which
    // look the same from the app and have opposite fixes.
    const any = await safeDb((db) => db.communityProduct.findUnique({ where: { barcode }, select: { status: true } }));
    console.info(
      `[ingrefit] Community lookup miss for ${barcode}${any ? ` (record exists with status "${any.status}")` : ''}`,
    );
    return null;
  }
  // Best-effort popularity counter; a failure here must not block the lookup.
  void safeDb((db) => db.communityProduct.update({ where: { barcode }, data: { views: { increment: 1 } } }));
  return row.data as unknown as OpenFoodFactsProduct;
}

export interface CommunityCandidateRow {
  barcode: string;
  data: unknown;
}

/**
 * Candidates for the recommendation ranker.
 *
 * The table is small compared with the mirror, so it is read with a plain
 * Prisma query and filtered in JS rather than needing its own GIN indexes.
 */
export async function communityCandidates(
  barcode: string,
  tags: string[],
  marketTag: string,
  limit: number,
): Promise<CommunityCandidateRow[]> {
  if (!communityEnabled() || !tags.length) return [];
  const rows = await safeDb((db) =>
    db.communityProduct.findMany({
      where: { status: 'published', barcode: { not: barcode } },
      select: { barcode: true, data: true },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    }),
  );
  if (!rows) return [];

  const wanted = new Set(tags);
  return rows.filter((row: CommunityCandidateRow) => {
    const record = row.data as OpenFoodFactsProduct;
    const categories = Array.isArray(record.categories_tags) ? record.categories_tags : [];
    if (!categories.some((tag) => wanted.has(tag))) return false;
    const countries = Array.isArray(record.countries_tags) ? record.countries_tags : [];
    return countries.includes(marketTag) || countries.includes('en:world');
  });
}

/** Remove a record and its thumbnail. Used by the admin. */
export async function deleteCommunityRecord(barcode: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  const row = await db.communityProduct.findUnique({ where: { barcode }, select: { imagePath: true } });
  await db.communityProduct.delete({ where: { barcode } });
  if (row?.imagePath) await unlink(imageFilePath(row.imagePath)).catch(() => undefined);
}
