import {
  ROOM_PERMISSION_CATEGORIES,
  ROOM_PERMISSION_DEFAULTS,
  ROOM_PERMISSION_REGISTRY,
  permissionSummary,
} from './roomPermissions.js';

const DEFAULT_SUMMARY = permissionSummary(ROOM_PERMISSION_DEFAULTS);

function PermissionOption({ permission, canEdit }) {
  const descriptionId = `${permission.inputId}-description`;

  return (
    <label className="permission-option" htmlFor={permission.inputId}>
      <span className="permission-option-icon" aria-hidden="true">
        <i className={`ph-bold ${permission.icon}`} />
      </span>
      <span className="permission-option-copy">
        <strong>{permission.label}</strong>
        <small id={descriptionId}>{permission.description}</small>
      </span>
      <span className="permission-toggle">
        <input
          type="checkbox"
          id={permission.inputId}
          data-permission-key={permission.key}
          defaultChecked={permission.defaultValue}
          disabled={!canEdit}
          aria-describedby={descriptionId}
        />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}

export function RoomPermissionsPanel({ canEdit = true }) {
  return (
    <section className="room-permissions-panel" aria-labelledby="room-permissions-title">
      <header className="permissions-pane-header">
        <div className="permissions-pane-copy">
          <h2 id="room-permissions-title">Permissions</h2>
          <p>Choose what members can do by default.</p>
        </div>

        <div className="permissions-summary-strip" role="group" aria-label="Permission summary">
          <div className="permissions-summary-item is-allowed">
            <i className="ph-bold ph-check" aria-hidden="true" />
            <span>
              <strong id="rs-permissions-allowed-count">{DEFAULT_SUMMARY.allowed}</strong>
              <small>Allowed by default</small>
            </span>
          </div>
          <div className="permissions-summary-item is-restricted">
            <i className="ph-bold ph-minus" aria-hidden="true" />
            <span>
              <strong id="rs-permissions-restricted-count">{DEFAULT_SUMMARY.restricted}</strong>
              <small>Restricted by default</small>
            </span>
          </div>
          <div className="permissions-summary-item is-overrides">
            <i className="ph-bold ph-user" aria-hidden="true" />
            <span>
              <strong id="rs-permissions-overrides-count">0</strong>
              <small>Member overrides</small>
            </span>
          </div>
        </div>
      </header>

      <div className="permissions-default-matrix">
        {ROOM_PERMISSION_CATEGORIES.map((category) => (
          <section
            className={`permission-category permission-category-${category.id}`}
            key={category.id}
            aria-labelledby={`permission-category-${category.id}`}
          >
            <header className="permission-category-head">
              <span className="permission-category-icon" aria-hidden="true">
                <i className={`ph-bold ${category.icon}`} />
              </span>
              <div>
                <h3 id={`permission-category-${category.id}`}>{category.label}</h3>
                <p>{category.description}</p>
              </div>
            </header>
            <div className="permission-grid permission-category-grid">
              {category.keys.map((key) => (
                <PermissionOption
                  key={key}
                  permission={ROOM_PERMISSION_REGISTRY[key]}
                  canEdit={canEdit}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="member-permissions-card permissions-overrides-card">
        <div className="member-permissions-head">
          <div>
            <h3>Member exceptions</h3>
            <p className="member-permissions-copy">
              Override room defaults for specific members.
            </p>
          </div>
          <label className="member-permission-search" htmlFor="rs-member-permission-search">
            <span className="sr-only">Find a member</span>
            <span className="member-permission-search-field">
              <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
              <input
                id="rs-member-permission-search"
                type="search"
                placeholder="Search members"
                autoComplete="off"
                aria-controls="rs-member-permissions-list"
              />
            </span>
          </label>
        </div>

        <div id="rs-permissions-owner-note" className="permissions-owner-note">
          <i className="ph-bold ph-lock-key" aria-hidden="true" />
          <span>The room owner always keeps full access. These settings apply to other members.</span>
        </div>

        <div
          id="rs-member-permissions-list"
          className="member-permissions-list member-permissions-compact-list"
          aria-label="Member permission exceptions"
        />
      </section>

      <footer className="permissions-actions">
        <button
          id="rs-reset-permissions-btn"
          className="mini-btn permissions-reset-btn"
          type="button"
          disabled={!canEdit}
        >
          <i className="ph-bold ph-arrow-counter-clockwise" aria-hidden="true" />
          Reset defaults
        </button>
        <p id="rs-permissions-save-status" className="permissions-save-status" role="status" aria-live="polite">
          Changes apply after you save.
        </p>
        <button
          id="rs-save-permissions-btn"
          className="action-btn permissions-save-btn"
          type="button"
          disabled={!canEdit}
        >
          Save permissions
        </button>
      </footer>
    </section>
  );
}

export default RoomPermissionsPanel;
