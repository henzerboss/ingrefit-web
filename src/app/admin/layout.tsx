import type { Metadata } from 'next';
import Link from 'next/link';

import { isAdmin } from '@/lib/ingrefit/admin';

export const metadata: Metadata = { title: 'IngreFit admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Deliberately outside `[locale]`: the admin is one operator's tool, not a
 * localized product surface, and keeping it off the localized routes means the
 * next-intl middleware never touches it.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const authorized = await isAdmin();
  return (
    <html lang="en">
      <body style={{ background: '#F6F6F1', color: '#12200F', fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <div style={{ margin: '0 auto', maxWidth: 1200, padding: '24px 16px 64px' }}>
          <header style={{ alignItems: 'baseline', display: 'flex', gap: 20, marginBottom: 24 }}>
            <strong style={{ fontSize: 20 }}>IngreFit admin</strong>
            {authorized ? (
              <nav style={{ display: 'flex', gap: 16 }}>
                <Link href="/admin/community">Contributed products</Link>
                <Link href="/admin/off">Open Food Facts mirror</Link>
              </nav>
            ) : null}
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
