import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireClient, resolvePlan } from '@/lib/ingrefit/auth';
import { errorResponse } from '@/lib/ingrefit/http';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const installationId = requireClient(request);
    const plan = await resolvePlan(request, installationId);
    return NextResponse.json({ used: 0, limit: 0, remaining: 0, plan, resetsAt: new Date(0).toISOString() }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
