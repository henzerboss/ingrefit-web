import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { LegalPage } from '@/components/LegalPage';

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Privacy />;
}

function Privacy() {
  const t = useTranslations('legal');
  return <LegalPage title={t('privacyTitle')} intro={t('privacyIntro')} sections={[
    { title: t('privacyDataTitle'), body: t('privacyDataBody') },
    { title: t('privacyImagesTitle'), body: t('privacyImagesBody') },
    { title: t('privacyThirdTitle'), body: t('privacyThirdBody') },
    { title: t('privacyRightsTitle'), body: t('privacyRightsBody') },
  ]} />;
}
