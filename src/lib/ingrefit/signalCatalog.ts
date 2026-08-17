import type { AdditiveBasis } from './additives';
import type { DietId, GoalId, ScoreSignal } from './types';

/**
 * Deterministic rendering of score signals.
 *
 * Every user-facing sentence the free tier shows is produced here, in the
 * user's language, with no model call. Gemini only ever rewrites this text for
 * Premium; it never produces the only available version of it.
 */

export type CatalogLanguage = 'en' | 'ru';

export function catalogLanguage(locale: string): CatalogLanguage {
  return locale.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

type Params = Record<string, string | number>;
type Rendered = { label: string; evidence: string };
type Template = (params: Params, language: CatalogLanguage) => Rendered;

const GOAL_NAMES: Record<GoalId, [string, string]> = {
  balanced: ['balanced eating', 'сбалансированное питание'],
  weight_loss: ['weight management', 'контроль веса'],
  muscle_gain: ['muscle gain', 'набор мышц'],
  high_protein: ['more protein', 'больше белка'],
  low_sugar: ['less sugar', 'меньше сахара'],
  low_sodium: ['less salt', 'меньше соли'],
  high_fiber: ['more fiber', 'больше клетчатки'],
  minimally_processed: ['less processing', 'меньше обработки'],
  heart_health: ['heart-aware choices', 'забота о сердце'],
  steady_energy: ['steady energy', 'ровная энергия'],
  digestive_wellness: ['digestive wellness', 'комфорт пищеварения'],
  low_saturated_fat: ['less saturated fat', 'меньше насыщенных жиров'],
};

const DIET_NAMES: Record<DietId, [string, string]> = {
  none: ['no specific diet', 'без ограничений'],
  vegetarian: ['vegetarian', 'вегетарианское питание'],
  vegan: ['vegan', 'веганское питание'],
  pescatarian: ['pescatarian', 'пескетарианское питание'],
  gluten_free: ['gluten-free', 'без глютена'],
  dairy_free: ['dairy-free', 'без молочного'],
  low_carb: ['low-carb', 'низкоуглеводное питание'],
  mediterranean: ['Mediterranean', 'средиземноморское питание'],
};

const ALLERGEN_NAMES: Record<string, [string, string]> = {
  milk: ['milk', 'молоко'],
  eggs: ['eggs', 'яйца'],
  peanuts: ['peanuts', 'арахис'],
  tree_nuts: ['tree nuts', 'орехи'],
  soy: ['soy', 'соя'],
  wheat: ['wheat', 'пшеница'],
  gluten: ['gluten', 'глютен'],
  fish: ['fish', 'рыба'],
  crustaceans: ['crustaceans', 'ракообразные'],
  sesame: ['sesame', 'кунжут'],
  celery: ['celery', 'сельдерей'],
  mustard: ['mustard', 'горчица'],
  sulphites: ['sulphites', 'сульфиты'],
  lupin: ['lupin', 'люпин'],
  molluscs: ['molluscs', 'моллюски'],
};

export function goalName(goal: GoalId, language: CatalogLanguage): string {
  return GOAL_NAMES[goal]?.[language === 'ru' ? 1 : 0] ?? goal;
}

export function dietName(diet: DietId, language: CatalogLanguage): string {
  return DIET_NAMES[diet]?.[language === 'ru' ? 1 : 0] ?? diet;
}

export function allergenName(allergen: string, language: CatalogLanguage): string {
  const key = allergen.toLowerCase().replace(/[\s-]/g, '_');
  return ALLERGEN_NAMES[key]?.[language === 'ru' ? 1 : 0] ?? allergen;
}

/**
 * Open Food Facts tag -> localized display name.
 *
 * Tags arrive canonicalized as `en:eggs`, `en:sesame-seeds`, `en:organic`, and
 * for products whose ingredients did not match the taxonomy, in the source
 * language instead (`ru:глютен`). Stripping the prefix alone therefore shows an
 * English word to a Russian user whenever the tag did match. That is what these
 * maps fix, deterministically and without a model call.
 */
const TAG_TO_ALLERGEN: Record<string, string> = {
  'en:milk': 'milk',
  'en:eggs': 'eggs',
  'en:peanuts': 'peanuts',
  'en:nuts': 'tree_nuts',
  'en:tree-nuts': 'tree_nuts',
  'en:almonds': 'tree_nuts',
  'en:hazelnuts': 'tree_nuts',
  'en:walnuts': 'tree_nuts',
  'en:cashew-nuts': 'tree_nuts',
  'en:pistachio-nuts': 'tree_nuts',
  'en:soybeans': 'soy',
  'en:gluten': 'gluten',
  'en:wheat': 'wheat',
  'en:fish': 'fish',
  'en:crustaceans': 'crustaceans',
  'en:sesame-seeds': 'sesame',
  'en:celery': 'celery',
  'en:mustard': 'mustard',
  'en:sulphur-dioxide-and-sulphites': 'sulphites',
  'en:lupin': 'lupin',
  'en:molluscs': 'molluscs',
};

const LABEL_NAMES: Record<string, [string, string]> = {
  'en:organic': ['organic', 'органический'],
  'en:eu-organic': ['EU organic', 'органический (ЕС)'],
  'en:gluten-free': ['gluten-free', 'без глютена'],
  'en:lactose-free': ['lactose-free', 'без лактозы'],
  'en:no-lactose': ['lactose-free', 'без лактозы'],
  'en:vegan': ['vegan', 'веганский'],
  'en:vegetarian': ['vegetarian', 'вегетарианский'],
  'en:no-gluten': ['gluten-free', 'без глютена'],
  'en:sugar-free': ['sugar-free', 'без сахара'],
  'en:no-added-sugar': ['no added sugar', 'без добавленного сахара'],
  'en:no-preservatives': ['no preservatives', 'без консервантов'],
  'en:no-colorings': ['no colourings', 'без красителей'],
  'en:no-gmos': ['non-GMO', 'без ГМО'],
  'en:fair-trade': ['fair trade', 'справедливая торговля'],
  'en:halal': ['halal', 'халяль'],
  'en:kosher': ['kosher', 'кошерный'],
  'en:palm-oil-free': ['palm-oil free', 'без пальмового масла'],
  'en:high-protein': ['high protein', 'высокобелковый'],
  'en:whole-grain': ['whole grain', 'цельнозерновой'],
};

function prettifySlug(tag: string): string {
  return tag.replace(/^[a-z]{2}:/i, '').replaceAll('-', ' ').trim();
}

/** Localized name for an allergen or traces tag. */
export function allergenTagName(tag: string, language: CatalogLanguage): string {
  const key = TAG_TO_ALLERGEN[tag];
  if (key) return allergenName(key, language);
  return prettifySlug(tag);
}

/** Localized name for a label tag. */
export function labelTagName(tag: string, language: CatalogLanguage): string {
  const entry = LABEL_NAMES[tag];
  if (entry) return entry[language === 'ru' ? 1 : 0];
  return prettifySlug(tag);
}

/** Nutrient names used by the derived-baseline explanation. */
const NUTRIENT_LABELS: Record<string, [string, string, string, string]> = {
  // key: [name en, name ru, unit en, unit ru]
  sugars: ['sugars', 'сахара', 'g', 'г'],
  saturated_fat: ['saturated fat', 'насыщенные жиры', 'g', 'г'],
  salt: ['salt', 'соль', 'g', 'г'],
  fiber: ['fiber', 'клетчатка', 'g', 'г'],
  protein: ['protein', 'белок', 'g', 'г'],
  energy: ['energy', 'энергия', 'kcal', 'ккал'],
};

/**
 * Renders the compact `key=value;key=value` detail string the scorer produces.
 * The scorer stays language-neutral; the words are chosen here.
 */
function renderNutrientDetail(detail: string, language: CatalogLanguage): string {
  const russian = language === 'ru';
  return detail
    .split(';')
    .map((part) => {
      const [key, rawValue] = part.split('=');
      if (!key || rawValue === undefined) return null;
      const entry = NUTRIENT_LABELS[key];
      const value = russian ? rawValue.replace('.', ',') : rawValue;
      if (!entry) return `${key} ${value}`;
      return `${entry[russian ? 1 : 0]} ${value} ${entry[russian ? 3 : 2]}`;
    })
    .filter(Boolean)
    .join(', ');
}

const ADDITIVE_BASIS: Record<AdditiveBasis, [string, string]> = {
  eu_not_authorised: [
    'no longer authorised as a food additive in the EU',
    'больше не разрешён в ЕС как пищевая добавка',
  ],
  eu_child_attention_warning: [
    'EU law requires a warning that it may affect activity and attention in children',
    'по законодательству ЕС требует предупреждения о возможном влиянии на активность и внимание детей',
  ],
  iarc_2a: [
    'linked by IARC to a group 2A classification for ingested nitrate/nitrite under conditions leading to nitrosation',
    'связан с классификацией IARC группы 2A для нитратов/нитритов при условиях, ведущих к нитрозированию',
  ],
  iarc_2b: ['classified by IARC in group 2B', 'отнесён IARC к группе 2B'],
  efsa_group_adi: ['covered by an EFSA acceptable daily intake', 'имеет установленное EFSA допустимое суточное потребление'],
  efsa_adi_lowered: ['subject to an EFSA intake limit that was revised downwards', 'имеет пересмотренный EFSA в сторону снижения предел потребления'],
  mandatory_allergen_labelling: [
    'must be declared as an allergen above 10 mg/kg',
    'подлежит обязательной маркировке как аллерген при содержании выше 10 мг/кг',
  ],
  use_restricted: ['authorised only for restricted uses', 'разрешён только для ограниченного применения'],
  authorised_routine: ['authorised and routinely used', 'разрешён и широко применяется'],
};

export function additiveBasisText(basis: AdditiveBasis, language: CatalogLanguage): string {
  return ADDITIVE_BASIS[basis][language === 'ru' ? 1 : 0];
}

function reference(params: Params, language: CatalogLanguage): string {
  const value = String(params.reference ?? '100g');
  if (language === 'ru') return value === '100ml' ? '100 мл' : value === 'serving' ? 'порцию' : '100 г';
  return value === '100ml' ? '100 ml' : value === 'serving' ? 'a serving' : '100 g';
}

function goalOf(params: Params, language: CatalogLanguage): string {
  return goalName(String(params.goal) as GoalId, language);
}

function pick(language: CatalogLanguage, en: string, ru: string): string {
  return language === 'ru' ? ru : en;
}

/** direction is set by the scorer: 'good' | 'ok' | 'bad'. */
function direction(params: Params): 'good' | 'ok' | 'bad' {
  const value = String(params.direction ?? 'ok');
  return value === 'good' || value === 'bad' ? value : 'ok';
}

const NUTRIENT_TEMPLATE = (options: {
  labelEn: Record<'good' | 'ok' | 'bad', string>;
  labelRu: Record<'good' | 'ok' | 'bad', string>;
  unitEn: string;
  unitRu: string;
  nounEn: string;
  nounRu: string;
}): Template => (params, language) => {
  const dir = direction(params);
  const value = params.value;
  const ref = reference(params, language);
  const goal = goalOf(params, language);
  return {
    label: pick(language, options.labelEn[dir], options.labelRu[dir]),
    evidence: pick(
      language,
      `${options.nounEn}: ${value} ${options.unitEn} per ${ref}, weighed against your "${goal}" goal.`,
      `${options.nounRu}: ${value} ${options.unitRu} на ${ref} — сопоставлено с вашей целью «${goal}».`,
    ),
  };
};

const TEMPLATES: Record<string, Template> = {
  // ---- Blockers ----------------------------------------------------------
  'blocker.allergen_declared': (params, language) => {
    const allergen = allergenName(String(params.allergen), language);
    return {
      label: pick(language, 'Declared allergen', 'Заявленный аллерген'),
      evidence: pick(
        language,
        `The package data explicitly declares ${allergen}, which is on your allergen list.`,
        `В данных упаковки прямо заявлен аллерген «${allergen}» из вашего списка.`,
      ),
    };
  },
  'blocker.allergen_ingredient': (params, language) => {
    const allergen = allergenName(String(params.allergen), language);
    return {
      label: pick(language, 'Allergen found in ingredients', 'Аллерген найден в составе'),
      evidence: pick(
        language,
        `"${params.match}" appears in the ingredient list and matches your ${allergen} allergen.`,
        `В составе указано «${params.match}» — это соответствует вашему аллергену «${allergen}».`,
      ),
    };
  },
  'blocker.avoid_ingredient': (params, language) => ({
    label: pick(language, 'Ingredient on your avoid list', 'Ингредиент из вашего списка исключений'),
    evidence: pick(
      language,
      `"${params.ingredient}" appears in the ingredient list.`,
      `В составе указано «${params.ingredient}».`,
    ),
  }),
  'blocker.diet_conflict': (params, language) => {
    const diet = dietName(String(params.diet) as DietId, language);
    return {
      label: pick(language, 'Conflicts with your diet', 'Не соответствует вашему типу питания'),
      evidence: pick(
        language,
        `Ingredient analysis marks this product as incompatible with ${diet} (${params.evidence}).`,
        `Анализ состава относит продукт к несовместимым с выбранным питанием «${diet}» (${params.evidence}).`,
      ),
    };
  },
  'warning.allergen_traces': (params, language) => {
    const allergen = allergenName(String(params.allergen), language);
    return {
      label: pick(language, 'May contain traces', 'Возможны следы аллергена'),
      evidence: pick(
        language,
        `The package declares possible traces of ${allergen}. This is a manufacturer warning, not an ingredient.`,
        `На упаковке заявлены возможные следы аллергена «${allergen}». Это предупреждение производителя, а не ингредиент.`,
      ),
    };
  },
  'warning.diet_uncertain': (params, language) => {
    const diet = dietName(String(params.diet) as DietId, language);
    return {
      label: pick(language, 'Diet status unclear', 'Соответствие питанию под вопросом'),
      evidence: pick(
        language,
        `Some ingredients cannot be confirmed as ${diet}. Check the package before buying.`,
        `Часть ингредиентов невозможно подтвердить как «${diet}». Проверьте упаковку перед покупкой.`,
      ),
    };
  },
  'warning.allergen_data_missing': (_params, language) => ({
    label: pick(language, 'Allergen data is incomplete', 'Данных об аллергенах нет'),
    evidence: pick(
      language,
      'No allergen declaration is available for this product, so your allergen list could not be checked. An empty list never proves the product is free from it.',
      'Для этого продукта нет данных о заявленных аллергенах, поэтому проверить ваш список не удалось. Пустой список не доказывает отсутствие аллергена.',
    ),
  }),

  // ---- Base quality -------------------------------------------------------
  'base.nutriscore': (params, language) => {
    const grade = String(params.grade).toUpperCase();
    return {
      label: pick(language, `Nutri-Score ${grade}`, `Nutri-Score ${grade}`),
      evidence: pick(
        language,
        `Open Food Facts publishes Nutri-Score ${grade} for this product; it sets the baseline nutritional quality before your goals are applied.`,
        `Open Food Facts указывает для продукта Nutri-Score ${grade} — это базовое качество питания до учёта ваших целей.`,
      ),
    };
  },
  'base.nutrition_profile': (params, language) => {
    const detail = renderNutrientDetail(String(params.detail ?? ''), language);
    return {
      label: pick(language, 'Nutritional profile', 'Профиль питательности'),
      evidence: pick(
        language,
        `No Nutri-Score is published, so the baseline is derived from the declared values: ${detail}.`,
        `Nutri-Score не опубликован, поэтому базовая оценка выведена из заявленных значений: ${detail}.`,
      ),
    };
  },
  'base.nutrition_unknown': (_params, language) => ({
    label: pick(language, 'Baseline quality unknown', 'Базовое качество неизвестно'),
    evidence: pick(
      language,
      'Not enough nutrition data is available to judge baseline quality, so the score starts from a neutral midpoint.',
      'Данных о пищевой ценности недостаточно для базовой оценки, поэтому балл стартует с нейтральной середины.',
    ),
  }),
  'base.nova': (params, language) => {
    const group = Number(params.group);
    const labels: Record<number, [string, string]> = {
      1: ['Unprocessed or minimally processed', 'Необработанный или минимально обработанный'],
      2: ['Processed culinary ingredient', 'Обработанный кулинарный ингредиент'],
      3: ['Processed food', 'Обработанный продукт'],
      4: ['Ultra-processed food', 'Ультраобработанный продукт'],
    };
    return {
      label: pick(language, labels[group]?.[0] ?? 'Processing level', labels[group]?.[1] ?? 'Степень обработки'),
      evidence: pick(
        language,
        `Open Food Facts classifies this product in NOVA group ${group}.`,
        `Open Food Facts относит продукт к группе NOVA ${group}.`,
      ),
    };
  },
  'base.additive_high': (params, language) => {
    // params.basis is a machine code; never print it raw.
    const basis = additiveBasisText(String(params.basis) as AdditiveBasis, language);
    return {
      label: pick(language, 'Additive of concern', 'Добавка повышенного внимания'),
      evidence: pick(
        language,
        `${params.names}: ${basis}. IngreFit rates this as high-attention, so the product cannot reach a high baseline score.`,
        `${params.names}: ${basis}. IngreFit относит это к повышенному вниманию, поэтому базовая оценка ограничена.`,
      ),
    };
  },
  'base.additive_moderate': (params, language) => ({
    label: pick(language, 'Additives to be aware of', 'Добавки, о которых стоит знать'),
    evidence: pick(
      language,
      `${params.count} additive(s) with a defined intake limit or classification: ${params.names}.`,
      `Добавок с установленным пределом потребления или классификацией: ${params.count} — ${params.names}.`,
    ),
  }),
  'base.additives_clean': (_params, language) => ({
    label: pick(language, 'No flagged additives', 'Добавок повышенного внимания нет'),
    evidence: pick(
      language,
      'The declared additive list contains nothing that IngreFit flags for extra attention.',
      'В заявленном списке добавок нет ничего, что IngreFit помечает как требующее особого внимания.',
    ),
  }),
  'base.fruit_veg': (params, language) => ({
    label: pick(language, 'Fruit, vegetable and nut content', 'Доля фруктов, овощей и орехов'),
    evidence: pick(
      language,
      `Open Food Facts estimates ${params.percent}% fruit, vegetable, pulse and nut content from the ingredient list.`,
      `Open Food Facts оценивает долю фруктов, овощей, бобовых и орехов в ${params.percent}% по списку ингредиентов.`,
    ),
  }),
  'base.palm_oil': (_params, language) => ({
    label: pick(language, 'Contains palm oil', 'Содержит пальмовое масло'),
    evidence: pick(
      language,
      'Ingredient analysis detects palm oil, which raises the saturated fat load and carries known sourcing concerns.',
      'Анализ состава обнаружил пальмовое масло: оно повышает долю насыщенных жиров и вызывает вопросы к происхождению сырья.',
    ),
  }),
  'base.organic': (_params, language) => ({
    label: pick(language, 'Certified organic', 'Органическая сертификация'),
    evidence: pick(
      language,
      'The product carries an official organic label. IngreFit records this but gives it only a small weight, because organic status does not by itself improve nutritional quality.',
      'У продукта есть официальная органическая маркировка. IngreFit её фиксирует, но учитывает с малым весом: сама по себе она не улучшает пищевую ценность.',
    ),
  }),
  'base.alcohol': (params, language) => ({
    label: pick(language, 'Contains alcohol', 'Содержит алкоголь'),
    evidence: pick(
      language,
      `The product declares ${params.percent}% alcohol by volume.`,
      `На упаковке заявлено ${params.percent}% алкоголя по объёму.`,
    ),
  }),

  // ---- Personal goal rules -------------------------------------------------
  'personal.protein': NUTRIENT_TEMPLATE({
    labelEn: { good: 'Strong protein density', ok: 'Some protein', bad: 'Low protein for your goal' },
    labelRu: { good: 'Высокая плотность белка', ok: 'Немного белка', bad: 'Мало белка для вашей цели' },
    unitEn: 'g', unitRu: 'г', nounEn: 'Protein', nounRu: 'Белок',
  }),
  'personal.sugars': NUTRIENT_TEMPLATE({
    labelEn: { good: 'Low sugar for your goal', ok: 'Moderate sugar', bad: 'High sugar for your goal' },
    labelRu: { good: 'Мало сахара для вашей цели', ok: 'Умеренно сахара', bad: 'Много сахара для вашей цели' },
    unitEn: 'g', unitRu: 'г', nounEn: 'Sugars', nounRu: 'Сахара',
  }),
  'personal.fiber': NUTRIENT_TEMPLATE({
    labelEn: { good: 'Good fiber density', ok: 'Some fiber', bad: 'Low fiber for your goal' },
    labelRu: { good: 'Хорошая плотность клетчатки', ok: 'Немного клетчатки', bad: 'Мало клетчатки для вашей цели' },
    unitEn: 'g', unitRu: 'г', nounEn: 'Fiber', nounRu: 'Клетчатка',
  }),
  'personal.salt': NUTRIENT_TEMPLATE({
    labelEn: { good: 'Low salt for your goal', ok: 'Moderate salt', bad: 'High salt for your goal' },
    labelRu: { good: 'Мало соли для вашей цели', ok: 'Умеренно соли', bad: 'Много соли для вашей цели' },
    unitEn: 'g', unitRu: 'г', nounEn: 'Salt equivalent', nounRu: 'Эквивалент соли',
  }),
  'personal.saturated_fat': NUTRIENT_TEMPLATE({
    labelEn: { good: 'Low saturated fat', ok: 'Moderate saturated fat', bad: 'High saturated fat for your goal' },
    labelRu: { good: 'Мало насыщенных жиров', ok: 'Умеренно насыщенных жиров', bad: 'Много насыщенных жиров для вашей цели' },
    unitEn: 'g', unitRu: 'г', nounEn: 'Saturated fat', nounRu: 'Насыщенные жиры',
  }),
  'personal.carbs': NUTRIENT_TEMPLATE({
    labelEn: { good: 'Low carbohydrate density', ok: 'Moderate carbohydrates', bad: 'High carbohydrates for your pattern' },
    labelRu: { good: 'Низкая плотность углеводов', ok: 'Умеренно углеводов', bad: 'Много углеводов для вашего питания' },
    unitEn: 'g', unitRu: 'г', nounEn: 'Carbohydrates', nounRu: 'Углеводы',
  }),
  'personal.energy': NUTRIENT_TEMPLATE({
    labelEn: { good: 'Low energy density', ok: 'Moderate energy density', bad: 'High energy density' },
    labelRu: { good: 'Низкая калорийная плотность', ok: 'Умеренная калорийность', bad: 'Высокая калорийная плотность' },
    unitEn: 'kcal', unitRu: 'ккал', nounEn: 'Energy', nounRu: 'Энергетическая ценность',
  }),
  'personal.processing': (params, language) => {
    const dir = direction(params);
    return {
      label: pick(
        language,
        dir === 'good' ? 'Minimally processed, as you asked' : dir === 'bad' ? 'Highly processed for your goal' : 'Moderately processed',
        dir === 'good' ? 'Минимальная обработка, как вы просили' : dir === 'bad' ? 'Высокая обработка для вашей цели' : 'Средняя степень обработки',
      ),
      evidence: pick(
        language,
        `NOVA group ${params.group} is weighed against your "${goalOf(params, language)}" goal.`,
        `Группа NOVA ${params.group} сопоставлена с вашей целью «${goalOf(params, language)}».`,
      ),
    };
  },
  'personal.nutriscore': (params, language) => {
    const grade = String(params.grade).toUpperCase();
    const dir = direction(params);
    return {
      label: pick(
        language,
        dir === 'good' ? `Nutri-Score ${grade} suits your goal` : dir === 'bad' ? `Nutri-Score ${grade} works against your goal` : `Nutri-Score ${grade}`,
        dir === 'good' ? `Nutri-Score ${grade} подходит вашей цели` : dir === 'bad' ? `Nutri-Score ${grade} работает против вашей цели` : `Nutri-Score ${grade}`,
      ),
      evidence: pick(
        language,
        `Nutri-Score ${grade} is weighed against your "${goalOf(params, language)}" goal.`,
        `Nutri-Score ${grade} сопоставлен с вашей целью «${goalOf(params, language)}».`,
      ),
    };
  },
  'personal.no_data': (_params, language) => ({
    label: pick(language, 'Not enough data for your goals', 'Недостаточно данных для ваших целей'),
    evidence: pick(
      language,
      'None of the values needed for your selected goals are available, so the score reflects general product quality only.',
      'Значений, нужных для ваших целей, нет, поэтому балл отражает только общее качество продукта.',
    ),
  }),
};

export function renderSignal(signal: ScoreSignal, language: CatalogLanguage): { label: string; evidence: string } {
  const template = TEMPLATES[signal.code];
  if (!template) {
    return {
      label: pick(language, 'Additional factor', 'Дополнительный фактор'),
      evidence: pick(language, 'This factor affected the score.', 'Этот фактор повлиял на оценку.'),
    };
  }
  const rendered = template(signal.params, language);
  if (signal.params.estimated === 1) {
    return {
      label: rendered.label,
      evidence: pick(language, `Approximate AI estimate. ${rendered.evidence}`, `Ориентировочная оценка AI. ${rendered.evidence}`),
    };
  }
  return rendered;
}
