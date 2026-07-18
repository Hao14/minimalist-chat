import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, limitToLast, orderByChild, query, ref } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { useRoomTabActivity } from '../shell/roomTabActivity.js';
import './room-ai.css';
import './personalAgent.css';
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
import {
  AI_MODEL_PROFILE_EVENT,
  AI_MODEL_PROFILES,
  loadAiModelProfile,
  normalizeAiModelProfile,
  saveAiModelProfile,
} from './modelProfiles.js';

const stopWords = new Set('a an the and or but if then is are was were be been being to of in on at for with as by from this that these those it its i you he she we they me him her them my your our their not no yes do does did have has had will would can could should just so about into out up down over under again more most some any all'.split(' '));
const ROOM_CONTEXT_CACHE_TTL_MS = 15_000;
const ROOM_CONTEXT_CACHE_LIMIT = 12;
const roomContextCache = new Map();

let worker = null;
let modelReady = false;
const PERSONAL_AGENT_STORAGE_KEY = 'minimalistPersonalAiAgent:v1';
const WINSTON_NAME = 'Winston';
const WINSTON_AVATAR_SRC = '/assets/winston-gorilla-v1.webp';
const DEFAULT_PERSONAL_AGENT_PROFILE = {
  name: WINSTON_NAME,
  instructions: 'Help me stay organized, catch up quickly, draft clear replies, and notice tasks I might miss.',
  tone: 'Modern, concise, friendly, and direct.',
  memory: '',
};
const PERSONAL_AGENT_ROUTING_NOTICE = 'Depending on request volume, Winston may use a different AI system to reply.';
const PERSONAL_AGENT_REPLY_NOTICE = 'AI system chosen automatically based on request volume.';

function timestamp() {
  return Date.now();
}

function aiProviderDisclosure({ provider, model } = {}) {
  const label = {
    'ollama-bridge': 'PC · Ollama',
    'cloudflare-workers-ai': 'Cloudflare Workers AI',
    groq: 'Groq',
    'groq-fallback': 'Groq fallback',
  }[provider] || '';
  if (!label) return '';
  return model ? `${label} · ${model}` : label;
}

function aiQueueNotice(status = {}) {
  if (status.status === 'queued') {
    const position = Math.max(1, Number(status.position) || 1);
    return `Queued safely · ${position === 1 ? 'next request' : `${position} requests in line`}`;
  }
  if (status.status === 'running') {
    return 'Running now on the next available AI system';
  }
  return '';
}

async function readRoomContext(roomId, channelId = 'general') {
  const messagesPath = roomId === 'global'
    ? 'messages'
    : channelId && channelId !== 'general'
      ? `rooms_data/${roomId}/channels/${channelId}/messages`
      : `rooms_data/${roomId}/messages`;
  const [messagesSnapshot, tasksSnapshot, docsSnapshot, eventsSnapshot] = await Promise.all([
    get(query(ref(db, messagesPath), orderByChild('timestamp'), limitToLast(120))).catch(() => null),
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

function isNearScrollBottom(element) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight < 120;
}

function useRespectfulThreadScroll(threadRef, busy, history) {
  const wasNearBottomRef = useRef(true);
  useEffect(() => {
    const element = threadRef.current;
    if (!element) return undefined;
    const update = () => {
      wasNearBottomRef.current = isNearScrollBottom(element);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    return () => element.removeEventListener('scroll', update);
  }, [threadRef]);

  useEffect(() => {
    const element = threadRef.current;
    if (!element) return;
    if (wasNearBottomRef.current) element.scrollTop = element.scrollHeight;
    wasNearBottomRef.current = isNearScrollBottom(element);
  }, [busy, history, threadRef]);
}

function normalizePersonalAgentProfile(profile = {}) {
  return {
    ...DEFAULT_PERSONAL_AGENT_PROFILE,
    ...(profile || {}),
    name: WINSTON_NAME,
  };
}

function loadLocalPersonalAgentProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PERSONAL_AGENT_STORAGE_KEY) || 'null');
    return normalizePersonalAgentProfile(saved);
  } catch {
    return DEFAULT_PERSONAL_AGENT_PROFILE;
  }
}

function saveLocalPersonalAgentProfile(profile) {
  localStorage.setItem(PERSONAL_AGENT_STORAGE_KEY, JSON.stringify(normalizePersonalAgentProfile(profile)));
}

function isProTier() {
  return String(window.userTier || 'free').toLowerCase() === 'pro';
}

function Spinner({ label }) {
  return <div className="ai-progress" role="status" aria-live="polite"><div className="ai-spinner" aria-hidden="true" /><span>{label}</span></div>;
}

function useAiModelProfile() {
  const [profile, setProfile] = useState(loadAiModelProfile);

  useEffect(() => {
    const syncProfile = (event) => setProfile(normalizeAiModelProfile(event?.detail?.profile || loadAiModelProfile()));
    window.addEventListener(AI_MODEL_PROFILE_EVENT, syncProfile);
    return () => window.removeEventListener(AI_MODEL_PROFILE_EVENT, syncProfile);
  }, []);

  const selectProfile = useCallback((value) => {
    const next = saveAiModelProfile(value);
    setProfile(next);
  }, []);

  return [profile, selectProfile];
}

function AiModelProfilePicker({ disabled = false, onChange, value }) {
  const selectedIndex = Math.max(0, AI_MODEL_PROFILES.findIndex((profile) => profile.id === value));
  const selectByIndex = (index, source) => {
    const profile = AI_MODEL_PROFILES[(index + AI_MODEL_PROFILES.length) % AI_MODEL_PROFILES.length];
    onChange(profile.id);
    window.requestAnimationFrame(() => {
      source?.parentElement?.querySelector?.(`[data-model-profile="${profile.id}"]`)?.focus?.();
    });
  };

  return (
    <div className="ai-model-profile-picker" role="radiogroup" aria-label="AI response model">
      {AI_MODEL_PROFILES.map((profile) => {
        const selected = profile.id === value;
        return (
          <button
            key={profile.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={selected ? 'is-selected' : ''}
            data-model-profile={profile.id}
            disabled={disabled}
            tabIndex={selected ? 0 : -1}
            title={`${profile.label}: ${profile.description}`}
            onClick={() => onChange(profile.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                selectByIndex(selectedIndex + 1, event.currentTarget);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                selectByIndex(selectedIndex - 1, event.currentTarget);
              } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                selectByIndex(event.key === 'Home' ? 0 : AI_MODEL_PROFILES.length - 1, event.currentTarget);
              }
            }}
          >
            <i className={`ph-bold ${profile.id === 'fast' ? 'ph-lightning' : 'ph-brain'}`} aria-hidden="true" />
            <span>{profile.label}</span>
            {selected ? <i className="ph-bold ph-check ai-model-profile-check" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function statusTone(state) {
  if (state === 'ready') return 'ready';
  if (state === 'standby') return 'standby';
  if (state === 'checking' || state === 'warming') return 'loading';
  return 'error';
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

async function gatherContext(roomId, channelId = 'general', { force = false } = {}) {
  const cacheKey = `${window.currentUser?.uid || 'anonymous'}:${roomId}:${channelId || 'general'}`;
  const cached = roomContextCache.get(cacheKey);
  if (cached?.promise) return cached.promise;
  if (!force && cached?.value && cached.expiresAt > Date.now()) {
    roomContextCache.delete(cacheKey);
    roomContextCache.set(cacheKey, cached);
    return cached.value;
  }

  const request = readRoomContext(roomId, channelId);
  roomContextCache.set(cacheKey, {
    expiresAt: cached?.expiresAt || 0,
    promise: request,
    value: cached?.value || null,
  });
  try {
    const value = await request;
    roomContextCache.delete(cacheKey);
    roomContextCache.set(cacheKey, {
      expiresAt: Date.now() + ROOM_CONTEXT_CACHE_TTL_MS,
      promise: null,
      value,
    });
    while (roomContextCache.size > ROOM_CONTEXT_CACHE_LIMIT) {
      roomContextCache.delete(roomContextCache.keys().next().value);
    }
    return value;
  } catch (error) {
    if (roomContextCache.get(cacheKey)?.promise === request) roomContextCache.delete(cacheKey);
    throw error;
  }
}

function bananaTierLabel(value) {
  const tier = String(value || '').trim();
  if (!tier) return '';
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function BananaMeter({ gateway = false, status = null, usage }) {
  const { fiveHour, weekly } = bananaQuotaFromUsage(usage);
  const tier = bananaTierLabel(usage?.bananaTier || usage?.tier || status?.bananaTier || status?.tier);
  if (!gateway && !fiveHour && !tier) return null;
  const fiveHourReset = bananaResetLabel(fiveHour?.resetsAt);
  const weeklyReset = bananaResetLabel(weekly?.resetsAt);
  return (
    <div className="ai-banana-meter" role="status" aria-live="polite" title="Bananas protect the shared public AI gateway from abuse. The short window resets every 5 hours, and the weekly cap resets once a week by subscription tier.">
      <i className="ph-bold ph-shield-check" aria-hidden="true" />
      {fiveHour ? (
        <span>
          {tier ? `${tier} · ` : ''}{fiveHour.used}/{fiveHour.limit} Bananas this 5h{fiveHourReset ? ` · resets ${fiveHourReset}` : ''}
          {weekly ? ` · weekly ${weekly.used}/${weekly.limit}${weeklyReset ? ` resets ${weeklyReset}` : ''}` : ''}
        </span>
      ) : (
        <span>
          {tier ? `${tier} · ` : ''}Bananas are AI credits that protect the shared gateway. They refill every 5 hours, with a weekly cap by plan. Live usage appears after your first request.
        </span>
      )}
    </div>
  );
}

function personalLifecycleDetails(status, agentName) {
  const state = status?.state || 'standby';
  const name = String(agentName || WINSTON_NAME).trim() || WINSTON_NAME;
  if (state === 'ready') {
    return {
      state,
      icon: 'ph-check',
      title: 'Ready when you are',
      description: `${name} is connected and ready to help.`,
    };
  }
  if (state === 'checking' || state === 'warming') {
    return {
      state: 'warming',
      icon: 'ph-spinner-gap',
      title: `Waking ${name}`,
      description: 'Starting the protected model and preparing your room context. This can take up to 30 seconds.',
    };
  }
  if (state === 'missing-model') {
    return {
      state,
      icon: 'ph-download-simple',
      title: 'Model setup required',
      description: status?.message || 'The selected model needs to be installed in Minimalist Analysis before it can answer.',
    };
  }
  if (state === 'blocked') {
    return {
      state,
      icon: 'ph-lock-key',
      title: 'Access needs attention',
      description: status?.message || 'Sign in again or ask an administrator to check the secure AI configuration.',
    };
  }
  if (state === 'unavailable' || state === 'offline' || state === 'request-failed') {
    return {
      state: 'unavailable',
      icon: 'ph-cloud-slash',
      title: `${name} can’t be reached`,
      description: 'The secure gateway did not become ready. The protected host may be unavailable right now.',
      action: 'Check again',
    };
  }
  return {
    state: 'standby',
    icon: 'ph-moon-stars',
    title: 'Resting until needed',
    description: `${name} may be resting after being idle. Wake-up can take up to 30 seconds.`,
    action: `Wake ${name}`,
  };
}

function PersonalAgentLifecycle({ agentName, onWake, status }) {
  const details = personalLifecycleDetails(status, agentName);
  const currentStep = details.state === 'ready' ? 2 : details.state === 'warming' ? 1 : 0;
  return (
    <section className={`pa-lifecycle pa-lifecycle-${details.state}`} aria-live="polite" aria-busy={details.state === 'warming' ? 'true' : 'false'}>
      <div className="pa-lifecycle-main">
        <div className="pa-lifecycle-icon" aria-hidden="true"><i className={`ph-bold ${details.icon}`} /></div>
        <div className="pa-lifecycle-copy">
          <h3>{details.title}</h3>
          <p>{details.description}</p>
        </div>
        {details.action ? (
          <button type="button" className="pa-lifecycle-action" onClick={onWake}>{details.action}</button>
        ) : null}
      </div>
      {details.state === 'warming' ? (
        <div className="pa-wake-progress" role="status">
          <span>Secure wake-up in progress</span>
          <div aria-hidden="true"><i /></div>
        </div>
      ) : null}
      {details.state !== 'ready' ? (
        <div className="pa-lifecycle-steps" aria-label="Agent availability stages">
          {[
            ['ph-moon-stars', 'Ready on demand', 'May be resting'],
            ['ph-spinner-gap', 'Waking', 'Starting securely'],
            ['ph-circle', 'Ready', 'Ready to chat'],
          ].map(([icon, label, hint], index) => (
            <div key={label} className={`${index === currentStep ? 'is-current' : ''}${index < currentStep ? ' is-complete' : ''}`}>
              <i className={`ph-bold ${icon}`} aria-hidden="true" />
              <span><strong>{label}</strong><small>{hint}</small></span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PersonalBananaSummary({ gateway, status, usage }) {
  const { fiveHour } = bananaQuotaFromUsage(usage);
  const tier = bananaTierLabel(usage?.bananaTier || usage?.tier || status?.bananaTier || status?.tier);
  if (!gateway) return <span className="pa-banana-summary">Local profile</span>;
  return (
    <span className="pa-banana-summary" title="Bananas protect the shared AI gateway from abuse.">
      <span>Bananas</span>
      <span aria-hidden="true">🍌</span>
      <strong>{fiveHour ? `${fiveHour.used}/${fiveHour.limit}` : tier ? `${tier} plan` : 'Protected'}</strong>
    </span>
  );
}

const ROOM_AI_QUICK_ACTIONS = [
  {
    label: 'Catch me up',
    hint: 'The important parts, fast',
    icon: 'ph-lightning',
    prompt: 'Catch me up on this room. Use sections: What changed, Key decisions, Open questions, and Next steps.',
  },
  {
    label: 'Find decisions',
    hint: 'What the room agreed on',
    icon: 'ph-check-circle',
    prompt: 'Find the decisions made in this room. Separate confirmed decisions from proposals or unresolved questions.',
  },
  {
    label: 'Turn into tasks',
    hint: 'Owners, work, and dates',
    icon: 'ph-list-checks',
    prompt: "Extract the action items from this room. For each: owner — task — due date or priority. Use 'Owner not specified' if unknown.",
  },
  {
    label: 'Spot patterns',
    hint: 'Themes that keep returning',
    icon: 'ph-chart-line-up',
    prompt: 'What topics, blockers, or themes keep recurring in this room? Rank the strongest patterns and explain each briefly.',
  },
];

function roomAiStatusLabel(status) {
  const state = status?.state || 'checking';
  if (state === 'ready') return 'Ready';
  if (state === 'standby') return 'Ready on demand';
  if (state === 'checking') return 'Checking AI';
  if (state === 'warming') return 'Warming up';
  return 'Needs attention';
}

function RoomAIStatus({ onRetry, status }) {
  const state = status?.state || 'checking';
  return (
    <div className={`room-ai-status room-ai-status-${statusTone(state)}`} role="status" aria-live="polite" aria-label={`Room AI status: ${roomAiStatusLabel(status)}`}>
      <span className="room-ai-status-dot" aria-hidden="true" />
      <span>{roomAiStatusLabel(status)}</span>
      {state !== 'ready' && state !== 'standby' && state !== 'checking' && state !== 'warming' ? (
        <button type="button" onClick={onRetry} aria-label="Check Room AI again">Retry</button>
      ) : null}
    </div>
  );
}

function RoomAICreditStatus({ gateway, status, usage }) {
  const { fiveHour, weekly } = bananaQuotaFromUsage(usage);
  const tier = bananaTierLabel(usage?.bananaTier || usage?.tier || status?.bananaTier || status?.tier);
  if (!gateway) {
    return (
      <div className="room-ai-credit-copy">
        <strong>Local connection</strong>
        <span>Requests use your configured Ollama connection.</span>
      </div>
    );
  }
  if (!fiveHour) {
    return (
      <div className="room-ai-credit-copy">
        <strong>{tier ? `${tier} Bananas` : 'Bananas'}</strong>
        <span>Live AI credit usage appears after your first request.</span>
      </div>
    );
  }
  const fiveHourReset = bananaResetLabel(fiveHour.resetsAt);
  const weeklyReset = bananaResetLabel(weekly?.resetsAt);
  const percent = fiveHour.limit > 0 ? Math.min(100, Math.max(0, (fiveHour.used / fiveHour.limit) * 100)) : 0;
  return (
    <div className="room-ai-credit-copy">
      <div className="room-ai-credit-line">
        <strong>{tier ? `${tier} · ` : ''}{fiveHour.used}/{fiveHour.limit} Bananas</strong>
        <span>{fiveHourReset ? `Resets ${fiveHourReset}` : '5-hour window'}</span>
      </div>
      <div className="room-ai-credit-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
      {weekly ? <span>Weekly {weekly.used}/{weekly.limit}{weeklyReset ? ` · resets ${weeklyReset}` : ''}</span> : null}
    </div>
  );
}

function RoomAIContextRail({ actions, context, localAiConfig, onClose, open, status, usage }) {
  const recentContributors = useMemo(
    () => new Set(context.messages.map((message) => message.name).filter(Boolean)).size,
    [context.messages]
  );
  const openTasks = context.tasks.filter((task) => !task.done).length;
  const gateway = shouldUseGatewayAi(getLocalAiConfig(localAiConfig));
  const metrics = [
    ['ph-chat-circle-dots', 'Recent messages', context.messages.length],
    ['ph-users-three', 'Recent contributors', recentContributors],
    ['ph-file-text', 'Docs', context.docs.length],
    ['ph-list-checks', 'Open tasks', openTasks],
    ['ph-calendar-blank', 'Events', context.events.length],
  ];
  return (
    <aside className={`room-ai-rail${open ? ' is-open' : ''}`} aria-label="Room AI context">
      <div className="room-ai-rail-head">
        <div>
          <span className="room-ai-eyebrow">Authorized context</span>
          <h2>What AI can use</h2>
        </div>
        <button type="button" className="room-ai-icon-btn room-ai-rail-close" onClick={onClose} aria-label="Close context panel">×</button>
      </div>
      <p className="room-ai-rail-intro">Room access is checked before the AI reads any server-side context.</p>
      <div className="room-ai-metrics">
        {metrics.map(([icon, label, value]) => (
          <div className="room-ai-metric" key={label}>
            <span><i className={`ph-bold ${icon}`} aria-hidden="true" /></span>
            <div><strong>{value}</strong><small>{label}</small></div>
          </div>
        ))}
      </div>
      <section className="room-ai-rail-section">
        <div className="room-ai-rail-section-title"><i className="ph-bold ph-shield-check" aria-hidden="true" /> AI credits</div>
        <RoomAICreditStatus gateway={gateway} status={status} usage={usage} />
      </section>
      {actions.length ? (
        <section className="room-ai-rail-section">
          <div className="room-ai-rail-section-title"><i className="ph-bold ph-list-checks" aria-hidden="true" /> Open action items</div>
          <ul className="room-ai-action-list">
            {actions.slice(0, 4).map((item) => <li key={item.text}><span>{item.text}</span><small>{item.owner}</small></li>)}
          </ul>
        </section>
      ) : null}
      <details className="room-ai-utility">
        <summary><span><i className="ph-bold ph-cpu" aria-hidden="true" /> On-device summary</span><i className="ph-bold ph-caret-down" aria-hidden="true" /></summary>
        <p>Optional browser-only model. The first run downloads its files to this device.</p>
        <LocalAI context={context} />
      </details>
    </aside>
  );
}

function RoomAgent({ actions, active, context, localAiConfig, roomId, roomName, summary, channelId = 'general' }) {
  const [history, setHistory] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [bananaUsage, setBananaUsage] = useState(null);
  const [notice, setNotice] = useState('');
  const [queueNotice, setQueueNotice] = useState('');
  const [railOpen, setRailOpen] = useState(false);
  const threadRef = useRef(null);
  const composerRef = useRef(null);
  const requestAbortRef = useRef(null);
  const [modelProfile, selectModelProfile] = useAiModelProfile();
  const config = useMemo(
    () => getLocalAiConfig({ ...localAiConfig, modelProfile }),
    [localAiConfig, modelProfile],
  );
  const gateway = shouldUseGatewayAi(config);
  const [agentStatus, setAgentStatus] = useState(() => gateway
    ? { ...config, state: 'standby', provider: 'gateway', message: localAiStatusMessage({ ...config, state: 'standby', provider: 'gateway' }) }
    : { ...config, state: 'checking', message: localAiStatusMessage({ ...config, state: 'checking' }) });
  const displayRoomName = String(roomName || (roomId === 'global' ? 'Global Chat' : 'this room')).trim();
  const hasRoomContext = context.messages.length || context.tasks.length || context.docs.length || context.events.length;
  const statusNeedsAttention = !['ready', 'standby', 'checking', 'warming'].includes(agentStatus?.state || 'checking');
  const changeModelProfile = useCallback((profile) => {
    setNotice('');
    setQueueNotice('');
    setAgentStatus(gateway
      ? { ...config, state: 'standby', provider: 'gateway', modelProfile: profile, message: localAiStatusMessage({ ...config, state: 'standby', provider: 'gateway', modelProfile: profile }) }
      : { ...config, state: 'checking', modelProfile: profile, message: localAiStatusMessage({ ...config, state: 'checking', modelProfile: profile }) });
    selectModelProfile(profile);
  }, [config, gateway, selectModelProfile]);

  useRespectfulThreadScroll(threadRef, busy, history);

  useEffect(() => () => requestAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!active) requestAbortRef.current?.abort();
  }, [active]);

  const refreshStatus = useCallback(async () => {
    const nextState = gateway ? 'warming' : 'checking';
    setAgentStatus({ ...config, state: nextState, message: localAiStatusMessage({ ...config, state: nextState }), model: config.model });
    setNotice('');
    try {
      const nextStatus = await getLocalAiStatus(config, { wake: gateway });
      setAgentStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      const nextStatus = { state: error?.state || 'request-failed', message: localAiStatusMessage(error), model: config.model };
      setAgentStatus(nextStatus);
      return nextStatus;
    }
  }, [config, gateway]);

  useEffect(() => {
    if (!active || gateway) return undefined;
    let subscribed = true;
    getLocalAiStatus(config).then((nextStatus) => {
      if (subscribed) setAgentStatus(nextStatus);
    });
    return () => { subscribed = false; };
  }, [active, config, gateway]);

  const sendPrompt = async (text) => {
    const prompt = text.trim();
    if (!prompt || busy) return false;
    const nextHistory = [...history, { role: 'user', content: prompt }];
    setHistory(nextHistory);
    setNotice('');
    setQueueNotice('');
    setBusy(true);
    const requestController = new AbortController();
    requestAbortRef.current = requestController;
    try {
      let currentStatus = agentStatus;
      if (currentStatus?.state !== 'ready') currentStatus = await refreshStatus();
      if (currentStatus?.state !== 'ready') {
        setNotice(currentStatus.message || localAiStatusMessage(currentStatus));
        return true;
      }
      const result = await askRoomAgent({
        context,
        messages: nextHistory,
        config,
        roomId,
        channelId,
        signal: requestController.signal,
        onQueueUpdate: (status) => setQueueNotice(aiQueueNotice(status)),
      });
      setBananaUsage(result);
      const { reply } = result;
      setHistory([...nextHistory, {
        role: 'assistant',
        content: reply,
        provider: result.provider || '',
        model: result.model || '',
      }]);
    } catch (error) {
      if (requestController.signal.aborted) {
        setNotice('');
        return true;
      }
      setQueueNotice('');
      const message = localAiStatusMessage(error);
      if (error?.details?.bananas) setBananaUsage(error.details.bananas);
      setAgentStatus({ state: error?.state || 'request-failed', message, model: config.model });
      setNotice(message);
    } finally {
      if (requestAbortRef.current === requestController) requestAbortRef.current = null;
      setQueueNotice('');
      setBusy(false);
    }
    return true;
  };

  const resizeComposer = (element) => {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  };

  const submitDraft = async (event) => {
    event.preventDefault();
    if (!(await sendPrompt(draft))) return;
    setDraft('');
    if (composerRef.current) composerRef.current.style.height = 'auto';
  };

  return (
    <div className="room-ai-shell">
      <main className="room-ai-main">
        <header className="room-ai-header">
          <div className="room-ai-title-mark" aria-hidden="true"><i className="ph-bold ph-sparkle" /></div>
          <div className="room-ai-title-copy">
            <span className="room-ai-eyebrow">Room workspace</span>
            <h1>Room AI</h1>
          </div>
          <AiModelProfilePicker disabled={busy} value={modelProfile} onChange={changeModelProfile} />
          <RoomAIStatus status={agentStatus} onRetry={refreshStatus} />
          <div className="room-ai-header-actions">
            <button type="button" className="room-ai-icon-btn room-ai-context-toggle" onClick={() => setRailOpen(true)} aria-label="Open AI context" title="Context"><i className="ph-bold ph-squares-four" aria-hidden="true" /></button>
            <button type="button" className="room-ai-icon-btn" onClick={refreshStatus} aria-label="Refresh AI status" title="Refresh AI"><i className="ph-bold ph-arrows-clockwise" aria-hidden="true" /></button>
          </div>
        </header>

        <div ref={threadRef} id="ai-thread" className={`room-ai-canvas${history.length ? ' has-thread' : ''}`} aria-live="polite" aria-relevant="additions text">
          {!history.length ? (
            <div className="room-ai-welcome">
              <div className="room-ai-orbit" aria-hidden="true"><span /><span /><i className="ph-bold ph-sparkle" /></div>
              <span className="room-ai-eyebrow">Ask across this room</span>
              <h2>What should we find in {displayRoomName}?</h2>
              <p>{hasRoomContext ? 'Turn the conversation into a clear answer, decision, or next step.' : 'This room is quiet, but Room AI is ready when the conversation starts.'}</p>
              <div className="room-ai-quick-grid">
                {ROOM_AI_QUICK_ACTIONS.map((action) => (
                  <button key={action.label} type="button" disabled={busy} onClick={() => sendPrompt(action.prompt)}>
                    <i className={`ph-bold ${action.icon}`} aria-hidden="true" />
                    <span><strong>{action.label}</strong><small>{action.hint}</small></span>
                    <span className="room-ai-action-arrow" aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
              {summary.length ? (
                <section className="room-ai-instant-snapshot" aria-label="Instant room snapshot">
                  <div><i className="ph-bold ph-clock" aria-hidden="true" /><span><strong>Instant room snapshot</strong><small>Extracted locally from recent messages</small></span></div>
                  <ul>{summary.slice(0, 3).map((sentence) => <li key={sentence}>{sentence}</li>)}</ul>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="room-ai-thread">
              {history.map((message, index) => (
                <article key={`${message.role}-${index}`} className={`room-ai-message room-ai-message-${message.role}`}>
                  <div className="room-ai-message-avatar" aria-hidden="true">{message.role === 'assistant' ? <i className="ph-bold ph-sparkle" /> : 'You'}</div>
                  <div>
                    <span>{message.role === 'assistant' ? 'Room AI' : 'You'}</span>
                    <p>{message.content}</p>
                    {message.role === 'assistant' && message.provider ? <small className="room-ai-provider-disclosure">{aiProviderDisclosure(message)}</small> : null}
                  </div>
                </article>
              ))}
              {busy ? (
                <article className="room-ai-message room-ai-message-assistant" role="status" aria-label="Room AI is replying">
                  <div className="room-ai-message-avatar" aria-hidden="true"><i className="ph-bold ph-sparkle" /></div>
                  <div><span>Room AI</span><div className="room-ai-typing"><i /><i /><i /></div></div>
                </article>
              ) : null}
            </div>
          )}
        </div>

        <div className="room-ai-composer-zone">
          {queueNotice ? (
            <div className="room-ai-status room-ai-status-loading room-ai-queue-status" role="status" aria-live="polite">
              <i className="ph-bold ph-clock-countdown" aria-hidden="true" />
              <span>{queueNotice}</span>
            </div>
          ) : null}
          {(notice || statusNeedsAttention) ? (
            <div className="room-ai-agent-alert" role="alert">
              <i className="ph-bold ph-warning-circle" aria-hidden="true" />
              <span>{notice || agentStatus.message || 'Room AI needs a quick check before it can answer.'}</span>
              <button type="button" onClick={refreshStatus}>Retry</button>
            </div>
          ) : null}
          <form id="ai-chat-form" className="room-ai-composer" aria-label="Ask Room AI" onSubmit={submitDraft}>
            <textarea
              ref={composerRef}
              id="ai-chat-input"
              rows="1"
              value={draft}
              onChange={(event) => { setDraft(event.target.value); resizeComposer(event.currentTarget); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={`Ask anything about ${displayRoomName}…`}
              autoComplete="off"
              aria-label="Message Room AI"
            />
            <button type="submit" id="ai-send-btn" title="Send" aria-label="Send to Room AI" disabled={busy || !draft.trim()}><i className="ph-bold ph-paper-plane-tilt" aria-hidden="true" /></button>
          </form>
          <div className="room-ai-composer-meta"><span><i className="ph-bold ph-shield-check" aria-hidden="true" /> Room access checked</span><span>Enter to send · Shift + Enter for a new line</span></div>
          {gateway ? <p className="room-ai-routing-disclosure">If cloud overflow is enabled, busy requests may be processed by Cloudflare or Groq. Each answer shows its provider.</p> : null}
        </div>
      </main>
      <RoomAIContextRail
        actions={actions}
        context={context}
        localAiConfig={config}
        onClose={() => setRailOpen(false)}
        open={railOpen}
        status={agentStatus}
        usage={bananaUsage}
      />
      {railOpen ? <button type="button" className="room-ai-rail-backdrop" onClick={() => setRailOpen(false)} aria-label="Close context panel" /> : null}
    </div>
  );
}

const EMPTY_CONTEXT = { messages: [], tasks: [], docs: [], events: [] };

const PERSONAL_QUICK_ACTIONS = [
  { label: 'Catch me up', hint: 'What changed recently', icon: 'ph-lightning', prompt: 'Catch me up on this room like my personal assistant. Focus on what matters to me and what changed recently.' },
  { label: 'My next steps', hint: 'What I should do now', icon: 'ph-list-checks', prompt: 'Based on this room, what should I personally do next? Separate urgent items from nice-to-haves.' },
];

function WinstonAvatar({ alt = '', className = '' }) {
  return (
    <img
      className={`pa-winston-avatar ${className}`.trim()}
      src={WINSTON_AVATAR_SRC}
      alt={alt}
      width="512"
      height="512"
      decoding="async"
      draggable="false"
    />
  );
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
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState('');
  const [profileLoadError, setProfileLoadError] = useState('');
  const [bananaUsage, setBananaUsage] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [requestNotice, setRequestNotice] = useState('');
  const [queueNotice, setQueueNotice] = useState('');
  const threadRef = useRef(null);
  const requestAbortRef = useRef(null);
  const pro = isProTier();
  const ctx = context || EMPTY_CONTEXT;
  const [modelProfile, selectModelProfile] = useAiModelProfile();
  const config = useMemo(
    () => getLocalAiConfig({ ...localAiConfig, modelProfile }),
    [localAiConfig, modelProfile],
  );
  const serverProfile = shouldUseServerAiProfile(config);
  const gateway = shouldUseGatewayAi(config);
  const [agentStatus, setAgentStatus] = useState(() => gateway
    ? { ...config, state: 'standby', provider: 'gateway', message: localAiStatusMessage({ ...config, state: 'standby', provider: 'gateway' }) }
    : { ...config, state: 'checking', message: localAiStatusMessage({ ...config, state: 'checking' }) });
  const wakeRequestRef = useRef(null);
  const wakeTimerRef = useRef(null);
  const statusRequestIdRef = useRef(0);
  const lifecycleBusy = agentStatus?.state === 'checking' || agentStatus?.state === 'warming';
  const changeModelProfile = useCallback((nextProfile) => {
    setRequestNotice('');
    setQueueNotice('');
    setAgentStatus(gateway
      ? { ...config, state: 'standby', provider: 'gateway', modelProfile: nextProfile, message: localAiStatusMessage({ ...config, state: 'standby', provider: 'gateway', modelProfile: nextProfile }) }
      : { ...config, state: 'checking', modelProfile: nextProfile, message: localAiStatusMessage({ ...config, state: 'checking', modelProfile: nextProfile }) });
    selectModelProfile(nextProfile);
  }, [config, gateway, selectModelProfile]);

  const contextBits = useMemo(() => {
    const bits = [];
    if (ctx.messages.length) bits.push(`${ctx.messages.length} messages`);
    if (ctx.tasks.length) bits.push(`${ctx.tasks.length} tasks`);
    if (ctx.events.length) bits.push(`${ctx.events.length} events`);
    if (ctx.docs.length) bits.push(`${ctx.docs.length} docs`);
    return bits;
  }, [ctx]);

  useRespectfulThreadScroll(threadRef, busy, history);

  useEffect(() => () => requestAbortRef.current?.abort(), []);

  const wakeAgent = useCallback(() => {
    if (wakeRequestRef.current) return wakeRequestRef.current;
    const requestId = ++statusRequestIdRef.current;
    const checking = {
      ...config,
      state: 'checking',
      provider: config.provider,
      message: localAiStatusMessage({ ...config, state: 'checking' }),
    };
    setRequestNotice('');
    setAgentStatus(checking);
    window.clearTimeout(wakeTimerRef.current);
    wakeTimerRef.current = window.setTimeout(() => {
      if (requestId !== statusRequestIdRef.current) return;
      setAgentStatus((current) => current?.state === 'checking' ? {
        ...current,
        state: 'warming',
        message: localAiStatusMessage({ ...config, state: 'warming' }),
      } : current);
    }, 350);

    const request = getLocalAiStatus(config, { wake: gateway })
      .then((nextStatus) => {
        if (requestId === statusRequestIdRef.current) setAgentStatus(nextStatus);
        return nextStatus;
      })
      .finally(() => {
        window.clearTimeout(wakeTimerRef.current);
        if (requestId === statusRequestIdRef.current) wakeRequestRef.current = null;
      });
    wakeRequestRef.current = request;
    return request;
  }, [config, gateway]);

  useEffect(() => {
    const requestId = ++statusRequestIdRef.current;
    window.clearTimeout(wakeTimerRef.current);
    wakeRequestRef.current = null;
    if (gateway) {
      return () => { statusRequestIdRef.current += 1; };
    }

    const timer = window.setTimeout(() => {
      if (requestId !== statusRequestIdRef.current) return;
      setAgentStatus({ ...config, state: 'checking', message: localAiStatusMessage({ ...config, state: 'checking' }) });
      getLocalAiStatus(config).then((nextStatus) => {
        if (requestId === statusRequestIdRef.current) setAgentStatus(nextStatus);
      });
    }, 0);
    return () => {
      statusRequestIdRef.current += 1;
      window.clearTimeout(timer);
      window.clearTimeout(wakeTimerRef.current);
    };
  }, [config, gateway]);

  useEffect(() => {
    let active = true;
    if (!serverProfile) {
      const timer = window.setTimeout(() => {
        if (active) setProfileLoadError('');
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }
    loadPersonalAiProfileFromServer({ config })
      .then((nextProfile) => {
        if (!active) return;
        setProfileLoadError('');
        if (nextProfile) setProfile(normalizePersonalAgentProfile(nextProfile));
      })
      .catch((profileError) => {
        if (active) setProfileLoadError(profileError?.message || 'Your saved Winston setup could not be synced.');
      });
    return () => { active = false; };
  }, [config, serverProfile]);

  const updateProfile = (field, value) => setProfile((current) => ({ ...current, [field]: value }));

  const markProfileSaved = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const persistProfile = async () => {
    setProfileSaving(true);
    setProfileSaveError('');
    try {
      if (serverProfile) {
        const savedProfile = await savePersonalAiProfileToServer({ profile, config });
        if (savedProfile) setProfile(normalizePersonalAgentProfile(savedProfile));
      } else {
        saveLocalPersonalAgentProfile(profile);
      }
      markProfileSaved();
    } catch (saveError) {
      const message = saveError?.message || 'Could not save Winston’s setup.';
      setProfileSaveError(message);
      window.showToast?.(message, true);
    } finally {
      setProfileSaving(false);
    }
  };

  const resetProfile = async () => {
    setProfileSaving(true);
    setProfileSaveError('');
    try {
      setProfile(DEFAULT_PERSONAL_AGENT_PROFILE);
      if (serverProfile) {
        await savePersonalAiProfileToServer({ profile: DEFAULT_PERSONAL_AGENT_PROFILE, config });
      } else {
        saveLocalPersonalAgentProfile(DEFAULT_PERSONAL_AGENT_PROFILE);
      }
      markProfileSaved();
    } catch (saveError) {
      const message = saveError?.message || 'Could not reset Winston’s setup.';
      setProfileSaveError(message);
      window.showToast?.(message, true);
    } finally {
      setProfileSaving(false);
    }
  };

  const sendPrompt = async (text) => {
    const prompt = text.trim();
    if (!prompt || busy) return false;
    if (!window.currentUser?.getIdToken) {
      const message = 'Please sign in again before using Winston.';
      setAgentStatus({ ...config, state: 'blocked', message });
      setRequestNotice(message);
      return false;
    }

    const nextHistory = [...history, { role: 'user', content: prompt }];
    setBusy(true);
    setRequestNotice('');
    setQueueNotice('');
    const requestController = new AbortController();
    requestAbortRef.current = requestController;
    let promptAccepted = false;
    try {
      let currentStatus = agentStatus;
      if (currentStatus?.state !== 'ready') currentStatus = await wakeAgent();
      if (currentStatus?.state !== 'ready') {
        setRequestNotice(currentStatus?.message || localAiStatusMessage(currentStatus));
        return false;
      }
      if (serverProfile) {
        await savePersonalAiProfileToServer({ profile, config }).catch(() => null);
      } else {
        saveLocalPersonalAgentProfile(profile);
      }
      setHistory(nextHistory);
      promptAccepted = true;
      const result = await askPersonalAgent({
        context: ctx,
        messages: nextHistory,
        profile,
        userName: window.userProfileName || window.currentUser?.displayName || 'the user',
        config,
        roomId,
        channelId,
        signal: requestController.signal,
        onQueueUpdate: (status) => setQueueNotice(aiQueueNotice(status)),
      });
      setBananaUsage(result);
      const { reply } = result;
      setHistory([...nextHistory, {
        role: 'assistant',
        content: reply,
        provider: result.provider || '',
        model: result.model || '',
      }]);
      setAgentStatus((current) => ({
        ...current,
        state: 'ready',
        model: result.model || current?.model || config.model,
        modelProfile: result.modelProfile || config.modelProfile,
        message: localAiStatusMessage({
          ...config,
          state: 'ready',
          provider: config.provider,
          model: result.model || config.model,
          modelProfile: result.modelProfile || config.modelProfile,
        }),
      }));
      setRequestNotice('');
    } catch (requestError) {
      setQueueNotice('');
      const statusCode = Number(requestError?.details?.status || 0);
      const affectsAvailability = requestError?.state === 'offline' || statusCode >= 500 || (!statusCode && requestError?.state === 'request-failed');
      const nextState = ['blocked', 'missing-model'].includes(requestError?.state)
        ? requestError.state
        : gateway && affectsAvailability
          ? 'unavailable'
          : requestError?.state || 'request-failed';
      const message = nextState === 'unavailable'
        ? localAiStatusMessage({ ...config, state: 'unavailable', provider: 'gateway' })
        : localAiStatusMessage({ ...requestError, state: nextState, provider: config.provider, model: config.model, modelProfile: config.modelProfile });
      if (requestError?.details?.bananas) setBananaUsage(requestError.details.bananas);
      if (!requestError?.details?.bananas || ['blocked', 'missing-model', 'unavailable'].includes(nextState)) {
        setAgentStatus({ ...config, state: nextState, message, model: config.model });
      }
      setRequestNotice(requestError?.message || message);
    } finally {
      if (requestAbortRef.current === requestController) requestAbortRef.current = null;
      setQueueNotice('');
      setBusy(false);
    }
    return promptAccepted;
  };

  const openProPlan = async () => {
    const panel = document.getElementById('personal-ai-agent-panel');
    const triggerId = panel?.dataset?.personalAgentSurface === 'mobile'
      ? 'open-personal-agent-btn-mobile'
      : 'open-personal-agent-btn';
    const returnTrigger = document.getElementById(triggerId);
    window.closePersonalAgent?.({ restoreFocus: false });
    returnTrigger?.focus?.({ preventScroll: true });
    await window.openSettings?.();
    window.switchTab?.('pane-billing', 'tab-btn-billing');
    window.requestAnimationFrame(() => document.getElementById('tab-btn-billing')?.focus?.({ preventScroll: true }));
  };

  // Pro upsell.
  if (!pro) {
    return (
      <PersonalAgentShell className="pa-lock-screen">
        <header className="pa-lock-header">
          <WinstonAvatar className="pa-lock-header-avatar" />
          <div className="pa-lock-identity">
            <strong>{WINSTON_NAME}</strong>
            <span>Private AI companion</span>
          </div>
          <span className="pa-pro">Pro</span>
        </header>

        <main className="pa-lock-body">
          <div className="pa-lock-portrait-wrap">
            <WinstonAvatar className="pa-lock-portrait" alt="Winston, a friendly gorilla AI companion" />
            <span className="pa-lock-badge" aria-label="Winston is locked">
              <i className="ph-bold ph-lock-key" aria-hidden="true" />
            </span>
          </div>

          <div className="pa-lock-copy">
            <span>Your private AI companion</span>
            <h2>Meet Winston</h2>
            <p>Winston learns how you like to work, helps you catch up, and turns busy rooms into clear next steps.</p>
          </div>

          <ul className="pa-lock-features">
            <li>
              <span className="pa-lock-feature-icon"><i className="ph-bold ph-brain" aria-hidden="true" /></span>
              <span><strong>Works your way</strong><small>Remembers your tone, instructions, and preferences.</small></span>
            </li>
            <li>
              <span className="pa-lock-feature-icon"><i className="ph-bold ph-list-checks" aria-hidden="true" /></span>
              <span><strong>Finds the next move</strong><small>Surfaces the tasks and decisions that matter to you.</small></span>
            </li>
            <li>
              <span className="pa-lock-feature-icon"><i className="ph-bold ph-shield-check" aria-hidden="true" /></span>
              <span><strong>Protected by design</strong><small>Room access is checked before Winston uses context.</small></span>
            </li>
          </ul>

          <div className="pa-lock-plan">
            <i className="ph-bold ph-crown" aria-hidden="true" />
            <span><strong>Winston is included with Pro</strong><small>One account plan unlocks your personal companion.</small></span>
          </div>

          <button type="button" className="pa-lock-primary" onClick={openProPlan} data-pa-initial-focus="true">
            Unlock Winston <i className="ph-bold ph-arrow-right" aria-hidden="true" />
          </button>
          <p className="pa-lock-footnote">You’ll review your plan before checkout. Nothing is charged until you confirm.</p>
        </main>
      </PersonalAgentShell>
    );
  }

  const empty = history.length === 0;
  const agentName = WINSTON_NAME;

  return (
    <PersonalAgentShell className="pa-shell-redesign">
      <header className="pa-agent-header">
        <WinstonAvatar className="pa-agent-avatar" />
        <div className="pa-agent-identity">
          <strong>{agentName}</strong>
          <span>
            <i className="ph-bold ph-shield-check" aria-hidden="true" />
            {gateway
              ? `Protected gateway · ${serverProfile ? 'Synced setup' : 'Local setup'}`
              : 'On-device companion · Local setup'}
          </span>
        </div>
        <div className="pa-agent-actions">
          <button type="button" className="pa-icon-btn" onClick={onRefresh} title="Re-read this room" aria-label="Re-read this room" disabled={loading} aria-busy={loading}>
            <i className={`ph-bold ph-arrows-clockwise ${loading ? 'pa-spin' : ''}`} aria-hidden="true" />
          </button>
          <button type="button" className={`pa-icon-btn ${settingsOpen ? 'active' : ''}`} onClick={() => setSettingsOpen((open) => !open)} title="Agent setup" aria-label="Agent setup" aria-expanded={settingsOpen} aria-controls="pa-settings-panel">
            <i className="ph-bold ph-sliders-horizontal" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={`pa-agent-workspace${settingsOpen ? ' is-settings-open' : ''}`}>
        <div className="pa-agent-overview">
          <PersonalAgentLifecycle agentName={agentName} status={agentStatus} onWake={wakeAgent} />

          <div className="pa-context-summary" role="status" aria-live="polite">
            <span className={`pa-context-copy${error ? ' is-error' : ''}`}>
              <span className={`pa-context-dot${loading ? ' pulsing' : ''}`} aria-hidden="true" />
              {loading
                ? 'Reading this room…'
                : error
                  ? error
                  : contextBits.length
                    ? `Using ${contextBits.join(' · ')}`
                    : 'Room is quiet — ask anything'}
            </span>
            <PersonalBananaSummary gateway={gateway} status={agentStatus} usage={bananaUsage} />
          </div>

          <div className="pa-model-control">
            <span>Response model</span>
            <AiModelProfilePicker disabled={busy || lifecycleBusy} value={modelProfile} onChange={changeModelProfile} />
          </div>

          {gateway && empty ? <p className="pa-routing-disclosure"><i className="ph-bold ph-cloud" aria-hidden="true" /> {PERSONAL_AGENT_ROUTING_NOTICE}</p> : null}

          {profileLoadError ? (
            <div className="pa-profile-sync" role="status"><i className="ph-bold ph-cloud-warning" aria-hidden="true" /> {profileLoadError}</div>
          ) : null}
          {queueNotice ? (
            <div className="pa-profile-sync pa-request-progress" role="status" aria-live="polite"><i className="ph-bold ph-clock-countdown" aria-hidden="true" /> {queueNotice}</div>
          ) : null}
          {requestNotice ? (
            <div className="pa-request-notice" role="alert"><i className="ph-bold ph-warning-circle" aria-hidden="true" /> {requestNotice}</div>
          ) : null}

          {settingsOpen ? (
            <div className="pa-settings" id="pa-settings-panel">
              <label>
                What should Winston help with?
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
                <button type="button" className="pa-btn pa-btn-accent" onClick={persistProfile} disabled={profileSaving}><i className="ph-bold ph-check" aria-hidden="true" /> {profileSaving ? 'Saving' : 'Save'}</button>
                <button type="button" className="pa-btn" onClick={resetProfile} disabled={profileSaving}><i className="ph-bold ph-arrow-counter-clockwise" aria-hidden="true" /> Reset</button>
                {saved ? <span className="pa-saved" role="status"><i className="ph-bold ph-check-circle" aria-hidden="true" /> Saved</span> : null}
                {profileSaveError ? <span className="pa-save-error" role="alert">{profileSaveError}</span> : null}
              </div>
            </div>
          ) : null}
        </div>

        {!settingsOpen ? <div ref={threadRef} className="pa-thread pa-agent-thread" aria-live="polite" aria-relevant="additions text">
          {empty ? (
            <div className="pa-empty-thread">
              <div className="pa-msg pa-msg-assistant pa-welcome-message">
                <WinstonAvatar className="pa-msg-avatar" />
                <div className="pa-bubble"><span className="pa-sr-only">Winston: </span><span>Hey — I’m Winston. Ask me to catch you up, draft a reply, or help decide what to do next.</span></div>
              </div>
              <div className="pa-suggest pa-suggest-compact" aria-label="Suggested questions">
                {PERSONAL_QUICK_ACTIONS.map((action) => (
                  <button key={action.label} type="button" className="pa-suggest-card" onClick={() => sendPrompt(action.prompt)} disabled={busy || lifecycleBusy}>
                    <i className={`ph-bold ${action.icon}`} aria-hidden="true" />
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
                  {message.role === 'assistant' ? <WinstonAvatar className="pa-msg-avatar" /> : null}
                  <div className="pa-bubble">
                    <span className="pa-sr-only">{message.role === 'assistant' ? 'Winston: ' : 'You: '}</span>
                    <span>{message.content}</span>
                    {message.role === 'assistant' && message.provider && gateway ? <small className="pa-provider-disclosure">{PERSONAL_AGENT_REPLY_NOTICE}</small> : null}
                  </div>
                </div>
              ))}
              {busy ? (
                <div className="pa-msg pa-msg-assistant">
                  <WinstonAvatar className="pa-msg-avatar" />
                  <div className="pa-bubble pa-typing" role="status" aria-label="Winston is replying"><span /><span /><span /></div>
                </div>
              ) : null}
            </>
          )}
        </div> : null}
      </div>

      <form className="pa-composer" aria-label="Ask Winston" onSubmit={async (event) => { event.preventDefault(); if (await sendPrompt(draft)) setDraft(''); }}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          type="text"
          placeholder="Ask Winston…"
          autoComplete="off"
          aria-label="Message Winston"
          disabled={busy}
          data-pa-initial-focus="true"
        />
        <button type="submit" className="pa-send" title="Send" aria-label="Send to Winston" disabled={busy || !draft.trim()}>
          <i className="ph-bold ph-arrow-up" aria-hidden="true" />
        </button>
      </form>
    </PersonalAgentShell>
  );
}

export function PersonalAIAgentLauncher({ localAiConfig, roomId, channelId = window.activeChannelId || 'general' }) {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async ({ force = false } = {}) => {
    if (!roomId) return;
    setLoading(true);
    setError('');
    try {
      setContext(await gatherContext(roomId, channelId, { force }));
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
      onRefresh={() => load({ force: true })}
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
    <div className="room-ai-local-tool">
      {state.status === 'idle' ? <button type="button" id="ai-generate-btn" className="room-ai-secondary-btn" onClick={generate}><i className="ph-bold ph-cpu" aria-hidden="true" /> Generate summary</button> : null}
      {state.status === 'loading' ? <><Spinner label={state.message} />{state.percent != null ? <div className="ai-bar"><div id="ai-bar-fill" style={{ width: `${state.percent}%` }} /></div> : null}</> : null}
      {state.status === 'done' ? <><div className="room-ai-local-result">{state.summary}</div><button type="button" id="ai-regen-btn" className="room-ai-secondary-btn" onClick={generate}><i className="ph-bold ph-arrows-clockwise" aria-hidden="true" /> Regenerate</button></> : null}
      {state.status === 'error' ? <div className="room-ai-local-error" role="alert">{state.message}</div> : null}
    </div>
  );
}

function RoomAIContextState({ error = '', loading = false, onRefresh }) {
  return (
    <div className="room-ai-context-state" aria-busy={loading ? 'true' : 'false'}>
      <div className="room-ai-context-state-mark" aria-hidden="true">
        <i className={`ph-bold ${error ? 'ph-warning-circle' : 'ph-sparkle'}`} />
      </div>
      <span className="room-ai-eyebrow">Room AI</span>
      <h1>{error ? 'Room context paused' : 'Reading the room'}</h1>
      <p>{error || 'Gathering the recent messages, tasks, docs, and events you are allowed to access.'}</p>
      {loading ? <div className="room-ai-state-progress" role="status" aria-label="Loading room context"><span /><span /><span /></div> : null}
      {error ? <button type="button" className="room-ai-primary-btn" onClick={onRefresh}><i className="ph-bold ph-arrows-clockwise" aria-hidden="true" /> Try again</button> : null}
    </div>
  );
}

export function AI({ localAiConfig, roomId, roomName = '', channelId = 'general' }) {
  const tabActive = useRoomTabActivity('ai');
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const nextContext = await gatherContext(roomId, channelId, { force: true });
      setContext(nextContext);
    } catch (loadError) {
      setError(`Couldn't load room data: ${loadError.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!tabActive) return undefined;
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
  }, [channelId, roomId, tabActive]);

  const summary = useMemo(() => context ? extractiveSummary(context) : [], [context]);
  const actions = useMemo(() => context ? actionItems(context) : [], [context]);

  if (loading) return <RoomAIContextState loading onRefresh={load} />;
  if (error || !context) return <RoomAIContextState error={error || "Room context isn't available yet."} onRefresh={load} />;

  return (
    <RoomAgent
      key={`${roomId || 'global'}:${channelId || 'general'}`}
      actions={actions}
      active={tabActive}
      context={context}
      localAiConfig={localAiConfig}
      roomId={roomId}
      roomName={roomName}
      summary={summary}
      channelId={channelId}
    />
  );
}
