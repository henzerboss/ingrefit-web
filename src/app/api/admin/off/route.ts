import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isAdmin } from '@/lib/ingrefit/admin';
import { getDb } from '@/lib/ingrefit/db';

export const runtime = 'nodejs';

/**
 * Mutations for the Open Food Facts mirror.
 *
 * Only the two fields that decide whether a product can be recommended are
 * editable — categories and markets. Everything else is upstream data that the
 * next `--delta` import would overwrite anyway, so offering to edit it would be
 * offering something we cannot keep.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) return NextResponse.redirect(new URL('/admin', request.url), { status: 303 });
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });

  const form = await request.formData();
  const barcode = String(form.get('barcode') ?? '');
  const action = String(form.get('action') ?? '');
  const back = String(form.get('back') ?? '/admin/off');
  if (!/^\d{6,18}$/.test(barcode)) return NextResponse.redirect(new URL(back, request.url), { status: 303 });

  if (action === 'delete') {
    await db.offProduct.delete({ where: { barcode } }).catch(() => undefined);
  } else if (action === 'save-json') {
    const raw = String(form.get('json') ?? '');
    try {
      const record = JSON.parse(raw) as Record<string, unknown>;
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('not an object');
      await db.offProduct.update({ where: { barcode }, data: { data: record as never } });
    } catch (error) {
      console.error('[ingrefit] Admin JSON edit rejected', error);
      return NextResponse.redirect(new URL(`${back}&edit=${barcode}&error=json`, request.url), { status: 303 });
    }
  } else if (action === 'save') {
    const row = await db.offProduct.findUnique({ where: { barcode }, select: { data: true } });
    if (row) {
      const record = row.data as Record<string, unknown>;
      record.categories_tags = String(form.get('categories_tags') ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      record.countries_tags = String(form.get('countries_tags') ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      await db.offProduct.update({ where: { barcode }, data: { data: record as never } });
    }
  }
  return NextResponse.redirect(new URL(back, request.url), { status: 303 });
}
