import type { AnalysisProfile, ProductFacts, ScoreSignal, ScoredProduct } from './types';

function normalized(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^[a-z]{2}:/, '')
    .replace(/[_-]/g, ' ')
    .trim();
}

function includesTerm(haystack: string, term: string): boolean {
  const clean = (value: string) => normalized(value).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const source = ` ${clean(haystack)} `;
  const needle = clean(term);
  return Boolean(needle && source.includes(` ${needle} `));
}

const dietConflicts: Partial<Record<Exclude<AnalysisProfile['diet'], 'none'>, string[]>> = {
  vegan: ['milk', 'whey', 'casein', 'butter', 'cream', 'cheese', 'egg', 'eggs', 'honey', 'gelatin', 'fish', 'chicken', 'beef', 'pork', 'молоко', 'сыворотка', 'казеин', 'сливочное масло', 'сыр', 'яйцо', 'яйца', 'мёд', 'мед', 'желатин', 'рыба', 'курица', 'говядина', 'свинина'],
  vegetarian: ['gelatin', 'fish', 'anchovy', 'anchovies', 'chicken', 'beef', 'pork', 'lard', 'желатин', 'рыба', 'анчоус', 'анчоусы', 'курица', 'говядина', 'свинина', 'сало'],
  pescatarian: ['chicken', 'beef', 'pork', 'lard', 'turkey', 'курица', 'говядина', 'свинина', 'сало', 'индейка'],
  gluten_free: ['wheat', 'barley', 'rye', 'gluten', 'пшеница', 'ячмень', 'рожь', 'глютен'],
  dairy_free: ['milk', 'whey', 'casein', 'butter', 'cream', 'cheese', 'lactose', 'молоко', 'сыворотка', 'казеин', 'сливочное масло', 'сливки', 'сыр', 'лактоза'],
};

const allergenAliases: Record<string, string[]> = {
  milk: ['milk', 'dairy', 'молоко'],
  eggs: ['egg', 'eggs', 'яйцо', 'яйца'],
  peanuts: ['peanut', 'peanuts', 'groundnut', 'арахис'],
  tree_nuts: ['nut', 'nuts', 'tree nuts', 'almond', 'hazelnut', 'walnut', 'cashew', 'pistachio', 'орех', 'орехи', 'миндаль', 'фундук'],
  soy: ['soy', 'soya', 'soybeans', 'соя'],
  wheat: ['wheat', 'пшеница'],
  fish: ['fish', 'рыба'],
  crustaceans: ['crustaceans', 'crab', 'shrimp', 'prawn', 'lobster', 'ракообразные', 'краб', 'креветка', 'омар'],
  sesame: ['sesame', 'кунжут'],
  celery: ['celery', 'сельдерей'],
  mustard: ['mustard', 'горчица'],
  sulphites: ['sulphite', 'sulphites', 'sulfite', 'sulfites', 'сульфит', 'сульфиты'],
  lupin: ['lupin', 'люпин'],
  molluscs: ['mollusc', 'molluscs', 'mollusk', 'mollusks', 'моллюск', 'моллюски'],
};

function declaredAllergenMatch(declared: string[], selected: string): string | undefined {
  const aliases = allergenAliases[normalized(selected).replaceAll(' ', '_')] ?? [selected];
  return declared.find((item) => aliases.some((alias) => includesTerm(item, alias)));
}

export function scoreProduct(facts: ProductFacts, profile: AnalysisProfile): ScoredProduct {
  let score = 5.5;
  let critical = false;
  const signals: ScoreSignal[] = [];
  const add = (signal: ScoreSignal) => {
    if (signals.some((item) => item.id === signal.id)) return;
    signals.push(signal);
    score += signal.impact;
    if (signal.severity === 'critical') critical = true;
  };

  const ingredientsText = [facts.ingredientsText, ...facts.ingredients].filter(Boolean).join(' ');
  const declaredAllergens = facts.allergens.map(normalized);

  for (const allergen of profile.allergens) {
    const match = declaredAllergenMatch(declaredAllergens, allergen);
    if (match) {
      add({
        id: `allergen:${normalized(allergen)}`,
        impact: -5,
        label: 'Declared allergen conflict',
        evidence: `The package data explicitly declares “${match}”.`,
        severity: 'critical',
      });
    }
  }

  for (const avoided of profile.avoidedIngredients) {
    if (avoided && includesTerm(ingredientsText, avoided)) {
      add({
        id: `avoided:${normalized(avoided)}`,
        impact: -4,
        label: 'Ingredient on your avoid list',
        evidence: `“${avoided}” appears in the transcribed ingredient text.`,
        severity: 'critical',
      });
    }
  }

  if (profile.diet !== 'none') {
    const conflict = dietConflicts[profile.diet]?.find((term) => includesTerm(ingredientsText, term));
    if (conflict) {
      add({
        id: `diet:${profile.diet}`,
        impact: -3.5,
        label: 'Diet preference conflict',
        evidence: `The transcribed ingredients contain “${conflict}”.`,
        severity: 'critical',
      });
    }
  }

  const protein = facts.nutrition.protein100g;
  if ((profile.goals.includes('high_protein') || profile.goals.includes('muscle_gain')) && protein !== null) {
    if (protein >= 20) add({ id: 'protein-high', impact: 1.5, label: 'High protein density', evidence: `${protein} g protein per 100 g is declared.`, severity: 'positive' });
    else if (protein >= 10) add({ id: 'protein-moderate', impact: 0.8, label: 'Useful protein', evidence: `${protein} g protein per 100 g is declared.`, severity: 'positive' });
    else if (protein < 5) add({ id: 'protein-low', impact: -0.7, label: 'Low for your protein goal', evidence: `Only ${protein} g protein per 100 g is declared.`, severity: 'caution' });
  }

  const sugars = facts.nutrition.sugars100g;
  if (profile.goals.includes('low_sugar') && sugars !== null) {
    if (sugars <= 5) add({ id: 'sugars-low', impact: 1.2, label: 'Low sugar for your goal', evidence: `${sugars} g sugars per 100 g is declared.`, severity: 'positive' });
    else if (sugars <= 10) add({ id: 'sugars-moderate', impact: 0.4, label: 'Moderate sugar', evidence: `${sugars} g sugars per 100 g is declared.`, severity: 'neutral' });
    else if (sugars > 25) add({ id: 'sugars-very-high', impact: -2, label: 'Very high sugar for your goal', evidence: `${sugars} g sugars per 100 g is declared.`, severity: 'caution' });
    else if (sugars > 15) add({ id: 'sugars-high', impact: -1.3, label: 'High sugar for your goal', evidence: `${sugars} g sugars per 100 g is declared.`, severity: 'caution' });
  }

  const fiber = facts.nutrition.fiber100g;
  if (profile.goals.includes('high_fiber') && fiber !== null) {
    if (fiber >= 6) add({ id: 'fiber-high', impact: 1.2, label: 'High fiber density', evidence: `${fiber} g fiber per 100 g is declared.`, severity: 'positive' });
    else if (fiber >= 3) add({ id: 'fiber-source', impact: 0.5, label: 'Some fiber', evidence: `${fiber} g fiber per 100 g is declared.`, severity: 'positive' });
    else if (fiber < 2) add({ id: 'fiber-low', impact: -0.5, label: 'Low for your fiber goal', evidence: `${fiber} g fiber per 100 g is declared.`, severity: 'caution' });
  }

  const salt = facts.nutrition.salt100g ?? (facts.nutrition.sodium100g !== null ? facts.nutrition.sodium100g * 2.5 : null);
  if (profile.goals.includes('low_sodium') && salt !== null) {
    if (salt <= 0.3) add({ id: 'salt-low', impact: 0.8, label: 'Low salt for your goal', evidence: `${salt.toFixed(2)} g salt equivalent per 100 g is declared or derived from declared sodium.`, severity: 'positive' });
    else if (salt > 1.5) add({ id: 'salt-high', impact: -1.2, label: 'High salt for your goal', evidence: `${salt.toFixed(2)} g salt equivalent per 100 g is declared or derived from declared sodium.`, severity: 'caution' });
  }

  if (profile.goals.includes('minimally_processed') && facts.novaGroup !== null) {
    if (facts.novaGroup === 1) add({ id: 'nova-1', impact: 1.2, label: 'Minimally processed classification', evidence: 'Open Food Facts reports NOVA group 1.', severity: 'positive' });
    else if (facts.novaGroup === 2) add({ id: 'nova-2', impact: 0.5, label: 'Processed culinary ingredient', evidence: 'Open Food Facts reports NOVA group 2.', severity: 'neutral' });
    else if (facts.novaGroup === 4) add({ id: 'nova-4', impact: -1.5, label: 'Ultra-processed classification', evidence: 'Open Food Facts reports NOVA group 4.', severity: 'caution' });
  }

  if (profile.goals.includes('balanced') && facts.nutriScore) {
    const grade = normalized(facts.nutriScore);
    const impacts: Record<string, number> = { a: 1.2, b: 0.8, c: 0.2, d: -0.8, e: -1.2 };
    const impact = impacts[grade];
    if (impact !== undefined) {
      add({
        id: `nutriscore-${grade}`,
        impact,
        label: `Nutri-Score ${grade.toUpperCase()}`,
        evidence: `Open Food Facts reports Nutri-Score ${grade.toUpperCase()}.`,
        severity: impact > 0 ? 'positive' : impact < 0 ? 'caution' : 'neutral',
      });
    }
  }

  if (profile.goals.includes('weight_loss')) {
    const energy = facts.nutrition.energyKcal100g;
    if (energy !== null) {
      if (energy <= 150) add({ id: 'energy-lower', impact: 0.5, label: 'Lower energy density', evidence: `${energy} kcal per 100 g is declared.`, severity: 'positive' });
      else if (energy > 400) add({ id: 'energy-high', impact: -0.8, label: 'High energy density', evidence: `${energy} kcal per 100 g is declared.`, severity: 'caution' });
    }
  }

  if (profile.diet === 'low_carb' && facts.nutrition.carbohydrates100g !== null) {
    const carbs = facts.nutrition.carbohydrates100g;
    if (carbs <= 10) add({ id: 'diet-low-carb-fit', impact: 0.8, label: 'Lower carbohydrate density', evidence: `${carbs} g carbohydrates per 100 g is declared.`, severity: 'positive' });
    else if (carbs > 20) add({ id: 'diet-low-carb-conflict', impact: -1.2, label: 'High for your low-carb pattern', evidence: `${carbs} g carbohydrates per 100 g is declared.`, severity: 'caution' });
  }

  if (profile.diet === 'mediterranean') {
    if (fiber !== null && fiber >= 3) add({ id: 'diet-mediterranean-fiber', impact: 0.5, label: 'Fiber supports your selected pattern', evidence: `${fiber} g fiber per 100 g is declared.`, severity: 'positive' });
    if (facts.novaGroup === 4) add({ id: 'diet-mediterranean-nova', impact: -0.6, label: 'Less aligned with your selected pattern', evidence: 'Open Food Facts reports NOVA group 4.', severity: 'caution' });
  }

  if (profile.goals.includes('heart_health')) {
    const saturated = facts.nutrition.saturatedFat100g;
    if (saturated !== null) {
      if (saturated <= 1.5) add({ id: 'heart-saturated-low', impact: 0.6, label: 'Lower saturated fat', evidence: `${saturated} g saturated fat per 100 g is declared.`, severity: 'positive' });
      else if (saturated > 5) add({ id: 'heart-saturated-high', impact: -1, label: 'High saturated fat for your goal', evidence: `${saturated} g saturated fat per 100 g is declared.`, severity: 'caution' });
    }
    if (salt !== null) {
      if (salt <= 0.3) add({ id: 'heart-salt-low', impact: 0.4, label: 'Lower salt', evidence: `${salt.toFixed(2)} g salt equivalent per 100 g is declared or derived from declared sodium.`, severity: 'positive' });
      else if (salt > 1.5) add({ id: 'heart-salt-high', impact: -0.7, label: 'High salt for your goal', evidence: `${salt.toFixed(2)} g salt equivalent per 100 g is declared or derived from declared sodium.`, severity: 'caution' });
    }
    if (fiber !== null && fiber >= 3) add({ id: 'heart-fiber', impact: 0.4, label: 'Useful fiber density', evidence: `${fiber} g fiber per 100 g is declared.`, severity: 'positive' });
  }

  if (profile.goals.includes('steady_energy')) {
    if (sugars !== null && sugars > 15) add({ id: 'steady-sugar-high', impact: -0.8, label: 'High sugar for your steady-energy goal', evidence: `${sugars} g sugars per 100 g is declared.`, severity: 'caution' });
    if (fiber !== null && fiber >= 3) add({ id: 'steady-fiber', impact: 0.5, label: 'Useful fiber for your goal', evidence: `${fiber} g fiber per 100 g is declared.`, severity: 'positive' });
    if (protein !== null && protein >= 10) add({ id: 'steady-protein', impact: 0.4, label: 'Useful protein for your goal', evidence: `${protein} g protein per 100 g is declared.`, severity: 'positive' });
  }

  if (profile.goals.includes('digestive_wellness') && fiber !== null) {
    if (fiber >= 6) add({ id: 'digestive-fiber-high', impact: 1, label: 'High fiber for your goal', evidence: `${fiber} g fiber per 100 g is declared.`, severity: 'positive' });
    else if (fiber < 2) add({ id: 'digestive-fiber-low', impact: -0.5, label: 'Low fiber for your goal', evidence: `${fiber} g fiber per 100 g is declared.`, severity: 'caution' });
  }

  const saturatedFat = facts.nutrition.saturatedFat100g;
  if (profile.goals.includes('low_saturated_fat') && saturatedFat !== null) {
    if (saturatedFat <= 1.5) add({ id: 'saturated-fat-low', impact: 0.8, label: 'Low saturated fat for your goal', evidence: `${saturatedFat} g saturated fat per 100 g is declared.`, severity: 'positive' });
    else if (saturatedFat > 5) add({ id: 'saturated-fat-high', impact: -1.2, label: 'High saturated fat for your goal', evidence: `${saturatedFat} g saturated fat per 100 g is declared.`, severity: 'caution' });
  }

  if (!signals.length) {
    signals.push({ id: 'limited-goal-data', impact: 0, label: 'Limited goal-specific data', evidence: 'No available declared field triggered a goal-specific adjustment.', severity: 'neutral' });
  }

  score = Math.max(1, Math.min(10, score));
  if (critical) score = Math.min(score, 2.5);
  score = Math.round(score * 10) / 10;
  const verdict = score >= 8 ? 'great' : score >= 6 ? 'good' : score >= 4 ? 'mixed' : 'poor';
  return { score, verdict, signals };
}
