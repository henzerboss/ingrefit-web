import { useLocale, useTranslations } from 'next-intl';

import { isRtlLocale, type LocaleCode } from '@/i18n/locales';
import { Link } from '@/i18n/navigation';

import { LanguageSwitcher } from './LanguageSwitcher';
import { Logo } from './Logo';

interface SectionSpec { title: string; body: string }

export function LegalPage({ title, intro, sections }: { title: string; intro: string; sections: SectionSpec[] }) {
  const t = useTranslations('legal');
  const nav = useTranslations('nav');
  const locale = useLocale() as LocaleCode;
  return (
    <main className="legal-page">
      <div className="legal-shell">
        <div className="legal-top"><Logo /><LanguageSwitcher labels={{ title: nav('languageTitle'), search: nav('languageSearch'), close: nav('languageClose') }} locale={locale} /></div>
        <h1>{title}</h1>
        <p className="legal-intro">{intro}</p>
        {sections.map((section) => <section key={section.title}><h2>{section.title}</h2><p>{section.body}</p></section>)}
        <Link className="text-link" href="/">{isRtlLocale(locale) ? '→' : '←'} {t('back')}</Link>
      </div>
    </main>
  );
}
