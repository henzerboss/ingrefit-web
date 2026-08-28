import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireClient } from '@/lib/ingrefit/auth';
import { errorResponse, HttpError } from '@/lib/ingrefit/http';
import { registerInstallation } from '@/lib/ingrefit/installation';
import { clientIp, enforceLimit } from '@/lib/ingrefit/rateLimit';
import { installationRegistrationSchema } from '@/lib/ingrefit/schemas';

export const runtime = 'nodejs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, X-IngreFit-Installation, X-IngreFit-Plan, X-IngreFit-Entitlement, X-IngreFit-Signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const;

/**
 * Trust-on-first-use registration of an installation secret.
 *
 * Called once, on first launch. Afterwards the secret never leaves the device;
 * requests carry a signature computed from it instead, so the installation id
 * alone stops being enough to be served as that subscriber.
 */
export async function POST(request: NextRequest) {
  try {
    const installationId = requireClient(request);
    await enforceLimit('installation:ip', clientIp(request.headers), false);

    const parsed = installationRegistrationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST', 'The registration request is invalid.');
    if (parsed.data.installationId !== installationId) {
      throw new HttpError(400, 'INVALID_INSTALLATION', 'The installation id does not match the request header.');
    }

    await registerInstallation(installationId, parsed.data.secret);
    return NextResponse.json({ registered: true }, { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
