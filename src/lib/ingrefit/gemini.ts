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
  error?: { message?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
}

function models(): string[] {
  return (process.env.INGREFIT_GEMINI_MODELS ?? 'gemini-3.1-flash-lite,gemini-2.5-flash-lite')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

async function attempt<T>(model: string, input: GeminiRequest<T>, apiKey: string): Promise<T> {
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
  for (const image of input.images ?? []) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
  }

  const thinkingConfig = model.startsWith('gemini-3')
    ? { thinkingLevel: 'minimal' }
    : model.includes('2.5') ? { thinkingBudget: 0 } : undefined;
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
  if (!response.ok) throw new Error(payload.error?.message ?? `Gemini ${model} returned HTTP ${response.status}`);
  const usage = payload.usageMetadata;
  if (usage) {
    const promptTokens = usage.promptTokenCount ?? 0;
    const outputTokens = usage.candidatesTokenCount ?? 0;
    const thoughtTokens = usage.thoughtsTokenCount ?? 0;
    const estimatedCostUsd = model === 'gemini-3.1-flash-lite'
      ? (promptTokens * 0.25 + (outputTokens + thoughtTokens) * 1.5) / 1_000_000
      : null;
    console.info('[ingrefit] Gemini usage', JSON.stringify({
      operation: input.operation,
      model,
      promptTokens,
      outputTokens,
      thoughtTokens,
      cachedTokens: usage.cachedContentTokenCount ?? 0,
      totalTokens: usage.totalTokenCount ?? promptTokens + outputTokens + thoughtTokens,
      estimatedCostUsd,
    }));
  }
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!text) throw new Error(`Gemini ${model} returned an empty response`);
  return input.validate(parseJson(text));
}

export async function callGemini<T>(input: GeminiRequest<T>): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpError(503, 'AI_NOT_CONFIGURED', 'Product label analysis is not configured.');

  let lastError: unknown;
  for (const model of models()) {
    try {
      return await attempt(model, input, apiKey);
    } catch (error) {
      lastError = error;
      console.error(`[ingrefit] Gemini model ${model} failed`, error);
    }
  }
  throw new HttpError(502, 'AI_UNAVAILABLE', 'The product label could not be read.', {
    reason: lastError instanceof Error ? lastError.message : 'Unknown Gemini error',
  });
}
