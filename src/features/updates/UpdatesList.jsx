function formatCommitDate(value) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortSha(commitObj) {
  return commitObj.sha ? commitObj.sha.slice(0, 7) : 'local';
}

export default function UpdatesList({ commits = [], error = '', status = 'idle' }) {
  if (status === 'loading') {
    return (
      <li className="updates-state updates-state-loading">
        <span className="updates-loader" />
        <strong>Pulling updates</strong>
        <p>Checking the latest app changes…</p>
      </li>
    );
  }

  if (status === 'error') {
    return (
      <li className="updates-state updates-state-error">
        <i className="ph-bold ph-warning-circle" aria-hidden="true" />
        <strong>Couldn&apos;t load changelog</strong>
        <p>{error || 'Connection failed.'}</p>
      </li>
    );
  }

  if (!commits.length) {
    return (
      <li className="updates-state updates-state-empty">
        <i className="ph-bold ph-rocket-launch" aria-hidden="true" />
        <strong>No updates yet</strong>
        <p>New changes will land here when the changelog syncs.</p>
      </li>
    );
  }

  const latestDate = formatCommitDate(commits[0]?.commit?.author?.date);

  return (
    <>
      <li className="updates-overview">
        <div>
          <span className="updates-kicker">Changelog</span>
          <strong>{commits.length} recent updates</strong>
          <p>Latest synced {latestDate}</p>
        </div>
        <i className="ph-bold ph-git-commit" aria-hidden="true" />
      </li>
      {commits.map((commitObj, index) => {
    const message = commitObj.commit?.message || 'Update';
    const msgLines = message.split('\n');
    const description = msgLines.slice(1).join('\n').trim();
    const authorName = commitObj.commit?.author?.name || 'Dev';
    const avatar = commitObj.author?.avatar_url || 'https://ui-avatars.com/api/?name=Dev&background=000&color=FFD700';
    const date = commitObj.commit?.author?.date;

    return (
      <li className="update-card update-card-modern fade-in-up" key={commitObj.sha || message} style={{ '--update-delay': `${Math.min(index, 8) * 34}ms` }}>
        <div className="update-card-top">
          <span className="update-date">{formatCommitDate(date)}</span>
          <span className="update-sha">{shortSha(commitObj)}</span>
        </div>
        <div className="update-title">{msgLines[0]}</div>
        {description ? <div className="update-desc">{description}</div> : null}
        <div className="update-author">
          <img src={avatar} alt="" />
          <span>{authorName}</span>
          <i className="ph-bold ph-arrow-up-right" aria-hidden="true" />
        </div>
      </li>
    );
      })}
    </>
  );
}
