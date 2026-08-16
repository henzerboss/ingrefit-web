import { useTranslations } from 'next-intl';

import type { LocaleCode } from '@/i18n/locales';

import { LanguageSwitcher } from './LanguageSwitcher';
import { Logo } from './Logo';
import { TrackedLink } from './TrackedLink';
import { ThemeSwitcher } from './ThemeSwitcher';

export function SiteHeader({ locale }: { locale: LocaleCode }) {
  const t = useTranslations('nav');
  return (
    <header className="site-header">
      <div className="container nav-shell">
        <Logo />
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#how">{t('how')}</a>
          <a href="#principle">{t('principle')}</a>
          <a href="#pricing">{t('pricing')}</a>
        </nav>
        <div className="nav-actions">
          <ThemeSwitcher labels={{ system: t('themeSystem'), light: t('themeLight'), dark: t('themeDark') }} />
          <LanguageSwitcher labels={{ title: t('languageTitle'), search: t('languageSearch'), close: t('languageClose') }} locale={locale} />
          <TrackedLink className="button button-small" eventName="nav_download_click" eventParams={{ locale }} href="#download">{t('cta')}</TrackedLink>
        </div>
      </div>
    </header>
  );
}
