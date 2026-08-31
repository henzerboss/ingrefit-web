import { readFile } from 'node:fs/promises';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { imageFilePath } from '@/lib/ingrefit/community';
import { safeDb } from '@/lib/ingrefit/db';

export const runtime = 'nodejs';

/**
 * Front-photo thumbnail for a contributed product.
 *
 * Public and cacheable: the image is already embedded in the product record as
 * `image_front_url`, so the app fetches it exactly like an Open Food Facts
 * image and needs no new code. Only published records are served, so hiding a
 * record in the admin also hides its photo.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ barcode: string }> }) {
  const { barcode } = await context.params;
  if (!/^\d{6,18}$/.test(barcode)) return new NextResponse(null, { status: 404 });

  const row = await safeDb((db) =>
    db.communityProduct.findFirst({ where: { barcode, status: 'published' }, select: { imagePath: true } }),
  );
  if (!row?.imagePath) return new NextResponse(null, { status: 404 });

  try {
    const bytes = await readFile(imageFilePath(row.imagePath));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'image/jpeg',
        // Immutable per barcode+revision is not knowable here, so a day is a
        // reasonable compromise between freshness after an edit and traffic.
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
