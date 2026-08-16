import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __ingrefitPrisma: PrismaClient | undefined;
}

/**
 * The database is a cache and an abuse counter, never a source of truth for a
 * user's result. Every caller must therefore tolerate `null`: if PostgreSQL is
 * unreachable the API keeps answering, just at full Gemini cost.
 */
export function getDb(): PrismaClient | null {
  if (!process.env.DATABASE_URL) return null;
  if (!globalThis.__ingrefitPrisma) {
    globalThis.__ingrefitPrisma = new PrismaClient({ log: ['warn', 'error'] });
  }
  return globalThis.__ingrefitPrisma;
}

/** Run a cache operation, swallowing infrastructure failures. */
export async function safeDb<T>(operation: (db: PrismaClient) => Promise<T>): Promise<T | null> {
  const db = getDb();
  if (!db) return null;
  try {
    return await operation(db);
  } catch (error) {
    console.error('[ingrefit] Database operation failed', error);
    return null;
  }
}
