import type { Plan, UsageSnapshot } from './types';

const LIMITS: Record<Plan, number> = { free: 5, premium: 50 };

interface MemoryEntry {
  value: number;
  expiresAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __ingrefitQuota: Map<string, MemoryEntry> | undefined;
}

function secondsUntilTomorrowUtc(): number {
  const now = new Date();
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((tomorrow - now.getTime()) / 1000));
}

function resetDate(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

function quotaKey(installationId: string): string {
  return `ingrefit:usage:${new Date().toISOString().slice(0, 10)}:${installationId}`;
}

async function redisCommand<T>(command: Array<string | number>): Promise<T | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Quota store returned HTTP ${response.status}`);
  const payload = (await response.json()) as { result: T };
  return payload.result;
}

function memoryValue(key: string): MemoryEntry {
  const store = (globalThis.__ingrefitQuota ??= new Map());
  const current = store.get(key);
  if (current && current.expiresAt > Date.now()) return current;
  const created = { value: 0, expiresAt: Date.now() + secondsUntilTomorrowUtc() * 1000 };
  store.set(key, created);
  return created;
}

function snapshot(used: number, plan: Plan): UsageSnapshot {
  const limit = LIMITS[plan];
  return {
    used: Math.min(used, limit),
    limit,
    remaining: Math.max(0, limit - used),
    plan,
    resetsAt: resetDate(),
  };
}

export async function getUsage(installationId: string, plan: Plan): Promise<UsageSnapshot> {
  const key = quotaKey(installationId);
  try {
    const redisValue = await redisCommand<string | number>(['GET', key]);
    if (redisValue !== null) return snapshot(Number(redisValue) || 0, plan);
  } catch (error) {
    console.error('[ingrefit] Quota read failed; using process-local fallback', error);
  }
  return snapshot(memoryValue(key).value, plan);
}

export async function consumeQuota(
  installationId: string,
  plan: Plan,
): Promise<{ allowed: boolean; usage: UsageSnapshot }> {
  const key = quotaKey(installationId);
  const limit = LIMITS[plan];
  const ttl = secondsUntilTomorrowUtc();
  const script = [
    "local current = tonumber(redis.call('GET', KEYS[1]) or '0')",
    'local max = tonumber(ARGV[1])',
    'if current >= max then return -current end',
    "current = redis.call('INCR', KEYS[1])",
    "if current == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end",
    'return current',
  ].join('\n');

  try {
    const redisValue = await redisCommand<number>(['EVAL', script, 1, key, limit, ttl]);
    if (redisValue !== null) {
      const allowed = redisValue > 0;
      return { allowed, usage: snapshot(Math.abs(redisValue), plan) };
    }
  } catch (error) {
    console.error('[ingrefit] Quota consume failed; using process-local fallback', error);
  }

  const entry = memoryValue(key);
  if (entry.value >= limit) return { allowed: false, usage: snapshot(entry.value, plan) };
  entry.value += 1;
  return { allowed: true, usage: snapshot(entry.value, plan) };
}
