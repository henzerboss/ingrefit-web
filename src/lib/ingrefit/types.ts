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

export type DietId = 'none' | 'vegetarian' | 'vegan' | 'pescatarian' | 'gluten_free' | 'dairy_free' | 'low_carb' | 'mediterranean';
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

export interface ProductFacts {
  source: 'openfoodfacts' | 'ai_label' | 'ai_photo';
  barcode: string | null;
  name: string | null;
  brand: string | null;
  quantity: string | null;
  imageUrl: string | null;
  ingredientsText: string | null;
  ingredients: string[];
  allergens: string[];
  traces: string[];
  additives: string[];
  labels: string[];
  categories: string[];
  nutriScore: string | null;
  novaGroup: number | null;
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

export interface ScoreSignal {
  id: string;
  impact: number;
  label: string;
  evidence: string;
  severity: 'positive' | 'neutral' | 'caution' | 'critical';
}

export interface ProductAssessment {
  score: number;
  verdict: 'great' | 'good' | 'mixed' | 'poor';
  summary: string;
  positives: string[];
  cautions: string[];
  signals: ScoreSignal[];
  dataNotice: string;
  aiEnhanced?: boolean;
  translated?: boolean;
}

export interface UsageSnapshot {
  used: number;
  limit: number;
  remaining: number;
  plan: Plan;
  resetsAt: string;
}

export interface LabelPhoto {
  kind: 'front' | 'ingredients' | 'nutrition' | 'food';
  base64: string;
  mimeType: 'image/jpeg';
}

export interface ScoredProduct {
  score: number;
  verdict: ProductAssessment['verdict'];
  signals: ScoreSignal[];
}
