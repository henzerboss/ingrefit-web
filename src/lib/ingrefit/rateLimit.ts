import { getDb } from './db';
import { HttpError } from './http';

/**
 * Abuse protection for /api/ingrefit/analyze.
 *
 * The client token ships inside the mobile bundle and can be extracted, so it
 * authenticates the app, not the user. Without a limiter a single extracted
 * token can drain the Gemini budget. Limits are deliberately generous for real
 * shopping behaviour and tight enough to make scripted abuse pointless.
 */

export type LimitScope = 'analyze:installation' | 'analyze:ip' | 'ai:installation';

interface LimitConfig {
  limit: number;
  windowMs: number;
}

function readInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

const HOUR = 60 * 60 * 1000;

function configFor(scope: LimitScope, premium: boolean): LimitConfig {
  switch (scope) {
    case 'analyze:installation':
      return {
        limit: premium
          ? readInt('INGREFIT_LIMIT_ANALYZE_PREMIUM', 300)
          : readInt('INGREFIT_LIMIT_ANALYZE_FREE', 120),
        windowMs: HOUR,
      };
    case 'ai:installation':
      return {
        limit: premium
          ? readInt('INGREFIT_LIMIT_AI_PREMIUM', 60)
          : readInt('INGREFIT_LIMIT_AI_FREE', 10),
        windowMs: HOUR,
      };
    case 'analyze:ip':
      return { limit: readInt('INGREFIT_LIMIT_ANALYZE_IP', 600), windowMs: HOUR };
  }
}

// In-memory fallback so the limiter still works before the database exists.
const memory = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.resetAt <= now) memory.delete(key);
  }
}, 10 * 60 * 1000).unref?.();

function consumeInMemory(key: string, config: LimitConfig): { allowed: boolean; resetAt: number; remaining: number } {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    const resetAt = now + config.windowMs;
    memory.set(key, { count: 1, resetAt });
    return { allowed: true, resetAt, remaining: config.limit - 1 };
  }
  if (entry.count >= config.limit) {
    return { allowed: false, resetAt: entry.resetAt, remaining: 0 };
  }
  entry.count += 1;
  return { allowed: true, resetAt: entry.resetAt, remaining: config.limit - entry.count };
}

async function consumeInDatabase(
  key: string,
  scope: LimitScope,
  config: LimitConfig,
): Promise<{ allowed: boolean; resetAt: number; remaining: number } | null> {
  const db = getDb();
  if (!db) return null;
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / config.windowMs) * config.windowMs);
  const expiresAt = new Date(windowStart.getTime() + config.windowMs);
  const id = `${scope}:${key}:${windowStart.getTime()}`;

  try {
    const row = await db.rateLimitWindow.upsert({
      where: { id },
      create: { id, scope, windowStart, expiresAt, count: 1 },
      update: { count: { increment: 1 } },
    });
    return {
      allowed: row.count <= config.limit,
      resetAt: expiresAt.getTime(),
      remaining: Math.max(0, config.limit - row.count),
    };
  } catch (error) {
    console.error('[ingrefit] Rate limit persistence failed; using in-memory counter', error);
    return null;
  }
}

export interface RateLimitResult {
  remaining: number;
  resetAt: number;
  limit: number;
}

/** Consume one unit; throws HttpError 429 when the window is exhausted. */
export async function enforceLimit(scope: LimitScope, key: string, premium: boolean): Promise<RateLimitResult> {
  const config = configFor(scope, premium);
  const outcome = (await consumeInDatabase(key, scope, config)) ?? consumeInMemory(`${scope}:${key}`, config);
  if (!outcome.allowed) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.', {
      scope,
      retryAfterSeconds: Math.max(1, Math.ceil((outcome.resetAt - Date.now()) / 1000)),
    });
  }
  return { remaining: outcome.remaining, resetAt: outcome.resetAt, limit: config.limit };
}

/** Best-effort cleanup of expired counter rows. */
export async function pruneRateLimitWindows(): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.rateLimitWindow.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (error) {
    console.error('[ingrefit] Rate limit cleanup failed', error);
  }
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const candidate = forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || '';
  return candidate || 'unknown-ip';
}
