import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { analyzeProduct } from '@/lib/ingrefit/analyzer';
import { requireClient, resolvePlan } from '@/lib/ingrefit/auth';
import { errorResponse, HttpError } from '@/lib/ingrefit/http';
import { clientIp, enforceLimit } from '@/lib/ingrefit/rateLimit';
import { recommendationProductRequestSchema } from '@/lib/ingrefit/schemas';

export const runtime = 'nodejs';
export const maxDuration = 20;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, X-IngreFit-Installation, X-IngreFit-Plan, X-IngreFit-Entitlement, X-IngreFit-Signature',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
} as const;

/**
 * Premium drill-down for a recommended product. This deliberately disables
 * premiumFeatures so opening a recommendation never triggers Gemini or label
 * enrichment. It is a deterministic OFF lookup + the normal IngreFit scorer.
 */
export async function POST(request: NextRequest) {
  try {
    const installationId = requireClient(request);
    // Metered before the plan is resolved: resolvePlan may call RevenueCat.
    await enforceLimit('recommendations:ip', clientIp(request.headers), true);
    const plan = await resolvePlan(request, installationId);
    if (plan !== 'premium') throw new HttpError(402, 'PREMIUM_REQUIRED', 'Recommendation details require Premium.');

    await enforceLimit('recommendations:installation', installationId, true);

    const parsed = recommendationProductRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST', 'The recommendation product request is invalid.');

    const result = await analyzeProduct(
      {
        barcode: parsed.data.barcode,
        locale: parsed.data.locale,
        mode: 'barcode',
        premiumFeatures: false,
        profile: parsed.data.profile,
      },
      installationId,
      plan,
    );

    return NextResponse.json(result, { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
