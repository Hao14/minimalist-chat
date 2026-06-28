import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, ref } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import {
  askPersonalAgent,
  askRoomAgent,
  getLocalAiConfig,
  getLocalAiStatus,
  localAiStatusMessage,
  loadPersonalAiProfileFromServer,
  savePersonalAiProfileToServer,
  shouldUseGatewayAi,
  shouldUseServerAiProfile,
} from './localAiClient.js';

const stopWords = new Set('a an the and or but if then is are was were be been being to of in on at for with as by from this that these those it its i you he she we they me him her them my your our their not no yes do does did have has had will would can could should just so about into out up down over under again more most some any all'.split(' '));

let worker = null;
let modelReady = false;
const PERSONAL_AGENT_STORAGE_KEY = 'minimalistPersonalAiAgent:v1';
const DEFAULT_PERSONAL_AGENT_PROFILE = {
  name: 'NOVA',
  instructions: 'Help me stay organized, catch up quickly, draft clear replies, and notice tasks I might miss.',
  tone: 'Modern, concise, friendly, and direct.',
  memory: '',
};

function timestamp() {
  return Date.now();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function gatherContext(roomId, channelId = 'general') {
  const messagesPath = roomId === 'global'
    ? 'messages'
    : channelId && channelId !== 'general'
      ? `rooms_data/${roomId}/channels/${channelId}/messages`
      : `rooms_data/${roomId}/messages`;
  const [messagesSnapshot, tasksSnapshot, docsSnapshot, eventsSnapshot] = await Promise.all([
    get(ref(db, messagesPath)).catch(() => null),
    get(ref(db, `room_tasks/${roomId}`)).catch(() => null),
    get(ref(db, `room_docs/${roomId}`)).catch(() => null),
    get(ref(db, `rooms_meta/${roomId}/events`)).catch(() => null),
  ]);
  const messages = Object.values(messagesSnapshot?.val() || {})
    .filter((message) => message?.text)
    .map((message) => ({ name: message.name || 'Someone', text: String(message.text), at: message.timestamp || 0 }))
    .sort((a, b) => a.at - b.at);
  return {
    messages,
    tasks: Object.values(tasksSnapshot?.val() || {}).filter(Boolean),
    docs: Object.values(docsSnapshot?.val() || {}).filter(Boolean),
    events: Object.values(eventsSnapshot?.val() || {}).filter(Boolean),
  };
}

function quickStats(context, dateKey) {
  const stats = [];
  if (context.messages.length) {
    const counts = {};
    context.messages.forEach((message) => { counts[message.name] = (counts[message.name] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    stats.push(`${context.messages.length} messages`);
    stats.push(`${Object.keys(counts).length} participants`);
    if (top) stats.push(`most active: ${top[0]}`);
  }
  if (context.tasks.length) {
    const done = context.tasks.filter((task) => task.done).length;
    stats.push(`${context.tasks.length} tasks (${done} done)`);
  }
  if (context.docs.length) stats.push(`${context.docs.length} docs`);
  const upcoming = context.events.filter((event) => event.date && event.date >= dateKey).length;
  if (upcoming) stats.push(`${upcoming} upcoming events`);
  return stats;
}

function extractiveSummary(context, limit = 4) {
  const text = context.messages.slice(-120).map((message) => message.text).join(' ');
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 25);
  if (sentences.length <= limit) return sentences;
  const frequency = {};
  sentences.forEach((sentence) => sentence.toLowerCase().match(/[a-z']+/g)?.forEach((word) => {
    if (!stopWords.has(word) && word.length > 2) frequency[word] = (frequency[word] || 0) + 1;
  }));
  return sentences
    .map((sentence, index) => {
      const words = sentence.toLowerCase().match(/[a-z']+/g) || [];
      const score = words.reduce((total, word) => total + (frequency[word] || 0), 0) / (words.length || 1);
      return { sentence, index, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);
}

function actionItems(context) {
  return context.tasks.filter((task) => !task.done && task.text).slice(0, 8).map((task) => ({ text: task.text, owner: task.byName || 'Owner not specified' }));
}

function buildTranscript(context) {
  return context.messages.slice(-120).map((message) => `${message.name}: ${message.text}`).join('\n');
}

function loadLocalPersonalAgentProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PERSONAL_AGENT_STORAGE_KEY) || 'null');
    return { ...DEFAULT_PERSONAL_AGENT_PROFILE, ...(saved || {}) };
  } catch {
    return DEFAULT_PERSONAL_AGENT_PROFILE;
  }
}

function saveLocalPersonalAgentProfile(profile) {
  localStorage.setItem(PERSONAL_AGENT_STORAGE_KEY, JSON.stringify(profile));
}

function isProTier() {
  return String(window.userTier || 'free').toLowerCase() === 'pro';
}

function Spinner({ label }) {
  return <div className="ai-progress"><div className="ai-spinner" /><span>{label}</span></div>;
}

function statusTone(state) {
  if (state === 'ready') return 'ready';
  if (state === 'checking' || state === 'warming') return 'loading';
  return 'error';
}

function LocalAgentStatus({ onRetry, status }) {
  const state = status?.state || 'checking';
  return (
    <div className={`ai-agent-status ai-agent-status-${statusTone(state)}`} role="status">
      <span className={`ai-agent-dot ${state === 'checking' || state === 'warming' ? 'pulsing' : ''}`} />
      <span>{status?.message || localAiStatusMessage({ state })}</span>
      {state !== 'ready' && onRetry ? (
        <button type="button" className="ai-status-retry" onClick={onRetry}>Retry</button>
      ) : null}
    </div>
  );
}

function bananaResetLabel(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return '';
  try {
    return new Intl.DateTimeFormat([], {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function bananaQuotaFromUsage(usage) {
  const quota = usage?.bananas || usage;
  const fiveHour = quota?.fiveHour || {
    limit: usage?.fiveHourBananaLimit ?? usage?.bananaLimit,
    remaining: usage?.fiveHourBananasRemaining ?? usage?.bananasRemaining,
    used: usage?.fiveHourBananasUsed,
    resetsAt: usage?.fiveHourBananaResetsAt ?? usage?.bananaResetsAt,
  };
  const weekly = quota?.weekly || {
    limit: usage?.weeklyBananaLimit,
    remaining: usage?.weeklyBananasRemaining,
    used: usage?.weeklyBananasUsed,
    resetsAt: usage?.weeklyBananaResetsAt,
  };

  const normalize = (window) => {
    if (window?.limit == null || window?.remaining == null) return null;
    const limit = Number(window.limit);
    const remaining = Number(window.remaining);
    const used = window.used == null ? Math.max(0, limit - remaining) : Number(window.used);
    return {
      limit,
      remaining,
      used: Math.max(0, used),
      resetsAt: window.resetsAt,
    };
  };

  return {
    fiveHour: normalize(fiveHour),
    weekly: normalize(weekly),
  };
}

function BananaMeter({ usage }) {
  const { fiveHour, weekly } = bananaQuotaFromUsage(usage);
  if (!fiveHour) return null;
  const fiveHourReset = bananaResetLabel(fiveHour.resetsAt);
  const weeklyReset = bananaResetLabel(weekly?.resetsAt);
  return (
    <div className="ai-banana-meter" title="Bananas protect the shared public AI gateway from abuse. The short window resets every 5 hours, and the weekly cap resets once a week by subscription tier.">
      <i className="ph-bold ph-shield-check" />
      <span>
        {fiveHour.used}/{fiveHour.limit} Bananas this 5h{fiveHourReset ? ` · resets ${fiveHourReset}` : ''}
        {weekly ? ` · weekly ${weekly.used}/${weekly.limit}${weeklyReset ? ` resets ${weeklyReset}` : ''}` : ''}
      </span>
    </div>
  );
}

function QuickStats({ stats }) {
  return (
    <div className="ai-card">
      <div className="ai-card-h">Quick stats</div>
      <div className="ai-stats">{stats.length ? stats.map((stat) => <span key={stat} className="ai-chip">{stat}</span>) : '—'}</div>
    </div>
  );
}

function RoomAgent({ context, localAiConfig, roomId, channelId = 'general' }) {
  const [history, setHistory] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [bananaUsage, setBananaUsage] = useState(null);
  const [agentStatus, setAgentStatus] = useState(() => ({ state: 'checking', message: localAiStatusMessage({ state: 'checking' }) }));
  const threadRef = useRef(null);
  const config = useMemo(() => getLocalAiConfig(localAiConfig), [localAiConfig]);
  const providerLabel = shouldUseGatewayAi(config) ? 'Gateway · Bananas' : 'Local Ollama';
  const quickActions = [
    ['Summarize', 'Summarize this room. Use sections: Summary, Key Decisions, Open Questions, Next Steps.'],
    ['Extract tasks', "Extract all action items. For each: owner — task — due date or priority. Use 'Owner not specified' if unknown."],
    ['Analyze patterns', 'What are the recurring topics and themes here? List the top topics with a short note on each.'],
    ['Events', 'Summarize the upcoming events and deadlines.'],
  ];

  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [busy, history]);

  const refreshStatus = useCallback(async () => {
    setAgentStatus({ state: 'checking', message: localAiStatusMessage({ state: 'checking' }), model: config.model });
    const nextStatus = await getLocalAiStatus(config);
    setAgentStatus(nextStatus);
    return nextStatus;
  }, [config]);

  useEffect(() => {
    let active = true;
    getLocalAiStatus(config).then((nextStatus) => {
      if (active) setAgentStatus(nextStatus);
    });
    return () => { active = false; };
  }, [config]);

  const sendPrompt = async (text) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const nextHistory = [...history, { role: 'user', content: prompt }];
    setHistory(nextHistory);
    setBusy(true);
    try {
      let currentStatus = agentStatus;
      if (currentStatus?.state !== 'ready') currentStatus = await refreshStatus();
      if (currentStatus?.state !== 'ready') {
        setHistory([...nextHistory, { role: 'assistant', content: currentStatus.message || localAiStatusMessage(currentStatus) }]);
        return;
      }
      const result = await askRoomAgent({ context, messages: nextHistory, config, roomId, channelId });
      setBananaUsage(result);
      const { reply } = result;
      setHistory([...nextHistory, { role: 'assistant', content: reply }]);
    } catch (error) {
      const message = localAiStatusMessage(error);
      if (error?.details?.bananas) setBananaUsage(error.details.bananas);
      setAgentStatus({ state: error?.state || 'request-failed', message, model: config.model });
      setHistory([...nextHistory, { role: 'assistant', content: message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-card ai-ai-card">
      <div className="ai-card-h">Room agent <span className="ai-tag">{providerLabel}</span></div>
      <LocalAgentStatus status={agentStatus} onRetry={refreshStatus} />
      <BananaMeter usage={bananaUsage} />
      <div className="ai-quick-actions">{quickActions.map(([label, prompt]) => <button key={label} type="button" className="ai-qa" disabled={busy} onClick={() => sendPrompt(prompt)}>{label}</button>)}</div>
      <div ref={threadRef} id="ai-thread" className="ai-thread">
        {history.map((message, index) => <div key={`${message.role}-${index}`} className={`ai-bubble ai-bubble-${message.role}`}>{message.content}</div>)}
        {busy ? <div className="ai-bubble ai-bubble-assistant ai-typing"><span /><span /><span /></div> : null}
      </div>
      <form id="ai-chat-form" className="ai-chat-form" onSubmit={(event) => { event.preventDefault(); sendPrompt(draft); setDraft(''); }}>
        <input id="ai-chat-input" value={draft} onChange={(event) => setDraft(event.target.value)} type="text" placeholder="Ask the room agent..." autoComplete="off" />
        <button type="submit" className="ai-btn ai-send" id="ai-send-btn" title="Send" disabled={busy || !draft.trim()}><i className="ph-bold ph-paper-plane-tilt" /></button>
      </form>
    </div>
  );
}

const EMPTY_CONTEXT = { messages: [], tasks: [], docs: [], events: [] };

const PERSONAL_QUICK_ACTIONS = [
  { label: 'Catch me up', hint: 'What changed recently', icon: 'ph-lightning', prompt: 'Catch me up on this room like my personal assistant. Focus on what matters to me and what changed recently.' },
  { label: 'My next steps', hint: 'What I should do now', icon: 'ph-list-checks', prompt: 'Based on this room, what should I personally do next? Separate urgent items from nice-to-haves.' },
  { label: 'Draft a reply', hint: 'Two tone options', icon: 'ph-pencil-simple-line', prompt: 'Draft a short, natural reply I could send in this room. Include two tone options.' },
  { label: 'Plan my day', hint: 'Tasks + events → plan', icon: 'ph-calendar-check', prompt: 'Turn the open tasks, events, and recent messages into a simple personal plan for today.' },
];

function agentInitial(name) {
  const trimmed = String(name || 'A').trim();
  return (trimmed.charAt(0) || 'A').toUpperCase();
}

function PersonalAgentShell({ children, className = '' }) {
  return <div className={`pa-shell ${className}`.trim()}>{children}</div>;
}

export function PersonalAIAgent({ context, loading = false, error = '', localAiConfig, onRefresh, roomId = 'global', channelId = 'general' }) {
  const [profile, setProfile] = useState(loadLocalPersonalAgentProfile);
  const [history, setHistory] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [bananaUsage, setBananaUsage] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentStatus, setAgentStatus] = useState(() => ({ state: 'checking', message: localAiStatusMessage({ state: 'checking' }) }));
  const threadRef = useRef(null);
  const pro = isProTier();
  const ctx = context || EMPTY_CONTEXT;
  const initial = agentInitial(profile.name);
  const config = useMemo(() => getLocalAiConfig(localAiConfig), [localAiConfig]);
  const serverProfile = shouldUseServerAiProfile(config);

  const contextBits = useMemo(() => {
    const bits = [];
    if (ctx.messages.length) bits.push(`${ctx.messages.length} messages`);
    if (ctx.tasks.length) bits.push(`${ctx.tasks.length} tasks`);
    if (ctx.events.length) bits.push(`${ctx.events.length} events`);
    if (ctx.docs.length) bits.push(`${ctx.docs.length} docs`);
    return bits;
  }, [ctx]);

  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [busy, history]);

  const refreshAgentStatus = useCallback(async () => {
    setAgentStatus({ state: 'checking', message: localAiStatusMessage({ state: 'checking' }), model: config.model });
    const nextStatus = await getLocalAiStatus(config);
    setAgentStatus(nextStatus);
    return nextStatus;
  }, [config]);

  useEffect(() => {
    let active = true;
    getLocalAiStatus(config).then((nextStatus) => {
      if (active) setAgentStatus(nextStatus);
    });
    return () => { active = false; };
  }, [config]);

  useEffect(() => {
    if (!serverProfile) return undefined;
    let active = true;
    loadPersonalAiProfileFromServer({ config })
      .then((nextProfile) => {
        if (active && nextProfile) setProfile({ ...DEFAULT_PERSONAL_AGENT_PROFILE, ...nextProfile });
      })
      .catch((profileError) => {
        if (active) setAgentStatus({
          state: profileError?.state || 'request-failed',
          message: profileError?.message || 'Could not load server AI profile.',
          model: config.model,
          provider: config.provider,
        });
      });
    return () => { active = false; };
  }, [config, serverProfile]);

  const updateProfile = (field, value) => setProfile((current) => ({ ...current, [field]: value }));

  const persistProfile = async () => {
    if (serverProfile) {
      const savedProfile = await savePersonalAiProfileToServer({ profile, config });
      if (savedProfile) setProfile({ ...DEFAULT_PERSONAL_AGENT_PROFILE, ...savedProfile });
    } else {
      saveLocalPersonalAgentProfile(profile);
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const resetProfile = async () => {
    setProfile(DEFAULT_PERSONAL_AGENT_PROFILE);
    if (serverProfile) {
      await savePersonalAiProfileToServer({ profile: DEFAULT_PERSONAL_AGENT_PROFILE, config });
    } else {
      saveLocalPersonalAgentProfile(DEFAULT_PERSONAL_AGENT_PROFILE);
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const sendPrompt = async (text) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    if (!window.currentUser?.getIdToken) {
      setHistory((current) => [...current, { role: 'user', content: prompt }, { role: 'assistant', content: 'Please sign in again before using your personal agent.' }]);
      return;
    }

    const nextHistory = [...history, { role: 'user', content: prompt }];
    setHistory(nextHistory);
    setBusy(true);
    try {
      if (serverProfile) {
        await savePersonalAiProfileToServer({ profile, config }).catch(() => null);
      } else {
        saveLocalPersonalAgentProfile(profile);
      }
      let currentStatus = agentStatus;
      if (currentStatus?.state !== 'ready') currentStatus = await refreshAgentStatus();
      if (currentStatus?.state !== 'ready') {
        setHistory([...nextHistory, { role: 'assistant', content: currentStatus.message || localAiStatusMessage(currentStatus) }]);
        return;
      }
      const result = await askPersonalAgent({
        context: ctx,
        messages: nextHistory,
        profile,
        userName: window.userProfileName || window.currentUser?.displayName || 'the user',
        config,
        roomId,
        channelId,
      });
      setBananaUsage(result);
      const { reply } = result;
      setHistory([...nextHistory, { role: 'assistant', content: reply }]);
    } catch (requestError) {
      const message = localAiStatusMessage(requestError);
      if (requestError?.details?.bananas) setBananaUsage(requestError.details.bananas);
      setAgentStatus({ state: requestError?.state || 'request-failed', message, model: config.model });
      setHistory([...nextHistory, { role: 'assistant', content: message }]);
    } finally {
      setBusy(false);
    }
  };

  // Pro upsell.
  if (!pro) {
    return (
      <PersonalAgentShell className="pa-notice">
        <div className="pa-orb pa-orb-lg">{initial}</div>
        <h3>Meet your private agent <span className="pa-pro">Pro</span></h3>
        <p>A personal assistant that remembers your preferences, drafts replies in your voice, and turns each room into your own next steps.</p>
        <ul className="pa-feature-list">
          <li><i className="ph-bold ph-brain" /> Remembers your tone &amp; preferences</li>
          <li><i className="ph-bold ph-list-checks" /> Surfaces what you personally should do</li>
          <li><i className="ph-bold ph-lock-simple" /> Setup stays private, on your device</li>
        </ul>
        <button
          type="button"
          className="pa-btn pa-btn-accent"
          onClick={() => { window.openSettings?.(); window.switchTab?.('pane-billing', 'tab-btn-billing'); }}
        >
          <i className="ph-bold ph-crown" /> Unlock with Pro
        </button>
      </PersonalAgentShell>
    );
  }

  const empty = history.length === 0 && !busy;

  return (
    <PersonalAgentShell>
      <div className="pa-id">
        <div className="pa-orb">{initial}</div>
        <div className="pa-id-meta">
          <strong>{profile.name || 'Your agent'}</strong>
          <span><i className="ph-bold ph-shield-check" /> {serverProfile ? 'Server profile · Bananas protected' : 'Private local profile · Pro'}</span>
        </div>
        <div className="pa-id-actions">
          <button type="button" className="pa-icon-btn" onClick={onRefresh} title="Re-read this room" disabled={loading}>
            <i className={`ph-bold ph-arrows-clockwise ${loading ? 'pa-spin' : ''}`} />
          </button>
          <button type="button" className={`pa-icon-btn ${settingsOpen ? 'active' : ''}`} onClick={() => setSettingsOpen((open) => !open)} title="Agent setup">
            <i className="ph-bold ph-sliders-horizontal" />
          </button>
        </div>
      </div>

      <div className="pa-context">
        {loading ? (
          <><span className="pa-context-dot pulsing" /> Reading this room…</>
        ) : error ? (
          <span className="pa-context-error"><i className="ph-bold ph-warning-circle" /> {error}</span>
        ) : (
          <><span className="pa-context-dot" /> {contextBits.length ? `Using ${contextBits.join(' · ')}` : 'Room is quiet — ask me anything'}</>
        )}
      </div>
      <div className="pa-local-status">
        <LocalAgentStatus status={agentStatus} onRetry={refreshAgentStatus} />
        <BananaMeter usage={bananaUsage} />
      </div>

      {settingsOpen ? (
        <div className="pa-settings">
          <label>
            Agent name
            <input value={profile.name} onChange={(event) => updateProfile('name', event.target.value)} maxLength={80} />
          </label>
          <label>
            What should your agent help with?
            <textarea value={profile.instructions} onChange={(event) => updateProfile('instructions', event.target.value)} rows={3} />
          </label>
          <label>
            Preferred tone
            <input value={profile.tone} onChange={(event) => updateProfile('tone', event.target.value)} maxLength={400} />
          </label>
          <label>
            Memory / preferences
            <textarea value={profile.memory} onChange={(event) => updateProfile('memory', event.target.value)} rows={3} placeholder="Example: keep replies short. I prefer action lists over paragraphs." />
          </label>
          <div className="pa-settings-actions">
            <button type="button" className="pa-btn pa-btn-accent" onClick={persistProfile}><i className="ph-bold ph-check" /> Save</button>
            <button type="button" className="pa-btn" onClick={resetProfile}><i className="ph-bold ph-arrow-counter-clockwise" /> Reset</button>
            {saved ? <span className="pa-saved"><i className="ph-bold ph-check-circle" /> Saved</span> : null}
          </div>
        </div>
      ) : null}

      <div ref={threadRef} className="pa-thread">
        {empty ? (
          <div className="pa-welcome">
            <div className="pa-orb pa-orb-lg">{initial}</div>
            <h4>Hi, I’m {profile.name || 'your agent'}</h4>
            <p>I read this room for you. Pick a starting point or just ask.</p>
            <div className="pa-suggest">
              {PERSONAL_QUICK_ACTIONS.map((action) => (
                <button key={action.label} type="button" className="pa-suggest-card" onClick={() => sendPrompt(action.prompt)}>
                  <i className={`ph-bold ${action.icon}`} />
                  <span className="pa-suggest-copy">
                    <strong>{action.label}</strong>
                    <small>{action.hint}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {history.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`pa-msg pa-msg-${message.role}`}>
                {message.role === 'assistant' ? <div className="pa-msg-orb">{initial}</div> : null}
                <div className="pa-bubble">{message.content}</div>
              </div>
            ))}
            {busy ? (
              <div className="pa-msg pa-msg-assistant">
                <div className="pa-msg-orb">{initial}</div>
                <div className="pa-bubble pa-typing"><span /><span /><span /></div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <form className="pa-composer" onSubmit={(event) => { event.preventDefault(); sendPrompt(draft); setDraft(''); }}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          type="text"
          placeholder={`Ask ${profile.name || 'your agent'}…`}
          autoComplete="off"
        />
        <button type="submit" className="pa-send" title="Send" disabled={busy || !draft.trim()}>
          <i className="ph-bold ph-arrow-up" />
        </button>
      </form>
    </PersonalAgentShell>
  );
}

export function PersonalAIAgentLauncher({ localAiConfig, roomId, channelId = window.activeChannelId || 'general' }) {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    setError('');
    try {
      setContext(await gatherContext(roomId, channelId));
    } catch (loadError) {
      setError(`Couldn't load room context: ${loadError.message}`);
    } finally {
      setLoading(false);
    }
  }, [channelId, roomId]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <PersonalAIAgent
      key={`${roomId || 'global'}:${channelId || 'general'}`}
      context={context}
      localAiConfig={localAiConfig}
      loading={loading}
      error={error}
      roomId={roomId}
      channelId={channelId}
      onRefresh={load}
    />
  );
}

function LocalAI({ context }) {
  const [state, setState] = useState({ status: 'idle', message: '', percent: null, summary: '' });
  const requestRef = useRef('');

  const generate = () => {
    const transcript = buildTranscript(context);
    if (!transcript.trim()) return setState({ status: 'error', message: 'No conversation text to summarize.', percent: null, summary: '' });
    const requestId = String(timestamp());
    requestRef.current = requestId;
    setState({ status: 'loading', message: modelReady ? 'Summarizing…' : 'Loading model…', percent: null, summary: '' });
    try {
      if (!worker) worker = new Worker('/js/ai-worker.js?v=30', { type: 'module' });
      worker.onmessage = (event) => {
        const data = event.data || {};
        if (data.id && data.id !== requestRef.current) return;
        if (data.type === 'progress') setState({ status: 'loading', message: `Downloading model… ${data.pct != null ? `${data.pct}%` : ''}`, percent: data.pct ?? null, summary: '' });
        if (data.type === 'ready') { modelReady = true; setState({ status: 'loading', message: 'Summarizing…', percent: null, summary: '' }); }
        if (data.type === 'result') setState({ status: 'done', message: '', percent: null, summary: data.summary || '(no summary produced)' });
        if (data.type === 'error') setState({ status: 'error', message: `Local model failed: ${data.message}. The instant summary above still works.`, percent: null, summary: '' });
      };
      worker.onerror = (event) => setState({ status: 'error', message: `Couldn't start the local model: ${event.message || 'unknown error'}. The instant summary above still works.`, percent: null, summary: '' });
      worker.postMessage({ type: 'summarize', text: transcript, id: requestId });
    } catch (error) {
      setState({ status: 'error', message: `Local AI isn't available on this browser: ${error.message}. The instant summary above still works.`, percent: null, summary: '' });
    }
  };

  return (
    <div className="ai-card ai-ai-card">
      <div className="ai-card-h">AI summary <span className="ai-tag">local model · on-device</span></div>
      {state.status === 'idle' ? <><button type="button" id="ai-generate-btn" className="ai-btn" onClick={generate}><i className="ph-bold ph-cpu" /> Generate AI summary</button><div className="ai-note">First run downloads a model to your device, then it’s cached. Runs entirely on-device — no data leaves your browser.</div></> : null}
      {state.status === 'loading' ? <><Spinner label={state.message} />{state.percent != null ? <div className="ai-bar"><div id="ai-bar-fill" style={{ width: `${state.percent}%` }} /></div> : null}</> : null}
      {state.status === 'done' ? <><div className="ai-llm-result">{state.summary}</div><button type="button" id="ai-regen-btn" className="ai-btn ai-btn-ghost" onClick={generate}><i className="ph-bold ph-arrows-clockwise" /> Regenerate</button></> : null}
      {state.status === 'error' ? <div className="ai-empty">{state.message}</div> : null}
    </div>
  );
}

export function AI({ localAiConfig, roomId, channelId = 'general' }) {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateKey] = useState(() => todayKey());

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const nextContext = await gatherContext(roomId, channelId);
      setContext(nextContext);
    } catch (loadError) {
      setError(`Couldn't load room data: ${loadError.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const runInitialLoad = async () => {
      try {
        const nextContext = await gatherContext(roomId, channelId);
        if (active) setContext(nextContext);
      } catch (loadError) {
        if (active) setError(`Couldn't load room data: ${loadError.message}`);
      } finally {
        if (active) setLoading(false);
      }
    };
    runInitialLoad();
    return () => { active = false; };
  }, [channelId, roomId]);

  const stats = useMemo(() => context ? quickStats(context, dateKey) : [], [context, dateKey]);
  const summary = useMemo(() => context ? extractiveSummary(context) : [], [context]);
  const actions = useMemo(() => context ? actionItems(context) : [], [context]);
  const empty = context && !context.messages.length && !context.tasks.length && !context.docs.length && !context.events.length;

  return (
    <div className="ai-wrap">
      <div className="ai-head">
        <h3><i className="ph-bold ph-sparkle" /> AI Command Center</h3>
        <button type="button" id="ai-refresh-btn" className="rh-add-btn" title="Re-read the room" onClick={load}><i className="ph-bold ph-arrows-clockwise" /> Refresh</button>
      </div>
      <div id="ai-output" className="ai-output">
        {loading ? <Spinner label="Reading room…" /> : null}
        {error ? <div className="ai-empty">{error}</div> : null}
        {!loading && context ? <QuickStats stats={stats} /> : null}
        {!loading && context ? <RoomAgent key={`${roomId || 'global'}:${channelId || 'general'}`} context={context} localAiConfig={localAiConfig} roomId={roomId} channelId={channelId} /> : null}
        {!loading && context && empty ? <div className="ai-empty">Nothing to summarize in this room yet.</div> : null}
        {!loading && context && !empty ? (
          <>
            <div className="ai-card"><div className="ai-card-h">Summary <span className="ai-tag">extractive · instant</span></div>{summary.length ? <ul className="ai-list">{summary.map((sentence) => <li key={sentence}>{sentence}</li>)}</ul> : <div className="ai-empty">Not enough text to summarize.</div>}</div>
            {actions.length ? <div className="ai-card"><div className="ai-card-h">Open action items</div><ul className="ai-list">{actions.map((item) => <li key={item.text}>{item.text} <span className="ai-owner">— {item.owner}</span></li>)}</ul></div> : null}
            <LocalAI context={context} />
          </>
        ) : null}
      </div>
    </div>
  );
}
