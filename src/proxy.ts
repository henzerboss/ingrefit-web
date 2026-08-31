import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // `admin` joins the exclusions: it is not a localized surface and must not
  // be redirected to /en/admin by the locale middleware.
  matcher: ['/((?!api|admin|_next|_vercel|.*\\..*).*)'],
};
