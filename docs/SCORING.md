# IngreFit scoring rules

The score is deterministic and is calculated before Gemini writes an explanation. It starts at **5.5**, adds each applicable adjustment once, is clamped to **1.0–10.0**, and is rounded to one decimal place. Any critical conflict caps the final score at **2.5**.

## Universal and safety rules

| Signal | Adjustment |
| --- | ---: |
| Explicitly declared selected allergen | -5.0 and critical cap |
| Ingredient from the user's avoid list | -4.0 and critical cap |
| Ingredient conflicting with the selected diet | -3.5 and critical cap |
| Alcohol above 0% and up to 1.2% vol | -0.5 |
| Alcohol above 1.2% and up to 6% vol | -1.5 |
| Alcohol above 6% and up to 15% vol | -2.2 |
| Alcohol above 15% vol | -3.0 |

Alcohol is counted only when an ABV value is explicitly present in Open Food Facts or legible on the label. It is never inferred from the product name or category.

## Goal and diet rules

| Profile selection | Available fact | Adjustment |
| --- | --- | ---: |
| More protein / muscle gain | protein ≥20 g | +1.5 |
| | protein ≥10 g | +0.8 |
| | protein <5 g | -0.7 |
| Less sugar | sugars ≤5 g | +1.2 |
| | sugars ≤10 g | +0.4 |
| | sugars >15 g | -1.3 |
| | sugars >25 g | -2.0 |
| More fiber | fiber ≥6 g | +1.2 |
| | fiber ≥3 g | +0.5 |
| | fiber <2 g | -0.5 |
| Less salt | salt equivalent ≤0.3 g | +0.8 |
| | salt equivalent >1.5 g | -1.2 |
| Less processing | NOVA 1 / 2 / 4 | +1.2 / +0.5 / -1.5 |
| Balanced eating | Nutri-Score A / B / C / D / E | +1.2 / +0.8 / +0.2 / -0.8 / -1.2 |
| Weight management | energy ≤150 kcal | +0.5 |
| | energy >400 kcal | -0.8 |
| Low-carb diet | carbohydrates ≤10 g | +0.8 |
| | carbohydrates >20 g | -1.2 |
| Mediterranean pattern | fiber ≥3 g | +0.5 |
| | NOVA 4 | -0.6 |
| Heart-aware choices | saturated fat ≤1.5 g / >5 g | +0.6 / -1.0 |
| | salt equivalent ≤0.3 g / >1.5 g | +0.4 / -0.7 |
| | fiber ≥3 g | +0.4 |
| Steady energy | sugars >15 g | -0.8 |
| | fiber ≥3 g | +0.5 |
| | protein ≥10 g | +0.4 |
| Digestive wellness | fiber ≥6 g / <2 g | +1.0 / -0.5 |
| Less saturated fat | saturated fat ≤1.5 g / >5 g | +0.8 / -1.2 |

Values use the product's declared basis (100 g, 100 ml or serving). Sodium is converted to salt equivalent by multiplying by 2.5 when a salt value is unavailable.

When Nutri-Score is unavailable, the balanced-eating rule uses the available sugars, saturated fat, salt, fiber and protein values. Their combined adjustment is capped between **-1.5 and +1.0**.

## AI-estimate confidence weighting

Only nutrition-derived adjustments are confidence-weighted:

- visual food estimate: multiplier **0.6**;
- estimate from product identity and ingredient text: multiplier **0.7**;
- declared package/Open Food Facts values: multiplier **1.0**.

Allergen, avoid-list, diet-conflict, Nutri-Score, NOVA and alcohol signals are not weakened by this multiplier because they require explicit evidence rather than an estimated nutrient number.

## Verdicts

| Final score | Verdict |
| --- | --- |
| 8.0–10.0 | Great fit |
| 6.0–7.9 | Good fit |
| 4.0–5.9 | Mixed fit |
| 1.0–3.9 | Poor fit |

