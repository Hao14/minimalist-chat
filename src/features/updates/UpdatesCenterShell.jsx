import './updatesCenter.css';

const UPDATE_SECTIONS = [
  { id: 'tab-notifications', panelId: 'notifications-list', label: 'Activity', icon: 'ph-bell' },
  { id: 'tab-quests', panelId: 'quests-list', label: 'Quests', icon: 'ph-target' },
  { id: 'tab-leaderboard', panelId: 'leaderboard-list', label: 'Ranks', icon: 'ph-trophy' },
  { id: 'tab-recognition', panelId: 'recognition-list', label: 'Kudos', icon: 'ph-hands-clapping' },
  { id: 'tab-changelog', panelId: 'updates-list', label: "What's new", icon: 'ph-sparkle' },
];

function UpdateSectionTab({ icon, id, isActive, label, panelId }) {
  return (
    <button
      className={`update-tab${isActive ? ' active' : ''}`}
      id={id}
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-controls={panelId}
      tabIndex={isActive ? 0 : -1}
    >
      <i className={`ph-bold ${icon}`} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function UpdatePanelHost({ children = null, className = '', id, labelledBy }) {
  return (
    <ul
      id={id}
      className={`updates-center-list hidden${className ? ` ${className}` : ''}`}
      role="tabpanel"
      aria-labelledby={labelledBy}
      aria-hidden="true"
    >
      {children}
    </ul>
  );
}

export function UpdatesCenterShell() {
  return (
    <aside
      id="updates-panel"
      className="updates-center"
      role="complementary"
      aria-labelledby="updates-panel-heading"
      aria-describedby="updates-panel-status"
      aria-hidden="true"
    >
      <header className="updates-center-header">
        <div className="updates-center-titlebar">
          <div className="updates-center-heading">
            <h2 id="updates-panel-heading">Updates</h2>
            <p id="updates-panel-status" className="updates-center-status" data-state="loading" aria-live="polite">
              <span className="updates-center-status-dot" aria-hidden="true" />
              <span className="updates-center-status-copy">Live · Checking activity</span>
            </p>
          </div>
          <button
            className="close-panel updates-center-close"
            id="close-updates-btn"
            type="button"
            aria-label="Close updates"
          >
            <i className="ph-bold ph-x" aria-hidden="true" />
          </button>
        </div>

        <div className="update-tabs" role="tablist" aria-label="Updates sections">
          {UPDATE_SECTIONS.map((section, index) => (
            <UpdateSectionTab key={section.id} {...section} isActive={index === 0} />
          ))}
        </div>
      </header>

      <ul
        id="notifications-list"
        className="updates-center-list notifications-center-list"
        role="tabpanel"
        aria-labelledby="tab-notifications"
        aria-hidden="false"
        aria-busy="true"
      >
        <li className="activity-state activity-state-loading" role="status">
          <span className="activity-state-icon" aria-hidden="true">
            <i className="ph-bold ph-bell" />
          </span>
          <strong>Checking activity</strong>
          <p>Your latest updates will appear here.</p>
        </li>
      </ul>

      <UpdatePanelHost id="quests-list" labelledBy="tab-quests" className="quest-board-host">
        <li className="activity-state activity-state-loading" role="status">
          <span className="activity-state-icon" aria-hidden="true">
            <i className="ph-bold ph-target" />
          </span>
          <strong>Preparing quests</strong>
          <p>Your daily and weekly progress will appear here.</p>
        </li>
      </UpdatePanelHost>
      <UpdatePanelHost id="leaderboard-list" labelledBy="tab-leaderboard" />
      <UpdatePanelHost id="recognition-list" labelledBy="tab-recognition" />
      <UpdatePanelHost id="updates-list" labelledBy="tab-changelog" />
    </aside>
  );
}
