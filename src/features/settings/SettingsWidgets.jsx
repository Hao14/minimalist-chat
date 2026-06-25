import { safeUrl } from '../../lib/text.js';

export function ProfileCompleteness({ percent, done, total, missing }) {
  const isComplete = missing.length === 0;

  return (
    <>
      <div className="pc-row">
        <span>Profile {percent}% complete</span>
        <span className="pc-count">{done}/{total}</span>
      </div>
      <div className="pc-bar" aria-label={`Profile ${percent}% complete`}>
        <div className="pc-fill" style={{ width: `${percent}%` }} />
      </div>
      {isComplete ? (
        <div className="pc-missing pc-done">All set!</div>
      ) : (
        <div className="pc-missing">Add: {missing.join(', ')}</div>
      )}
    </>
  );
}

const skillEntries = (user = {}) => Object.entries(window.SKILL_DEFS || {}).map(([key, meta]) => {
  const xp = user.xp?.[key] || 0;
  return {
    key,
    ...meta,
    level: Math.floor(xp / 100),
    progress: xp % 100,
  };
});

export function ProfileCardPreview({ user, avatar, bannerStyle, reputation }) {
  const links = Array.isArray(user.links) ? user.links : [];
  const badges = Object.keys(user.badges || {})
    .map((id) => ({ id, ...(window.BADGE_DEFS?.[id] || {}) }))
    .filter((badge) => badge.label);

  return (
    <div className="scp-card">
      <div className="scp-banner" style={bannerStyle}>
        <img className="scp-avatar" src={avatar} alt="" />
      </div>
      <div className="scp-body">
        <div className="scp-name-row">
          <span className="profile-display-name">{user.displayName || 'You'}</span>
          {user.pronouns ? <span className="profile-pronouns">{user.pronouns}</span> : null}
          {user.flair ? <span className="profile-flair">{user.flair}</span> : null}
        </div>
        <div><span className="profile-short-id">#{user.shortId || ''}</span></div>
        {user.status ? <div className="profile-status">{user.status}</div> : null}
        <div className="profile-bio">{user.bio || 'No bio yet.'}</div>
        {links.length ? (
          <div className="profile-links">
            {links.map((link, index) => (
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
          </div>
        ) : null}
        <div className="profile-section-label">Skill Trees</div>
        <div className="skilltree">
          {skillEntries(user).map((skill) => (
            <div className="st-row" key={skill.key}>
              <span className="st-ico" style={{ color: skill.color }}>
                <i className={`ph-bold ${skill.icon}`} />
              </span>
              <span className="st-name">{skill.label}</span>
              <span className="st-lv">Lv {skill.level}</span>
              <div className="st-bar">
                <div className="st-fill" style={{ width: `${skill.progress}%`, background: skill.color }} />
              </div>
            </div>
          ))}
        </div>
        {badges.length ? (
          <div className="profile-badges">
            {badges.map((badge) => (
              <span className="earned-badge" title={badge.label} style={{ '--badge-color': badge.color }} key={badge.id}>
                <i className={`ph-bold ${badge.icon}`} /> {badge.label}
              </span>
            ))}
          </div>
        ) : null}
        <div className="profile-rep"><i className="ph-bold ph-trophy" /> {reputation || 0} reputation</div>
      </div>
    </div>
  );
}
