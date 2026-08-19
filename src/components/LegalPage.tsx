import { Link } from '@/i18n/navigation';

import { Logo } from './Logo';

interface SubsectionSpec { number: string; title: string; body: string }
interface SectionSpec { number: number; title: string; body: string; subsections?: SubsectionSpec[] }
interface LegalDocument { title: string; notice?: string | null; intro: string; sections: SectionSpec[] }

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <main className="legal-page" lang="en">
      <div className="legal-shell">
        <div className="legal-top"><Logo /><span className="legal-language">English only</span></div>
        <h1>{document.title}</h1>
        {document.notice ? <p className="legal-notice">{document.notice}</p> : <p className="legal-notice">This document is only available in English.</p>}
        <p className="legal-intro">{document.intro}</p>
        {document.sections.map((section) => (
          <section key={section.number}>
            <h2><span>{String(section.number).padStart(2, '0')}</span>{section.title}</h2>
            {section.body ? <p>{section.body}</p> : null}
            {section.subsections?.map((subsection) => (
              <div className="legal-subsection" key={subsection.number}>
                <h3><span>{subsection.number}</span>{subsection.title}</h3>
                <p>{subsection.body}</p>
              </div>
            ))}
          </section>
        ))}
        <Link className="text-link" href="/">← Back to IngreFit</Link>
      </div>
    </main>
  );
}
