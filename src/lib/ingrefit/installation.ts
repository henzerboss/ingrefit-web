import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { getDb, safeDb } from './db';
import { HttpError } from './http';

/**
 * Proof of possession for an installation.
 *
 * `X-IngreFit-Installation` used to be a pure bearer value: the header alone
 * decided which RevenueCat subscriber was looked up, so knowing another user's
 * id was enough to be served as Premium. The id travels in every request
 * header, appears in proxy logs and in the RevenueCat dashboard, so "hard to
 * guess" was the only thing protecting it.
 *
 * The app now generates a 32-byte secret at first launch, registers it once
 * over TLS (trust on first use) and never sends it again. Every request
 * afterwards carries a signature over (timestamp, installation id, path). An
 * attacker holding only the id cannot produce one.
 *
 * Registration is write-once. A second registration for an id that already
 * exists is rejected unless it presents a valid signature with the existing
 * secret, so an id observed in a log cannot be hijacked by re-registering it.
 */

/** How far a client clock may drift before its signature is refused. */
const SIGNATURE_WINDOW_SECONDS = 300;

export const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export const INSTALLATION_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Keyed digest, nested so the construction is not vulnerable to SHA-256 length
 * extension. React Native has SHA-256 through expo-crypto but no HMAC, and the
 * two sides must compute the same thing, so this is defined here rather than
 * reaching for `createHmac`.
 */
export function signPayload(secret: string, payload: string): string {
  return sha256(`${secret}:${sha256(`${secret}:${payload}`)}`);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newInstallationSecret(): string {
  return randomBytes(32).toString('base64url');
}

export interface InstallationProof {
  /** The installation exists in our records. */
  registered: boolean;
  /** A valid signature for this request was presented. */
  proven: boolean;
}

/** Canonical string both sides sign. Path is included so a captured signature cannot be replayed against a different endpoint. */
function payloadFor(installationId: string, timestamp: string, path: string): string {
  return `${installationId}\n${timestamp}\n${path}`;
}

async function readSecret(installationId: string): Promise<string | null> {
  const row = await safeDb((db) =>
    db.installation.findUnique({ where: { id: installationId }, select: { secret: true } }),
  );
  return row?.secret ?? null;
}

/**
 * Verify the signature header, if any.
 *
 * A database outage must not lock every user out, so an unreachable database
 * degrades to `registered: false` and the caller decides what that means.
 */
export async function verifyInstallation(
  installationId: string,
  signatureHeader: string | null,
  path: string,
  proofRequired: boolean,
): Promise<InstallationProof> {
  // A client that sends no signature cannot be proven either way, so while
  // unsigned clients are still allowed there is nothing to learn from the
  // lookup. Skipping it keeps every app build already in the wild at exactly
  // the request cost it had before, and avoids one failed query per request in
  // the window between deploying the code and running the migration.
  if (!signatureHeader && !proofRequired) return { registered: false, proven: false };

  const secret = await readSecret(installationId);
  if (!secret) return { registered: false, proven: false };
  if (!signatureHeader) return { registered: true, proven: false };

  const [timestamp, signature] = signatureHeader.split('.');
  if (!timestamp || !signature || !/^\d{10,13}$/.test(timestamp)) return { registered: true, proven: false };

  const seconds = timestamp.length > 10 ? Math.floor(Number(timestamp) / 1000) : Number(timestamp);
  if (Math.abs(Math.floor(Date.now() / 1000) - seconds) > SIGNATURE_WINDOW_SECONDS) {
    return { registered: true, proven: false };
  }

  const expected = signPayload(secret, payloadFor(installationId, timestamp, path));
  return { registered: true, proven: safeEqual(expected, signature) };
}

/**
 * Trust-on-first-use registration.
 *
 * Returns silently when the id is already registered with this exact secret
 * (the app retries registration after a failed request), and rejects when the
 * id exists with a different one.
 */
export async function registerInstallation(installationId: string, secret: string): Promise<void> {
  if (!INSTALLATION_ID_PATTERN.test(installationId)) {
    throw new HttpError(400, 'INVALID_INSTALLATION', 'A valid installation id is required.');
  }
  if (!INSTALLATION_SECRET_PATTERN.test(secret)) {
    throw new HttpError(400, 'INVALID_INSTALLATION_SECRET', 'A valid installation secret is required.');
  }
  const db = getDb();
  if (!db) {
    // Without persistence there is nothing to bind to. Report it rather than
    // pretending the installation is protected.
    throw new HttpError(503, 'INSTALLATION_UNAVAILABLE', 'Installation registration is temporarily unavailable.');
  }

  const existing = await db.installation.findUnique({ where: { id: installationId }, select: { secret: true } });
  if (existing) {
    if (!safeEqual(existing.secret, secret)) {
      throw new HttpError(409, 'INSTALLATION_TAKEN', 'This installation id is already registered.');
    }
    await db.installation.update({ where: { id: installationId }, data: { lastSeenAt: new Date() } });
    return;
  }
  await db.installation.create({ data: { id: installationId, secret } });
}

/** Best-effort activity stamp, used to prune abandoned installations. */
export function touchInstallation(installationId: string): void {
  void safeDb((db) => db.installation.update({ where: { id: installationId }, data: { lastSeenAt: new Date() } }));
}
