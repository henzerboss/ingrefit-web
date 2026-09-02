import type { MetadataRoute } from 'next';

import { LOCALE_CODES } from '@/i18n/locales';

const PAGES = ['', '/privacy', '/terms'] as const;

/**
 * One entry per locale per page, each carrying the full set of alternates.
 *
 * Without the alternates a fifty-language site looks to a crawler like fifty
 * near-duplicate pages competing with each other, which is the usual reason a
 * localized site ranks only in its default language.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.INGREFIT_PUBLIC_URL ?? 'https://ingrefit.com').replace(/\/$/, '');
  const lastModified = new Date();

  return LOCALE_CODES.flatMap((locale) =>
    PAGES.map((page) => ({
      url: `${base}/${locale}${page}`,
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: page === '' ? 1 : 0.5,
      alternates: {
        languages: Object.fromEntries(LOCALE_CODES.map((code) => [code, `${base}/${code}${page}`])),
      },
    })),
  );
}

export const dynamic = 'force-static';
export const revalidate = 86_400;
