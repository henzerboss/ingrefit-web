import type { MetadataRoute } from 'next';

/**
 * The API and the admin are not content. Everything else is fifty localized
 * copies of three pages, which the sitemap declares with hreflang so search
 * engines treat them as translations rather than duplicates.
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.INGREFIT_PUBLIC_URL ?? 'https://ingrefit.com').replace(/\/$/, '');
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin'] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}

export const dynamic = 'force-static';
export const revalidate = 86_400;
