# IngreFit API contract

Protected requests require `Authorization: Bearer <client token>` and `X-IngreFit-Installation: <persistent UUID>`. `X-IngreFit-Plan` is a UI hint only; Premium is verified server-side with RevenueCat or a legacy signed entitlement.

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

Known products return `status: complete`. Missing/insufficient products return `status: needs_photos` with required photo kinds and do not fail the barcode flow.

## Premium package label

Use `mode: label`, `premiumFeatures: true`, optional barcode and exactly three JPEG base64 images with kinds `front`, `ingredients`, `nutrition`.

## Premium food without packaging

Use `mode: unpackaged`, `premiumFeatures: true`, a null barcode and exactly one JPEG image with kind `food`. The response source is `ai_photo`; `identificationConfidence` is 0–1. The response may include a rounded approximate nutrient profile per 100 g with `nutritionBasis: "estimated_visual"` and `nutritionEstimateConfidence`. Ingredients, allergens and exact nutrition remain unknown because appearance cannot prove them.

## Complete response

The response contains normalized `product`, deterministic `assessment` and a compatibility `usage` snapshot. `assessment.aiEnhanced` and `assessment.translated` say whether the two Premium enhancements were applied. `nutritionReference` identifies 100 g, 100 ml or serving; `nutritionBasis` separates declared values from visual estimates.

## Errors

- `400 INVALID_REQUEST` — request/profile/image shape is invalid.
- `401 UNAUTHORIZED` — client token or installation id is invalid.
- `402 PREMIUM_REQUIRED` — photo/AI/translation was requested without a verified entitlement.
- `422 INSUFFICIENT_LABEL_DATA` — the three label photos remain illegible or incomplete.
- `502 AI_UNAVAILABLE` — configured Gemini models failed during a required Premium operation.
- `503 AI_NOT_CONFIGURED` — Gemini is not configured.
