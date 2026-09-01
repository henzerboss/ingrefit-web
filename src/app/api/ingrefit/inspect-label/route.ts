import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireClient, resolvePlan } from '@/lib/ingrefit/auth';
import { errorResponse, HttpError } from '@/lib/ingrefit/http';
import { clientIp, enforceLimit } from '@/lib/ingrefit/rateLimit';
import { recognizeLabel } from '@/lib/ingrefit/recognition';
import { inspectLabelRequestSchema } from '@/lib/ingrefit/schemas';
import { nutritionFieldCount } from '@/lib/ingrefit/openFoodFacts';

export const runtime = 'nodejs';
export const maxDuration = 45;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, X-IngreFit-Installation, X-IngreFit-Plan, X-IngreFit-Entitlement, X-IngreFit-Signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const;

/**
 * Read the photos captured so far and report what is still missing.
 *
 * The capture flow used to ask for a fixed set of shots and only discover the
 * ingredient photo was unreadable after the whole sequence, at the point of no
 * return. This reads the first photo immediately, so the next step can be
 * "retake, it is blurred", "the nutrition table is still needed" or "done" —
 * decided from what is actually on the picture rather than from a script.
 *
 * The recognition is cached by photo set, so a capture that needs no second
 * shot still costs exactly one Gemini call in total.
 */
export async function POST(request: NextRequest) {
  try {
    const installationId = requireClient(request);
    await enforceLimit('analyze:ip', clientIp(request.headers), false);

    const plan = await resolvePlan(request, installationId);
    if (plan !== 'premium') throw new HttpError(402, 'PREMIUM_REQUIRED', 'Label reading requires Premium.');
    await enforceLimit('ai:installation', installationId, true);

    const parsed = inspectLabelRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST', 'The inspection request is invalid.');

    const facts = await recognizeLabel(parsed.data.barcode ?? null, parsed.data.photos, parsed.data.locale);
    const ingredientsReadable = Boolean(facts.ingredientsText?.trim() || facts.ingredients.length);
    // Four is the same bar the scorer uses to decide a record is usable.
    const nutritionReadable = nutritionFieldCount(facts) >= 4;

    return NextResponse.json(
      {
        // What the reader could see, so the client can name the product back to
        // the user and prove the photo worked.
        name: facts.name,
        brand: facts.brand,
        ingredientsReadable,
        nutritionReadable,
        allergenCount: facts.allergenTags.length,
        next: !ingredientsReadable ? 'retake' : nutritionReadable ? 'front' : 'nutrition',
      },
      { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
