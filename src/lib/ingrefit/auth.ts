import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

import { HttpError } from './http';
import type { Plan } from './types';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireClient(request: NextRequest): string {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const configured = (process.env.INGREFIT_CLIENT_TOKENS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const tokens = configured.length
    ? configured
    : process.env.NODE_ENV === 'production'
      ? []
      : ['ingrefit-development-token'];

  if (!token || !tokens.some((candidate) => safeEqual(token, candidate))) {
    throw new HttpError(401, 'UNAUTHORIZED', 'A valid client token is required.');
  }

  const installationId = request.headers.get('x-ingrefit-installation')?.trim() ?? '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(installationId)) {
    throw new HttpError(400, 'INVALID_INSTALLATION', 'A valid installation id is required.');
  }
  return installationId;
}

interface EntitlementPayload {
  installationId: string;
  plan: 'premium';
  exp: number;
}

function verifyEntitlement(token: string, installationId: string): boolean {
  const secret = process.env.INGREFIT_ENTITLEMENT_SECRET;
  if (!secret || secret.length < 32) return false;

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return false;
  const expected = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  if (!safeEqual(expected, signature)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as EntitlementPayload;
    return (
      payload.plan === 'premium' &&
      payload.installationId === installationId &&
      Number.isFinite(payload.exp) &&
      payload.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

export function resolvePlan(request: NextRequest, installationId: string): Plan {
  const entitlement = request.headers.get('x-ingrefit-entitlement');
  if (entitlement && verifyEntitlement(entitlement, installationId)) return 'premium';

  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.INGREFIT_ALLOW_DEMO_PREMIUM === 'true' &&
    request.headers.get('x-ingrefit-plan') === 'premium'
  ) {
    return 'premium';
  }
  return 'free';
}
