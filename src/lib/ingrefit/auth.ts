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
  const previewToken = process.env.INGREFIT_EXPO_GO_PREVIEW_TOKEN?.trim();
  const tokens = configured.length
    ? configured
    : process.env.NODE_ENV === 'production'
      ? []
      : ['ingrefit-development-token'];
  if (previewToken && !tokens.includes(previewToken)) tokens.push(previewToken);

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

interface RevenueCatSubscriber {
  subscriber?: { entitlements?: Record<string, { expires_date?: string | null }> };
}

declare global {
  // eslint-disable-next-line no-var
  var __ingrefitRevenueCatPremium: Map<string, number> | undefined;
}

async function hasRevenueCatPremium(installationId: string): Promise<boolean> {
  const secret = process.env.REVENUECAT_SECRET_API_KEY;
  if (!secret) return false;
  const cache = (globalThis.__ingrefitRevenueCatPremium ??= new Map());
  const cachedUntil = cache.get(installationId) ?? 0;
  if (cachedUntil > Date.now()) return true;
  try {
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(installationId)}`, {
      headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`RevenueCat returned HTTP ${response.status}`);
    const payload = (await response.json()) as RevenueCatSubscriber;
    const entitlementId = process.env.REVENUECAT_ENTITLEMENT_ID ?? 'premium';
    const entitlement = payload.subscriber?.entitlements?.[entitlementId];
    const active = Boolean(entitlement && (!entitlement.expires_date || Date.parse(entitlement.expires_date) > Date.now()));
    if (active) cache.set(installationId, Date.now() + 5 * 60_000);
    return active;
  } catch (error) {
    console.error('[ingrefit] RevenueCat entitlement check failed', error);
    return false;
  }
}

export async function resolvePlan(request: NextRequest, installationId: string): Promise<Plan> {
  const entitlement = request.headers.get('x-ingrefit-entitlement');
  if (entitlement && verifyEntitlement(entitlement, installationId)) return 'premium';

  const claimedPremium = request.headers.get('x-ingrefit-plan') === 'premium';
  if (!claimedPremium) return 'free';
  if (await hasRevenueCatPremium(installationId)) return 'premium';

  const previewToken = process.env.INGREFIT_EXPO_GO_PREVIEW_TOKEN;
  const authorization = request.headers.get('authorization') ?? '';
  const clientToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (previewToken && safeEqual(clientToken, previewToken)) {
    return 'premium';
  }

  if (process.env.INGREFIT_ALLOW_DEMO_PREMIUM === 'true') {
    return 'premium';
  }
  return 'free';
}
