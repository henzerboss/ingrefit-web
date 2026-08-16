# IngreFit API contract

Protected requests require `Authorization: Bearer <client token>` and `X-IngreFit-Installation: <persistent UUID>`. `X-IngreFit-Plan` is a UI hint only; Premium is verified server-side with RevenueCat or a legacy signed entitlement.

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

Known products return `status: complete` only when the record has an identifiable product and at least four useful nutrient values. For verified Premium requests, a sparse record with an ingredient statement may be cleaned and completed with clearly marked approximate values (`nutritionBasis: "estimated_text"`). If the enriched record is still insufficient, the response is `status: needs_photos` with required photo kinds.

## Premium package label

Use `mode: label`, `premiumFeatures: true`, optional barcode and exactly three JPEG base64 images with kinds `front`, `ingredients`, `nutrition`. A readable ingredient statement can support a clearly marked approximate nutrient profile when the nutrition table remains incomplete; otherwise `422 INSUFFICIENT_LABEL_DATA` asks for clearer photos.

## Premium food without packaging

Use `mode: unpackaged`, `premiumFeatures: true`, a null barcode and exactly one JPEG image with kind `food`. The response source is `ai_photo`; `identificationConfidence` is 0–1. The response may include a rounded approximate nutrient profile per 100 g with `nutritionBasis: "estimated_visual"` and `nutritionEstimateConfidence`. Ingredients, allergens and exact nutrition remain unknown because appearance cannot prove them.

## Complete response

The response contains normalized `product`, deterministic `assessment` and a compatibility `usage` snapshot. `assessment.aiEnhanced` and `assessment.translated` say whether the two Premium enhancements were applied. `nutritionReference` identifies 100 g, 100 ml or serving; `nutritionBasis` is `declared`, `estimated_visual` or `estimated_text` and always separates package facts from estimates.

## Errors

- `400 INVALID_REQUEST` — request/profile/image shape is invalid.
- `401 UNAUTHORIZED` — client token or installation id is invalid.
- `402 PREMIUM_REQUIRED` — photo/AI/translation was requested without a verified entitlement.
- `422 INSUFFICIENT_LABEL_DATA` — the three label photos remain illegible or incomplete.
- `422 INSUFFICIENT_PHOTO_DATA` — the unpackaged-food photo does not support a useful identification and nutrition estimate.
- `502 AI_UNAVAILABLE` — configured Gemini models failed during a required Premium operation.
- `503 AI_NOT_CONFIGURED` — Gemini is not configured.
