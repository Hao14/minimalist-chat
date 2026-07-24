import { useSyncExternalStore } from 'react';
import {
  DEFAULT_LOCALE,
  getLocale,
  subscribeLocale,
  translate,
} from '../../lib/i18n.js';

export default function MessageDeliveryState({ error = '', messageId, onCancel, onRetry, progress = 0, state }) {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => DEFAULT_LOCALE);
  const uploading = state === 'sending' && progress > 0 && progress < 100;
  const label = uploading
    ? translate('chat.attachment.uploading', { progress }, locale)
    : state === 'sending'
      ? translate('chat.status.sending', {}, locale)
      : state === 'sent'
        ? translate('chat.status.sent', {}, locale)
        : translate('chat.status.failed', {}, locale);
  const icon = state === 'sending' ? 'ph-circle-notch message-delivery-spinner' : state === 'sent' ? 'ph-check-circle' : 'ph-warning-circle';
  return (
    <div className={`message-delivery-state is-${state}`} role="status" aria-live="polite">
      <span><i className={`ph-bold ${icon}`} aria-hidden="true" />{label}</span>
      {uploading ? (
        <>
          <span className="message-delivery-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
          <button
            type="button"
            className="message-delivery-retry"
            onClick={() => onCancel(messageId)}
            title={translate('chat.attachment.cancelUpload', {}, locale)}
          >
            <i className="ph-bold ph-x" aria-hidden="true" />
            {translate('chat.attachment.cancelUpload', {}, locale)}
          </button>
        </>
      ) : null}
      {state === 'failed' ? (
        <button
          type="button"
          className="message-delivery-retry"
          onClick={() => onRetry(messageId)}
          title={error || 'Retry this message'}
        >
          <i className="ph-bold ph-arrow-clockwise" aria-hidden="true" />
          {translate('chat.status.retry', {}, locale)}
        </button>
      ) : null}
    </div>
  );
}
