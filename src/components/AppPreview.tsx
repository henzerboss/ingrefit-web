import { SiteIcon } from './SiteIcon';

export interface DemoCopy {
  brand: string;
  product: string;
  scoreLabel: string;
  scanning: string;
  signal1: string;
  signal2: string;
  signal3: string;
  source: string;
  verdict: string;
}

interface ResultPreviewProps {
  copy: DemoCopy;
  compact?: boolean;
}

export function AppFrame({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`app-preview-frame${compact ? ' app-preview-frame-compact' : ''}`}>
      <div className="app-preview-status"><b>9:41</b><span aria-hidden="true">● ◒ ▰</span></div>
      <div className="app-preview-body">{children}</div>
      <div className="app-preview-home" />
    </div>
  );
}

export function ResultPreview({ copy, compact = false }: ResultPreviewProps) {
  return (
    <AppFrame compact={compact}>
      <div className="preview-app-header">
        <span className="preview-back" aria-hidden="true">‹</span>
        <strong>{copy.scanning}</strong>
      </div>
      <div className="preview-product-card">
        <img alt="" src="/products/cereal.webp" />
        <div><strong>{copy.product}</strong><small>{copy.brand}</small></div>
      </div>
      <div className="preview-score-card">
        <div className="preview-score-top">
          <div className="preview-score-ring"><strong>8.6</strong><small>/10</small></div>
          <div><small>{copy.scoreLabel}</small><strong>{copy.verdict}</strong></div>
        </div>
        <p className="preview-summary">{copy.source}</p>
        <div className="preview-signal-list">
          <PreviewSignal label={copy.signal1} value="+0.8" />
          <PreviewSignal label={copy.signal2} value="+0.4" />
          <PreviewSignal label={copy.signal3} value="-0.3" warning />
        </div>
      </div>
      <div className="preview-action-row"><span><SiteIcon name="barcode" /></span><span><SiteIcon name="history" /></span></div>
    </AppFrame>
  );
}

function PreviewSignal({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={`preview-signal${warning ? ' preview-signal-warning' : ''}`}>
      <span aria-hidden="true">{warning ? '!' : '✓'}</span><b>{label}</b><strong>{value}</strong>
    </div>
  );
}

