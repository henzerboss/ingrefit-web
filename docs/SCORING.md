# IngreFit scoring rules

The score is deterministic. It is computed before any model is called, and no
model may change it.

```
raw = clamp(baseline + personal, 1, 10)
final = clamp(5.5 + (raw - 5.5) × confidence + warnings, 1, 10)
```

Two properties are non-negotiable and are covered by `npm run test:scoring`:

1. **Baseline quality is always evaluated.** A product is never rewarded simply
   because the user's goals happen not to cover its weaknesses.
2. **Personalization is a normalized weighted average, not a sum.** Selecting
   twelve goals must not add twelve bonuses; scores stay comparable between
   users and between products.

## 1. Baseline quality (identical for every user)

Starts at **5.5** and is adjusted once per applicable signal.

| Signal | Adjustment |
| --- | ---: |
| Nutri-Score A / B / C / D / E | sets the baseline to 8.6 / 7.2 / 5.8 / 4.2 / 2.6 |
| No Nutri-Score: derived nutrient profile | −2.5 … +2.0 (needs ≥3 declared values) |
| No Nutri-Score and <3 values | no adjustment, confidence drops to 0.4 |
| NOVA 1 / 2 / 3 / 4 | +0.5 / +0.2 / −0.3 / −0.9 |
| Any high-attention additive | −1.5 **and** baseline capped at 4.5 |
| Moderate-attention additives | −0.35 each, floored at −1.2 |
| Additive list present and nothing flagged | +0.2 |
| Palm oil detected by ingredient analysis | −0.3 |
| Fruit/vegetable/nut content ≥40% / ≥80% | +0.3 / +0.5 |
| Certified organic label | +0.15 |
| Alcohol ≤1.2% / ≤6% / ≤15% / >15% vol | −0.5 / −1.5 / −2.2 / −3.0 |
| Alcohol above 1.2% vol | final score capped at **4.0** |

The alcohol cap mirrors Nutri-Score, which does not rate alcoholic drinks on
nutrition — otherwise "no sugar, no salt, few calories" would describe vodka.

Beverages are compared on a stricter scale: sugars are doubled and energy is
multiplied by 2.5 before banding, because 10 g of sugar per 100 ml of drink is
not equivalent to 10 g per 100 g of food.

## 2. Personal fit (normalized)

Each rule produces a fit value in **[−1, +1]** from the declared value:

| Rule | +1 | 0 | −1 |
| --- | --- | --- | --- |
| Protein | ≥20 g | ~8–12 g | <5 g |
| Sugars | ≤2 g | ~10 g | >25 g |
| Fiber | ≥6 g | ~3 g | <1.5 g |
| Salt equivalent | ≤0.3 g | ~1.25 g | >1.5 g |
| Saturated fat | ≤1.5 g | ~5 g | >10 g |
| Energy | ≤80 kcal | ~250 kcal | >400 kcal |
| Carbohydrates | ≤5 g | ~20 g | >40 g |
| Processing | NOVA 1 | NOVA 3 | NOVA 4 |

Each rule carries a weight equal to the **strongest interest among the selected
goals** — a maximum, never a sum:

| Rule | Goals that care (weight) |
| --- | --- |
| Protein | more protein 1.0, muscle gain 1.0, steady energy 0.4, weight management 0.3 |
| Sugars | less sugar 1.0, steady energy 0.7, weight management 0.5, balanced 0.5, heart 0.3, digestion 0.2 |
| Fiber | more fiber 1.0, digestion 0.9, heart 0.4, steady energy 0.4, balanced 0.4, weight 0.3 |
| Salt | less salt 1.0, heart 0.7, balanced 0.3 |
| Saturated fat | less saturated fat 1.0, heart 0.8, balanced 0.3, weight 0.2 |
| Energy | weight management 1.0, balanced 0.2 |
| Carbohydrates | low-carb diet 1.0 |
| Processing | less processing 1.0, balanced 0.4, digestion 0.3, heart 0.2, Mediterranean diet 0.5 |

```
raw_personal = (Σ weightᵢ × fitᵢ / Σ weightᵢ) × 2.5 × coverage
personal = bounded(raw_personal) × confidence
coverage = min(1, 0.5 + Σ weight / 4)
```

`coverage` damps the adjustment when only one weak rule matched: a single data
point is weaker evidence about the user than six. Each signal's displayed impact
is its exact share of `personal`, so the numbers on screen add up to the badge.

## 3. Hard restrictions

These set `blocked: true`, force the verdict to `blocked` and cap the score at
2.0. The app shows a status, not a number: a declared allergen is not "a low
score" that can be weighed against other numbers.

| Restriction | Detection |
| --- | --- |
| Selected allergen | canonical `en:` allergen tag, else multilingual ingredient stems |
| Ingredient on the avoid list | ingredient text match |
| Diet conflict | Open Food Facts `ingredients_analysis_tags`, or allergen tags for gluten/dairy |

Non-blocking warnings: declared traces of a selected allergen (−0.3), an
unconfirmed diet status (−0.5), missing allergen data (informational), and an
**unverified** allergen check (informational, confidence capped at 0.70).

### Allergen evidence has three states, not two

The score is computed before any translation, on the source-language facts, so
Premium translation can never remove the text the matcher reads.

| State | Meaning | Effect |
| --- | --- | --- |
| verified | canonical Open Food Facts tags, or the label reader's closed-enum tags | "not found" is a real answer |
| unverified | ingredient text exists but carries no machine-readable declaration | `warning.allergen_unverified`, confidence ≤ 0.70 |
| missing | no declaration and no ingredient text | `warning.allergen_data_missing`, confidence ≤ 0.60 |

The ingredient-stem lists cover a minority of the 50 supported languages, so an
unmatched allergen on an unverified record means *not checked*, not *not
present*, and the result says so. The label reader is therefore asked for
canonical `en:` allergen tags as well as transcribed text: it sees the package
in whatever language it is printed in, which is the only detection path that
scales past the word lists.

Stems are matched at word starts (`orzeszk` covers `orzeszkami`), and each
allergen carries an exclusion list so that "coconut milk" does not block a dairy
allergy and "мускатный орех" does not block a tree-nut allergy.

Diet conflicts rely on Open Food Facts ingredient analysis (`en:non-vegan`,
`en:non-vegetarian`, `en:palm-oil`) rather than translated substring matching.
The analysis is computed upstream from ingredient lists in any language, so a
Polish or Spanish label is handled correctly. Where no structured analysis
exists — AI-read labels — text matching is used, and it **warns rather than
blocks**, because it cannot see through translations.

## 4. Confidence

| Evidence | Confidence effect |
| --- | ---: |
| 8 independent nutrient facts | up to 1.00 |
| 7 / 6 / 5 / 4 nutrient facts | up to 0.95 / 0.90 / 0.82 / 0.72 |
| Fewer than 4 nutrient facts | up to 0.55 |
| No ingredient evidence (except trusted simple zero-macro categories such as water) | cap 0.88 |
| All core macros explicitly zero + no ingredients + non-water category | cap 0.55 |
| AI estimate from product identity and ingredients | cap 0.75 |
| AI estimate from a photo | cap 0.55 |
| Baseline derived without Nutri-Score | cap 0.85 |
| Baseline with too little nutrition for a proxy | cap 0.40 |
| Allergen declaration present but not machine-readable | cap 0.70 |
| No allergen declaration and no ingredient text | cap 0.60 |

Confidence now applies to declared OFF rows as well as estimates. The visible raw score is clamped first, then pulled towards the neutral 5.5 baseline. This prevents a sparse row whose favourable zeroes would previously saturate at 10/10 from retaining an extreme score. Explicit high-risk-additive, alcohol and hard-restriction ceilings remain in force after confidence adjustment.

## 5. Verdicts

| Condition | Verdict |
| --- | --- |
| Any hard restriction | Not suitable |
| 8.0–10.0 with confidence ≥0.80 **and** a known ingredient list | Great fit |
| 6.0–7.9, or any ≥8.0 result that misses the confidence/ingredient bar | Good fit |
| 4.0–5.9 | Mixed fit |
| 1.0–3.9 | Poor fit |

`0.80` is the single `GREAT_CONFIDENCE` constant in `dataQuality.ts`, shared
with the recommendation gate. The two used to disagree — a four-nutrient record
with no ingredient list cleared the old `0.70` verdict bar with 0.02 to spare
while the recommender demanded six nutrients for the same product, so the app
could call a record confident enough to celebrate but not confident enough to
suggest.

## 6. Worked examples

Regenerate with `npm run test:scoring -- --markdown` and paste. Do not edit by
hand: this table is the one part of the document that silently rots.

<!-- BEGIN worked-examples -->
| Product | Profile | Baseline | Personal | Final | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| Salami, NOVA 4, salt 4 g, nitrite | more protein + less sugar | 1.5 | +2.2 | **3.7** | poor |
| Raw broccoli | more protein | 9.1 | -1.0 | **8.1** | good |
| Cola | less salt | 1.9 | +1.7 | **3.5** | poor |
| Oats | balanced only | 8.7 | +0.8 | **9.5** | good |
| Oats | all twelve goals | 8.7 | +0.8 | **9.5** | good |
| Beer 5% | balanced | 4.3 | +1.4 | **4.0** | mixed |
<!-- END worked-examples -->

The oats fixture declares no ingredient list, which is why a 9.5 reads as "good
fit" rather than "great": the verdict bar asks what is in the product, not only
what its macros are.

For comparison, an earlier release scored the same salami **8.2/10 "Great fit"**
and the same broccoli **4.8/10 "Mixed fit"**.
