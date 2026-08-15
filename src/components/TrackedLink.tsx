'use client';

import type { AnchorHTMLAttributes, PropsWithChildren } from 'react';

declare global {
  interface Window {
    gtag?: (command: string, eventName: string, params?: Record<string, string>) => void;
  }
}

export function TrackedLink({ eventName, eventParams, children, onClick, ...props }: PropsWithChildren<AnchorHTMLAttributes<HTMLAnchorElement> & { eventName: string; eventParams?: Record<string, string> }>) {
  return <a {...props} onClick={(event) => { window.gtag?.('event', eventName, eventParams); onClick?.(event); }}>{children}</a>;
}

