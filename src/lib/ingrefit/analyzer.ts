import { HttpError } from './http';
import { explainScore } from './explanation';
import { localizeProductFacts } from './localization';
import { findProductByBarcode, hasContaminatedIngredients, hasEnoughFacts } from './openFoodFacts';
import { enrichProductFromText, recognizeFoodPhoto, recognizeLabel } from './recognition';
import { scoreProduct } from './scoring';
import type { AnalyzeRequest } from './schemas';
import type { Plan, ProductFacts, UsageSnapshot } from './types';

function unlimitedUsage(plan: Plan): UsageSnapshot {
  return { used: 0, limit: 0, remaining: 0, plan, resetsAt: new Date(0).toISOString() };
}

export async function analyzeProduct(request: AnalyzeRequest, _installationId: string, plan: Plan) {
  const photoMode = request.mode === 'label' || request.mode === 'unpackaged';
  if ((photoMode || request.premiumFeatures) && plan !== 'premium') {
    throw new HttpError(402, 'PREMIUM_REQUIRED', 'This analysis requires an active Premium entitlement.');
  }

  let product: ProductFacts;
  if (request.mode === 'unpackaged') {
    product = await recognizeFoodPhoto(request.photos![0]!, request.locale);
    if (!hasEnoughFacts(product)) {
      throw new HttpError(422, 'INSUFFICIENT_PHOTO_DATA', 'The supplied photo does not support a useful food and nutrition estimate.');
    }
  } else if (request.mode === 'label') {
    product = await recognizeLabel(request.barcode ?? null, request.photos!, request.locale);
    if (!hasEnoughFacts(product) && (product.ingredientsText || product.ingredients.length)) {
      try {
        product = await enrichProductFromText(product, request.locale);
      } catch (error) {
        console.error('[ingrefit] Label text enrichment failed', error);
      }
    }
    if (!hasEnoughFacts(product)) {
      throw new HttpError(422, 'INSUFFICIENT_LABEL_DATA', 'The supplied photos do not contain enough legible product facts.', { unknownFields: product.unknownFields });
    }
  } else {
    let found: ProductFacts | null = null;
    try {
      found = await findProductByBarcode(request.barcode!, request.locale);
    } catch (error) {
      console.error('[ingrefit] Open Food Facts lookup failed', error);
      throw new HttpError(502, 'OPEN_FOOD_FACTS_UNAVAILABLE', 'The product database is temporarily unavailable.');
    }
    const canEnrichFromText = Boolean(found && (found.ingredientsText || found.ingredients.length || found.categories.length));
    if (found && request.premiumFeatures && canEnrichFromText && (!hasEnoughFacts(found) || hasContaminatedIngredients(found.ingredientsText))) {
      try {
        found = await enrichProductFromText(found, request.locale);
      } catch (error) {
        console.error('[ingrefit] Text-based product enrichment failed; requesting label photos', error);
      }
    }
    if (!found || !hasEnoughFacts(found)) {
      return { status: 'needs_photos' as const, barcode: request.barcode!, reason: found ? ('insufficient_data' as const) : ('not_found' as const), requiredPhotos: ['front', 'ingredients', 'nutrition'] as const };
    }
    product = found;
  }

  let translated = false;
  if (request.premiumFeatures) {
    const localized = await localizeProductFacts(product, request.locale);
    product = localized.product;
    translated = localized.translated;
  }

  const scored = scoreProduct(product, request.profile);
  const assessment = await explainScore(product, request.profile, scored, request.locale, request.premiumFeatures);
  return {
    status: 'complete' as const,
    product,
    assessment: { ...assessment, aiEnhanced: request.premiumFeatures, translated },
    usage: unlimitedUsage(plan),
  };
}
