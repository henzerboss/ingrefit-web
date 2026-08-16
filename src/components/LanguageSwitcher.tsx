'use client';

import { useEffect, useMemo, useState } from 'react';

import { SUPPORTED_LOCALES, type LocaleCode } from '@/i18n/locales';
import { usePathname, useRouter } from '@/i18n/navigation';

interface LanguageSwitcherProps {
  locale: LocaleCode;
  labels: {
    title: string;
    search: string;
    close: string;
  };
}

export function LanguageSwitcher({ locale, labels }: LanguageSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const pathname = usePathname();
  const router = useRouter();
  const current = SUPPORTED_LOCALES.find((item) => item.id === locale) ?? SUPPORTED_LOCALES[0]!;
  const visibleLocales = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return SUPPORTED_LOCALES;
    return SUPPORTED_LOCALES.filter((item) => item.name.toLocaleLowerCase().includes(normalized) || item.id.includes(normalized));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const choose = (nextLocale: LocaleCode) => {
    setOpen(false);
    setQuery('');
    router.replace(pathname, { locale: nextLocale });
  };

  return (
    <>
      <button aria-expanded={open} aria-haspopup="dialog" className="language" onClick={() => setOpen(true)} type="button">
        <span aria-hidden="true">{current.flag}</span>
        <span>{current.id.toUpperCase()}</span>
      </button>
      {open ? (
        <div className="language-modal-backdrop" onMouseDown={() => setOpen(false)} role="presentation">
          <section aria-label={labels.title} aria-modal="true" className="language-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <div className="language-modal-head">
              <h2>{labels.title}</h2>
              <button aria-label={labels.close} className="language-close" onClick={() => setOpen(false)} type="button">×</button>
            </div>
            <input autoFocus className="language-search" onChange={(event) => setQuery(event.target.value)} placeholder={labels.search} type="search" value={query} />
            <div className="language-grid">
              {visibleLocales.map((item) => (
                <button aria-pressed={item.id === locale} className={`language-option${item.id === locale ? ' language-option-active' : ''}`} key={item.id} onClick={() => choose(item.id)} type="button">
                  <span aria-hidden="true" className="language-flag">{item.flag}</span>
                  <span>{item.name}</span>
                  <small>{item.id.toUpperCase()}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
