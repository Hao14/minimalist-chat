import { useMemo, useState } from 'react';

import { buildQuickReplyModel } from './quickReplyModel.js';
import {
  loadQuickRepliesCollapsed,
  saveQuickRepliesCollapsed,
} from './quickRepliesPreference.js';
import './quickReplies.css';

function QuickRepliesRail({ model, onPick, viewerId }) {
  const [collapsed, setCollapsed] = useState(() => loadQuickRepliesCollapsed(viewerId));
  const [pageState, setPageState] = useState({ sourceKey: '', index: 0 });

  const sourceKey = `${model.source.mode}:${model.source.id}`;
  const pageIndex = pageState.sourceKey === sourceKey
    ? pageState.index % model.sets.length
    : 0;
  const page = model.sets[pageIndex];
  const suggestionsId = `quick-replies-${String(model.source.id || 'current').replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const sourceContext = model.source.mode === 'reply'
    ? `replying to ${model.source.name}`
    : `for ${model.source.name}`;
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    saveQuickRepliesCollapsed(viewerId, next);
  };

  return (
    <section
      className={`quick-replies-v2 ${collapsed ? 'is-collapsed' : ''}`}
      aria-label={`Reply ideas for ${model.source.name}`}
    >
      <div className="quick-replies-v2__context">
        <span className="quick-replies-v2__spark" aria-hidden="true">
          <i className="ph-bold ph-sparkle" />
        </span>
        <span className="quick-replies-v2__context-copy">
          <strong>Reply ideas</strong>
          <span>{sourceContext}</span>
        </span>
      </div>

      <div
        className="quick-replies-v2__suggestions"
        hidden={collapsed}
        id={suggestionsId}
        role="group"
        aria-label="Suggested draft replies"
      >
        {page.map((suggestion, index) => (
          <button
            className={`quick-replies-v2__suggestion ${index === 0 ? 'is-primary' : ''}`}
            data-intent={suggestion.intent}
            key={suggestion.id}
            type="button"
            onClick={() => onPick(suggestion.text)}
            title={`Insert reply: ${suggestion.text}`}
          >
            {suggestion.text}
          </button>
        ))}
      </div>

      <div className="quick-replies-v2__actions">
        {!collapsed ? (
          <button
            className="quick-replies-v2__icon-button"
            disabled={model.sets.length < 2}
            type="button"
            onClick={() => setPageState({
              sourceKey,
              index: (pageIndex + 1) % model.sets.length,
            })}
            aria-label="Refresh reply ideas"
            title="Refresh reply ideas"
          >
            <i className="ph-bold ph-arrows-clockwise" aria-hidden="true" />
          </button>
        ) : null}
        <button
          className="quick-replies-v2__icon-button quick-replies-v2__toggle"
          type="button"
          onClick={toggleCollapsed}
          aria-controls={suggestionsId}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand reply ideas' : 'Collapse reply ideas'}
          title={collapsed ? 'Expand reply ideas' : 'Collapse reply ideas'}
        >
          <i className={`ph-bold ${collapsed ? 'ph-caret-down' : 'ph-caret-up'}`} aria-hidden="true" />
        </button>
      </div>

      <span className="quick-replies-v2__status" aria-live="polite">
        {collapsed ? 'Reply ideas collapsed' : `Reply set ${pageIndex + 1} of ${model.sets.length}`}
      </span>
    </section>
  );
}

export default function QuickReplies({
  messages,
  onPick,
  replyTarget,
  scopeKey,
  viewerId,
  viewerName,
  viewerShortId,
}) {
  const model = useMemo(() => buildQuickReplyModel(messages, {
    replyTarget,
    viewerId,
    viewerName,
    viewerShortId,
  }), [messages, replyTarget, viewerId, viewerName, viewerShortId]);

  if (!model?.sets?.length) return null;

  return (
    <QuickRepliesRail
      key={`${scopeKey}:${viewerId || 'signed-out'}`}
      model={model}
      onPick={onPick}
      viewerId={viewerId}
    />
  );
}
