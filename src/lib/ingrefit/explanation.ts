import { z } from 'zod';

import { catalogLanguage, dietName, goalName, renderSignal, type CatalogLanguage } from './signalCatalog';
import { callGemini } from './gemini';
import { safeDb } from './db';
import type { AnalysisProfile, GoalId, ProductAssessment, ProductFacts, RenderedSignal, ScoredProduct } from './types';

/**
 * Assessment text generation.
 *
 * Design change from v1.6: the deterministic renderer is the ONLY producer of
 * signal labels and evidence, in every supported language. Previously the free
 * tier fell back to untranslated English for every locale except Russian.
 *
 * Gemini is now asked for exactly two short strings — a personal summary and one
 * actionable tip — instead of re-writing the whole signal list. That cut the
 * explanation call from roughly 2,500 input / 1,400 output tokens to about
 * 450 / 350, and removed the possibility of the model contradicting a number
 * that the scorer already computed.
 */

const aiSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  tip: z.string().trim().min(1).max(300),
});

const aiResponseSchema = {
  type: 'OBJECT',
  required: ['summary', 'tip'],
  properties: { summary: { type: 'STRING' }, tip: { type: 'STRING' } },
} as const;

function renderSignals(scored: ScoredProduct, language: CatalogLanguage): RenderedSignal[] {
  return scored.signals.map((signal) => {
    const { label, evidence } = renderSignal(signal, language);
    return {
      id: signal.id,
      code: signal.code,
      scope: signal.scope,
      impact: signal.impact,
      severity: signal.severity,
      label,
      evidence,
    };
  });
}

function goalList(profile: AnalysisProfile, language: CatalogLanguage): string {
  return profile.goals.slice(0, 3).map((goal) => goalName(goal as GoalId, language)).join(', ');
}

function buildSummary(
  facts: ProductFacts,
  profile: AnalysisProfile,
  scored: ScoredProduct,
  signals: RenderedSignal[],
  language: CatalogLanguage,
): string {
  const russian = language === 'ru';

  if (scored.blocked) {
    const blocker = signals.find((signal) => signal.severity === 'critical');
    return russian
      ? `Этот продукт не подходит вам по жёсткому ограничению: ${blocker?.label.toLocaleLowerCase('ru') ?? 'ограничение профиля'}. Оценка качества здесь вторична — покупать его не стоит независимо от остальных показателей.`
      : `This product is ruled out by a hard restriction in your profile: ${blocker?.label.toLowerCase() ?? 'profile restriction'}. Quality is secondary here — the restriction stands regardless of the other numbers.`;
  }

  const strongest = signals
    .filter((signal) => signal.impact !== 0)
    .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
    .slice(0, 2)
    .map((signal) => (russian ? signal.label.toLocaleLowerCase('ru') : signal.label.toLowerCase()));

  const goals = goalList(profile, language);
  const personal = scored.personalDelta;
  const personalPhrase = russian
    ? personal > 0.2
      ? `ваши цели (${goals}) подняли оценку на ${personal.toFixed(1)}`
      : personal < -0.2
        ? `ваши цели (${goals}) снизили оценку на ${Math.abs(personal).toFixed(1)}`
        : `ваши цели (${goals}) почти не изменили оценку`
    : personal > 0.2
      ? `your goals (${goals}) raised it by ${personal.toFixed(1)}`
      : personal < -0.2
        ? `your goals (${goals}) lowered it by ${Math.abs(personal).toFixed(1)}`
        : `your goals (${goals}) barely moved it`;

  if (!strongest.length) {
    return russian
      ? `Базовое качество продукта — ${scored.baseScore.toFixed(1)} из 10, и ${personalPhrase}. Данных для более точного разбора пока мало.`
      : `Baseline product quality is ${scored.baseScore.toFixed(1)} out of 10, and ${personalPhrase}. There is not enough data for a finer breakdown.`;
  }

  return russian
    ? `Базовое качество продукта — ${scored.baseScore.toFixed(1)} из 10, и ${personalPhrase}. Сильнее всего повлияли: ${strongest.join('; ')}. Это оценка соответствия именно вашему профилю, а не универсальная «полезность».`
    : `Baseline product quality is ${scored.baseScore.toFixed(1)} out of 10, and ${personalPhrase}. The strongest influences were ${strongest.join('; ')}. This measures fit with your profile, not universal healthiness.`;
}

function buildDataNotice(facts: ProductFacts, scored: ScoredProduct, language: CatalogLanguage): string {
  const russian = language === 'ru';
  const confidence = Math.round(scored.confidence * 100);

  if (facts.source === 'ai_photo') {
    return russian
      ? `Источник: визуальное распознавание AI. Пищевая ценность — ориентировочная оценка по внешнему виду; состав, аллергены и точные значения неизвестны. Достоверность оценки: ${confidence}%.`
      : `Source: AI visual identification. Nutrition is an approximate estimate from appearance; ingredients, allergens and exact values remain unknown. Score confidence: ${confidence}%.`;
  }
  if (facts.nutritionBasis === 'estimated_text') {
    return russian
      ? `Источник фактов: ${facts.source === 'openfoodfacts' ? 'Open Food Facts' : 'текст упаковки'}. Недостающие значения оценены AI по названию и составу, а не взяты с упаковки. Достоверность оценки: ${confidence}%.`
      : `Fact source: ${facts.source === 'openfoodfacts' ? 'Open Food Facts' : 'package text'}. Missing values were estimated by AI from the name and ingredients, not read from the package. Score confidence: ${confidence}%.`;
  }
  const source = facts.source === 'openfoodfacts' ? 'Open Food Facts (ODbL)' : russian ? 'видимый текст упаковки' : 'visible package text';
  return russian
    ? `Источник: ${source}. Полнота данных: ${facts.completeness}%. Достоверность оценки: ${confidence}%.`
    : `Source: ${source}. Data completeness: ${facts.completeness}%. Score confidence: ${confidence}%.`;
}

function buildTip(facts: ProductFacts, profile: AnalysisProfile, scored: ScoredProduct, language: CatalogLanguage): string {
  const russian = language === 'ru';
  if (scored.blocked) {
    return russian
      ? 'Перед покупкой всегда проверяйте упаковку: состав может измениться без обновления базы.'
      : 'Always check the package before buying: recipes change without the database being updated.';
  }
  const highRisk = facts.additives.find((additive) => additive.risk === 'high');
  if (highRisk) {
    return russian
      ? `Если хотите избежать ${highRisk.code.toUpperCase()}, ищите вариант того же типа с более коротким составом.`
      : `To avoid ${highRisk.code.toUpperCase()}, look for the same kind of product with a shorter ingredient list.`;
  }
  if (facts.novaGroup === 4) {
    return russian
      ? 'Это ультраобработанный продукт. Менее обработанный аналог обычно даёт заметно более высокую базовую оценку.'
      : 'This is an ultra-processed product. A less processed equivalent usually scores noticeably higher at baseline.';
  }
  return russian
    ? `Оценка привязана к вашему профилю (${dietName(profile.diet, language)}). Измените цели в профиле — и результат пересчитается.`
    : `The score is tied to your profile (${dietName(profile.diet, language)}). Change your goals and the result is recalculated.`;
}

/** Deterministic assessment. Always complete, always in the user's language. */
export function renderAssessment(
  facts: ProductFacts,
  profile: AnalysisProfile,
  scored: ScoredProduct,
  locale: string,
): ProductAssessment {
  const language = catalogLanguage(locale);
  const signals = renderSignals(scored, language);
  return {
    score: scored.score,
    verdict: scored.verdict,
    baseScore: scored.baseScore,
    personalDelta: scored.personalDelta,
    confidence: scored.confidence,
    blocked: scored.blocked,
    summary: buildSummary(facts, profile, scored, signals, language),
    tip: buildTip(facts, profile, scored, language),
    positives: signals.filter((signal) => signal.severity === 'positive').map((signal) => signal.evidence).slice(0, 6),
    cautions: signals.filter((signal) => signal.severity === 'caution' || signal.severity === 'critical').map((signal) => signal.evidence).slice(0, 6),
    signals,
    dataNotice: buildDataNotice(facts, scored, language),
  };
}

interface CachedExplanation {
  summary: string;
  tip: string;
}

async function readExplanationCache(fingerprint: string, language: string): Promise<CachedExplanation | null> {
  const key = `${fingerprint}:${language}`;
  const row = await safeDb(async (db) => {
    const found = await db.explanationCache.findUnique({ where: { fingerprint: key } });
    if (found) await db.explanationCache.update({ where: { fingerprint: key }, data: { hits: { increment: 1 } } });
    return found;
  });
  if (!row) return null;
  const parsed = aiSchema.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
}

async function writeExplanationCache(fingerprint: string, language: string, payload: CachedExplanation): Promise<void> {
  const key = `${fingerprint}:${language}`;
  await safeDb((db) =>
    db.explanationCache.upsert({
      where: { fingerprint: key },
      create: { fingerprint: key, language, payload },
      update: { payload },
    }),
  );
}

/**
 * Compact model input. Only what the model actually needs to write two
 * sentences: the score, the goals, and the already-rendered signal lines.
 * The full ingredient text is deliberately NOT sent — the signals carry every
 * number the summary may mention.
 */
function buildAiPrompt(
  facts: ProductFacts,
  profile: AnalysisProfile,
  scored: ScoredProduct,
  signals: RenderedSignal[],
  locale: string,
  language: CatalogLanguage,
): string {
  const lines = signals
    .filter((signal) => signal.impact !== 0 || signal.severity === 'critical')
    .slice(0, 10)
    .map((signal) => `${signal.impact >= 0 ? '+' : ''}${signal.impact} ${signal.label} — ${signal.evidence}`);

  return [
    `LANGUAGE: ${locale}`,
    `PRODUCT: ${facts.name ?? 'unknown'}${facts.brand ? ` (${facts.brand})` : ''}`,
    `SCORE: ${scored.score}/10, baseline ${scored.baseScore}, personal adjustment ${scored.personalDelta}, verdict ${scored.verdict}`,
    scored.blocked ? 'HARD_RESTRICTION: yes' : 'HARD_RESTRICTION: no',
    `GOALS: ${profile.goals.join(', ')}; DIET: ${profile.diet}`,
    `SIGNALS:\n${lines.join('\n') || 'none'}`,
    `Write "summary": 2-3 sentences telling the user what this means for their goals. Write "tip": one actionable sentence. Use only the facts above. Do not repeat the score as a number list, do not add health or medical claims, do not invent ingredients. Language must be ${language === 'ru' ? 'Russian' : 'English'}.`,
  ].join('\n');
}

/**
 * Premium explanation. Falls back to the deterministic text on any failure, so
 * a Gemini outage degrades wording, never correctness.
 */
export async function explainScore(
  facts: ProductFacts,
  profile: AnalysisProfile,
  scored: ScoredProduct,
  locale: string,
  useAi: boolean,
): Promise<ProductAssessment> {
  const deterministic = renderAssessment(facts, profile, scored, locale);
  if (!useAi) return deterministic;

  const language = catalogLanguage(locale);
  const cached = await readExplanationCache(scored.fingerprint, language);
  if (cached) {
    return { ...deterministic, summary: cached.summary, tip: cached.tip, cached: true };
  }

  try {
    const result = await callGemini({
      operation: 'score_explanation',
      systemInstruction: [
        'You write a short personalized food-product summary for IngreFit.',
        'The score, its parts and every listed signal are already computed and immutable. Never recalculate, contradict, extend or question them.',
        'Use only the supplied facts. Never invent ingredients, allergens, health effects or safety claims.',
        'Never state that a product is free from something. Unknown means unknown.',
        'Return JSON only and follow the response schema exactly.',
      ].join(' '),
      prompt: buildAiPrompt(facts, profile, scored, deterministic.signals, locale, language),
      responseSchema: aiResponseSchema,
      temperature: 0.2,
      maxOutputTokens: 400,
      validate: (value) => aiSchema.parse(value),
    });

    const looksLocalized = language !== 'ru' || /[А-Яа-яЁё]/.test(result.summary);
    if (!looksLocalized) return deterministic;

    await writeExplanationCache(scored.fingerprint, language, result);
    return { ...deterministic, summary: result.summary, tip: result.tip };
  } catch (error) {
    console.error('[ingrefit] Explanation generation failed; using deterministic text', error);
    return deterministic;
  }
}
