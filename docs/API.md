# IngreFit API contract

Protected requests require `Authorization: Bearer <client token>` and `X-IngreFit-Installation: <persistent UUID>`. `X-IngreFit-Plan` is a UI hint only; Premium is verified server-side.

## Installation identity

The client token ships inside the mobile bundle and authenticates the app, not the user. The installation id travels in every request header, so on its own it is a bearer credential: anyone who saw it in a log could be served as that subscriber.

On first launch the app generates a 32-byte secret and registers it once:

`POST /api/ingrefit/installation` with `{ "installationId": "...", "secret": "..." }`

Registration is write-once. Re-registering an existing id with a different secret returns `409 INSTALLATION_TAKEN`, so an id observed in a log cannot be hijacked.

Afterwards the secret never leaves the device. Every request carries

`X-IngreFit-Signature: <unixSeconds>.<signature>`

where `signature = SHA256(secret + ":" + SHA256(secret + ":" + payload))` and `payload = installationId + "\n" + timestamp + "\n" + requestPath`. React Native has SHA-256 but no HMAC, hence the nested construction rather than `createHmac`; nesting is what keeps it free of SHA-256 length extension. Signatures older or newer than five minutes are refused.

A registered installation that presents no valid signature is served as `free`. Unregistered installations keep working through the legacy path until `INGREFIT_REQUIRE_INSTALLATION_PROOF=true`, which should be set once no old build is left in the wild.

## Entitlement

`POST /api/ingrefit/entitlement` verifies the subscription once and returns a signed token bound to the installation, valid 24 hours:

```json
{ "plan": "premium", "token": "<payload>.<signature>", "expiresAt": "2026-08-28T09:00:00.000Z" }
```

The app sends it back as `X-IngreFit-Entitlement` on every request. This is what keeps RevenueCat out of the per-request path: the subscriber lookup happens about once a day per device instead of once per request. RevenueCat answers are additionally cached in **both** directions, so repeated `X-IngreFit-Plan: premium` claims with throwaway installation ids cannot be turned into outbound requests on our account.

## Rate limits

Every route consumes a per-IP window **before** the plan is resolved, because resolving a plan may reach out to RevenueCat. `/api/ingrefit/usage` is metered like the rest and reports the real remaining budget:

```json
{
  "plan": "premium",
  "analyze": { "used": 12, "limit": 300, "remaining": 288, "resetsAt": "..." },
  "ai": { "used": 3, "limit": 60, "remaining": 57, "resetsAt": "..." }
}
```

## App version

`GET /api/ingrefit/version?platform=ios&currentVersion=1.5.0` returns `latestVersion`, `updateAvailable`, `required` and the official platform store URL. The route is authenticated like the analysis API and does not expose server secrets. `LATEST_VERSION` controls the optional prompt; `MINIMUM_VERSION` controls whether it can be dismissed.

## Barcode

`POST /api/ingrefit/analyze`

```json
{
  "mode": "barcode",
  "barcode": "3017624010701",
  "locale": "ru-RU",
  "premiumFeatures": false,
  "profile": {
    "goals": ["low_sugar", "heart_health"],
    "diet": "none",
    "allergens": ["milk"],
    "avoidedIngredients": ["palm oil"]
  }
}
```

Known products return `status: complete` only when the record has an identifiable product and at least four useful nutrient values. For verified Premium requests, a sparse record with an ingredient statement may be cleaned and completed with clearly marked approximate values (`nutritionBasis: "estimated_text"`). If the enriched record is still insufficient, the response is `status: needs_photos` with `requiredPhotos: ["label"]`.

Barcode lookups are served from the product cache, then the optional local Open Food Facts mirror, then the public API (see `docs/DATABASE.md`).

## Premium package label

Use `mode: label`, `premiumFeatures: true`, an optional barcode and **at least one** JPEG base64 image whose kind is `label` (or the legacy `ingredients` / `nutrition`). That image should include the full ingredient/allergen statement and nutrition table.

A `front` photo is accepted for backwards compatibility but is **ignored and never sent to the model**: the package front carries no extractable facts and would cost roughly a third of the request's vision tokens. Current clients keep it on the device as a result thumbnail and do not upload it.

A readable ingredient statement can support a clearly marked approximate nutrient profile when the nutrition table is incomplete; otherwise `422 INSUFFICIENT_LABEL_DATA` asks for a clearer photo.

## Premium food without packaging

Use `mode: unpackaged`, `premiumFeatures: true`, a null barcode and exactly one JPEG image with kind `food`. The response source is `ai_photo`; `identificationConfidence` is 0–1. The response may include a rounded approximate nutrient profile per 100 g with `nutritionBasis: "estimated_visual"` and `nutritionEstimateConfidence`. Ingredients, allergens and exact nutrition remain unknown because appearance cannot prove them.


## Premium similar products with a higher IngreFit Score

`POST /api/ingrefit/recommendations` is available only to a server-verified Premium installation. It accepts a barcode, locale, ISO-3166 alpha-2 `marketCountry` from the device region, and the same profile shape as analysis. The server never trusts a client score: it reloads the scanned product, scores it again with the deterministic scorer, and returns at most ten alternatives.

Candidates are fetched with the category and market gates applied **in SQL**, against GIN indexes on both `OffProduct` and `ProductCache` (`scripts/add-recommendation-index.sql`). The most specific canonical category tag is queried first; parent tags are added only while the candidate pool is below target, which keeps a niche category from producing an empty block while still ranking like-for-like matches far above near-misses. Broad aisle tags such as `foods`, `snacks`, `dairies` and `beverages` are excluded from the focus list entirely, so nutrition similarity alone can never turn milk into canned food.

Candidates must also pass a recommendation-specific data-quality gate, be listed by Open Food Facts for the user's current market (`countries_tags`, or `en:world`), and carry at least six independent nutrient facts.

Every request logs a one-line `[ingrefit] Recommendations` record with the candidate count, how many category tags were needed, and a per-reason rejection breakdown (`market`, `category`, `sparse_facts`, `quality_gate`, `blocked`, `low_confidence`, `no_gain`, `duplicate`). Six independent gates sit between a scan and a suggestion, and without those counters an empty block is indistinguishable from "nothing better exists". Sparse all-zero macro profiles without ingredient evidence are rejected except for categories where that profile is expected (for example plain water). When a profile contains allergens, an avoid list or a diet restriction, ingredient evidence is mandatory. Candidates that conflict with those restrictions are rejected, and a normal (non-blocked) source product requires both a higher personalized score and a higher base-quality score.

The local OFF mirror should first be enriched with `--backfill-countries` and `--backfill-nutrition-basis` if it predates this feature, then have both expression GIN indexes from `scripts/add-recommendation-index.sql`:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS off_product_categories_tags_gin
ON "OffProduct" USING GIN ((data->'categories_tags'));
CREATE INDEX CONCURRENTLY IF NOT EXISTS off_product_countries_tags_gin
ON "OffProduct" USING GIN ((data->'countries_tags'));
```

A selected alternative can be opened with `POST /api/ingrefit/recommendation-product`. That route is Premium-only and runs a deterministic OFF lookup plus the normal scorer with AI enrichment disabled.

The endpoint checks for both exact index names before querying the large mirror. If it is not present, it only searches the small recent `ProductCache` pool and otherwise returns an empty list; the main analysis path is never slowed or broken by recommendation infrastructure.

Example response:

```json
{
  "recommendations": [
    {
      "product": { "barcode": "...", "name": "...", "imageUrl": "..." },
      "score": 8.1,
      "baseScore": 7.4,
      "delta": 1.3
    }
  ]
}
```

## Complete response

The response contains normalized `product`, deterministic `assessment` and a compatibility `usage` snapshot.

`assessment` fields:

| Field | Meaning |
| --- | --- |
| `score`, `verdict` | Final 1–10 score and verdict. `verdict` may be `blocked`. |
| `baseScore` | Universal product quality before personalization. |
| `personalDelta` | Normalized adjustment from the user's goals, bounded to ±2.5. |
| `confidence` | 0–1 confidence in the underlying data. |
| `blocked` | True when a hard restriction applies. Clients must show a status, not a number. |
| `summary`, `tip` | Personal explanation and one actionable line. |
| `signals[]` | Each carries `scope` (`blocker` / `base` / `personal`), `code`, `impact`, `severity`, `label`, `evidence`. |
| `cached` | The explanation text came from the cache. |

`product` now also carries `additives[]` (code, localized name, `risk`, `basis`, `basisText`), `allergenTags` / `traceTags` (canonical `en:` tags for matching), `nutrientLevels`, `ingredientAnalysis`, `fruitsVegetablesNuts100g`, `ecoScore` and `organic`.

`nutritionReference` identifies 100 g, 100 ml or serving; `nutritionBasis` is `declared`, `estimated_visual` or `estimated_text` and always separates package facts from estimates.

Signal labels and evidence are rendered server-side in the user's language for every tier, including free.

## Errors

- `400 INVALID_REQUEST` — request/profile/image shape is invalid.
- `401 UNAUTHORIZED` — client token or installation id is invalid.
- `402 PREMIUM_REQUIRED` — photo/AI/translation was requested without a verified entitlement.
- `422 INSUFFICIENT_LABEL_DATA` — the two label photos remain illegible or incomplete.
- `422 INSUFFICIENT_PHOTO_DATA` — the unpackaged-food photo does not support a useful identification and nutrition estimate.
Successful responses carry `X-IngreFit-Fact-Source`, a diagnostic header naming what answered the lookup: `cache` (our ProductCache row), `mirror` (the imported dataset), `mirror_thin` (a mirror row too sparse to score, used because `OPEN_FOOD_FACTS_LOCAL_ONLY` is set or the network failed), `network` (a live API call), `ai_label`, `ai_photo`, or `none`. The same value appears as `factsOrigin` in the body. Clients may ignore both.

- `413 PAYLOAD_TOO_LARGE` — the request body exceeds 16 MB.
- `429 RATE_LIMITED` — per-installation or per-IP limit reached. `Retry-After` and `retryAfterSeconds` say when to retry; `X-RateLimit-*` headers are on successful responses.
- `502 AI_UNAVAILABLE` — configured Gemini models failed during a required Premium operation.
- `503 AI_NOT_CONFIGURED` — Gemini is not configured.
