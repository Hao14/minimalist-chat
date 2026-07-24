import { useLocale } from '../../lib/useLocale.js';

export function LanguageHelpTabLabel() {
  const { t } = useLocale();
  return <span>{t('settings.help.navLabel')}</span>;
}
