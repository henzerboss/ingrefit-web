import type { AdditiveBasis, AdditiveRisk } from './additives';

export type GoalId =
  | 'balanced'
  | 'weight_loss'
  | 'muscle_gain'
  | 'high_protein'
  | 'low_sugar'
  | 'low_sodium'
  | 'high_fiber'
  | 'minimally_processed'
  | 'heart_health'
  | 'steady_energy'
  | 'digestive_wellness'
  | 'low_saturated_fat';

export type DietId =
  'none' | 'vegetarian' | 'vegan' | 'pescatarian' | 'gluten_free' | 'dairy_free' | 'low_carb' | 'mediterranean';
export type Plan = 'free' | 'premium';

export interface AnalysisProfile {
  goals: GoalId[];
  diet: DietId;
  allergens: string[];
  avoidedIngredients: string[];
}

export interface NutritionFacts {
  energyKcal100g: number | null;
  protein100g: number | null;
  carbohydrates100g: number | null;
  sugars100g: number | null;
  fat100g: number | null;
  saturatedFat100g: number | null;
  fiber100g: number | null;
  salt100g: number | null;
  sodium100g: number | null;
  servingSize: string | null;
}

/** Open Food Facts "nutrient levels" traffic lights, when published. */
export type NutrientLevel = 'low' | 'moderate' | 'high';

export interface NutrientLevels {
  fat: NutrientLevel | null;
  saturatedFat: NutrientLevel | null;
  sugars: NutrientLevel | null;
  salt: NutrientLevel | null;
}

export interface ProductAdditive {
  code: string;
  name: string;
  risk: AdditiveRisk;
  basis: AdditiveBasis;
  /** Localized, factual reason the additive is classified this way. */
  basisText: string;
  known: boolean;
}

/**
 * Ingredient-derived analysis published by Open Food Facts. These are computed
 * from the ingredient list in any source language, which makes them far more
 * reliable than matching translated substrings ourselves.
 */
export interface IngredientAnalysis {
  vegan: 'yes' | 'no' | 'maybe' | null;
  vegetarian: 'yes' | 'no' | 'maybe' | null;
  palmOil: 'yes' | 'no' | 'maybe' | null;
}

export interface ProductFacts {
  source: 'openfoodfacts' | 'ai_label' | 'ai_photo';
  barcode: string | null;
  name: string | null;
  brand: string | null;
  quantity: string | null;
  imageUrl: string | null;
  ingredientsText: string | null;
  ingredients: string[];
  /** Display strings, localized for the user. */
  allergens: string[];
  traces: string[];
  /** Canonical `en:` tags used for matching. Never shown to the user. */
  allergenTags: string[];
  traceTags: string[];
  /**
   * True when allergen information is machine-readable rather than inferred
   * from free ingredient text: canonical Open Food Facts tags, or the label
   * reader's closed-enum output. When false, "no allergen found" means "not
   * checked", and the scorer says so instead of staying silent.
   */
  allergensVerified?: boolean;
  additives: ProductAdditive[];
  labels: string[];
  labelTags: string[];
  categories: string[];
  ingredientAnalysis: IngredientAnalysis;
  nutrientLevels: NutrientLevels;
  fruitsVegetablesNuts100g: number | null;
  nutriScore: string | null;
  novaGroup: number | null;
  ecoScore: string | null;
  organic: boolean;
  alcoholPercent: number | null;
  nutrition: NutritionFacts;
  nutritionReference?: '100g' | '100ml' | 'serving';
  nutritionBasis?: 'declared' | 'estimated_visual' | 'estimated_text';
  nutritionEstimateConfidence?: number | null;
  completeness: number;
  unknownFields: string[];
  identificationConfidence?: number | null;
  visualDescription?: string | null;
  possibleAlternatives?: string[];
}

export type SignalScope = 'blocker' | 'base' | 'personal';
export type SignalSeverity = 'positive' | 'neutral' | 'caution' | 'critical';

/**
 * A signal is language-neutral: `code` selects a template and `params` fills it.
 * Rendering happens in explanation.ts, so the free tier is fully localized
 * without ever calling Gemini.
 */
export interface ScoreSignal {
  id: string;
  code: string;
  scope: SignalScope;
  impact: number;
  severity: SignalSeverity;
  params: Record<string, string | number>;
}

export type Verdict = 'blocked' | 'great' | 'good' | 'mixed' | 'poor';

export interface ScoredProduct {
  score: number;
  verdict: Verdict;
  /** Universal product quality before personalization, 1-10. */
  baseScore: number;
  /** Normalized personal adjustment, bounded by the personal range. */
  personalDelta: number;
  /** 0-1: how much declared data the score rests on. */
  confidence: number;
  blocked: boolean;
  signals: ScoreSignal[];
  /** Stable hash of everything that determines the explanation text. */
  fingerprint: string;
}

export interface RenderedSignal {
  id: string;
  code: string;
  scope: SignalScope;
  impact: number;
  severity: SignalSeverity;
  label: string;
  evidence: string;
}

export interface ProductAssessment {
  score: number;
  verdict: Verdict;
  baseScore: number;
  personalDelta: number;
  confidence: number;
  blocked: boolean;
  summary: string;
  /** One actionable sentence shown under the summary. */
  tip: string;
  positives: string[];
  cautions: string[];
  signals: RenderedSignal[];
  dataNotice: string;
  aiEnhanced?: boolean;
  translated?: boolean;
  cached?: boolean;
}

export interface UsageSnapshot {
  used: number;
  limit: number;
  remaining: number;
  plan: Plan;
  resetsAt: string;
}

export interface LabelPhoto {
  kind: 'front' | 'label' | 'ingredients' | 'nutrition' | 'food';
  base64: string;
  mimeType: 'image/jpeg';
}
