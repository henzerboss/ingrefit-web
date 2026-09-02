import { HttpError } from './http';
import { explainScore } from './explanation';
import { localizeProductFacts } from './localization';
import { contributeProduct } from './community';
import {
  findProductByBarcode,
  hasContaminatedIngredients,
  hasEnoughFacts,
  nutritionFieldCount,
  type FactsOrigin,
} from './openFoodFacts';
import { enrichProductFromText, recognizeFoodPhoto, recognizeLabel } from './recognition';
import { enforceLimit } from './rateLimit';
import { scoreProduct } from './scoring';
import { findHealthierRecommendationsWithDiagnostics, type ProductRecommendation } from './recommendations';
import type { AnalyzeRequest } from './schemas';
import type { Plan, ProductFacts } from './types';

export async function analyzeProduct(request: AnalyzeRequest, installationId: string, plan: Plan) {
  const photoMode = request.mode === 'label' || request.mode === 'unpackaged';
  if ((photoMode || request.premiumFeatures) && plan !== 'premium') {
    throw new HttpError(402, 'PREMIUM_REQUIRED', 'This analysis requires an active Premium entitlement.');
  }

  // Vision calls are the expensive path; they get their own tighter budget on
  // top of the per-request limit already applied in the route.
  if (photoMode) {
    await enforceLimit('ai:installation', installationId, plan === 'premium');
  }

  let product: ProductFacts;
  let alreadyLocalized = false;
  let factsOrigin: FactsOrigin | 'ai_label' | 'ai_photo' | null = null;

  if (request.mode === 'unpackaged') {
    product = await recognizeFoodPhoto(request.photos![0]!, request.locale);
    alreadyLocalized = true;
    factsOrigin = 'ai_photo';
    if (!hasEnoughFacts(product)) {
      throw new HttpError(
        422,
        'INSUFFICIENT_PHOTO_DATA',
        'The supplied photo does not support a useful food and nutrition estimate.',
      );
    }
  } else if (request.mode === 'label') {
    product = await recognizeLabel(request.barcode ?? null, request.photos!, request.locale);
    factsOrigin = 'ai_label';
    if (!hasEnoughFacts(product) && (product.ingredientsText || product.ingredients.length)) {
      try {
        product = await enrichProductFromText(product, request.locale);
        alreadyLocalized = true;
      } catch (error) {
        console.error('[ingrefit] Label text enrichment failed', error);
      }
    }
    // Contribute the reading back, so the next person to scan this barcode gets
    // an instant answer instead of being asked for photos again.
    //
    // Done here rather than through a new client call on purpose: the photos and
    // the recognised facts are already in hand, so app builds that predate this
    // feature contribute on every successful label scan without an update, and
    // nothing about the request or response shape changes.
    // Logged either way. "The product is not in the database" and "we never
    // tried to put it there" look identical from the app, and only one of them
    // is a race worth retrying.
    console.info(
      `[ingrefit] Contribution check ${request.barcode ?? 'no-barcode'}: ` +
        `enoughFacts=${hasEnoughFacts(product)} name=${JSON.stringify(product.name)} ` +
        `nutrients=${nutritionFieldCount(product)} categories=${product.categories.length}`,
    );
    if (request.barcode && hasEnoughFacts(product)) {
      // Awaited, not fired and forgotten. The result screen asks for
      // alternatives the moment it opens, and that request reads the same
      // record: leaving the write in flight meant the person who contributed a
      // product was the only one who never saw alternatives for it.
      await contributeProduct({
        barcode: request.barcode,
        facts: product,
        installationId,
        marketCountry: request.marketCountry,
        frontPhotoBase64: request.photos?.find((photo) => photo.kind === 'front')?.base64 ?? null,
        confidence: product.completeness / 100,
      });
    }

    if (!hasEnoughFacts(product)) {
      throw new HttpError(
        422,
        'INSUFFICIENT_LABEL_DATA',
        'The supplied photos do not contain enough legible product facts.',
        {
          unknownFields: product.unknownFields,
        },
      );
    }
  } else {
    let found: ProductFacts | null = null;
    try {
      const lookup = await findProductByBarcode(request.barcode!, request.locale);
      found = lookup.facts;
      factsOrigin = lookup.origin;
    } catch (error) {
      console.error('[ingrefit] Open Food Facts lookup failed', error);
      throw new HttpError(502, 'OPEN_FOOD_FACTS_UNAVAILABLE', 'The product database is temporarily unavailable.');
    }
    const canEnrichFromText = Boolean(
      found && (found.ingredientsText || found.ingredients.length || found.categories.length),
    );
    if (
      found &&
      request.premiumFeatures &&
      canEnrichFromText &&
      (!hasEnoughFacts(found) || hasContaminatedIngredients(found.ingredientsText))
    ) {
      try {
        await enforceLimit('ai:installation', installationId, plan === 'premium');
        found = await enrichProductFromText(found, request.locale);
        alreadyLocalized = true;
        factsOrigin = factsOrigin ? (`${factsOrigin}+ai` as FactsOrigin) : 'network';
      } catch (error) {
        console.error('[ingrefit] Text-based product enrichment failed; requesting label photos', error);
      }
    }
    if (!found || !hasEnoughFacts(found)) {
      return {
        status: 'needs_photos' as const,
        barcode: request.barcode!,
        reason: found ? ('insufficient_data' as const) : ('not_found' as const),
        requiredPhotos: ['label'] as const,
      };
    }
    product = found;
  }

  // Score FIRST, on the source-language facts.
  //
  // Allergen and diet detection falls back to multilingual ingredient-term
  // matching whenever no canonical Open Food Facts tag exists (every AI-read
  // label, and sparse database rows). Translating the ingredient statement
  // before scoring rewrote exactly the text those terms match against, so a
  // Premium user could lose a peanut blocker that a free user would have seen.
  // The scorer therefore never sees translated text; translation is a display
  // concern and happens afterwards.
  const scored = scoreProduct(product, request.profile);

  let translated = request.premiumFeatures && alreadyLocalized;
  if (request.premiumFeatures && !alreadyLocalized) {
    const localized = await localizeProductFacts(product, request.locale);
    product = localized.product;
    translated = localized.translated;
  }

  const assessment = await explainScore(product, request.profile, scored, request.locale, request.premiumFeatures);

  return {
    status: 'complete' as const,
    product,
    assessment: { ...assessment, aiEnhanced: request.premiumFeatures, translated },
    /** Diagnostic only: which source answered. Clients may ignore this. */
    factsOrigin,
    ...(await attachRecommendations(request, product)),
  };
}

/**
 * Alternatives computed in the same request that produced the product.
 *
 * A label scan writes the product to the database and the client then asks a
 * different endpoint to compare it — two requests down two paths, racing. The
 * client lost that race often enough that "we have never heard of this barcode"
 * became the normal first-scan experience, and three rounds of retries and
 * logging did not settle it.
 *
 * Computing them here cannot race: the record was written moments ago by this
 * very function, in this process. The client still fetches on its own when this
 * is absent, so older builds and barcode scans are unaffected.
 */
async function attachRecommendations(
  request: AnalyzeRequest,
  product: ProductFacts,
): Promise<{ recommendations?: ProductRecommendation[]; recommendationsReason?: string }> {
  if (request.mode !== 'label' || !request.premiumFeatures || !product.barcode) return {};
  try {
    const { recommendations, diagnostics } = await findHealthierRecommendationsWithDiagnostics({
      barcode: product.barcode,
      locale: request.locale,
      marketCountry: request.marketCountry,
      profile: request.profile,
    });
    return { recommendations, recommendationsReason: diagnostics.outcome };
  } catch (error) {
    // Never fail a scan over the section the user did not come for.
    console.error('[ingrefit] Inline recommendations failed', error);
    return {};
  }
}
