import type { Metadata } from 'next';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { routing } from '@/i18n/routing';
import { GoogleAnalytics } from '@/components/GoogleAnalytics';
import { CookieConsent } from '@/components/CookieConsent';
import { isRtlLocale } from '@/i18n/locales';

import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'metadata' });
  return {
    title: t('title'),
    description: t('description'),
    metadataBase: new URL('https://ingrefit.com'),
    alternates: { canonical: `/${locale}`, languages: Object.fromEntries(routing.locales.map((code) => [code, `/${code}`])) },
    openGraph: { title: t('title'), description: t('description'), type: 'website', siteName: 'IngreFit' },
    icons: { icon: '/brand/icon.png', apple: '/brand/app-icon.png' },
  };
}

export default async function LocaleLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html dir={isRtlLocale(locale) ? 'rtl' : 'ltr'} lang={locale} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: "try{const t=localStorage.getItem('ingrefit-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}" }} /></head>
      <body>
        <NextIntlClientProvider messages={messages}>{children}<CookieConsent /></NextIntlClientProvider>
        <GoogleAnalytics />
      </body>
    </html>
  );
}
