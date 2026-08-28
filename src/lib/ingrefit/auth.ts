import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

import { HttpError } from './http';
import { INSTALLATION_ID_PATTERN, touchInstallation, verifyInstallation } from './installation';
import type { Plan } from './types';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearerToken(request: NextRequest): string {
  const authorization = request.headers.get('authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

export function requireClient(request: NextRequest): string {
  const token = bearerToken(request);
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
  if (!INSTALLATION_ID_PATTERN.test(installationId)) {
    throw new HttpError(400, 'INVALID_INSTALLATION', 'A valid installation id is required.');
  }
  return installationId;
}

interface EntitlementPayload {
  installationId: string;
  plan: 'premium';
  exp: number;
}

/** Lifetime of a server-issued entitlement token. Short enough that a cancelled subscription stops working within a day. */
const ENTITLEMENT_TTL_SECONDS = 24 * 60 * 60;

function entitlementSecret(): string | null {
  const secret = process.env.INGREFIT_ENTITLEMENT_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

/**
 * Issue a signed, expiring Premium entitlement bound to one installation.
 *
 * This is what removes RevenueCat from the hot path: the subscriber lookup
 * happens roughly once a day per device instead of once per request, which also
 * closes the amplification hole where a caller holding only the bundled client
 * token could turn each of its requests into an outbound RevenueCat call.
 */
export function issueEntitlement(installationId: string): { token: string; expiresAt: string } | null {
  const secret = entitlementSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ENTITLEMENT_TTL_SECONDS;
  const payload: EntitlementPayload = { installationId, plan: 'premium', exp };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return { token: `${encoded}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
}

function verifyEntitlement(token: string, installationId: string): boolean {
  const secret = entitlementSecret();
  if (!secret) return false;

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

interface RevenueCatCacheEntry {
  active: boolean;
  until: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __ingrefitRevenueCat: Map<string, RevenueCatCacheEntry> | undefined;
}

/**
 * Positive AND negative caching.
 *
 * Only successes used to be cached, so a caller repeating `X-IngreFit-Plan:
 * premium` with throwaway installation ids produced one outbound RevenueCat
 * request per attempt. Negative answers are cached too, and the map is bounded
 * so it cannot be grown without limit by exactly that traffic.
 */
const REVENUECAT_POSITIVE_TTL_MS = 5 * 60_000;
const REVENUECAT_NEGATIVE_TTL_MS = 60_000;
const REVENUECAT_CACHE_MAX_ENTRIES = 20_000;

function revenueCatCache(): Map<string, RevenueCatCacheEntry> {
  return (globalThis.__ingrefitRevenueCat ??= new Map());
}

function rememberRevenueCat(installationId: string, active: boolean): void {
  const cache = revenueCatCache();
  if (cache.size >= REVENUECAT_CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, entry] of cache) if (entry.until <= now) cache.delete(key);
    if (cache.size >= REVENUECAT_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (typeof oldest === 'string') cache.delete(oldest);
    }
  }
  cache.set(installationId, {
    active,
    until: Date.now() + (active ? REVENUECAT_POSITIVE_TTL_MS : REVENUECAT_NEGATIVE_TTL_MS),
  });
}

async function hasRevenueCatPremium(installationId: string): Promise<boolean> {
  const secret = process.env.REVENUECAT_SECRET_API_KEY;
  if (!secret) return false;
  const cached = revenueCatCache().get(installationId);
  if (cached && cached.until > Date.now()) return cached.active;
  try {
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(installationId)}`, {
      headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404) {
      rememberRevenueCat(installationId, false);
      return false;
    }
    if (!response.ok) throw new Error(`RevenueCat returned HTTP ${response.status}`);
    const payload = (await response.json()) as RevenueCatSubscriber;
    const entitlementId = process.env.REVENUECAT_ENTITLEMENT_ID ?? 'premium';
    const entitlement = payload.subscriber?.entitlements?.[entitlementId];
    const active = Boolean(
      entitlement && (!entitlement.expires_date || Date.parse(entitlement.expires_date) > Date.now()),
    );
    rememberRevenueCat(installationId, active);
    return active;
  } catch (error) {
    console.error('[ingrefit] RevenueCat entitlement check failed', error);
    // Cache the failure briefly too: an upstream outage must not become a
    // retry storm against RevenueCat.
    rememberRevenueCat(installationId, false);
    return false;
  }
}

/**
 * Whether an unregistered installation may still claim Premium.
 *
 * Flip to `true` once every build in the wild registers an installation secret.
 * Until then unregistered clients keep working through the legacy path, so a
 * server deploy never locks an existing paying user out.
 */
function proofRequired(): boolean {
  return process.env.INGREFIT_REQUIRE_INSTALLATION_PROOF === 'true';
}

export interface PlanContext {
  plan: Plan;
  /** True when the caller proved possession of the installation secret. */
  proven: boolean;
}

/**
 * Resolve the caller's plan.
 *
 * Order is deliberate:
 *   1. a server-issued entitlement token (cheap, offline, bound to the id);
 *   2. proof of possession, when the installation is registered;
 *   3. RevenueCat, cached in both directions.
 *
 * Callers must already have consumed a rate-limit unit before reaching here,
 * because step 3 can make an outbound request.
 */
export async function resolvePlanContext(request: NextRequest, installationId: string): Promise<PlanContext> {
  const proof = await verifyInstallation(
    installationId,
    request.headers.get('x-ingrefit-signature'),
    new URL(request.url).pathname,
    proofRequired(),
  );
  if (proof.proven) touchInstallation(installationId);

  // A registered installation that does not sign its request is either a stale
  // build or somebody replaying an id they saw in a log. Either way it must not
  // reach the paid path.
  const trusted = proof.proven || (!proof.registered && !proofRequired());

  const entitlement = request.headers.get('x-ingrefit-entitlement');
  if (trusted && entitlement && verifyEntitlement(entitlement, installationId)) {
    return { plan: 'premium', proven: proof.proven };
  }

  const claimedPremium = request.headers.get('x-ingrefit-plan') === 'premium';
  if (!claimedPremium || !trusted) return { plan: 'free', proven: proof.proven };

  if (await hasRevenueCatPremium(installationId)) return { plan: 'premium', proven: proof.proven };

  const previewToken = process.env.INGREFIT_EXPO_GO_PREVIEW_TOKEN;
  if (previewToken && safeEqual(bearerToken(request), previewToken)) {
    return { plan: 'premium', proven: proof.proven };
  }

  if (process.env.INGREFIT_ALLOW_DEMO_PREMIUM === 'true') {
    return { plan: 'premium', proven: proof.proven };
  }
  return { plan: 'free', proven: proof.proven };
}

export async function resolvePlan(request: NextRequest, installationId: string): Promise<Plan> {
  return (await resolvePlanContext(request, installationId)).plan;
}
