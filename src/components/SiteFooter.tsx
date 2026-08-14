import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

import { Logo } from './Logo';

export function SiteFooter() {
  const t = useTranslations('footer');
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <Logo />
          <p className="footer-tagline">{t('tagline')}</p>
        </div>
        <div className="footer-links">
          <Link href="/privacy">{t('privacy')}</Link>
          <Link href="/terms">{t('terms')}</Link>
        </div>
      </div>
      <div className="container footer-fineprint">
        <p>{t('disclaimer')}</p>
        <p>{t('off')}</p>
        <span>© {new Date().getFullYear()} IngreFit</span>
      </div>
    </footer>
  );
}
