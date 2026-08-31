import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { adminConfigured, issueAdminCookie } from '@/lib/ingrefit/admin';
import { clientIp, enforceLimit } from '@/lib/ingrefit/rateLimit';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!adminConfigured()) {
    return NextResponse.json({ error: 'INGREFIT_ADMIN_PASSWORD is not configured' }, { status: 503 });
  }
  // A shared password needs a brute-force ceiling more than anything else here.
  try {
    await enforceLimit('installation:ip', `admin:${clientIp(request.headers)}`, false);
  } catch {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  const form = await request.formData();
  const cookie = issueAdminCookie(String(form.get('password') ?? ''));
  if (!cookie) return NextResponse.redirect(new URL('/admin?error=1', request.url), { status: 303 });

  const response = NextResponse.redirect(new URL('/admin/community', request.url), { status: 303 });
  response.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: cookie.maxAge,
  });
  return response;
}
