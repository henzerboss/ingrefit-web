import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { LegalPage } from '@/components/LegalPage';

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Terms />;
}

function Terms() {
  const t = useTranslations('legal');
  return <LegalPage title={t('termsTitle')} intro={t('termsIntro')} sections={[
    { title: t('termsInfoTitle'), body: t('termsInfoBody') },
    { title: t('termsDataTitle'), body: t('termsDataBody') },
    { title: t('termsBillingTitle'), body: t('termsBillingBody') },
    { title: t('termsAcceptTitle'), body: t('termsAcceptBody') },
  ]} />;
}
