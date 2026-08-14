import { HttpError } from './http';
import { explainScore } from './explanation';
import { findProductByBarcode, hasEnoughFacts } from './openFoodFacts';
import { consumeQuota, getUsage } from './quota';
import { recognizeLabel } from './recognition';
import { scoreProduct } from './scoring';
import type { AnalyzeRequest } from './schemas';
import type { Plan } from './types';

export async function analyzeProduct(
  request: AnalyzeRequest,
  installationId: string,
  plan: Plan,
) {
  let product;

  if (request.photos) {
    const currentUsage = await getUsage(installationId, plan);
    if (currentUsage.remaining <= 0) {
      throw new HttpError(429, 'DAILY_LIMIT_REACHED', 'The daily product analysis limit has been reached.', {
        limit: currentUsage.limit,
        used: currentUsage.used,
        remaining: 0,
        resetsAt: currentUsage.resetsAt,
        plan,
      });
    }
    product = await recognizeLabel(request.barcode ?? null, request.photos, request.locale);
    if (!hasEnoughFacts(product)) {
      throw new HttpError(
        422,
        'INSUFFICIENT_LABEL_DATA',
        'The supplied photos do not contain enough legible product facts.',
        { unknownFields: product.unknownFields },
      );
    }
  } else {
    try {
      product = await findProductByBarcode(request.barcode!);
    } catch (error) {
      console.error('[ingrefit] Open Food Facts lookup failed; asking for label evidence', error);
      product = null;
    }

    if (!product || !hasEnoughFacts(product)) {
      return {
        status: 'needs_photos' as const,
        barcode: request.barcode!,
        reason: product ? ('insufficient_data' as const) : ('not_found' as const),
        requiredPhotos: ['front', 'ingredients', 'nutrition'] as const,
      };
    }
  }

  const quota = await consumeQuota(installationId, plan);
  if (!quota.allowed) {
    throw new HttpError(429, 'DAILY_LIMIT_REACHED', 'The daily product analysis limit has been reached.', {
      limit: quota.usage.limit,
      used: quota.usage.used,
      remaining: 0,
      resetsAt: quota.usage.resetsAt,
      plan,
    });
  }

  const scored = scoreProduct(product, request.profile);
  const assessment = await explainScore(product, request.profile, scored, request.locale);
  return { status: 'complete' as const, product, assessment, usage: quota.usage };
}
