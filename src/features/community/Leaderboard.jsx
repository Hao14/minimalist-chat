import { splitRankedRows } from './communityPresentation.js';

const SKILL_GROWTH_COPY = {
  leadership: 'Create rooms, recognize people, and keep a steady community streak.',
  support: 'Give kudos, welcome people, and complete support quests.',
  technical: 'Stay active in conversations and complete technical quests.',
  creativity: 'React thoughtfully and complete creative community quests.',
};

function avatarFor(row) {
  return window.getAvatarUrl?.(row?.name, row?.photo) || '';
}

function MetricRail({ disabled, metric, onMetric, skills }) {
  const metrics = [
    { color: 'var(--updates-accent)', icon: 'ph-sparkle', key: 'overall', label: 'Overall' },
    ...Object.entries(skills).map(([key, skill]) => ({ key, ...skill })),
  ];

  return (
    <li className="rank-v2-metric-rail">
      <div className="rank-v2-metric-scroll" role="group" aria-label="Choose a rank metric">
        {metrics.map((item) => (
          <button
            aria-pressed={metric === item.key}
            className="rank-v2-metric"
            data-metric={item.key}
            disabled={disabled}
            key={item.key}
            onClick={() => onMetric?.(item.key)}
            style={{ '--rank-tone': item.color }}
            type="button"
          >
            <i className={`ph-bold ${item.icon}`} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </li>
  );
}

function RankState({ error = '', onRetry, status }) {
  const isError = status === 'error';
  return (
    <li className={`rank-v2-state${isError ? ' is-error' : ''}`} role={isError ? 'alert' : 'status'}>
      <span className="rank-v2-state-icon" aria-hidden="true">
        <i className={`ph-bold ${isError ? 'ph-cloud-slash' : 'ph-spinner-gap'}`} />
      </span>
      <strong>{isError ? "Couldn't load your rank" : 'Calculating your rank'}</strong>
      <p>{isError ? error || 'Your progress is temporarily unavailable.' : 'Messages, kudos, badges, and skill XP are being counted.'}</p>
      {isError ? (
        <button className="rank-v2-retry" onClick={onRetry} type="button" aria-label="Retry rank">
          <i className="ph-bold ph-arrow-clockwise" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

function PersonalRank({ activeMetric, currentMember, metric, onOpenProfile, unit }) {
  const progress = Math.max(0, Math.min(99, Number(currentMember?.progress || 0)));
  const nextLevel = progress === 0 ? 100 : 100 - progress;

  return (
    <li className="rank-v2-overview">
      <div className="rank-v2-heading">
        <span className="rank-v2-eyebrow"><i className="ph-bold ph-chart-line-up" aria-hidden="true" /> Your rank profile</span>
        <h3>{activeMetric}</h3>
        <p>Track reputation and skill progress in one clear view.</p>
      </div>

      <button className="rank-v2-person" onClick={() => onOpenProfile?.(currentMember)} type="button">
        <img src={avatarFor(currentMember)} alt="" />
        <span className="rank-v2-person-copy">
          <strong>{currentMember.name}</strong>
          <small>{currentMember.handle ? `@${currentMember.handle}` : 'Your progress'}</small>
        </span>
        <i className="ph-bold ph-caret-right" aria-hidden="true" />
      </button>

      <div className="rank-v2-stats" aria-label={`${activeMetric} summary`}>
        <span>
          <small>Score</small>
          <strong>{currentMember.score.toLocaleString()}</strong>
          <em>{unit}</em>
        </span>
        <span>
          <small>Level</small>
          <strong>{currentMember.lvl}</strong>
          <em>{metric === 'overall' ? 'across skills' : activeMetric}</em>
        </span>
        <span>
          <small>Next level</small>
          <strong>{nextLevel}</strong>
          <em>XP to go</em>
        </span>
      </div>

      <div className="rank-v2-progress-copy">
        <span>Level {currentMember.lvl} progress</span>
        <strong>{progress}%</strong>
      </div>
      <div
        className="rank-v2-progress"
        role="progressbar"
        aria-label={`Progress through level ${currentMember.lvl}`}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={progress}
      >
        <span style={{ '--rank-progress': `${progress}%` }} />
      </div>
    </li>
  );
}

function ScoreGuide({ breakdown, metric, skills }) {
  if (metric !== 'overall') {
    const skill = skills[metric] || {};
    return (
      <li className="rank-v2-guide rank-v2-guide-skill" style={{ '--rank-tone': skill.color }}>
        <span className="rank-v2-guide-icon" aria-hidden="true"><i className={`ph-bold ${skill.icon || 'ph-sparkle'}`} /></span>
        <span>
          <strong>Grow {skill.label || 'this skill'}</strong>
          <p>{SKILL_GROWTH_COPY[metric] || 'Complete relevant community actions and quests to earn XP.'}</p>
        </span>
      </li>
    );
  }

  const items = [
    { icon: 'ph-chat-circle-text', label: 'Messages', value: `${breakdown.messages || 0} × 1` },
    { icon: 'ph-hands-clapping', label: 'Kudos', value: `${breakdown.kudos || 0} × 5` },
    { icon: 'ph-medal', label: 'Badges', value: `${breakdown.badges || 0} × 10` },
    { icon: 'ph-lightning', label: 'Skill XP', value: Number(breakdown.skillXp || 0).toLocaleString() },
  ];

  return (
    <li className="rank-v2-guide">
      <header>
        <span><i className="ph-bold ph-calculator" aria-hidden="true" /> How your score grows</span>
        <em>{Number(breakdown.total || 0).toLocaleString()} total</em>
      </header>
      <div className="rank-v2-formula">
        {items.map((item) => (
          <span key={item.label}>
            <i className={`ph-bold ${item.icon}`} aria-hidden="true" />
            <small>{item.label}</small>
            <strong>{item.value}</strong>
          </span>
        ))}
      </div>
    </li>
  );
}

function RankIdentity({ row }) {
  return (
    <>
      <img src={avatarFor(row)} alt="" />
      <span>
        <strong>{row.name}</strong>
        <small>Level {row.lvl}{row.isCurrentUser ? ' · You' : ''}</small>
      </span>
    </>
  );
}

function CommunityStandings({ onOpenProfile, rows, unit }) {
  const { leaders, remaining } = splitRankedRows(rows);

  return (
    <li className="rank-v2-community">
      <header>
        <span><i className="ph-bold ph-users-three" aria-hidden="true" /> Community standings</span>
        <em>Top {rows.length}</em>
      </header>
      <ol className="rank-v2-leaders" aria-label="Top ranked members">
        {leaders.map((row) => (
          <li key={row.uid}>
            <button onClick={() => onOpenProfile?.(row)} type="button">
              <b>#{row.position}</b>
              <RankIdentity row={row} />
              <em>{row.score.toLocaleString()} {unit}</em>
            </button>
          </li>
        ))}
      </ol>
      {remaining.length > 0 ? (
        <ol className="rank-v2-remaining" start={leaders.length + 1}>
          {remaining.map((row) => (
            <li key={row.uid}>
              <button onClick={() => onOpenProfile?.(row)} type="button">
                <b>#{row.position}</b>
                <RankIdentity row={row} />
                <em>{row.score.toLocaleString()} {unit}</em>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function PrivateRankingNotice() {
  return (
    <li className="rank-v2-trust-note">
      <span aria-hidden="true"><i className="ph-bold ph-shield-check" /></span>
      <div>
        <strong>Community standings are being prepared</strong>
        <p>Rank shows progress you can verify today. Shared standings will appear only when member scores can be published fairly.</p>
      </div>
    </li>
  );
}

export default function Leaderboard({
  breakdown = {},
  communityRankingAvailable = false,
  currentMember = null,
  error = '',
  metric = 'overall',
  onMetric,
  onOpenProfile,
  onRetry,
  rows = [],
  skills = {},
  status = 'ready',
  unit = 'points',
}) {
  const activeMetric = metric === 'overall' ? 'Overall reputation' : skills[metric]?.label || 'Skill rank';
  const isBusy = status === 'loading';

  return (
    <>
      <MetricRail disabled={isBusy} metric={metric} onMetric={onMetric} skills={skills} />
      {status === 'loading' ? <RankState status="loading" /> : null}
      {status === 'error' ? <RankState error={error} onRetry={onRetry} status="error" /> : null}
      {status === 'ready' && !currentMember ? (
        <li className="rank-v2-state" role="status">
          <span className="rank-v2-state-icon" aria-hidden="true"><i className="ph-bold ph-chart-line" /></span>
          <strong>Your rank starts here</strong>
          <p>Send a message, complete a quest, or give kudos to begin building your profile.</p>
        </li>
      ) : null}
      {status === 'ready' && currentMember ? (
        <>
          <PersonalRank activeMetric={activeMetric} currentMember={currentMember} metric={metric} onOpenProfile={onOpenProfile} unit={unit} />
          <ScoreGuide breakdown={breakdown} metric={metric} skills={skills} />
          {communityRankingAvailable ? <CommunityStandings onOpenProfile={onOpenProfile} rows={rows} unit={unit} /> : <PrivateRankingNotice />}
        </>
      ) : null}
    </>
  );
}
