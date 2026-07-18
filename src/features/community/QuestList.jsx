import './questList.css';

const FALLBACK_SKILL = Object.freeze({
  color: 'var(--updates-accent)',
  label: 'Quest',
  icon: 'ph-target',
});

function normalizeQuestProgress(progress, goal) {
  const safeGoal = Math.max(1, Number(goal) || 1);
  const value = Math.min(safeGoal, Math.max(0, Number(progress?.n) || 0));
  const done = progress?.done === true || value >= safeGoal;

  return {
    done,
    goal: safeGoal,
    percent: Math.min(100, Math.round((value / safeGoal) * 100)),
    value,
  };
}

function QuestStatus({ error = '', onRetry, status }) {
  const isLoading = status === 'loading';
  const isError = status === 'error';
  const title = isLoading ? 'Syncing quests' : isError ? 'Quest sync failed' : 'No quests yet';
  const message = isLoading
    ? 'Loading your live daily and weekly goals…'
    : isError
      ? error || "Couldn't load quests."
      : 'New daily and weekly goals will appear here.';
  const icon = isLoading ? 'ph-spinner-gap' : isError ? 'ph-warning-circle' : 'ph-target';

  return (
    <li
      className={`quest-state quest-state-${status}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <span className="quest-state-icon" aria-hidden="true">
        <i className={`ph-bold ${icon}`} />
      </span>
      <div className="quest-state-copy">
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {isError && onRetry ? (
        <button type="button" className="quest-retry" onClick={onRetry}>
          <i className="ph-bold ph-arrow-clockwise" aria-hidden="true" />
          Try again
        </button>
      ) : null}
    </li>
  );
}

function QuestMetric({ icon, label, value }) {
  return (
    <div className="quest-metric">
      <i className={`ph-bold ${icon}`} aria-hidden="true" />
      <div className="quest-metric-copy">
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    </div>
  );
}

function QuestRow({ index = 0, progress, quest, skill }) {
  const safeSkill = skill || FALLBACK_SKILL;
  const current = normalizeQuestProgress(progress, quest.goal);

  return (
    <li
      className={`quest-item${current.done ? ' is-complete' : ''}`}
      style={{
        '--quest-color': safeSkill.color || 'var(--updates-accent)',
        '--quest-delay': `${index * 36}ms`,
      }}
      data-complete={current.done ? 'true' : 'false'}
    >
      <article className="quest-item-layout">
        <span className="quest-item-icon" aria-hidden="true">
          <i className={`ph-bold ${safeSkill.icon}`} />
        </span>
        <div className="quest-item-main">
          <div className="quest-item-heading">
            <h4>{quest.label}</h4>
            <p>+{quest.xp} {safeSkill.label} XP</p>
          </div>
          <progress
            className="quest-progress"
            value={current.value}
            max={current.goal}
            aria-label={`${quest.label} progress: ${current.value} of ${current.goal}`}
          />
          <span className="quest-progress-value">{current.value}/{current.goal}</span>
        </div>
        <span className="quest-status-marker" aria-hidden="true">
          {current.done ? <i className="ph-bold ph-check" /> : null}
        </span>
        <span className="quest-screen-reader-status">
          {current.done ? 'Complete' : `${current.percent}% complete`}
        </span>
      </article>
    </li>
  );
}

function QuestSection({ progress = {}, quests, skills, startIndex, title }) {
  const sectionId = `quest-section-${title.toLowerCase()}`;
  const sectionColor = title === 'Daily' ? '#0ea5e9' : '#8b5cf6';

  return (
    <li className="quest-section-group" style={{ '--quest-section-color': sectionColor }}>
      <section aria-labelledby={sectionId}>
        <header className="quest-section-header">
          <h3 id={sectionId}>{title}</h3>
        </header>
        <ul className="quest-items" aria-label={`${title} quests`}>
          {quests.map((quest, index) => (
            <QuestRow
              key={quest.id}
              index={startIndex + index}
              progress={progress[quest.id]}
              quest={quest}
              skill={skills[quest.skill]}
            />
          ))}
        </ul>
      </section>
    </li>
  );
}

export default function QuestList({
  error = '',
  liveStreak = 0,
  onRetry,
  progress = {},
  quests = [],
  restoreFocus = false,
  skills = {},
  status = 'ready',
}) {
  if (status !== 'ready') {
    return <QuestStatus error={error} onRetry={onRetry} status={status} />;
  }

  if (!quests.length) {
    return <QuestStatus status="empty" />;
  }

  const daily = quests.filter((quest) => quest.type === 'daily');
  const weekly = quests.filter((quest) => quest.type === 'weekly');
  const allQuests = [...daily, ...weekly];
  const questProgress = (quest) => normalizeQuestProgress(progress[quest.type]?.[quest.id], quest.goal);
  const completed = allQuests.filter((quest) => questProgress(quest).done).length;
  const dailyCompleted = daily.filter((quest) => questProgress(quest).done).length;
  const weeklyCompleted = weekly.filter((quest) => questProgress(quest).done).length;
  const xpEarned = allQuests
    .filter((quest) => questProgress(quest).done)
    .reduce((sum, quest) => sum + quest.xp, 0);
  const nextQuest = allQuests.find((quest) => !questProgress(quest).done);
  const overallPercent = Math.round((completed / allQuests.length) * 100);

  return (
    <>
      <li
        id="quest-board-summary"
        className="quest-summary"
        tabIndex={restoreFocus ? -1 : undefined}
      >
        <span className="quest-summary-icon" aria-hidden="true">
          <i className="ph-bold ph-target" />
        </span>
        <div className="quest-summary-copy">
          <h3>{completed} of {allQuests.length} complete</h3>
          <p>{nextQuest ? `Next: ${nextQuest.label}` : 'All quests are complete for this cycle.'}</p>
        </div>
        <div
          className="quest-overall-progress"
          role="progressbar"
          aria-label="Overall quest completion"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={overallPercent}
        >
          <strong>{overallPercent}%</strong>
          <span>Overall</span>
        </div>
      </li>

      <li className="quest-metrics-row">
        <dl className="quest-metrics" aria-label="Quest progress summary">
          <QuestMetric icon="ph-fire" label="day streak" value={liveStreak} />
          <QuestMetric icon="ph-star" label="earned" value={`${xpEarned} XP`} />
          <QuestMetric icon="ph-clock" label="Daily" value={`${dailyCompleted}/${daily.length}`} />
          <QuestMetric icon="ph-calendar-blank" label="Weekly" value={`${weeklyCompleted}/${weekly.length}`} />
        </dl>
      </li>

      <QuestSection
        progress={progress.daily}
        quests={daily}
        skills={skills}
        startIndex={0}
        title="Daily"
      />
      <QuestSection
        progress={progress.weekly}
        quests={weekly}
        skills={skills}
        startIndex={daily.length}
        title="Weekly"
      />
    </>
  );
}
