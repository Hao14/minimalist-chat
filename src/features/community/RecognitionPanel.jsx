const AWARD_CARDS = [
  { id: 'member_week', label: 'Member of the week', icon: 'ph-crown', tone: 'gold' },
  { id: 'community_award', label: 'Community awards', icon: 'ph-medal', tone: 'amber' },
  { id: 'top_contributor', label: 'Top contributor badges', icon: 'ph-trophy', tone: 'blue' },
  { id: 'anniversary', label: 'Anniversary celebrations', icon: 'ph-confetti', tone: 'purple' },
  { id: 'birthday', label: 'Birthday celebrations', icon: 'ph-cake', tone: 'pink' },
];

function avatarFor(row) {
  return row.photo || window.getAvatarUrl?.(row.name, '') || '';
}

function MemberChip({ row, meta }) {
  if (!row) return <span className="recognition-muted">No member yet</span>;
  return (
    <button
      className="recognition-member-chip"
      type="button"
      onClick={() => window.viewUserProfile?.(row.uid)}
      title={`Open ${row.name}'s profile`}
    >
      <img src={avatarFor(row)} alt="" />
      <span>
        <strong>{row.name}</strong>
        {meta ? <small>{meta}</small> : null}
      </span>
    </button>
  );
}

function MiniList({ empty, rows = [], title }) {
  return (
    <section className="recognition-card recognition-mini-list">
      <header>
        <span>{title}</span>
        <em>{rows.length}</em>
      </header>
      {rows.length ? (
        <div className="recognition-stack">
          {rows.slice(0, 4).map((row) => (
            <MemberChip key={row.uid} row={row} meta={row.meta} />
          ))}
        </div>
      ) : (
        <p>{empty}</p>
      )}
    </section>
  );
}

export default function RecognitionPanel({
  anniversaries = [],
  birthdays = [],
  error = '',
  memberOfWeek = null,
  rows = [],
  status = 'ready',
}) {
  if (status === 'loading') {
    return <li className="recognition-empty">Loading community recognition…</li>;
  }

  if (status === 'error') {
    return <li className="recognition-empty">Couldn&apos;t load recognition: {error}</li>;
  }

  const topRows = rows.slice(0, 5);

  return (
    <>
      <li className="recognition-hero">
        <div>
          <span className="recognition-kicker">Recognition</span>
          <h3>Celebrate the people keeping this place alive.</h3>
          <p>Member of the week, awards, badges, birthdays, and anniversaries all live here.</p>
        </div>
        <div className="recognition-winner">
          <span className="recognition-winner-label"><i className="ph-bold ph-crown" /> Member of the week</span>
          <MemberChip row={memberOfWeek} meta={memberOfWeek ? `${memberOfWeek.weekScore} weekly points` : ''} />
        </div>
      </li>

      <li className="recognition-awards">
        {AWARD_CARDS.map((award) => (
          <button
            className={`recognition-award recognition-award-${award.tone}`}
            key={award.id}
            type="button"
            onClick={() => window.showToast?.(`${award.label}: use /award give @user or open a profile to award manually.`, false)}
          >
            <i className={`ph-bold ${award.icon}`} />
            <span>{award.label}</span>
          </button>
        ))}
      </li>

      <li className="recognition-grid">
        <section className="recognition-card recognition-top">
          <header>
            <span>Top contributors</span>
            <em>{topRows.length}</em>
          </header>
          {topRows.length ? topRows.map((row, index) => (
            <button
              className="recognition-rank-row"
              key={row.uid}
              type="button"
              onClick={() => window.viewUserProfile?.(row.uid)}
            >
              <strong>{index + 1}</strong>
              <img src={avatarFor(row)} alt="" />
              <span>{row.name}<small>{row.score} pts · Lv {row.lvl}</small></span>
            </button>
          )) : <p>No contributors ranked yet.</p>}
        </section>

        <MiniList
          title="Anniversaries"
          rows={anniversaries}
          empty="No anniversaries coming up."
        />
        <MiniList
          title="Birthdays"
          rows={birthdays}
          empty="No birthdays coming up."
        />
      </li>
    </>
  );
}
