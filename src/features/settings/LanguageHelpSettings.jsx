import { useSyncExternalStore } from 'react';
import {
  SUPPORTED_LOCALES,
  setLocale,
} from '../../lib/i18n.js';
import { useLocale } from '../../lib/useLocale.js';
import {
  getDatabaseConnectionState,
  subscribeDatabaseConnection,
} from '../../lib/databaseConnection.js';
import {
  APP_BUILD_LABEL,
  APP_BUILD_NUMBER,
  APP_VERSION,
} from '../../lib/buildInfo.js';
import './languageHelp.css';

const BUG_REPORT_URL = 'https://github.com/Hao14/minimalist-chat/issues';
const SUPPORT_EMAIL = 'mailto:support@minimalist.com';

function SettingsAction({ copy, href, icon, label, onClick, external = false }) {
  const content = (
    <>
      <span className="language-help-action-icon" aria-hidden="true"><i className={`ph-bold ${icon}`} /></span>
      <span className="language-help-action-copy"><strong>{label}</strong><small>{copy}</small></span>
      <i className={`ph-bold ${external ? 'ph-arrow-square-out' : 'ph-arrow-right'}`} aria-hidden="true" />
    </>
  );

  if (href) {
    return <a className="language-help-action" href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>{content}</a>;
  }

  return <button className="language-help-action" type="button" onClick={onClick}>{content}</button>;
}

export function LanguageHelpSettings() {
  const { locale, t } = useLocale();
  const connectionState = useSyncExternalStore(
    subscribeDatabaseConnection,
    getDatabaseConnectionState,
    () => 'connecting',
  );

  const restartTour = () => {
    window.closeSettingsModal?.({ restoreFocus: false });
    window.requestAnimationFrame(() => {
      if (typeof window.showWelcomeTour === 'function') window.showWelcomeTour();
      else window.showToast?.('The product tour is still loading. Try again in a moment.');
    });
  };

  return (
    <>
      <header className="settings-pane-header language-help-header">
        <span className="settings-pane-kicker">{t('settings.help.kicker')}</span>
        <h2>{t('settings.help.title')}</h2>
        <p>{t('settings.help.intro')}</p>
      </header>

      <section className="language-help-band language-help-language" aria-labelledby="language-help-language-title">
        <div className="language-help-band-heading">
          <span className="language-help-band-index">01</span>
          <div><h3 id="language-help-language-title">{t('settings.help.languageHeading')}</h3><p>{t('settings.help.languageHelper')}</p></div>
        </div>
        <label className="language-help-select">
          <span>{t('settings.help.interfaceLanguage')}</span>
          <select value={locale} onChange={(event) => setLocale(event.currentTarget.value)}>
            {SUPPORTED_LOCALES.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
      </section>

      <section className="language-help-band" aria-labelledby="language-help-learn-title">
        <div className="language-help-band-heading">
          <span className="language-help-band-index">02</span>
          <div><h3 id="language-help-learn-title">{t('settings.help.learnHeading')}</h3></div>
        </div>
        <div className="language-help-actions">
          <SettingsAction icon="ph-path" label={t('settings.help.restartTour')} copy={t('settings.help.restartTourCopy')} onClick={restartTour} />
          <SettingsAction icon="ph-question" label={t('settings.help.browseHelp')} copy={t('settings.help.browseHelpCopy')} href="/faq" external />
        </div>
      </section>

      <section className="language-help-band" aria-labelledby="language-help-support-title">
        <div className="language-help-band-heading">
          <span className="language-help-band-index">03</span>
          <div><h3 id="language-help-support-title">{t('settings.help.supportHeading')}</h3></div>
        </div>
        <div className="language-help-actions">
          <SettingsAction icon="ph-envelope-simple" label={t('help.emailSupport')} copy={t('settings.help.emailSupportCopy')} href={SUPPORT_EMAIL} />
          <SettingsAction icon="ph-bug" label={t('help.reportBug')} copy={t('settings.help.reportBugCopy')} href={BUG_REPORT_URL} external />
        </div>
      </section>

      <footer className="language-help-footer">
        <div className="language-help-status" role="status" aria-live="polite" data-status={connectionState}>
          <span className="language-help-status-dot" aria-hidden="true" />
          <span>{t('settings.help.databaseConnection')}</span>
          <strong>{t(`connection.${connectionState}`)}</strong>
        </div>
        <div
          className="language-help-build"
          data-build-number={APP_BUILD_NUMBER}
          title={`Minimalist ${APP_VERSION}, ${t('settings.help.buildLabel').toLowerCase()} ${APP_BUILD_NUMBER}`}
        >
          <span>{t('settings.help.buildLabel')}</span>
          <code>{APP_BUILD_LABEL}</code>
        </div>
      </footer>
    </>
  );
}
