# IngreFit API contract

All protected requests require:

```http
Authorization: Bearer <INGREFIT_CLIENT_TOKEN>
X-IngreFit-Installation: <persistent-random-uuid>
X-IngreFit-Plan: free|premium
X-IngreFit-Entitlement: <signed-token>  # required for Premium in production
```

The static client token is an application allowlist, not user authentication. Production Premium is resolved only from the verified entitlement.

## Analyze a barcode

`POST /api/ingrefit/analyze`

```json
{
  "barcode": "3017624010701",
  "locale": "ru-RU",
  "profile": {
    "goals": ["low_sugar", "high_protein"],
    "diet": "none",
    "allergens": ["milk"],
    "avoidedIngredients": ["palm oil"]
  }
}
```

If reliable facts exist, response status is `complete`. If the barcode is absent or too incomplete, no quota is consumed:

```json
{
  "status": "needs_photos",
  "barcode": "3017624010701",
  "reason": "not_found",
  "requiredPhotos": ["front", "ingredients", "nutrition"]
}
```

## Analyze label photos

Use the same endpoint and profile. JPEG data is raw base64 without a data-URL prefix. Every image is limited to 6,000,000 base64 characters.

```json
{
  "barcode": "3017624010701",
  "locale": "en-US",
  "profile": {
    "goals": ["balanced"],
    "diet": "vegetarian",
    "allergens": [],
    "avoidedIngredients": []
  },
  "photos": [
    { "kind": "front", "mimeType": "image/jpeg", "base64": "..." },
    { "kind": "ingredients", "mimeType": "image/jpeg", "base64": "..." },
    { "kind": "nutrition", "mimeType": "image/jpeg", "base64": "..." }
  ]
}
```

A complete response contains normalized facts, the fixed scoring evidence and quota snapshot:

```json
{
  "status": "complete",
  "product": {
    "source": "openfoodfacts",
    "barcode": "3017624010701",
    "name": "Product name",
    "brand": "Brand",
    "ingredientsText": "...",
    "allergens": ["milk"],
    "nutrition": {
      "energyKcal100g": 120,
      "protein100g": 10,
      "sugars100g": 4,
      "salt100g": 0.2
    },
    "completeness": 83,
    "unknownFields": []
  },
  "assessment": {
    "score": 7.5,
    "verdict": "good",
    "summary": "Localized explanation based only on supplied facts.",
    "positives": [],
    "cautions": [],
    "signals": [],
    "dataNotice": "Localized source/completeness notice."
  },
  "usage": {
    "used": 1,
    "limit": 5,
    "remaining": 4,
    "plan": "free",
    "resetsAt": "2026-08-15T00:00:00.000Z"
  }
}
```

Every property shown by the TypeScript `ProductFacts` contract is returned; omitted fields in the abbreviated example above are present as arrays or `null`.

## Errors

- `400 INVALID_REQUEST` — invalid barcode, profile or image payload.
- `401 UNAUTHORIZED` — missing/incorrect client token.
- `422 INSUFFICIENT_LABEL_DATA` — photos remain illegible or incomplete.
- `429 DAILY_LIMIT_REACHED` — completed-analysis allowance is exhausted; response includes limit and reset time.
- `502 AI_UNAVAILABLE` — all configured Gemini models failed during required label transcription.
- `503 AI_NOT_CONFIGURED` — Gemini key is missing.

## Usage

`GET /api/ingrefit/usage` returns the same `UsageSnapshot` without consuming an analysis.
