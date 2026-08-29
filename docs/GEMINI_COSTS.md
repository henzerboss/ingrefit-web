# Gemini usage and cost controls

The backend defaults to `gemini-3.1-flash-lite`, with `gemini-2.5-flash-lite` as
a fallback. Each request logs operation-level token counts and an estimated USD
cost; it never logs photos, barcodes, product names or ingredient text.

## What changed in 1.7

| Control | Before | After |
| --- | --- | --- |
| Calls per Premium barcode scan | 2 (translate + explain), always | 0–2; both are cached and translation is skipped when unnecessary |
| Explanation prompt | ~2,500 in / 1,400 out | ~450 in / 350 out |
| Label recognition images | 2 (front + label) | 1+ (front photo is never uploaded) |
| Model fallback | retried on every error, including schema failures | retries only on 429/5xx/timeout/network |
| Free tier | English text in 64 of 66 languages | fully rendered locally, no model call |

### Translation is conditional, and now correct for all 50 languages

`needsTranslation()` inspects the product strings before spending anything.
Results are cached per `barcode + language` forever, so each product is
translated at most once across all users.

Until 1.11 the check had exactly two branches — "target is Russian" and "target
is English" — and the other 48 locales all fell into the second. Two failures
followed from that:

- a Spanish user scanning a Spanish product tripped the diacritics test and
  paid for a Spanish-to-Spanish translation;
- a German user scanning an English product tripped nothing, so the translation
  never ran and a paying user was shown English.

It now detects the language of the text and compares it with the target: script
first, then distinctive label words within the Latin script, with Cyrillic
refined by letters unique to Ukrainian, Serbian, Kazakh and Bulgarian. When the
answer is uncertain it translates, because one cached call is cheaper than
showing a paying user a foreign ingredient list.

The larger saving is upstream: `productFactsFromRaw` now reads
`product_name_<lang>` and `ingredients_text_<lang>` for every supported locale,
so most scans of a locally printed product never reach the model at all. That
also fixes the free tier, which previously showed non-Russian, non-English users
whatever language the record happened to default to.

### Explanations are cached by signal fingerprint

The scorer emits a SHA-256 fingerprint over the signal set, impacts and verdict.
Two scans producing the same signals in the same language reuse the same text.
Popular products converge towards zero explanation cost. Watch the `hits` column
on `ExplanationCache` after launch — a low hit rate means the fingerprint is too
specific.

### The model no longer writes the signal list

Signal labels and evidence are rendered deterministically from
`signalCatalog.ts`. Gemini is asked for exactly two strings — a summary and one
tip — which removed most output tokens and, more importantly, removed the
possibility of the model contradicting a number the scorer already computed.

## Output budgets

| Operation | Max output tokens |
| --- | ---: |
| Score explanation | 400 |
| Food photo recognition | 900 |
| Text enrichment | 1,200 |
| Label recognition | 1,600 |
| Product fact localization | 1,600 |

Images are resized to fit 1024×1024 before upload. Gemini 3.1 runs at the
minimal thinking level; the 2.5 fallback uses a zero thinking budget.

## Rate limits

Vision calls are metered separately from ordinary requests, because they are the
expensive path. Defaults (per hour, override via env):

| Scope | Free | Premium |
| --- | ---: | ---: |
| `analyze` per installation | 120 | 300 |
| AI/vision per installation | 10 | 60 |
| `analyze` per IP | 600 | 600 |

The client token ships inside the mobile bundle and can be extracted, so it
authenticates the app, not the user. Without these limits one extracted token
can drain the Gemini budget.

## Usage logging

```text
[ingrefit] Gemini usage {"operation":"score_explanation","model":"gemini-3.1-flash-lite","promptTokens":460,"outputTokens":210,"thoughtTokens":40,"totalTokens":710,"estimatedCostUsd":0.00049}
```

The price constants in `gemini.ts` reflect Gemini 3.1 Flash-Lite standard rates
at release: **$0.25 per million input tokens** and **$1.50 per million output
tokens including thinking**. Recheck the official pricing page before financial
planning.

- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/tokens
