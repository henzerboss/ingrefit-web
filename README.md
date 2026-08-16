# IngreFit.com website and API

Next.js 16.3 project with a 68-locale landing/legal structure plus the API used by the Expo application. English and Russian are translated; other locale JSON files currently contain the English source copy.

## Run and deploy

```bash
cp .env.example .env
npm ci
npm run typecheck
npm run build
PORT=3020 npm start
```

For CloudPanel/Nginx, allow AI photo payloads in the site vhost (for example `client_max_body_size 15M;`) before the proxy location, then reload Nginx. Two compressed label images are sent in one JSON request.

Required production values: `GEMINI_API_KEY`, `INGREFIT_CLIENT_TOKENS`, `OPEN_FOOD_FACTS_USER_AGENT`, `REVENUECAT_SECRET_API_KEY` and `REVENUECAT_ENTITLEMENT_ID`.

## Routes

- `POST /api/ingrefit/analyze` — barcode, Premium label-photo or Premium unpackaged-food analysis.
- `GET /api/ingrefit/usage` — compatibility snapshot; barcode scans have no daily quota.
- `GET /api/ingrefit/health` — configuration health without secret values.
- `GET /api/ingrefit/version` — platform-specific latest/minimum version and store URL for the launch update prompt.
- `/{locale}` — landing page for every locale listed in `src/i18n/locales.ts`.
- `/{locale}/privacy`, `/{locale}/terms` — localized legal routes.

The landing page supports system, light and dark themes and links directly to the configured App Store and Google Play listings.

## Evidence-first pipeline

1. Barcode mode checks Open Food Facts v3. English/Russian localized OFF fields are preferred when present.
2. A result is complete only when it has an identifiable product and a useful nutrient set. For Premium, a sparse record with an ingredient statement is cleaned and missing nutrition is cautiously estimated in a separate `estimated_text` layer. If that is still not useful, the API returns `needs_photos`.
3. Label mode sends two images — the package front and one complete information label containing ingredients, allergens and nutrition — to an English strict transcription prompt. If the visible ingredient statement is usable but the nutrition table remains incomplete, the same clearly marked text-estimation layer may fill the practical nutrient profile; otherwise the app asks for a clearer information-label photo. The API temporarily accepts the former three-image request so already-installed clients keep working during rollout.
4. Unpackaged mode identifies the visibly present food, returns confidence and may provide a rounded approximate nutrient profile per 100 g from general food-composition knowledge. Exact ingredients, allergens and nutrition remain unknown; every estimate is explicitly marked as an estimate.
5. Deterministic `scoring.ts` calculates the number before AI writes any explanation. All 12 goals and supported diet modes have explicit rules tied to available fields; visual and text-based nutrition estimates receive reduced weight.
6. Free barcode results use a deterministic fallback explanation. Premium translates source strings and generates a longer explanation in the exact active app language. Arabic and Hebrew pages use RTL direction.

The exact score thresholds and adjustments, including the explicit alcohol penalty, are documented in [`docs/SCORING.md`](docs/SCORING.md). Gemini request budgets and operation-level cost logging are documented in [`docs/GEMINI_COSTS.md`](docs/GEMINI_COSTS.md).

## App update prompt

The app checks `GET /api/ingrefit/version` at launch. Set the four `INGREFIT_*_LATEST_VERSION` and `INGREFIT_*_MINIMUM_VERSION` values in `.env`, rebuild/restart the server, and raise a `LATEST` value only after that store release is available. Raising `MINIMUM` makes the prompt non-dismissible for older builds.

## Store links and analytics

- App Store: `https://apps.apple.com/app/id6801561360`
- Google Play: `https://play.google.com/store/apps/details?id=store.evsi.ingrefit`
- Google Analytics: `G-P2ZSBZ3YST`
- Landing goals include hero/navigation/pricing CTA clicks and separate iOS/Android download clicks.

The emitted goal events are `hero_download_click`, `hero_how_click`, `pricing_cta_click`, `download_ios_click` and `download_android_click`. Mark the three download/pricing events as key events in Google Analytics after they first appear in the property.

## Premium verification

RevenueCat is configured in the mobile app with the persistent installation UUID as App User ID. The server requests that same subscriber from RevenueCat using `REVENUECAT_SECRET_API_KEY` and checks the configured entitlement. Client-provided plan headers are not trusted.

`INGREFIT_EXPO_GO_PREVIEW_TOKEN` is an optional development-only escape hatch because Expo Go purchases are mocks and cannot create a real server entitlement. Use that temporary value as the app's `EXPO_PUBLIC_CLIENT_TOKEN` while testing photo flows; the server automatically accepts it as a client token. Remove it before distributing the app. `INGREFIT_ALLOW_DEMO_PREMIUM=true` is a broader convenience switch for preview servers; it must be set back to `false` before distribution.

Legacy HMAC entitlements remain supported for migrations via `INGREFIT_ENTITLEMENT_SECRET`.

## Important product rule

**Declared facts and estimates are never mixed silently.** Empty allergen data never means allergen-free. AI may provide clearly labelled approximate nutrition from a visible food or a credible product/ingredient identity, but never turns estimates into package claims or invents allergens. IngreFit provides general information, not medical advice; users must verify packaging for allergies and medical conditions.
