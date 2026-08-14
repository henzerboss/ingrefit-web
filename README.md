# IngreFit.com website and API

Next.js 16.3 project containing the English/Russian landing page and the backend used by the Expo app. The API route layout is intentionally compatible with the `evsi.store` App Router structure.

## Run

Requirements: Node.js 22.13 or newer.

```bash
cp .env.example .env.local
npm install
npm run dev
```

At minimum, configure `GEMINI_API_KEY`, `INGREFIT_CLIENT_TOKENS`, `OPEN_FOOD_FACTS_USER_AGENT` and a 32+ character `INGREFIT_ENTITLEMENT_SECRET`. For production, also configure Upstash Redis REST credentials so daily limits remain durable and atomic across serverless instances.

## Routes

- `POST /api/ingrefit/analyze` — barcode lookup or three-photo label recognition, deterministic scoring, localized explanation.
- `GET /api/ingrefit/usage` — current server-side daily allowance.
- `GET /api/ingrefit/health` — configuration health without exposing secret values.
- `/en` and `/ru` — localized landing pages.
- `/en/privacy`, `/ru/privacy`, `/en/terms`, `/ru/terms` — starter legal pages that require counsel review.

See [docs/API.md](docs/API.md) for request and response contracts.

## Evidence-first pipeline

1. Barcode-only request checks Open Food Facts v3 with a custom User-Agent and a 24-hour Next.js fetch cache.
2. A missing or insufficient product returns `needs_photos` without consuming the daily quota.
3. Three package photos are passed to a strict Gemini transcription prompt. Scalar unknowns must be `null`; claims and allergens cannot be inferred.
4. `scoring.ts` calculates the 1–10 score from immutable facts and user goals. Allergy/avoid-list conflicts cap the result.
5. A second Gemini prompt receives only normalized facts, fixed score and fixed signals. It localizes/explains them in the supplied device language and cannot change the number.
6. If explanation generation fails, a factual English/Russian fallback is returned instead of fabricating copy.

All Gemini prompts are written in English. The request’s full `locale` tag is included explicitly in the explanation prompt.

## Daily limits

- Free: 5 completed product analyses per UTC day.
- Premium: 50 completed product analyses per UTC day.

When Upstash is configured, a Lua operation checks and increments usage atomically. Without it, the app uses a process-local map for development only; this is not durable in serverless production.

The plan header is not trusted in production. Premium requires an HMAC-SHA256 entitlement bound to an installation id and expiry. The included helper can produce a test token:

```bash
INGREFIT_ENTITLEMENT_SECRET="your-32-character-or-longer-secret" \
node scripts/create-entitlement.mjs INSTALLATION_ID 30
```

In production, issue tokens from a verified billing webhook, not from a public route.

## Merge into evsi.store

The standalone project can be deployed as `IngreFit.com`. To host the routes inside `evsi.store` instead:

1. Copy `src/app/api/ingrefit` into the existing project’s `src/app/api` directory.
2. Copy `src/lib/ingrefit` into its `src/lib` directory.
3. Add `zod` if the existing project does not already include it.
4. Merge the variables from `.env.example` into the deployment environment.
5. Keep the existing project’s authentication/middleware rules from intercepting native API requests, or explicitly allow `/api/ingrefit/*`.

The Gemini helper follows the supplied `evsi.store` pattern: Google `generateContent` REST calls, JSON response MIME type/schema, an English system instruction and an ordered fallback model chain.

## Production checklist

- Register the app/use case with Open Food Facts and use a real contact in the User-Agent.
- Configure Upstash and verify quotas in a multi-instance preview.
- Replace demo subscription handling with verified store webhooks.
- Add account-based identity or device attestation if reinstall-resistant quotas are required.
- Decide and document image/log retention; redact request bodies from platform logs.
- Add abuse controls at the edge (IP/device throttling and body-size limits).
- Replace the early-access `mailto:` CTA with your mailing-list provider.
- Replace the legal placeholders and contact details after legal review.
