import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { TrackedLink } from '@/components/TrackedLink';
import { SiteIcon, type SiteIconName } from '@/components/SiteIcon';
import { StoreButton } from '@/components/StoreButton';

const APP_STORE_URL = 'https://apps.apple.com/app/id6801561360';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=store.evsi.ingrefit';

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Landing locale={locale} />;
}

function Landing({ locale }: { locale: string }) {
  const hero = useTranslations('hero');
  const demo = useTranslations('demo');
  const how = useTranslations('how');
  const principle = useTranslations('principle');
  const personal = useTranslations('personal');
  const features = useTranslations('features');
  const pricing = useTranslations('pricing');
  const cta = useTranslations('cta');

  return (
    <>
      <SiteHeader locale={locale} />
      <main>
        <section className="hero-section">
          <div className="hero-orb hero-orb-one" />
          <div className="hero-orb hero-orb-two" />
          <div className="container hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">{hero('eyebrow')}</p>
              <h1>{hero('title')} <em>{hero('accent')}</em></h1>
              <p className="hero-subtitle">{hero('subtitle')}</p>
              <div className="hero-store-row">
                <StoreButton compact href={APP_STORE_URL} label={cta('ios')} locale={locale} store="apple" />
                <StoreButton compact href={PLAY_STORE_URL} label={cta('android')} locale={locale} store="google" />
              </div>
              <div className="hero-actions hero-actions-secondary">
                <TrackedLink className="text-link" eventName="hero_how_click" eventParams={{ locale }} href="#how">{hero('secondary')} <span>↓</span></TrackedLink>
              </div>
              <div className="proof-row">
                <span><SiteIcon name="barcode" />{hero('proof1')}</span>
                <span><SiteIcon name="target" />{hero('proof2')}</span>
                <span><SiteIcon name="shield" />{hero('proof3')}</span>
              </div>
            </div>
            <div className="phone-stage" aria-label="Example IngreFit result">
              <div className="leaf leaf-one">✦</div>
              <div className="leaf leaf-two">✓</div>
              <div className="phone">
                <div className="phone-top"><span>9:41</span><span>● ◒</span></div>
                <div className="phone-brand"><img alt="" className="logo-image logo-image-small" height="26" src="/brand/icon.png" width="26" /><strong>IngreFit</strong></div>
                <div className="found-pill"><span>✓</span>{demo('scanning')}</div>
                <div className="product-mini">
                  <div className="product-art"><SiteIcon name="food" /></div>
                  <div><strong>{demo('product')}</strong><small>{demo('brand')}</small></div>
                </div>
                <div className="score-panel">
                  <div className="score-ring"><strong>8.6</strong><small>/10</small></div>
                  <div><small>{demo('scoreLabel')}</small><strong>{demo('verdict')}</strong></div>
                </div>
                <div className="signal-row"><b>+</b><span>{demo('signal1')}</span><em>+1.5</em></div>
                <div className="signal-row"><b>+</b><span>{demo('signal2')}</span><em>+0.5</em></div>
                <div className="signal-row signal-warn"><b>!</b><span>{demo('signal3')}</span><em>!</em></div>
                <p className="source-line">◉ {demo('source')}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="how">
          <div className="container">
            <div className="section-heading centered">
              <p className="eyebrow">{how('eyebrow')}</p>
              <h2>{how('title')}</h2>
              <p>{how('subtitle')}</p>
            </div>
            <div className="steps-grid">
              <Step number="01" icon="barcode" title={how('step1Title')} body={how('step1Body')} />
              <Step number="02" icon="camera" title={how('step2Title')} body={how('step2Body')} />
              <Step number="03" icon="target" title={how('step3Title')} body={how('step3Body')} />
            </div>
          </div>
        </section>

        <section className="section principle-section" id="principle">
          <div className="container principle-grid">
            <div className="principle-copy">
              <p className="eyebrow eyebrow-light">{principle('eyebrow')}</p>
              <h2>{principle('title')}</h2>
              <p>{principle('body')}</p>
            </div>
            <div className="fact-stack">
              <Fact icon="01" title={principle('fact1Title')} body={principle('fact1Body')} />
              <Fact icon="02" title={principle('fact2Title')} body={principle('fact2Body')} />
              <Fact icon="03" title={principle('fact3Title')} body={principle('fact3Body')} />
            </div>
          </div>
        </section>

        <section className="section personal-section">
          <div className="container personal-grid">
            <div className="personal-visual">
              <div className="product-circle"><SiteIcon name="food" /></div>
              <div className="score-chip chip-one"><span>{personal('goal1')}</span><strong>4.1</strong></div>
              <div className="score-chip chip-two"><span>{personal('goal2')}</span><strong>8.4</strong></div>
              <div className="score-chip chip-three"><span>{personal('goal3')}</span><strong>2.0</strong></div>
              <div className="score-chip chip-four"><span>{personal('goal4')}</span><strong>6.2</strong></div>
            </div>
            <div className="section-heading">
              <p className="eyebrow">{personal('eyebrow')}</p>
              <h2>{personal('title')}</h2>
              <p>{personal('body')}</p>
            </div>
          </div>
        </section>

        <section className="section features-section">
          <div className="container">
            <div className="section-heading centered"><h2>{features('title')}</h2></div>
            <div className="features-grid">
              <Feature icon="barcode" title={features('f1Title')} body={features('f1Body')} />
              <Feature icon="camera" title={features('f2Title')} body={features('f2Body')} />
              <Feature icon="target" title={features('f3Title')} body={features('f3Body')} />
              <Feature icon="history" title={features('f4Title')} body={features('f4Body')} />
              <Feature icon="language" title={features('f5Title')} body={features('f5Body')} />
              <Feature icon="infinity" title={features('f6Title')} body={features('f6Body')} />
            </div>
          </div>
        </section>

        <section className="section pricing-section" id="pricing">
          <div className="container">
            <div className="section-heading centered">
              <p className="eyebrow">{pricing('eyebrow')}</p>
              <h2>{pricing('title')}</h2>
            </div>
            <div className="pricing-grid">
              <PriceCard locale={locale} title={pricing('free')} count="∞" perDay={pricing('perDay')} features={[pricing('freeFeature1'), pricing('freeFeature2'), pricing('freeFeature3')]} cta={pricing('freeCta')} />
              <PriceCard locale={locale} premium title={pricing('premium')} count="AI" perDay={pricing('premiumLabel')} features={[pricing('premiumFeature1'), pricing('premiumFeature2'), pricing('premiumFeature3')]} cta={pricing('premiumCta')} />
            </div>
            <p className="pricing-note">{pricing('note')}</p>
          </div>
        </section>

        <section className="download-section" id="download">
          <div className="container download-card">
            <div><h2>{cta('title')}</h2><p>{cta('body')}</p></div>
            <div className="download-action">
              <StoreButton href={APP_STORE_URL} label={cta('ios')} locale={locale} store="apple" />
              <StoreButton href={PLAY_STORE_URL} label={cta('android')} locale={locale} store="google" />
              <small>{cta('privacy')}</small>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function Step({ number, icon, title, body }: { number: string; icon: SiteIconName; title: string; body: string }) {
  return <article className="step-card"><span className="step-number">{number}</span><div className="feature-icon"><SiteIcon name={icon} /></div><h3>{title}</h3><p>{body}</p></article>;
}

function Fact({ icon, title, body }: { icon: string; title: string; body: string }) {
  return <article className="fact-card"><span>{icon}</span><div><h3>{title}</h3><p>{body}</p></div></article>;
}

function Feature({ icon, title, body }: { icon: SiteIconName; title: string; body: string }) {
  return <article className="feature-card"><div className="feature-icon"><SiteIcon name={icon} /></div><h3>{title}</h3><p>{body}</p></article>;
}

function PriceCard({ title, count, perDay, features: items, cta, locale, premium = false }: { title: string; count: string; perDay: string; features: string[]; cta: string; locale: string; premium?: boolean }) {
  return (
    <article className={`price-card${premium ? ' price-card-premium' : ''}`}>
      {premium ? <span className="premium-spark">✦</span> : null}
      <h3>{title}</h3><strong className="price-count">{count}</strong><p className="per-day">{perDay}</p>
      <ul>{items.map((item) => <li key={item}><span>✓</span>{item}</li>)}</ul>
      <TrackedLink className={`button${premium ? ' button-lime' : ' button-outline'}`} eventName="pricing_cta_click" eventParams={{ locale, plan: premium ? 'premium' : 'free' }} href="#download">{cta}</TrackedLink>
    </article>
  );
}
