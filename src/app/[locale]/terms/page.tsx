import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

import { LegalPage } from '@/components/LegalPage';
import termsDocument from '@/content/legal/terms.json';

export const metadata: Metadata = {
  alternates: { canonical: '/en/terms' },
  description: 'Terms that govern access to and use of IngreFit services.',
  title: 'Terms of Use | IngreFit',
};

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage document={termsDocument} />;
}
