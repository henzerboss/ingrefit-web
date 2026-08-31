import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireClient, resolvePlan } from '@/lib/ingrefit/auth';
import { errorResponse, HttpError } from '@/lib/ingrefit/http';
import { clientIp, enforceLimit } from '@/lib/ingrefit/rateLimit';
import { findHealthierRecommendationsWithDiagnostics } from '@/lib/ingrefit/recommendations';
import { recommendationsRequestSchema } from '@/lib/ingrefit/schemas';

export const runtime = 'nodejs';
export const maxDuration = 20;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, X-IngreFit-Installation, X-IngreFit-Plan, X-IngreFit-Entitlement, X-IngreFit-Signature',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
} as const;

export async function POST(request: NextRequest) {
  try {
    const installationId = requireClient(request);
    // Metered before the plan is resolved: resolvePlan may call RevenueCat.
    await enforceLimit('recommendations:ip', clientIp(request.headers), true);
    const plan = await resolvePlan(request, installationId);
    if (plan !== 'premium') throw new HttpError(402, 'PREMIUM_REQUIRED', 'Product alternatives require Premium.');
    await enforceLimit('recommendations:installation', installationId, true);

    const parsed = recommendationsRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_REQUEST', 'The recommendations request is invalid.');
    }

    const { recommendations, diagnostics } = await findHealthierRecommendationsWithDiagnostics(parsed.data);
    // `reason` lets the client tell "nothing better exists" apart from "this
    // product could not be compared at all". Both used to render as a reassuring
    // green tick, which is the wrong thing to say when the truth is that Open
    // Food Facts has no category for the product.
    return NextResponse.json(
      { recommendations, reason: diagnostics.outcome },
      { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
