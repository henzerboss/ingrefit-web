import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

import { Logo } from './Logo';

interface SectionSpec { title: string; body: string }

export function LegalPage({ title, intro, sections }: { title: string; intro: string; sections: SectionSpec[] }) {
  const t = useTranslations('legal');
  return (
    <main className="legal-page">
      <div className="legal-shell">
        <Logo />
        <h1>{title}</h1>
        <p className="legal-intro">{intro}</p>
        {sections.map((section) => <section key={section.title}><h2>{section.title}</h2><p>{section.body}</p></section>)}
        <Link className="text-link" href="/">← {t('back')}</Link>
      </div>
    </main>
  );
}
