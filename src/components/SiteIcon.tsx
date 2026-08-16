import type { SVGProps } from 'react';

export type SiteIconName = 'barcode' | 'camera' | 'target' | 'history' | 'language' | 'infinity' | 'shield' | 'food' | 'sun' | 'moon' | 'system';

export function SiteIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: SiteIconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.8 };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...props}>
      {name === 'barcode' ? <><path {...common} d="M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12" /><path {...common} d="M2.5 4v4M2.5 4h4M21.5 4v4M21.5 4h-4M2.5 20v-4M2.5 20h4M21.5 20v-4M21.5 20h-4" /></> : null}
      {name === 'camera' ? <><rect {...common} height="14" rx="3" width="20" x="2" y="6" /><path {...common} d="M8 6l1.5-2h5L16 6" /><circle {...common} cx="12" cy="13" r="4" /></> : null}
      {name === 'target' ? <><circle {...common} cx="12" cy="12" r="8" /><circle {...common} cx="12" cy="12" r="3.5" /><path {...common} d="M12 2v2M12 20v2M2 12h2M20 12h2" /></> : null}
      {name === 'history' ? <><path {...common} d="M4.5 7H1.8V4.3" /><path {...common} d="M3 7a9 9 0 1 1 .6 10.8" /><path {...common} d="M12 7v5l3 2" /></> : null}
      {name === 'language' ? <><path {...common} d="M4 5h9M8.5 3v2M6 5c.5 4 3 7 7 8M12 5c-.5 4-3 7-7 8" /><path {...common} d="M13 20l3.5-9 3.5 9M14.3 17h4.4" /></> : null}
      {name === 'infinity' ? <path {...common} d="M7.2 8.2c-2.2 0-4 1.7-4 3.8s1.8 3.8 4 3.8c4.1 0 5.5-7.6 9.6-7.6 2.2 0 4 1.7 4 3.8s-1.8 3.8-4 3.8C12.7 15.8 11.3 8.2 7.2 8.2Z" /> : null}
      {name === 'shield' ? <><path {...common} d="M12 3l8 3v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" /><path {...common} d="m8.5 12 2.2 2.2 4.8-5" /></> : null}
      {name === 'food' ? <><path {...common} d="M5 12h14c0 5-2.6 8-7 8s-7-3-7-8Z" /><path {...common} d="M3 12h18M8 9c0-2 1-3 1-5M12 9c0-2 1-3 1-5M16 9c0-2 1-3 1-5" /></> : null}
      {name === 'sun' ? <><circle {...common} cx="12" cy="12" r="3.5" /><path {...common} d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></> : null}
      {name === 'moon' ? <path {...common} d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" /> : null}
      {name === 'system' ? <><rect {...common} height="13" rx="2" width="20" x="2" y="4" /><path {...common} d="M8 21h8M12 17v4" /></> : null}
    </svg>
  );
}
