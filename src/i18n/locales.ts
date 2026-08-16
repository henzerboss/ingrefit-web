export const LOCALE_CODES = [
  'en', 'ru', 'es', 'it', 'pt', 'fr', 'de', 'zh', 'ja', 'tr', 'ko', 'pl', 'uk', 'nl', 'cs',
  'sr', 'hr', 'da', 'fi', 'sk', 'no', 'is', 'az', 'sq', 'am', 'hy', 'af', 'eu', 'bn', 'my',
  'bg', 'hu', 'vi', 'gl', 'el', 'ka', 'gu', 'zu', 'id', 'kk', 'kn', 'ca', 'ky', 'km', 'lo',
  'lv', 'lt', 'mk', 'ms', 'ml', 'mr', 'mn', 'ne', 'pa', 'rm', 'ro', 'si', 'sl', 'sw', 'th',
  'ta', 'te', 'fil', 'hi', 'sv', 'et', 'ar', 'he',
] as const;

export type LocaleCode = (typeof LOCALE_CODES)[number];

export interface SupportedLocale {
  id: LocaleCode;
  flag: string;
  name: string;
  direction: 'ltr' | 'rtl';
}

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = [
  { id: 'en', flag: '🇺🇸', name: 'English', direction: 'ltr' },
  { id: 'ru', flag: '🇷🇺', name: 'Русский', direction: 'ltr' },
  { id: 'es', flag: '🇪🇸', name: 'Español', direction: 'ltr' },
  { id: 'it', flag: '🇮🇹', name: 'Italiano', direction: 'ltr' },
  { id: 'pt', flag: '🇵🇹', name: 'Português', direction: 'ltr' },
  { id: 'fr', flag: '🇫🇷', name: 'Français', direction: 'ltr' },
  { id: 'de', flag: '🇩🇪', name: 'Deutsch', direction: 'ltr' },
  { id: 'zh', flag: '🇨🇳', name: '中文', direction: 'ltr' },
  { id: 'ja', flag: '🇯🇵', name: '日本語', direction: 'ltr' },
  { id: 'tr', flag: '🇹🇷', name: 'Türkçe', direction: 'ltr' },
  { id: 'ko', flag: '🇰🇷', name: '한국어', direction: 'ltr' },
  { id: 'pl', flag: '🇵🇱', name: 'Polski', direction: 'ltr' },
  { id: 'uk', flag: '🇺🇦', name: 'Українська', direction: 'ltr' },
  { id: 'nl', flag: '🇳🇱', name: 'Nederlands', direction: 'ltr' },
  { id: 'cs', flag: '🇨🇿', name: 'Čeština', direction: 'ltr' },
  { id: 'sr', flag: '🇷🇸', name: 'Српски', direction: 'ltr' },
  { id: 'hr', flag: '🇭🇷', name: 'Hrvatski', direction: 'ltr' },
  { id: 'da', flag: '🇩🇰', name: 'Dansk', direction: 'ltr' },
  { id: 'fi', flag: '🇫🇮', name: 'Suomi', direction: 'ltr' },
  { id: 'sk', flag: '🇸🇰', name: 'Slovenčina', direction: 'ltr' },
  { id: 'no', flag: '🇳🇴', name: 'Norsk', direction: 'ltr' },
  { id: 'is', flag: '🇮🇸', name: 'Íslenska', direction: 'ltr' },
  { id: 'az', flag: '🇦🇿', name: 'Azərbaycan dili', direction: 'ltr' },
  { id: 'sq', flag: '🇦🇱', name: 'Shqip', direction: 'ltr' },
  { id: 'am', flag: '🇪🇹', name: 'አማርኛ', direction: 'ltr' },
  { id: 'hy', flag: '🇦🇲', name: 'Հայերեն', direction: 'ltr' },
  { id: 'af', flag: '🇿🇦', name: 'Afrikaans', direction: 'ltr' },
  { id: 'eu', flag: '🇪🇸', name: 'Euskara', direction: 'ltr' },
  { id: 'bn', flag: '🇧🇩', name: 'বাংলা', direction: 'ltr' },
  { id: 'my', flag: '🇲🇲', name: 'မြန်မာ', direction: 'ltr' },
  { id: 'bg', flag: '🇧🇬', name: 'Български', direction: 'ltr' },
  { id: 'hu', flag: '🇭🇺', name: 'Magyar', direction: 'ltr' },
  { id: 'vi', flag: '🇻🇳', name: 'Tiếng Việt', direction: 'ltr' },
  { id: 'gl', flag: '🇪🇸', name: 'Galego', direction: 'ltr' },
  { id: 'el', flag: '🇬🇷', name: 'Ελληνικά', direction: 'ltr' },
  { id: 'ka', flag: '🇬🇪', name: 'ქართული', direction: 'ltr' },
  { id: 'gu', flag: '🇮🇳', name: 'ગુજરાતી', direction: 'ltr' },
  { id: 'zu', flag: '🇿🇦', name: 'isiZulu', direction: 'ltr' },
  { id: 'id', flag: '🇮🇩', name: 'Bahasa Indonesia', direction: 'ltr' },
  { id: 'kk', flag: '🇰🇿', name: 'Қазақша', direction: 'ltr' },
  { id: 'kn', flag: '🇮🇳', name: 'ಕನ್ನಡ', direction: 'ltr' },
  { id: 'ca', flag: '🇪🇸', name: 'Català', direction: 'ltr' },
  { id: 'ky', flag: '🇰🇬', name: 'Кыргызча', direction: 'ltr' },
  { id: 'km', flag: '🇰🇭', name: 'ភាសាខ្មែរ', direction: 'ltr' },
  { id: 'lo', flag: '🇱🇦', name: 'ລາວ', direction: 'ltr' },
  { id: 'lv', flag: '🇱🇻', name: 'Latviešu', direction: 'ltr' },
  { id: 'lt', flag: '🇱🇹', name: 'Lietuvių', direction: 'ltr' },
  { id: 'mk', flag: '🇲🇰', name: 'Македонски', direction: 'ltr' },
  { id: 'ms', flag: '🇲🇾', name: 'Bahasa Melayu', direction: 'ltr' },
  { id: 'ml', flag: '🇮🇳', name: 'മലയാളം', direction: 'ltr' },
  { id: 'mr', flag: '🇮🇳', name: 'मराठी', direction: 'ltr' },
  { id: 'mn', flag: '🇲🇳', name: 'Монгол', direction: 'ltr' },
  { id: 'ne', flag: '🇳🇵', name: 'नेपाली', direction: 'ltr' },
  { id: 'pa', flag: '🇮🇳', name: 'ਪੰਜਾਬੀ', direction: 'ltr' },
  { id: 'rm', flag: '🇨🇭', name: 'Rumantsch', direction: 'ltr' },
  { id: 'ro', flag: '🇷🇴', name: 'Română', direction: 'ltr' },
  { id: 'si', flag: '🇱🇰', name: 'සිංහල', direction: 'ltr' },
  { id: 'sl', flag: '🇸🇮', name: 'Slovenščina', direction: 'ltr' },
  { id: 'sw', flag: '🇰🇪', name: 'Kiswahili', direction: 'ltr' },
  { id: 'th', flag: '🇹🇭', name: 'ไทย', direction: 'ltr' },
  { id: 'ta', flag: '🇮🇳', name: 'தமிழ்', direction: 'ltr' },
  { id: 'te', flag: '🇮🇳', name: 'తెలుగు', direction: 'ltr' },
  { id: 'fil', flag: '🇵🇭', name: 'Filipino', direction: 'ltr' },
  { id: 'hi', flag: '🇮🇳', name: 'हिन्दी', direction: 'ltr' },
  { id: 'sv', flag: '🇸🇪', name: 'Svenska', direction: 'ltr' },
  { id: 'et', flag: '🇪🇪', name: 'Eesti', direction: 'ltr' },
  { id: 'ar', flag: '🇸🇦', name: 'العربية', direction: 'rtl' },
  { id: 'he', flag: '🇮🇱', name: 'עברית', direction: 'rtl' },
];

const localeSet = new Set<string>(LOCALE_CODES);

export function normalizeLocale(languageTag: string | null | undefined): LocaleCode {
  const code = (languageTag ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return localeSet.has(code) ? code as LocaleCode : 'en';
}

export function isRtlLocale(locale: string): boolean {
  return locale === 'ar' || locale === 'he';
}
