import { memo, useMemo, useState } from 'react';
import { SettingsRow } from '../../components/ui/SettingsRow.jsx';
import { UiButton, UiIconButton } from '../../components/ui/UiButton.jsx';
import { safeUrl } from '../../lib/text.js';

export function ProfileCompleteness({ percent, done, total, missing }) {
  const isComplete = missing.length === 0;

  return (
    <>
      <div className="pc-row">
        <span>Profile {percent}% complete</span>
        <span className="pc-count">{done}/{total}</span>
      </div>
      <div
        className="pc-bar"
        role="progressbar"
        aria-label="Profile completeness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
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

const SETTINGS_PREVIEW_TABS = [
  ['Account', 'ph-user-circle'],
  ['Billing', 'ph-currency-circle-dollar'],
  ['Appearance', 'ph-palette'],
  ['Performance', 'ph-gauge'],
  ['Notifications', 'ph-bell'],
  ['Help', 'ph-question'],
];

const SETTINGS_PREVIEW_GROUPS = [
  {
    label: 'Preferences',
    rows: [
      { icon: 'ph-moon-stars', label: 'Theme', value: 'System' },
      { icon: 'ph-text-aa', label: 'Text size', value: 'Comfortable' },
      { icon: 'ph-sparkle', label: 'Room AI', value: 'Shown', toggle: true },
    ],
  },
  {
    label: 'Workspace',
    rows: [
      { icon: 'ph-sidebar-simple', label: 'Layout', value: 'Balanced' },
      { icon: 'ph-bell', label: 'Notifications', value: 'Mentions only' },
    ],
  },
];

export function SettingsShellPreview({
  initialTab = 'Appearance',
  mobile = false,
  plan = 'Free',
  reducedMotion = false,
  state = 'ready',
  theme = 'light',
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [roomAiVisible, setRoomAiVisible] = useState(true);
  const shellClassName = [
    'settings-shell-v3',
    'brutalist-settings',
    'settings-story-shell',
    mobile ? 'is-mobile' : '',
    theme === 'dark' ? 'is-dark' : '',
    reducedMotion ? 'is-reduced-motion' : '',
  ].filter(Boolean).join(' ');

  return (
    <section id="settings-modal" className={shellClassName} aria-label="Settings preview">
      <UiIconButton id="close-settings-btn" className="brutalist-close" label="Close settings" variant="inherit">
        <i className="ph-bold ph-x" aria-hidden="true" />
      </UiIconButton>
      <div className="settings-sidebar">
        <div className="settings-sidebar-head">
          <strong>Settings</strong>
        </div>
        <div className="settings-tablist" role="tablist" aria-label="Settings sections">
          {SETTINGS_PREVIEW_TABS.map(([label, icon]) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={activeTab === label}
              className={`settings-tab${activeTab === label ? ' active' : ''}`}
              onClick={() => setActiveTab(label)}
            >
              <i className={`ph-bold ${icon}`} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="settings-content">
        <div className="settings-pane active">
          <header className="settings-pane-header">
            <h2>{activeTab}</h2>
            <p>Manage the preferences that shape your Minimalist workspace.</p>
            {plan === 'Pro' ? <span className="settings-story-plan"><i className="ph-bold ph-sparkle" aria-hidden="true" /> Pro</span> : null}
          </header>

          {state === 'loading' ? (
            <div className="settings-story-state" role="status">
              <i className="ph-bold ph-spinner-gap" aria-hidden="true" />
              <strong>Loading settings</strong>
              <span>Your preferences are being prepared.</span>
            </div>
          ) : null}

          {state === 'error' ? (
            <div className="settings-story-state is-error" role="alert">
              <i className="ph-bold ph-warning-circle" aria-hidden="true" />
              <strong>Settings could not be loaded</strong>
              <span>Check your connection and try again.</span>
              <UiButton variant="danger">Try again</UiButton>
            </div>
          ) : null}

          {state === 'empty' ? (
            <div className="settings-story-state">
              <i className="ph-bold ph-sliders-horizontal" aria-hidden="true" />
              <strong>No custom preferences yet</strong>
              <span>Defaults are active for this device.</span>
            </div>
          ) : null}

          {state === 'ready' ? (
            <>
              {SETTINGS_PREVIEW_GROUPS.map((group) => (
                <section className="settings-story-group" aria-labelledby={`settings-story-${group.label}`} key={group.label}>
                  <h3 id={`settings-story-${group.label}`}>{group.label}</h3>
                  <div className="settings-story-row-group">
                    {group.rows.map((row) => (
                      <SettingsRow
                        as="button"
                        className="settings-story-row"
                        description={row.toggle ? (roomAiVisible ? 'Shown on this device' : 'Hidden on this device') : row.value}
                        key={row.label}
                        leading={<i className={`ph-bold ${row.icon}`} aria-hidden="true" />}
                        title={row.label}
                        trailing={row.toggle ? (
                          <span className="settings-story-switch" aria-hidden="true"><i /></span>
                        ) : (
                          <i className="ph-bold ph-caret-right" aria-hidden="true" />
                        )}
                        {...(row.toggle ? {
                          role: 'switch',
                          'aria-checked': roomAiVisible,
                          onClick: () => setRoomAiVisible((visible) => !visible),
                        } : {})}
                      />
                    ))}
                  </div>
                </section>
              ))}
              <section className="settings-story-danger" aria-labelledby="settings-story-danger-title">
                <div>
                  <i className="ph-bold ph-trash" aria-hidden="true" />
                  <span><strong id="settings-story-danger-title">Delete account</strong><small>This action is permanent.</small></span>
                </div>
                <UiButton variant="danger">Delete</UiButton>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </section>
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
