'use client';

import { useRef, useState } from 'react';

import { AppFrame, type DemoCopy, ResultPreview } from './AppPreview';
import { SiteIcon } from './SiteIcon';

interface GalleryCopy {
  next: string;
  previous: string;
  screenAlt: string;
}

interface HowCopy {
  step1Body: string;
  step1Title: string;
  step2Body: string;
  step2Title: string;
  step3Body: string;
  step3Title: string;
}

export function ScreenshotGallery({ demo, gallery, how }: { demo: DemoCopy; gallery: GalleryCopy; how: HowCopy }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const total = 4;

  const move = (direction: number) => {
    const next = Math.min(total - 1, Math.max(0, active + direction));
    setActive(next);
    railRef.current?.children[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  const syncActive = () => {
    const rail = railRef.current;
    if (!rail) return;
    const railBox = rail.getBoundingClientRect();
    const center = railBox.left + railBox.width / 2;
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    [...rail.children].forEach((element, index) => {
      const item = element as HTMLElement;
      const itemBox = item.getBoundingClientRect();
      const itemCenter = itemBox.left + itemBox.width / 2;
      const nextDistance = Math.abs(center - itemCenter);
      if (nextDistance < distance) {
        closest = index;
        distance = nextDistance;
      }
    });
    setActive(closest);
  };

  return (
    <div className="gallery-shell">
      <button aria-label={gallery.previous} className="gallery-arrow gallery-arrow-prev" disabled={active === 0} onClick={() => move(-1)} type="button">‹</button>
      <div className="gallery-rail" onScroll={syncActive} ref={railRef}>
        <GalleryCard alt={`${gallery.screenAlt} 1`} index={1}><ChoiceScreen how={how} /></GalleryCard>
        <GalleryCard alt={`${gallery.screenAlt} 2`} index={2}><ScannerScreen demo={demo} how={how} /></GalleryCard>
        <GalleryCard alt={`${gallery.screenAlt} 3`} index={3}><ResultPreview compact copy={demo} /></GalleryCard>
        <GalleryCard alt={`${gallery.screenAlt} 4`} index={4}><SignalsScreen demo={demo} how={how} /></GalleryCard>
      </div>
      <button aria-label={gallery.next} className="gallery-arrow gallery-arrow-next" disabled={active === total - 1} onClick={() => move(1)} type="button">›</button>
      <div className="gallery-dots" role="tablist">
        {Array.from({ length: total }, (_, index) => (
          <button aria-label={`${gallery.screenAlt} ${index + 1}`} aria-selected={active === index} key={index} onClick={() => {
            setActive(index);
            railRef.current?.children[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }} role="tab" type="button" />
        ))}
      </div>
    </div>
  );
}

function GalleryCard({ alt, children, index }: { alt: string; children: React.ReactNode; index: number }) {
  return <article aria-label={alt} className="gallery-card"><span className="gallery-index">0{index}</span>{children}</article>;
}

function GalleryBrand() {
  return <div className="gallery-app-brand"><span><img alt="" src="/brand/icon.png" /><b>IngreFit</b></span><SiteIcon name="target" /></div>;
}

function ChoiceScreen({ how }: { how: HowCopy }) {
  return (
    <AppFrame compact>
      <GalleryBrand />
      <div className="gallery-screen-title">{how.step1Title}</div>
      <div className="gallery-choice-list">
        <Choice icon="barcode" title={how.step1Title} body={how.step1Body} />
        <Choice icon="camera" title={how.step2Title} body={how.step2Body} />
        <Choice icon="target" title={how.step3Title} body={how.step3Body} />
      </div>
      <GalleryBottom active="scan" />
    </AppFrame>
  );
}

function Choice({ body, icon, title }: { body: string; icon: 'barcode' | 'camera' | 'target'; title: string }) {
  return <div className="gallery-choice"><span><SiteIcon name={icon} /></span><div><b>{title}</b><p>{body}</p></div><i>›</i></div>;
}

function ScannerScreen({ demo, how }: { demo: DemoCopy; how: HowCopy }) {
  return (
    <AppFrame compact>
      <div className="gallery-scanner">
        <img alt="" src="/products/barcode.webp" />
        <div className="gallery-scanner-shade" />
        <div className="gallery-scanner-title"><span>‹</span><b>{how.step1Title}</b></div>
        <div className="gallery-scan-frame"><i /><i /><i /><i /><span /></div>
        <div className="gallery-found-product"><img alt="" src="/products/cereal.webp" /><div><small>{demo.scanning}</small><b>{demo.product}</b></div><span>✓</span></div>
      </div>
    </AppFrame>
  );
}

function SignalsScreen({ demo, how }: { demo: DemoCopy; how: HowCopy }) {
  return (
    <AppFrame compact>
      <div className="preview-app-header"><span className="preview-back">‹</span><strong>{how.step3Title}</strong></div>
      <div className="gallery-mini-result"><img alt="" src="/products/cereal.webp" /><div><small>{demo.scoreLabel}</small><b>{demo.product}</b><strong>{demo.verdict}</strong></div><span>8.6</span></div>
      <h3 className="gallery-signal-heading">{demo.verdict}</h3>
      <div className="gallery-detail-signals">
        <DetailSignal body={how.step3Body} label={demo.signal1} value="+0.8" />
        <DetailSignal body={demo.source} label={demo.signal2} value="+0.4" />
        <DetailSignal body={how.step2Body} label={demo.signal3} value="-0.3" warning />
      </div>
      <GalleryBottom active="history" />
    </AppFrame>
  );
}

function DetailSignal({ body, label, value, warning = false }: { body: string; label: string; value: string; warning?: boolean }) {
  return <div className={`gallery-detail-signal${warning ? ' warning' : ''}`}><span>{warning ? '!' : '✓'}</span><div><b>{label}</b><p>{body}</p></div><strong>{value}</strong></div>;
}

function GalleryBottom({ active }: { active: 'history' | 'scan' }) {
  return <div className="gallery-bottom"><SiteIcon name="target" /><span className={active === 'history' ? 'active' : ''}><SiteIcon name="history" /></span><span className={active === 'scan' ? 'active' : ''}><SiteIcon name="barcode" /></span></div>;
}
