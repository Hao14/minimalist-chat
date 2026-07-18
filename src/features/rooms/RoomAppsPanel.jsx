import { useEffect, useState } from 'react';
import { getRoomBotCatalogEntry, ROOM_BOT_CATALOG } from '../bots/botCatalog.js';

const MARKET_CATEGORIES = Object.freeze(['all', ...new Set(ROOM_BOT_CATALOG.map((bot) => bot.category))]);
const EXECUTION_FILTERS = Object.freeze([
  ['all', 'All execution'],
  ['client-before-send', 'Before send'],
  ['client-after-send', 'After send'],
]);

const MARKET_SEARCH_INDEX = new Map(ROOM_BOT_CATALOG.map((bot) => [
  bot.id,
  [
    bot.name,
    bot.category,
    bot.summary,
    bot.executionLabel,
    bot.trustLabel,
    bot.trigger,
    bot.manifest.id,
    bot.manifest.publisher,
    ...bot.capabilities,
    ...bot.dataAccess,
    ...bot.networkAccess,
    ...bot.writes,
    ...bot.limitations,
  ].join(' ').toLocaleLowerCase(),
]));

const STOCK_BOT = getRoomBotCatalogEntry('stockTracker');
const AUTOMOD_BOT = getRoomBotCatalogEntry('autoModeration');

function StatusDot({ tone = 'neutral' }) {
  return <span className={`apps-status-dot is-${tone}`} aria-hidden="true" />;
}

function AppIcon({ icon, tone = 'yellow' }) {
  return (
    <span className={`apps-item-icon is-${tone}`} aria-hidden="true">
      <i className={`ph-bold ${icon}`} />
    </span>
  );
}

function PlatformTab({ id, panel, active = false, children }) {
  return (
    <button
      type="button"
      id={id}
      className={`apps-local-tab${active ? ' active' : ''}`}
      role="tab"
      aria-selected={active ? 'true' : 'false'}
      aria-controls={panel}
      tabIndex={active ? 0 : -1}
      data-rs-platform-tab={panel.replace('rs-platform-view-', '')}
    >
      {children}
    </button>
  );
}

function RuntimeBadges({ bot, compact = false }) {
  return (
    <div className={`apps-runtime-badges${compact ? ' is-compact' : ''}`} aria-label="Execution and trust model">
      <span className="apps-runtime-badge">
        <i className="ph-bold ph-device-mobile" aria-hidden="true" />
        {bot.executionLabel}
        <span aria-hidden="true">·</span>
        {bot.trustLabel}
      </span>
    </div>
  );
}

function InstalledRow({ bot }) {
  return (
    <article
      className="apps-list-row apps-installed-row"
      id={bot.installedRowId}
      data-installed-app={bot.domKey}
      data-app-manifest={bot.manifest.id}
    >
      <AppIcon icon={bot.icon} tone={bot.iconTone} />
      <div className="apps-list-primary">
        <div className="apps-list-title-line">
          <h4>{bot.name}</h4>
          <span className="apps-status" id={bot.statusId}>
            <StatusDot tone="neutral" />
            <span>Not installed</span>
          </span>
        </div>
        <p>{bot.summary}</p>
        <RuntimeBadges bot={bot} compact />
      </div>
      <div className="apps-list-detail">
        <strong>Trigger</strong>
        <span>{bot.trigger}</span>
      </div>
      <button type="button" className="apps-row-action" data-rs-open-detail={bot.detailKey}>
        Configure
      </button>
    </article>
  );
}

function DetailHeader({ title, description, headingId }) {
  return (
    <header className="apps-detail-header">
      <button type="button" className="apps-back-button" data-rs-close-detail aria-label="Back to apps and connections">
        <i className="ph-bold ph-arrow-left" aria-hidden="true" />
        <span>Back</span>
      </button>
      <div>
        <h3 id={headingId}>{title}</h3>
        <p>{description}</p>
      </div>
    </header>
  );
}

function ManifestList({ title, items }) {
  return (
    <div className="apps-access-column">
      <h5>{title}</h5>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

function BotManifest({ bot }) {
  return (
    <section className="apps-manifest-card" aria-labelledby={`apps-${bot.id}-manifest-title`}>
      <div className="apps-manifest-heading">
        <div>
          <span className="apps-developer-kicker">Technical details</span>
          <h4 id={`apps-${bot.id}-manifest-title`}>Runtime &amp; access</h4>
        </div>
        <span className="apps-manifest-state">Built in</span>
      </div>
      <dl className="apps-manifest-grid">
        <div><dt>Package</dt><dd><code>{bot.manifest.id}</code></dd></div>
        <div><dt>Publisher</dt><dd>{bot.manifest.publisher}</dd></div>
        <div><dt>Distribution</dt><dd>{bot.manifest.distribution}</dd></div>
        <div><dt>Configure</dt><dd><code>{bot.manifest.permission}</code></dd></div>
        <div><dt>Config path</dt><dd><code>{bot.manifest.configPath}</code></dd></div>
        <div><dt>Scope</dt><dd>{bot.manifest.scope}</dd></div>
      </dl>
      <div className="apps-trust-boundary">
        <strong>Trust boundary</strong>
        <p>{bot.trustDetails}</p>
      </div>
      <div className="apps-access-grid">
        <ManifestList title="Reads" items={bot.dataAccess} />
        <ManifestList title="Network" items={bot.networkAccess} />
        <ManifestList title="Writes" items={bot.writes} />
      </div>
      <details className="apps-limitations">
        <summary>Known limitations</summary>
        <ul>{bot.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      </details>
    </section>
  );
}

function BotRuntimeNotice({ bot }) {
  return (
    <div className="apps-truth-note apps-runtime-notice">
      <i className="ph-bold ph-warning-circle" aria-hidden="true" />
      <div>
        <strong>{bot.trustLabel}</strong>
        <p>{bot.trustDetails}</p>
      </div>
    </div>
  );
}

function MarketplaceRow({ bot, visible }) {
  return (
    <article
      className={`apps-market-card apps-market-row${visible ? '' : ' hidden'}`}
      data-market-app={bot.id}
      data-market-category={bot.category}
      data-market-execution={bot.executionMode}
      aria-hidden={visible ? 'false' : 'true'}
      hidden={!visible}
    >
      <div className="apps-market-identity">
        <AppIcon icon={bot.icon} tone={bot.iconTone} />
        <div>
          <div className="apps-market-title-line">
            <h4>{bot.name}</h4>
            <span className="apps-scope-label">{bot.category}</span>
          </div>
          <p>{bot.summary}</p>
          <RuntimeBadges bot={bot} compact />
        </div>
      </div>
      <div className="apps-market-action-cell">
        <span className="apps-install-state" id={bot.marketStatusId} data-state="not-installed">Not installed</span>
        <button
          type="button"
          id={bot.marketActionId}
          className="action-btn"
          data-rs-open-detail={bot.detailKey}
          aria-describedby={bot.marketStatusId}
        >
          {bot.installLabel}
        </button>
      </div>
      <details className="apps-market-disclosure">
        <summary>Technical details</summary>
        <div className="apps-market-footer">
          <dl className="apps-market-spec-grid">
            <div><dt>Trigger</dt><dd>{bot.trigger}</dd></div>
            <div><dt>Reads</dt><dd>{bot.dataAccess.join(' · ')}</dd></div>
            <div><dt>Network</dt><dd>{bot.networkAccess.join(' · ')}</dd></div>
            <div><dt>Writes</dt><dd>{bot.writes.join(' · ')}</dd></div>
          </dl>
          <div className="apps-market-package">
            <span>Package <code>{bot.manifest.id}</code></span>
            <span>Permission <code>{bot.manifest.permission}</code></span>
          </div>
        </div>
      </details>
    </article>
  );
}

function WebhookManifest() {
  return (
    <section className="apps-manifest-card" aria-labelledby="apps-webhook-manifest-title">
      <div className="apps-manifest-heading">
        <div><span className="apps-developer-kicker">Technical details</span><h4 id="apps-webhook-manifest-title">Delivery &amp; trust</h4></div>
        <span className="apps-manifest-state">Server delivered</span>
      </div>
      <dl className="apps-manifest-grid">
        <div><dt>Type</dt><dd><code>outgoing_webhook</code></dd></div>
        <div><dt>Runtime</dt><dd>Firebase message-create trigger</dd></div>
        <div><dt>Configure</dt><dd><code>manageConnections</code></dd></div>
        <div><dt>Scope</dt><dd>One room · one selected channel</dd></div>
        <div><dt>Trigger</dt><dd>New message in the selected channel</dd></div>
        <div><dt>Destination</dt><dd>HTTPS endpoint; redirects and private-network targets are rejected</dd></div>
      </dl>
      <div className="apps-trust-boundary">
        <strong>Outbound data</strong>
        <p>Each delivery contains room name, channel ID, author label, and a message summary. The endpoint is stored server-side and only a masked destination is published to room metadata. After delivery, the external service controls its copy.</p>
      </div>
    </section>
  );
}

export function RoomAppsPanel() {
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [execution, setExecution] = useState('all');

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const matchingBotIds = new Set(ROOM_BOT_CATALOG
    .filter((bot) => category === 'all' || bot.category === category)
    .filter((bot) => execution === 'all' || bot.executionMode === execution)
    .filter((bot) => !normalizedQuery || MARKET_SEARCH_INDEX.get(bot.id)?.includes(normalizedQuery))
    .map((bot) => bot.id));
  const filtersActive = Boolean(normalizedQuery || category !== 'all' || execution !== 'all');

  useEffect(() => {
    const observers = [];
    const Observer = window.MutationObserver;

    ROOM_BOT_CATALOG.forEach((bot) => {
      const action = document.getElementById(bot.marketActionId);
      const status = document.getElementById(bot.marketStatusId);
      if (!action || !status) return;

      const syncStatus = () => {
        const installed = action.textContent?.trim() === bot.configureLabel;
        status.textContent = installed ? 'Installed' : 'Not installed';
        status.dataset.state = installed ? 'installed' : 'not-installed';
      };
      syncStatus();
      if (typeof Observer === 'function') {
        const observer = new Observer(syncStatus);
        observer.observe(action, { childList: true, subtree: true, characterData: true });
        observers.push(observer);
      }
    });

    return () => observers.forEach((observer) => observer.disconnect());
  }, []);

  const resetMarketplaceFilters = () => {
    setSearchQuery('');
    setCategory('all');
    setExecution('all');
  };

  return (
    <div className="room-apps-manager" id="rs-apps-manager">
      <header className="apps-pane-header" data-rs-platform-main>
        <div className="apps-pane-copy">
          <h2>Apps &amp; connections</h2>
          <p>Add helpful tools, manage room connections, and see clearly where each one runs.</p>
        </div>
        <div className="apps-summary-strip" aria-label="Installed platform summary">
          <span><i className="ph-bold ph-robot" aria-hidden="true" /><strong id="rs-platform-bot-count">0</strong> apps</span>
          <span><i className="ph-bold ph-link" aria-hidden="true" /><strong id="rs-platform-connection-count">0</strong> connections</span>
        </div>
      </header>

      <div className="apps-local-tabs" role="tablist" aria-label="Apps and connections" data-rs-platform-main>
        <PlatformTab id="rs-platform-tab-installed" panel="rs-platform-view-installed" active>Installed</PlatformTab>
        <PlatformTab id="rs-platform-tab-marketplace" panel="rs-platform-view-marketplace">App catalog</PlatformTab>
        <PlatformTab id="rs-platform-tab-connections" panel="rs-platform-view-connections">Connections</PlatformTab>
      </div>

      <section
        id="rs-platform-view-installed"
        className="apps-local-view"
        role="tabpanel"
        aria-labelledby="rs-platform-tab-installed"
        data-rs-platform-main
      >
        <div className="apps-section-heading">
          <div><h3>Installed room apps</h3><p>Installation stores room configuration; execution still happens in each sender’s current client.</p></div>
          <span className="apps-count" id="rs-installed-count">0 installed</span>
        </div>
        <div className="apps-list" id="rs-installed-list">
          <InstalledRow bot={STOCK_BOT} />
          <InstalledRow bot={AUTOMOD_BOT} />
          <div className="apps-empty-state" id="rs-installed-empty">
            <i className="ph-bold ph-puzzle-piece" aria-hidden="true" />
            <div><strong>No room apps installed</strong><span>Open App catalog to inspect the two built-in client automations.</span></div>
            <button type="button" data-rs-platform-tab="marketplace">Browse app catalog</button>
          </div>
        </div>
        <div className="apps-scope-note">
          <i className="ph-bold ph-info" aria-hidden="true" />
          <p>Room apps are configured by the creator or members with <code>manageBots</code>. Both available apps are client-run and are not server-enforced background bots. Automation messages remain owned by the requesting user.</p>
        </div>
      </section>

      <section
        id="rs-platform-view-marketplace"
        className="apps-local-view hidden"
        role="tabpanel"
        aria-labelledby="rs-platform-tab-marketplace"
        aria-hidden="true"
        data-rs-platform-main
      >
        <div className="apps-section-heading">
          <div><h3>Built-in app catalog</h3><p id="rs-marketplace-runtime-note">Two real client automations are available. There is no third-party app runtime or server bot host.</p></div>
          <span className="apps-count" role="status" aria-live="polite">{matchingBotIds.size} of {ROOM_BOT_CATALOG.length}</span>
        </div>

        <div className="apps-market-toolbar" role="search" aria-label="Filter room app catalog">
          <label className="apps-market-search" htmlFor="rs-market-search">
            <span>Search apps</span>
            <span className="apps-market-input-wrap">
              <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
              <input
                type="search"
                id="rs-market-search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Name, trigger, data access…"
                autoComplete="off"
                aria-controls="rs-marketplace-results"
              />
            </span>
          </label>
          <details className="apps-filter-disclosure">
            <summary>
              <i className="ph-bold ph-sliders-horizontal" aria-hidden="true" />
              Filters
            </summary>
            <div className="apps-filter-fields">
              <label className="apps-market-filter" htmlFor="rs-market-category">
                <span>Category</span>
                <select id="rs-market-category" value={category} onChange={(event) => setCategory(event.target.value)}>
                  {MARKET_CATEGORIES.map((value) => <option key={value} value={value}>{value === 'all' ? 'All categories' : value}</option>)}
                </select>
              </label>
              <label className="apps-market-filter" htmlFor="rs-market-execution">
                <span>Execution</span>
                <select id="rs-market-execution" value={execution} onChange={(event) => setExecution(event.target.value)}>
                  {EXECUTION_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button type="button" className="apps-filter-reset" onClick={resetMarketplaceFilters} disabled={!filtersActive}>Reset</button>
            </div>
          </details>
        </div>

        <div className="apps-market-grid apps-market-list" id="rs-marketplace-results" aria-describedby="rs-marketplace-runtime-note">
          {ROOM_BOT_CATALOG.map((bot) => <MarketplaceRow key={bot.id} bot={bot} visible={matchingBotIds.has(bot.id)} />)}
          {matchingBotIds.size === 0 ? (
            <div className="apps-market-empty" role="status">
              <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
              <div><strong>No matching apps</strong><span>Try a broader search or reset the catalog filters.</span></div>
              <button type="button" className="apps-row-action" onClick={resetMarketplaceFilters}>Reset filters</button>
            </div>
          ) : null}
        </div>
      </section>

      <section
        id="rs-platform-view-connections"
        className="apps-local-view hidden"
        role="tabpanel"
        aria-labelledby="rs-platform-tab-connections"
        aria-hidden="true"
        data-rs-platform-main
      >
        <div className="apps-section-heading">
          <div><h3>Room-owned connection</h3><p>One real server-delivered integration is available for selected room activity.</p></div>
        </div>
        <div className="apps-list apps-connections-list">
          <article className="apps-list-row apps-connection-row" id="rs-webhook-connection-row" data-connection-type="outgoing_webhook">
            <AppIcon icon="ph-webhooks-logo" tone="ink" />
            <div className="apps-list-primary">
              <div className="apps-list-title-line"><h4>Outgoing webhook</h4><span className="apps-status" id="rs-webhook-status"><StatusDot /><span>Not connected</span></span></div>
              <p id="rs-webhook-endpoint-label">No endpoint configured</p>
              <div className="apps-runtime-badges is-compact"><span className="apps-runtime-badge"><i className="ph-bold ph-cloud" aria-hidden="true" />Server delivered</span><span className="apps-scope-label">Shared room connection</span></div>
            </div>
            <div className="apps-list-detail"><strong>Trigger &amp; data</strong><span>New message in <span id="rs-webhook-channel-label">—</span></span><small>Room, channel, author, message summary</small></div>
            <div className="apps-row-actions">
              <button type="button" className="apps-row-action" id="rs-test-webhook">Test</button>
              <button type="button" className="apps-row-action" data-rs-open-detail="webhook">Manage</button>
            </div>
          </article>
        </div>

        <div className="apps-section-heading apps-personal-heading">
          <div><h3>Personal connection</h3><p>This OAuth session belongs to the signed-in user and this device, not the room.</p></div>
        </div>
        <div className="apps-list apps-connections-list">
          <article className="apps-list-row apps-connection-row" id="rs-google-calendar-row" data-connection-type="google_calendar">
            <AppIcon icon="ph-calendar-dots" />
            <div className="apps-list-primary">
              <div className="apps-list-title-line"><h4>Google Calendar</h4><span className="apps-status" id="rs-google-calendar-status"><StatusDot /><span>Not connected</span></span></div>
              <p>OAuth for calendar event import and creation from the Calendar workspace.</p>
              <div className="apps-runtime-badges is-compact"><span className="apps-runtime-badge"><i className="ph-bold ph-browser" aria-hidden="true" />Browser OAuth session</span><span className="apps-scope-label">Personal</span></div>
            </div>
            <div className="apps-list-detail apps-oauth-scope"><strong>OAuth scope</strong><code>https://www.googleapis.com/auth/calendar.events</code><small>Access token in memory; connection marker on this device. Add to Google links require no connection.</small></div>
            <div className="apps-row-actions">
              <button type="button" className="apps-row-action" id="rs-open-google-calendar">Open calendar</button>
              <button type="button" className="apps-row-action hidden" id="rs-disconnect-google-calendar" aria-describedby="rs-google-calendar-status">Disconnect</button>
            </div>
          </article>
        </div>
      </section>

      <section className="apps-detail-view hidden" id="rs-platform-detail-stock" aria-hidden="true" aria-labelledby="rs-platform-detail-stock-title" data-rs-platform-detail="stock">
        <DetailHeader headingId="rs-platform-detail-stock-title" title={STOCK_BOT.name} description="Configure automatic quote replies and inspect the complete built-in runtime manifest." />
        <BotRuntimeNotice bot={STOCK_BOT} />
        <fieldset className="apps-config-fieldset">
          <legend>Watcher status</legend>
          <label className="apps-switch-row"><span><strong>Enable watcher</strong><small>Automatic replies run in a sender’s current client after a matching room message posts.</small></span><input type="checkbox" id="rs-stock-bot-enabled" /></label>
        </fieldset>
        <div className="apps-config-field">
          <label htmlFor="rs-stock-symbols">Tracked symbols</label>
          <input type="text" id="rs-stock-symbols" placeholder="AAPL, TSLA, MSFT" autoComplete="off" />
          <small>Up to 12 symbols. A matching plain symbol or any $CASHTAG can trigger up to three replies.</small>
        </div>
        <details className="apps-manifest-disclosure">
          <summary>View runtime and access details</summary>
          <BotManifest bot={STOCK_BOT} />
        </details>
        <div className="apps-detail-actions">
          <button type="button" className="action-btn is-secondary" id="rs-remove-stock-bot">Remove</button>
          <button type="button" className="action-btn" id="rs-save-stock-bot">Save watcher</button>
        </div>
      </section>

      <section className="apps-detail-view hidden" id="rs-platform-detail-automod" aria-hidden="true" aria-labelledby="rs-platform-detail-automod-title" data-rs-platform-detail="automod">
        <DetailHeader headingId="rs-platform-detail-automod-title" title={AUTOMOD_BOT.name} description="Configure draft checks and inspect exactly where this client-only filter can and cannot enforce policy." />
        <BotRuntimeNotice bot={AUTOMOD_BOT} />
        <fieldset className="apps-config-fieldset">
          <legend>Guard status</legend>
          <label className="apps-switch-row"><span><strong>Enable guard</strong><small>Check outgoing text in supported current clients for this room.</small></span><input type="checkbox" id="rs-automod-bot-enabled" /></label>
        </fieldset>
        <div className="apps-config-field">
          <label htmlFor="rs-automod-words">Blocked words</label>
          <textarea id="rs-automod-words" rows="3" placeholder="spam, scam, raid" />
          <small>Comma or line separated, up to 40 entries. A matched keyword can appear in the reason-only room notice.</small>
        </div>
        <fieldset className="apps-config-fieldset apps-check-grid">
          <legend>Message checks</legend>
          <label><input type="checkbox" id="rs-automod-links" /><span><strong>Links</strong><small>Block URLs in message text</small></span></label>
          <label><input type="checkbox" id="rs-automod-caps" /><span><strong>Excessive caps</strong><small>Block long mostly-uppercase messages</small></span></label>
          <label><input type="checkbox" id="rs-automod-flood" /><span><strong>Character flood</strong><small>Block repeated-character spam</small></span></label>
        </fieldset>
        <details className="apps-manifest-disclosure">
          <summary>View runtime and access details</summary>
          <BotManifest bot={AUTOMOD_BOT} />
        </details>
        <div className="apps-detail-actions">
          <button type="button" className="action-btn is-secondary" id="rs-remove-automod-bot">Remove</button>
          <button type="button" className="action-btn" id="rs-save-automod-bot">Save guard</button>
        </div>
      </section>

      <section className="apps-detail-view hidden" id="rs-platform-detail-webhook" aria-hidden="true" aria-labelledby="rs-platform-detail-webhook-title" data-rs-platform-detail="webhook">
        <DetailHeader headingId="rs-platform-detail-webhook-title" title="Outgoing webhook" description="Send summaries for new messages in one selected room channel to an HTTPS endpoint." />
        <div className="apps-truth-note"><i className="ph-bold ph-lock-key" aria-hidden="true" /><div><strong>External trust boundary</strong><p>The complete endpoint is validated and stored server-side. Room metadata exposes only a masked destination; the receiving service controls delivered data.</p></div></div>
        <div className="apps-config-field">
          <label htmlFor="rs-webhook-input">Webhook URL</label>
          <input type="url" inputMode="url" autoComplete="url" id="rs-webhook-input" placeholder="https://hooks.example.com/..." aria-describedby="rs-webhook-url-help" />
          <small id="rs-webhook-url-help">The saved URL is never returned to this device. Paste the complete HTTPS endpoint whenever you update the connection.</small>
        </div>
        <div className="apps-config-field">
          <label htmlFor="rs-webhook-channel">Deliver messages from</label>
          <select id="rs-webhook-channel" />
        </div>
        <div className="apps-connection-health" id="rs-webhook-health-copy" role="status" aria-live="polite">Not tested yet.</div>
        <details className="apps-manifest-disclosure">
          <summary>View delivery and trust details</summary>
          <WebhookManifest />
        </details>
        <div className="apps-detail-actions apps-detail-actions-three">
          <button type="button" className="action-btn is-secondary" id="rs-disconnect-webhook">Disconnect</button>
          <button type="button" className="action-btn is-secondary" id="rs-test-webhook-detail">Test connection</button>
          <button type="button" className="action-btn" id="rs-save-webhook">Save connection</button>
        </div>
      </section>

      <div className="apps-action-status" id="rs-platform-action-status" role="status" aria-live="polite" />
    </div>
  );
}
