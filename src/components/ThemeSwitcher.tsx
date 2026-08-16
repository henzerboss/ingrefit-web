'use client';

import { useEffect, useState } from 'react';

import { SiteIcon } from './SiteIcon';

type Mode = 'system' | 'light' | 'dark';

export function ThemeSwitcher({ labels }: { labels: Record<Mode, string> }) {
  const [mode, setMode] = useState<Mode>('system');
  useEffect(() => {
    const stored = window.localStorage.getItem('ingrefit-theme');
    if (stored === 'light' || stored === 'dark') setMode(stored);
  }, []);
  const choose = (next: Mode) => {
    setMode(next);
    if (next === 'system') {
      window.localStorage.removeItem('ingrefit-theme');
      delete document.documentElement.dataset.theme;
    } else {
      window.localStorage.setItem('ingrefit-theme', next);
      document.documentElement.dataset.theme = next;
    }
  };
  return (
    <div aria-label="Theme" className="theme-switcher" role="group">
      {(['system', 'light', 'dark'] as const).map((value) => (
        <button aria-label={labels[value]} aria-pressed={mode === value} key={value} onClick={() => choose(value)} title={labels[value]} type="button">
          <SiteIcon name={value === 'light' ? 'sun' : value === 'dark' ? 'moon' : 'system'} />
        </button>
      ))}
    </div>
  );
}
