import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * Admin session.
 *
 * One shared password from the environment, exchanged for a signed cookie. No
 * user table, because there is one operator and inventing accounts for one
 * person is how a small tool grows a login system nobody maintains.
 *
 * The cookie is signed with the same secret that signs Premium entitlements, so
 * there is one secret to rotate rather than two.
 */
const COOKIE = 'ingrefit_admin';
const TTL_SECONDS = 12 * 60 * 60;

function secret(): string | null {
  const value = process.env.INGREFIT_ENTITLEMENT_SECRET;
  return value && value.length >= 32 ? value : null;
}

export function adminConfigured(): boolean {
  return Boolean(secret() && (process.env.INGREFIT_ADMIN_PASSWORD ?? '').length >= 8);
}

function sign(expiry: number): string {
  return createHmac('sha256', secret() ?? '')
    .update(`admin:${expiry}`)
    .digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueAdminCookie(password: string): { name: string; value: string; maxAge: number } | null {
  const expected = process.env.INGREFIT_ADMIN_PASSWORD ?? '';
  if (!adminConfigured() || !safeEqual(password, expected)) return null;
  const expiry = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return { name: COOKIE, value: `${expiry}.${sign(expiry)}`, maxAge: TTL_SECONDS };
}

export async function isAdmin(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const token = (await cookies()).get(COOKIE)?.value ?? '';
  const [expiry, signature] = token.split('.');
  if (!expiry || !signature) return false;
  if (Number(expiry) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sign(Number(expiry)), signature);
}

export const ADMIN_COOKIE = COOKIE;

/**
 * Absolute URL for a redirect, seen from the browser rather than from node.
 *
 * Behind a reverse proxy `request.url` is the internal address the proxy dialled
 * — `http://localhost:3020/...` — and redirecting to it sends the operator's
 * browser to a port that is not published. The public origin comes from
 * INGREFIT_PUBLIC_URL when set, otherwise from the forwarding headers, and only
 * then from the request itself.
 */
export function publicUrl(request: { url: string; headers: Headers }, path: string): URL {
  const configured = process.env.INGREFIT_PUBLIC_URL?.trim();
  if (configured) return new URL(path, configured.replace(/\/$/, '') + '/');

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https';
    return new URL(path, `${proto}://${host}`);
  }
  return new URL(path, request.url);
}
