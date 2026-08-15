# IngreFit.com website and API

Next.js 16.3 project with English/Russian landing and legal pages plus the API used by the Expo application.

## Run and deploy

```bash
cp .env.example .env
npm ci
npm run typecheck
npm run build
PORT=3020 npm start
```

Required production values: `GEMINI_API_KEY`, `INGREFIT_CLIENT_TOKENS`, `OPEN_FOOD_FACTS_USER_AGENT`, `REVENUECAT_SECRET_API_KEY` and `REVENUECAT_ENTITLEMENT_ID`.

## Routes

- `POST /api/ingrefit/analyze` — barcode, Premium label-photo or Premium unpackaged-food analysis.
- `GET /api/ingrefit/usage` — compatibility snapshot; barcode scans have no daily quota.
- `GET /api/ingrefit/health` — configuration health without secret values.
- `/en`, `/ru` — localized landing pages.
- `/en/privacy`, `/ru/privacy`, `/en/terms`, `/ru/terms` — localized legal pages.

## Evidence-first pipeline

1. Barcode mode checks Open Food Facts v3. English/Russian localized OFF fields are preferred when present.
2. Missing or insufficient barcode data returns `needs_photos`; the app offers the Premium label flow.
3. Label mode sends front, ingredients and nutrition-table images to an English strict transcription prompt. Missing or unreadable fields stay `null`/empty.
4. Unpackaged mode identifies only the visibly present food and returns confidence. It intentionally leaves exact ingredients, allergens and nutrition unknown.
5. Deterministic `scoring.ts` calculates the number before AI writes anything. All 11 goals and supported diet modes have explicit rules tied to declared fields.
6. Free barcode results use a deterministic English/Russian explanation. Premium can translate source strings and generate a longer explanation; prompts receive the full selected/device language tag.

## Premium verification

RevenueCat is configured in the mobile app with the persistent installation UUID as App User ID. The server requests that same subscriber from RevenueCat using `REVENUECAT_SECRET_API_KEY` and checks the configured entitlement. Client-provided plan headers are not trusted.

`INGREFIT_EXPO_GO_PREVIEW_TOKEN` is an optional development-only escape hatch because Expo Go purchases are mocks and cannot create a real server entitlement. Use that temporary value as the app's `EXPO_PUBLIC_CLIENT_TOKEN` while testing photo flows; the server automatically accepts it as a client token. Remove it before distributing the app. `INGREFIT_ALLOW_DEMO_PREMIUM=true` is a broader convenience switch for preview servers; it must be set back to `false` before distribution.

Legacy HMAC entitlements remain supported for migrations via `INGREFIT_ENTITLEMENT_SECRET`.

## Important product rule

**AI reads, translates and explains; it does not invent product facts.** Empty allergen data never means allergen-free. Visual food identification never supplies hidden recipes or precise nutrition. IngreFit provides general information, not medical advice; users must verify packaging for allergies and medical conditions.
