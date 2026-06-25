function QuestRow({ index = 0, progress, quest, skill }) {
  const current = progress || { n: 0, done: false };
  const pct = Math.min(100, Math.round(((current.n || 0) / quest.goal) * 100));
  const safeSkill = skill || { label: 'Quest', icon: 'ph-sparkle', color: 'var(--accent-color)' };
  const remaining = Math.max(0, quest.goal - (current.n || 0));

  return (
    <li
      className={`q-row q-card ${current.done ? 'q-done' : ''}`}
      style={{ '--q-color': safeSkill.color, '--q-pct': `${pct}%`, '--q-delay': `${index * 42}ms` }}
    >
      <div className="q-orb"><i className={`ph-bold ${safeSkill.icon}`} aria-hidden="true" /></div>
      <div className="q-top">
        <div>
          <span className="q-label">{quest.label}</span>
          <span className="q-sub">{current.done ? 'Completed and banked' : `${remaining} left to finish`}</span>
        </div>
        <span className="q-reward">+{quest.xp} {safeSkill.label}</span>
      </div>
      <div className="q-bar">
        <div className="q-fill" />
      </div>
      <div className="q-meta">
        <span>{current.done ? 'Complete' : `${current.n || 0}/${quest.goal}`}</span>
        <strong>{pct}%</strong>
      </div>
    </li>
  );
}

export default function QuestList({ error = '', liveStreak = 0, progress = {}, quests = [], skills = {}, status = 'ready' }) {
  if (status === 'loading') {
    return (
      <li className="q-state q-loading">
        <span className="q-loader" />
        <strong>Syncing quests</strong>
        <p>Loading your live daily and weekly goals…</p>
      </li>
    );
  }

  if (status === 'error') {
    return (
      <li className="q-state q-error">
        <i className="ph-bold ph-warning-circle" aria-hidden="true" />
        <strong>Quest sync failed</strong>
        <p>{error || "Couldn't load quests."}</p>
      </li>
    );
  }

  const daily = quests.filter((quest) => quest.type === 'daily');
  const weekly = quests.filter((quest) => quest.type === 'weekly');
  const allQuests = [...daily, ...weekly];
  const questProgress = (quest) => progress[quest.type]?.[quest.id] || {};
  const completed = allQuests.filter((quest) => questProgress(quest).done).length;
  const total = allQuests.length || 1;
  const pointsReady = allQuests
    .filter((quest) => questProgress(quest).done)
    .reduce((sum, quest) => sum + quest.xp, 0);
  const nextQuest = allQuests.find((quest) => !questProgress(quest).done);

  return (
    <>
      <li className="q-hero">
        <div className="q-hero-copy">
          <span className="q-kicker"><i className="ph-bold ph-broadcast" aria-hidden="true" /> Live quest board</span>
          <strong>{completed}/{total} complete</strong>
          <p>{nextQuest ? `Next up: ${nextQuest.label}` : 'All quests are complete. Beautiful little productivity goblin.'}</p>
        </div>
        <div className="q-hero-ring" style={{ '--q-total-pct': `${Math.round((completed / total) * 100)}%` }}>
          <span>{Math.round((completed / total) * 100)}%</span>
        </div>
      </li>
      <li className="q-stats">
        <div>
          <span>Streak</span>
          <strong>{liveStreak}<small>d</small></strong>
        </div>
        <div>
          <span>XP ready</span>
          <strong>{pointsReady}<small>xp</small></strong>
        </div>
        <div>
          <span>Live</span>
          <strong><i className="ph-bold ph-pulse" aria-hidden="true" /> Sync</strong>
        </div>
      </li>
      <li className="q-section">Daily</li>
      {daily.map((quest, index) => (
        <QuestRow
          key={quest.id}
          index={index}
          progress={progress.daily?.[quest.id]}
          quest={quest}
          skill={skills[quest.skill]}
        />
      ))}
      <li className="q-section">Weekly</li>
      {weekly.map((quest, index) => (
        <QuestRow
          key={quest.id}
          index={daily.length + index}
          progress={progress.weekly?.[quest.id]}
          quest={quest}
          skill={skills[quest.skill]}
        />
      ))}
    </>
  );
}
