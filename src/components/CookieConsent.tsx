'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

export const COOKIE_CONSENT_KEY = 'ingrefit-cookie-consent-v1';
export const COOKIE_CONSENT_EVENT = 'ingrefit-consent-changed';

export function CookieConsent() {
  const t = useTranslations('cookies');
  const footer = useTranslations('footer');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(!localStorage.getItem(COOKIE_CONSENT_KEY));
    } catch {
      setVisible(true);
    }
  }, []);

  const choose = (value: 'accepted' | 'rejected') => {
    try {
      localStorage.setItem(COOKIE_CONSENT_KEY, value);
    } catch {}
    window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: value }));
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <aside aria-live="polite" className="cookie-banner">
      <div className="cookie-icon" aria-hidden="true">◌</div>
      <div className="cookie-copy"><p>{t('text')}</p><Link href="/privacy">{footer('privacy')}</Link></div>
      <div className="cookie-actions">
        <button className="button button-outline" onClick={() => choose('rejected')} type="button">{t('reject')}</button>
        <button className="button" onClick={() => choose('accepted')} type="button">{t('accept')}</button>
      </div>
    </aside>
  );
}

