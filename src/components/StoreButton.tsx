import { TrackedLink } from './TrackedLink';

export function StoreButton({ store, href, label, locale, compact = false }: { store: 'apple' | 'google'; href: string; label: string; locale: string; compact?: boolean }) {
  return (
    <TrackedLink className={`store-badge${compact ? ' store-badge-compact' : ''}`} eventName={store === 'apple' ? 'download_ios_click' : 'download_android_click'} eventParams={{ locale }} href={href} rel="noreferrer" target="_blank">
      {store === 'apple' ? <AppleMark /> : <GooglePlayMark />}
      <span>{label}</span>
    </TrackedLink>
  );
}

function AppleMark() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M17.1 12.7c0-2.5 2-3.7 2.1-3.8a4.6 4.6 0 0 0-3.6-2c-1.5-.2-3 .9-3.8.9-.8 0-2-1-3.3-.9a4.9 4.9 0 0 0-4.1 2.5c-1.8 3-.5 7.5 1.2 10 .9 1.2 1.8 2.5 3.1 2.4 1.3-.1 1.8-.8 3.3-.8 1.5 0 2 .8 3.3.8 1.4 0 2.3-1.2 3.1-2.4a10.7 10.7 0 0 0 1.4-2.8 4.3 4.3 0 0 1-2.7-3.9ZM14.6 5.3a4.3 4.3 0 0 0 1-3.1 4.4 4.4 0 0 0-2.9 1.5 4.1 4.1 0 0 0-1.1 3c1.1.1 2.2-.5 3-1.4Z" /></svg>;
}

function GooglePlayMark() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path fill="#34A853" d="M3.5 2.6 14 12 3.5 21.4c-.3-.4-.5-.9-.5-1.5V4.1c0-.6.2-1.1.5-1.5Z" /><path fill="#4285F4" d="m14 12 3.1-2.8-10.8-6c-.8-.4-1.6-.7-2.3-.6L14 12Z" /><path fill="#FBBC04" d="m14 12-10 9.4c.7.1 1.5-.2 2.3-.6l10.8-6L14 12Z" /><path fill="#EA4335" d="M21 11.3 17.1 9.2 14 12l3.1 2.8 3.9-2.1c1.1-.6 1.1-1.4 0-1.4Z" /></svg>;
}
