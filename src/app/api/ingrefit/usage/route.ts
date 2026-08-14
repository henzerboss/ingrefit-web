import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireClient, resolvePlan } from '@/lib/ingrefit/auth';
import { errorResponse } from '@/lib/ingrefit/http';
import { getUsage } from '@/lib/ingrefit/quota';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const installationId = requireClient(request);
    const plan = resolvePlan(request, installationId);
    return NextResponse.json(await getUsage(installationId, plan), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
