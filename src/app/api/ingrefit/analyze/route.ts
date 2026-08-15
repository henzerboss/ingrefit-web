import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { analyzeProduct } from '@/lib/ingrefit/analyzer';
import { requireClient, resolvePlan } from '@/lib/ingrefit/auth';
import { errorResponse, HttpError } from '@/lib/ingrefit/http';
import { analyzeRequestSchema } from '@/lib/ingrefit/schemas';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const installationId = requireClient(request);
    const plan = await resolvePlan(request, installationId);
    const raw = await request.json().catch(() => null);
    const parsed = analyzeRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(400, 'INVALID_REQUEST', 'The analysis request is invalid.', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    return NextResponse.json(await analyzeProduct(parsed.data, installationId, plan), {
      headers: { 'Cache-Control': 'no-store' },
    });
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
