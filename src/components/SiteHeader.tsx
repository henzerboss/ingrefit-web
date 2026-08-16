import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

import { Logo } from './Logo';
import { TrackedLink } from './TrackedLink';
import { ThemeSwitcher } from './ThemeSwitcher';

export function SiteHeader({ locale }: { locale: string }) {
  const t = useTranslations('nav');
  const alternateLocale = locale === 'ru' ? 'en' : 'ru';
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
          <Link aria-label={`Switch to ${alternateLocale}`} className="language" href="/" locale={alternateLocale}>
            {alternateLocale.toUpperCase()}
          </Link>
          <TrackedLink className="button button-small" eventName="nav_download_click" eventParams={{ locale }} href="#download">{t('cta')}</TrackedLink>
        </div>
      </div>
    </header>
  );
}
