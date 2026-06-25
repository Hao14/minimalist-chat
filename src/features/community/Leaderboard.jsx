function medal(index) {
  if (index === 0) return '1';
  if (index === 1) return '2';
  if (index === 2) return '3';
  return `${index + 1}`;
}

function openProfile(row) {
  window.viewUserProfile?.(row.uid);
}

function LeaderboardFilters({ metric, onMetric, skills }) {
  return (
    <li className="lb-filters">
      <button
        className={`lb-filter ${metric === 'overall' ? 'active' : ''}`}
        data-metric="overall"
        onClick={() => onMetric('overall')}
        type="button"
      >
        Overall
      </button>
      {Object.entries(skills).map(([key, skill]) => (
        <button
          className={`lb-filter ${metric === key ? 'active' : ''}`}
          data-metric={key}
          key={key}
          onClick={() => onMetric(key)}
          style={metric === key ? { background: skill.color, borderColor: skill.color, color: '#111' } : undefined}
          type="button"
          title={skill.label}
        >
          <i className={`ph-bold ${skill.icon}`} />
        </button>
      ))}
    </li>
  );
}

export default function Leaderboard({ error = '', metric = 'overall', onMetric, rows = [], skills = {}, status = 'ready', unit = 'pts' }) {
  const activeMetric = metric === 'overall' ? 'Overall reputation' : skills[metric]?.label || 'Skill score';
  const topRows = rows.slice(0, 3);

  return (
    <>
      <LeaderboardFilters metric={metric} onMetric={onMetric} skills={skills} />
      {status === 'loading' ? <li className="lb-empty lb-state"><i className="ph-bold ph-spinner-gap" /> Loading leaderboard…</li> : null}
      {status === 'error' ? <li className="lb-empty lb-state"><i className="ph-bold ph-lock-key" /> Couldn&apos;t load leaderboard: {error}</li> : null}
      {status === 'ready' && !rows.length ? <li className="lb-empty lb-state"><i className="ph-bold ph-trophy" /> No ranked members yet.</li> : null}
      {status === 'ready' && rows.length ? (
        <li className="lb-hero">
          <div className="lb-hero-copy">
            <span className="lb-kicker"><i className="ph-bold ph-trophy" /> Leaderboard</span>
            <strong>{activeMetric}</strong>
            <p>Live room reputation across messages, quests, awards, and community activity.</p>
          </div>
          <div className="lb-podium" aria-label="Top members">
            {topRows.map((row, index) => (
              <button
                className={`lb-podium-card rank-${index + 1}`}
                key={row.uid}
                onClick={() => openProfile(row)}
                type="button"
              >
                <span className="lb-podium-rank">#{index + 1}</span>
                <img src={row.photo || window.getAvatarUrl?.(row.name, '') || ''} alt="" />
                <strong>{row.name}</strong>
                <em>{row.score} {unit}</em>
              </button>
            ))}
          </div>
        </li>
      ) : null}
      {status === 'ready' ? rows.map((row, index) => (
        <li
          className="lb-row"
          key={row.uid}
          onClick={() => openProfile(row)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openProfile(row);
            }
          }}
        >
          <span className="lb-rank">{medal(index)}</span>
          <img className="lb-avatar" src={row.photo || window.getAvatarUrl?.(row.name, '') || ''} alt="" />
          <span className="lb-main">
            <span className="lb-name">{row.name}</span>
            <span className="lb-lvl">Level {row.lvl}</span>
          </span>
          <span className="lb-rep"><strong>{row.score}</strong><small>{unit}</small></span>
        </li>
      )) : null}
    </>
  );
}
