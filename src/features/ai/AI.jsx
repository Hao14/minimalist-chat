import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, ref } from 'firebase/database';
import { db } from '../../lib/firebase.js';

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

async function gatherContext(roomId) {
  const messagesPath = roomId === 'global' ? 'messages' : `rooms_data/${roomId}/messages`;
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

function buildContextString(context) {
  const lines = [];
  if (context.messages.length) lines.push(`Recent messages:\n${context.messages.slice(-60).map((message) => `${message.name}: ${message.text}`).join('\n')}`);
  if (context.tasks.length) lines.push(`Tasks:\n${context.tasks.map((task) => `- [${task.done ? 'done' : 'open'}] ${task.text}${task.byName ? ` (by ${task.byName})` : ''}`).join('\n')}`);
  if (context.events.length) lines.push(`Events:\n${context.events.map((event) => `- ${event.date || ''} ${event.time || ''} ${event.title || ''}`.trim()).join('\n')}`);
  if (context.docs.length) lines.push(`Documents: ${context.docs.map((document) => document.title || 'Untitled').join(', ')}`);
  return lines.join('\n\n');
}

function buildTranscript(context) {
  return context.messages.slice(-120).map((message) => `${message.name}: ${message.text}`).join('\n');
}

function loadPersonalAgentProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PERSONAL_AGENT_STORAGE_KEY) || 'null');
    return { ...DEFAULT_PERSONAL_AGENT_PROFILE, ...(saved || {}) };
  } catch {
    return DEFAULT_PERSONAL_AGENT_PROFILE;
  }
}

function savePersonalAgentProfile(profile) {
  localStorage.setItem(PERSONAL_AGENT_STORAGE_KEY, JSON.stringify(profile));
}

function isProTier() {
  return String(window.userTier || 'free').toLowerCase() === 'pro';
}

function Spinner({ label }) {
  return <div className="ai-progress"><div className="ai-spinner" /><span>{label}</span></div>;
}

function QuickStats({ stats }) {
  return (
    <div className="ai-card">
      <div className="ai-card-h">Quick stats</div>
      <div className="ai-stats">{stats.length ? stats.map((stat) => <span key={stat} className="ai-chip">{stat}</span>) : '—'}</div>
    </div>
  );
}

function CloudAI({ aiChatEndpoint, context }) {
  const [history, setHistory] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const threadRef = useRef(null);
  const quickActions = [
    ['Summarize', 'Summarize this room. Use sections: Summary, Key Decisions, Open Questions, Next Steps.'],
    ['Extract tasks', "Extract all action items. For each: owner — task — due date or priority. Use 'Owner not specified' if unknown."],
    ['Analyze patterns', 'What are the recurring topics and themes here? List the top topics with a short note on each.'],
    ['Events', 'Summarize the upcoming events and deadlines.'],
  ];

  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [busy, history]);

  const sendPrompt = async (text) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const nextHistory = [...history, { role: 'user', content: prompt }];
    setHistory(nextHistory);
    setBusy(true);
    try {
      const response = await fetch(aiChatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: buildContextString(context), messages: nextHistory }),
      });
      const data = await response.json().catch(() => ({}));
      setHistory([...nextHistory, { role: 'assistant', content: response.ok ? (data.reply || '(no response)') : (data.error || `Request failed (${response.status}).`) }]);
    } catch (error) {
      setHistory([...nextHistory, { role: 'assistant', content: `Could not reach the AI service: ${error.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-card ai-ai-card">
      <div className="ai-card-h">Workspace AI <span className="ai-tag">Groq · cloud</span></div>
      <div className="ai-quick-actions">{quickActions.map(([label, prompt]) => <button key={label} type="button" className="ai-qa" onClick={() => sendPrompt(prompt)}>{label}</button>)}</div>
      <div ref={threadRef} id="ai-thread" className="ai-thread">
        {history.map((message, index) => <div key={`${message.role}-${index}`} className={`ai-bubble ai-bubble-${message.role}`}>{message.content}</div>)}
        {busy ? <div className="ai-bubble ai-bubble-assistant ai-typing"><span /><span /><span /></div> : null}
      </div>
      <form id="ai-chat-form" className="ai-chat-form" onSubmit={(event) => { event.preventDefault(); sendPrompt(draft); setDraft(''); }}>
        <input id="ai-chat-input" value={draft} onChange={(event) => setDraft(event.target.value)} type="text" placeholder="Ask anything about this room…" autoComplete="off" />
        <button type="submit" className="ai-btn ai-send" id="ai-send-btn" title="Send"><i className="ph-bold ph-paper-plane-tilt" /></button>
      </form>
    </div>
  );
}

export function PersonalAIAgent({ personalAiAgentEndpoint, context }) {
  const [profile, setProfile] = useState(loadPersonalAgentProfile);
  const [history, setHistory] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const threadRef = useRef(null);
  const pro = isProTier();
  const quickActions = [
    ['Catch me up', 'Catch me up on this room like my personal assistant. Focus on what matters to me and what changed recently.'],
    ['My next steps', 'Based on this room, what should I personally do next? Separate urgent items from nice-to-haves.'],
    ['Draft reply', 'Draft a short, natural reply I could send in this room. Include two tone options.'],
    ['Plan my day', 'Turn the open tasks, events, and recent messages into a simple personal plan for today.'],
  ];

  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [busy, history]);

  const updateProfile = (field, value) => {
    setProfile((current) => ({ ...current, [field]: value }));
  };

  const persistProfile = () => {
    savePersonalAgentProfile(profile);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const resetProfile = () => {
    setProfile(DEFAULT_PERSONAL_AGENT_PROFILE);
    savePersonalAgentProfile(DEFAULT_PERSONAL_AGENT_PROFILE);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const sendPrompt = async (text) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    if (!pro) {
      setHistory((current) => [...current, { role: 'assistant', content: 'Personal AI Agent is included with Pro.' }]);
      return;
    }
    if (!personalAiAgentEndpoint) {
      setHistory((current) => [...current, { role: 'assistant', content: 'Personal AI Agent endpoint is not configured yet.' }]);
      return;
    }
    if (!window.currentUser?.getIdToken) {
      setHistory((current) => [...current, { role: 'assistant', content: 'Please sign in again before using your personal agent.' }]);
      return;
    }

    const nextHistory = [...history, { role: 'user', content: prompt }];
    setHistory(nextHistory);
    setBusy(true);
    try {
      savePersonalAgentProfile(profile);
      const token = await window.currentUser.getIdToken();
      const response = await fetch(personalAiAgentEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ context: buildContextString(context), messages: nextHistory, agentProfile: profile }),
      });
      const data = await response.json().catch(() => ({}));
      setHistory([...nextHistory, { role: 'assistant', content: response.ok ? (data.reply || '(no response)') : (data.error || `Request failed (${response.status}).`) }]);
    } catch (error) {
      setHistory([...nextHistory, { role: 'assistant', content: `Could not reach your personal agent: ${error.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  if (!personalAiAgentEndpoint) {
    return (
      <div className="ai-card ai-personal-agent ai-personal-locked">
        <div className="ai-card-h">Personal AI Agent <span className="ai-tag ai-tag-pro">Pro</span></div>
        <div className="ai-empty">Personal AI Agent needs the Firebase function endpoint configured.</div>
      </div>
    );
  }

  if (!pro) {
    return (
      <div className="ai-card ai-personal-agent ai-personal-locked">
        <div className="ai-card-h">Personal AI Agent <span className="ai-tag ai-tag-pro">Pro</span></div>
        <p className="ai-agent-lede">A private assistant that remembers your preferences, helps draft replies, and turns room context into your personal next steps.</p>
        <button
          type="button"
          className="ai-btn"
          onClick={() => {
            window.openSettings?.();
            window.switchTab?.('pane-billing', 'tab-btn-billing');
          }}
        >
          <i className="ph-bold ph-crown" /> Unlock with Pro
        </button>
      </div>
    );
  }

  return (
    <div className="ai-card ai-personal-agent">
      <div className="ai-card-h">Personal AI Agent <span className="ai-tag ai-tag-pro">Pro</span><span className="ai-tag">{profile.name || 'Agent'}</span></div>
      <p className="ai-agent-lede">Your private Pro agent uses this room plus your saved preferences. Agent setup stays on this device.</p>
      <details className="ai-agent-settings">
        <summary>Agent setup</summary>
        <label>
          Agent name
          <input value={profile.name} onChange={(event) => updateProfile('name', event.target.value)} maxLength={80} />
        </label>
        <label>
          What should your agent help you with?
          <textarea value={profile.instructions} onChange={(event) => updateProfile('instructions', event.target.value)} rows={3} />
        </label>
        <label>
          Preferred tone
          <input value={profile.tone} onChange={(event) => updateProfile('tone', event.target.value)} maxLength={400} />
        </label>
        <label>
          Memory / preferences
          <textarea value={profile.memory} onChange={(event) => updateProfile('memory', event.target.value)} rows={4} placeholder="Example: Remind me to keep replies short. I prefer action lists over paragraphs." />
        </label>
        <div className="ai-agent-actions">
          <button type="button" className="ai-btn" onClick={persistProfile}><i className="ph-bold ph-floppy-disk" /> Save agent</button>
          <button type="button" className="ai-btn ai-btn-ghost" onClick={resetProfile}><i className="ph-bold ph-arrow-counter-clockwise" /> Reset</button>
          {saved ? <span className="ai-agent-saved">Saved</span> : null}
        </div>
      </details>
      <div className="ai-quick-actions">{quickActions.map(([label, prompt]) => <button key={label} type="button" className="ai-qa" onClick={() => sendPrompt(prompt)}>{label}</button>)}</div>
      <div ref={threadRef} className="ai-thread ai-personal-thread">
        {history.map((message, index) => <div key={`${message.role}-${index}`} className={`ai-bubble ai-bubble-${message.role}`}>{message.content}</div>)}
        {busy ? <div className="ai-bubble ai-bubble-assistant ai-typing"><span /><span /><span /></div> : null}
      </div>
      <form className="ai-chat-form" onSubmit={(event) => { event.preventDefault(); sendPrompt(draft); setDraft(''); }}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} type="text" placeholder={`Ask ${profile.name || 'your agent'} anything…`} autoComplete="off" />
        <button type="submit" className="ai-btn ai-send" title="Send"><i className="ph-bold ph-paper-plane-tilt" /></button>
      </form>
    </div>
  );
}

export function PersonalAIAgentLauncher({ personalAiAgentEndpoint, roomId }) {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    setError('');
    try {
      setContext(await gatherContext(roomId));
    } catch (loadError) {
      setError(`Couldn't load room context: ${loadError.message}`);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="personal-agent-panel-body">
      <div className="personal-agent-panel-intro">
        <span className="ai-tag ai-tag-pro">Pro</span>
        <h3>Personal AI Agent</h3>
        <p>Private assistant for the current room, your saved preferences, and your next steps.</p>
      </div>
      {loading ? <Spinner label="Reading current room…" /> : null}
      {error ? <div className="ai-empty">{error}</div> : null}
      {!loading && context ? (
        <>
          <button type="button" className="ai-btn ai-btn-ghost personal-agent-refresh" onClick={load}>
            <i className="ph-bold ph-arrows-clockwise" /> Refresh room context
          </button>
          <PersonalAIAgent personalAiAgentEndpoint={personalAiAgentEndpoint} context={context} />
        </>
      ) : null}
    </div>
  );
}

function LocalAI({ context }) {
  const [state, setState] = useState({ status: 'idle', message: '', percent: null, summary: '' });

  const generate = () => {
    const transcript = buildTranscript(context);
    if (!transcript.trim()) return setState({ status: 'error', message: 'No conversation text to summarize.', percent: null, summary: '' });
    setState({ status: 'loading', message: modelReady ? 'Summarizing…' : 'Loading model…', percent: null, summary: '' });
    try {
      if (!worker) worker = new Worker('/js/ai-worker.js?v=30', { type: 'module' });
      worker.onmessage = (event) => {
        const data = event.data || {};
        if (data.type === 'progress') setState({ status: 'loading', message: `Downloading model… ${data.pct != null ? `${data.pct}%` : ''}`, percent: data.pct ?? null, summary: '' });
        if (data.type === 'ready') { modelReady = true; setState({ status: 'loading', message: 'Summarizing…', percent: null, summary: '' }); }
        if (data.type === 'result') setState({ status: 'done', message: '', percent: null, summary: data.summary || '(no summary produced)' });
        if (data.type === 'error') setState({ status: 'error', message: `Local model failed: ${data.message}. The instant summary above still works.`, percent: null, summary: '' });
      };
      worker.onerror = (event) => setState({ status: 'error', message: `Couldn't start the local model: ${event.message || 'unknown error'}. The instant summary above still works.`, percent: null, summary: '' });
      worker.postMessage({ type: 'summarize', text: transcript, id: timestamp() });
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

export function AI({ aiChatEndpoint, roomId }) {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateKey] = useState(() => todayKey());

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const nextContext = await gatherContext(roomId);
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
        const nextContext = await gatherContext(roomId);
        if (active) setContext(nextContext);
      } catch (loadError) {
        if (active) setError(`Couldn't load room data: ${loadError.message}`);
      } finally {
        if (active) setLoading(false);
      }
    };
    runInitialLoad();
    return () => { active = false; };
  }, [roomId]);

  const stats = useMemo(() => context ? quickStats(context, dateKey) : [], [context, dateKey]);
  const summary = useMemo(() => context ? extractiveSummary(context) : [], [context]);
  const actions = useMemo(() => context ? actionItems(context) : [], [context]);
  const empty = context && !context.messages.length && !context.tasks.length && !context.docs.length && !context.events.length;

  return (
    <div className="ai-wrap">
      <div className="ai-head">
        <h3><i className="ph-bold ph-sparkle" /> AI Summary</h3>
        <button type="button" id="ai-refresh-btn" className="rh-add-btn" title="Re-read the room" onClick={load}><i className="ph-bold ph-arrows-clockwise" /> Refresh</button>
      </div>
      <div id="ai-output" className="ai-output">
        {loading ? <Spinner label="Reading room…" /> : null}
        {error ? <div className="ai-empty">{error}</div> : null}
        {!loading && context ? <QuickStats stats={stats} /> : null}
        {!loading && context && aiChatEndpoint ? <CloudAI aiChatEndpoint={aiChatEndpoint} context={context} /> : null}
        {!loading && context && !aiChatEndpoint && empty ? <div className="ai-empty">Nothing to summarize in this room yet.</div> : null}
        {!loading && context && !aiChatEndpoint && !empty ? (
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
