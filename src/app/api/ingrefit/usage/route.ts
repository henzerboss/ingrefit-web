import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireClient, resolvePlan } from '@/lib/ingrefit/auth';
import { errorResponse } from '@/lib/ingrefit/http';
import { clientIp, enforceLimit, peekLimit } from '@/lib/ingrefit/rateLimit';

export const runtime = 'nodejs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, X-IngreFit-Installation, X-IngreFit-Plan, X-IngreFit-Entitlement, X-IngreFit-Signature',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
} as const;

/**
 * Current plan and remaining request budget.
 *
 * This endpoint used to return hardcoded zeroes and had no rate limit at all,
 * while still calling resolvePlan — which can reach out to RevenueCat. It was
 * therefore the cheapest way to make our server generate outbound traffic. It
 * is now metered like every other route, and it reports the real remaining
 * budget instead of a placeholder.
 */
export async function GET(request: NextRequest) {
  try {
    const installationId = requireClient(request);
    await enforceLimit('usage:ip', clientIp(request.headers), false);
    await enforceLimit('usage:installation', installationId, false);

    const plan = await resolvePlan(request, installationId);
    const premium = plan === 'premium';
    const analyze = await peekLimit('analyze:installation', installationId, premium);
    const ai = await peekLimit('ai:installation', installationId, premium);

    return NextResponse.json(
      {
        plan,
        analyze: {
          used: analyze.used,
          limit: analyze.limit,
          remaining: analyze.remaining,
          resetsAt: new Date(analyze.resetAt).toISOString(),
        },
        ai: { used: ai.used, limit: ai.limit, remaining: ai.remaining, resetsAt: new Date(ai.resetAt).toISOString() },
      },
      { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
