import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireClient } from '@/lib/ingrefit/auth';
import { HttpError, errorResponse } from '@/lib/ingrefit/http';

export const runtime = 'nodejs';

const STORE_URLS = {
  ios: 'https://apps.apple.com/app/id6801561360',
  android: 'https://play.google.com/store/apps/details?id=store.evsi.ingrefit',
} as const;

function compareVersions(left: string, right: string): number {
  const parts = (value: string) => value.split('-')[0]!.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length, 3); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export async function GET(request: NextRequest) {
  try {
    requireClient(request);
    const platform = request.nextUrl.searchParams.get('platform');
    const currentVersion = request.nextUrl.searchParams.get('currentVersion')?.trim() ?? '';
    if ((platform !== 'ios' && platform !== 'android') || !/^\d+(?:\.\d+){0,3}(?:-[\w.-]+)?$/.test(currentVersion)) {
      throw new HttpError(400, 'INVALID_VERSION_REQUEST', 'A valid platform and currentVersion are required.');
    }

    const prefix = platform === 'ios' ? 'INGREFIT_IOS' : 'INGREFIT_ANDROID';
    const latestVersion = process.env[`${prefix}_LATEST_VERSION`]?.trim() || '1.6.0';
    const minimumVersion = process.env[`${prefix}_MINIMUM_VERSION`]?.trim() || '1.0.0';
    return NextResponse.json({
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      required: compareVersions(minimumVersion, currentVersion) > 0,
      storeUrl: STORE_URLS[platform],
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
