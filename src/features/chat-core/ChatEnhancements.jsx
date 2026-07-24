import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  DEFAULT_LOCALE,
  getLocale,
  subscribeLocale,
  translate,
} from '../../lib/i18n.js';
import { buildThreadSummaries, messagesForThread } from './threadModel.js';
import { scheduledMessageStatusLabel } from './scheduledMessageModel.js';
import './chatEnhancements.css';

function useChatI18n() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => DEFAULT_LOCALE);
  return {
    locale,
    t: (key, values) => translate(key, values, locale),
  };
}

function compactText(value, fallback = 'Message') {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return fallback;
  return text.length > 110 ? `${text.slice(0, 107)}…` : text;
}

function ThreadMessage({ locale, message, onJump }) {
  return (
    <button
      className="thread-message-card"
      onClick={() => onJump(message)}
      type="button"
    >
      <span className="thread-message-meta">
        <strong>{message.name || 'Someone'}</strong>
        <time>{new Date(Number(message.timestamp || 0)).toLocaleString(locale, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}</time>
      </span>
      <span>{compactText(message.text, message.attachedFile?.name || 'Attachment')}</span>
    </button>
  );
}

export function ThreadDrawer({
  activeRootId,
  follows,
  messages,
  onClose,
  onFollow,
  onJump,
  onMarkRead,
  onReply,
  onSelectThread,
  open,
  readAtByRoot,
  viewerUid,
}) {
  const { locale, t } = useChatI18n();
  const [view, setView] = useState(activeRootId ? 'thread' : 'inbox');
  const summaries = useMemo(
    () => buildThreadSummaries(messages, follows, readAtByRoot, viewerUid),
    [follows, messages, readAtByRoot, viewerUid],
  );
  const activeMessages = useMemo(
    () => messagesForThread(messages, activeRootId),
    [activeRootId, messages],
  );
  const activeSummary = summaries.find((thread) => thread.rootId === activeRootId);

  if (!open) return null;

  const openThread = (rootId) => {
    onSelectThread(rootId);
    onMarkRead(rootId);
    setView('thread');
  };

  return (
    <aside className="chat-enhancement-drawer" aria-label={t('chat.thread.title')} aria-modal="false">
      <header className="chat-enhancement-head">
        <div>
          <span>Conversation</span>
          <h2>{view === 'thread' ? t('chat.thread.title') : `${t('chat.thread.title')} inbox`}</h2>
        </div>
        <button onClick={onClose} type="button" aria-label="Close threads">
          <i className="ph-bold ph-x" aria-hidden="true" />
        </button>
      </header>
      <nav className="chat-enhancement-tabs" aria-label="Thread views">
        <button
          aria-pressed={view === 'inbox'}
          className={view === 'inbox' ? 'active' : ''}
          onClick={() => setView('inbox')}
          type="button"
        >
          Inbox
          {summaries.reduce((total, thread) => total + thread.unreadCount, 0) ? (
            <span>{summaries.reduce((total, thread) => total + thread.unreadCount, 0)}</span>
          ) : null}
        </button>
        <button
          aria-pressed={view === 'thread'}
          className={view === 'thread' ? 'active' : ''}
          disabled={!activeRootId}
          onClick={() => setView('thread')}
          type="button"
        >
          Current
        </button>
      </nav>

      {view === 'inbox' ? (
        <div className="thread-inbox-list">
          {summaries.length ? summaries.map((thread) => (
            <button
              className="thread-inbox-item"
              key={thread.rootId}
              onClick={() => openThread(thread.rootId)}
              type="button"
            >
              <span className="thread-inbox-title">
                <strong>{compactText(thread.root?.text, t('chat.thread.title'))}</strong>
                {thread.unreadCount ? <em>{t('chat.unread.count', { count: thread.unreadCount })}</em> : null}
              </span>
              <span>
                {t('chat.thread.replies', { count: thread.replyCount })}
                {thread.followed ? ` · ${t('chat.thread.follow')}` : ''}
              </span>
            </button>
          )) : (
            <div className="chat-enhancement-empty">
              <i className="ph-bold ph-chat-centered-dots" aria-hidden="true" />
              <strong>No active threads</strong>
              <span>Use the thread button on a message to keep a focused conversation together.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="thread-current">
          {activeMessages.length ? activeMessages.map((message) => (
            <ThreadMessage key={message.id} locale={locale} message={message} onJump={onJump} />
          )) : (
            <div className="chat-enhancement-empty">
              <strong>This thread is outside the loaded history.</strong>
              <span>Open the original message from search to load it.</span>
            </div>
          )}
          {activeRootId ? (
            <footer className="thread-current-actions">
              <button onClick={() => onFollow(activeRootId, !activeSummary?.followed)} type="button">
                <i className={`ph-bold ${activeSummary?.followed ? 'ph-bell-slash' : 'ph-bell'}`} aria-hidden="true" />
                {activeSummary?.followed ? t('chat.thread.unfollow') : t('chat.thread.follow')}
              </button>
              <button onClick={() => onReply(activeRootId)} type="button">
                <i className="ph-bold ph-arrow-bend-up-left" aria-hidden="true" />
                {t('chat.thread.replyPlaceholder')}
              </button>
            </footer>
          ) : null}
        </div>
      )}
    </aside>
  );
}

export function ScheduleMessageDialog({
  defaultText,
  onClose,
  onSubmit,
  open,
  submitting,
}) {
  const { t } = useChatI18n();
  const [text, setText] = useState(defaultText || '');
  const [deliverAt, setDeliverAt] = useState(() => {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    date.setSeconds(0, 0);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  });
  const [minDeliverAt] = useState(() => {
    const date = new Date(Date.now() + 60_000);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  });

  if (!open) return null;

  return (
    <div className="composer-dialog-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form
        className="composer-dialog schedule-message-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-message-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ text, deliverAt: new Date(deliverAt).getTime() });
        }}
      >
        <div className="composer-dialog-head">
          <div>
            <span className="composer-dialog-kicker">Send later</span>
            <h2 id="schedule-message-title">{t('chat.schedule.title')}</h2>
            <p>The message will send even if this browser is closed.</p>
          </div>
          <button type="button" className="composer-dialog-close" onClick={onClose} aria-label="Close schedule message">
            <i className="ph-bold ph-x" aria-hidden="true" />
          </button>
        </div>
        <div className="composer-dialog-fields">
          <label>
            <span>Message</span>
            <textarea
              autoFocus
              maxLength={8000}
              onChange={(event) => setText(event.target.value)}
              rows={5}
              value={text}
            />
          </label>
          <label>
            <span>{t('chat.schedule.sendAt')}</span>
            <input
              min={minDeliverAt}
              onChange={(event) => setDeliverAt(event.target.value)}
              type="datetime-local"
              value={deliverAt}
            />
          </label>
        </div>
        <div className="composer-dialog-actions">
          <button className="composer-dialog-secondary" disabled={submitting} onClick={onClose} type="button">
            {t('chat.schedule.cancel')}
          </button>
          <button className="composer-dialog-primary" disabled={submitting || !text.trim()} type="submit">
            {submitting ? `${t('chat.schedule.confirm')}…` : t('chat.schedule.confirm')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ScheduledMessageList({ messages, onCancel }) {
  const { locale, t } = useChatI18n();
  if (!messages.length) return null;
  return (
    <section className="scheduled-message-strip" aria-label={t('chat.schedule.title')}>
      <span className="scheduled-message-strip-title">
        <i className="ph-bold ph-clock-countdown" aria-hidden="true" />
        {messages.length} scheduled
      </span>
      <div>
        {messages.slice(0, 3).map((message) => (
          <article key={message.id}>
            <span>
              <strong>{compactText(message.text)}</strong>
              <small>{scheduledMessageStatusLabel(message)} · {new Date(message.deliverAt).toLocaleString(locale)}</small>
            </span>
            {message.status === 'pending' ? (
              <button onClick={() => onCancel(message.id)} type="button" aria-label={t('chat.schedule.cancel')}>
                <i className="ph-bold ph-x" aria-hidden="true" />
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export function AttachmentPreview({ file, onRemove }) {
  const { t } = useChatI18n();
  if (!file) return null;
  return (
    <div className="composer-attachment-preview">
      <span className="composer-attachment-icon">
        <i className={`ph-bold ${file.type?.startsWith('image/') ? 'ph-image' : 'ph-file'}`} aria-hidden="true" />
      </span>
      <span>
        <strong>{file.name}</strong>
        <small>{file.type || 'File'} · {file.size ? `${Math.max(0.1, file.size / 1024).toFixed(1)} KB` : '0 KB'}</small>
      </span>
      <button onClick={onRemove} type="button" aria-label={`${t('chat.attachment.remove')}: ${file.name}`}>
        <i className="ph-bold ph-x" aria-hidden="true" />
      </button>
    </div>
  );
}
