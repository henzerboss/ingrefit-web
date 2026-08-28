import type { AnalysisProfile, ProductFacts } from './types';

/**
 * Score confidence is about how much evidence the numeric result rests on, not
 * whether Open Food Facts successfully returned a row. A zero is a legitimate
 * declared value, but a row with every core macro at zero and no ingredient
 * evidence is too easy to over-score unless the category itself makes that
 * profile unsurprising (plain water is the canonical example).
 */
/**
 * Shared confidence bar for "we are sure about this product".
 *
 * One constant for the "great fit" verdict and the recommendation gate, so the
 * app cannot call a record confident enough to celebrate but not confident
 * enough to suggest.
 */
export const GREAT_CONFIDENCE = 0.8;

/** Minimum independently declared nutrient facts before a record can be recommended. */
export const RECOMMENDATION_MIN_NUTRIENTS = 6;

export function hasIngredientEvidence(facts: ProductFacts): boolean {
  return Boolean(facts.ingredientsText?.trim() || facts.ingredients.some((item) => item.trim()));
}

/** Count independent nutrient facts; salt and sodium are one piece of evidence. */
export function nutritionEvidenceCount(facts: ProductFacts): number {
  const nutrition = facts.nutrition;
  const independent: unknown[] = [
    nutrition.energyKcal100g,
    nutrition.protein100g,
    nutrition.carbohydrates100g,
    nutrition.sugars100g,
    nutrition.fat100g,
    nutrition.saturatedFat100g,
    nutrition.fiber100g,
    nutrition.salt100g ?? nutrition.sodium100g,
  ];
  return independent.filter((value) => typeof value === 'number' && Number.isFinite(value)).length;
}

function normalizedCategories(facts: ProductFacts): string {
  return facts.categories
    .join(' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Categories where an all-zero macro panel is expected rather than suspicious. */
export function isTrustedZeroMacroCategory(facts: ProductFacts): boolean {
  const categories = ` ${normalizedCategories(facts)} `;
  return /\b(water|waters|mineral water|mineral waters|spring water|spring waters|sparkling water|sparkling waters)\b/.test(
    categories,
  );
}

/**
 * Four independently declared core macros at exactly zero are unusual for a
 * packaged food. Do not confuse missing values with zero: all four fields must
 * actually be present as numbers before this check can fire.
 */
export function hasAllZeroCoreMacros(facts: ProductFacts): boolean {
  const values = [
    facts.nutrition.energyKcal100g,
    facts.nutrition.protein100g,
    facts.nutrition.carbohydrates100g,
    facts.nutrition.fat100g,
  ];
  return values.every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 0.0005);
}

export function hasSuspiciousSparseZeroProfile(facts: ProductFacts): boolean {
  return hasAllZeroCoreMacros(facts) && !hasIngredientEvidence(facts) && !isTrustedZeroMacroCategory(facts);
}

/**
 * Confidence contributed by source-data coverage. This is intentionally
 * separate from Nutri-Score/proxy confidence: an official grade can support the
 * nutrition baseline while the rest of the personalised score still lacks
 * ingredient/allergen evidence.
 */
export function productDataConfidence(facts: ProductFacts): number {
  const nutrientCount = nutritionEvidenceCount(facts);
  let confidence =
    nutrientCount >= 8
      ? 1
      : nutrientCount === 7
        ? 0.95
        : nutrientCount === 6
          ? 0.9
          : nutrientCount === 5
            ? 0.82
            : nutrientCount === 4
              ? 0.72
              : 0.55;

  if (!hasIngredientEvidence(facts) && !isTrustedZeroMacroCategory(facts)) {
    confidence = Math.min(confidence, 0.88);
  }

  // This is the Servivita-style failure mode: declared zeroes are preserved,
  // but they are not allowed to masquerade as a perfectly evidenced 10/10.
  if (hasSuspiciousSparseZeroProfile(facts)) {
    confidence = Math.min(confidence, 0.55);
  }

  // Extremely incomplete rows should never look precise even if the few fields
  // they do carry happen to be favourable.
  if (facts.completeness < 45) confidence = Math.min(confidence, 0.6);

  return Math.max(0.35, Math.min(1, confidence));
}

/**
 * Recommendation-only gate. Direct barcode scans remain available for sparse
 * products; recommendations are held to a higher standard because IngreFit is
 * actively suggesting them to the user.
 */
export function recommendationQualityGate(facts: ProductFacts, profile: AnalysisProfile): boolean {
  if (!facts.name || nutritionEvidenceCount(facts) < RECOMMENDATION_MIN_NUTRIENTS) return false;
  if (hasSuspiciousSparseZeroProfile(facts)) return false;

  const profileNeedsIngredientSafety =
    profile.allergens.length > 0 || profile.avoidedIngredients.length > 0 || profile.diet !== 'none';

  if (profileNeedsIngredientSafety && !hasIngredientEvidence(facts)) return false;
  return productDataConfidence(facts) >= GREAT_CONFIDENCE;
}
