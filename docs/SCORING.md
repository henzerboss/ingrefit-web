# IngreFit scoring rules

The score is deterministic. It is computed before any model is called, and no
model may change it.

```
final = clamp(baseline + personal + warnings, 1, 10)
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
personal = (Σ weightᵢ × fitᵢ / Σ weightᵢ) × 2.5 × confidence × coverage
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
| Selected allergen | canonical `en:` allergen tag, else multilingual ingredient terms |
| Ingredient on the avoid list | ingredient text match |
| Diet conflict | Open Food Facts `ingredients_analysis_tags`, or allergen tags for gluten/dairy |

Non-blocking warnings: declared traces of a selected allergen (−0.3), an
unconfirmed diet status (−0.5), and missing allergen data (informational).

Diet conflicts rely on Open Food Facts ingredient analysis (`en:non-vegan`,
`en:non-vegetarian`, `en:palm-oil`) rather than translated substring matching.
The analysis is computed upstream from ingredient lists in any language, so a
Polish or Spanish label is handled correctly. Where no structured analysis
exists — AI-read labels — text matching is used, and it **warns rather than
blocks**, because it cannot see through translations.

## 4. Confidence

| Basis | Confidence |
| --- | ---: |
| Declared package / Open Food Facts values | 1.0 |
| AI estimate from product identity and ingredients | 0.75 |
| AI estimate from a photo | 0.55 |
| Baseline derived without Nutri-Score | ×0.85 |
| Baseline with <3 nutrient values | ×0.4 |

Confidence scales the personal adjustment and pulls an estimated baseline back
towards neutral, so a guess can never produce a confident-looking extreme.

## 5. Verdicts

| Condition | Verdict |
| --- | --- |
| Any hard restriction | Not suitable |
| 8.0–10.0 | Great fit |
| 6.0–7.9 | Good fit |
| 4.0–5.9 | Mixed fit |
| 1.0–3.9 | Poor fit |

## 6. Worked examples

Produced by `npm run test:scoring`:

| Product | Profile | Baseline | Personal | Final |
| --- | --- | ---: | ---: | ---: |
| Salami, NOVA 4, salt 4 g, nitrite | more protein + less sugar | 1.0 | +2.5 | **3.5** |
| Raw broccoli | more protein | 9.6 | −1.1 | **8.5** |
| Cola | less salt | 1.4 | +1.9 | **3.3** |
| Oats | balanced only | 9.1 | +0.9 | **10.0** |
| Oats | all twelve goals | 9.1 | +2.2 | **10.0** |
| Beer 5% | balanced | 4.0 (capped) | +1.5 | **4.0** |

For comparison, the previous release scored the same salami **8.2/10 "Great
fit"** and the same broccoli **4.8/10 "Mixed fit"**.
