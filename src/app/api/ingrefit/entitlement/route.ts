import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { issueEntitlement, requireClient, resolvePlanContext } from '@/lib/ingrefit/auth';
import { errorResponse } from '@/lib/ingrefit/http';
import { clientIp, enforceLimit } from '@/lib/ingrefit/rateLimit';

export const runtime = 'nodejs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, X-IngreFit-Installation, X-IngreFit-Plan, X-IngreFit-Entitlement, X-IngreFit-Signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const;

/**
 * Exchange a verified RevenueCat subscription for a short-lived, signed
 * entitlement bound to this installation.
 *
 * The app calls this at most once a day and sends the returned token on every
 * subsequent request, which keeps RevenueCat out of the per-request path.
 */
export async function POST(request: NextRequest) {
  try {
    const installationId = requireClient(request);
    await enforceLimit('usage:ip', clientIp(request.headers), false);
    await enforceLimit('usage:installation', installationId, false);

    const context = await resolvePlanContext(request, installationId);
    if (context.plan !== 'premium') {
      return NextResponse.json(
        { plan: 'free', token: null, expiresAt: null },
        { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } },
      );
    }

    const issued = issueEntitlement(installationId);
    return NextResponse.json(
      { plan: 'premium', token: issued?.token ?? null, expiresAt: issued?.expiresAt ?? null },
      { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
