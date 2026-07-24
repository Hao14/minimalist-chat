import { createElement, useEffect, useMemo, useState } from 'react';
import { SUPPORTED_LOCALES, normalizeSearchText, setLocale } from '../lib/i18n.js';
import { useLocale } from '../lib/useLocale.js';

const SITE_ORIGIN = 'https://minimalist.chat';

function buildFaqStructuredData(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SITE_ORIGIN}/faq#faq`,
    url: `${SITE_ORIGIN}/faq`,
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

export default function MarketingFaqContent({ MarketingShell, CtaArrowIcon }) {
  const { locale, t, formatDate } = useLocale();
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('all');
  const [helpContent, setHelpContent] = useState(null);
  const [helpLoadError, setHelpLoadError] = useState(false);
  const [helpLoadAttempt, setHelpLoadAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    import('../content/helpContent.js').then((module) => {
      if (isCurrent) setHelpContent(module);
    }).catch(() => {
      if (!isCurrent) return;
      setHelpContent(null);
      setHelpLoadError(true);
    });
    return () => { isCurrent = false; };
  }, [helpLoadAttempt]);

  const localizedFaqs = useMemo(() => (
    helpContent?.getLocalizedHelpItems(locale) || []
  ), [helpContent, locale]);
  const normalizedQuery = normalizeSearchText(query.trim(), locale);
  const filteredFaqs = useMemo(() => {
    const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);
    return localizedFaqs.filter((item) => {
      const matchesTopic = topic === 'all' || item.topicKey === topic;
      const haystack = normalizeSearchText(`${item.topic} ${item.question} ${item.answer}`, locale);
      const matchesQuery = queryTerms.every((term) => haystack.includes(term));
      return matchesTopic && matchesQuery;
    });
  }, [locale, localizedFaqs, normalizedQuery, topic]);
  const structuredData = useMemo(() => buildFaqStructuredData(localizedFaqs), [localizedFaqs]);
  const updatedLabel = t('help.updated', {
    date: formatDate(new Date('2026-07-18T12:00:00Z'), { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  });

  const chooseQuickPath = (topicKey) => {
    setQuery('');
    setTopic(topicKey);
    window.requestAnimationFrame(() => document.getElementById('help-questions')?.scrollIntoView({ block: 'start' }));
  };

  return createElement(
    MarketingShell,
    {
      title: t('help.metaTitle'),
      shape: null,
      description: t('help.metaDescription'),
      structuredData,
    },
    (
      <main className="marketing-v4 faq-v4 help-center">
        <section className="mkt4-hero mkt4-faq-hero faq-v5-hero help-center-hero">
          <div className="mkt4-hero-copy"><span className="help-center-kicker">Help Center</span><h1>{t('help.heroTitle')}</h1><p>{t('help.heroCopy')}</p></div>
          <div className="mkt4-faq-search-panel faq-v5-search help-center-search" role="search">
            <div className="help-center-language-row">
              <label htmlFor="help-language">{t('help.language')}</label>
              <select id="help-language" value={locale} onChange={(event) => setLocale(event.currentTarget.value)}>
                {SUPPORTED_LOCALES.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
              </select>
            </div>
            <label htmlFor="faq-search"><span>{t('help.searchLabel')}</span><i className="ph-bold ph-magnifying-glass" aria-hidden="true" /></label>
            <input id="faq-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('help.searchPlaceholder')} autoComplete="off" />
            <div className="faq-v5-search-meta">
              <p aria-live="polite">{t('help.results', { count: filteredFaqs.length, total: localizedFaqs.length })}</p>
              <span>{updatedLabel}</span>
            </div>
          </div>
        </section>

        <section className="mkt4-section help-center-quick" aria-labelledby="help-quick-title">
          <header className="help-center-quick-heading"><span>{t('help.quickPaths')}</span><h2 id="help-quick-title">{t('help.sectionTitle')}</h2></header>
          <div className="help-center-quick-rail">
            {(helpContent?.HELP_QUICK_PATHS || []).map((path, index) => (
              <button type="button" key={path.id} onClick={() => chooseQuickPath(path.topicKey)}>
                <span>{String(index + 1).padStart(2, '0')}</span><i className={`ph-bold ${path.icon}`} aria-hidden="true" /><strong>{t(path.labelKey)}</strong><i className="ph-bold ph-arrow-down" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>

        <section className="mkt4-section mkt4-faq-section help-center-questions" id="help-questions">
          <header className="mkt4-section-heading"><div><span>01</span><h2>{t('help.sectionTitle')}</h2></div><p>{t('help.sectionCopy')}</p></header>
          <div className="help-center-question-layout">
            <div className="mkt4-topic-rail help-center-topic-rail" role="group" aria-label={t('help.topics')}>
              <button type="button" aria-pressed={topic === 'all'} className={topic === 'all' ? 'is-active' : ''} onClick={() => setTopic('all')}>{t('help.allTopics')}</button>
              {(helpContent?.HELP_TOPIC_KEYS || []).map((topicKey) => <button type="button" aria-pressed={topic === topicKey} className={topic === topicKey ? 'is-active' : ''} onClick={() => setTopic(topicKey)} key={topicKey}>{helpContent.getHelpTopicLabel(topicKey, locale)}</button>)}
            </div>
            <div className="mkt4-faq-list">
              {!helpContent && !helpLoadError ? <div className="help-center-loading" role="status">{t('help.loading')}</div> : null}
              {helpLoadError ? (
                <div className="help-center-loading" role="alert">
                  <span>Answers could not load. Check your connection and try again.</span>
                  <button
                    type="button"
                    className="mkt4-button"
                    onClick={() => {
                      setHelpLoadError(false);
                      setHelpLoadAttempt((attempt) => attempt + 1);
                    }}
                  >
                    <i className="ph-bold ph-arrow-clockwise" aria-hidden="true" /> {t('chat.status.retry')}
                  </button>
                </div>
              ) : null}
              {filteredFaqs.map((item, index) => (
                <details className="mkt4-faq-row faq-v5-row" open={index === 0 && !normalizedQuery && topic === 'all'} key={item.id}>
                  <summary>
                    <span className="faq-v5-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="faq-v5-topic">{item.topic}</span>
                    <strong>{item.question}</strong>
                    <i className="ph-bold ph-plus" aria-hidden="true" />
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
              {helpContent && filteredFaqs.length === 0 ? <div className="mkt4-faq-empty"><i className="ph-bold ph-magnifying-glass" aria-hidden="true" /><h2>{t('help.noResultsTitle')}</h2><p>{t('help.noResultsCopy')}</p><button type="button" className="mkt4-button" onClick={() => { setQuery(''); setTopic('all'); }}>{t('help.clearFilters')}</button></div> : null}
            </div>
          </div>
        </section>

        <section className="mkt4-support-strip"><div><h2>{t('help.supportTitle')}</h2><p>{t('help.supportCopy')}</p></div><div className="mkt4-actions"><a href="mailto:support@minimalist.com" className="mkt4-button is-primary">{t('help.emailSupport')} {createElement(CtaArrowIcon)}</a><a href="https://github.com/Hao14/minimalist-chat/issues" target="_blank" rel="noopener noreferrer" className="mkt4-button">{t('help.reportBug')}</a></div></section>
      </main>
    ),
  );
}
