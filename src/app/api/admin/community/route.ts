import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isAdmin } from '@/lib/ingrefit/admin';
import { deleteCommunityRecord } from '@/lib/ingrefit/community';
import { getDb } from '@/lib/ingrefit/db';

export const runtime = 'nodejs';

/**
 * Mutations for contributed products.
 *
 * A plain form POST rather than JSON, so the admin pages stay server-rendered
 * and keep working with JavaScript disabled — which also makes them trivial to
 * operate from a phone in a shop.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) return NextResponse.redirect(new URL('/admin', request.url), { status: 303 });
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  const form = await request.formData();
  const barcode = String(form.get('barcode') ?? '');
  const action = String(form.get('action') ?? '');
  const back = String(form.get('back') ?? '/admin/community');
  if (!/^\d{6,18}$/.test(barcode)) return NextResponse.redirect(new URL(back, request.url), { status: 303 });

  if (action === 'delete') {
    await deleteCommunityRecord(barcode);
  } else if (action === 'publish' || action === 'hide') {
    await db.communityProduct.update({
      where: { barcode },
      data: { status: action === 'publish' ? 'published' : 'hidden' },
    });
  } else if (action === 'save-json') {
    // The complete record, edited as JSON.
    //
    // The named fields below cover what a reviewer changes most often, but a
    // contributed product carries thirty-odd Open Food Facts fields and an
    // admin that can only reach five of them is an admin you end up bypassing
    // with psql. Parsing is strict: a malformed edit is discarded rather than
    // written half-applied.
    const raw = String(form.get('json') ?? '');
    try {
      const record = JSON.parse(raw) as Record<string, unknown>;
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('not an object');
      await db.communityProduct.update({
        where: { barcode },
        data: {
          data: record as never,
          name: typeof record.product_name === 'string' ? record.product_name : null,
          brands: typeof record.brands === 'string' ? record.brands : null,
          confidence: 1,
        },
      });
    } catch (error) {
      console.error('[ingrefit] Admin JSON edit rejected', error);
      return NextResponse.redirect(new URL(`${back}&edit=${barcode}&error=json`, request.url), { status: 303 });
    }
  } else if (action === 'save') {
    const row = await db.communityProduct.findUnique({ where: { barcode }, select: { data: true } });
    if (row) {
      const record = row.data as Record<string, unknown>;
      const name = String(form.get('name') ?? '').trim();
      const brands = String(form.get('brands') ?? '').trim();
      const ingredients = String(form.get('ingredients_text') ?? '').trim();
      const categories = String(form.get('categories_tags') ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      const countries = String(form.get('countries_tags') ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

      record.product_name = name || undefined;
      record.brands = brands || undefined;
      record.ingredients_text = ingredients || undefined;
      record.categories_tags = categories;
      record.countries_tags = countries;
      // A human edit outranks any future scan: contributeProduct refuses to
      // overwrite a record whose confidence is already at the ceiling.
      await db.communityProduct.update({
        where: { barcode },
        data: { data: record as never, name: name || null, brands: brands || null, confidence: 1 },
      });
    }
  }
  return NextResponse.redirect(new URL(back, request.url), { status: 303 });
}
