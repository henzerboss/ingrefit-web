'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';

import { COOKIE_CONSENT_EVENT, COOKIE_CONSENT_KEY } from './CookieConsent';

const MEASUREMENT_ID = 'G-P2ZSBZ3YST';

export function GoogleAnalytics() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const sync = (event?: Event) => {
      const next = event instanceof CustomEvent ? event.detail : localStorage.getItem(COOKIE_CONSENT_KEY);
      setAllowed(next === 'accepted');
    };
    try { sync(); } catch {}
    window.addEventListener(COOKIE_CONSENT_EVENT, sync);
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT, sync);
  }, []);

  if (!allowed) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`} strategy="afterInteractive" />
      <Script id="ingrefit-google-analytics" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${MEASUREMENT_ID}');`}
      </Script>
    </>
  );
}
