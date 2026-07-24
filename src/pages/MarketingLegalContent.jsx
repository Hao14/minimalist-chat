import { createElement } from 'react';
import { Link } from 'react-router-dom';
import { termsPageMeta, termsSections } from '../content/marketingContent.js';
import { privacyPageContent } from '../content/publicMarketingContent.js';

function LegalDocumentPage({
  shellComponent,
  ctaArrowIcon,
  title,
  description,
  sections,
  lastUpdated = 'June 2026',
  updatedAt = '2026-06-01',
  intro = 'Clear, plain-language details for using Minimalist with confidence.',
  summaryItems = [],
  variant = 'default',
}) {
  const isTerms = variant === 'terms';

  return createElement(
    shellComponent,
    {
      title: `Minimalist | ${title}`,
      shape: null,
      description,
    },
    (
      <main className={`marketing-v4 legal-v4${isTerms ? ' terms-v5' : ''}`} id="top">
        <section className="mkt4-hero mkt4-legal-hero">
          <div className="mkt4-hero-copy"><h1>{title}</h1><p>{intro}</p></div>
          <div className="mkt4-legal-meta">
            <span>LAST UPDATED</span>
            <strong><time dateTime={updatedAt}>{lastUpdated}</time></strong>
            {summaryItems.length ? (
              <ul className="terms-v5-summary" aria-label="Terms at a glance">
                {summaryItems.map((item) => <li key={item.label}><i className={`ph-bold ${item.icon}`} aria-hidden="true" /><span><strong>{item.label}</strong><small>{item.copy}</small></span></li>)}
              </ul>
            ) : null}
            <button type="button" className="mkt4-button" onClick={() => window.print()}><i className="ph-bold ph-file-text" aria-hidden="true" /> Print</button>
          </div>
        </section>
        <div className="mkt4-legal-layout">
          <aside className="mkt4-legal-nav" aria-label={`${title} contents`}>
            <span>ON THIS PAGE</span>
            {sections.map((section) => <a href={`#${section.id}`} key={section.id}>{section.title.replace(/^\d+\.\s*/, '')}</a>)}
            <a href="#top">Back to top</a>
          </aside>
          <article className="mkt4-legal-document">
            {sections.map((section, index) => (
              <section className="mkt4-legal-section" id={section.id} key={section.id}>
                {isTerms ? <header className="terms-v5-section-heading"><span>{String(index + 1).padStart(2, '0')}</span><h2>{section.title}</h2></header> : <h2>{section.title}</h2>}
                {section.copy ? <p>{section.copy}</p> : null}
                {section.items ? <ul>{section.items.map((item, index) => <li key={`${section.id}-${index}`}>{item}</li>)}</ul> : null}
              </section>
            ))}
          </article>
        </div>
        {isTerms ? (
          <section className="terms-v5-contact" aria-labelledby="terms-contact-title">
            <div><h2 id="terms-contact-title">Something unclear?</h2><p>Ask about billing, account deletion, safety, or how a term applies before you rely on it.</p></div>
            <div className="mkt4-actions"><a href="mailto:support@minimalist.com" className="mkt4-button is-primary">Email support {createElement(ctaArrowIcon)}</a><Link to="/privacy" className="mkt4-button">Read the Privacy Policy</Link></div>
          </section>
        ) : null}
      </main>
    ),
  );
}

function PrivacyPage({ shellComponent, ctaArrowIcon }) {
  const { meta, sections } = privacyPageContent;
  return createElement(
    shellComponent,
    {
      title: meta.title,
      shape: null,
      description: meta.description,
    },
    (
      <main className="marketing-v5 privacy-v5" id="top">
        <section className="privacy-v5-hero mv5-hero" data-marketing-reveal>
          <div>
            <h1>Privacy Policy</h1>
            <p>What Minimalist collects, why it is needed, who helps process it, and the choices you have.</p>
            <time className="privacy-v5-updated" dateTime={meta.updatedAt}>Last updated {meta.lastUpdated}</time>
          </div>
          <div className="privacy-v5-hero-actions">
            <button type="button" className="mkt4-button" onClick={() => window.print()}><i className="ph-bold ph-printer" aria-hidden="true" /> Print</button>
            <a href="mailto:support@minimalist.com?subject=Minimalist%20privacy%20question" className="mkt4-button"><i className="ph-bold ph-envelope" aria-hidden="true" /> Email support</a>
          </div>
        </section>

        <section className="privacy-v5-summary" aria-label="Privacy at a glance" data-marketing-reveal>
          <article><i className="ph-bold ph-chat-circle-text" aria-hidden="true" /><h2>Your content</h2><p>Rooms, messages, files, and collaboration data are processed to provide the surfaces you choose.</p></article>
          <article><i className="ph-bold ph-cloud-check" aria-hidden="true" /><h2>Service providers</h2><p>Firebase, Stripe, Calendar, notification, issue-reporting, and configured AI services support specific functions.</p></article>
          <article><i className="ph-bold ph-sliders-horizontal" aria-hidden="true" /><h2>Your controls</h2><p>Edit available profile fields, manage permissions, disconnect integrations, cancel billing, or request deletion.</p></article>
        </section>

        <div className="privacy-v5-layout">
          <nav className="privacy-v5-nav" aria-label="Privacy Policy contents">
            <span>CONTENTS</span>
            {sections.map((section, index) => <a href={`#${section.id}`} key={section.id}>{String(index + 1).padStart(2, '0')} · {section.title}</a>)}
            <a href="#top">Back to top</a>
          </nav>

          <article className="privacy-v5-document">
            {sections.map((section, index) => (
              <section className="privacy-v5-section" id={section.id} data-marketing-reveal key={section.id}>
                <header><span>{String(index + 1).padStart(2, '0')}</span><h2>{section.title}</h2></header>
                <p>{section.copy}</p>
                {section.items.length ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}
              </section>
            ))}
          </article>
        </div>

        <section className="privacy-v5-contact" data-marketing-reveal>
          <div><h2>Need to make a privacy request?</h2><p>Use the support channel shown here. Do not post account details, room content, or other personal information in a public issue.</p></div>
          <div className="mkt4-actions"><a href="mailto:support@minimalist.com?subject=Minimalist%20privacy%20request" className="mkt4-button is-primary">Email support {createElement(ctaArrowIcon)}</a><Link to="/faq" className="mkt4-button">Read the FAQ</Link></div>
        </section>
      </main>
    ),
  );
}

export default function MarketingLegalContent({ page, shellComponent, ctaArrowIcon }) {
  if (page === 'privacy') {
    return <PrivacyPage shellComponent={shellComponent} ctaArrowIcon={ctaArrowIcon} />;
  }
  return (
    <LegalDocumentPage
      shellComponent={shellComponent}
      ctaArrowIcon={ctaArrowIcon}
      title="Terms of Service"
      description={termsPageMeta.description}
      sections={termsSections}
      lastUpdated={termsPageMeta.lastUpdated}
      updatedAt={termsPageMeta.updatedAt}
      intro="Current terms for accounts, rooms, content, AI, recurring subscriptions, cancellation, and safe use—written to be read, not decoded."
      summaryItems={[
        { icon: 'ph-file-text', label: 'Your content stays yours', copy: 'A narrow service license lets Minimalist operate the features you choose.' },
        { icon: 'ph-currency-circle-dollar', label: 'Subscriptions stay separate', copy: 'Account and room plans renew monthly and must be cancelled independently.' },
        { icon: 'ph-sparkle', label: 'AI needs human review', copy: 'Output can be wrong, and important decisions remain yours.' },
      ]}
      variant="terms"
    />
  );
}
