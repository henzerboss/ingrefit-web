import { HttpError } from './http';

interface GeminiImage {
  base64: string;
  mimeType: 'image/jpeg';
}

interface GeminiRequest<T> {
  operation: string;
  systemInstruction: string;
  prompt: string;
  responseSchema: Record<string, unknown>;
  images?: GeminiImage[];
  temperature?: number;
  maxOutputTokens?: number;
  validate: (value: unknown) => T;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  /**
   * Google returns the useful part in `details`, not `message`: a 400 says
   * "Request contains an invalid argument" and only the details name the field.
   */
  error?: { message?: string; status?: string; details?: unknown };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
}

/**
 * Models tried in order, first to last.
 *
 * Overridden with INGREFIT_GEMINI_MODELS. Keep the list short and current:
 * Google retires older names, and a retired fallback is worse than none — it
 * turns every failure into two, and the second one's error message buries the
 * first one's, which is the real reason the label path looked broken.
 */
function models(): string[] {
  return (process.env.INGREFIT_GEMINI_MODELS ?? 'gemini-3.1-flash-lite,gemini-3.5-flash-lite')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
}

/**
 * A schema-validation failure is not a transport problem: retrying the same
 * prompt on the next model usually fails the same way and doubles the bill.
 * Only transport and capacity errors are worth a second paid attempt.
 */
class RetryableGeminiError extends Error {}

function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

async function attempt<T>(model: string, input: GeminiRequest<T>, apiKey: string): Promise<T> {
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  for (const image of input.images ?? []) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
  }

  const thinkingConfig = model.startsWith('gemini-3')
    ? { thinkingLevel: 'minimal' }
    : model.includes('2.5')
      ? { thinkingBudget: 0 }
      : undefined;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.systemInstruction }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: input.temperature ?? 0.1,
          maxOutputTokens: input.maxOutputTokens ?? 1_800,
          responseMimeType: 'application/json',
          responseSchema: input.responseSchema,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      }),
      signal: AbortSignal.timeout(35_000),
      cache: 'no-store',
    },
  );
  const payload = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) {
    const details = payload.error?.details ? ` details=${JSON.stringify(payload.error.details)}` : '';
    const message = `${payload.error?.message ?? `Gemini ${model} returned HTTP ${response.status}`}${details}`;
    // A 400 is the request's fault, not the model's. Retrying it against
    // another model cannot help, wastes quota, and — worse — buries the one
    // message that says which field Google objected to under three identical
    // failures. Only a rejected *prompt* is worth another model.
    const badRequest = response.status === 400;
    if (badRequest) {
      console.error(`[ingrefit] Gemini rejected the request for ${input.operation}: ${message}`);
    }
    const retryable = response.status === 429 || response.status >= 500 || response.status === 404;
    throw retryable ? new RetryableGeminiError(message) : new Error(message);
  }
  const usage = payload.usageMetadata;
  if (usage) {
    const promptTokens = usage.promptTokenCount ?? 0;
    const outputTokens = usage.candidatesTokenCount ?? 0;
    const thoughtTokens = usage.thoughtsTokenCount ?? 0;
    const estimatedCostUsd =
      model === 'gemini-3.1-flash-lite'
        ? (promptTokens * 0.25 + (outputTokens + thoughtTokens) * 1.5) / 1_000_000
        : null;
    console.info(
      '[ingrefit] Gemini usage',
      JSON.stringify({
        operation: input.operation,
        model,
        promptTokens,
        outputTokens,
        thoughtTokens,
        cachedTokens: usage.cachedContentTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? promptTokens + outputTokens + thoughtTokens,
        estimatedCostUsd,
      }),
    );
  }
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!text) throw new RetryableGeminiError(`Gemini ${model} returned an empty response`);
  return input.validate(parseJson(text));
}

export async function callGemini<T>(input: GeminiRequest<T>): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpError(503, 'AI_NOT_CONFIGURED', 'Product label analysis is not configured.');

  const modelOrder = models();
  let lastError: unknown;
  for (let index = 0; index < modelOrder.length; index += 1) {
    const model = modelOrder[index]!;
    try {
      return await attempt(model, input, apiKey);
    } catch (error) {
      lastError = error;
      const isNetwork = error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');
      const shouldFallOver = error instanceof RetryableGeminiError || isNetwork;
      const text = error instanceof Error ? error.message : String(error);
      if (/no longer available|not found for API version/i.test(text)) {
        console.error(
          `[ingrefit] Gemini model "${model}" has been retired by Google. Remove it from INGREFIT_GEMINI_MODELS.`,
        );
      }
      console.error(`[ingrefit] Gemini model ${model} failed (retrying: ${shouldFallOver})`, error);
      if (!shouldFallOver) break;
    }
  }
  throw new HttpError(502, 'AI_UNAVAILABLE', 'The product label could not be read.', {
    reason: lastError instanceof Error ? lastError.message : 'Unknown Gemini error',
  });
}
