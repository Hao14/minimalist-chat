import { useCallback, useEffect, useState } from 'react';

const MAINTENANCE_COMMAND = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\tools\\gbrain\\Invoke-GBrainMaintenance.ps1';
const NAVIGATION = [
  ['overview', 'Overview', 'home'],
  ['retrieval', 'Retrieval', 'search'],
  ['sources', 'Sources', 'document'],
  ['graph', 'Graph', 'graph'],
  ['maintenance', 'Maintenance', 'wrench'],
];

function Icon({ name, size = 21 }) {
  const paths = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9 21v-7h6v7"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>,
    document: <><path d="M6 2.5h8l4 4V21H6z"/><path d="M14 2.5v5h4M9 12h6M9 16h6"/></>,
    graph: <><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="19" r="2"/><path d="m7 7 4 10M17 7l-4 10M7 6h10"/></>,
    wrench: <><path d="M14.5 5.5a5 5 0 0 0-6.2 6.2L3 17l4 4 5.3-5.3a5 5 0 0 0 6.2-6.2l-3 3-3-3z"/></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-4.4L3 10"/><path d="M3 4v6h6M4 13a8 8 0 0 0 14.7 4.4L21 14"/><path d="M21 20v-6h-6"/></>,
    check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 8"/></>,
    terminal: <><path d="m4 7 4 4-4 4M11 16h8"/></>,
    monitor: <><rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M9 21h6M12 17v4"/></>,
  };
  return (
    <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] ?? paths.document}
    </svg>
  );
}

function formatPercent(value, digits = 0) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

function StatusMark({ passed, label }) {
  return (
    <span className={passed ? 'status status--passed' : 'status status--attention'}>
      <span className="status__dot" aria-hidden="true">{passed ? '✓' : '!'}</span>
      {label ?? (passed ? 'Passed' : 'Attention')}
    </span>
  );
}

function MetricBand({ metrics }) {
  const items = [
    [Number(metrics.pages || 0).toLocaleString(), 'Pages'],
    [Number(metrics.embedded_chunks || 0).toLocaleString(), 'Embedded Chunks'],
    [formatPercent(metrics.hit_at_3), 'Hit@3'],
    [metrics.p95_latency_ms ? `${(metrics.p95_latency_ms / 1000).toFixed(1)}s` : '—', 'p95'],
    [Number(metrics.graph_nodes || 0).toLocaleString(), 'Graph Nodes'],
    [Number(metrics.graph_relationships || 0).toLocaleString(), 'Relationships'],
  ];
  return (
    <section aria-label="Key health metrics" className="metric-band">
      {items.map(([value, label]) => (
        <div className="metric" key={label}>
          <strong>{value}</strong>
          <span>{label}</span>
        </div>
      ))}
    </section>
  );
}

function RetrievalPanel({ evaluation }) {
  const metrics = [
    ['Hit@3', evaluation.hit_at_3],
    ['Recall@10', evaluation.recall_at_10],
    ['MRR', evaluation.mrr],
    ['nDCG@10', evaluation.ndcg_at_10],
  ];
  return (
    <section className="panel panel--retrieval" id="retrieval-panel">
      <div className="panel__heading">
        <h2>Retrieval Quality</h2>
        <StatusMark passed={evaluation.ready} label={evaluation.ready ? 'Evaluation ready' : 'Evaluation needs review'} />
      </div>
      <div className="quality-list">
        {metrics.map(([label, value]) => (
          <div className="quality-row" key={label}>
            <span>{label}</span>
            <div className="quality-track" aria-hidden="true">
              <span style={{ width: `${Math.max(0, Math.min(100, Number(value || 0) * 100))}%` }} />
            </div>
            <strong>{formatPercent(value, label === 'Hit@3' || label === 'Recall@10' ? 0 : 1)}</strong>
          </div>
        ))}
      </div>
      <a className="text-link" href="/reports/evaluation.json" target="_blank" rel="noreferrer">Open evaluation <span aria-hidden="true">↗</span></a>
    </section>
  );
}

function SourcesPanel({ sources }) {
  const [selected, setSelected] = useState(null);
  return (
    <section className="panel" id="sources-panel">
      <div className="panel__heading"><h2>Sources</h2></div>
      <div className="source-table" role="table" aria-label="Indexed sources">
        <div className="source-row source-row--header" role="row">
          <span role="columnheader">Source Type</span><span role="columnheader">Count</span><span aria-hidden="true" />
        </div>
        {sources.map((source) => (
          <div className="source-row" role="row" key={source.id}>
            <span role="cell">
              <button className="source-row__button" onClick={() => setSelected(selected === source.id ? null : source.id)} type="button" aria-expanded={selected === source.id}>
                {source.label}{selected === source.id ? <small>{source.scope}</small> : null}
              </button>
            </span>
            <strong role="cell">{source.count == null ? '—' : Number(source.count).toLocaleString()}</strong>
            <span role="cell" aria-hidden="true">›</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AttentionPanel({ attention }) {
  return (
    <section className="panel panel--attention">
      <div className="panel__heading"><h2>Attention</h2></div>
      <ul className="attention-list">
        {attention.map((item) => (
          <li key={item.id}>
            <span className={`attention-dot attention-dot--${item.status}`} aria-hidden="true" />
            <span>{item.label}</span>
            <strong>{item.status}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GraphPanel({ graph }) {
  const graphReady = graph.valid && graph.quality_passed && graph.relationship_aligned;
  return (
    <section className="panel graph-panel" id="graph-panel">
      <div className="panel__heading">
        <h2>Graph Integrity</h2>
        <StatusMark passed={graphReady} label={graphReady ? 'Passed' : 'Needs review'} />
      </div>
      <dl className="graph-facts">
        <div><dt>Weak nodes</dt><dd>{graph.weak_nodes}</dd></div>
        <div><dt>Isolated nodes</dt><dd>{graph.isolated_nodes}</dd></div>
        <div><dt>Missing endpoints</dt><dd>{graph.missing_endpoint_edges}</dd></div>
        <div><dt>Self-loops</dt><dd>{graph.self_loops}</dd></div>
      </dl>
      <a className="text-link" href="/reports/graph.html" target="_blank" rel="noreferrer">Open graph <span aria-hidden="true">↗</span></a>
    </section>
  );
}

function MaintenancePanel({ maintenance, schedule, copyState, onCopy }) {
  return (
    <section className="panel maintenance-panel" id="maintenance-panel">
      <div className="panel__heading">
        <h2>Latest Maintenance</h2>
        <span className="panel__date">{formatDate(maintenance.finished_at)}</span>
      </div>
      <div className="schedule-strip">
        <span><b>Weekly schedule</b><small>{schedule?.live_verified ? `${schedule.day_of_week} at ${schedule.at}` : 'Not live-verified'}</small></span>
        <StatusMark passed={Boolean(schedule?.installed && schedule?.live_verified)} label={schedule?.live_verified ? 'Active' : 'Attention'} />
        <span><b>Next run</b><small>{formatDate(schedule?.next_run_time)}</small></span>
      </div>
      <div className="maintenance-table" role="table" aria-label="Latest maintenance stages">
        <div className="maintenance-row maintenance-row--header" role="row">
          <span role="columnheader">Step</span><span role="columnheader">Status</span><span role="columnheader">Details</span><span role="columnheader">Performed At</span>
        </div>
        {maintenance.steps.map((step) => (
          <div className="maintenance-row" role="row" key={step.id}>
            <span role="cell"><i aria-hidden="true" />{step.label}</span>
            <span role="cell"><StatusMark passed={step.passed} /></span>
            <span role="cell">{step.detail}</span>
            <time role="cell" dateTime={step.performed_at ?? undefined}>{formatDate(step.performed_at)}</time>
          </div>
        ))}
      </div>
      <div className="command-row">
        <button className="command-button" type="button" onClick={onCopy}><Icon name="terminal" size={19} />Copy maintenance command</button>
        {copyState === 'copied' ? <span className="copy-state" role="status"><Icon name="check" size={17} />Copied to clipboard</span> : null}
        {copyState === 'failed' ? <span className="copy-state copy-state--failed" role="status">Clipboard copy failed</span> : null}
      </div>
    </section>
  );
}

export function GBrainHealthDashboard() {
  const [activeView, setActiveView] = useState('overview');
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [copyState, setCopyState] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Health request failed (${response.status})`);
        return response.json();
      })
      .then(setSnapshot)
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') {
          setError(loadError.message || 'Health data could not be loaded.');
        }
      });
    return () => controller.abort();
  }, []);

  const loadSnapshot = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Health request failed (${response.status})`);
      setSnapshot(await response.json());
    } catch (loadError) {
      setError(loadError.message || 'Health data could not be loaded.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  const copyCommand = useCallback(async () => {
    let succeeded = false;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(MAINTENANCE_COMMAND);
      succeeded = true;
    } catch {
      let field = null;
      try {
        field = document.createElement('textarea');
        field.value = MAINTENANCE_COMMAND;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        succeeded = document.execCommand('copy') === true;
      } catch {
        succeeded = false;
      } finally {
        field?.remove();
      }
    }
    setCopyState(succeeded ? 'copied' : 'failed');
    window.setTimeout(() => setCopyState(''), succeeded ? 2200 : 2600);
  }, []);

  if (!snapshot && !error) {
    return <main className="loading-screen"><span className="loading-mark" />Loading local GBrain health…</main>;
  }

  return (
    <div className="app-shell">
      <aside className="nav-rail" aria-label="GBrain health sections">
        <div className="rail-mark" aria-hidden="true">G</div>
        <nav>
          {NAVIGATION.map(([id, label, icon]) => (
            <button key={id} className={activeView === id ? 'nav-item nav-item--active' : 'nav-item'} type="button" onClick={() => setActiveView(id)} aria-current={activeView === id ? 'page' : undefined}>
              <Icon name={icon} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-local"><Icon name="monitor" size={19} /><span><b>Local only</b><small>Private to this computer</small></span></div>
      </aside>

      <main className="dashboard">
        <header className="dashboard-header">
          <div><h1>GBrain Health</h1><p>Private project memory on this computer</p></div>
          <div className="header-actions">
            <StatusMark passed={snapshot?.status === 'healthy'} label={snapshot?.status === 'healthy' ? 'Healthy' : snapshot?.status === 'stale' ? 'Stale' : 'Attention'} />
            <button className="refresh-button" type="button" onClick={loadSnapshot} disabled={refreshing}><Icon name="refresh" size={19} />{refreshing ? 'Refreshing' : 'Refresh'}</button>
            <small>Last updated: {formatDate(snapshot?.generated_at)}</small>
          </div>
        </header>

        {error ? <div className="error-banner" role="alert">{error}<button type="button" onClick={loadSnapshot}>Try again</button></div> : null}
        {snapshot ? <MetricBand metrics={snapshot.metrics} /> : null}

        {snapshot ? (
          <div className={`dashboard-content dashboard-content--${activeView}`}>
            {(activeView === 'overview' || activeView === 'retrieval') ? <RetrievalPanel evaluation={snapshot.evaluation} /> : null}
            {(activeView === 'overview' || activeView === 'sources') ? <SourcesPanel sources={snapshot.sources} /> : null}
            {activeView === 'overview' ? <AttentionPanel attention={snapshot.attention} /> : null}
            {(activeView === 'overview' || activeView === 'graph') ? <GraphPanel graph={snapshot.graph} /> : null}
            {(activeView === 'overview' || activeView === 'maintenance') ? <MaintenancePanel maintenance={snapshot.maintenance} schedule={snapshot.schedule} copyState={copyState} onCopy={copyCommand} /> : null}
          </div>
        ) : null}

        <footer className="dashboard-footer"><span><Icon name="monitor" size={17} />Local only</span><span>All data stays on this computer.</span><span>Minimalist Chat · GBrain Health</span></footer>
      </main>
    </div>
  );
}
