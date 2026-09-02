import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Response headers.
 *
 * The API is consumed by a mobile app, not a browser, so the interesting
 * surface is the marketing site and the admin. Content-Security-Policy is
 * deliberately absent: this app has no inline-script inventory yet, and a CSP
 * that has to be relaxed to `unsafe-inline` to work is a header that says more
 * than it does.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Two years, matching the preload list's requirement should you ever submit.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The admin is one operator's tool and has no business in an index.
      { source: '/admin/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};

export default withNextIntl(nextConfig);
