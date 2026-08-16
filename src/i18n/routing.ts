import { defineRouting } from 'next-intl/routing';
import { LOCALE_CODES } from './locales';

export const routing = defineRouting({
  locales: LOCALE_CODES,
  defaultLocale: 'en',
  localePrefix: 'always',
});
