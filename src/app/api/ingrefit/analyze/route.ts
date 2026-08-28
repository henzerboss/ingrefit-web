import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { analyzeProduct } from '@/lib/ingrefit/analyzer';
import { requireClient, resolvePlan } from '@/lib/ingrefit/auth';
import { errorResponse, HttpError } from '@/lib/ingrefit/http';
import { clientIp, enforceLimit } from '@/lib/ingrefit/rateLimit';
import { analyzeRequestSchema } from '@/lib/ingrefit/schemas';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_REQUEST_BYTES = 24 * 1024 * 1024;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, X-IngreFit-Installation, X-IngreFit-Plan, X-IngreFit-Entitlement, X-IngreFit-Signature',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
} as const;

export async function POST(request: NextRequest) {
  try {
    const installationId = requireClient(request);

    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The analysis request is too large.');
    }

    // Rate limiting runs BEFORE the plan is resolved.
    //
    // resolvePlan can call RevenueCat, so doing it first meant an unmetered
    // caller could turn every request into an outbound request on our account.
    // The per-IP window is consumed at the free rate here because the plan is
    // not known yet; the per-installation window is consumed afterwards at the
    // correct rate.
    await enforceLimit('analyze:ip', clientIp(request.headers), false);

    const plan = await resolvePlan(request, installationId);
    const premium = plan === 'premium';
    const limit = await enforceLimit('analyze:installation', installationId, premium);

    const raw = await request.json().catch(() => null);
    const parsed = analyzeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_REQUEST', 'The analysis request is invalid.', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }

    const result = await analyzeProduct(parsed.data, installationId, plan);
    // Surfaced as a header so the fact source can be verified with curl alone,
    // without reading the body or inferring it from cache side effects.
    const origin = 'factsOrigin' in result && result.factsOrigin ? String(result.factsOrigin) : 'none';

    return NextResponse.json(result, {
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'no-store',
        'X-IngreFit-Fact-Source': origin,
        'X-RateLimit-Limit': String(limit.limit),
        'X-RateLimit-Remaining': String(limit.remaining),
        'X-RateLimit-Reset': String(Math.floor(limit.resetAt / 1000)),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
