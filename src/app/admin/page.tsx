import { redirect } from 'next/navigation';

import { adminConfigured, isAdmin } from '@/lib/ingrefit/admin';

export const dynamic = 'force-dynamic';

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAdmin()) redirect('/admin/community');
  const { error } = await searchParams;

  if (!adminConfigured()) {
    return (
      <p>
        Set <code>INGREFIT_ADMIN_PASSWORD</code> (at least 8 characters) and <code>INGREFIT_ENTITLEMENT_SECRET</code> in
        the environment, then restart the server.
      </p>
    );
  }

  return (
    <form action="/api/admin/login" method="post" style={{ display: 'grid', gap: 12, maxWidth: 320 }}>
      <label htmlFor="password">Admin password</label>
      <input
        autoComplete="current-password"
        id="password"
        name="password"
        required
        style={{ border: '1px solid #CFD8CB', borderRadius: 8, padding: 10 }}
        type="password"
      />
      {error ? <span style={{ color: '#B4402F' }}>Wrong password.</span> : null}
      <button style={{ background: '#2F6B33', border: 0, borderRadius: 8, color: '#fff', padding: 10 }} type="submit">
        Sign in
      </button>
    </form>
  );
}
