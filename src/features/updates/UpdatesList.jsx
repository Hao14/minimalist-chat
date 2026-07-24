import { createInitialsAvatarDataUrl } from '../../lib/avatar.js';

function formatCommitDate(value) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortSha(commitObj) {
  return commitObj.sha ? commitObj.sha.slice(0, 7) : 'local';
}

function UpdateOverview({ cached = false, commits = [], onRetry, status = 'ready' }) {
  const latestDate = commits[0]?.commit?.author?.date;
  const statusCopy = status === 'loading'
    ? 'Checking for recent changes…'
    : cached
      ? 'Showing saved changes while the connection recovers.'
      : latestDate
        ? `Latest synced ${formatCommitDate(latestDate)}`
        : 'Release notes and product changes.';

  return (
    <li className="updates-overview">
      <div className="updates-overview-copy">
        <span className="updates-kicker">
          <i className="ph-bold ph-sparkle" aria-hidden="true" />
          What&apos;s new
          {commits.length ? <em>{cached ? 'Saved' : 'Latest'}</em> : null}
        </span>
        <strong>{commits.length ? `${commits.length} recent changes` : 'Product updates'}</strong>
        <p>{statusCopy}</p>
      </div>
      <button
        type="button"
        className="updates-overview-refresh"
        onClick={onRetry}
        aria-label="Refresh product updates"
        title="Refresh product updates"
      >
        <i className={`ph-bold ${status === 'loading' ? 'ph-circle-notch' : 'ph-arrows-clockwise'}`} aria-hidden="true" />
      </button>
    </li>
  );
}

function UpdatesState({ children, icon, onRetry, title, type = 'empty' }) {
  return (
    <li className={`updates-state updates-state-${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <i className={`ph-bold ${icon}`} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{children}</p>
      {onRetry ? (
        <div className="updates-state-actions">
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      ) : null}
    </li>
  );
}

export default function UpdatesList({ cached = false, commits = [], error = '', onRetry, status = 'idle' }) {
  if (status === 'loading') {
    return (
      <>
        <UpdateOverview commits={commits} onRetry={onRetry} status="loading" />
        {!commits.length ? (
          <UpdatesState icon="ph-circle-notch" title="Checking for updates" type="loading">
            Pulling the latest product changes…
          </UpdatesState>
        ) : null}
      </>
    );
  }

  if (status === 'error' && !commits.length) {
    return (
      <>
        <UpdateOverview onRetry={onRetry} status="error" />
        <UpdatesState icon="ph-cloud-slash" onRetry={onRetry} title="Couldn&apos;t refresh updates" type="error">
          {error || 'Check your connection and try again.'}
        </UpdatesState>
      </>
    );
  }

  if (!commits.length) {
    return (
      <>
        <UpdateOverview onRetry={onRetry} />
        <UpdatesState icon="ph-sparkle" title="No updates yet">
          New product changes will appear here after the next sync.
        </UpdatesState>
      </>
    );
  }

  return (
    <>
      <UpdateOverview cached={cached} commits={commits} onRetry={onRetry} />
      {cached && error ? (
        <li className="activity-connection-note" role="status">
          <i className="ph-bold ph-cloud-slash" aria-hidden="true" />
          You&apos;re offline. Showing saved product updates.
        </li>
      ) : null}
      {commits.map((commitObj, index) => {
        const message = commitObj.commit?.message || 'Product update';
        const messageLines = message.split('\n').map((line) => line.trim()).filter(Boolean);
        const description = messageLines.slice(1).join(' ');
        const authorName = commitObj.commit?.author?.name || 'Minimalist team';
        const avatar = commitObj.author?.avatar_url || createInitialsAvatarDataUrl('Minimalist');
        const date = commitObj.commit?.author?.date;

        return (
          <li className={`update-timeline-item${index === 0 ? ' is-latest' : ''}`} key={commitObj.sha || message}>
            <div className="update-timeline-top">
              <span className="update-timeline-label">{index === 0 ? 'Latest change' : 'Product change'}</span>
              <time className="update-date" dateTime={date || undefined}>{formatCommitDate(date)}</time>
            </div>
            <h3 className="update-timeline-title">{messageLines[0] || 'Product update'}</h3>
            {description ? <p className="update-timeline-description">{description}</p> : null}
            <div className="update-timeline-meta">
              <img src={avatar} alt="" loading="lazy" decoding="async" />
              <span>{authorName}</span>
              <span aria-hidden="true">·</span>
              <code className="update-sha">{shortSha(commitObj)}</code>
            </div>
          </li>
        );
      })}
    </>
  );
}
