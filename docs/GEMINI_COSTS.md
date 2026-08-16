# Gemini usage and cost controls

The backend defaults to `gemini-3.1-flash-lite`, with `gemini-2.5-flash-lite` as a fallback. Each request records only operation-level token counts and an estimated USD cost; it does not log photos, barcodes, product names or ingredient text.

## Current controls

- Images are resized before upload to fit inside 1024×1024 without upscaling.
- Gemini 3.1 uses the minimal thinking level; the 2.5 fallback uses a zero thinking budget.
- Every operation has a bounded output budget.
- Product explanations receive a compact fact object rather than the full product record.
- Already-localized photo results skip a redundant translation call.
- Sparse barcode data is enriched only when Premium is active and useful source text exists.

| Operation | Max output tokens |
| --- | ---: |
| Food photo recognition | 900 |
| Text enrichment | 1,200 |
| Focused ingredient translation retry | 1,200 |
| Score explanation | 1,400 |
| Label recognition (two photos) | 1,800 |
| Product fact localization | 1,800 |

## Usage logging

For every successful Gemini call, the server writes a structured line such as:

```text
[ingrefit] Gemini usage {"operation":"score_explanation","model":"gemini-3.1-flash-lite","promptTokens":2100,"outputTokens":620,"thoughtTokens":90,"totalTokens":2810,"estimatedCostUsd":0.00159}
```

This makes production cost measurable per operation. Use actual PM2 logs to calculate average and percentile costs before changing prompts or limits.

The price constants in `gemini.ts` reflect the Gemini 3.1 Flash-Lite standard API rates current at the time of this release: **$0.25 per million input tokens** and **$1.50 per million output tokens including thinking**. Recheck the official pricing page before financial planning because model pricing can change.

Official references:

- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/tokens
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
