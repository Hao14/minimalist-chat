import { useState } from 'react';
import { safeUrl } from '../../lib/text.js';

export function ProfileNameLine({ name, tier }) {
  const normalized = String(tier || '').toLowerCase();
  const badge = normalized.includes('pro')
    ? { label: 'PRO', className: 'pro' }
    : normalized.includes('advanced')
      ? { label: 'ADVANCED', className: 'advanced' }
      : null;

  return (
    <>
      {name || 'Anonymous'} {badge ? <span className={`tier-badge ${badge.className}`}>{badge.label}</span> : null}
    </>
  );
}

export function ProfileLinks({ links }) {
  const items = Array.isArray(links) ? links : [];
  return (
    <>
      {items.map((link, index) => (
        <a
          className="profile-link"
          href={safeUrl(link.url)}
          target="_blank"
          rel="noopener noreferrer"
          key={`${link.url}-${index}`}
        >
          {link.label || link.url}
        </a>
      ))}
    </>
  );
}

export function ProfileSkills({ skills, targetUid, isSelf, onEndorse }) {
  const [entries, setEntries] = useState(() => Object.entries(skills || {}).map(([key, skill]) => ({
    key,
    name: skill?.name || key,
    count: skill?.count || 0,
    endorsed: false,
  })));

  if (!entries.length) return null;

  return entries.map((skill) => (
    <span className="skill-chip" key={skill.key}>
      <span className="skill-name">{skill.name}</span>
      <button
        className="skill-endorse"
        type="button"
        data-skill={skill.key}
        title={isSelf ? 'You cannot endorse yourself' : 'Endorse'}
        disabled={isSelf || skill.endorsed}
        onClick={async () => {
          if (isSelf || skill.endorsed) return;
          const result = await onEndorse(targetUid, skill.key);
          if (result?.ok) {
            setEntries((current) => current.map((entry) => (
              entry.key === skill.key ? { ...entry, count: result.count, endorsed: true } : entry
            )));
            return;
          }
          if (result?.reason === 'already') {
            setEntries((current) => current.map((entry) => (
              entry.key === skill.key ? { ...entry, endorsed: true } : entry
            )));
          }
        }}
      >
        +{skill.count}
      </button>
    </span>
  ));
}

export function ProfileSkillTree({ user }) {
  const xp = user?.xp || {};
  return (
    <div className="skilltree">
      {Object.entries(window.SKILL_DEFS || {}).map(([key, meta]) => {
        const amount = xp[key] || 0;
        const level = Math.floor(amount / 100);
        const progress = amount % 100;
        return (
          <div className="st-row" key={key}>
            <span className="st-ico" style={{ color: meta.color }}>
              <i className={`ph-bold ${meta.icon}`} />
            </span>
            <span className="st-name">{meta.label}</span>
            <span className="st-lv">Lv {level}</span>
            <div className="st-bar">
              <div className="st-fill" style={{ width: `${progress}%`, background: meta.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EarnedBadges({ badges }) {
  const items = Object.keys(badges || {})
    .map((id) => ({ id, ...(window.BADGE_DEFS?.[id] || {}) }))
    .filter((badge) => badge.label);

  return (
    <>
      {items.map((badge) => (
        <span className="earned-badge" title={badge.label} style={{ '--badge-color': badge.color }} key={badge.id}>
          <i className={`ph-bold ${badge.icon}`} /> {badge.label}
        </span>
      ))}
    </>
  );
}

export function Reputation({ value }) {
  return <><i className="ph-bold ph-trophy" /> {value || 0} reputation</>;
}

function heatLevel(count) {
  if (count <= 0) return 0;
  if (count < 3) return 1;
  if (count < 6) return 2;
  if (count < 12) return 3;
  return 4;
}

export function ActivityHeatmap({ activityByDay }) {
  const days = activityByDay || {};
  const weeks = 14;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - start.getDay());

  return (
    <div className="hm-grid">
      {Array.from({ length: weeks }).map((_, weekIndex) => (
        <div className="hm-col" key={weekIndex}>
          {Array.from({ length: 7 }).map((__, dayIndex) => {
            const day = new Date(start);
            day.setDate(start.getDate() + weekIndex * 7 + dayIndex);
            if (day > today) return <span className="hm-cell hm-empty" key={dayIndex} />;
            const key = day.toISOString().slice(0, 10);
            const count = days[key] || 0;
            return <span className={`hm-cell hm-l${heatLevel(count)}`} title={`${key}: ${count}`} key={dayIndex} />;
          })}
        </div>
      ))}
    </div>
  );
}

function relTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function activityEvents(user, limit = 6) {
  const events = [];
  Object.entries(user?.badges || {}).forEach(([id, timestamp]) => {
    const badge = window.BADGE_DEFS?.[id];
    if (badge && typeof timestamp === 'number') {
      events.push({ timestamp, icon: badge.icon, text: `Earned the “${badge.label}” badge` });
    }
  });
  Object.values(user?.kudosFrom || {}).forEach((timestamp) => {
    if (typeof timestamp === 'number') events.push({ timestamp, icon: 'ph-hand-heart', text: 'Received kudos' });
  });
  Object.entries(user?.activityByDay || {}).forEach(([date, count]) => {
    const timestamp = Date.parse(`${date}T12:00:00`);
    if (!Number.isNaN(timestamp)) events.push({ timestamp, icon: 'ph-chat-circle', text: `${count} message${count > 1 ? 's' : ''}` });
  });
  return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

export function ActivityFeed({ user }) {
  const events = activityEvents(user);
  if (!events.length) return <li className="act-empty">No activity yet.</li>;

  return events.map((event) => (
    <li className="act-item" key={`${event.timestamp}-${event.text}`}>
      <i className={`ph-bold ${event.icon}`} /> <span>{event.text}</span> <span className="act-time">{relTime(event.timestamp)}</span>
    </li>
  ));
}

export function MutualRooms({ rooms }) {
  if (!rooms?.length) return null;

  return (
    <>
      <i className="ph-bold ph-door-open" /> {rooms.length} mutual room{rooms.length > 1 ? 's' : ''}: {rooms.slice(0, 3).join(', ')}{rooms.length > 3 ? '…' : ''}
    </>
  );
}

export function SpotlightButton({ onClick, regenerate = false }) {
  return (
    <button id="up-spotlight-btn" className="ai-btn ai-btn-ghost" type="button" onClick={onClick}>
      <i className={`ph-bold ${regenerate ? 'ph-arrows-clockwise' : 'ph-sparkle'}`} /> {regenerate ? 'Regenerate' : 'AI Spotlight'}
    </button>
  );
}

export function ProfileSpotlight({ status = 'idle', text, error, onRetry }) {
  if (status === 'loading') {
    return (
      <div className="ai-progress">
        <div className="ai-spinner" />
        <span>Writing spotlight…</span>
      </div>
    );
  }

  if (status === 'error') {
    return <div className="ai-empty">{error || 'Spotlight unavailable.'}</div>;
  }

  if (status === 'ready') {
    return (
      <>
        <div className="profile-spotlight-text">✨ {text}</div>
        <SpotlightButton regenerate onClick={onRetry} />
      </>
    );
  }

  return <SpotlightButton onClick={onRetry} />;
}
