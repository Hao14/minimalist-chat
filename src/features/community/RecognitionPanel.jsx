import { useState } from 'react';
import { getKudosMilestone, getKudosSuggestions } from './communityPresentation.js';

const KUDOS_BUTTON_STATES = {
  already: { disabled: true, icon: 'ph-check', label: 'Already sent' },
  error: { disabled: false, icon: 'ph-arrow-clockwise', label: 'Try again' },
  idle: { disabled: false, icon: 'ph-hands-clapping', label: 'Give kudos' },
  sending: { disabled: true, icon: 'ph-spinner-gap', label: 'Sending' },
  sent: { disabled: true, icon: 'ph-check-circle', label: 'Sent' },
};

function avatarFor(row) {
  return window.getAvatarUrl?.(row?.name, row?.photo) || '';
}

function KudosState({ error = '', onRetry, status }) {
  const isError = status === 'error';
  return (
    <li className={`kudos-v2-state${isError ? ' is-error' : ''}`} role={isError ? 'alert' : 'status'}>
      <span className="kudos-v2-state-icon" aria-hidden="true">
        <i className={`ph-bold ${isError ? 'ph-cloud-slash' : 'ph-spinner-gap'}`} />
      </span>
      <strong>{isError ? "Couldn't open Kudos" : 'Gathering your community'}</strong>
      <p>{isError ? error || 'Kudos is temporarily unavailable.' : 'Finding the people you can thank.'}</p>
      {isError ? (
        <button className="kudos-v2-retry" onClick={onRetry} type="button" aria-label="Retry Kudos">
          <i className="ph-bold ph-arrow-clockwise" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

function KudosHero({ kudosCount }) {
  const milestone = getKudosMilestone(kudosCount);
  const milestoneCopy = milestone.reached
    ? 'You reached the 25-kudos community milestone.'
    : `${milestone.remaining} more to unlock the ${milestone.label}.`;

  return (
    <li className="kudos-v2-hero">
      <div className="kudos-v2-hero-copy">
        <span className="kudos-v2-eyebrow"><i className="ph-bold ph-sparkle" aria-hidden="true" /> Community kindness</span>
        <h3>Make someone&apos;s day.</h3>
        <p>Send a quick thank-you to the people who make conversations better.</p>
      </div>
      <div className="kudos-v2-received">
        <span className="kudos-v2-received-icon" aria-hidden="true"><i className="ph-bold ph-hands-clapping" /></span>
        <span>
          <strong>{milestone.count.toLocaleString()}</strong>
          <small>Kudos received</small>
        </span>
      </div>
      <div className="kudos-v2-milestone">
        <div>
          <span>{milestone.label}</span>
          <strong>{milestone.reached ? 'Reached' : `${milestone.count} / ${milestone.target}`}</strong>
        </div>
        <div
          className="kudos-v2-progress"
          role="progressbar"
          aria-label={milestone.label}
          aria-valuemin="0"
          aria-valuemax={milestone.target}
          aria-valuenow={Math.min(milestone.count, milestone.target)}
        >
          <span style={{ '--kudos-progress': `${milestone.progress}%` }} />
        </div>
        <p>{milestoneCopy}</p>
      </div>
    </li>
  );
}

function MemberIdentity({ member, onOpenProfile }) {
  return (
    <button className="kudos-v2-member-main" onClick={() => onOpenProfile?.(member)} type="button">
      <img src={avatarFor(member)} alt="" />
      <span>
        <strong>{member.name}</strong>
        <small>{member.handle ? `@${member.handle}` : 'View profile'}</small>
      </span>
    </button>
  );
}

function KudosAction({ member, onGive, state = 'idle' }) {
  const config = KUDOS_BUTTON_STATES[state] || KUDOS_BUTTON_STATES.idle;
  return (
    <button
      aria-busy={state === 'sending'}
      aria-label={`${config.label} ${member.name}`}
      className={`kudos-v2-give is-${state}`}
      disabled={config.disabled}
      onClick={() => onGive(member)}
      type="button"
    >
      <i className={`ph-bold ${config.icon}`} aria-hidden="true" />
      <span aria-live="polite">{config.label}</span>
    </button>
  );
}

function KudosPicker({ currentUid, members, onGiveKudos, onOpenProfile, preferredUid, sentUids }) {
  const [query, setQuery] = useState('');
  const [sendStates, setSendStates] = useState({});
  const suggestions = getKudosSuggestions({
    currentUid,
    limit: query.trim() ? 12 : 6,
    members,
    preferredUid,
    query,
  });
  const sentUidSet = new Set(sentUids);
  const eligibleCount = new Set(
    members.flatMap((member) => member?.uid && member.uid !== currentUid ? [member.uid] : []),
  ).size;

  async function give(member) {
    const activeState = sendStates[member.uid];
    if (activeState === 'sending' || activeState === 'sent' || activeState === 'already') return;

    setSendStates((current) => ({ ...current, [member.uid]: 'sending' }));
    try {
      const result = await onGiveKudos?.(member.uid);
      if (result?.ok) {
        setSendStates((current) => ({ ...current, [member.uid]: 'sent' }));
        window.showToast?.(`Kudos sent to ${member.name}.`, false);
        return;
      }
      if (result?.reason === 'already') {
        setSendStates((current) => ({ ...current, [member.uid]: 'already' }));
        window.showToast?.(`You already gave ${member.name} kudos.`, false);
        return;
      }
      throw new Error(result?.reason || 'Kudos could not be sent.');
    } catch (error) {
      console.warn('Kudos could not be sent.', error);
      setSendStates((current) => ({ ...current, [member.uid]: 'error' }));
      window.showToast?.('Kudos could not be sent. Please try again.', true);
    }
  }

  return (
    <li className="kudos-v2-picker">
      <header className="kudos-v2-section-heading">
        <span>
          <strong>Send kudos</strong>
          <small>One sincere thank-you per person.</small>
        </span>
        <em>{eligibleCount} {eligibleCount === 1 ? 'person' : 'people'}</em>
      </header>

      <label className="kudos-v2-search">
        <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
        <span className="updates-visually-hidden">Search members</span>
        <input
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people"
          type="search"
          value={query}
        />
      </label>

      {suggestions.length > 0 ? (
        <ul className="kudos-v2-member-list" aria-label="Members who can receive kudos">
          {suggestions.map((member) => (
            <li key={member.uid}>
              <MemberIdentity member={member} onOpenProfile={onOpenProfile} />
              <KudosAction member={member} onGive={give} state={sendStates[member.uid] || (sentUidSet.has(member.uid) ? 'already' : 'idle')} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="kudos-v2-no-results" role="status">
          <i className="ph-bold ph-user-focus" aria-hidden="true" />
          <strong>{query.trim() ? 'No matching members' : 'No one to thank yet'}</strong>
          <p>{query.trim() ? 'Try another name or handle.' : 'New community members will appear here.'}</p>
        </div>
      )}

      {!query.trim() && eligibleCount > suggestions.length ? (
        <p className="kudos-v2-picker-hint"><i className="ph-bold ph-info" aria-hidden="true" /> Search to find more people.</p>
      ) : null}
    </li>
  );
}

function CelebrationList({ empty, icon, rows, title, tone }) {
  return (
    <section className="kudos-v2-moment" style={{ '--moment-tone': tone }}>
      <header>
        <span className="kudos-v2-moment-icon" aria-hidden="true"><i className={`ph-bold ${icon}`} /></span>
        <span><strong>{title}</strong><small>{rows.length > 0 ? `${rows.length} coming up` : 'Nothing soon'}</small></span>
      </header>
      {rows.length > 0 ? (
        <ul>
          {rows.slice(0, 3).map((row) => (
            <li key={row.uid}>
              <img src={avatarFor(row)} alt="" />
              <span><strong>{row.name}</strong><small>{row.meta}</small></span>
            </li>
          ))}
        </ul>
      ) : <p>{empty}</p>}
    </section>
  );
}

function CommunityMoments({ anniversaries, birthdays }) {
  if (anniversaries.length === 0 && birthdays.length === 0) return null;

  return (
    <li className="kudos-v2-moments">
      <header className="kudos-v2-section-heading">
        <span><strong>Community moments</strong><small>More reasons to celebrate each other.</small></span>
      </header>
      <div className="kudos-v2-moment-grid">
        <CelebrationList empty="Shared anniversaries will appear here." icon="ph-confetti" rows={anniversaries} title="Anniversaries" tone="#8b5cf6" />
        <CelebrationList empty="Shared birthdays will appear here." icon="ph-cake" rows={birthdays} title="Birthdays" tone="#ec4899" />
      </div>
    </li>
  );
}

function KudosGuide() {
  const guide = [
    { copy: 'Thank each member once', icon: 'ph-heart', tone: '#ec4899' },
    { copy: 'Earn 5 Support XP', icon: 'ph-hand-heart', tone: '#10b981' },
    { copy: 'Unlock badges at 5 and 25', icon: 'ph-medal', tone: '#8b5cf6' },
  ];
  return (
    <li className="kudos-v2-guide" aria-label="How kudos works">
      {guide.map((item) => (
        <span key={item.copy} style={{ '--guide-tone': item.tone }}>
          <i className={`ph-bold ${item.icon}`} aria-hidden="true" />
          <small>{item.copy}</small>
        </span>
      ))}
    </li>
  );
}

export default function RecognitionPanel({
  anniversaries = [],
  birthdays = [],
  currentUid = '',
  error = '',
  kudosCount = 0,
  members = [],
  onGiveKudos,
  onOpenProfile,
  onRetry,
  preferredUid = '',
  sentUids = [],
  status = 'ready',
}) {
  if (status === 'loading') return <KudosState status="loading" />;
  if (status === 'error') return <KudosState error={error} onRetry={onRetry} status="error" />;

  return (
    <>
      <KudosHero kudosCount={kudosCount} />
      <KudosPicker
        currentUid={currentUid}
        members={members}
        onGiveKudos={onGiveKudos}
        onOpenProfile={onOpenProfile}
        preferredUid={preferredUid}
        sentUids={sentUids}
      />
      <KudosGuide />
      <CommunityMoments anniversaries={anniversaries} birthdays={birthdays} />
    </>
  );
}
