import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, limitToLast, orderByChild, query, ref } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { UiButton, UiIconButton } from '../../components/ui/UiButton.jsx';
import { useRoomTabActivity } from '../shell/roomTabActivity.js';
import './room-ai.css';
import './personalAgent.css';
import './aiResponseContent.css';
import './aiAgentControls.css';
import { AiResponseContent } from './AiResponseContent.jsx';
import {
  AiActionCards,
  AiClarificationCard,
  AiEvidence,
  AiImageComposerTools,
  AiMessageControls,
  CrossRoomBriefingPanel,
  StructuredMemoryManager,
} from './AiAgentControls.jsx';
import {
  AssistantResponseToolbar,
  useWinstonConversations,
  WinstonConversationDrawer,
  WinstonMemorySuggestion,
  WinstonPendingMemorySuggestions,
  WinstonProactiveSettings,
  WinstonSavedResponses,
  WinstonWorkspaceSearchPanel,
} from './WinstonEnhancements.jsx';
import {
  askPersonalAgent,
  askRoomAgent,
  cancelQueuedAiRequest,
  confirmAiAction,
  dismissAiAction,
  getLocalAiConfig,
  getLocalAiStatus,
  localAiStatusMessage,
  loadPersonalAiProfileFromServer,
  savePersonalAiProfileToServer,
  shouldUseGatewayAi,
  shouldUseServerAiProfile,
  tryAgentLiveTool,
} from './localAiClient.js';
import {
  appendBoundedAiHistory,
  buildRoomInstantSnapshot,
  latestPendingAiClarification,
  loadLocalAiMemories,
  newAiUiId,
  openAiActionContext,
  prepareAiImageAttachment,
  releaseAiImageAttachment,
  resolveAiHistoryClarification,
  upsertAiHistoryMessage,
} from './aiAgentUi.js';
import {
  AI_MODEL_PROFILE_EVENT,
  AI_MODEL_PROFILES,
  loadAiModelProfile,
  normalizeAiModelProfile,
  saveAiModelProfile,
} from './modelProfiles.js';
import {
  detectWinstonLiveTool,
  getWinstonKnowledgeIndexStatus,
  loadWinstonModelMode,
  resolveWinstonModelProfile,
  runWinstonLiveTool,
  saveWinstonModelMode,
  sendWinstonPlanCommand,
  suggestWinstonMemory,
  syncWinstonKnowledgeIndex,
  winstonLiveToolFailureMessage,
  WINSTON_MODEL_MODES,
} from './winstonServices.js';
import {
  buildWinstonAdvancedRequestFields,
  releaseWinstonAttachments,
} from './winstonAdvancedServices.js';
import {
  useWinstonAttachments,
  useWinstonContextSelection,
} from './winstonAdvancedHooks.js';
import { AiModelSegmentedControl } from './AiModelSegmentedControl.jsx';

const ROOM_CONTEXT_CACHE_TTL_MS = 15_000;
const ROOM_CONTEXT_CACHE_LIMIT = 12;
const roomContextCache = new Map();
const BALANCED_AI_ROUTING_POLICY = 'balanced';
const WinstonContextPicker = lazy(() => import('./WinstonAdvancedControls.jsx')
  .then((module) => ({ default: module.WinstonContextPicker })));
const WinstonAttachmentComposerTools = lazy(() => import('./WinstonAdvancedControls.jsx')
  .then((module) => ({ default: module.WinstonAttachmentComposerTools })));
const WinstonPlanCard = lazy(() => import('./WinstonAdvancedControls.jsx')
  .then((module) => ({ default: module.WinstonPlanCard })));
const WinstonResumablePlans = lazy(() => import('./WinstonAdvancedControls.jsx')
  .then((module) => ({ default: module.WinstonResumablePlans })));
const WinstonTrustIndicators = lazy(() => import('./WinstonTrustIndicators.jsx')
  .then((module) => ({ default: module.WinstonTrustIndicators })));

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
const PERSONAL_AGENT_ROUTING_NOTICE = 'Winston uses your PC first, then configured Cloudflare or Groq overflow when needed.';

function timestamp() {
  return Date.now();
}

function aiProviderDisclosure({ provider, model, modelProfile, requestedModelMode } = {}) {
  const label = {
    'ollama-bridge': 'PC · Ollama',
    'local-ollama': 'PC · Ollama',
    local: 'PC · Ollama',
    'cloudflare-workers-ai': 'Cloudflare Workers AI',
    groq: 'Groq',
    'groq-fallback': 'Groq fallback',
    gateway: 'Shared AI gateway',
    'market-data': 'Market data',
  }[provider] || String(provider || '').trim();
  if (!label && !model) return '';
  const auto = requestedModelMode === 'auto' && ['fast', 'smart'].includes(modelProfile)
    ? `Auto → ${modelProfile === 'smart' ? 'Smart' : 'Fast'}`
    : '';
  return [auto, label, model].filter(Boolean).join(' · ');
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

function useAiImageAttachment() {
  const [attachment, setAttachment] = useState(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentProcessing, setAttachmentProcessing] = useState(false);
  const ownedAttachmentsRef = useRef(new Set());

  const selectAttachmentFile = useCallback(async (file) => {
    setAttachmentProcessing(true);
    setAttachmentError('');
    try {
      const next = await prepareAiImageAttachment(file);
      setAttachment((current) => {
        if (current) {
          releaseAiImageAttachment(current);
          ownedAttachmentsRef.current.delete(current);
        }
        ownedAttachmentsRef.current.add(next);
        return next;
      });
    } catch (error) {
      setAttachmentError(error?.message || 'Could not prepare this image.');
    } finally {
      setAttachmentProcessing(false);
    }
  }, []);

  const removeAttachment = useCallback(() => {
    setAttachment((current) => {
      if (current) {
        releaseAiImageAttachment(current);
        ownedAttachmentsRef.current.delete(current);
      }
      return null;
    });
    setAttachmentError('');
  }, []);

  const detachAttachment = useCallback(() => {
    const current = attachment;
    setAttachment(null);
    setAttachmentError('');
    return current;
  }, [attachment]);

  const restoreAttachment = useCallback((next) => {
    if (!next) return;
    ownedAttachmentsRef.current.add(next);
    setAttachment(next);
    setAttachmentError('');
  }, []);

  const handleAttachmentPaste = useCallback((event) => {
    const imageItem = [...(event.clipboardData?.items || [])]
      .find((item) => String(item.type || '').startsWith('image/'));
    const file = imageItem?.getAsFile?.();
    if (file) selectAttachmentFile(file);
  }, [selectAttachmentFile]);

  useEffect(() => () => {
    ownedAttachmentsRef.current.forEach(releaseAiImageAttachment);
    ownedAttachmentsRef.current.clear();
  }, []);

  return {
    attachment,
    attachmentError,
    attachmentProcessing,
    detachAttachment,
    handleAttachmentPaste,
    removeAttachment,
    restoreAttachment,
    selectAttachmentFile,
  };
}

async function loadBriefingRoomOptions(currentRoomId) {
  const uid = window.currentUser?.uid;
  const currentId = String(currentRoomId || 'global').trim() || 'global';
  const currentFallback = currentId === 'global' ? 'Global Chat' : 'Current room';
  const seed = [
    { id: currentId, name: currentFallback },
    ...(currentId === 'global' ? [] : [{ id: 'global', name: 'Global Chat' }]),
  ];
  if (!uid) return seed;
  const indexSnapshot = await get(ref(db, `user_rooms/${uid}`)).catch(() => null);
  const index = indexSnapshot?.val() || {};
  const indexedIds = Object.keys(index)
    .filter((id) => /^[A-Za-z0-9_-]{1,160}$/.test(id) && !seed.some((room) => room.id === id))
    .slice(0, 31);
  const rooms = await Promise.all(indexedIds.map(async (id) => {
    const indexed = index[id] && typeof index[id] === 'object' ? index[id] : {};
    const nameSnapshot = await get(ref(db, `rooms_meta/${id}/name`)).catch(() => null);
    return {
      id,
      name: String(nameSnapshot?.val() || indexed.name || `Room ${id.slice(0, 8)}`).trim().slice(0, 120),
    };
  }));
  return [...seed, ...rooms].slice(0, 32);
}

async function loadWinstonContextPeopleOptions() {
  const uid = window.currentUser?.uid;
  if (!uid) return [];
  const friendsSnapshot = await get(ref(db, `friends/${uid}`)).catch(() => null);
  const acceptedIds = Object.entries(friendsSnapshot?.val() || {})
    .filter(([, status]) => status === 'accepted')
    .map(([friendUid]) => friendUid)
    .filter((friendUid) => /^[A-Za-z0-9_-]{1,160}$/.test(friendUid))
    .slice(0, 32);
  const people = await Promise.all(acceptedIds.map(async (friendUid) => {
    const profileSnapshot = await get(ref(db, `user_directory/${friendUid}`)).catch(() => null);
    const profile = profileSnapshot?.val() || {};
    return {
      id: friendUid,
      name: String(profile.displayName || profile.name || `Friend ${friendUid.slice(0, 8)}`).trim().slice(0, 120),
    };
  }));
  return people.sort((left, right) => left.name.localeCompare(right.name));
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
  const messages = Object.entries(messagesSnapshot?.val() || {})
    .filter(([, message]) => message?.text)
    .map(([id, message]) => ({
      id,
      name: message.name || 'Someone',
      text: String(message.text),
      at: message.timestamp || 0,
    }))
    .sort((a, b) => a.at - b.at);
  return {
    messages,
    tasks: Object.entries(tasksSnapshot?.val() || {})
      .filter(([, value]) => Boolean(value))
      .map(([id, value]) => ({ id, ...value })),
    docs: Object.entries(docsSnapshot?.val() || {})
      .filter(([, value]) => Boolean(value))
      .map(([id, value]) => ({ id, ...value })),
    events: Object.entries(eventsSnapshot?.val() || {})
      .filter(([, value]) => Boolean(value))
      .map(([id, value]) => ({ id, ...value })),
  };
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
    if (!busy && history.length === 0) {
      element.scrollTop = 0;
      wasNearBottomRef.current = true;
      return;
    }
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

function CompactAiModelProfilePicker({ disabled = false, onChange, profiles = AI_MODEL_PROFILES, value }) {
  const selected = profiles.find((profile) => profile.id === value) || profiles[0];
  return (
    <label className="pa-compact-model-picker" title={selected?.description || ''}>
      <span className="pa-sr-only">Response model</span>
      <i className={`ph-bold ${value === 'auto' ? 'ph-sparkle' : value === 'smart' ? 'ph-brain' : 'ph-lightning'}`} aria-hidden="true" />
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-label="Response model">
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>{profile.label}</option>
        ))}
      </select>
      <i className="ph-bold ph-caret-down" aria-hidden="true" />
    </label>
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

function personalAgentHeaderStatus({ gateway, serverProfile, status }) {
  const state = status?.state || 'standby';
  const setup = gateway
    ? `Protected gateway · ${serverProfile ? 'Synced setup' : 'Local setup'}`
    : 'On-device companion · Local setup';
  if (state === 'ready') return { state, label: 'Ready · PC first', setup };
  if (state === 'checking' || state === 'warming') return { state: 'warming', label: 'Waking · PC first', setup };
  if (state === 'unavailable' || state === 'offline' || state === 'request-failed' || state === 'blocked') {
    return { state: 'unavailable', label: 'Needs attention', setup };
  }
  if (state === 'missing-model') return { state, label: 'Model setup needed', setup };
  return { state: 'standby', label: 'Ready on demand', setup };
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
    label: 'Summarize this conversation',
    hint: 'Get the key points and decisions',
    icon: 'ph-chat-text',
    prompt: 'Catch me up on this room. Use sections: What changed, Key decisions, Open questions, and Next steps.',
  },
  {
    label: 'Draft a project update',
    hint: 'Turn room activity into a clear status',
    icon: 'ph-note-pencil',
    prompt: 'Draft a concise project update from this room. Include progress, decisions, blockers, and next steps.',
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
        <UiButton variant="inherit" onClick={onRetry} aria-label="Check Room AI again">Retry</UiButton>
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

function RoomAISourcesDetails({
  actions,
  context,
  latestMessage,
  localAiConfig,
  status,
  summary,
  usage,
  detailsRef,
}) {
  const recentContributors = useMemo(
    () => new Set(context.messages.map((message) => message.name).filter(Boolean)).size,
    [context.messages]
  );
  const openTasks = context.tasks.filter((task) => !task.done).length;
  const gateway = shouldUseGatewayAi(getLocalAiConfig(localAiConfig));
  const provider = aiProviderDisclosure(latestMessage)
    || aiProviderDisclosure(status)
    || (gateway ? 'Shared AI gateway' : 'Local connection');
  const sourceCount = latestMessage?.sources?.length || context.docs.length;
  const metrics = [
    ['ph-chat-circle-dots', 'Recent messages', context.messages.length],
    ['ph-users-three', 'Recent contributors', recentContributors],
    ['ph-file-text', 'Docs', context.docs.length],
    ['ph-list-checks', 'Open tasks', openTasks],
    ['ph-calendar-blank', 'Events', context.events.length],
  ];
  return (
    <details ref={detailsRef} className="room-ai-sources">
      <summary>
        <span className="room-ai-sources-icon" aria-hidden="true"><i className="ph-bold ph-database" /></span>
        <span className="room-ai-sources-copy">
          <strong>Sources &amp; details</strong>
          <small>{provider} · {sourceCount} {sourceCount === 1 ? 'source' : 'sources'} · Room context</small>
        </span>
        <i className="ph-bold ph-caret-down room-ai-sources-caret" aria-hidden="true" />
      </summary>
      <div className="room-ai-sources-panel">
        <div className="room-ai-sources-head">
          <div>
            <span className="room-ai-eyebrow">Authorized context</span>
            <h2>What Room AI can use</h2>
          </div>
          <span className="room-ai-source-provider"><i className="ph-bold ph-cpu" aria-hidden="true" /> {provider}</span>
        </div>
        <p className="room-ai-rail-intro">Room access is checked before server-side context is read.</p>
        <div className="room-ai-metrics">
          {metrics.map(([icon, label, value]) => (
            <div className="room-ai-metric" key={label}>
              <span><i className={`ph-bold ${icon}`} aria-hidden="true" /></span>
              <div><strong>{value}</strong><small>{label}</small></div>
            </div>
          ))}
        </div>
        {summary.length ? (
          <section className="room-ai-rail-section">
            <div className="room-ai-rail-section-title"><i className="ph-bold ph-clock" aria-hidden="true" /> Instant room snapshot</div>
            <ul className="room-ai-snapshot-list">{summary.slice(0, 3).map((sentence) => <li key={sentence}>{sentence}</li>)}</ul>
          </section>
        ) : null}
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
        {gateway ? <p className="room-ai-routing-disclosure">Balanced routing uses your PC first, then Cloudflare or Groq overflow when needed.</p> : null}
        <details className="room-ai-utility">
          <summary><span><i className="ph-bold ph-cpu" aria-hidden="true" /> On-device summary</span><i className="ph-bold ph-caret-down" aria-hidden="true" /></summary>
          <p>Optional browser-only model. The first run downloads its files to this device.</p>
          <LocalAI context={context} />
        </details>
      </div>
    </details>
  );
}

function RoomAgent({ actions, active, context, localAiConfig, roomId, roomName, summary, channelId = 'general' }) {
  const [history, setHistory] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopPending, setStopPending] = useState(false);
  const [bananaUsage, setBananaUsage] = useState(null);
  const [notice, setNotice] = useState('');
  const [queueNotice, setQueueNotice] = useState('');
  const activeClarification = latestPendingAiClarification(history);
  const routingPolicy = BALANCED_AI_ROUTING_POLICY;
  const threadRef = useRef(null);
  const composerRef = useRef(null);
  const sourcesRef = useRef(null);
  const overflowRef = useRef(null);
  const requestAbortRef = useRef(null);
  const currentRequestRef = useRef(null);
  const editPromptRef = useRef(false);
  const requestAttachmentsRef = useRef(new Map());
  const imageAttachment = useAiImageAttachment();
  const [modelProfile, selectModelProfile] = useAiModelProfile();
  const config = useMemo(
    () => getLocalAiConfig({ ...localAiConfig, modelProfile, routingPolicy }),
    [localAiConfig, modelProfile, routingPolicy],
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

  const confirmAction = useCallback(
    (action) => confirmAiAction({ config, actionId: action.id }),
    [config],
  );
  const dismissAction = useCallback(
    (action) => dismissAiAction({ config, actionId: action.id }),
    [config],
  );
  const openAction = useCallback(
    (action, response) => openAiActionContext(action, response),
    [],
  );

  const sendPrompt = async (text, options = {}) => {
    const prompt = text.trim();
    if (!prompt || busy || currentRequestRef.current) return false;
    const pendingClarification = options.resolveClarification === false
      ? null
      : latestPendingAiClarification(history);
    const requestedClarificationId = String(options.clarificationAnswer?.messageId || '');
    const clarificationTarget = pendingClarification
      && (!requestedClarificationId || pendingClarification.messageId === requestedClarificationId)
      ? pendingClarification
      : null;
    const promptId = newAiUiId('prompt');
    const assistantId = newAiUiId('reply');
    const originAttachment = clarificationTarget?.message?.originPromptId
      ? requestAttachmentsRef.current.get(clarificationTarget.message.originPromptId) || null
      : null;
    const requestAttachment = Object.hasOwn(options, 'attachment')
      ? options.attachment
      : originAttachment || imageAttachment.attachment || null;
    const userMessage = {
      id: promptId,
      role: 'user',
      content: prompt,
      attachmentName: requestAttachment?.name || '',
    };
    const resolvedHistory = clarificationTarget
      ? resolveAiHistoryClarification(
        history,
        options.clarificationAnswer?.value || prompt,
        {
          messageId: clarificationTarget.messageId,
          freeText: options.clarificationAnswer?.freeText !== false,
        },
      )
      : history;
    const nextHistory = appendBoundedAiHistory(resolvedHistory, userMessage);
    setHistory(nextHistory);
    if (requestAttachment) {
      requestAttachmentsRef.current.set(promptId, requestAttachment);
      while (requestAttachmentsRef.current.size > 8) {
        const oldestId = requestAttachmentsRef.current.keys().next().value;
        releaseAiImageAttachment(requestAttachmentsRef.current.get(oldestId));
        requestAttachmentsRef.current.delete(oldestId);
      }
      if (requestAttachment === imageAttachment.attachment) imageAttachment.detachAttachment();
    }
    setNotice('');
    setQueueNotice('');
    setBusy(true);
    const requestController = new AbortController();
    requestAbortRef.current = requestController;
    const requestState = {
      assistantId,
      controller: requestController,
      jobId: '',
      promptId,
      queueStatus: '',
      stopConfirmed: false,
    };
    currentRequestRef.current = requestState;
    try {
      const liveToolResult = requestAttachment || options.requestMode === 'briefing'
        ? null
        : await tryAgentLiveTool({ context, messages: nextHistory, signal: requestController.signal });
      if (liveToolResult) {
        setHistory((current) => appendBoundedAiHistory(current, {
          id: assistantId,
          role: 'assistant',
          content: liveToolResult.reply,
          provider: liveToolResult.provider || '',
          model: liveToolResult.model || '',
          status: 'complete',
        }));
        return true;
      }
      let currentStatus = agentStatus;
      if (currentStatus?.state !== 'ready') currentStatus = await refreshStatus();
      if (currentStatus?.state !== 'ready') {
        setNotice(currentStatus.message || localAiStatusMessage(currentStatus));
        setHistory((current) => appendBoundedAiHistory(current, {
          id: assistantId,
          role: 'assistant',
          content: currentStatus.message || localAiStatusMessage(currentStatus),
          status: 'error',
        }));
        return true;
      }
      const result = await askRoomAgent({
        context,
        messages: nextHistory,
        config,
        roomId,
        channelId,
        routingPolicy,
        attachment: requestAttachment,
        signal: requestController.signal,
        onQueueUpdate: (status) => {
          requestState.jobId = String(status?.jobId || requestState.jobId || '');
          requestState.queueStatus = String(status?.status || requestState.queueStatus || '');
          setQueueNotice(aiQueueNotice(status));
        },
        onProgress: (progress) => {
          const partial = String(progress?.text || '').trim();
          if (!partial || requestController.signal.aborted) return;
          setHistory((current) => upsertAiHistoryMessage(current, {
            id: assistantId,
            role: 'assistant',
            content: partial,
            provider: progress.provider || '',
            model: progress.model || '',
            status: 'streaming',
          }));
        },
      });
      setBananaUsage(result);
      const { reply } = result;
      setHistory((current) => upsertAiHistoryMessage(current, {
        id: assistantId,
        role: 'assistant',
        content: reply,
        provider: result.provider || '',
        model: result.model || '',
        sources: result.sources || [],
        actions: result.actions || [],
        interaction: result.interaction || null,
        originPromptId: promptId,
        requestMode: options.requestMode === 'briefing' ? 'briefing' : 'chat',
        selectedRoomIds: Array.isArray(options.selectedRoomIds) ? options.selectedRoomIds : [],
        status: 'complete',
      }));
    } catch (error) {
      if (requestController.signal.aborted) {
        setNotice('');
        setHistory((current) => upsertAiHistoryMessage(current, {
          id: assistantId,
          role: 'assistant',
          content: requestState.stopConfirmed
            ? 'Request cancelled.'
            : 'Stopped waiting before a server queue job was confirmed.',
          status: 'stopped',
        }));
        return true;
      }
      if (error?.state === 'cancelled' || error?.details?.queueStatus === 'cancelled') {
        requestState.stopConfirmed = true;
        setNotice('');
        setHistory((current) => upsertAiHistoryMessage(current, {
          id: assistantId,
          role: 'assistant',
          content: 'Request cancelled.',
          status: 'stopped',
        }));
        return true;
      }
      setQueueNotice('');
      const message = localAiStatusMessage(error);
      if (error?.details?.bananas) setBananaUsage(error.details.bananas);
      setAgentStatus({ state: error?.state || 'request-failed', message, model: config.model });
      setNotice(message);
      setHistory((current) => upsertAiHistoryMessage(current, {
        id: assistantId,
        role: 'assistant',
        content: error?.message || message,
        status: error?.state === 'cancelled' ? 'stopped' : 'error',
      }));
    } finally {
      if (requestAbortRef.current === requestController) requestAbortRef.current = null;
      if (currentRequestRef.current === requestState) currentRequestRef.current = null;
      setQueueNotice('');
      setStopPending(false);
      setBusy(false);
    }
    return true;
  };

  const selectClarificationOption = (message, option) => {
    if (busy || currentRequestRef.current || activeClarification?.messageId !== message.id) return false;
    return sendPrompt(option.label, {
      attachment: message.originPromptId ? requestAttachmentsRef.current.get(message.originPromptId) || null : null,
      clarificationAnswer: { messageId: message.id, value: option, freeText: false },
      requestMode: message.requestMode,
      selectedRoomIds: message.selectedRoomIds,
    });
  };

  const focusClarificationComposer = () => {
    editPromptRef.current = false;
    window.requestAnimationFrame(() => composerRef.current?.focus?.());
  };

  const stopRequest = useCallback(async () => {
    const request = currentRequestRef.current;
    if (!request || stopPending) return;
    setStopPending(true);
    if (!request.jobId || !gateway) {
      request.stopConfirmed = !gateway;
      request.controller.abort();
      return;
    }
    try {
      const result = await cancelQueuedAiRequest({ config, jobId: request.jobId });
      if (result.cancelled) {
        request.stopConfirmed = true;
        request.controller.abort();
        setNotice('');
        return;
      }
      setNotice(result.status === 'running'
        ? 'This request is already running, so it will finish safely.'
        : 'The server did not confirm cancellation. The request is still active.');
    } catch (error) {
      setNotice(error?.details?.queueStatus === 'running'
        ? 'This request is already running, so it will finish safely.'
        : error?.message || 'Cancellation was not confirmed. The request is still active.');
    } finally {
      if (currentRequestRef.current === request && !request.controller.signal.aborted) setStopPending(false);
    }
  }, [config, gateway, stopPending]);

  const retryMessage = useCallback((message) => {
    if (busy) return;
    sendPrompt(message.content, { attachment: requestAttachmentsRef.current.get(message.id) || null, resolveClarification: false });
  // sendPrompt intentionally uses the latest render state and remains interaction-scoped.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, history, routingPolicy]);

  const editMessage = useCallback((message) => {
    if (busy) return;
    editPromptRef.current = true;
    setDraft(message.content);
    const previousAttachment = requestAttachmentsRef.current.get(message.id);
    if (previousAttachment) imageAttachment.restoreAttachment(previousAttachment);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus?.();
      if (composerRef.current) resizeComposer(composerRef.current);
    });
  // resizeComposer and the attachment controller are stable for this mounted composer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const resizeComposer = (element) => {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  };

  const submitDraft = async (event) => {
    event.preventDefault();
    const prompt = draft.trim() || (imageAttachment.attachment ? 'What should I know about this image?' : '');
    if (!prompt || busy) return;
    setDraft('');
    if (composerRef.current) composerRef.current.style.height = 'auto';
    const resolveClarification = !editPromptRef.current;
    editPromptRef.current = false;
    await sendPrompt(prompt, { resolveClarification });
  };

  const startNewChat = () => {
    if (busy) return;
    new Set(requestAttachmentsRef.current.values()).forEach(releaseAiImageAttachment);
    requestAttachmentsRef.current.clear();
    imageAttachment.removeAttachment();
    setHistory([]);
    setDraft('');
    setNotice('');
    setQueueNotice('');
    editPromptRef.current = false;
    if (composerRef.current) composerRef.current.style.height = 'auto';
    window.requestAnimationFrame(() => composerRef.current?.focus?.());
  };

  const closeOverflowAndRestoreFocus = (trigger) => {
    const details = trigger?.closest?.('details');
    const summary = details?.querySelector?.('summary');
    details?.removeAttribute?.('open');
    window.requestAnimationFrame(() => summary?.focus?.());
  };

  const openSourcesDetails = (event) => {
    if (sourcesRef.current) {
      sourcesRef.current.open = true;
      window.requestAnimationFrame(() => sourcesRef.current?.querySelector('summary')?.focus?.());
    }
    event?.currentTarget?.closest?.('details')?.removeAttribute('open');
  };

  const streamingReply = busy && history.some((message) => (
    message.id === currentRequestRef.current?.assistantId && message.status === 'streaming'
  ));
  const latestAssistantMessage = [...history].reverse().find((message) => message.role === 'assistant') || null;

  useEffect(() => {
    const details = overflowRef.current;
    if (!details) return undefined;

    const closeOverflow = ({ restoreFocus = false } = {}) => {
      if (!details.open) return;
      details.open = false;
      if (restoreFocus) {
        window.requestAnimationFrame(() => details.querySelector('summary')?.focus?.());
      }
    };
    const handlePointerDown = (event) => {
      if (!details.open || details.contains(event.target)) return;
      closeOverflow();
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || !details.open) return;
      event.preventDefault();
      event.stopPropagation();
      closeOverflow({ restoreFocus: true });
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  return (
    <div className="room-ai-shell">
      <main className="room-ai-main">
        <header className="room-ai-header" aria-label="Room AI toolbar">
          <div className="room-ai-title-mark" aria-hidden="true"><i className="ph-bold ph-sparkle" /></div>
          <div className="room-ai-title-copy">
            <h1>Room AI</h1>
            <span>{displayRoomName}</span>
          </div>
          <div className="room-ai-toolbar-actions">
            <RoomAIStatus status={agentStatus} onRetry={refreshStatus} />
            <AiModelSegmentedControl
              disabled={busy}
              onChange={changeModelProfile}
              profiles={AI_MODEL_PROFILES}
              value={modelProfile}
            />
            <UiButton
              aria-label="New chat"
              className="room-ai-new-chat"
              disabled={busy}
              onClick={startNewChat}
              tooltip="Start a new Room AI conversation"
              variant="inherit"
            >
              <i className="ph-bold ph-plus" aria-hidden="true" />
              <span>New chat</span>
            </UiButton>
            <details ref={overflowRef} className="room-ai-overflow">
              <summary aria-label="More Room AI actions" title="More actions">
                <i className="ph-bold ph-dots-three-vertical" aria-hidden="true" />
              </summary>
              <div className="room-ai-overflow-menu" role="group" aria-label="More Room AI actions">
                <span className="room-ai-overflow-label">Prompts</span>
                {ROOM_AI_QUICK_ACTIONS.slice(2).map((action) => (
                  <UiButton
                    key={action.label}
                    disabled={busy}
                    variant="inherit"
                    onClick={(event) => {
                      closeOverflowAndRestoreFocus(event.currentTarget);
                      sendPrompt(action.prompt);
                    }}
                  >
                    <i className={`ph-bold ${action.icon}`} aria-hidden="true" />
                    <span>{action.label}</span>
                  </UiButton>
                ))}
                <span className="room-ai-overflow-label">Room AI</span>
                <UiButton variant="inherit" disabled={busy} onClick={(event) => {
                  closeOverflowAndRestoreFocus(event.currentTarget);
                  refreshStatus();
                }}>
                  <i className="ph-bold ph-arrows-clockwise" aria-hidden="true" />
                  <span>Refresh status</span>
                </UiButton>
                <UiButton variant="inherit" onClick={openSourcesDetails}>
                  <i className="ph-bold ph-database" aria-hidden="true" />
                  <span>Sources &amp; details</span>
                </UiButton>
              </div>
            </details>
          </div>
        </header>

        <div ref={threadRef} id="ai-thread" className={`room-ai-canvas${history.length ? ' has-thread' : ''}`} aria-live="polite" aria-relevant="additions text">
          {!history.length ? (
            <div className="room-ai-welcome">
              <div className="room-ai-orbit" aria-hidden="true"><i className="ph-bold ph-sparkle" /></div>
              <h2>How can I help your team today?</h2>
              <p>{hasRoomContext ? 'Turn the conversation into a clear answer, decision, or next step.' : 'This room is quiet, but Room AI is ready when the conversation starts.'}</p>
              <div className="room-ai-quick-grid">
                {ROOM_AI_QUICK_ACTIONS.slice(0, 2).map((action) => (
                  <UiButton key={action.label} variant="inherit" disabled={busy} onClick={() => sendPrompt(action.prompt)}>
                    <i className={`ph-bold ${action.icon}`} aria-hidden="true" />
                    <span><strong>{action.label}</strong><small>{action.hint}</small></span>
                    <i className="ph-bold ph-arrow-right room-ai-action-arrow" aria-hidden="true" />
                  </UiButton>
                ))}
              </div>
            </div>
          ) : (
            <div className="room-ai-thread">
              {history.map((message, index) => (
                <article key={message.id || `${message.role}-${index}`} className={`room-ai-message room-ai-message-${message.role} is-${message.status || 'complete'}`}>
                  <div className="room-ai-message-avatar" aria-hidden="true">{message.role === 'assistant' ? <i className="ph-bold ph-sparkle" /> : 'You'}</div>
                  <div>
                    <span>{message.role === 'assistant' ? 'Room AI' : 'You'}</span>
                    <div className={`room-ai-message-bubble${message.status === 'streaming' ? ' ai-streaming-caret' : ''}`}>
                      {message.role === 'assistant'
                        ? (message.content ? <AiResponseContent text={message.content} /> : null)
                        : <p>{message.content}</p>}
                      {message.role === 'user' && message.attachmentName ? <small className="ai-prompt-attachment"><i className="ph-bold ph-image" aria-hidden="true" /> {message.attachmentName}</small> : null}
                      {message.role === 'assistant' ? <AiEvidence sources={message.sources} /> : null}
                      {message.role === 'assistant' ? <AiActionCards actions={message.actions} disabled={busy} onConfirm={confirmAction} onDismiss={dismissAction} onOpen={openAction} /> : null}
                      {message.role === 'assistant' ? (
                        <AiClarificationCard
                          interaction={message.interaction}
                          messageText={message.content}
                          disabled={busy || activeClarification?.messageId !== message.id}
                          onSelect={(option) => selectClarificationOption(message, option)}
                          onFreeText={focusClarificationComposer}
                        />
                      ) : null}
                    </div>
                    <AiMessageControls message={message} disabled={busy} onRetry={retryMessage} onEdit={editMessage} />
                  </div>
                </article>
              ))}
              {busy && !streamingReply ? (
                <article className="room-ai-message room-ai-message-assistant" role="status" aria-label="Room AI is replying">
                  <div className="room-ai-message-avatar" aria-hidden="true"><i className="ph-bold ph-sparkle" /></div>
                  <div><span>Room AI</span><div className="room-ai-typing"><i /><i /><i /></div></div>
                </article>
              ) : null}
            </div>
          )}
        </div>

        <div className="room-ai-composer-zone">
          <RoomAISourcesDetails
            actions={actions}
            context={context}
            detailsRef={sourcesRef}
            latestMessage={latestAssistantMessage}
            localAiConfig={config}
            status={agentStatus}
            summary={summary}
            usage={bananaUsage}
          />
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
              <UiButton variant="inherit" onClick={refreshStatus}>Retry</UiButton>
            </div>
          ) : null}
          <div className="ai-composer-enhancements">
            <AiImageComposerTools
              attachment={imageAttachment.attachment}
              disabled={busy || !gateway}
              error={gateway ? imageAttachment.attachmentError : ''}
              processing={imageAttachment.attachmentProcessing}
              onRemove={imageAttachment.removeAttachment}
              onSelectFile={imageAttachment.selectAttachmentFile}
            />
          </div>
          <form id="ai-chat-form" className="room-ai-composer" aria-label="Ask Room AI" onSubmit={submitDraft}>
            <textarea
              ref={composerRef}
              id="ai-chat-input"
              rows="1"
              value={draft}
              onChange={(event) => { setDraft(event.target.value); resizeComposer(event.currentTarget); }}
              onPaste={gateway ? imageAttachment.handleAttachmentPaste : undefined}
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
            {busy ? (
              <UiIconButton id="ai-send-btn" className="ai-stop-button" label="Stop Room AI request" tooltip="Stop" disabled={stopPending} onClick={stopRequest}><i className="ph-bold ph-square" aria-hidden="true" /></UiIconButton>
            ) : (
              <UiIconButton type="submit" id="ai-send-btn" label="Send to Room AI" tooltip="Send" disabled={!draft.trim() && !imageAttachment.attachment}><i className="ph-bold ph-paper-plane-tilt" aria-hidden="true" /></UiIconButton>
            )}
          </form>
          <div className="room-ai-composer-meta"><span><i className="ph-bold ph-shield-check" aria-hidden="true" /> Room access checked</span><span>Enter to send · Shift + Enter for a new line</span></div>
        </div>
      </main>
    </div>
  );
}

const EMPTY_CONTEXT = { messages: [], tasks: [], docs: [], events: [] };

const PERSONAL_QUICK_ACTIONS = [
  { label: 'Catch me up', hint: 'Recent room changes', icon: 'ph-chats-circle', prompt: 'Catch me up on this room like my personal assistant. Focus on what matters to me and what changed recently.' },
  { label: 'My next steps', hint: 'Make an action plan', icon: 'ph-list-checks', prompt: 'Based on this room, what should I personally do next? Separate urgent items from nice-to-haves.' },
  { label: 'Find events', hint: 'Search my rooms', icon: 'ph-calendar-blank', prompt: 'Show me the upcoming events I can access. Include the date, time, room, and a citation for each result.' },
  { label: 'Make a room', hint: 'Invite accepted friends', icon: 'ph-user-plus', prompt: 'Help me create a room and invite accepted friends. Ask for the room name and which friends if I have not provided them.' },
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
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopPending, setStopPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState('');
  const [profileLoadError, setProfileLoadError] = useState('');
  const [bananaUsage, setBananaUsage] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversationDrawerOpen, setConversationDrawerOpen] = useState(false);
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const [requestNotice, setRequestNotice] = useState('');
  const [queueNotice, setQueueNotice] = useState('');
  const routingPolicy = BALANCED_AI_ROUTING_POLICY;
  const [memories, setMemories] = useState(loadLocalAiMemories);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [briefingRooms, setBriefingRooms] = useState([]);
  const [briefingRoomIds, setBriefingRoomIds] = useState(() => [String(roomId || 'global')]);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState('');
  const [contextPeople, setContextPeople] = useState([]);
  const [knowledgeIndexStatus, setKnowledgeIndexStatus] = useState(null);
  const [knowledgeIndexSyncing, setKnowledgeIndexSyncing] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const threadRef = useRef(null);
  const composerRef = useRef(null);
  const requestAbortRef = useRef(null);
  const currentRequestRef = useRef(null);
  const editPromptRef = useRef(false);
  const requestAttachmentsRef = useRef(new Map());
  const winstonAttachments = useWinstonAttachments();
  const {
    selection: contextSelection,
    setSelection: setContextSelection,
  } = useWinstonContextSelection(roomId);
  const pro = isProTier();
  const ctx = context || EMPTY_CONTEXT;
  const [, selectModelProfile] = useAiModelProfile();
  const [modelMode, setModelMode] = useState(loadWinstonModelMode);
  const configuredModelProfile = modelMode === 'smart' ? 'smart' : 'fast';
  const config = useMemo(
    () => getLocalAiConfig({
      ...localAiConfig,
      modelProfile: configuredModelProfile,
      requestedModelProfile: modelMode,
      routingPolicy,
    }),
    [configuredModelProfile, localAiConfig, modelMode, routingPolicy],
  );
  const serverProfile = shouldUseServerAiProfile(config);
  const gateway = shouldUseGatewayAi(config);
  const {
    activeConversation,
    activeId: activeConversationId,
    conversations,
    deleteConversation,
    history,
    newConversation,
    renameConversation,
    selectConversation,
    setHistory,
    syncState: conversationSyncState,
  } = useWinstonConversations({ config, serverEnabled: pro && serverProfile });
  const activeClarification = latestPendingAiClarification(history);
  const [agentStatus, setAgentStatus] = useState(() => gateway
    ? { ...config, state: 'standby', provider: 'gateway', message: localAiStatusMessage({ ...config, state: 'standby', provider: 'gateway' }) }
    : { ...config, state: 'checking', message: localAiStatusMessage({ ...config, state: 'checking' }) });
  const wakeRequestRef = useRef(null);
  const wakeTimerRef = useRef(null);
  const statusRequestIdRef = useRef(0);
  const lifecycleBusy = agentStatus?.state === 'checking' || agentStatus?.state === 'warming';
  const changeModelProfile = useCallback((nextMode) => {
    const mode = saveWinstonModelMode(nextMode);
    const nextProfile = mode === 'smart' ? 'smart' : 'fast';
    setRequestNotice('');
    setQueueNotice('');
    setAgentStatus(gateway
      ? { ...config, state: 'standby', provider: 'gateway', modelProfile: nextProfile, message: localAiStatusMessage({ ...config, state: 'standby', provider: 'gateway', modelProfile: nextProfile }) }
      : { ...config, state: 'checking', modelProfile: nextProfile, message: localAiStatusMessage({ ...config, state: 'checking', modelProfile: nextProfile }) });
    setModelMode(mode);
    if (mode !== 'auto') selectModelProfile(nextProfile);
  }, [config, gateway, selectModelProfile]);

  const handleMemoriesChange = useCallback((nextMemories) => {
    setMemories(nextMemories);
  }, []);
  const syncKnowledgeIndex = useCallback(async (selectedRoomIds) => {
    if (!gateway) throw new Error('Full-history indexing requires the protected Winston gateway.');
    setKnowledgeIndexSyncing(true);
    try {
      const result = await syncWinstonKnowledgeIndex({
        config,
        selectedRoomIds,
        onProgress: (progress) => setKnowledgeIndexStatus((current) => ({
          ...(current || {}),
          indexed: progress.indexed,
          activeSyncId: progress.complete ? '' : progress.syncId,
          progress: progress.progress,
        })),
      });
      const status = await getWinstonKnowledgeIndexStatus({ config }).catch(() => ({
        indexed: result.indexed,
        activeSyncId: '',
      }));
      setKnowledgeIndexStatus(status);
      return result;
    } finally {
      setKnowledgeIndexSyncing(false);
    }
  }, [config, gateway]);
  const updateVisiblePlan = useCallback((nextPlan) => {
    if (!nextPlan?.id) return;
    setHistory((current) => current.map((message) => (
      message.plan?.id === nextPlan.id ? { ...message, plan: nextPlan } : message
    )));
  }, [setHistory]);
  const commandWinstonPlan = useCallback(async (payload) => {
    const response = await sendWinstonPlanCommand({
      command: payload?.command,
      config,
      planId: payload?.planId,
      stepId: payload?.stepId,
    });
    if (response?.plan) updateVisiblePlan(response.plan);
    return response;
  }, [config, updateVisiblePlan]);

  const confirmAction = useCallback(
    (action) => confirmAiAction({ config, actionId: action.id }),
    [config],
  );
  const dismissAction = useCallback(
    (action) => dismissAiAction({ config, actionId: action.id }),
    [config],
  );
  const openAction = useCallback(
    (action, response) => openAiActionContext(action, response),
    [],
  );

  const openBriefing = useCallback(async () => {
    setBriefingOpen(true);
    setBriefingLoading(true);
    setBriefingError('');
    const currentId = String(roomId || 'global');
    setBriefingRoomIds([currentId]);
    try {
      setBriefingRooms(gateway
        ? await loadBriefingRoomOptions(currentId)
        : [{ id: currentId, name: currentId === 'global' ? 'Global Chat' : 'Current room' }]);
    } catch (loadError) {
      setBriefingError(loadError?.message || 'Could not load your rooms.');
    } finally {
      setBriefingLoading(false);
    }
  }, [gateway, roomId]);

  const toggleBriefingRoom = useCallback((selectedId) => {
    setBriefingRoomIds((current) => current.includes(selectedId)
      ? current.filter((id) => id !== selectedId)
      : [...current, selectedId].slice(0, 8));
  }, []);

  const contextBits = useMemo(() => {
    const bits = [];
    if (ctx.messages.length) bits.push(`${ctx.messages.length} messages`);
    if (ctx.tasks.length) bits.push(`${ctx.tasks.length} tasks`);
    if (ctx.events.length) bits.push(`${ctx.events.length} events`);
    if (ctx.docs.length) bits.push(`${ctx.docs.length} docs`);
    return bits;
  }, [ctx]);
  const contextDocuments = useMemo(
    () => ctx.docs.map((document, index) => ({
      id: String(document?.id || document?.docId || `doc-${index}`),
      title: String(document?.title || document?.name || 'Untitled document').trim().slice(0, 120),
    })),
    [ctx.docs],
  );

  useRespectfulThreadScroll(threadRef, busy, history);

  useEffect(() => () => requestAbortRef.current?.abort(), []);
  useEffect(() => () => {
    requestAttachmentsRef.current.forEach((attachments) => releaseWinstonAttachments(attachments));
    requestAttachmentsRef.current.clear();
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      Promise.all([
        loadBriefingRoomOptions(String(roomId || 'global')),
        loadWinstonContextPeopleOptions(),
      ]).then(([rooms, people]) => {
        if (!active) return;
        setBriefingRooms(rooms);
        setContextPeople(people);
      }).catch(() => {
        if (!active) return;
        setBriefingRooms([{ id: String(roomId || 'global'), name: roomId === 'global' ? 'Global Chat' : 'Current room' }]);
        setContextPeople([]);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [roomId]);

  useEffect(() => {
    if (!gateway) {
      setKnowledgeIndexStatus(null);
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      getWinstonKnowledgeIndexStatus({ config, signal: controller.signal })
        .then((status) => {
          if (active) setKnowledgeIndexStatus(status);
        })
        .catch(() => {
          if (active) setKnowledgeIndexStatus(null);
        });
    }, 0);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [config, gateway]);

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

  const sendPrompt = async (text, options = {}) => {
    const prompt = text.trim();
    if (!prompt || busy || currentRequestRef.current) return false;
    if (!window.currentUser?.getIdToken) {
      const message = 'Please sign in again before using Winston.';
      setAgentStatus({ ...config, state: 'blocked', message });
      setRequestNotice(message);
      return false;
    }

    const pendingClarification = options.resolveClarification === false
      ? null
      : latestPendingAiClarification(history);
    const requestedClarificationId = String(options.clarificationAnswer?.messageId || '');
    const clarificationTarget = pendingClarification
      && (!requestedClarificationId || pendingClarification.messageId === requestedClarificationId)
      ? pendingClarification
      : null;
    const promptId = newAiUiId('prompt');
    const assistantId = newAiUiId('reply');
    const originAttachmentValue = clarificationTarget?.message?.originPromptId
      ? requestAttachmentsRef.current.get(clarificationTarget.message.originPromptId) || []
      : [];
    const originAttachments = Array.isArray(originAttachmentValue)
      ? originAttachmentValue
      : originAttachmentValue ? [originAttachmentValue] : [];
    const hasExplicitAttachments = Object.hasOwn(options, 'attachments') || Object.hasOwn(options, 'attachment');
    const explicitAttachmentValue = Object.hasOwn(options, 'attachments')
      ? options.attachments
      : options.attachment ? [options.attachment] : [];
    const explicitAttachments = Array.isArray(explicitAttachmentValue)
      ? explicitAttachmentValue
      : explicitAttachmentValue ? [explicitAttachmentValue] : [];
    const composerAttachments = winstonAttachments.attachments;
    const requestAttachments = (hasExplicitAttachments
      ? explicitAttachments
      : originAttachments.length ? originAttachments : composerAttachments)
      .filter(Boolean)
      .slice(0, 6);
    const requestAttachment = requestAttachments[0] || null;
    const usesComposerAttachments = !hasExplicitAttachments
      && !originAttachments.length
      && requestAttachments.length > 0;
    const requestPlanMode = Object.hasOwn(options, 'planMode')
      ? options.planMode === true
      : planMode;
    const advancedRequestFields = buildWinstonAdvancedRequestFields({
      attachments: requestAttachments,
      contextSelection,
    });
    const inheritedRequestMode = options.requestMode || clarificationTarget?.message?.requestMode;
    const requestMode = inheritedRequestMode === 'briefing' ? 'briefing' : 'chat';
    const selectedRoomIds = requestMode === 'briefing'
      ? [...new Set(options.selectedRoomIds || clarificationTarget?.message?.selectedRoomIds || [roomId])].slice(0, 8)
      : [];
    const resolvedModelProfile = resolveWinstonModelProfile(prompt, {
      attachment: requestAttachment,
      mode: modelMode,
      requestMode,
    });
    const requestConfig = getLocalAiConfig({
      ...localAiConfig,
      modelProfile: resolvedModelProfile,
      requestedModelProfile: modelMode,
      routingPolicy,
    });
    const localMemorySuggestion = suggestWinstonMemory(prompt, memories);
    const userMessage = {
      id: promptId,
      role: 'user',
      content: prompt,
      attachmentName: requestAttachment?.name || '',
      attachmentNames: requestAttachments.map((attachment) => attachment.name).filter(Boolean),
      contextSelection,
      planMode: requestPlanMode,
      requestMode,
      selectedRoomIds,
      createdAt: Date.now(),
    };
    const resolvedHistory = clarificationTarget
      ? resolveAiHistoryClarification(
        history,
        options.clarificationAnswer?.value || prompt,
        {
          messageId: clarificationTarget.messageId,
          freeText: options.clarificationAnswer?.freeText !== false,
        },
      )
      : history;
    const nextHistory = appendBoundedAiHistory(resolvedHistory, userMessage);
    setHistory(nextHistory);
    if (requestAttachments.length) {
      requestAttachmentsRef.current.set(promptId, requestAttachments);
      while (requestAttachmentsRef.current.size > 8) {
        const oldestId = requestAttachmentsRef.current.keys().next().value;
        releaseWinstonAttachments(requestAttachmentsRef.current.get(oldestId));
        requestAttachmentsRef.current.delete(oldestId);
      }
      if (usesComposerAttachments) winstonAttachments.detachAttachments();
    }
    setBusy(true);
    setRequestNotice('');
    setQueueNotice('');
    const requestController = new AbortController();
    requestAbortRef.current = requestController;
    const requestState = {
      assistantId,
      controller: requestController,
      jobId: '',
      promptId,
      queueStatus: '',
      stopConfirmed: false,
    };
    currentRequestRef.current = requestState;
    let promptAccepted = true;
    try {
      let liveToolResult = requestAttachments.length || requestMode === 'briefing'
        ? null
        : await tryAgentLiveTool({ context: ctx, messages: nextHistory, signal: requestController.signal });
      const extendedToolRequest = !liveToolResult && gateway && !requestAttachments.length && requestMode !== 'briefing'
        ? detectWinstonLiveTool(prompt)
        : null;
      if (extendedToolRequest) {
        liveToolResult = await runWinstonLiveTool({
          config: requestConfig,
          request: extendedToolRequest,
          signal: requestController.signal,
        }).catch((toolError) => {
          if (requestController.signal.aborted) throw toolError;
          return null;
        });
      }
      if (extendedToolRequest && !liveToolResult) {
        const failureMessage = winstonLiveToolFailureMessage(extendedToolRequest);
        setRequestNotice(failureMessage);
        setHistory((current) => appendBoundedAiHistory(current, {
          id: assistantId,
          role: 'assistant',
          content: failureMessage,
          provider: `${extendedToolRequest.tool}-tool`,
          modelProfile: resolvedModelProfile,
          requestedModelMode: modelMode,
          createdAt: Date.now(),
          status: 'error',
        }));
        return true;
      }
      if (liveToolResult) {
        setHistory((current) => appendBoundedAiHistory(current, {
          id: assistantId,
          role: 'assistant',
          content: liveToolResult.reply,
          provider: liveToolResult.provider || '',
          model: liveToolResult.model || '',
          sources: liveToolResult.sources || [],
          modelProfile: resolvedModelProfile,
          requestedModelMode: modelMode,
          memorySuggestions: localMemorySuggestion ? [localMemorySuggestion] : [],
          createdAt: Date.now(),
          status: 'complete',
        }));
        return true;
      }
      let currentStatus = agentStatus;
      if (currentStatus?.state !== 'ready' || currentStatus?.modelProfile !== resolvedModelProfile) {
        currentStatus = await getLocalAiStatus(requestConfig, { wake: gateway });
        setAgentStatus(currentStatus);
      }
      if (currentStatus?.state !== 'ready') {
        setRequestNotice(currentStatus?.message || localAiStatusMessage(currentStatus));
        setHistory((current) => appendBoundedAiHistory(current, {
          id: assistantId,
          role: 'assistant',
          content: currentStatus?.message || localAiStatusMessage(currentStatus),
          status: 'error',
        }));
        return true;
      }
      if (serverProfile) {
        await savePersonalAiProfileToServer({ profile, config: requestConfig }).catch(() => null);
      } else {
        saveLocalPersonalAgentProfile(profile);
      }
      const result = await askPersonalAgent({
        context: ctx,
        messages: nextHistory,
        profile,
        memories,
        userName: window.userProfileName || window.currentUser?.displayName || 'the user',
        config: requestConfig,
        roomId,
        channelId,
        requestMode,
        selectedRoomIds,
        routingPolicy,
        ...advancedRequestFields,
        verificationMode: 'auto',
        planMode: requestPlanMode,
        signal: requestController.signal,
        onQueueUpdate: (status) => {
          requestState.jobId = String(status?.jobId || requestState.jobId || '');
          requestState.queueStatus = String(status?.status || requestState.queueStatus || '');
          setQueueNotice(aiQueueNotice(status));
        },
        onProgress: (progress) => {
          const partial = String(progress?.text || '').trim();
          if (!partial || requestController.signal.aborted) return;
          setHistory((current) => upsertAiHistoryMessage(current, {
            id: assistantId,
            role: 'assistant',
            content: partial,
            provider: progress.provider || '',
            model: progress.model || '',
            modelProfile: resolvedModelProfile,
            requestedModelMode: modelMode,
            status: 'streaming',
          }));
        },
      });
      setBananaUsage(result);
      const { reply } = result;
      const serverSuggestions = [
        ...(Array.isArray(result.memorySuggestions) ? result.memorySuggestions : []),
        ...(result.memorySuggestion ? [result.memorySuggestion] : []),
      ].map((suggestion) => ({
        id: String(suggestion?.id || newAiUiId('memory-suggestion')),
        text: String(suggestion?.text || '').trim().slice(0, 600),
        scope: suggestion?.scope === 'room' ? 'room' : 'personal',
        ...(suggestion?.scope === 'room' ? { roomId: String(suggestion?.roomId || roomId) } : {}),
        expiresAt: Math.max(0, Number(suggestion?.expiresAt) || 0),
      })).filter((suggestion) => suggestion.text);
      const memorySuggestions = serverSuggestions.length
        ? serverSuggestions
        : localMemorySuggestion ? [localMemorySuggestion] : [];
      setHistory((current) => upsertAiHistoryMessage(current, {
        id: assistantId,
        role: 'assistant',
        content: reply,
        provider: result.provider || '',
        model: result.model || '',
        sources: result.sources || [],
        actions: result.actions || [],
        interaction: result.interaction || null,
        routeReceipt: result.routeReceipt || null,
        contextReceipt: result.contextReceipt || null,
        verification: result.verification || null,
        plan: result.plan || null,
        modelProfile: result.modelProfile || resolvedModelProfile,
        requestedModelMode: modelMode,
        memorySuggestions,
        originPromptId: promptId,
        requestMode,
        selectedRoomIds,
        createdAt: Date.now(),
        status: 'complete',
      }));
      setAgentStatus((current) => ({
        ...current,
        state: 'ready',
        model: result.model || current?.model || requestConfig.model,
        modelProfile: result.modelProfile || resolvedModelProfile,
        message: localAiStatusMessage({
          ...requestConfig,
          state: 'ready',
          provider: requestConfig.provider,
          model: result.model || requestConfig.model,
          modelProfile: result.modelProfile || resolvedModelProfile,
        }),
      }));
      setRequestNotice('');
    } catch (requestError) {
      setQueueNotice('');
      if (requestController.signal.aborted) {
        setRequestNotice('');
        setHistory((current) => upsertAiHistoryMessage(current, {
          id: assistantId,
          role: 'assistant',
          content: requestState.stopConfirmed
            ? 'Request cancelled.'
            : 'Stopped waiting before a server queue job was confirmed.',
          status: 'stopped',
        }));
        return true;
      }
      if (requestError?.state === 'cancelled' || requestError?.details?.queueStatus === 'cancelled') {
        requestState.stopConfirmed = true;
        setRequestNotice('');
        setHistory((current) => upsertAiHistoryMessage(current, {
          id: assistantId,
          role: 'assistant',
          content: 'Request cancelled.',
          status: 'stopped',
        }));
        return true;
      }
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
      setHistory((current) => upsertAiHistoryMessage(current, {
        id: assistantId,
        role: 'assistant',
        content: requestError?.message || message,
        status: requestError?.state === 'cancelled' ? 'stopped' : 'error',
      }));
    } finally {
      if (requestAbortRef.current === requestController) requestAbortRef.current = null;
      if (currentRequestRef.current === requestState) currentRequestRef.current = null;
      setQueueNotice('');
      setStopPending(false);
      setBusy(false);
    }
    return promptAccepted;
  };

  const selectClarificationOption = (message, option) => {
    if (busy || currentRequestRef.current || activeClarification?.messageId !== message.id) return false;
    return sendPrompt(option.label, {
      attachments: message.originPromptId ? requestAttachmentsRef.current.get(message.originPromptId) || [] : [],
      clarificationAnswer: { messageId: message.id, value: option, freeText: false },
      requestMode: message.requestMode,
      selectedRoomIds: message.selectedRoomIds,
    });
  };

  const focusClarificationComposer = () => {
    editPromptRef.current = false;
    window.requestAnimationFrame(() => composerRef.current?.focus?.());
  };

  const stopRequest = useCallback(async () => {
    const request = currentRequestRef.current;
    if (!request || stopPending) return;
    setStopPending(true);
    if (!request.jobId || !gateway) {
      request.stopConfirmed = !gateway;
      request.controller.abort();
      return;
    }
    try {
      const result = await cancelQueuedAiRequest({ config, jobId: request.jobId });
      if (result.cancelled) {
        request.stopConfirmed = true;
        request.controller.abort();
        setRequestNotice('');
        return;
      }
      setRequestNotice(result.status === 'running'
        ? 'Winston is already running this request, so it will finish safely.'
        : 'The server did not confirm cancellation. This request is still active.');
    } catch (cancelError) {
      setRequestNotice(cancelError?.details?.queueStatus === 'running'
        ? 'Winston is already running this request, so it will finish safely.'
        : cancelError?.message || 'Cancellation was not confirmed. This request is still active.');
    } finally {
      if (currentRequestRef.current === request && !request.controller.signal.aborted) setStopPending(false);
    }
  }, [config, gateway, stopPending]);

  const retryMessage = useCallback((message) => {
    if (busy) return;
    sendPrompt(message.content, {
      attachments: requestAttachmentsRef.current.get(message.id) || [],
      planMode: message.planMode === true,
      requestMode: message.requestMode,
      selectedRoomIds: message.selectedRoomIds,
      resolveClarification: false,
    });
  // sendPrompt intentionally uses the latest render state and remains interaction-scoped.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, history, memories, routingPolicy]);

  const editMessage = useCallback((message) => {
    if (busy) return;
    editPromptRef.current = true;
    setDraft(message.content);
    const previousAttachments = requestAttachmentsRef.current.get(message.id);
    if (previousAttachments) winstonAttachments.restoreAttachments(previousAttachments);
    setPlanMode(message.planMode === true);
    window.requestAnimationFrame(() => composerRef.current?.focus?.());
  // The mounted attachment controller is stable for this composer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const runBriefing = useCallback(() => {
    if (busy || !briefingRoomIds.length) return;
    const count = briefingRoomIds.length;
    setBriefingOpen(false);
    sendPrompt(
      `Prepare my attention briefing across ${count === 1 ? 'the selected room' : `${count} selected rooms`}. Prioritize urgent tasks, decisions, unanswered questions, and items that need my response. Cite every claim.`,
      { attachments: [], requestMode: 'briefing', selectedRoomIds: briefingRoomIds },
    );
  // sendPrompt intentionally uses current render state and remains interaction-scoped.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefingRoomIds, busy, history, memories, routingPolicy]);

  const toggleAgentSettings = useCallback(async () => {
    const opening = !settingsOpen;
    setSettingsOpen(opening);
    setConversationDrawerOpen(false);
    setWorkspaceSearchOpen(false);
    if (!opening || briefingRooms.length) return;
    try {
      setBriefingRooms(await loadBriefingRoomOptions(String(roomId || 'global')));
    } catch {
      setBriefingRooms([{ id: String(roomId || 'global'), name: roomId === 'global' ? 'Global Chat' : 'Current room' }]);
    }
  }, [briefingRooms.length, roomId, settingsOpen]);

  const openConversationDrawer = useCallback(() => {
    setConversationDrawerOpen((open) => !open);
    setWorkspaceSearchOpen(false);
    setSettingsOpen(false);
  }, []);

  const openWorkspaceSearch = useCallback(() => {
    setWorkspaceSearchOpen((open) => !open);
    setConversationDrawerOpen(false);
    setSettingsOpen(false);
  }, []);

  const startNewConversation = useCallback(() => {
    if (busy) return;
    newConversation();
    setConversationDrawerOpen(false);
    setWorkspaceSearchOpen(false);
  }, [busy, newConversation]);

  const chooseConversation = useCallback((conversationId) => {
    if (busy) return;
    selectConversation(conversationId);
    setConversationDrawerOpen(false);
  }, [busy, selectConversation]);

  const removeMemorySuggestion = useCallback((messageId, suggestionId) => {
    setHistory((current) => current.map((message) => (
      message.id === messageId
        ? {
          ...message,
          memorySuggestions: (message.memorySuggestions || []).filter((suggestion) => suggestion.id !== suggestionId),
        }
        : message
    )));
  }, [setHistory]);

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
  const headerStatus = personalAgentHeaderStatus({ gateway, serverProfile, status: agentStatus });
  const lifecycleState = agentStatus?.state || 'standby';
  const contextLabel = loading
    ? 'Reading this room…'
    : error
      ? 'Room context paused'
      : contextBits.length
        ? 'Using this room'
        : 'This room is quiet';
  const contextDescription = loading
    ? 'Preparing the context you can access'
    : error
      ? error
      : contextBits.length
        ? contextBits.join(' · ')
        : 'Ask anything to get started';
  const streamingReply = busy && history.some((message) => (
    message.id === currentRequestRef.current?.assistantId && message.status === 'streaming'
  ));

  return (
    <PersonalAgentShell className="pa-shell-redesign">
      <header className="pa-agent-header">
        <WinstonAvatar className="pa-agent-avatar" />
        <div className="pa-agent-identity">
          <strong>{agentName}</strong>
          <span className={`pa-agent-status is-${headerStatus.state}`} title={headerStatus.setup}>
            <i className="pa-agent-status-dot" aria-hidden="true" />
            {headerStatus.label}
          </span>
        </div>
        <div className="pa-agent-actions">
          <button type="button" className={`pa-icon-btn ${conversationDrawerOpen ? 'active' : ''}`} onClick={openConversationDrawer} title="Conversations" aria-label="Winston conversations" aria-expanded={conversationDrawerOpen}>
            <i className="ph-bold ph-chat-circle-dots" aria-hidden="true" />
          </button>
          <button type="button" className={`pa-icon-btn ${workspaceSearchOpen ? 'active' : ''}`} onClick={openWorkspaceSearch} title="Search workspace" aria-label="Search your workspace" aria-expanded={workspaceSearchOpen}>
            <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
          </button>
          <button type="button" className="pa-icon-btn" onClick={onRefresh} title="Re-read this room" aria-label="Re-read this room" disabled={loading} aria-busy={loading}>
            <i className={`ph-bold ph-arrows-clockwise ${loading ? 'pa-spin' : ''}`} aria-hidden="true" />
          </button>
          <button type="button" className={`pa-icon-btn ${settingsOpen ? 'active' : ''}`} onClick={toggleAgentSettings} title="Agent setup" aria-label="Agent setup" aria-expanded={settingsOpen} aria-controls="pa-settings-panel">
            <i className="ph-bold ph-sliders-horizontal" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={`pa-agent-workspace${settingsOpen ? ' is-settings-open' : ''}${empty ? ' is-empty' : ' has-conversation'}${briefingOpen ? ' is-briefing-open' : ''}`}>
        <WinstonConversationDrawer
          activeId={activeConversationId}
          conversations={conversations}
          disabled={busy}
          onClose={() => setConversationDrawerOpen(false)}
          onDelete={deleteConversation}
          onNew={startNewConversation}
          onRename={renameConversation}
          onSelect={chooseConversation}
          open={conversationDrawerOpen}
          syncState={conversationSyncState}
        />
        <WinstonWorkspaceSearchPanel
          config={config}
          context={ctx}
          disabled={busy}
          gateway={gateway}
          onClose={() => setWorkspaceSearchOpen(false)}
          open={workspaceSearchOpen}
          roomId={roomId}
        />
        <div className="pa-agent-overview">
          {!['ready', 'standby'].includes(lifecycleState) ? (
            <PersonalAgentLifecycle agentName={agentName} status={agentStatus} onWake={wakeAgent} />
          ) : null}

          <div className="pa-context-rail" role="status" aria-live="polite">
            <span className={`pa-context-copy${error ? ' is-error' : ''}`} title={contextDescription}>
              <i className="ph-bold ph-users-three" aria-hidden="true" />
              <span>
                <strong>{contextLabel}</strong>
                <small>{contextDescription}</small>
              </span>
            </span>
            <span className="pa-context-actions">
              {!empty && !briefingOpen ? (
                <button type="button" className="pa-context-briefing" onClick={openBriefing} disabled={busy || lifecycleBusy} title="Review what needs my attention" aria-label="Review what needs my attention">
                  <i className="ph-bold ph-binoculars" aria-hidden="true" />
                </button>
              ) : null}
              <CompactAiModelProfilePicker disabled={busy || lifecycleBusy} profiles={WINSTON_MODEL_MODES} value={modelMode} onChange={changeModelProfile} />
            </span>
          </div>

          {!settingsOpen && briefingOpen ? (
            <CrossRoomBriefingPanel
              disabled={busy}
              error={briefingError}
              loading={briefingLoading}
              rooms={briefingRooms}
              selectedRoomIds={briefingRoomIds}
              onClose={() => setBriefingOpen(false)}
              onRun={runBriefing}
              onToggleRoom={toggleBriefingRoom}
            />
          ) : null}

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
              <div className="pa-settings-heading">
                <span><strong>Winston setup</strong><small>Shape how your personal assistant responds and remembers.</small></span>
                <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close Winston setup"><i className="ph-bold ph-x" aria-hidden="true" /></button>
              </div>
              <div className="pa-settings-meta">
                <PersonalBananaSummary gateway={gateway} status={agentStatus} usage={bananaUsage} />
                <span><i className="ph-bold ph-shield-check" aria-hidden="true" /> {PERSONAL_AGENT_ROUTING_NOTICE}</span>
              </div>
              <label>
                What should Winston help with?
                <textarea value={profile.instructions} onChange={(event) => updateProfile('instructions', event.target.value)} rows={3} />
              </label>
              <label>
                Preferred tone
                <input value={profile.tone} onChange={(event) => updateProfile('tone', event.target.value)} maxLength={400} />
              </label>
              <label>
                Working preferences
                <textarea value={profile.memory} onChange={(event) => updateProfile('memory', event.target.value)} rows={3} placeholder="Example: keep replies short. I prefer action lists over paragraphs." />
              </label>
              <div className="pa-settings-actions">
                <button type="button" className="pa-btn pa-btn-accent" onClick={persistProfile} disabled={profileSaving}><i className="ph-bold ph-check" aria-hidden="true" /> {profileSaving ? 'Saving' : 'Save'}</button>
                <button type="button" className="pa-btn" onClick={resetProfile} disabled={profileSaving}><i className="ph-bold ph-arrow-counter-clockwise" aria-hidden="true" /> Reset</button>
                {saved ? <span className="pa-saved" role="status"><i className="ph-bold ph-check-circle" aria-hidden="true" /> Saved</span> : null}
                {profileSaveError ? <span className="pa-save-error" role="alert">{profileSaveError}</span> : null}
              </div>
              <StructuredMemoryManager
                active={settingsOpen}
                config={config}
                roomId={roomId}
                serverSynced={serverProfile}
                onMemoriesChange={handleMemoriesChange}
              />
              <WinstonPendingMemorySuggestions
                active={settingsOpen}
                config={config}
                memories={memories}
                onMemoriesChange={handleMemoriesChange}
                roomId={roomId}
                serverEnabled={serverProfile}
              />
              <Suspense fallback={null}>
                <WinstonResumablePlans
                  active={settingsOpen}
                  disabled={busy}
                  onCommand={commandWinstonPlan}
                  onPlanChange={updateVisiblePlan}
                />
              </Suspense>
              <WinstonSavedResponses />
              <WinstonProactiveSettings
                active={settingsOpen}
                config={config}
                roomId={roomId}
                rooms={briefingRooms}
                serverEnabled={serverProfile}
              />
            </div>
          ) : null}
        </div>

        {!settingsOpen ? <div ref={threadRef} className="pa-thread pa-agent-thread" aria-live="polite" aria-relevant="additions text">
          {empty ? (
            <div className="pa-empty-thread">
              <div className="pa-empty-intro">
                <span className="pa-sr-only">Winston: </span>
                <h1>What can I take off your plate?</h1>
                <p>Catch up, find events, organize rooms, and reach accepted friends.</p>
              </div>
              {!briefingOpen ? (
                <button type="button" className="pa-briefing-launch" onClick={openBriefing} disabled={busy || lifecycleBusy}>
                  <i className="ph-bold ph-binoculars" aria-hidden="true" />
                  <span><strong>Review what needs my attention</strong><small>Select rooms before Winston reads them.</small></span>
                  <i className="ph-bold ph-arrow-right" aria-hidden="true" />
                </button>
              ) : null}
              <div className="pa-suggest-block">
                <span className="pa-suggest-heading">Start with</span>
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
            </div>
          ) : (
            <>
              {history.map((message, index) => (
                <div key={message.id || `${message.role}-${index}`} className={`pa-msg pa-msg-${message.role} is-${message.status || 'complete'}`}>
                  {message.role === 'assistant' ? <WinstonAvatar className="pa-msg-avatar" /> : null}
                  <div className={`pa-bubble${message.status === 'streaming' ? ' ai-streaming-caret' : ''}`}>
                    <span className="pa-sr-only">{message.role === 'assistant' ? 'Winston: ' : 'You: '}</span>
                    {message.role === 'assistant'
                      ? (message.content ? <AiResponseContent text={message.content} compact /> : null)
                      : <span>{message.content}</span>}
                    {message.role === 'user' && (message.attachmentNames?.length || message.attachmentName) ? (
                      <small className="ai-prompt-attachment">
                        <i className="ph-bold ph-paperclip" aria-hidden="true" />
                        {(message.attachmentNames || [message.attachmentName]).filter(Boolean).join(', ')}
                      </small>
                    ) : null}
                    {message.role === 'assistant' ? <AiEvidence sources={message.sources} /> : null}
                    {message.role === 'assistant' ? (
                      <Suspense fallback={null}>
                        <WinstonTrustIndicators
                          contextReceipt={message.contextReceipt}
                          routeReceipt={message.routeReceipt}
                          verification={message.verification}
                        />
                      </Suspense>
                    ) : null}
                    {message.role === 'assistant' && message.plan ? (
                      <Suspense fallback={null}>
                        <WinstonPlanCard
                          disabled={busy}
                          onCommand={commandWinstonPlan}
                          onPlanChange={updateVisiblePlan}
                          plan={message.plan}
                        />
                      </Suspense>
                    ) : null}
                    {message.role === 'assistant' ? <AiActionCards actions={message.actions} disabled={busy} onConfirm={confirmAction} onDismiss={dismissAction} onOpen={openAction} /> : null}
                    {message.role === 'assistant' ? (
                      <AiClarificationCard
                        interaction={message.interaction}
                        messageText={message.content}
                        disabled={busy || activeClarification?.messageId !== message.id}
                        onSelect={(option) => selectClarificationOption(message, option)}
                        onFreeText={focusClarificationComposer}
                      />
                    ) : null}
                    {message.role === 'assistant' ? (message.memorySuggestions || []).map((suggestion) => (
                      <WinstonMemorySuggestion
                        key={suggestion.id}
                        config={config}
                        memories={memories}
                        onMemoriesChange={handleMemoriesChange}
                        onRemove={() => removeMemorySuggestion(message.id, suggestion.id)}
                        roomId={roomId}
                        serverEnabled={serverProfile}
                        suggestion={suggestion}
                      />
                    )) : null}
                    {message.role === 'assistant' && (message.provider || message.model) ? <small className="pa-provider-disclosure">{aiProviderDisclosure(message)}</small> : null}
                    {message.role === 'assistant' && message.status === 'complete' ? (
                      <AssistantResponseToolbar
                        config={config}
                        conversationId={activeConversation?.serverId || activeConversationId}
                        message={message}
                      />
                    ) : null}
                    <AiMessageControls message={message} disabled={busy} onRetry={retryMessage} onEdit={editMessage} />
                  </div>
                </div>
              ))}
              {busy && !streamingReply ? (
                <div className="pa-msg pa-msg-assistant">
                  <WinstonAvatar className="pa-msg-avatar" />
                  <div className="pa-bubble pa-typing" role="status" aria-label="Winston is replying"><span /><span /><span /></div>
                </div>
              ) : null}
            </>
          )}
        </div> : null}
      </div>

      <form className="pa-composer" aria-label="Ask Winston" onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const requestAttachments = winstonAttachments.detachAttachments();
        const prompt = draft.trim() || (requestAttachments.length ? 'What should I know about these files?' : '');
        if (!prompt) return;
        setDraft('');
        const resolveClarification = !editPromptRef.current;
        editPromptRef.current = false;
        const accepted = await sendPrompt(prompt, {
          attachments: requestAttachments,
          planMode,
          resolveClarification,
        });
        if (!accepted) winstonAttachments.restoreAttachments(requestAttachments);
      }}>
        <div className={`pa-composer-surface${winstonAttachments.attachments.length ? ' has-attachment' : ''}`}>
          <div className="ai-composer-enhancements">
            <Suspense fallback={<span className="pa-composer-tools-loading" aria-hidden="true" />}>
              <div className="pa-composer-mode-row">
                <WinstonContextPicker
                  currentRoomId={roomId}
                  disabled={busy || !gateway}
                  documents={contextDocuments}
                  indexStatus={knowledgeIndexStatus}
                  onChange={setContextSelection}
                  onSyncIndex={syncKnowledgeIndex}
                  people={contextPeople}
                  rooms={briefingRooms}
                  syncingIndex={knowledgeIndexSyncing}
                  value={contextSelection}
                />
                <button
                  type="button"
                  className={`pa-plan-mode-toggle${planMode ? ' is-active' : ''}`}
                  aria-pressed={planMode}
                  disabled={busy}
                  onClick={() => setPlanMode((active) => !active)}
                  title="Ask Winston to turn this request into a resumable plan"
                >
                  <i className="ph-bold ph-list-checks" aria-hidden="true" />
                  <span>Plan</span>
                </button>
              </div>
              <WinstonAttachmentComposerTools
                attachments={winstonAttachments.attachments}
                disabled={busy || !gateway}
                error={gateway ? winstonAttachments.attachmentError : ''}
                processing={winstonAttachments.attachmentProcessing}
                onRemove={winstonAttachments.removeAttachment}
                onSelectFiles={winstonAttachments.selectAttachmentFiles}
              />
            </Suspense>
          </div>
          <input
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={gateway ? winstonAttachments.handleAttachmentPaste : undefined}
            type="text"
            placeholder="Ask Winston anything…"
            autoComplete="off"
            aria-label="Message Winston"
            data-pa-initial-focus="true"
          />
          {busy ? (
            <button type="button" className="pa-send ai-stop-button" title="Stop" aria-label="Stop Winston request" disabled={stopPending} onClick={stopRequest}>
              <i className="ph-bold ph-square" aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className="pa-send" title="Send" aria-label="Send to Winston" disabled={!draft.trim() && !winstonAttachments.attachments.length}>
              <i className="ph-bold ph-arrow-up" aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="pa-composer-note" title={gateway ? 'Try /preview https://… for a safe webpage preview.' : ''}><i className="ph-bold ph-lock-simple" aria-hidden="true" /> {gateway ? 'Privacy Shield · sensitive requests stay on your PC' : 'On device · actions ask before they run'}</p>
      </form>
    </PersonalAgentShell>
  );
}

export function PersonalAIAgentLauncher({ localAiConfig, roomId, channelId = window.activeChannelId || 'general' }) {
  const scopeKey = `${roomId || 'global'}:${channelId || 'general'}`;
  const requestVersionRef = useRef(0);
  const [contextState, setContextState] = useState({
    scopeKey: '',
    context: null,
    loading: true,
    error: '',
  });
  const visibleState = contextState.scopeKey === scopeKey
    ? contextState
    : { scopeKey, context: null, loading: true, error: '' };

  const load = useCallback(async ({ force = false } = {}) => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    if (!roomId) {
      setContextState({ scopeKey, context: null, loading: false, error: '' });
      return;
    }
    setContextState((current) => ({
      scopeKey,
      context: current.scopeKey === scopeKey ? current.context : null,
      loading: true,
      error: '',
    }));
    try {
      const nextContext = await gatherContext(roomId, channelId, { force });
      if (requestVersionRef.current !== requestVersion) return;
      setContextState({ scopeKey, context: nextContext, loading: false, error: '' });
    } catch (loadError) {
      if (requestVersionRef.current !== requestVersion) return;
      setContextState({
        scopeKey,
        context: null,
        loading: false,
        error: `Couldn't load room context: ${loadError.message}`,
      });
    }
  }, [channelId, roomId, scopeKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => {
      window.clearTimeout(timer);
      requestVersionRef.current += 1;
    };
  }, [load]);

  return (
    <PersonalAIAgent
      key={scopeKey}
      context={visibleState.context}
      localAiConfig={localAiConfig}
      loading={visibleState.loading}
      error={visibleState.error}
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
  const scopeKey = `${roomId || 'global'}:${channelId || 'general'}`;
  const requestVersionRef = useRef(0);
  const [contextState, setContextState] = useState({
    scopeKey: '',
    context: null,
    loading: true,
    error: '',
  });
  const visibleState = contextState.scopeKey === scopeKey
    ? contextState
    : { scopeKey, context: null, loading: true, error: '' };
  const { context, error, loading } = visibleState;

  const load = useCallback(async ({ force = true } = {}) => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setContextState((current) => ({
      scopeKey,
      context: current.scopeKey === scopeKey ? current.context : null,
      loading: true,
      error: '',
    }));
    try {
      const nextContext = await gatherContext(roomId, channelId, { force });
      if (requestVersionRef.current !== requestVersion) return;
      setContextState({ scopeKey, context: nextContext, loading: false, error: '' });
    } catch (loadError) {
      if (requestVersionRef.current !== requestVersion) return;
      setContextState({
        scopeKey,
        context: null,
        loading: false,
        error: `Couldn't load room data: ${loadError.message}`,
      });
    }
  }, [channelId, roomId, scopeKey]);

  useEffect(() => {
    if (!tabActive) return undefined;
    const timer = window.setTimeout(() => {
      void load({ force: false });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestVersionRef.current += 1;
    };
  }, [load, tabActive]);

  const summary = useMemo(() => context ? buildRoomInstantSnapshot(context) : [], [context]);
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
