import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireClient, resolvePlan } from '@/lib/ingrefit/auth';
import { errorResponse, HttpError } from '@/lib/ingrefit/http';
import { clientIp, enforceLimit } from '@/lib/ingrefit/rateLimit';
import { findHealthierRecommendations } from '@/lib/ingrefit/recommendations';
import { recommendationsRequestSchema } from '@/lib/ingrefit/schemas';

export const runtime = 'nodejs';
export const maxDuration = 20;

export async function POST(request: NextRequest) {
  try {
    const installationId = requireClient(request);
    const plan = await resolvePlan(request, installationId);
    if (plan !== 'premium') throw new HttpError(402, 'PREMIUM_REQUIRED', 'Healthier alternatives require Premium.');
    await enforceLimit('recommendations:installation', installationId, true);
    await enforceLimit('recommendations:ip', clientIp(request.headers), true);

    const parsed = recommendationsRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_REQUEST', 'The recommendations request is invalid.');
    }

    const recommendations = await findHealthierRecommendations(parsed.data);
    return NextResponse.json({ recommendations }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-IngreFit-Installation, X-IngreFit-Plan, X-IngreFit-Entitlement',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}
