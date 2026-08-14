import { createHmac } from 'node:crypto';

const [installationId, daysText = '30'] = process.argv.slice(2);
const secret = process.env.INGREFIT_ENTITLEMENT_SECRET;

if (!installationId || !/^[A-Za-z0-9_-]{16,128}$/.test(installationId)) {
  console.error('Usage: INGREFIT_ENTITLEMENT_SECRET=... node scripts/create-entitlement.mjs <installation-id> [days]');
  process.exit(1);
}
if (!secret || secret.length < 32) {
  console.error('INGREFIT_ENTITLEMENT_SECRET must contain at least 32 characters.');
  process.exit(1);
}

const days = Number(daysText);
if (!Number.isFinite(days) || days <= 0 || days > 3650) {
  console.error('days must be a number between 1 and 3650.');
  process.exit(1);
}

const payload = Buffer.from(JSON.stringify({
  installationId,
  plan: 'premium',
  exp: Math.floor(Date.now() / 1000) + Math.round(days * 86_400),
})).toString('base64url');
const signature = createHmac('sha256', secret).update(payload).digest('base64url');
process.stdout.write(`${payload}.${signature}\n`);
