import { z } from 'zod';

import { fill, formatNumber, phrase } from './catalog';
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

/**
 * English name of the target language, for the model prompt.
 *
 * This used to be hardcoded as "Russian or English", which silently forced every
 * other locale's Premium summary into English even after the catalog itself was
 * translated. Intl keeps it correct for any language we add later.
 */
function languageName(language: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ?? language;
  } catch {
    return language;
  }
}

/**
 * Scripts a reply must contain to be plausibly in the requested language.
 * A model that ignores the language instruction usually answers in English, and
 * Latin script is not diagnostic, so only non-Latin scripts are checked.
 */
const EXPECTED_SCRIPT: Record<string, RegExp> = {
  ru: /[\u0400-\u04FF]/, uk: /[\u0400-\u04FF]/, sr: /[\u0400-\u04FF]/, bg: /[\u0400-\u04FF]/,
  kk: /[\u0400-\u04FF]/, mk: /[\u0400-\u04FF]/,
  zh: /[\u4E00-\u9FFF]/, ja: /[\u3040-\u30FF\u4E00-\u9FFF]/, ko: /[\uAC00-\uD7AF]/,
  ar: /[\u0600-\u06FF]/, he: /[\u0590-\u05FF]/, el: /[\u0370-\u03FF]/, th: /[\u0E00-\u0E7F]/,
  hi: /[\u0900-\u097F]/, mr: /[\u0900-\u097F]/, ne: /[\u0900-\u097F]/,
  bn: /[\u0980-\u09FF]/, pa: /[\u0A00-\u0A7F]/, gu: /[\u0A80-\u0AFF]/,
  ta: /[\u0B80-\u0BFF]/, te: /[\u0C00-\u0C7F]/, kn: /[\u0C80-\u0CFF]/, ml: /[\u0D00-\u0D7F]/,
};

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

function buildSummary(
  facts: ProductFacts,
  profile: AnalysisProfile,
  scored: ScoredProduct,
  signals: RenderedSignal[],
  language: CatalogLanguage,
): string {
  if (scored.blocked) {
    const blocker = signals.find((signal) => signal.severity === 'critical');
    return fill(phrase(language, 'summary.blocked'), {
      blocker: blocker ? blocker.label.toLocaleLowerCase(language) : phrase(language, 'summary.blockedFallback'),
    });
  }

  const strongest = signals
    .filter((signal) => signal.impact !== 0)
    .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
    .slice(0, 2)
    .map((signal) => signal.label.toLocaleLowerCase(language));

  const delta = scored.personalDelta;
  const personalKey = delta > 0.2 ? 'summary.personalUp' : delta < -0.2 ? 'summary.personalDown' : 'summary.personalFlat';
  const personal = fill(phrase(language, personalKey), {
    goals: profile.goals.slice(0, 3).map((goal) => goalName(goal as GoalId, language)).join(', '),
    delta: formatNumber(language, Math.abs(delta)),
  });

  return fill(phrase(language, strongest.length ? 'summary.withSignals' : 'summary.withoutSignals'), {
    base: formatNumber(language, scored.baseScore),
    personal,
    strongest: strongest.join('; '),
  });
}

function buildDataNotice(facts: ProductFacts, scored: ScoredProduct, language: CatalogLanguage): string {
  const confidence = Math.round(scored.confidence * 100);
  if (facts.source === 'ai_photo') {
    return fill(phrase(language, 'dataNotice.aiPhoto'), { confidence });
  }
  const source = facts.source === 'openfoodfacts' ? 'Open Food Facts (ODbL)' : phrase(language, 'dataNotice.sourcePackage');
  if (facts.nutritionBasis === 'estimated_text') {
    return fill(phrase(language, 'dataNotice.estimatedText'), { source, confidence });
  }
  return fill(phrase(language, 'dataNotice.declared'), {
    source,
    completeness: facts.completeness,
    confidence,
  });
}

function buildTip(facts: ProductFacts, profile: AnalysisProfile, scored: ScoredProduct, language: CatalogLanguage): string {
  if (scored.blocked) return phrase(language, 'tip.blocked');

  const highRisk = facts.additives.find((additive) => additive.risk === 'high');
  if (highRisk) return fill(phrase(language, 'tip.highRiskAdditive'), { code: highRisk.code.toUpperCase() });

  if (facts.novaGroup === 4) return phrase(language, 'tip.ultraProcessed');

  return fill(phrase(language, 'tip.default'), { diet: dietName(profile.diet, language) });
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

/**
 * Declared as a type alias, not an interface, on purpose: Prisma's Json input
 * requires an index signature, and TypeScript gives implicit index signatures
 * to type aliases but never to interfaces. As an interface this fails to
 * compile against the generated client.
 */
type CachedExplanation = {
  summary: string;
  tip: string;
};

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
    `Write "summary": 2-3 sentences telling the user what this means for their goals. Write "tip": one actionable sentence. Use only the facts above. Do not repeat the score as a number list, do not add health or medical claims, do not invent ingredients.`,
    `Write BOTH fields entirely in ${languageName(language)} (locale ${locale}). Do not answer in English unless that is the requested language.`,
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

    // Cheap sanity check: if the language uses a non-Latin script and the reply
    // contains none of it, the model ignored the instruction. Prefer the
    // deterministic text, which is always correctly localized.
    const expected = EXPECTED_SCRIPT[language];
    if (expected && !expected.test(result.summary)) {
      console.warn(`[ingrefit] Model replied outside the ${language} script; using deterministic text`);
      return deterministic;
    }

    await writeExplanationCache(scored.fingerprint, language, result);
    return { ...deterministic, summary: result.summary, tip: result.tip };
  } catch (error) {
    console.error('[ingrefit] Explanation generation failed; using deterministic text', error);
    return deterministic;
  }
}
