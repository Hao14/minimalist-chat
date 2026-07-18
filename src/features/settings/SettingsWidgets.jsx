import { memo, useMemo } from 'react';
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

function fallbackAvatarFor(user = {}) {
  if (typeof window !== 'undefined' && window.getAvatarUrl) {
    return window.getAvatarUrl(user.displayName || user.email || 'You', '');
  }

  return '';
}

function ProfileCardPreviewBase({
  user = {},
  avatar,
  bannerStyle,
  reputation,
  variant = 'full',
  onCopyLink,
  onEdit,
  onOpenFullProfile,
}) {
  const links = useMemo(() => (Array.isArray(user.links) ? user.links : []), [user.links]);
  const badges = useMemo(() => Object.keys(user.badges || {})
    .map((id) => ({ id, ...(window.BADGE_DEFS?.[id] || {}) }))
    .filter((badge) => badge.label), [user.badges]);
  const skills = useMemo(() => skillEntries(user), [user]);
  const featuredSkills = useMemo(() => skills
    .filter((skill) => skill.level > 0 || skill.progress > 0)
    .sort((a, b) => ((b.level * 100) + b.progress) - ((a.level * 100) + a.progress))
    .slice(0, 3), [skills]);
  const displayName = user.displayName || user.email?.split('@')[0] || 'You';
  const statusText = user.status || 'Available';
  const avatarSrc = avatar || fallbackAvatarFor(user);
  const uid = user.uid || user.id;
  const publicLinkReady = Boolean(uid && (onCopyLink || window.profileShareLink));
  const profileStats = [
    { label: 'Rep', value: reputation || 0, icon: 'ph-trophy' },
    { label: 'Badges', value: badges.length, icon: 'ph-medal' },
    { label: 'Skills', value: featuredSkills.length || skills.length, icon: 'ph-sparkle' },
    { label: 'Links', value: links.length, icon: 'ph-link-simple' },
  ];

  const copyProfileLink = async () => {
    if (onCopyLink) {
      await onCopyLink(user);
      return;
    }
    if (!publicLinkReady) {
      window.showToast?.('Profile link is not ready yet.', true);
      return;
    }

    try {
      await navigator.clipboard?.writeText(window.profileShareLink(uid));
      window.showToast?.('Profile link copied.', false);
    } catch {
      window.showToast?.('Could not copy the profile link.', true);
    }
  };

  const openPublicCard = () => {
    if (onOpenFullProfile) {
      onOpenFullProfile(user);
      return;
    }
    if (!uid || !window.viewUserProfile) {
      window.showToast?.('Profile card is not ready yet.', true);
      return;
    }
    window.viewUserProfile(uid);
  };

  return (
    <article
      className={`scp-card profile-card-premium profile-card-redesign${variant === 'settings' ? ' profile-card-settings-preview' : ''}`}
      aria-label={`${displayName}'s profile card`}
    >
      <div className="scp-banner" style={bannerStyle}>
        <div className="profile-card-orbit" aria-hidden="true" />
        <div className="profile-card-banner-meta">
          <span className="profile-card-label">Public card</span>
          <span className="profile-card-status-pill">
            <span className="profile-status-dot" aria-hidden="true" />
            {statusText}
          </span>
        </div>
        <img
          className="scp-avatar"
          src={avatarSrc}
          alt=""
          loading="eager"
          decoding="async"
          width="96"
          height="96"
          onError={(event) => {
            event.currentTarget.src = fallbackAvatarFor(user);
          }}
        />
      </div>
      <div className="scp-body">
        <div className="profile-card-identity">
          <div className="scp-name-row">
            <span className="profile-display-name">{displayName}</span>
            {user.pronouns ? <span className="profile-pronouns">{user.pronouns}</span> : null}
            {user.flair ? <span className="profile-flair">{user.flair}</span> : null}
          </div>
          <span className="profile-short-id">#{user.shortId || 'private'}</span>
        </div>

        <div className="profile-card-stats" aria-label="Profile stats">
          {profileStats.map((stat) => (
            <span className="profile-card-stat" key={stat.label}>
              <i className={`ph-bold ${stat.icon}`} aria-hidden="true" />
              <strong>{stat.value}</strong>
              <small>{stat.label}</small>
            </span>
          ))}
        </div>

        <div className="profile-bio">{user.bio || 'No bio yet.'}</div>

        {featuredSkills.length ? (
          <div className="profile-card-featured-skills" aria-label="Top skills">
            {featuredSkills.map((skill) => (
              <span className="profile-card-skill" style={{ '--skill-color': skill.color }} key={skill.key}>
                <i className={`ph-bold ${skill.icon}`} aria-hidden="true" />
                {skill.label}
                <small>Lv {skill.level}</small>
              </span>
            ))}
          </div>
        ) : null}

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
        <div className="profile-card-actions" aria-label="Profile actions">
          <button type="button" onClick={copyProfileLink} disabled={!publicLinkReady}>
            <i className="ph-bold ph-link-simple" aria-hidden="true" /> Copy link
          </button>
          <button type="button" onClick={openPublicCard} disabled={!uid || (!onOpenFullProfile && !window.viewUserProfile)}>
            <i className="ph-bold ph-identification-card" aria-hidden="true" /> View full profile
          </button>
          <button type="button" onClick={() => (onEdit ? onEdit(user) : document.getElementById('toggle-edit-btn')?.click())}>
            <i className="ph-bold ph-pencil-simple" aria-hidden="true" /> Edit
          </button>
        </div>
        {variant !== 'settings' ? (
          <>
            <div className="profile-section-label">Skill Trees</div>
            <div className="skilltree">
              {skills.map((skill) => (
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
          </>
        ) : null}
      </div>
    </article>
  );
}

export const ProfileCardPreview = memo(ProfileCardPreviewBase);
