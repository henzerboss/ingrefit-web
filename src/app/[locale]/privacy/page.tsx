import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

import { LegalPage } from '@/components/LegalPage';
import privacyDocument from '@/content/legal/privacy.json';

export const metadata: Metadata = {
  alternates: { canonical: '/en/privacy' },
  description: 'How IngreFit processes information in the mobile app, website and related services.',
  title: 'Privacy Policy | IngreFit',
};

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage document={privacyDocument} />;
}
