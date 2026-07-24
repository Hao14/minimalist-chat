import { Fragment, Suspense, createElement, lazy, memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  endBefore,
  get,
  limitToLast,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onDisconnect,
  onValue,
  orderByKey,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { auth, db } from '../../lib/firebase.js';
import { normalizeStoredAvatarUrl } from '../../lib/avatar.js';
import {
  DEFAULT_LOCALE,
  getLocale,
  subscribeLocale,
  translate,
} from '../../lib/i18n.js';
import { renderMessageText } from '../../lib/text.js';
import { getAuthedJsonHeaders } from '../../lib/authToken.js';
import { playUiSound } from '../audio/uiSoundService.js';
import { PLATFORM_BOT_SLASH_COMMANDS } from '../bots/botCatalog.js';
import {
  detectAutoModeration,
  extractStockSymbols,
  normalizeRoomBotConfig,
} from '../bots/botRuntime.js';
import { useRoomEntitlement } from '../billing/roomEntitlements.js';
import {
  ROOM_CATCHUP_PREFERENCE_EVENT,
  ROOM_CATCHUP_REVIEW_EVENT,
  loadRoomCatchUpEnabled,
  loadRoomCatchUpReviewedId,
  roomCatchUpReviewedStorageKey,
  roomCatchUpStorageKey,
  saveRoomCatchUpReviewedId,
} from './catchUpPreference.js';
import { buildQuickSwitchModel } from './quickSwitcherModel.js';
import { buildRoomCatchUp } from './roomCatchUpModel.js';
import { canPostToChannel, normalizeChannel } from './channelModel.js';
import {
  extractFirstPreviewUrl,
  messageTextWithoutPreviewUrl,
  normalizeLinkPreview,
} from './linkPreview.js';
import {
  ROOM_MESSAGE_KIND,
  isCurrentUserAuthoredMessage,
  roomMessageKind,
} from './messagePresentation.js';
import { loadOutboxAttempts, removeOutboxAttempt, saveOutboxAttempt } from './outboxStore.js';
import {
  aggregatePollResults,
  createPollPayload,
  isPollClosed,
  nextPollVoteValue,
} from './pollModel.js';
import {
  nextMarkedUnreadState,
  nextReadState,
  readStatePath,
  unreadSummary,
} from './readState.js';
import { sanitizeScheduledMessage } from './scheduledMessageModel.js';
import { threadRootIdForMessage } from './threadModel.js';
import './chatCore.performance.css';
import './quickSwitcher.css';
import './roomCatchUp.css';

const LazyQuickReplies = lazy(() => import('./QuickReplies.jsx').catch(() => ({ default: () => null })));
const LazyRoomHeaderContext = lazy(() => import('./RoomHeaderContext.jsx'));
const LazyMessageTimeline = lazy(() => import('./MessageTimeline.jsx'));
const LazyThreadDrawer = lazy(() => import('./ChatEnhancements.jsx').then((module) => ({ default: module.ThreadDrawer })));
const LazyScheduleMessageDialog = lazy(() => import('./ChatEnhancements.jsx').then((module) => ({ default: module.ScheduleMessageDialog })));
const LazyScheduledMessageList = lazy(() => import('./ChatEnhancements.jsx').then((module) => ({ default: module.ScheduledMessageList })));
const LazyAttachmentPreview = lazy(() => import('./ChatEnhancements.jsx').then((module) => ({ default: module.AttachmentPreview })));
const LazyComposerMoreMenu = lazy(() => import('./ComposerMoreMenu.jsx')
  .catch(() => ({ default: ComposerMoreMenuUnavailable })));

function ComposerMoreMenuState({ anchorRef, error = false, onClose }) {
  if (typeof document === 'undefined') return null;

  const close = () => {
    onClose?.();
    requestAnimationFrame(() => anchorRef?.current?.focus());
  };

  return createPortal(
    <div
      aria-live="polite"
      className={`composer-more-state${error ? ' is-error' : ''}`}
      id="composer-more-menu"
      role={error ? 'alert' : 'status'}
    >
      <i
        aria-hidden="true"
        className={`ph-bold ${error ? 'ph-warning-circle' : 'ph-spinner-gap message-delivery-spinner'}`}
      />
      <span>{error ? 'Message tools could not be loaded.' : 'Loading message tools…'}</span>
      {error ? (
        <button aria-label="Close message tools" onClick={close} type="button">
          <i aria-hidden="true" className="ph-bold ph-x" />
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

function ComposerMoreMenuUnavailable(props) {
  return <ComposerMoreMenuState {...props} error />;
}

const GLOBAL_ROOM = {
  id: 'global',
  name: 'Global Chat',
  lastMessage: 'Welcome to the server.',
  shortId: 'GLOBAL',
};

const LAST_ROOM_STORAGE_PREFIX = 'minimalist:last-room';
const MESSAGE_SCOPE_CACHE_LIMIT = 8;
const MESSAGE_SCOPE_MESSAGE_LIMIT = 240;
const MESSAGE_ACTIVE_HARD_LIMIT = 600;
const MESSAGE_HISTORY_PAGE_SIZE = 20;
const ROOM_INDEX_REPAIR_STORAGE_PREFIX = 'minimalist:room-index-repair';
const ROOM_INDEX_REPAIR_TTL_MS = 6 * 60 * 60 * 1000;
const BOT_CONFIG_READY_TIMEOUT_MS = 2_500;
const BOT_REQUESTER_CHANGED_CODE = 'bot_requester_changed';
const roomIndexRepairMemory = new Map();
let pendingRoomChangedTimer = null;
const MY_ROOMS_ENDPOINT = () => window.MY_ROOMS_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/listMyRooms';
const ISSUE_DRAFT_ENDPOINT = () => window.ISSUE_DRAFT_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/submitIssueDraft';
const LINK_PREVIEW_ENDPOINT = () => window.LINK_PREVIEW_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/linkPreview';
const ROOM_MODERATION_ENDPOINT = () => window.ROOM_MODERATION_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/roomModeration';
const ROOM_SCHEDULING_ENDPOINT = () => window.ROOM_SCHEDULING_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/roomScheduling';
const TRANSLATE_MESSAGE_ENDPOINT = () => window.TRANSLATE_MESSAGE_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/translateRoomMessage';
const CREATE_NOTIFICATION_ENDPOINT = () => window.CREATE_NOTIFICATION_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/createNotification';

function scheduleRoomChanged() {
  if (pendingRoomChangedTimer !== null) return;
  pendingRoomChangedTimer = window.setTimeout(() => {
    pendingRoomChangedTimer = null;
    window.onRoomChanged?.();
  }, 0);
}

function currentChatUser() {
  const user = window.currentUser || auth.currentUser || null;
  if (user?.uid && !window.currentUser) window.currentUser = user;
  return user;
}

function cleanRoomText(value, fallback, max = 180) {
  const text = String(value || fallback || '').trim();
  return (text || String(fallback || '')).slice(0, max);
}

function normalizeRoomForList(roomId, room = {}, fallback = {}) {
  return {
    id: roomId,
    ...fallback,
    ...room,
    name: cleanRoomText(room.name || fallback.name, 'Room', 120),
    shortId: cleanRoomText(room.shortId || fallback.shortId, roomId, 40),
    lastMessage: cleanRoomText(room.lastMessage || fallback.lastMessage, '', 180),
  };
}

function shallowEqualRoomRecord(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key]);
}

function roomSidebarMetadata(roomId, room = {}, fallback = {}) {
  const normalized = normalizeRoomForList(roomId, room, fallback);
  const photoUrl = Object.prototype.hasOwnProperty.call(room, 'photoUrl')
    ? room.photoUrl
    : fallback.photoUrl;
  return {
    id: normalized.id,
    name: normalized.name,
    shortId: normalized.shortId,
    lastMessage: normalized.lastMessage,
    photoUrl: safeImageSource(photoUrl),
    creatorId: cleanRoomText(room.creatorId || fallback.creatorId, '', 128),
  };
}

async function refreshMyRoomIndexFromGateway() {
  const response = await fetch(MY_ROOMS_ENDPOINT(), {
    method: 'POST',
    headers: await getAuthedJsonHeaders(),
    body: JSON.stringify({}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not refresh room list.');
  return Array.isArray(data.rooms) ? data.rooms : [];
}

function resolveWithin(promise, timeoutMs = BOT_CONFIG_READY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    Promise.resolve(promise).then(finish, () => finish(null));
  });
}

function botRequesterChangedError() {
  const error = new Error('The active account changed before this automation finished.');
  error.code = BOT_REQUESTER_CHANGED_CODE;
  return error;
}

function automationAttributionTitle(message = {}) {
  const ownerUid = String(message.uid || '');
  const requesterUid = String(message.requestedBy || '');
  if (!ownerUid || requesterUid !== ownerUid) return 'Client automation attribution could not be verified';
  return ownerUid === currentChatUser()?.uid
    ? 'Client automation requested by you'
    : 'Client automation requested by the authenticated message owner';
}

async function submitIssueDraft(issue) {
  if (window.MINIMALIST_FLAGS?.issueSubmission === false) {
    throw new Error('Issue submission is not enabled for this deployment.');
  }
  const endpoint = String(ISSUE_DRAFT_ENDPOINT() || '').trim();
  if (!endpoint) throw new Error('Issue submission endpoint is not configured.');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: await getAuthedJsonHeaders('Please sign in before submitting feedback.'),
    body: JSON.stringify(issue),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Issue report failed (${response.status}).`);
  return data;
}

async function postAuthedJson(endpoint, body, authMessage = 'Please sign in to continue.') {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: await getAuthedJsonHeaders(authMessage),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || data.message || `Request failed (${response.status}).`);
    error.code = data.code || 'request_failed';
    error.status = response.status;
    throw error;
  }
  return data;
}

const SLASH_COMMAND_GROUPS = [
  {
    name: 'Core',
    commands: [
      ['/help', 'Show all commands', 'commands'],
      ['/commands', 'Open full command list', 'commands'],
      ['/quick', 'Open quick action menu', 'quick'],
      ['/capture', 'Turn the latest message into a task, note, reminder, or archive item', 'capture'],
      ['/search', 'Search rooms, messages, files, users, and resources', 'search'],
      ['/settings', 'Open user settings', 'settings'],
      ['/shortcuts', 'Show keyboard shortcuts', 'shortcuts'],
      ['/feedback', 'Send platform feedback', 'feedback'],
    ],
  },
  {
    name: 'Messaging',
    commands: [
      ['/msg edit', 'Edit a message', 'messageMenu'],
      ['/msg delete', 'Delete a message', 'messageMenu'],
      ['/msg forward', 'Forward a message', 'messageMenu'],
      ['/msg schedule', 'Schedule a message', 'schedule'],
      ['/msg ephemeral', 'Send disappearing message', 'comingSoon'],
      ['/msg unread', 'Jump to first unread', 'unread'],
      ['/msg bookmark', 'Bookmark a message', 'bookmarks'],
      ['/msg collect', 'Add message to a collection', 'bookmarks'],
      ['/msg flag', 'Mark message as important', 'messageMenu'],
      ['/msg impact', 'View message impact', 'messageMenu'],
      ['/thread create', 'Open threads and start a focused reply', 'threads'],
      ['/translate', 'Translate a message from its action bar', 'translateHelp'],
      ['/quote', 'Quote reply to a message', 'quote'],
      ['/react', 'Add a reaction', 'messageMenu'],
      ['/gif', 'Search and send a GIF', 'comingSoon'],
      ['/voice', 'Send voice message', 'comingSoon'],
      ['/transcribe', 'Transcribe voice message', 'comingSoon'],
      ['/upload', 'Upload a file', 'attach'],
      ['/attach', 'Attach file to message', 'attach'],
      ['/preview', 'Generate a safe link preview', 'linkPreview'],
      ['/room favorite', 'Favorite a room', 'roomFavorite'],
      ['/room unfavorite', 'Remove favorite', 'roomUnfavorite'],
    ],
  },
  {
    name: 'Notifications',
    commands: [
      ['/notify all', 'Enable all notifications', 'notifyAll'],
      ['/notify mentions', 'Mentions only', 'notifyMentions'],
      ['/notify mute', 'Mute current room', 'notifyMute'],
      ['/notify keyword add', 'Add keyword alert', 'notifyKeywordAdd'],
      ['/notify keyword remove', 'Remove keyword alert', 'notifyKeywordRemove'],
      ['/notify digest', 'Enable digest notifications', 'notifyDigest'],
      ['/dnd on', 'Turn on Do Not Disturb', 'dndOn'],
      ['/dnd off', 'Turn off Do Not Disturb', 'dndOff'],
      ['/notify schedule', 'Set notification schedule', 'notifySchedule'],
      ['/notify dnd', 'Open Do Not Disturb settings', 'notifySchedule'],
      ['/activity', 'Open Activity Center', 'activity'],
      ['/mentions', 'View mentions', 'activity'],
      ['/replies', 'View replies', 'activity'],
      ['/invites', 'View invites', 'activity'],
      ['/reports', 'View reports', 'activity'],
      ['/updates', 'View updates', 'activity'],
      ['/announcements', 'View announcements', 'activity'],
    ],
  },
  {
    name: 'Tasks',
    commands: [
      ['/task create', 'Create task', 'taskCreate'],
      ['/task from-message', 'Convert message into task', 'captureTask'],
      ['/task assign @user', 'Assign task owner', 'tasks'],
      ['/task due', 'Set due date', 'tasks'],
      ['/task priority', 'Set priority', 'tasks'],
      ['/task remind', 'Add reminder', 'tasks'],
      ['/task complete', 'Mark task complete', 'tasks'],
      ['/tasks', 'View tasks', 'tasks'],
    ],
  },
  {
    name: 'Community',
    commands: [
      ['/poll create', 'Create poll', 'poll'],
      ['/memberoftheweek', 'View or nominate member of the week', 'recognition'],
      ['/award give @user', 'Give community award', 'communityAward'],
      ['/top contributors', 'View top contributors', 'leaderboard'],
      ['/anniversary', 'View anniversaries', 'recognition'],
      ['/birthday', 'View birthdays', 'recognition'],
      ['/poll close', 'Close poll', 'pollClose'],
      ['/poll results', 'View poll results', 'pollResults'],
      ['/survey create', 'Create survey', 'comingSoon'],
      ['/survey results', 'View survey results', 'comingSoon'],
    ],
  },
  {
    name: 'Moderation',
    commands: [
      ['/report', 'Report message or user', 'report'],
      ['/warn @user', 'Warn user', 'comingSoon'],
      ['/timeout @user', 'Timeout user', 'moderation'],
      ['/mute @user', 'Mute user', 'moderation'],
      ['/unmute @user', 'Unmute user', 'moderation'],
      ['/ban @user', 'Ban user', 'moderation'],
      ['/unban @user', 'Unban user', 'comingSoon'],
      ['/appeal', 'Submit ban appeal', 'comingSoon'],
      ['/mod queue', 'Open moderation queue', 'comingSoon'],
      ['/raid on', 'Enable raid protection', 'comingSoon'],
      ['/raid off', 'Disable raid protection', 'comingSoon'],
      ['/spam filter', 'Configure spam filtering', 'comingSoon'],
      ['/keyword block', 'Block keyword', 'comingSoon'],
      ['/keyword allow', 'Allow keyword', 'comingSoon'],
      ['/links restrict', 'Restrict links', 'comingSoon'],
      ['/links allow', 'Allow links', 'comingSoon'],
      ['/audit', 'View audit logs', 'audit'],
      ['/invite create', 'Create invite', 'invite'],
      ['/invite revoke', 'Revoke invite', 'comingSoon'],
    ],
  },
  {
    name: 'Platform',
    commands: PLATFORM_BOT_SLASH_COMMANDS.map(({ command, description, action }) => [command, description, action]),
  },
  {
    name: 'AI',
    commands: [
      ['/ai', 'Open AI assistant', 'ai'],
      ['/summary room', 'Generate room summary', 'summaryRoom'],
    ],
  },
];

const SLASH_COMMANDS = SLASH_COMMAND_GROUPS.flatMap((group) => group.commands.map(([command, description, action]) => ({
  command,
  description,
  action,
  category: group.name,
})));

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10}GB`;
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

function isTextLikeFile(file) {
  if (!file) return false;
  if (file.type?.startsWith('text/')) return true;
  return /\.(txt|md|markdown|json|csv|tsv|log|js|jsx|ts|tsx|css|html|xml|yml|yaml|py|java|c|cpp|cs|go|rs|sql)$/i.test(file.name || '');
}

async function readTextPreview(file) {
  if (!isTextLikeFile(file)) return null;
  const maxRead = Math.min(file.size, 16 * 1024);
  const text = await file.slice(0, maxRead).text();
  return {
    textPreview: text.slice(0, 5000),
    textPreviewTruncated: file.size > maxRead || text.length > 5000,
  };
}

function formatDueDate(value) {
  const date = new Date(Number(value || 0));
  if (Number.isNaN(date.getTime())) return 'No due date';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function parseReminderInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function toDateTimeLocalValue(value = Date.now() + 60 * 60 * 1000) {
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function roomMessagesRef(roomId, channelId = 'general') {
  if (roomId === 'global') return ref(db, 'messages');
  if (!channelId || channelId === 'general') return ref(db, `rooms_data/${roomId}/messages`);
  return ref(db, `rooms_data/${roomId}/channels/${channelId}/messages`);
}

function normalizedChannelId(channelId = 'general') {
  return channelId || 'general';
}

function composerDraftKey(roomId, channelId = 'general') {
  return `draft:${roomId}:${normalizedChannelId(channelId)}`;
}

function legacyComposerDraftKey(roomId) {
  return `draft:${roomId}`;
}

const composerDraftWriteTimers = new Map();

function readComposerDraft(roomId, channelId = 'general') {
  try {
    const stored = localStorage.getItem(composerDraftKey(roomId, channelId));
    if (stored !== null) return stored;
    if (normalizedChannelId(channelId) === 'general') return localStorage.getItem(legacyComposerDraftKey(roomId)) || '';
    return '';
  } catch {
    return '';
  }
}

function writeComposerDraft(roomId, channelId, value) {
  const scopeKey = `${roomId}:${normalizedChannelId(channelId)}`;
  window.clearTimeout(composerDraftWriteTimers.get(scopeKey));
  composerDraftWriteTimers.set(scopeKey, window.setTimeout(() => {
    composerDraftWriteTimers.delete(scopeKey);
    try {
      localStorage.setItem(composerDraftKey(roomId, channelId), value);
      if (normalizedChannelId(channelId) === 'general') localStorage.setItem(legacyComposerDraftKey(roomId), value);
    } catch {
      // Draft persistence is best-effort in private and embedded browser contexts.
    }
  }, 250));
}

function clearComposerDraftStorage(roomId, channelId = 'general') {
  const scopeKey = `${roomId}:${normalizedChannelId(channelId)}`;
  window.clearTimeout(composerDraftWriteTimers.get(scopeKey));
  composerDraftWriteTimers.delete(scopeKey);
  try {
    localStorage.removeItem(composerDraftKey(roomId, channelId));
    if (normalizedChannelId(channelId) === 'general') localStorage.removeItem(legacyComposerDraftKey(roomId));
  } catch {
    // Draft persistence is best-effort in private and embedded browser contexts.
  }
}

function clearComposerDraftStorageIfMatches(roomId, channelId, expectedValue) {
  if (readComposerDraft(roomId, channelId) !== String(expectedValue || '')) return;
  clearComposerDraftStorage(roomId, channelId);
}

function roomTypingRef(roomId, channelId = 'general') {
  return ref(db, `typing/${roomId}/${normalizedChannelId(channelId)}`);
}

function userTypingRef(roomId, channelId, uid) {
  return ref(db, `typing/${roomId}/${normalizedChannelId(channelId)}/${uid}`);
}

function roomMessageRef(roomId, messageId, channelId = 'general') {
  if (roomId === 'global') return ref(db, `messages/${messageId}`);
  if (!channelId || channelId === 'general') return ref(db, `rooms_data/${roomId}/messages/${messageId}`);
  return ref(db, `rooms_data/${roomId}/channels/${channelId}/messages/${messageId}`);
}

function roomMessageChildRef(roomId, messageId, childPath, channelId = 'general') {
  if (roomId === 'global') return ref(db, `messages/${messageId}/${childPath}`);
  if (!channelId || channelId === 'general') return ref(db, `rooms_data/${roomId}/messages/${messageId}/${childPath}`);
  return ref(db, `rooms_data/${roomId}/channels/${channelId}/messages/${messageId}/${childPath}`);
}

function reactionPathKey(emoji) {
  const blocked = new Set(['.', '#', '$', '/', '[', ']']);
  return [...String(emoji || '').trim()]
    .filter((char) => !blocked.has(char) && char >= ' ')
    .join('')
    .slice(0, 32);
}

function collectMessageReactions(reactions = {}, currentUid = '') {
  const counts = {};
  const addReaction = (emoji, uid) => {
    const key = reactionPathKey(emoji);
    if (!key) return;
    counts[key] = counts[key] || { n: 0, mine: false };
    counts[key].n += 1;
    if (uid === currentUid) counts[key].mine = true;
  };

  Object.entries(reactions || {}).forEach(([uid, value]) => {
    if (!value) return;
    if (typeof value === 'string') {
      addReaction(value, uid);
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([emoji, enabled]) => {
        if (enabled === true) addReaction(emoji, uid);
      });
    }
  });

  return Object.entries(counts);
}

function isPermissionDeniedError(error) {
  return error?.code === 'PERMISSION_DENIED' || /permission[_\s]denied/i.test(error?.message || '');
}

// A stale Firebase auth token is the most common cause of an intermittent
// PERMISSION_DENIED on an otherwise-allowed write (e.g. Global Chat). The
// rejected write never reaches the server, so force-refreshing the ID token and
// retrying exactly once is safe and cannot duplicate the message.
async function setWithAuthRetry(targetRef, payload) {
  try {
    await set(targetRef, payload);
  } catch (error) {
    const user = window.currentUser || auth.currentUser || null;
    if (isPermissionDeniedError(error) && typeof user?.getIdToken === 'function') {
      try {
        await user.getIdToken(true);
      } catch {
        // Ignore refresh failure; the retry below surfaces the real error.
      }
      await set(targetRef, payload);
      return;
    }
    throw error;
  }
}

function slugChannel(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function mentionHandle(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '')
    .slice(0, 32);
}

function candidateMentionHandle(candidate) {
  const nameHandle = mentionHandle(candidate?.name);
  if (nameHandle && !/\s/.test(String(candidate?.name || ''))) return nameHandle;
  return mentionHandle(candidate?.shortId) || nameHandle || mentionHandle(candidate?.uid);
}

function getMentionToken(draft, cursorIndex) {
  const cursor = Number.isFinite(cursorIndex) ? cursorIndex : String(draft || '').length;
  const beforeCursor = String(draft || '').slice(0, cursor);
  const match = beforeCursor.match(/(^|[\s([{])@([A-Za-z0-9_-]{0,32})$/);
  if (!match) return null;
  const atIndex = beforeCursor.lastIndexOf('@');
  if (atIndex < 0) return null;
  return {
    start: atIndex,
    end: cursor,
    query: String(match[2] || '').toLowerCase(),
  };
}

function mentionSearchText(candidate) {
  return [
    candidate.name,
    candidate.shortId,
    candidateMentionHandle(candidate),
  ].filter(Boolean).join(' ').toLowerCase();
}

function getMentionSuggestions(candidates, token) {
  if (!token) return [];
  const queryText = token.query || '';
  return candidates
    .filter((candidate) => !queryText || mentionSearchText(candidate).includes(queryText))
    .slice(0, 8);
}

function getProfileSnapshot() {
  const user = currentChatUser();
  return {
    uid: user?.uid,
    name: window.userProfileName || user?.displayName || 'Anonymous',
    photoUrl: window.userPhotoUrl || user?.photoURL || '',
    tier: window.userTier || 'free',
    shortId: window.userShortId || '',
  };
}

const ROOM_PERMISSION_DEFAULTS = {
  manageChannels: false,
  manageBots: false,
};

async function fetchStockQuote(symbol) {
  const endpoint = window.STOCK_QUOTE_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/stockQuote';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: await getAuthedJsonHeaders('Please sign in before using the stock bot.'),
    body: JSON.stringify({ symbol }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Stock quote failed');
  return data;
}

async function fetchLinkPreview(url) {
  const response = await fetch(LINK_PREVIEW_ENDPOINT(), {
    method: 'POST',
    headers: await getAuthedJsonHeaders('Please sign in before previewing a link.'),
    body: JSON.stringify({ url }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'That link could not be previewed safely.');
  const preview = normalizeLinkPreview(data);
  if (!preview) throw new Error('That page did not provide a usable preview.');
  return preview;
}

function formatStockQuote(quote) {
  const price = Number(quote.price || 0);
  const change = Number(quote.change || 0);
  const changePercent = Number(quote.changePercent || 0);
  const direction = change > 0 ? '▲' : change < 0 ? '▼' : '•';
  const signedChange = `${change >= 0 ? '+' : ''}${change.toFixed(2)}`;
  const signedPct = `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`;
  const currency = quote.currency || 'USD';
  const name = quote.name && quote.name !== quote.symbol ? ` · ${quote.name}` : '';
  return `${quote.symbol}${name}\n${direction} ${currency} ${price.toFixed(2)} (${signedChange}, ${signedPct})`;
}

async function postBotMessage(roomId, channelId, botName, text, extra = {}, { requesterUid = '' } = {}) {
  const profile = getProfileSnapshot();
  if (!profile.uid) throw new Error('Please sign in before using room bots.');
  if (requesterUid && profile.uid !== requesterUid) throw botRequesterChangedError();
  const message = {
    ...extra,
    uid: profile.uid,
    name: botName,
    photoUrl: profile.photoUrl,
    text,
    timestamp: serverTimestamp(),
    tier: profile.tier,
    bot: true,
    automation: true,
    botName,
    requestedBy: profile.uid,
  };
  await set(push(roomMessagesRef(roomId, channelId)), message);
  if (roomId !== 'global') {
    const preview = `${botName}: ${String(text || '').replace(/\s+/g, ' ')}`;
    await set(ref(db, `rooms_meta/${roomId}/lastMessage`), preview.length > 30 ? `${preview.substring(0, 30)}...` : preview);
  }
}

function isRoomManager(roomData = {}) {
  const uid = window.currentUser?.uid;
  if (!uid) return false;
  if (uid === window.MY_ADMIN_UID) return true;
  if (roomData.creatorId) return roomData.creatorId === uid;
  return Object.keys(roomData.members || {})[0] === uid;
}

function permissionValue(permissions = {}, key) {
  if (Object.prototype.hasOwnProperty.call(permissions || {}, key)) return permissions[key] !== false;
  if (key === 'manageBots' && Object.prototype.hasOwnProperty.call(permissions || {}, 'webhooks')) {
    return permissions.webhooks === true;
  }
  return ROOM_PERMISSION_DEFAULTS[key] ?? true;
}

function userPermissionValue(roomData = {}, key, uid = window.currentUser?.uid) {
  const overrides = uid ? roomData.memberPermissions?.[uid] : null;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key] !== false;
  if (overrides && key === 'manageBots' && Object.prototype.hasOwnProperty.call(overrides, 'webhooks')) {
    return overrides.webhooks === true;
  }
  return permissionValue(roomData.permissions, key);
}

async function canUseRoomPermission(roomId, key, deniedMessage) {
  if (!roomId || roomId === 'global') return true;
  const snapshot = await get(ref(db, `rooms_meta/${roomId}`)).catch(() => null);
  const roomData = snapshot?.val() || {};
  if (isRoomManager(roomData)) return true;
  if (!userPermissionValue(roomData, key)) {
    window.showToast?.(deniedMessage);
    return false;
  }
  return true;
}

const timeFormatCache = new Map();
const MAX_TIME_FORMAT_CACHE = 1200;

function formatTime(timestamp) {
  if (!timestamp) return '';
  const cacheKey = String(timestamp);
  if (timeFormatCache.has(cacheKey)) return timeFormatCache.get(cacheKey);

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const value = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (timeFormatCache.size > MAX_TIME_FORMAT_CACHE) timeFormatCache.clear();
  timeFormatCache.set(cacheKey, value);
  return value;
}

const MESSAGE_TEXT_TAGS = new Set(['a', 'br', 'code', 'del', 'em', 'pre', 'span', 'strong']);

function propsForMessageTextElement(element, key) {
  const tagName = element.tagName.toLowerCase();
  const props = { key };

  if (tagName === 'a') {
    const href = element.getAttribute('href') || '#';
    props.href = /^https?:\/\//i.test(href) ? href : '#';
    props.target = '_blank';
    props.rel = 'noopener noreferrer';
  }

  const className = element.getAttribute('class') || '';
  const allowedClasses = className
    .split(/\s+/)
    .filter((name) => /^(msg-|tok-|language-)/.test(name))
    .join(' ');
  if (allowedClasses) props.className = allowedClasses;

  if ((tagName === 'pre' || tagName === 'code') && element.hasAttribute('data-lang')) {
    props['data-lang'] = element.getAttribute('data-lang') || '';
  }

  return props;
}

function renderMessageTextNode(node, key) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return null;

  const tagName = node.tagName.toLowerCase();
  if (!MESSAGE_TEXT_TAGS.has(tagName)) return node.textContent;

  const props = propsForMessageTextElement(node, key);
  if (tagName === 'br') return createElement('br', props);

  return createElement(
    tagName,
    props,
    Array.from(node.childNodes).map((child, childIndex) => renderMessageTextNode(child, `${key}-${childIndex}`)),
  );
}

const MessageText = memo(function MessageText({ text }) {
  const nodes = useMemo(() => {
    const html = renderMessageText(text || '');
    const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    return Array.from(parsed.body.firstChild?.childNodes || []).map((node, index) => renderMessageTextNode(node, index));
  }, [text]);

  return nodes;
});

function messageSearchText(message) {
  return [
    message.name,
    message.text,
    message.replyTo?.name,
    message.replyTo?.text,
    message.attachedImage ? 'image attachment' : '',
    message.attachedFile?.name,
    message.attachedFile?.textPreview,
    message.poll?.question,
    ...(message.poll?.options || []).map((option) => option.text),
    message.reminder?.text,
    message.linkPreview?.domain,
    message.linkPreview?.title,
    message.linkPreview?.description,
  ].filter(Boolean).join(' ').toLowerCase();
}

function slashSearchText(command) {
  return `${command.command} ${command.description} ${command.category}`.toLowerCase();
}

function getSlashQuery(draft) {
  const trimmedStart = String(draft || '').replace(/^\s+/, '');
  if (!trimmedStart.startsWith('/') || trimmedStart.includes('\n')) return null;
  return trimmedStart.slice(1).toLowerCase();
}

function getSlashSuggestions(query) {
  if (query === null) return [];
  const clean = query.trim();
  if (!clean) return SLASH_COMMANDS.slice(0, 12);
  return SLASH_COMMANDS
    .filter((command) => slashSearchText(command).includes(clean))
    .slice(0, 12);
}

function findSlashCommand(draft) {
  const raw = String(draft || '').trim();
  if (!raw.startsWith('/')) return null;
  const lower = raw.toLowerCase();
  const sorted = [...SLASH_COMMANDS].sort((a, b) => b.command.length - a.command.length);
  const found = sorted.find((command) => lower === command.command || lower.startsWith(`${command.command} `));
  if (!found) return null;
  return {
    ...found,
    args: raw.slice(found.command.length).trim(),
  };
}

let notificationScheduleFocusObserver = null;
let notificationScheduleFocusTimer = 0;

function clearNotificationScheduleFocusWait() {
  notificationScheduleFocusObserver?.disconnect();
  notificationScheduleFocusObserver = null;
  window.clearTimeout(notificationScheduleFocusTimer);
  notificationScheduleFocusTimer = 0;
}

function focusNotificationScheduleControl() {
  clearNotificationScheduleFocusWait();
  const host = document.getElementById('notification-settings-root');
  if (!host) return;

  const focusWhenCommitted = () => {
    const modal = document.getElementById('settings-modal');
    const scheduleControl = host.querySelector('.notif-quiet-editor');
    const focusTarget = scheduleControl?.querySelector('input[type="time"], button, input');
    if (
      !scheduleControl
      || !focusTarget
      || modal?.classList.contains('hidden')
      || modal?.dataset.activeSettingsPane !== 'notifications'
    ) return false;

    clearNotificationScheduleFocusWait();
    window.requestAnimationFrame(() => {
      if (!scheduleControl.isConnected || !focusTarget.isConnected) return;
      scheduleControl.scrollIntoView({ block: 'center', behavior: 'auto' });
      focusTarget.focus({ preventScroll: true });
    });
    return true;
  };

  if (focusWhenCommitted()) return;
  notificationScheduleFocusObserver = new MutationObserver(focusWhenCommitted);
  notificationScheduleFocusObserver.observe(host, { childList: true, subtree: true });
  notificationScheduleFocusTimer = window.setTimeout(clearNotificationScheduleFocusWait, 5000);
}

function openRoomTab(target) {
  const button = document.querySelector(`.room-tab[data-target="${target}"]`);
  if (button) {
    button.click();
    return true;
  }
  return false;
}

function commandLabel(command) {
  return command.replace(/\s+/g, ' ');
}

function shallowEqualMessage(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.is(left[key], right[key]));
}

function mergeMessageBatch(list, operations = []) {
  if (!operations.length) return list;

  const next = [...list];
  const indexById = new Map(next.map((item, index) => [item.id, index]));
  const prependById = new Map();
  let changed = false;

  for (const operation of operations) {
    const { messageId, message, prepend = false } = operation;
    if (!messageId || !message) continue;

    const item = { id: messageId, ...message };
    const existing = indexById.get(messageId);
    if (existing !== undefined) {
      if (shallowEqualMessage(next[existing], item)) continue;
      next[existing] = item;
      changed = true;
      continue;
    }

    if (prepend) {
      prependById.set(messageId, item);
      changed = true;
      continue;
    }

    if (prependById.has(messageId)) {
      if (shallowEqualMessage(prependById.get(messageId), item)) continue;
      prependById.set(messageId, item);
      changed = true;
      continue;
    }

    indexById.set(messageId, next.length);
    next.push(item);
    changed = true;
  }

  if (prependById.size) return [...prependById.values(), ...next];
  if (!changed) return list;
  return next;
}

function sameStringArray(left = [], right = []) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function safeImageSource(value) {
  const source = normalizeStoredAvatarUrl(value);
  if (!source) return '';
  return /^(?:https?:\/\/|data:image\/|blob:)/i.test(source) ? source : '';
}

function setHeaderRoom(roomId, roomName) {
  const roomNameEl = document.getElementById('active-room-name-display');
  if (roomNameEl) roomNameEl.textContent = roomName;

  const roomTag = document.getElementById('active-room-tag');
  if (roomTag) {
    roomTag.textContent = roomId === 'global' ? 'PUBLIC' : 'PRIVATE';
    roomTag.className = `tier-badge ${roomId === 'global' ? 'advanced' : 'pro'}`;
  }

  const inviteBtn = document.getElementById('room-drop-invite');
  if (inviteBtn) inviteBtn.style.display = roomId === 'global' ? 'none' : 'block';
}

function clearRoomSearch() {
  const roomSearch = document.getElementById('room-search-input');
  if (!roomSearch) return;
  if (window.setRoomSearchOpen?.(false, { focus: false })) return;
  roomSearch.value = '';
  roomSearch.dispatchEvent(new Event('input', { bubbles: true }));
}

function updateMessageCache(messages) {
  window.msgCache = messages.reduce((acc, message) => {
    acc[message.id] = message;
    return acc;
  }, {});
}

function messageScopeKey(roomId = GLOBAL_ROOM.id, channelId = 'general') {
  return `${roomId || GLOBAL_ROOM.id}::${channelId || 'general'}`;
}

function cacheMessageScopeState(cache, scopeKey, state) {
  if (!scopeKey) return;
  let nextState = state;
  if (Array.isArray(state?.messages) && state.messages.length > MESSAGE_SCOPE_MESSAGE_LIMIT) {
    const messages = state.messages.slice(-MESSAGE_SCOPE_MESSAGE_LIMIT);
    nextState = {
      ...state,
      messages,
      oldestMessageKey: messages[0]?.id || state.oldestMessageKey || null,
      historyExhausted: false,
      scrollTop: state.wasAtBottom === false ? 0 : state.scrollTop,
    };
  }
  cache.delete(scopeKey);
  cache.set(scopeKey, nextState);

  while (cache.size > MESSAGE_SCOPE_CACHE_LIMIT) {
    const oldestScopeKey = cache.keys().next().value;
    if (!oldestScopeKey) break;
    cache.delete(oldestScopeKey);
  }
}

function isMessageListAtBottom(list) {
  if (!list) return true;
  return list.scrollHeight - list.scrollTop - list.clientHeight < 120;
}

function captureMessageViewportAnchor(list) {
  if (!list) return null;
  const listTop = list.getBoundingClientRect().top;
  const element = [...list.querySelectorAll(':scope > li.chat-message')]
    .find((candidate) => candidate.getBoundingClientRect().bottom > listTop);
  if (!element?.id?.startsWith('msg-')) return null;
  return {
    messageId: element.id.slice(4),
    offsetTop: element.getBoundingClientRect().top - listTop,
    scrollHeight: list.scrollHeight,
    scrollTop: list.scrollTop,
  };
}

function lastRoomStorageKey(uid) {
  return `${LAST_ROOM_STORAGE_PREFIX}:${uid || 'guest'}`;
}

function readLastRoomPreference(uid) {
  try {
    const raw = localStorage.getItem(lastRoomStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.roomId) return null;
    return {
      roomId: String(parsed.roomId),
      roomName: String(parsed.roomName || ''),
      shortId: String(parsed.shortId || ''),
      channelId: String(parsed.channelId || 'general'),
    };
  } catch {
    return null;
  }
}

function writeLastRoomPreference(room, channelId = 'general', uid) {
  if (!room?.id) return;
  try {
    localStorage.setItem(lastRoomStorageKey(uid), JSON.stringify({
      roomId: room.id,
      roomName: room.name || (room.id === 'global' ? GLOBAL_ROOM.name : 'Room'),
      shortId: room.shortId || (room.id === 'global' ? GLOBAL_ROOM.shortId : room.id),
      channelId: room.id === 'global' ? 'general' : (channelId || 'general'),
      savedAt: Date.now(),
    }));
  } catch {
    // Local persistence is a convenience only; chat still works without it.
  }
}

function roomFromPreference(preference) {
  if (!preference?.roomId) return GLOBAL_ROOM;
  return {
    id: preference.roomId,
    name: preference.roomName || (preference.roomId === 'global' ? GLOBAL_ROOM.name : 'Room'),
    shortId: preference.shortId || (preference.roomId === 'global' ? GLOBAL_ROOM.shortId : preference.roomId),
  };
}

function roomInitials(name) {
  return String(name || 'Room')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || 'R';
}

function roomPreference(roomPrefs, roomId) {
  return roomPrefs?.[roomId] || {};
}

function sortRoomsForList(rooms, roomPrefs) {
  return rooms
    .map((room, index) => ({ room, index, prefs: roomPreference(roomPrefs, room.id) }))
    .sort((a, b) => {
      if (a.room.id === GLOBAL_ROOM.id) return -1;
      if (b.room.id === GLOBAL_ROOM.id) return 1;

      const aFavorite = a.prefs.favorite === true;
      const bFavorite = b.prefs.favorite === true;
      if (aFavorite !== bFavorite) return aFavorite ? -1 : 1;

      if (aFavorite && bFavorite) {
        return Number(b.prefs.favoriteAt || 0) - Number(a.prefs.favoriteAt || 0) || a.index - b.index;
      }

      return a.index - b.index;
    })
    .map(({ room }) => room);
}

const IS_APPLE_PLATFORM = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
const QUICK_SWITCH_SHORTCUT_LABEL = IS_APPLE_PLATFORM ? '⌘K' : 'Ctrl K';

function RoomIcon({ room }) {
  if (room.id === 'global') {
    return (
      <span className="room-icon room-icon-globe" aria-hidden="true">
        <i className="ph-bold ph-globe-hemisphere-west" />
      </span>
    );
  }

  if (room.photoUrl) {
    return (
      <span className="room-icon">
        <img src={room.photoUrl} alt="" width="40" height="40" decoding="async" loading="lazy" />
      </span>
    );
  }

  return <span className="room-icon room-icon-fallback" aria-hidden="true">{roomInitials(room.name)}</span>;
}

const RoomListItem = memo(function RoomListItem({
  activeRoomId,
  hidden = false,
  onHideRoom,
  onSwitchRoom,
  onToggleFavorite,
  onUnhideRoom,
  prefs,
  room,
}) {
  const isActive = room.id === activeRoomId;
  const isFavorite = prefs.favorite === true;
  const itemClass = [
    'room-item',
    isActive ? 'active' : '',
    isFavorite ? 'favorited' : '',
    hidden ? 'hidden-room-item' : '',
  ].filter(Boolean).join(' ');

  const handleSwitch = async () => {
    if (hidden && onUnhideRoom) await onUnhideRoom(room, { silent: true });
    onSwitchRoom(room.id, room.name, room.shortId);
  };

  return (
    <li
      className={itemClass}
      title={room.name}
      onClick={(event) => {
        if (event.target === event.currentTarget) void handleSwitch();
      }}
    >
      <button
        type="button"
        className="room-select-button"
        aria-current={isActive ? 'page' : undefined}
        onClick={(event) => {
          event.stopPropagation();
          void handleSwitch();
        }}
        onKeyDown={(event) => {
          if (!['Enter', ' '].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          void handleSwitch();
        }}
      >
        <RoomIcon room={room} />
        <span className="room-copy">
          <span className="room-name">
            {room.name}
            {isFavorite ? (
              <span className="room-favorite-mark" aria-label="Favorite room">
                <i className="ph-bold ph-star" aria-hidden="true" />
              </span>
            ) : null}
          </span>
          <span className="room-preview">{hidden ? 'Hidden room' : (room.lastMessage || 'No messages yet...')}</span>
        </span>
      </button>
      <span className="room-actions" aria-label={`${room.name} room actions`}>
        <button
          type="button"
          className={`room-action-icon room-fav-btn ${isFavorite ? 'active' : ''}`}
          title={isFavorite ? 'Remove favorite' : 'Favorite room'}
          aria-label={isFavorite ? `Remove ${room.name} from favorites` : `Favorite ${room.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(room);
          }}
        >
          <i className="ph-bold ph-star" />
        </button>
        {room.id !== GLOBAL_ROOM.id ? (
          <button
            type="button"
            className="room-action-icon room-hide-btn"
            title={hidden ? 'Show room' : 'Hide room'}
            aria-label={hidden ? `Show ${room.name}` : `Hide ${room.name}`}
            onClick={(event) => {
              event.stopPropagation();
              if (hidden) onUnhideRoom(room);
              else onHideRoom(room);
            }}
          >
            <i className={`ph-bold ${hidden ? 'ph-eye' : 'ph-eye-slash'}`} />
          </button>
        ) : null}
      </span>
    </li>
  );
});

const RoomList = memo(function RoomList({ rooms, roomPrefs, activeRoomId, onSwitchRoom, onToggleFavorite, onHideRoom, onUnhideRoom, onOpenQuickSwitch, quickSwitcherOpen }) {
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const visibleRooms = useMemo(
    () => sortRoomsForList(rooms.filter((room) => room.id === GLOBAL_ROOM.id || !roomPreference(roomPrefs, room.id).hidden), roomPrefs),
    [roomPrefs, rooms],
  );
  const hiddenRooms = useMemo(
    () => sortRoomsForList(rooms.filter((room) => room.id !== GLOBAL_ROOM.id && roomPreference(roomPrefs, room.id).hidden), roomPrefs),
    [roomPrefs, rooms],
  );

  return (
    <>
      {onOpenQuickSwitch ? (
        <li className="room-quick-switch">
          <button
            type="button"
            className="room-quick-switch-btn"
            onClick={onOpenQuickSwitch}
            aria-haspopup="dialog"
            aria-controls="room-quick-switcher"
            aria-expanded={Boolean(quickSwitcherOpen)}
            aria-keyshortcuts="Control+K Meta+K"
            aria-label="Jump to a room or channel"
            title="Jump to a room or channel"
          >
            <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
            <span className="room-quick-switch-label">Jump to…</span>
            <kbd className="room-quick-switch-kbd" aria-hidden="true">{QUICK_SWITCH_SHORTCUT_LABEL}</kbd>
          </button>
        </li>
      ) : null}
      {visibleRooms.map((room) => (
        <RoomListItem
          activeRoomId={activeRoomId}
          key={room.id}
          onHideRoom={onHideRoom}
          onSwitchRoom={onSwitchRoom}
          onToggleFavorite={onToggleFavorite}
          onUnhideRoom={onUnhideRoom}
          prefs={roomPreference(roomPrefs, room.id)}
          room={room}
        />
      ))}
      {hiddenRooms.length ? (
        <li className="room-hidden-section">
          <button
            type="button"
            className="room-hidden-toggle"
            onClick={() => setHiddenOpen((current) => !current)}
            aria-expanded={hiddenOpen}
          >
            <span><i className={`ph-bold ${hiddenOpen ? 'ph-caret-down' : 'ph-caret-right'}`} /> Hidden rooms</span>
            <span>{hiddenRooms.length}</span>
          </button>
          {hiddenOpen ? (
            <ul className="room-hidden-list">
              {hiddenRooms.map((room) => (
                <RoomListItem
                  activeRoomId={activeRoomId}
                  hidden
                  key={room.id}
                  onHideRoom={onHideRoom}
                  onSwitchRoom={onSwitchRoom}
                  onToggleFavorite={onToggleFavorite}
                  onUnhideRoom={onUnhideRoom}
                  prefs={roomPreference(roomPrefs, room.id)}
                  room={room}
                />
              ))}
            </ul>
          ) : null}
        </li>
      ) : null}
    </>
  );
});

function ChannelBar({
  activeRoomId,
  channels,
  activeChannelId,
  onSwitchChannel,
  onAddChannel,
  onConfigureChannel,
}) {
  if (activeRoomId === 'global') return null;
  return (
    <>
      {channels.map((channel) => (
        <button
          key={channel.id}
          type="button"
          className={`channel-chip channel-mode-${channel.mode || 'chat'} ${channel.id === activeChannelId ? 'active' : ''}`}
          onClick={() => onSwitchChannel(channel.id)}
          title={`${channel.name} · ${channel.mode === 'announcements' ? 'Announcements' : channel.mode === 'help' ? 'Help queue' : 'Chat'}`}
        >
          <i
            className={`ph-bold ${channel.mode === 'announcements' ? 'ph-megaphone' : channel.mode === 'help' ? 'ph-lifebuoy' : 'ph-hash'}`}
            aria-hidden="true"
          />
          {channel.name}
        </button>
      ))}
      {activeChannelId !== 'general' ? (
        <button
          type="button"
          className="channel-chip channel-configure"
          onClick={() => onConfigureChannel(channels.find((channel) => channel.id === activeChannelId))}
          title="Configure channel mode and posting role"
          aria-label="Configure active channel"
        >
          <i className="ph-bold ph-sliders-horizontal" aria-hidden="true" />
        </button>
      ) : null}
      <button type="button" className="channel-chip channel-add" onClick={onAddChannel}>
        <i className="ph-bold ph-plus" aria-hidden="true" />
        Channel
      </button>
    </>
  );
}

function ReactionPills({ message, onReact }) {
  const reactions = useMemo(() => {
    return collectMessageReactions(message.reactions, window.currentUser?.uid);
  }, [message.reactions]);

  if (!reactions.length) return <div className="msg-reactions" id={`reactions-${message.id}`} />;

  return (
    <div className="msg-reactions" id={`reactions-${message.id}`}>
      {reactions.map(([emoji, info]) => (
        <button
          className={`reaction-pill ${info.mine ? 'mine' : ''}`}
          data-emoji={emoji}
          key={emoji}
          onClick={() => onReact(message.id, emoji)}
          type="button"
          aria-label={`${emoji} reaction, ${info.n} ${info.n === 1 ? 'person' : 'people'}; ${info.mine ? 'remove your reaction' : 'add this reaction'}`}
          aria-pressed={info.mine}
        >
          {emoji} {info.n}
        </button>
      ))}
    </div>
  );
}

function TextFilePreview({ file }) {
  const [expanded, setExpanded] = useState(false);
  if (!file?.textPreview) return null;
  const fullPreview = String(file.textPreview);
  const collapsedPreview = fullPreview.length > 700 ? `${fullPreview.slice(0, 700)}\n…` : fullPreview;

  return (
    <div className={`msg-file-text-preview ${expanded ? 'expanded' : ''}`}>
      <pre>{expanded ? fullPreview : collapsedPreview}</pre>
      {(file.textPreviewTruncated || fullPreview.length > 700) ? (
        <button className="msg-preview-toggle" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Collapse preview' : 'Expand text preview'}
        </button>
      ) : null}
    </div>
  );
}

function LinkPreviewCard({ preview }) {
  const safePreview = normalizeLinkPreview(preview);
  if (!safePreview) return null;
  return (
    <a
      className="msg-link-preview"
      href={safePreview.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${safePreview.title} on ${safePreview.domain}`}
    >
      <span className="msg-link-preview-domain">
        <i className="ph-bold ph-link-simple" aria-hidden="true" />
        {safePreview.domain}
      </span>
      <strong>{safePreview.title}</strong>
      {safePreview.description ? <span className="msg-link-preview-description">{safePreview.description}</span> : null}
    </a>
  );
}

function PollCard({ message, onVotePoll, onClosePoll }) {
  const poll = message.poll;
  if (!poll?.question) return null;

  const results = aggregatePollResults(poll, { viewerUid: window.currentUser?.uid });
  const total = results.participantCount;
  const selectedOptions = new Set(results.viewerOptionIds);
  const closed = results.closed;
  const isAuthor = message.uid === window.currentUser?.uid;

  return (
    <div className={`poll-card ${closed ? 'poll-closed' : ''}`}>
      <div className="poll-title">
        <span><i className="ph-bold ph-chart-bar" /> {poll.question}</span>
        {closed ? <em className="poll-status">Closed</em> : null}
      </div>
      {results.options.map((option) => {
        const winner = closed && option.winner;
        return (
          <button
            className={`poll-option ${selectedOptions.has(option.id) ? 'mine' : ''} ${winner ? 'winner' : ''}`}
            disabled={closed}
            key={option.id}
            type="button"
            onClick={() => onVotePoll(message.id, option.id)}
          >
            <span className="poll-bar" style={{ width: `${option.percentage}%` }} />
            <span>{option.text} · {option.count} vote{option.count === 1 ? '' : 's'} {total ? `(${option.percentage}%)` : ''}{winner ? ' · winner' : ''}</span>
          </button>
        );
      })}
      <div className="poll-meta">
        <span>
          {total} participant{total === 1 ? '' : 's'}
          {results.multipleChoice ? ' · Choose multiple' : ''}
          {results.anonymous ? ' · Anonymous results' : ''}
          {!closed && poll.closesAt ? ` · Closes ${formatDueDate(poll.closesAt)}` : ''}
        </span>
        {isAuthor && !closed ? (
          <button type="button" className="poll-close-btn" onClick={() => onClosePoll(message.id)}>
            Close poll
          </button>
        ) : null}
      </div>
    </div>
  );
}

function pollResultsText(message) {
  const poll = message?.poll;
  if (!poll?.question) return '';
  const results = aggregatePollResults(poll, { viewerUid: window.currentUser?.uid });
  const lines = results.options.map((option) => `${option.text}: ${option.count} (${option.percentage}%)`);
  return [
    `${results.closed ? 'Closed poll' : 'Poll'}: ${poll.question}`,
    ...lines,
    `${results.participantCount} participant${results.participantCount === 1 ? '' : 's'}`,
  ].join('\n');
}

function ReminderCard({ message, onSaveReminder }) {
  if (!message.reminder?.text) return null;
  return (
    <div className="reminder-card">
      <div className="reminder-title"><i className="ph-bold ph-alarm" /> {message.reminder.text}</div>
      <div className="reminder-meta">Due {formatDueDate(message.reminder.dueAt)} · by {message.reminder.byName || message.name || 'Someone'}</div>
      <button type="button" onClick={() => onSaveReminder(message.reminder)}>Remind me</button>
    </div>
  );
}

function MessageJumpContext({ jump, onDismiss, onLoadOlder }) {
  if (!jump) return null;

  const isFound = jump.status === 'found';
  const isExhausted = jump.status === 'exhausted';
  const title = jump.source === 'saved'
    ? 'Opening saved message'
    : jump.source === 'reply'
      ? 'Opening replied message'
      : 'Opening message';
  const detail = isFound
    ? 'Found it in this thread.'
    : isExhausted
      ? 'That message is not in the available loaded history anymore.'
      : 'Looking in loaded history. Load older messages if it is not visible yet.';

  return (
    <div className={`message-jump-context ${isFound ? 'is-found' : ''} ${isExhausted ? 'is-exhausted' : ''}`} role="status" aria-live="polite">
      <i className={`ph-bold ${isFound ? 'ph-check-circle' : isExhausted ? 'ph-warning-circle' : 'ph-crosshair'}`} aria-hidden="true" />
      <div className="message-jump-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {!isFound && !isExhausted ? (
        <button className="message-jump-load" type="button" onClick={onLoadOlder}>
          <i className="ph-bold ph-arrow-up" aria-hidden="true" />
          Load older
        </button>
      ) : null}
      <button className="message-jump-dismiss" type="button" onClick={onDismiss} aria-label="Dismiss message jump notice">
        <i className="ph-bold ph-x" aria-hidden="true" />
      </button>
    </div>
  );
}

function MessageListEmptyState({ kind = 'empty', readOnly = false, roomName = 'this room' }) {
  const isSearch = kind === 'search';
  const isLoading = kind === 'loading';
  const isError = kind === 'error';
  const title = isSearch
    ? 'No messages match that search'
    : isLoading
      ? 'Loading messages...'
      : isError
        ? "Messages couldn't load"
    : readOnly
      ? 'This room is read-only for you'
      : 'No messages yet';
  const body = isSearch
    ? 'Try another term, or clear search from the room header to see the full thread.'
    : isLoading
      ? 'Syncing the latest conversation and saved history.'
      : isError
        ? 'Check your connection or room access, then reopen this room to retry.'
    : readOnly
      ? 'You can still browse the history here. Posting is disabled by room permissions.'
      : `Start the conversation in ${roomName || 'this room'}.`;

  return (
    <li className={`chat-empty-state ${isSearch ? 'is-search' : ''} ${isLoading ? 'is-loading' : ''} ${isError ? 'is-error' : ''} ${readOnly ? 'is-readonly' : ''}`} role="status">
      <i className={`ph-bold ${isSearch ? 'ph-magnifying-glass' : isLoading ? 'ph-spinner-gap' : isError ? 'ph-warning-circle' : readOnly ? 'ph-lock-key' : 'ph-chat-circle-dots'}`} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{body}</span>
    </li>
  );
}

const CATCHUP_COLLAPSE_KEY = 'minimalist:catchup-collapsed';

function readCatchUpCollapsed() {
  try {
    return localStorage.getItem(CATCHUP_COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function RoomCatchUpStrip({
  hidden = false,
  messages,
  onCreateTask,
  onOpenRoomAi,
  onReviewMessage,
  scopeKey,
  userId,
  viewerName,
  viewerShortId,
}) {
  const [collapsed, setCollapsed] = useState(readCatchUpCollapsed);
  const [reviewedMessageId, setReviewedMessageId] = useState(() => (
    loadRoomCatchUpReviewedId(userId, scopeKey)
  ));
  const [reviewIndex, setReviewIndex] = useState(null);
  const [reviewNotice, setReviewNotice] = useState(null);
  const reviewNoticeTimerRef = useRef(null);
  const panelId = `room-catchup-panel-${String(scopeKey || 'default').replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const titleId = `${panelId}-title`;
  const storageKey = roomCatchUpReviewedStorageKey(userId, scopeKey);
  const insight = useMemo(() => buildRoomCatchUp(messages, {
    reviewedMessageId,
    viewerName,
    viewerShortId,
    viewerUid: userId,
  }), [messages, reviewedMessageId, userId, viewerName, viewerShortId]);

  const setCollapsedPref = useCallback((next) => {
    setCollapsed(next);
    try {
      if (next) localStorage.setItem(CATCHUP_COLLAPSE_KEY, '1');
      else localStorage.removeItem(CATCHUP_COLLAPSE_KEY);
    } catch {
      // Ignore storage failures (private mode / blocked storage).
    }
  }, []);

  useEffect(() => {
    const syncReviewState = (event) => {
      if (event?.detail?.storageKey !== storageKey) return;
      setReviewedMessageId(String(event.detail.reviewedMessageId || ''));
    };
    const syncStorageState = (event) => {
      if (event.key !== storageKey) return;
      setReviewedMessageId(String(event.newValue || ''));
    };

    window.addEventListener(ROOM_CATCHUP_REVIEW_EVENT, syncReviewState);
    window.addEventListener('storage', syncStorageState);
    return () => {
      window.removeEventListener(ROOM_CATCHUP_REVIEW_EVENT, syncReviewState);
      window.removeEventListener('storage', syncStorageState);
    };
  }, [storageKey]);

  useEffect(() => () => {
    if (reviewNoticeTimerRef.current) window.clearTimeout(reviewNoticeTimerRef.current);
  }, []);

  const jumpToReviewIndex = useCallback((nextIndex) => {
    const ids = insight?.reviewMessageIds || [];
    if (!ids.length) return;
    const clampedIndex = Math.max(0, Math.min(nextIndex, ids.length - 1));
    setReviewIndex(clampedIndex);
    onReviewMessage(ids[clampedIndex]);
  }, [insight?.reviewMessageIds, onReviewMessage]);

  const startReview = useCallback(() => {
    jumpToReviewIndex(0);
  }, [jumpToReviewIndex]);

  const reviewHighlight = useCallback(() => {
    const ids = insight?.reviewMessageIds || [];
    const highlightIndex = Math.max(0, ids.indexOf(insight?.highlight?.id));
    jumpToReviewIndex(highlightIndex);
  }, [insight?.highlight?.id, insight?.reviewMessageIds, jumpToReviewIndex]);

  const markReviewed = useCallback(() => {
    const latestId = insight?.latestId || '';
    if (!latestId) return;
    const previousId = reviewedMessageId;
    setReviewedMessageId(latestId);
    saveRoomCatchUpReviewedId(userId, scopeKey, latestId);
    setReviewIndex(null);
    setReviewNotice({ latestId, previousId });
    if (reviewNoticeTimerRef.current) window.clearTimeout(reviewNoticeTimerRef.current);
    reviewNoticeTimerRef.current = window.setTimeout(() => {
      reviewNoticeTimerRef.current = null;
      setReviewNotice(null);
    }, 6000);
  }, [insight?.latestId, reviewedMessageId, scopeKey, userId]);

  const undoReviewed = useCallback(() => {
    const previousId = reviewNotice?.previousId || '';
    if (reviewNoticeTimerRef.current) window.clearTimeout(reviewNoticeTimerRef.current);
    reviewNoticeTimerRef.current = null;
    saveRoomCatchUpReviewedId(userId, scopeKey, previousId);
    setReviewedMessageId(previousId);
    setReviewNotice(null);
  }, [reviewNotice?.previousId, scopeKey, userId]);

  if (hidden) return null;

  if (!insight) {
    if (!reviewNotice || reviewNotice.latestId !== reviewedMessageId) return null;
    return (
      <section className="room-catchup-v2 is-reviewed" aria-label="Room catch-up" role="status">
        <span className="room-catchup-v2__icon" aria-hidden="true">
          <i className="ph-bold ph-check" />
        </span>
        <span className="room-catchup-v2__reviewed-copy">
          <strong>All caught up for now</strong>
          <small>New activity will appear here.</small>
        </span>
        <button type="button" className="room-catchup-v2__undo" onClick={undoReviewed}>Undo</button>
      </section>
    );
  }

  const reviewIds = insight.reviewMessageIds;
  const reviewActive = Number.isInteger(reviewIndex) && reviewIds.length > 0;
  const activeReviewIndex = reviewActive ? Math.min(reviewIndex, reviewIds.length - 1) : 0;

  return (
    <section
      className={`room-catchup-v2 ${collapsed ? 'is-collapsed' : ''} ${reviewActive ? 'is-reviewing' : ''}`}
      aria-labelledby={titleId}
    >
      <div className="room-catchup-v2__summary">
        <span className="room-catchup-v2__icon" aria-hidden="true">
          <i className="ph-bold ph-lightning" />
        </span>
        <div className="room-catchup-v2__heading">
          <h2 id={titleId}>{insight.title}</h2>
        </div>
        <div className="room-catchup-v2__signals" aria-label={insight.signals.join(', ')}>
          {insight.signals.map((signal) => <span key={signal}>{signal}</span>)}
        </div>
        <div className="room-catchup-v2__primary-actions">
          {reviewActive ? (
            <div className="room-catchup-v2__review-nav" aria-label="Review navigation">
              <button
                type="button"
                onClick={() => jumpToReviewIndex(activeReviewIndex - 1)}
                disabled={activeReviewIndex === 0}
                aria-label="Previous update"
                title="Previous update"
              >
                <i className="ph-bold ph-arrow-left" aria-hidden="true" />
              </button>
              <span aria-live="polite">{activeReviewIndex + 1} of {reviewIds.length}</span>
              <button
                type="button"
                onClick={() => jumpToReviewIndex(activeReviewIndex + 1)}
                disabled={activeReviewIndex === reviewIds.length - 1}
                aria-label="Next update"
                title="Next update"
              >
                <i className="ph-bold ph-arrow-right" aria-hidden="true" />
              </button>
              <button type="button" className="room-catchup-v2__done" onClick={markReviewed}>Done</button>
            </div>
          ) : (
            <button type="button" className="room-catchup-v2__review" onClick={startReview}>
              Review
              <i className="ph-bold ph-arrow-right" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="room-catchup-v2__toggle"
            onClick={() => setCollapsedPref(!collapsed)}
            aria-controls={panelId}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand room catch-up' : 'Collapse room catch-up'}
            title={collapsed ? 'Expand room catch-up' : 'Collapse room catch-up'}
          >
            <svg className="room-catchup-v2__toggle-icon" viewBox="0 0 20 20" aria-hidden="true">
              <path d={collapsed ? 'm5 8 5 5 5-5' : 'm5 12 5-5 5 5'} />
            </svg>
          </button>
        </div>
      </div>
      {!collapsed ? (
        <div className="room-catchup-v2__details" id={panelId}>
          <button type="button" className="room-catchup-v2__highlight" onClick={reviewHighlight}>
            <span className="room-catchup-v2__highlight-label">{insight.highlight.label}</span>
            <strong>{insight.highlight.name}</strong>
            <span>{insight.highlight.text}</span>
            <i className="ph-bold ph-arrow-up-right" aria-hidden="true" />
          </button>
          <div className="room-catchup-v2__secondary-actions" aria-label="Catch-up actions">
            <button type="button" onClick={onOpenRoomAi}>
              <i className="ph-bold ph-sparkle" aria-hidden="true" />
              Open Room AI
            </button>
            {insight.taskText ? (
              <button type="button" onClick={() => onCreateTask(insight.taskText)}>
                <i className="ph-bold ph-check-square" aria-hidden="true" />
                Save task
              </button>
            ) : null}
            <button type="button" onClick={markReviewed}>
              <i className="ph-bold ph-check-circle" aria-hidden="true" />
              Mark reviewed
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SlashCommandMenu({ commands, selectedIndex, onRun, onHover }) {
  if (!commands.length) {
    return (
      <div className="slash-command-menu">
        <div className="slash-command-empty">No command found. Try <code>/help</code>.</div>
      </div>
    );
  }

  return (
    <div className="slash-command-menu" role="listbox" aria-label="Slash commands">
      <div className="slash-command-head">
        <span>Commands</span>
        <small>↑↓ select · Enter run</small>
      </div>
      {commands.map((command, index) => (
        <button
          aria-selected={selectedIndex === index}
          className={`slash-command-row ${selectedIndex === index ? 'active' : ''}`}
          key={command.command}
          onClick={() => onRun(command)}
          onMouseEnter={() => onHover(index)}
          role="option"
          type="button"
        >
          <span className="slash-command-main">
            <strong>{commandLabel(command.command)}</strong>
            <small>{command.description}</small>
          </span>
          <span className="slash-command-category">{command.category}</span>
        </button>
      ))}
    </div>
  );
}

function MentionMenu({ suggestions, selectedIndex, onPick, onHover }) {
  return (
    <div className="mention-suggest-menu" role="listbox" aria-label="Mention people">
      <div className="mention-suggest-head">
        <span>Mention someone</span>
        <small>↑↓ select · Enter insert</small>
      </div>
      {suggestions.length ? suggestions.map((candidate, index) => {
        const handle = candidateMentionHandle(candidate);
        return (
          <button
            aria-selected={selectedIndex === index}
            className={`mention-suggest-row ${selectedIndex === index ? 'active' : ''}`}
            key={candidate.uid}
            onClick={() => onPick(candidate)}
            onMouseEnter={() => onHover(index)}
            role="option"
            type="button"
          >
            <span className="mention-suggest-avatar">
              {candidate.photoUrl ? <img src={candidate.photoUrl} alt="" /> : (candidate.name || '?').slice(0, 2).toUpperCase()}
            </span>
            <span className="mention-suggest-copy">
              <strong>{candidate.name}</strong>
              <small>@{handle}</small>
            </span>
          </button>
        );
      }) : (
        <div className="mention-suggest-empty">No matching people here.</div>
      )}
    </div>
  );
}

function CommandListModal({ open, onClose, onRun }) {
  if (!open) return null;
  return (
    <div className="command-list-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="command-list-modal" role="dialog" aria-modal="true" aria-labelledby="command-list-title">
        <div className="command-list-head">
          <div>
            <span className="command-list-kicker">Slash commands</span>
            <h2 id="command-list-title">Command Center</h2>
          </div>
          <button type="button" className="command-list-close" onClick={onClose} aria-label="Close command list">
            <i className="ph-bold ph-x" />
          </button>
        </div>
        <div className="command-list-body">
          {SLASH_COMMAND_GROUPS.map((group) => (
            <div className="command-list-section" key={group.name}>
              <h3>{group.name}</h3>
              <div className="command-list-grid">
                {group.commands.map(([command, description, action]) => (
                  <button
                    className="command-list-item"
                    key={command}
                    onClick={() => onRun({ command, description, action, category: group.name })}
                    type="button"
                  >
                    <code>{command}</code>
                    <span>{description}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const QUICK_SWITCH_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'channels', label: 'Channels' },
];

// Mounted only while open (see ChatCore), so search and filter state starts
// fresh on every launch without a reset effect.
function QuickSwitcher({ rooms, roomPrefs, channels, activeRoomId, activeChannelId, onClose, onPick }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const modalRef = useRef(null);

  const model = useMemo(
    () => buildQuickSwitchModel({
      rooms,
      roomPrefs,
      activeChannels: channels,
      activeRoomId,
      activeChannelId,
      query,
      filter,
    }),
    [activeChannelId, activeRoomId, channels, filter, query, roomPrefs, rooms],
  );
  const { groups, results, effectiveFilter, counts } = model;
  const resultIndexByKey = useMemo(
    () => new Map(results.map((result, index) => [result.key, index])),
    [results],
  );

  // Clamp during render so a shrinking result set never points past the end.
  const activeIndex = results.length ? Math.min(selectedIndex, results.length - 1) : 0;

  // Focus the field and lock the page behind the modal while mounted.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Keep the highlighted row visible while navigating with the keyboard.
  useEffect(() => {
    const activeOption = listRef.current?.querySelector('.quick-switch-item.active');
    activeOption?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, results.length]);

  const pick = (result) => {
    if (result) onPick(result);
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex(results.length ? Math.min(activeIndex + 1, results.length - 1) : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex(Math.max(activeIndex - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(results[activeIndex]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setSelectedIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setSelectedIndex(Math.max(results.length - 1, 0));
    }
  };

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...(modalRef.current?.querySelectorAll('input, button:not([disabled])') || [])]
      .filter((element) => element.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const selectFilter = (nextFilter) => {
    if (query.trim().startsWith('#') && nextFilter !== 'channels') {
      setQuery(query.replace(/^\s*#\s*/, ''));
    }
    setFilter(nextFilter);
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div
      className="quick-switch-overlay"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        className="quick-switch-modal"
        id="room-quick-switcher"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-switch-title"
        onKeyDownCapture={handleDialogKeyDown}
      >
        <span className="quick-switch-mobile-handle" aria-hidden="true" />
        <header className="quick-switch-head">
          <span className="quick-switch-title" id="quick-switch-title">Jump to</span>
          <div className="quick-switch-search-wrap">
            <i className="ph-bold ph-magnifying-glass quick-switch-head-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              className="quick-switch-input"
              placeholder="Search rooms and channels…"
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls="quick-switch-list"
              aria-activedescendant={results.length ? `quick-switch-opt-${activeIndex}` : undefined}
              aria-describedby="quick-switch-result-status"
              aria-label="Search rooms and channels"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
          <button type="button" className="quick-switch-close" onClick={onClose} aria-label="Close quick switcher">
            <i className="ph-bold ph-x" aria-hidden="true" />
          </button>
        </header>

        <div className="quick-switch-filters" role="group" aria-label="Filter destinations">
          {QUICK_SWITCH_FILTERS.map((option) => (
            <button
              type="button"
              key={option.id}
              className={`quick-switch-filter ${effectiveFilter === option.id ? 'active' : ''}`}
              aria-pressed={effectiveFilter === option.id}
              onClick={() => selectFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <span className="quick-switch-result-status" id="quick-switch-result-status" role="status" aria-live="polite">
          {counts.visible} {counts.visible === 1 ? 'destination' : 'destinations'} available
        </span>

        <ul className="quick-switch-list" id="quick-switch-list" role="listbox" aria-label="Rooms and channels" ref={listRef}>
          {groups.length ? groups.map((group) => (
            <li
              className="quick-switch-group-section"
              key={group.id}
              role="group"
              aria-labelledby={`quick-switch-group-${group.id}`}
            >
              <div className="quick-switch-group" id={`quick-switch-group-${group.id}`}>{group.label}</div>
              <ul className="quick-switch-group-list" role="presentation">
                {group.destinations.map((result) => {
                  const index = resultIndexByKey.get(result.key) || 0;
                  const isActive = index === activeIndex;
                  const resultLabel = result.type === 'channel'
                    ? `${result.name} channel in ${result.roomName}`
                    : `${result.name}${result.meta ? `, ${result.meta}` : ''}`;
                  return (
                    <li
                      className={`quick-switch-item ${isActive ? 'active' : ''}`}
                      id={`quick-switch-opt-${index}`}
                      key={result.key}
                      role="option"
                      aria-label={resultLabel}
                      aria-selected={isActive}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => pick(result)}
                    >
                      {result.type === 'room' ? (
                        <RoomIcon room={result.room} />
                      ) : (
                        <span className="room-icon room-icon-fallback quick-switch-hash" aria-hidden="true">#</span>
                      )}
                      <span className="quick-switch-copy">
                        <span className="quick-switch-name">{result.name}</span>
                        {result.type === 'channel' ? (
                          <span className="quick-switch-meta quick-switch-breadcrumb">
                            <span>{result.roomName}</span>
                            <i className="ph-bold ph-caret-right" aria-hidden="true" />
                            <span>#{result.name}</span>
                          </span>
                        ) : result.meta ? <span className="quick-switch-meta">{result.meta}</span> : null}
                      </span>
                      <span className="quick-switch-row-end">
                        {result.current ? <span className="quick-switch-badge current">Current</span> : null}
                        {result.favorite ? (
                          <span className="quick-switch-badge favorite"><i className="ph-bold ph-star" aria-hidden="true" /> Favorite</span>
                        ) : null}
                        {isActive ? <i className="ph-bold ph-arrow-elbow-down-left quick-switch-enter" aria-hidden="true" /> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          )) : (
            <li className="quick-switch-empty" role="presentation">
              <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
              <strong>No destinations found</strong>
              <span>{query.trim() ? `Nothing matches “${query.trim()}”.` : 'Try another destination filter.'}</span>
            </li>
          )}
        </ul>

        <div className="quick-switch-foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>#</kbd> channels</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </section>
    </div>
  );
}

function ComposerActionDialog({ mode, onClose, onSubmit, submitting }) {
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState('Yes, No, Maybe');
  const [pollMultipleChoice, setPollMultipleChoice] = useState(false);
  const [pollAnonymous, setPollAnonymous] = useState(false);
  const [pollClosesAt, setPollClosesAt] = useState('');
  const [reminderText, setReminderText] = useState('');
  const [reminderDueAt, setReminderDueAt] = useState(() => toDateTimeLocalValue());
  const [minReminderDueAt] = useState(() => toDateTimeLocalValue(Date.now() + 60 * 1000));

  if (!mode) return null;

  const isPoll = mode === 'poll';
  const title = isPoll ? 'Create Poll' : 'Create Reminder';
  const description = isPoll
    ? 'Ask a question and add 2–6 choices. Separate choices with commas or new lines.'
    : 'Post a reminder to the room and save it to your reminder list.';

  const handleSubmit = (event) => {
    event.preventDefault();
    if (submitting) return;
    onSubmit(isPoll
      ? {
        question: pollQuestion,
        optionsText: pollOptions,
        multipleChoice: pollMultipleChoice,
        anonymous: pollAnonymous,
        closesAt: pollClosesAt,
      }
      : { text: reminderText, dueAtValue: reminderDueAt });
  };

  return (
    <div className="composer-dialog-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="composer-dialog" role="dialog" aria-modal="true" aria-labelledby="composer-dialog-title" onSubmit={handleSubmit}>
        <div className="composer-dialog-head">
          <div>
            <span className="composer-dialog-kicker">{isPoll ? 'Decision' : 'Reminder'}</span>
            <h2 id="composer-dialog-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" className="composer-dialog-close" onClick={onClose} aria-label={`Close ${title}`}>
            <i className="ph-bold ph-x" />
          </button>
        </div>

        {isPoll ? (
          <div className="composer-dialog-fields">
            <label>
              <span>Question</span>
              <input
                autoFocus
                maxLength={180}
                onChange={(event) => setPollQuestion(event.target.value)}
                placeholder="What should we pick?"
                value={pollQuestion}
              />
            </label>
            <label>
              <span>Options</span>
              <textarea
                onChange={(event) => setPollOptions(event.target.value)}
                placeholder="Yes, No, Maybe"
                rows={4}
                value={pollOptions}
              />
            </label>
            <label>
              <span>Close automatically (optional)</span>
              <input
                min={minReminderDueAt}
                onChange={(event) => setPollClosesAt(event.target.value)}
                type="datetime-local"
                value={pollClosesAt}
              />
            </label>
            <label className="composer-dialog-check">
              <input
                checked={pollMultipleChoice}
                onChange={(event) => setPollMultipleChoice(event.target.checked)}
                type="checkbox"
              />
              <span>Allow multiple choices</span>
            </label>
            <label className="composer-dialog-check">
              <input
                checked={pollAnonymous}
                onChange={(event) => setPollAnonymous(event.target.checked)}
                type="checkbox"
              />
              <span>Hide voter identities in results</span>
            </label>
          </div>
        ) : (
          <div className="composer-dialog-fields">
            <label>
              <span>Reminder</span>
              <input
                autoFocus
                maxLength={180}
                onChange={(event) => setReminderText(event.target.value)}
                placeholder="Send project update"
                value={reminderText}
              />
            </label>
            <label>
              <span>When</span>
              <input
                min={minReminderDueAt}
                onChange={(event) => setReminderDueAt(event.target.value)}
                type="datetime-local"
                value={reminderDueAt}
              />
            </label>
          </div>
        )}

        <div className="composer-dialog-actions">
          <button type="button" className="composer-dialog-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="composer-dialog-primary" disabled={submitting}>
            {submitting ? 'Posting…' : (isPoll ? 'Post Poll' : 'Post Reminder')}
          </button>
        </div>
      </form>
    </div>
  );
}

function SimpleActionDialogContent({ dialog, onCancel, onSubmit }) {
  const [value, setValue] = useState(() => dialog?.defaultValue || '');
  if (!dialog) return null;
  const isConfirm = dialog.type === 'confirm';
  const isChannelDialog = dialog.variant === 'channel';
  const isMultiline = dialog.multiline === true;
  const previewValue = isChannelDialog ? (slugChannel(value) || 'new-channel') : '';

  const handleSubmit = (event) => {
    event.preventDefault();
    if (isConfirm) {
      onSubmit(true);
      return;
    }

    onSubmit(String(value || '').trim());
  };

  return (
    <div className="composer-dialog-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form className={`composer-dialog simple-action-dialog ${isChannelDialog ? 'channel-action-dialog' : ''}`} role="dialog" aria-modal="true" aria-labelledby="simple-action-title" onSubmit={handleSubmit}>
        <div className="composer-dialog-head">
          <div>
            <span className="composer-dialog-kicker">{dialog.kicker || (isConfirm ? 'Confirm' : 'Input')}</span>
            <h2 id="simple-action-title">{dialog.title}</h2>
            {dialog.description ? <p>{dialog.description}</p> : null}
          </div>
          <button type="button" className="composer-dialog-close" onClick={onCancel} aria-label="Close dialog">
            <i className="ph-bold ph-x" />
          </button>
        </div>

        {!isConfirm ? (
          <div className="composer-dialog-fields">
            <label>
              <span>{dialog.label || 'Value'}</span>
              {isMultiline ? (
                <textarea
                  autoFocus
                  name="value"
                  value={value}
                  maxLength={dialog.maxLength || 1200}
                  placeholder={dialog.placeholder || ''}
                  rows={dialog.rows || 8}
                  onChange={(event) => setValue(event.target.value)}
                />
              ) : (
                <input
                  autoFocus
                  name="value"
                  value={value}
                  maxLength={dialog.maxLength || 120}
                  placeholder={dialog.placeholder || ''}
                  onChange={(event) => setValue(event.target.value)}
                />
              )}
            </label>
            {isChannelDialog ? (
              <>
                <div className="channel-dialog-preview-card" aria-live="polite">
                  <span className="channel-dialog-hash">#</span>
                  <div>
                    <strong>{previewValue}</strong>
                    <small>Messages will stay organized inside this focused channel.</small>
                  </div>
                </div>
                <div className="channel-dialog-suggestions" aria-label="Suggested channel names">
                  {(dialog.suggestions || ['announcements', 'design', 'bugs']).map((name) => (
                    <button key={name} type="button" onClick={() => setValue(name)}>
                      # {name}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="composer-dialog-actions">
          <button type="button" className="composer-dialog-secondary" onClick={onCancel}>{dialog.cancelText || 'Cancel'}</button>
          <button type="submit" className={`composer-dialog-primary ${dialog.destructive ? 'danger' : ''}`}>
            {dialog.confirmText || (isConfirm ? 'Confirm' : 'Submit')}
          </button>
        </div>
      </form>
    </div>
  );
}

function SimpleActionDialog({ dialog, onCancel, onSubmit }) {
  if (!dialog) return null;
  const dialogKey = [
    dialog.type || 'dialog',
    dialog.variant || 'default',
    dialog.title || '',
    dialog.defaultValue || '',
  ].join(':');

  return (
    <SimpleActionDialogContent
      dialog={dialog}
      key={dialogKey}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  );
}

function handleMessageToolbarFocus(event) {
  if (!(event.target instanceof HTMLButtonElement)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled)'));
  buttons.forEach((button) => {
    button.tabIndex = button === event.target ? 0 : -1;
  });
}

function handleMessageToolbarKeyDown(event) {
  const buttons = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled)'));
  const currentIndex = buttons.indexOf(document.activeElement);
  if (currentIndex < 0 || buttons.length < 2) return;

  let nextIndex = null;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % buttons.length;
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = buttons.length - 1;
  }

  if (nextIndex === null) return;
  event.preventDefault();
  buttons.forEach((button, index) => {
    button.tabIndex = index === nextIndex ? 0 : -1;
  });
  buttons[nextIndex]?.focus();
}

function closeEmojiPicker({ restoreFocus = false } = {}) {
  const picker = document.getElementById('emoji-picker');
  const trigger = window.activeEmojiTrigger;
  picker?.classList.add('hidden');
  trigger?.setAttribute?.('aria-expanded', 'false');

  if (window.hideEmojiPickerListener) {
    document.removeEventListener('click', window.hideEmojiPickerListener);
    window.hideEmojiPickerListener = null;
  }

  window.activeMessageId = null;
  window.activeEmojiTrigger = null;
  if (restoreFocus && trigger?.isConnected) {
    window.requestAnimationFrame(() => trigger.focus());
  }
}

const MessageItem = memo(function MessageItem({
  animationIndex = 0,
  deliveryStateElement,
  locale,
  message,
  searchQuery,
  editingId,
  editingText,
  onEditingText,
  onCancelEdit,
  onSaveEdit,
  onMarkUnread,
  onOpenThread,
  onPrepareReply,
  onJumpToMessage,
  onReact,
  onReport,
  onSaveReminder,
  onClosePoll,
  onTranslate,
  onVotePoll,
  translatedText,
}) {
  const messageKind = roomMessageKind(message);
  const isPerson = messageKind === ROOM_MESSAGE_KIND.PERSON;
  const isMine = isCurrentUserAuthoredMessage(message, window.currentUser?.uid);
  const visibleMessageText = messageTextWithoutPreviewUrl(message.text, message.linkPreview);
  const fallbackAvatar = window.getAvatarUrl?.(message.name, '') || '';
  const avatar = safeImageSource(message.photoUrl) || fallbackAvatar;
  const isEditing = editingId === message.id;
  const deliveryState = isMine ? message.deliveryState : '';
  const deliveryPending = deliveryState === 'sending' || deliveryState === 'failed';
  const isVisible = !searchQuery || messageSearchText(message).includes(searchQuery);
  const replyTarget = message.replyTo?.id ? {
    messageId: message.replyTo.id,
    roomId: message.replyTo.roomId,
    channelId: message.replyTo.channelId,
    source: 'reply',
    messageText: message.replyTo.text || '',
  } : null;
  const replyQuoteContent = message.replyTo ? (
    <>
      <span className="reply-quote-name">
        <i className="ph-bold ph-arrow-bend-up-left" aria-hidden="true" />
        {message.replyTo.name || 'Message'}
      </span>
      <span className="reply-quote-text">{message.replyTo.text || 'Original message'}</span>
    </>
  ) : null;

  return (
    <li
      className={`chat-message message-${messageKind} ${isMine ? 'my-message' : ''} ${message.important ? 'msg-important' : ''}`}
      id={`msg-${message.id}`}
      tabIndex={0}
      aria-label={`${messageKind === ROOM_MESSAGE_KIND.AI ? 'AI message' : messageKind === ROOM_MESSAGE_KIND.AUTOMATION ? 'Automation message' : 'Message'} from ${message.name || 'someone'}${deliveryState ? `, ${deliveryState}` : ''}`}
      style={{ display: isVisible ? 'flex' : 'none', '--message-index': animationIndex % 10 }}
    >
      {!deliveryPending ? <div
        className="msg-actions"
        role="toolbar"
        aria-label={`Actions for message from ${message.name || 'someone'}`}
        onFocus={handleMessageToolbarFocus}
        onKeyDown={handleMessageToolbarKeyDown}
      >
        <span className="msg-action-group msg-action-reactions" role="group" aria-label="Reactions">
          <button
            className="action-icon more-icon"
            type="button"
            onClick={(event) => window.toggleEmojiPicker?.(event, message.id)}
            title="Add reaction"
            aria-label="Add reaction"
            aria-controls="emoji-picker"
            aria-expanded="false"
            aria-haspopup="dialog"
          >
            <i className="ph-bold ph-smiley" aria-hidden="true" />
          </button>
        </span>
        <span className="msg-actions-divider" role="separator" aria-orientation="vertical" />
        <span className="msg-action-group msg-action-utilities" role="group" aria-label="Message tools">
          <button
            className="action-icon reply-icon"
            type="button"
            tabIndex={-1}
            onClick={() => onPrepareReply(
              message.id,
              message.name,
              message.text || 'Image',
              message.uid,
              threadRootIdForMessage(message),
            )}
            title="Reply"
            aria-label="Reply to message"
          >
            <i className="ph-bold ph-arrow-bend-up-left" aria-hidden="true" />
          </button>
          <button
            className="action-icon"
            type="button"
            tabIndex={-1}
            onClick={() => onOpenThread(message)}
            title={translate('chat.thread.title', {}, locale)}
            aria-label={translate('chat.thread.title', {}, locale)}
          >
            <i className="ph-bold ph-chat-centered-dots" aria-hidden="true" />
          </button>
          {message.text ? (
            <button
              className="action-icon"
              type="button"
              tabIndex={-1}
              onClick={() => onTranslate(message)}
              title={translate('chat.translate.action', {}, locale)}
              aria-label={translate('chat.translate.action', {}, locale)}
            >
              <i className="ph-bold ph-translate" aria-hidden="true" />
            </button>
          ) : null}
          <button
            className="action-icon"
            type="button"
            tabIndex={-1}
            onClick={() => onMarkUnread(message)}
            title={translate('chat.unread.markUnread', {}, locale)}
            aria-label={translate('chat.unread.markUnread', {}, locale)}
          >
            <i className="ph-bold ph-envelope-simple" aria-hidden="true" />
          </button>
          {!isMine ? (
            <button
              className="action-icon"
              type="button"
              tabIndex={-1}
              onClick={() => onReport(message)}
              title={translate('chat.report.action', {}, locale)}
              aria-label={translate('chat.report.action', {}, locale)}
            >
              <i className="ph-bold ph-flag" aria-hidden="true" />
            </button>
          ) : null}
          <button
            className="action-icon msg-menu-icon"
            type="button"
            tabIndex={-1}
            onClick={(event) => window.openMsgMenu?.(event, message.id)}
            title="More actions"
            aria-label="More message actions"
            aria-controls="msg-menu"
            aria-expanded="false"
            aria-haspopup="menu"
          >
            <i className="ph-bold ph-dots-three" aria-hidden="true" />
          </button>
        </span>
      </div> : null}

      <div
        className="msg-header"
        onContextMenu={(event) => {
          if (!isPerson) return;
          event.preventDefault();
          window.showContextMenu?.(event.pageX, event.pageY, message.uid, message.name);
        }}
        style={{ cursor: isPerson ? 'context-menu' : 'default' }}
      >
        <img
          alt="Avatar"
          className="msg-avatar"
          decoding="async"
          loading="eager"
          onClick={isPerson ? () => window.viewUserProfile?.(message.uid) : undefined}
          onError={(event) => {
            if (fallbackAvatar && event.currentTarget.src !== fallbackAvatar) {
              event.currentTarget.src = fallbackAvatar;
            }
          }}
          src={avatar}
        />
        <div className="header-text">
          <span className="msg-name" onClick={isPerson ? () => window.viewUserProfile?.(message.uid) : undefined} style={{ cursor: isPerson ? 'pointer' : 'default' }}>
            {message.name}
          </span>
          {message.aiAgent ? <span className="tier-badge ai">AI</span> : null}
          {!message.aiAgent && (message.automation || message.bot) ? (
            <span
              className="tier-badge automation"
              title={automationAttributionTitle(message)}
            >
              AUTOMATION
            </span>
          ) : null}
          {message.tier === 'advanced' ? <span className="tier-badge advanced">ADVANCED</span> : null}
          {message.tier === 'pro' ? <span className="tier-badge pro">PRO</span> : null}
          <span className="msg-time">{formatTime(message.timestamp)}</span>
          <span className="msg-edited" id={`ed-${message.id}`}>{message.edited ? '(edited)' : ''}</span>
          <span
            className="msg-flag"
            id={`flag-${message.id}`}
            style={{ display: message.important ? '' : 'none' }}
            title="Important"
            aria-label="Important message"
          >
            <i className="ph-bold ph-flag" aria-hidden="true" />
          </span>
        </div>
      </div>

      {replyQuoteContent ? (
        replyTarget ? (
          <button
            className="reply-quote reply-quote-button"
            type="button"
            onClick={() => onJumpToMessage(replyTarget)}
            title="Jump to original message"
            aria-label={`Jump to ${message.replyTo.name || 'the original'} message`}
          >
            {replyQuoteContent}
          </button>
        ) : (
          <div className="reply-quote">{replyQuoteContent}</div>
        )
      ) : null}

      {message.attachedImage ? (
        <img className="msg-attached-img" src={message.attachedImage} alt="Attachment" decoding="async" loading="lazy" />
      ) : null}

      {message.attachedFile && !message.attachedImage ? (
        <div className="msg-file-card">
          {message.attachedFile.url ? <a className="msg-file-main" href={message.attachedFile.url} target="_blank" rel="noreferrer">
            <span className="msg-file-icon"><i className="ph-bold ph-file-arrow-down" /></span>
            <span className="msg-file-info">
              <strong>{message.attachedFile.name || 'Attachment'}</strong>
              <small>{message.attachedFile.type || 'File'} · {formatBytes(Number(message.attachedFile.size || 0))}</small>
            </span>
          </a> : <span className="msg-file-main" aria-label="Attachment waiting to send">
            <span className="msg-file-icon"><i className="ph-bold ph-file" /></span>
            <span className="msg-file-info">
              <strong>{message.attachedFile.name || 'Attachment'}</strong>
              <small>{message.attachedFile.type || 'File'} · {formatBytes(Number(message.attachedFile.size || 0))}</small>
            </span>
          </span>}
          {message.attachedFile.url ? <TextFilePreview file={message.attachedFile} /> : null}
        </div>
      ) : null}

      <PollCard message={message} onClosePoll={onClosePoll} onVotePoll={onVotePoll} />
      <ReminderCard message={message} onSaveReminder={onSaveReminder} />
      <LinkPreviewCard preview={message.linkPreview} />

      <div className={`msg-text ${!isEditing && !visibleMessageText ? 'hidden' : ''}`} id={`mt-${message.id}`}>
        {isEditing ? (
          <>
            <textarea
              className="msg-edit-area"
              onChange={(event) => onEditingText(event.target.value)}
              rows={2}
              value={editingText}
            />
            <div className="msg-edit-actions">
              <button className="msg-edit-save" onClick={() => onSaveEdit(message.id)} type="button">Save</button>
              <button className="msg-edit-cancel" onClick={onCancelEdit} type="button">Cancel</button>
            </div>
          </>
        ) : (
          <MessageText text={visibleMessageText} />
        )}
      </div>
      {translatedText ? (
        <div className="message-translation">
          <small>{translate('chat.translate.translatedTo', {
            language: translatedText.targetLanguage || locale,
          }, locale)}</small>
          <MessageText text={translatedText.text} />
        </div>
      ) : null}

      <ReactionPills message={message} onReact={onReact} />
      {deliveryStateElement}
    </li>
  );
}, areMessageItemsEqual);

function areMessageItemsEqual(prev, next) {
  if (prev.message !== next.message) return false;
  if (prev.searchQuery !== next.searchQuery) return false;
  if (prev.locale !== next.locale) return false;
  if (prev.onJumpToMessage !== next.onJumpToMessage) return false;
  if (prev.onTranslate !== next.onTranslate) return false;
  if (prev.translatedText !== next.translatedText) return false;

  const wasEditing = prev.editingId === prev.message.id;
  const isEditing = next.editingId === next.message.id;
  if (wasEditing !== isEditing) return false;
  if (isEditing && prev.editingText !== next.editingText) return false;

  return true;
}

const MessageList = memo(function MessageList({
  activeRoomName,
  composerDisabled,
  initialLoading,
  loadFailed,
  locale,
  messageDeliveries,
  messageScope,
  messages,
  pinnedMessageId,
  firstUnreadMessageId,
  editingId,
  editingText,
  onCancelEdit,
  onCancelDelivery,
  onEditingText,
  onJumpToMessage,
  onMarkUnread,
  onOpenThread,
  onPrepareReply,
  onReact,
  onClosePoll,
  onReport,
  onRetryDelivery,
  onSaveEdit,
  onSaveReminder,
  onScroll,
  onScrollIntent,
  onTranslate,
  onVotePoll,
  searchQuery,
  translatedMessages,
  listRef,
}) {
  const scopedDeliveryMessages = useMemo(
    () => messageDeliveries.filter((delivery) => delivery.scopeKey === messageScope && delivery.message).map((delivery) => delivery.message),
    [messageDeliveries, messageScope],
  );
  const hasMessages = messages.length > 0 || scopedDeliveryMessages.length > 0;
  const matchesMessage = useCallback(
    (message) => !searchQuery || messageSearchText(message).includes(searchQuery),
    [searchQuery],
  );
  const hasSearchResults = !searchQuery || [...messages, ...scopedDeliveryMessages].some(matchesMessage);

  return (
    <ul
      aria-label={`${activeRoomName} conversation messages`}
      id="messages"
      onKeyDown={onScrollIntent}
      onPointerCancel={onScrollIntent}
      onPointerDown={onScrollIntent}
      onPointerUp={onScrollIntent}
      onScroll={onScroll}
      onTouchCancel={onScrollIntent}
      onTouchEnd={onScrollIntent}
      onTouchStart={onScrollIntent}
      onWheel={onScrollIntent}
      ref={listRef}
      tabIndex={0}
    >
      {!hasMessages ? (
        <MessageListEmptyState
          kind={initialLoading ? 'loading' : loadFailed ? 'error' : 'empty'}
          readOnly={composerDisabled}
          roomName={activeRoomName}
        />
      ) : null}
      {hasMessages && !hasSearchResults ? (
        <MessageListEmptyState kind="search" roomName={activeRoomName} />
      ) : null}
      <Suspense fallback={null}>
        <LazyMessageTimeline
          deliveries={messageDeliveries}
          firstUnreadMessageId={firstUnreadMessageId}
          key={messageScope}
          matchesMessage={matchesMessage}
          messages={messages}
          onCancelDelivery={onCancelDelivery}
          onRetryDelivery={onRetryDelivery}
          pinnedMessageId={pinnedMessageId}
          scopeKey={messageScope}
          renderMessage={(message, index, deliveryStateElement) => (
          <MessageItem
            animationIndex={index}
            deliveryStateElement={deliveryStateElement}
            editingId={editingId}
            editingText={editingText}
            key={message.id}
            locale={locale}
            message={message}
            onCancelEdit={onCancelEdit}
            onEditingText={onEditingText}
            onJumpToMessage={onJumpToMessage}
            onMarkUnread={onMarkUnread}
            onOpenThread={onOpenThread}
            onPrepareReply={onPrepareReply}
            onReact={onReact}
            onClosePoll={onClosePoll}
            onReport={onReport}
            onSaveReminder={onSaveReminder}
            onSaveEdit={onSaveEdit}
            onTranslate={onTranslate}
            onVotePoll={onVotePoll}
            searchQuery=""
            translatedText={translatedMessages[message.id]}
          />
          )}
        />
      </Suspense>
    </ul>
  );
});

export function ChatCore({ user, registerApi }) {
  const userId = user?.uid || '';
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => DEFAULT_LOCALE);
  const [initialRoomPreference] = useState(() => readLastRoomPreference(userId));
  const lastRoomHydratedUidRef = useRef(userId);
  const initialRoom = roomFromPreference(initialRoomPreference);
  const initialChannelId = initialRoom.id === 'global' ? 'general' : (initialRoomPreference?.channelId || 'general');
  const [roomListHost, setRoomListHost] = useState(null);
  const [channelHost, setChannelHost] = useState(null);
  const [roomHeaderHost, setRoomHeaderHost] = useState(null);
  const [rooms, setRooms] = useState([GLOBAL_ROOM]);
  const [roomPrefs, setRoomPrefs] = useState({});
  const [activeRoom, setActiveRoom] = useState(initialRoom);
  const roomEntitlement = useRoomEntitlement(activeRoom.id);
  const [channels, setChannels] = useState([{ id: 'general', name: 'general' }]);
  const [activeChannelId, setActiveChannelId] = useState(initialChannelId);
  const [messages, setMessages] = useState([]);
  const [messageDeliveries, setMessageDeliveries] = useState([]);
  const [draft, setDraft] = useState(() => readComposerDraft(initialRoom.id, initialChannelId));
  const [reply, setReply] = useState(null);
  const [typingNames, setTypingNames] = useState([]);
  const [composerDisabled, setComposerDisabled] = useState(false);
  const [placeholder, setPlaceholder] = useState(`Message ${initialRoom.name}...`);
  const [fileSelected, setFileSelected] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [initialMessagesLoading, setInitialMessagesLoading] = useState(true);
  const [messagesLoadFailed, setMessagesLoadFailed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [commandListOpen, setCommandListOpen] = useState(false);
  const [composerDialogMode, setComposerDialogMode] = useState(null);
  const [composerMoreOpen, setComposerMoreOpen] = useState(false);
  const [simpleDialog, setSimpleDialog] = useState(null);
  const [mentionCandidates, setMentionCandidates] = useState([]);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState('');
  const [jumpContext, setJumpContext] = useState(null);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [quickReplyStatus, setQuickReplyStatus] = useState('');
  const [roomCatchUpEnabled, setRoomCatchUpEnabled] = useState(() => loadRoomCatchUpEnabled(userId));
  const [readState, setReadState] = useState({});
  const [threadDrawerOpen, setThreadDrawerOpen] = useState(false);
  const [activeThreadRootId, setActiveThreadRootId] = useState('');
  const [threadFollows, setThreadFollows] = useState({});
  const [threadReadAtByRoot, setThreadReadAtByRoot] = useState({});
  const [translatedMessages, setTranslatedMessages] = useState({});
  const [translationPendingIds, setTranslationPendingIds] = useState(() => new Set());
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [scheduledMessages, setScheduledMessages] = useState([]);
  const quickSwitchReturnFocusRef = useRef(null);
  const composerMoreTriggerRef = useRef(null);
  const createPollHandlerRef = useRef(null);

  const roomsRef = useRef([GLOBAL_ROOM]);
  const roomPrefsRef = useRef({});
  const activeRoomRef = useRef(initialRoom);
  const activeChannelRef = useRef(initialChannelId);
  const botConfigRef = useRef(normalizeRoomBotConfig());
  const botConfigByRoomRef = useRef(new Map());
  const botConfigCacheUserRef = useRef(userId);
  const botConfigLoadRef = useRef({
    userId,
    roomId: initialRoom.id,
    status: initialRoom.id === GLOBAL_ROOM.id ? 'ready' : 'idle',
    config: initialRoom.id === GLOBAL_ROOM.id ? normalizeRoomBotConfig() : null,
    promise: Promise.resolve(initialRoom.id === GLOBAL_ROOM.id ? normalizeRoomBotConfig() : null),
    resolve: null,
  });
  const messagesRef = useRef([]);
  const oldestMessageKeyRef = useRef(null);
  const historyExhaustedRef = useRef(false);
  const historyRequestIdRef = useRef(0);
  const isFetchingHistoryRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const forceScrollToLatestRef = useRef(true);
  const listRef = useRef(null);
  const scrollFrameRef = useRef(null);
  const scrollToBottomFrameRef = useRef(null);
  const scrollSettleTimersRef = useRef([]);
  const lastMessageScrollIntentAtRef = useRef(0);
  const messageScrollGestureActiveRef = useRef(false);
  const messageStateByScopeRef = useRef(new Map());
  const activeMessageScopeRef = useRef(messageScopeKey(initialRoom.id, initialChannelId));
  const pendingMessageScrollRestoreRef = useRef(null);
  const pendingHistoryScrollRestoreRef = useRef(null);
  const pendingMessageWindowScrollRestoreRef = useRef(null);
  const pendingMessageOpsRef = useRef([]);
  const messageFlushFrameRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingStateRef = useRef(false);
  const muteTimerRef = useRef(null);
  const isSendingRef = useRef(false);
  const pendingReactionOpsRef = useRef(new Map());
  const deliveryAttemptsRef = useRef(new Map());
  const outboxHydratedUidRef = useRef('');
  const lastReadWriteKeyRef = useRef('');
  const reminderTimersRef = useRef([]);
  const simpleDialogResolverRef = useRef(null);

  const resizeComposerTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const computed = window.getComputedStyle(textarea);
    const maxHeight = Number.parseFloat(computed.maxHeight) || 132;
    const minHeight = Number.parseFloat(computed.getPropertyValue('--composer-min-height')) || 42;
    // Reset to the responsive floor before reading scrollHeight so a cleared
    // multiline draft can shrink instead of inheriting its previous height.
    textarea.style.height = `${minHeight}px`;
    const scrollHeight = textarea.scrollHeight;
    const nextHeight = Math.min(scrollHeight, maxHeight);
    textarea.style.height = `${Math.max(nextHeight, minHeight)}px`;
    textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);
  const jumpNoticeTimerRef = useRef(null);
  const didBootRoomRef = useRef(false);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const activeUnread = useMemo(
    () => unreadSummary(messages, readState, userId),
    [messages, readState, userId],
  );
  const clearPendingMessageOps = useCallback(() => {
    pendingMessageOpsRef.current = [];
    if (messageFlushFrameRef.current) {
      cancelAnimationFrame(messageFlushFrameRef.current);
      messageFlushFrameRef.current = null;
    }
  }, []);

  const flushPendingMessageOps = useCallback(() => {
    messageFlushFrameRef.current = null;
    const operations = pendingMessageOpsRef.current;
    pendingMessageOpsRef.current = [];
    if (!operations.length) return;

    setMessages((current) => {
      const merged = mergeMessageBatch(current, operations);
      if (merged === current) return current;

      const list = listRef.current;
      const shouldSoftTrim = merged.length > MESSAGE_SCOPE_MESSAGE_LIMIT
        && (document.hidden || isMessageListAtBottom(list));
      const shouldHardTrim = merged.length > MESSAGE_ACTIVE_HARD_LIMIT;
      let next = merged;

      if (shouldSoftTrim || shouldHardTrim) {
        const targetSize = shouldSoftTrim
          ? MESSAGE_SCOPE_MESSAGE_LIMIT
          : MESSAGE_ACTIVE_HARD_LIMIT - 120;
        const anchor = shouldSoftTrim ? null : captureMessageViewportAnchor(list);
        next = merged.slice(-targetSize);
        if (anchor && next.some((message) => message.id === anchor.messageId)) {
          const restore = {
            ...anchor,
            scopeKey: activeMessageScopeRef.current,
          };
          pendingMessageWindowScrollRestoreRef.current = restore;
          window.pendingMessageWindowScrollRestore = restore;
        }
        oldestMessageKeyRef.current = next[0]?.id || null;
        historyExhaustedRef.current = false;
        window.oldestMessageKey = oldestMessageKeyRef.current;
      }

      messagesRef.current = next;
      return next;
    });
  }, []);

  const queueMessageMutation = useCallback((messageId, message, prepend = false) => {
    pendingMessageOpsRef.current.push({ messageId, message, prepend });
    if (messageFlushFrameRef.current) return;

    messageFlushFrameRef.current = requestAnimationFrame(flushPendingMessageOps);
  }, [flushPendingMessageOps]);

  const clearScrollSettleTimers = useCallback(() => {
    scrollSettleTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    scrollSettleTimersRef.current = [];
  }, []);

  const scrollMessagesToLatest = useCallback((passes = 1, options = {}) => {
    if (scrollToBottomFrameRef.current) cancelAnimationFrame(scrollToBottomFrameRef.current);
    if (options.settle) clearScrollSettleTimers();

    const scrollPass = (remainingPasses) => {
      scrollToBottomFrameRef.current = requestAnimationFrame(() => {
        const list = listRef.current;
        if (list) list.scrollTop = list.scrollHeight;

        if (remainingPasses > 0) {
          scrollPass(remainingPasses - 1);
          return;
        }

        scrollToBottomFrameRef.current = null;
      });
    };

    scrollPass(Math.max(0, passes - 1));

    if (!options.settle) return;

    const settleDelays = options.delays || [120, 320, 700, 1200, 1800];
    settleDelays.forEach((delay, index) => {
      const timerId = window.setTimeout(() => {
        const shouldStillLandLatest = forceScrollToLatestRef.current || shouldStickToBottomRef.current;
        if (isFetchingHistoryRef.current || window.isFetchingHistory || !shouldStillLandLatest) return;

        scrollPass(1);
        if (index === settleDelays.length - 1) {
          forceScrollToLatestRef.current = false;
          clearScrollSettleTimers();
        }
      }, delay);
      scrollSettleTimersRef.current.push(timerId);
    });
  }, [clearScrollSettleTimers]);

  const saveCurrentMessageState = useCallback((scopeKey = activeMessageScopeRef.current) => {
    if (!scopeKey) return;
    const list = listRef.current;
    const existing = messageStateByScopeRef.current.get(scopeKey) || {};
    const wasAtBottom = list ? isMessageListAtBottom(list) : (existing.wasAtBottom ?? shouldStickToBottomRef.current);

    cacheMessageScopeState(messageStateByScopeRef.current, scopeKey, {
      messages: messagesRef.current.slice(),
      oldestMessageKey: oldestMessageKeyRef.current,
      historyExhausted: historyExhaustedRef.current,
      scrollTop: list?.scrollTop ?? existing.scrollTop ?? 0,
      scrollHeight: list?.scrollHeight ?? existing.scrollHeight ?? 0,
      clientHeight: list?.clientHeight ?? existing.clientHeight ?? 0,
      wasAtBottom,
    });
  }, []);

  const restoreMessageStateForScope = useCallback((scopeKey) => {
    const cached = messageStateByScopeRef.current.get(scopeKey);
    const cachedMessages = cached?.messages || [];
    historyRequestIdRef.current += 1;
    clearPendingMessageOps();
    clearScrollSettleTimers();
    pendingHistoryScrollRestoreRef.current = null;
    pendingMessageWindowScrollRestoreRef.current = null;
    delete window.pendingMessageWindowScrollRestore;
    oldestMessageKeyRef.current = cached?.oldestMessageKey ?? null;
    historyExhaustedRef.current = cached?.historyExhausted === true;
    isFetchingHistoryRef.current = false;
    lastMessageScrollIntentAtRef.current = 0;
    window.oldestMessageKey = oldestMessageKeyRef.current;
    window.isFetchingHistory = false;
    setLoadingHistory(false);

    shouldStickToBottomRef.current = cached ? cached.wasAtBottom !== false : true;
    forceScrollToLatestRef.current = cached ? cached.wasAtBottom !== false : true;
    pendingMessageScrollRestoreRef.current = cached ? {
      scopeKey,
      scrollTop: cached.scrollTop || 0,
      wasAtBottom: cached.wasAtBottom !== false,
    } : null;

    messagesRef.current = cachedMessages;
    setMessages(cachedMessages);
    setInitialMessagesLoading(cachedMessages.length === 0);
    setMessagesLoadFailed(false);
  }, [clearPendingMessageOps, clearScrollSettleTimers]);

  useLayoutEffect(() => {
    const nextScopeKey = messageScopeKey(activeRoom.id, activeChannelId);
    const scopeChanged = activeMessageScopeRef.current !== nextScopeKey;

    if (scopeChanged) {
      saveCurrentMessageState();
      activeMessageScopeRef.current = nextScopeKey;
    }

    activeRoomRef.current = activeRoom;
    activeChannelRef.current = activeChannelId;
    window.activeRoomId = activeRoom.id;
    window.activeRoomShortId = activeRoom.shortId;
    window.activeChannelId = activeChannelId;

    if (!scopeChanged) return;
    restoreMessageStateForScope(nextScopeKey);
    setReply(null);
    setEditingId(null);
    setEditingText('');
    setDraft(readComposerDraft(activeRoom.id, activeChannelId));
    setQuickReplyStatus('');
    setPlaceholder(`Message ${activeRoom.name}...`);
  }, [
    activeChannelId,
    activeRoom,
    restoreMessageStateForScope,
    saveCurrentMessageState,
  ]);

  useEffect(() => {
    const requestLatestScroll = (options = {}) => {
      shouldStickToBottomRef.current = true;
      forceScrollToLatestRef.current = true;
      scrollMessagesToLatest(options.passes || 3, {
        settle: true,
        delays: options.delays || [40, 120, 260, 520, 900, 1400],
      });
    };

    window.requestChatLatestScroll = requestLatestScroll;
    return () => {
      if (window.requestChatLatestScroll === requestLatestScroll) {
        window.requestChatLatestScroll = null;
      }
    };
  }, [scrollMessagesToLatest]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return undefined;

    let previousHeight = list.clientHeight;
    let resizeFrame = null;
    const hasPendingScrollRestore = () => Boolean(
      pendingHistoryScrollRestoreRef.current
      || pendingMessageWindowScrollRestoreRef.current
      || pendingMessageScrollRestoreRef.current
    );
    const observer = new ResizeObserver((entries) => {
      const nextHeight = Math.round(entries[0]?.contentRect?.height ?? list.clientHeight);
      if (!nextHeight || Math.abs(nextHeight - previousHeight) < 1) return;
      previousHeight = nextHeight;
      if (
        isFetchingHistoryRef.current
        || window.isFetchingHistory
        || hasPendingScrollRestore()
        || (!shouldStickToBottomRef.current && !forceScrollToLatestRef.current)
      ) return;

      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (
          listRef.current !== list
          || !list.clientHeight
          || isFetchingHistoryRef.current
          || window.isFetchingHistory
          || hasPendingScrollRestore()
          || (!shouldStickToBottomRef.current && !forceScrollToLatestRef.current)
        ) return;
        list.scrollTop = list.scrollHeight;
      });
    });

    observer.observe(list);
    return () => {
      observer.disconnect();
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
    };
  }, []);

  useEffect(() => {
    const syncPreference = (enabled = loadRoomCatchUpEnabled(userId)) => {
      setRoomCatchUpEnabled((current) => (current === enabled ? current : enabled));
    };
    const accountScope = String(userId || '').trim() || 'signed-out';
    const storageKey = roomCatchUpStorageKey(userId);
    const handlePreference = (event) => {
      if (event.detail?.uid && event.detail.uid !== accountScope) return;
      syncPreference(event.detail?.enabled ?? loadRoomCatchUpEnabled(userId));
    };
    const handleStorage = (event) => {
      if (event.key !== storageKey) return;
      syncPreference(loadRoomCatchUpEnabled(userId));
    };

    syncPreference();
    window.addEventListener(ROOM_CATCHUP_PREFERENCE_EVENT, handlePreference);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(ROOM_CATCHUP_PREFERENCE_EVENT, handlePreference);
      window.removeEventListener('storage', handleStorage);
    };
  }, [userId]);

  /* eslint-disable react-hooks/set-state-in-effect -- Portal hosts are owned by the surrounding shell and become available after mount. */
  useEffect(() => {
    setRoomListHost(document.getElementById('room-list'));
    setChannelHost(document.getElementById('room-channel-list'));
    setRoomHeaderHost(document.getElementById('room-header-meta'));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => () => {
    deliveryAttemptsRef.current.forEach((attempt) => {
      if (attempt.localImageUrl) URL.revokeObjectURL(attempt.localImageUrl);
    });
    deliveryAttemptsRef.current.clear();
  }, []);

  useEffect(() => {
    activeChannelRef.current = activeChannelId;
    window.activeChannelId = activeChannelId;
  }, [activeChannelId]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    roomPrefsRef.current = roomPrefs;
  }, [roomPrefs]);

  /* eslint-disable react-hooks/set-state-in-effect -- Clear stale per-user preferences before attaching the next Firebase subscription. */
  useEffect(() => {
    if (!user?.uid) {
      roomPrefsRef.current = {};
      setRoomPrefs({});
      return undefined;
    }

    return onValue(ref(db, `user_room_preferences/${user.uid}`), (snapshot) => {
      const nextPrefs = snapshot.val() || {};
      roomPrefsRef.current = nextPrefs;
      setRoomPrefs(nextPrefs);
    });
  }, [user?.uid]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  useEffect(() => {
    const nextUserId = user?.uid || '';
    if (botConfigCacheUserRef.current !== nextUserId) {
      botConfigCacheUserRef.current = nextUserId;
      botConfigByRoomRef.current.clear();
    }

    const roomId = activeRoom.id;
    botConfigRef.current = botConfigByRoomRef.current.get(roomId) || normalizeRoomBotConfig();
    botConfigLoadRef.current.resolve?.(null);
    if (!user?.uid || !roomId || roomId === GLOBAL_ROOM.id) {
      const config = roomId === GLOBAL_ROOM.id ? botConfigRef.current : null;
      botConfigLoadRef.current = {
        userId: nextUserId,
        roomId,
        status: config ? 'ready' : 'failed',
        config,
        promise: Promise.resolve(config),
        resolve: null,
      };
      return undefined;
    }

    let resolveLoad;
    const loadPromise = new Promise((resolve) => { resolveLoad = resolve; });
    const loadState = {
      userId: nextUserId,
      roomId,
      status: 'loading',
      config: null,
      promise: loadPromise,
      resolve: resolveLoad,
    };
    const settleLoad = (status, config = null) => {
      if (loadState.status !== 'loading') return;
      loadState.status = status;
      loadState.config = config;
      loadState.resolve = null;
      resolveLoad(config);
    };
    botConfigLoadRef.current = loadState;

    const botsRef = ref(db, `rooms_meta/${roomId}/bots`);
    const unsubscribe = onValue(
      botsRef,
      (snapshot) => {
        if (activeRoomRef.current.id !== roomId || currentChatUser()?.uid !== nextUserId) {
          settleLoad('cancelled');
          return;
        }
        const nextConfig = normalizeRoomBotConfig(snapshot.val());
        botConfigByRoomRef.current.set(roomId, nextConfig);
        botConfigRef.current = nextConfig;
        settleLoad('ready', nextConfig);
      },
      (error) => {
        if (activeRoomRef.current.id !== roomId) return;
        botConfigByRoomRef.current.delete(roomId);
        botConfigRef.current = normalizeRoomBotConfig();
        settleLoad('failed');
        console.warn('[chat] room bot configuration subscription failed', {
          roomId,
          errorCode: error?.code || 'unknown',
        });
      },
    );
    return () => {
      unsubscribe();
      settleLoad('cancelled');
    };
  }, [activeRoom.id, user?.uid]);

  const waitForRoomBotConfig = useCallback(async (roomId, requesterUid) => {
    if (!roomId || roomId === GLOBAL_ROOM.id) return botConfigRef.current;
    if (!requesterUid || currentChatUser()?.uid !== requesterUid) return null;

    const activeLoad = botConfigLoadRef.current;
    if (activeLoad.userId === requesterUid && activeLoad.roomId === roomId) {
      if (activeLoad.status === 'ready') return activeLoad.config;
      if (activeLoad.status === 'loading') {
        const config = await resolveWithin(activeLoad.promise);
        if (config && currentChatUser()?.uid === requesterUid) return config;
        return null;
      }
    }

    const snapshot = await resolveWithin(get(ref(db, `rooms_meta/${roomId}/bots`)));
    if (!snapshot || currentChatUser()?.uid !== requesterUid) return null;
    const config = normalizeRoomBotConfig(snapshot.val());
    botConfigByRoomRef.current.set(roomId, config);
    if (activeRoomRef.current.id === roomId) botConfigRef.current = config;
    return config;
  }, []);

  useEffect(() => {
    if (!user?.uid || lastRoomHydratedUidRef.current !== user.uid) return;
    writeLastRoomPreference(activeRoom, activeChannelId, user?.uid);
  }, [activeChannelId, activeRoom, user?.uid]);

  useEffect(() => {
    const path = readStatePath(user?.uid, activeRoom.id, activeChannelId);
    if (!path) return undefined;
    return onValue(ref(db, path), (snapshot) => {
      setReadState(snapshot.val() || {});
    });
  }, [activeChannelId, activeRoom.id, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !activeRoom.id) return undefined;
    const scopePath = `${user.uid}/${activeRoom.id}/${activeChannelId || 'general'}`;
    const unsubscribeFollows = onValue(ref(db, `thread_follows/${scopePath}`), (snapshot) => {
      setThreadFollows(snapshot.val() || {});
    });
    const unsubscribeReads = onValue(ref(db, `thread_reads/${scopePath}`), (snapshot) => {
      setThreadReadAtByRoot(snapshot.val() || {});
    });
    return () => {
      unsubscribeFollows();
      unsubscribeReads();
    };
  }, [activeChannelId, activeRoom.id, user?.uid]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    return onValue(ref(db, `user_scheduled_messages/${user.uid}`), (snapshot) => {
      const next = [];
      snapshot.forEach((child) => {
        const value = child.val() || {};
        if (
          value.roomId === activeRoom.id
          && (value.channelId || 'general') === (activeChannelId || 'general')
          && value.status !== 'cancelled'
        ) {
          next.push({ id: child.key, ...value });
        }
      });
      next.sort((left, right) => Number(left.deliverAt || 0) - Number(right.deliverAt || 0));
      setScheduledMessages(next);
    });
  }, [activeChannelId, activeRoom.id, user?.uid]);

  const markLatestMessageRead = useCallback(async () => {
    const latest = messagesRef.current.at(-1);
    const path = readStatePath(user?.uid, activeRoomRef.current.id, activeChannelRef.current);
    if (!latest?.id || !path) return;
    const writeKey = `${path}:${latest.id}`;
    if (lastReadWriteKeyRef.current === writeKey && !readState.markedUnreadMessageId) return;
    lastReadWriteKeyRef.current = writeKey;
    await set(ref(db, path), nextReadState(latest)).catch((error) => {
      lastReadWriteKeyRef.current = '';
      console.warn('[chat] read cursor update failed', {
        roomId: activeRoomRef.current.id,
        errorCode: error?.code || 'unknown',
      });
    });
  }, [readState.markedUnreadMessageId, user?.uid]);

  const markMessageUnread = useCallback(async (message) => {
    const path = readStatePath(user?.uid, activeRoomRef.current.id, activeChannelRef.current);
    if (!path || !message?.id) return;
    lastReadWriteKeyRef.current = '';
    await set(ref(db, path), nextMarkedUnreadState(message, readState));
    window.showToast?.('Marked unread from this message.', false);
  }, [readState, user?.uid]);

  const jumpToFirstUnread = useCallback(() => {
    if (!activeUnread.firstMessageId) {
      window.showToast?.('You are caught up.', false);
      return;
    }
    const target = document.getElementById(`msg-${activeUnread.firstMessageId}`);
    if (target) {
      shouldStickToBottomRef.current = false;
      forceScrollToLatestRef.current = false;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.focus({ preventScroll: true });
      return;
    }
    if (listRef.current) listRef.current.scrollTop = 0;
    window.showToast?.('Loading older messages to reach the first unread item.', false);
  }, [activeUnread.firstMessageId]);

  const markThreadRead = useCallback(async (rootId) => {
    if (!userId || !rootId) return;
    const path = `thread_reads/${userId}/${activeRoomRef.current.id}/${activeChannelRef.current}/${rootId}`;
    await set(ref(db, path), Date.now());
  }, [userId]);

  const toggleThreadFollow = useCallback(async (
    rootId,
    followed,
    roomId = activeRoomRef.current.id,
    channelId = activeChannelRef.current,
  ) => {
    if (!userId || !rootId) return;
    const path = `thread_follows/${userId}/${roomId}/${channelId || 'general'}/${rootId}`;
    if (followed) {
      await set(ref(db, path), { followed: true, followedAt: Date.now() });
    } else {
      await remove(ref(db, path));
    }
  }, [userId]);

  const openMessageThread = useCallback((message) => {
    const rootId = threadRootIdForMessage(message);
    if (!rootId) return;
    setActiveThreadRootId(rootId);
    setThreadDrawerOpen(true);
    void markThreadRead(rootId);
  }, [markThreadRead]);

  useEffect(() => {
    messagesRef.current = messages;
    updateMessageCache(messages);
    const scopeKey = activeMessageScopeRef.current;
    const list = listRef.current;
    const existing = messageStateByScopeRef.current.get(scopeKey) || {};
    cacheMessageScopeState(messageStateByScopeRef.current, scopeKey, {
      ...existing,
      messages: messages.slice(),
      oldestMessageKey: oldestMessageKeyRef.current,
      historyExhausted: historyExhaustedRef.current,
      scrollTop: list?.scrollTop ?? existing.scrollTop ?? 0,
      scrollHeight: list?.scrollHeight ?? existing.scrollHeight ?? 0,
      clientHeight: list?.clientHeight ?? existing.clientHeight ?? 0,
      wasAtBottom: list ? isMessageListAtBottom(list) : (existing.wasAtBottom ?? shouldStickToBottomRef.current),
    });
  }, [messages]);

  useLayoutEffect(() => {
    const windowRestore = pendingMessageWindowScrollRestoreRef.current;
    if (windowRestore) {
      if (windowRestore.scopeKey !== activeMessageScopeRef.current) {
        pendingMessageWindowScrollRestoreRef.current = null;
        delete window.pendingMessageWindowScrollRestore;
      } else {
        const list = listRef.current;
        const anchor = document.getElementById(`msg-${windowRestore.messageId}`);
        if (list && anchor) {
          pendingMessageWindowScrollRestoreRef.current = null;
          delete window.pendingMessageWindowScrollRestore;
          const nextOffset = anchor.getBoundingClientRect().top - list.getBoundingClientRect().top;
          list.scrollTop += nextOffset - windowRestore.offsetTop;
          shouldStickToBottomRef.current = false;
          return;
        }
        if (list) {
          list.scrollTop = Math.max(
            0,
            windowRestore.scrollTop + (list.scrollHeight - windowRestore.scrollHeight),
          );
          shouldStickToBottomRef.current = false;
        }
        pendingMessageWindowScrollRestoreRef.current = null;
        delete window.pendingMessageWindowScrollRestore;
      }
    }

    const historyRestore = pendingHistoryScrollRestoreRef.current;
    if (historyRestore) {
      if (
        historyRestore.scopeKey !== activeMessageScopeRef.current
        || historyRestore.requestId !== historyRequestIdRef.current
      ) {
        pendingHistoryScrollRestoreRef.current = null;
      } else {
        const list = listRef.current;
        if (!list) return;

        pendingHistoryScrollRestoreRef.current = null;
        const anchor = historyRestore.messageId
          ? document.getElementById(`msg-${historyRestore.messageId}`)
          : null;
        if (anchor) {
          const nextOffset = anchor.getBoundingClientRect().top - list.getBoundingClientRect().top;
          list.scrollTop += nextOffset - historyRestore.offsetTop;
        } else {
          list.scrollTop = historyRestore.scrollTop + (list.scrollHeight - historyRestore.scrollHeight);
        }
        shouldStickToBottomRef.current = false;
        return;
      }
    }

    const restore = pendingMessageScrollRestoreRef.current;
    if (!restore || restore.scopeKey !== activeMessageScopeRef.current) return;
    const list = listRef.current;
    if (!list) return;

    pendingMessageScrollRestoreRef.current = null;
    if (restore.wasAtBottom) {
      list.scrollTop = list.scrollHeight;
    } else {
      const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
      list.scrollTop = Math.min(restore.scrollTop, maxScrollTop);
    }

    requestAnimationFrame(() => {
      if (activeMessageScopeRef.current !== restore.scopeKey) return;
      const latestList = listRef.current;
      if (!latestList || !restore.wasAtBottom) return;
      latestList.scrollTop = latestList.scrollHeight;
    });
  }, [activeChannelId, activeRoom.id, messages]);

  const setTyping = useCallback((isTyping) => {
    if (!window.currentUser?.uid || !activeRoomRef.current?.id) return;
    const nextTyping = Boolean(isTyping);
    if (typingStateRef.current === nextTyping) return;

    typingStateRef.current = nextTyping;
    const typingRef = userTypingRef(activeRoomRef.current.id, activeChannelRef.current, window.currentUser.uid);

    if (nextTyping) {
      set(typingRef, window.userProfileName || 'Someone');
      onDisconnect(typingRef).remove();
    } else {
      remove(typingRef);
    }
  }, []);

  const resolveSimpleDialog = useCallback((value) => {
    const resolver = simpleDialogResolverRef.current;
    simpleDialogResolverRef.current = null;
    setSimpleDialog(null);
    if (resolver) resolver(value);
  }, []);

  const requestSimpleDialog = useCallback((dialog) => new Promise((resolve) => {
    simpleDialogResolverRef.current?.(null);
    simpleDialogResolverRef.current = resolve;
    setSimpleDialog(dialog);
  }), []);

  const requestTextDialog = useCallback((dialog) => requestSimpleDialog({ ...dialog, type: 'text' }), [requestSimpleDialog]);
  const requestConfirmDialog = useCallback((dialog) => requestSimpleDialog({ ...dialog, type: 'confirm' }), [requestSimpleDialog]);

  const refreshRoomPreferenceControls = useCallback(() => {
    const roomId = activeRoomRef.current?.id || GLOBAL_ROOM.id;
    const prefs = roomPrefsRef.current?.[roomId] || {};
    const favoriteBtn = document.getElementById('room-drop-favorite');
    const hideBtn = document.getElementById('room-drop-hide');

    if (favoriteBtn) {
      const favoriteIcon = favoriteBtn.querySelector('i') || document.createElement('i');
      favoriteIcon.className = 'ph-bold ph-star';
      favoriteIcon.setAttribute('aria-hidden', 'true');
      favoriteBtn.replaceChildren(
        favoriteIcon,
        prefs.favorite ? ' Unfavorite Room' : ' Favorite Room',
      );
      favoriteBtn.classList.toggle('active', prefs.favorite === true);
    }

    if (hideBtn) {
      hideBtn.style.display = roomId === GLOBAL_ROOM.id ? 'none' : 'block';
      hideBtn.textContent = 'Hide Room';
    }
  }, []);

  const updateRoomPreference = useCallback(async (roomId, patch) => {
    if (!userId || !roomId) {
      window.showToast?.('Sign in to save room preferences.');
      return false;
    }

    if (roomId === GLOBAL_ROOM.id && patch?.hidden) {
      window.showToast?.("Global Chat can't be hidden.");
      return false;
    }

    await update(ref(db, `user_room_preferences/${userId}/${roomId}`), {
      ...patch,
      updatedAt: Date.now(),
    });
    return true;
  }, [userId]);

  const setRoomFavorite = useCallback(async (roomId, favorite, options = {}) => {
    if (!roomId) return false;
    const saved = await updateRoomPreference(roomId, {
      favorite: favorite ? true : null,
      favoriteAt: favorite ? Date.now() : null,
    });
    if (saved && !options.silent) {
      window.showToast?.(favorite ? 'Room added to favorites.' : 'Room removed from favorites.', false);
    }
    return saved;
  }, [updateRoomPreference]);

  const toggleRoomFavorite = useCallback(async (room) => {
    const roomId = typeof room === 'string' ? room : room?.id;
    if (!roomId) return false;
    const isFavorite = roomPrefsRef.current?.[roomId]?.favorite === true;
    return setRoomFavorite(roomId, !isFavorite);
  }, [setRoomFavorite]);

  const switchRoom = useCallback((roomId, roomName, shortId = '', options = {}) => {
    const knownRoom = roomsRef.current.find((room) => room.id === roomId);
    const nextRoom = {
      id: roomId || 'global',
      name: roomName || knownRoom?.name || (roomId === 'global' ? GLOBAL_ROOM.name : 'Room'),
      shortId: shortId || knownRoom?.shortId || (roomId === 'global' ? GLOBAL_ROOM.shortId : roomId),
    };
    const nextChannelId = nextRoom.id === 'global' ? 'general' : (options.channelId || 'general');
    const nextScopeKey = messageScopeKey(nextRoom.id, nextChannelId);
    const isSameScope = activeMessageScopeRef.current === nextScopeKey;

    if (isSameScope) {
      writeLastRoomPreference(nextRoom, nextChannelId, user?.uid);
      setHeaderRoom(nextRoom.id, nextRoom.name);
      clearRoomSearch();
      document.getElementById('desktop-room-sidebar')?.classList.remove('open');
      setTimeout(() => refreshRoomPreferenceControls(), 0);
      scheduleRoomChanged();
      return;
    }

    setTyping(false);
    saveCurrentMessageState();
    activeMessageScopeRef.current = nextScopeKey;

    window.activeRoomId = nextRoom.id;
    window.activeRoomShortId = nextRoom.shortId;
    window.activeChannelId = nextChannelId;
    window.activeReplyData = null;

    activeRoomRef.current = nextRoom;
    activeChannelRef.current = nextChannelId;
    writeLastRoomPreference(nextRoom, nextChannelId, user?.uid);
    setHeaderRoom(nextRoom.id, nextRoom.name);
    clearRoomSearch();
    document.getElementById('desktop-room-sidebar')?.classList.remove('open');

    setActiveRoom(nextRoom);
    setActiveChannelId(nextChannelId);
    restoreMessageStateForScope(nextScopeKey);
    setComposerMoreOpen(false);
    setThreadDrawerOpen(false);
    setActiveThreadRootId('');
    setReply(null);
    setEditingId(null);
    setDraft(readComposerDraft(nextRoom.id, nextChannelId));
    setPlaceholder(`Message ${nextRoom.name}...`);
    setComposerDisabled(false);
    setSearchQuery('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFileSelected(false);

    setTimeout(() => refreshRoomPreferenceControls(), 0);
    scheduleRoomChanged();
  }, [refreshRoomPreferenceControls, restoreMessageStateForScope, saveCurrentMessageState, setTyping, user?.uid]);

  useEffect(() => {
    if (!user?.uid || lastRoomHydratedUidRef.current === user.uid) return;
    lastRoomHydratedUidRef.current = user.uid;

    const preference = readLastRoomPreference(user.uid);
    if (!preference) {
      switchRoom(GLOBAL_ROOM.id, GLOBAL_ROOM.name, GLOBAL_ROOM.shortId);
      return;
    }

    const savedRoom = roomFromPreference(preference);
    switchRoom(savedRoom.id, savedRoom.name, savedRoom.shortId, {
      channelId: preference.channelId || 'general',
    });
  }, [switchRoom, user?.uid]);

  const hideRoom = useCallback(async (room, options = {}) => {
    const roomId = typeof room === 'string' ? room : room?.id;
    if (!roomId) return false;
    if (roomId === GLOBAL_ROOM.id) {
      window.showToast?.("Global Chat can't be hidden.");
      return false;
    }

    const saved = await updateRoomPreference(roomId, {
      hidden: true,
      hiddenAt: Date.now(),
    });

    if (saved) {
      if (activeRoomRef.current?.id === roomId) switchRoom(GLOBAL_ROOM.id, GLOBAL_ROOM.name, GLOBAL_ROOM.shortId);
      if (!options.silent) window.showToast?.('Room hidden. Open Hidden rooms to restore it.', false);
    }

    return saved;
  }, [switchRoom, updateRoomPreference]);

  const unhideRoom = useCallback(async (room, options = {}) => {
    const roomId = typeof room === 'string' ? room : room?.id;
    if (!roomId) return false;

    const saved = await updateRoomPreference(roomId, {
      hidden: null,
      hiddenAt: null,
    });

    if (saved && !options.silent) window.showToast?.('Room restored.', false);
    return saved;
  }, [updateRoomPreference]);

  useEffect(() => {
    refreshRoomPreferenceControls();
  }, [activeRoom.id, refreshRoomPreferenceControls, roomPrefs]);

  useEffect(() => {
    if (activeRoom.id !== GLOBAL_ROOM.id && roomPreference(roomPrefs, activeRoom.id).hidden) {
      switchRoom(GLOBAL_ROOM.id, GLOBAL_ROOM.name, GLOBAL_ROOM.shortId);
    }
  }, [activeRoom.id, roomPrefs, switchRoom]);

  const prepareReply = useCallback((id, name, text, uid = '', threadRootId = '') => {
    const nextReply = {
      id,
      name,
      text,
      uid,
      threadRootId: threadRootId || id,
    };
    window.activeReplyData = nextReply;
    setReply(nextReply);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const cancelReply = useCallback(() => {
    window.activeReplyData = null;
    setReply(null);
  }, []);

  const replyInThread = useCallback((rootId) => {
    const root = messagesRef.current.find((message) => message.id === rootId);
    if (!root) {
      window.showToast?.('Load the thread root before replying.');
      return;
    }
    prepareReply(root.id, root.name, root.text || 'Attachment', root.uid, rootId);
    setThreadDrawerOpen(false);
  }, [prepareReply]);

  const switchChannel = useCallback((channelId) => {
    const nextChannelId = channelId || 'general';
    const nextScopeKey = messageScopeKey(activeRoomRef.current.id, nextChannelId);
    if (activeMessageScopeRef.current === nextScopeKey) return;

    setTyping(false);
    saveCurrentMessageState();
    activeMessageScopeRef.current = nextScopeKey;
    clearRoomSearch();
    setComposerMoreOpen(false);
    setThreadDrawerOpen(false);
    setActiveThreadRootId('');
    setActiveChannelId(nextChannelId);
    activeChannelRef.current = nextChannelId;
    window.activeChannelId = nextChannelId;
    window.dispatchEvent(new CustomEvent('minimalist:room-channel-change', {
      detail: { roomId: activeRoomRef.current.id, channelId: nextChannelId },
    }));
    writeLastRoomPreference(activeRoomRef.current, nextChannelId, user?.uid);
    restoreMessageStateForScope(nextScopeKey);
    setReply(null);
    setDraft(readComposerDraft(activeRoomRef.current.id, nextChannelId));
  }, [restoreMessageStateForScope, saveCurrentMessageState, setTyping, user?.uid]);

  /* eslint-disable react-hooks/set-state-in-effect -- Room changes intentionally reset channel state before the realtime listener attaches. */
  useEffect(() => {
    const bar = document.getElementById('room-channel-bar');
    if (window.syncRoomChannelBar) {
      window.syncRoomChannelBar();
    } else {
      const activeTab = document.querySelector('.room-tab.active')?.getAttribute('data-target');
      bar?.classList.toggle('hidden', activeRoom.id === 'global' || activeTab !== 'chat');
    }

    if (activeRoom.id === 'global') {
      setChannels([normalizeChannel('general', { name: 'general' })]);
      switchChannel('general');
      return undefined;
    }

    return onValue(ref(db, `rooms_meta/${activeRoom.id}/channels`), (snapshot) => {
      const value = snapshot.val() || {};
      const nextChannels = [
        normalizeChannel('general', { name: 'general' }),
        ...Object.entries(value).map(([id, channel]) => normalizeChannel(id, channel)),
      ];
      setChannels(nextChannels);
      if (!nextChannels.some((channel) => channel.id === activeChannelRef.current)) {
        switchChannel('general');
      }
    });
  }, [activeRoom.id, switchChannel]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const openQuickSwitcher = useCallback(() => {
    setQuickSwitcherOpen((current) => {
      if (current) return current;
      quickSwitchReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return true;
    });
  }, []);

  const closeQuickSwitcher = useCallback(() => {
    setQuickSwitcherOpen(false);
    const returnTarget = quickSwitchReturnFocusRef.current;
    quickSwitchReturnFocusRef.current = null;
    if (returnTarget && document.contains(returnTarget)) {
      requestAnimationFrame(() => returnTarget.focus?.());
    }
  }, []);

  const handleQuickSwitchDestination = useCallback((destination) => {
    if (!destination?.room?.id) return;
    closeQuickSwitcher();
    document.getElementById('desktop-room-sidebar')?.classList.remove('open');
    if (destination.type === 'channel') {
      window.activateRoomView?.('chat');
      if (destination.roomId === activeRoomRef.current.id) {
        switchChannel(destination.channelId || 'general');
      } else {
        switchRoom(
          destination.room.id,
          destination.room.name,
          destination.room.shortId,
          { channelId: destination.channelId || 'general' },
        );
      }
      return;
    }
    switchRoom(destination.room.id, destination.room.name, destination.room.shortId);
  }, [closeQuickSwitcher, switchChannel, switchRoom]);

  const dismissJumpContext = useCallback(() => {
    if (jumpNoticeTimerRef.current) {
      window.clearTimeout(jumpNoticeTimerRef.current);
      jumpNoticeTimerRef.current = null;
    }
    window.pendingMessageJump = null;
    setJumpContext(null);
  }, []);

  const requestMessageJump = useCallback((jump) => {
    const messageId = String(jump?.messageId || '').trim();
    if (!messageId) return;

    const roomId = jump.roomId || activeRoomRef.current.id;
    const channelId = jump.channelId || 'general';
    const nextJump = {
      ...jump,
      messageId,
      roomId,
      channelId,
      status: 'loading',
    };

    if (jumpNoticeTimerRef.current) {
      window.clearTimeout(jumpNoticeTimerRef.current);
      jumpNoticeTimerRef.current = null;
    }

    window.pendingMessageJump = nextJump;
    setJumpContext(nextJump);

    if (roomId && roomId !== activeRoomRef.current.id) {
      const targetRoom = roomsRef.current.find((room) => room.id === roomId);
      if (targetRoom) {
        switchRoom(targetRoom.id, targetRoom.name, targetRoom.shortId, { channelId });
      } else {
        window.showToast?.('Open the room first to jump to that message.');
      }
      return;
    }

    if ((channelId || 'general') !== activeChannelRef.current) {
      switchChannel(channelId || 'general');
    }
  }, [switchChannel, switchRoom]);

  useEffect(() => {
    window.switchRoomChannel = switchChannel;
    return () => {
      if (window.switchRoomChannel === switchChannel) delete window.switchRoomChannel;
    };
  }, [switchChannel]);

  const addChannel = useCallback(async () => {
    if (activeRoomRef.current.id === 'global') return;
    if (!(await canUseRoomPermission(activeRoomRef.current.id, 'createChannels', 'Channel creation is disabled in this room.'))) return;
    const name = await requestTextDialog({
      kicker: 'Channels',
      title: 'Create Channel',
      description: 'Add a focused channel inside this room.',
      variant: 'channel',
      label: 'Channel name',
      placeholder: 'design, announcements, bugs...',
      suggestions: ['announcements', 'design', 'bugs', 'resources', 'events'],
      confirmText: 'Add Channel',
      maxLength: 32,
    });
    const id = slugChannel(name);
    if (!id) return;
    const selectedMode = await requestTextDialog({
      kicker: 'Channel mode',
      title: `Choose how #${id} works`,
      description: 'Chat is open conversation. Announcements restrict posting. Help queue keeps support discussions focused.',
      label: 'Mode',
      placeholder: 'chat',
      defaultValue: 'chat',
      suggestions: ['chat', 'announcements', 'help'],
      confirmText: 'Create Channel',
      maxLength: 24,
    });
    if (!selectedMode) return;
    const mode = ['chat', 'announcements', 'help'].includes(selectedMode.toLowerCase())
      ? selectedMode.toLowerCase()
      : 'chat';
    await set(ref(db, `rooms_meta/${activeRoomRef.current.id}/channels/${id}`), {
      name: id,
      mode,
      postRole: mode === 'announcements' ? 'moderator' : '',
      createdAt: Date.now(),
      by: window.currentUser?.uid || '',
    });
    switchChannel(id);
    window.showToast?.(`#${id} created.`, false);
  }, [requestTextDialog, switchChannel]);

  const configureChannel = useCallback(async (channel) => {
    if (!channel?.id || channel.id === 'general' || activeRoomRef.current.id === 'global') return;
    if (!(await canUseRoomPermission(activeRoomRef.current.id, 'createChannels', 'Channel settings are restricted in this room.'))) return;
    const selectedMode = await requestTextDialog({
      kicker: 'Channel settings',
      title: `Configure #${channel.name}`,
      description: 'Choose chat, announcements, or help. Announcement posting is limited to the selected role.',
      label: 'Mode',
      defaultValue: channel.mode || 'chat',
      suggestions: ['chat', 'announcements', 'help'],
      confirmText: 'Continue',
      maxLength: 24,
    });
    if (!selectedMode) return;
    const mode = ['chat', 'announcements', 'help'].includes(selectedMode.toLowerCase())
      ? selectedMode.toLowerCase()
      : 'chat';
    let postRole = '';
    if (mode === 'announcements') {
      postRole = await requestTextDialog({
        kicker: 'Posting role',
        title: 'Who can announce?',
        description: 'Owners, admins, and moderators always qualify. Choose the minimum named role.',
        label: 'Role',
        defaultValue: channel.postRole || 'moderator',
        suggestions: ['moderator', 'admin', 'owner'],
        confirmText: 'Save Channel',
        maxLength: 24,
      });
      if (!postRole) return;
      postRole = ['moderator', 'admin', 'owner'].includes(postRole.toLowerCase())
        ? postRole.toLowerCase()
        : 'moderator';
    }
    await update(ref(db, `rooms_meta/${activeRoomRef.current.id}/channels/${channel.id}`), {
      mode,
      postRole,
      updatedAt: Date.now(),
      updatedBy: window.currentUser?.uid || '',
    });
    window.showToast?.(`#${channel.name} is now ${mode}.`, false);
  }, [requestTextDialog]);

  const displayMessage = useCallback((messageId, message, prepend = false) => {
    queueMessageMutation(messageId, message, prepend);
  }, [queueMessageMutation]);

  const updateMessageEl = useCallback((messageId, message) => {
    queueMessageMutation(messageId, message);
  }, [queueMessageMutation]);

  const deleteMessage = useCallback(async (messageId) => {
    const roomId = activeRoomRef.current.id;
    const channelId = activeChannelRef.current;
    const scopeKey = messageScopeKey(roomId, channelId);
    const confirmed = await requestConfirmDialog({
      kicker: 'Delete',
      title: 'Delete message?',
      description: 'This removes the message for everyone in the room.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await remove(roomMessageRef(roomId, messageId, channelId));
      const cached = messageStateByScopeRef.current.get(scopeKey);
      if (cached) {
        cacheMessageScopeState(messageStateByScopeRef.current, scopeKey, {
          ...cached,
          messages: (cached.messages || []).filter((message) => message.id !== messageId),
        });
      }
      if (activeMessageScopeRef.current === scopeKey) {
        setMessages((current) => {
          const next = current.filter((message) => message.id !== messageId);
          messagesRef.current = next;
          return next;
        });
      }
    } catch (error) {
      window.showToast?.(`Delete failed: ${error.message}`);
    }
  }, [requestConfirmDialog]);

  const startEditMessage = useCallback(async (messageId) => {
    const existing = messagesRef.current.find((message) => message.id === messageId);
    setEditingId(messageId);
    setEditingText(existing?.text || '');

    try {
      const snapshot = await get(roomMessageRef(activeRoomRef.current.id, messageId, activeChannelRef.current));
      if (snapshot.exists()) setEditingText(snapshot.val().text || '');
    } catch {
      // Local cached text is enough when the quick fetch fails.
    }
  }, []);

  const cancelEditMessage = useCallback(() => {
    setEditingId(null);
    setEditingText('');
  }, []);

  const saveEditedMessage = useCallback(async (messageId) => {
    const newText = editingText.trim();
    if (!newText) {
      window.showToast?.('Message cannot be empty. Use delete instead.');
      return;
    }

    const roomId = activeRoomRef.current.id;
    const channelId = activeChannelRef.current;
    const scopeKey = messageScopeKey(roomId, channelId);
    try {
      let editedAt = Date.now();
      if (roomId === 'global') {
        await update(roomMessageRef(roomId, messageId, channelId), { text: newText, edited: true, editedAt });
      } else {
        const result = await postAuthedJson(ROOM_MODERATION_ENDPOINT(), {
          action: 'message-edit',
          roomId,
          channelId: channelId || 'general',
          messageId,
          idempotencyKey: globalThis.crypto?.randomUUID?.() || `${messageId}_${editedAt}`,
          text: newText,
        }, 'Please sign in before editing a message.');
        editedAt = Number(result.message?.editedAt || editedAt);
      }
      const applyEdit = (list = []) => list.map((message) => (
        message.id === messageId ? {
          ...message,
          text: newText,
          edited: true,
          editedAt,
        } : message
      ));
      const cached = messageStateByScopeRef.current.get(scopeKey);
      if (cached) {
        cacheMessageScopeState(messageStateByScopeRef.current, scopeKey, {
          ...cached,
          messages: applyEdit(cached.messages),
        });
      }
      if (activeMessageScopeRef.current === scopeKey) {
        setMessages((current) => {
          const next = applyEdit(current);
          messagesRef.current = next;
          return next;
        });
      }
      setEditingId(null);
      setEditingText('');
    } catch (error) {
      window.showToast?.(`Edit failed: ${error.message}`);
    }
  }, [editingText]);

  const reactToMessage = useCallback(async (messageId, emoji) => {
    const uid = window.currentUser?.uid;
    if (!uid) return null;
    const emojiKey = reactionPathKey(emoji);
    if (!emojiKey) return null;
    const roomId = activeRoomRef.current.id;
    const channelId = activeChannelRef.current;
    const opKey = `${roomId}:${channelId}:${messageId}:${uid}:${emojiKey}`;
    const activeOp = pendingReactionOpsRef.current.get(opKey);
    if (activeOp) return activeOp;

    const operation = (async () => {
      const userReactionRef = roomMessageChildRef(roomId, messageId, `reactions/${uid}`, channelId);
      const reactionRef = roomMessageChildRef(roomId, messageId, `reactions/${uid}/${emojiKey}`, channelId);

      try {
        const snapshot = await get(userReactionRef);
        const current = snapshot.val();
        if (current === emojiKey) {
          await remove(userReactionRef);
          return null;
        }
        if (current && typeof current === 'object' && current[emojiKey] === true) {
          await remove(reactionRef);
          return null;
        }

        if (typeof current === 'string') {
          const legacyKey = reactionPathKey(current);
          if (legacyKey && legacyKey !== emojiKey) {
            await set(roomMessageChildRef(roomId, messageId, `reactions/${uid}/${legacyKey}`, channelId), true);
          }
        }

        await set(reactionRef, true);
        window.awardXP?.(uid, 'creativity', 2);
        window.trackQuest?.('react');
        return emojiKey;
      } catch (error) {
        console.error('Reaction failed', error);
        window.showToast?.(`Reaction failed: ${error.message || 'Permission denied'}`);
        return null;
      } finally {
        pendingReactionOpsRef.current.delete(opKey);
      }
    })();

    pendingReactionOpsRef.current.set(opKey, operation);
    return operation;
  }, []);

  const addReaction = useCallback((emoji) => {
    if (!window.activeMessageId) return;
    void reactToMessage(window.activeMessageId, emoji);
    closeEmojiPicker({ restoreFocus: true });
  }, [reactToMessage]);

  const toggleEmojiPicker = useCallback((event, messageId) => {
    event.preventDefault();
    event.stopPropagation();
    const picker = document.getElementById('emoji-picker');
    if (!picker) return;

    const trigger = event.currentTarget instanceof Element ? event.currentTarget : null;
    if (window.activeEmojiTrigger === trigger && !picker.classList.contains('hidden')) {
      closeEmojiPicker({ restoreFocus: true });
      return;
    }

    closeEmojiPicker();
    window.ensureEmojiPickerOptions?.();
    window.activeMessageId = messageId;
    window.activeEmojiTrigger = trigger;
    trigger?.setAttribute('aria-expanded', 'true');

    if (picker.parentElement !== document.body) {
      document.body.appendChild(picker);
    }

    picker.classList.remove('hidden');
    picker.style.position = 'fixed';
    picker.style.visibility = 'hidden';
    picker.style.zIndex = '9999';
    picker.style.top = '0px';
    picker.style.left = '0px';

    const messageEl = trigger?.closest?.('.chat-message') || null;
    const triggerRect = trigger?.getBoundingClientRect?.() || messageEl?.getBoundingClientRect?.();
    if (!triggerRect) {
      closeEmojiPicker();
      return;
    }
    const pickerRect = picker.getBoundingClientRect();
    const pickerWidth = pickerRect.width || 250;
    const pickerHeight = pickerRect.height || 200;
    const margin = 12;
    const rootStyle = getComputedStyle(document.documentElement);
    const safeLeft = Number.parseFloat(rootStyle.getPropertyValue('--app-safe-left')) || 0;
    const safeRight = Number.parseFloat(rootStyle.getPropertyValue('--app-safe-right')) || 0;
    const safeTop = Number.parseFloat(rootStyle.getPropertyValue('--app-safe-top')) || 0;
    const safeBottom = Number.parseFloat(rootStyle.getPropertyValue('--app-safe-bottom')) || 0;
    const minLeft = margin + safeLeft;
    const maxRight = margin + safeRight;
    const minTop = margin + safeTop;
    const maxBottom = margin + safeBottom;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    const isMine = messageEl?.classList.contains('my-message');
    let left = isMine ? triggerRect.right - pickerWidth : triggerRect.left;
    let top = triggerRect.top - pickerHeight - 6;

    if (top < minTop) {
      top = triggerRect.bottom + 6;
    }

    left = Math.max(minLeft, Math.min(left, viewportWidth - pickerWidth - maxRight));
    top = Math.max(minTop, Math.min(top, viewportHeight - pickerHeight - maxBottom));

    picker.style.left = `${Math.round(left)}px`;
    picker.style.top = `${Math.round(top)}px`;
    picker.style.visibility = '';
    window.requestAnimationFrame(() => picker.querySelector('.emoji-option')?.focus());

    if (window.hideEmojiPickerListener) {
      document.removeEventListener('click', window.hideEmojiPickerListener);
    }

    window.hideEmojiPickerListener = function hidePicker(clickEvent) {
      const clickTarget = clickEvent.target;
      const clickElement = clickTarget instanceof Element ? clickTarget : clickTarget?.parentElement || null;
      if (clickTarget instanceof Node && picker.contains(clickTarget)) return;
      if (clickElement?.closest?.('.more-icon')) return;

      if (clickElement) {
        closeEmojiPicker();
      }
    };

    window.setTimeout(() => {
      document.addEventListener('click', window.hideEmojiPickerListener);
    }, 0);
  }, []);

  useEffect(() => {
    registerApi({
      switchRoom,
      displayMessage,
      updateMessageEl,
      editMessage: startEditMessage,
      deleteMessage,
      reactToMessage,
      prepareReply,
      jumpToMessage: requestMessageJump,
      addReaction,
      toggleEmojiPicker,
      setRoomFavorite,
      toggleRoomFavorite,
      hideRoom,
      unhideRoom,
    });

    window.switchRoom = switchRoom;
    window.displayMessage = displayMessage;
    window.updateMessageEl = updateMessageEl;
    window.editMessage = startEditMessage;
    window.deleteMessage = deleteMessage;
    window.reactToMessage = reactToMessage;
    window.prepareReply = prepareReply;
    window.jumpToMessage = requestMessageJump;
    window.addReaction = addReaction;
    window.toggleEmojiPicker = toggleEmojiPicker;
    window.closeEmojiPicker = closeEmojiPicker;
    window.setRoomFavorite = setRoomFavorite;
    window.toggleRoomFavorite = toggleRoomFavorite;
    window.toggleActiveRoomFavorite = () => toggleRoomFavorite(activeRoomRef.current);
    window.hideRoom = hideRoom;
    window.hideActiveRoom = () => hideRoom(activeRoomRef.current);
    window.unhideRoom = unhideRoom;
    window.refreshRoomPreferenceControls = refreshRoomPreferenceControls;
    window.bindChatScrolling = () => {};
    window.bindRoomTyping = () => {};
    window.loadDraft = (roomId, channelId = activeChannelRef.current) => setDraft(readComposerDraft(roomId, channelId));
  }, [
    addReaction,
    deleteMessage,
    displayMessage,
    hideRoom,
    prepareReply,
    reactToMessage,
    registerApi,
    requestMessageJump,
    refreshRoomPreferenceControls,
    setRoomFavorite,
    startEditMessage,
    switchRoom,
    toggleEmojiPicker,
    toggleRoomFavorite,
    unhideRoom,
    updateMessageEl,
  ]);

  useEffect(() => {
    const handleMessageJump = (event) => {
      requestMessageJump(event.detail || window.pendingMessageJump);
    };

    window.addEventListener('minimalist:message-jump', handleMessageJump);
    if (window.pendingMessageJump?.messageId) requestMessageJump(window.pendingMessageJump);

    return () => window.removeEventListener('minimalist:message-jump', handleMessageJump);
  }, [requestMessageJump]);

  // Cmd/Ctrl+K toggles the quick switcher from anywhere in the chat (Discord /
  // Slack convention). The trigger button in the room list keeps it fully
  // discoverable without the shortcut.
  useEffect(() => {
    window.openQuickSwitcher = openQuickSwitcher;

    const handleShortcut = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key !== 'k' && event.key !== 'K') return;
      event.preventDefault();
      if (quickSwitcherOpen) closeQuickSwitcher();
      else openQuickSwitcher();
    };

    window.addEventListener('keydown', handleShortcut);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
      if (window.openQuickSwitcher === openQuickSwitcher) delete window.openQuickSwitcher;
    };
  }, [closeQuickSwitcher, openQuickSwitcher, quickSwitcherOpen]);

  useEffect(() => {
    if (!user?.uid) return undefined;

    let disposed = false;
    let roomIndexResolved = false;
    let roomIndexAccessDenied = false;
    let realtimeIndexVersion = 0;
    let refreshInFlight = null;
    let refreshRetryTimer = null;
    let refreshRetryCount = 0;
    let refreshScheduleTimer = null;
    const indexById = new Map();
    const metaById = new Map();
    const publishedRoomById = new Map([[GLOBAL_ROOM.id, GLOBAL_ROOM]]);
    const roomLoadState = new Map();
    const roomUnsubscribes = new Map();

    const removeMyIndexedRoom = (roomId) => {
      if (!roomId || roomId === 'global' || roomIndexAccessDenied) return;
      remove(ref(db, `user_rooms/${user.uid}/${roomId}`)).catch((error) => {
        console.warn('Could not prune stale room index', roomId, error);
      });
    };

    const publishRooms = () => {
      if (disposed) return;
      const nextRooms = [GLOBAL_ROOM];

      [...indexById.keys()]
        .filter((roomId) => roomId && roomId !== 'global')
        .sort((a, b) => {
          const aRoom = metaById.get(a) || indexById.get(a) || {};
          const bRoom = metaById.get(b) || indexById.get(b) || {};
          return cleanRoomText(aRoom.name, a).localeCompare(cleanRoomText(bRoom.name, b));
        })
        .forEach((roomId) => {
          const fallback = indexById.get(roomId) || {};
          const meta = metaById.get(roomId);
          const state = roomLoadState.get(roomId) || 'indexed';
          if (!meta && state === 'stale') return;
          const normalizedRoom = normalizeRoomForList(roomId, meta || fallback, fallback);
          const previousRoom = publishedRoomById.get(roomId);
          const stableRoom = shallowEqualRoomRecord(previousRoom, normalizedRoom)
            ? previousRoom
            : normalizedRoom;
          publishedRoomById.set(roomId, stableRoom);
          nextRooms.push(stableRoom);
        });

      const liveRoomIds = new Set(nextRooms.map((room) => room.id));
      publishedRoomById.forEach((_, roomId) => {
        if (!liveRoomIds.has(roomId)) publishedRoomById.delete(roomId);
      });

      const previousRooms = roomsRef.current;
      const roomsChanged = previousRooms.length !== nextRooms.length
        || nextRooms.some((room, index) => room !== previousRooms[index]);
      if (roomsChanged) {
        roomsRef.current = nextRooms;
        setRooms(nextRooms);
      }

      const currentRoom = nextRooms.find((room) => room.id === activeRoomRef.current.id);
      if (!currentRoom && roomIndexResolved) {
        switchRoom('global', GLOBAL_ROOM.name, GLOBAL_ROOM.shortId);
      } else if (
        currentRoom
        && (currentRoom.name !== activeRoomRef.current.name || currentRoom.shortId !== activeRoomRef.current.shortId)
      ) {
        const updatedRoom = {
          id: currentRoom.id,
          name: currentRoom.name,
          shortId: currentRoom.shortId,
        };
        activeRoomRef.current = updatedRoom;
        setActiveRoom(updatedRoom);
        setHeaderRoom(updatedRoom.id, updatedRoom.name);
      }
    };

    const stopRoomListener = (roomId) => {
      const unsubscribeRoom = roomUnsubscribes.get(roomId);
      if (unsubscribeRoom) unsubscribeRoom();
      roomUnsubscribes.delete(roomId);
    };

    let roomPublishQueued = false;
    const scheduleRoomPublish = () => {
      if (disposed || roomPublishQueued) return;
      roomPublishQueued = true;
      queueMicrotask(() => {
        roomPublishQueued = false;
        publishRooms();
      });
    };

    const syncRoomListener = (roomId) => {
      if (!roomId || roomId === 'global' || roomUnsubscribes.has(roomId)) return;
      roomLoadState.set(roomId, 'pending');
      const unsubscribers = [];
      let detailsAttached = false;
      let stopped = false;

      const stopAll = () => {
        if (stopped) return;
        stopped = true;
        unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
      };

      const handleListenerError = (error) => {
        if (stopped) return;
        console.warn('Room sidebar listener failed', roomId, error);
        stopAll();
        roomUnsubscribes.delete(roomId);
        metaById.delete(roomId);
        const permissionDenied = /permission/i.test(String(error?.code || error?.message || ''));
        roomLoadState.set(roomId, permissionDenied ? 'stale' : 'indexed');
        if (permissionDenied) removeMyIndexedRoom(roomId);
        scheduleRoomPublish();
      };

      const commitField = (field, value) => {
        if (stopped) return;
        const fallback = indexById.get(roomId) || {};
        const previous = metaById.get(roomId);
        const current = previous || roomSidebarMetadata(roomId, {}, fallback);
        const next = roomSidebarMetadata(roomId, { ...current, [field]: value }, fallback);
        metaById.set(roomId, next);
        roomLoadState.set(roomId, 'ready');
        if (!shallowEqualRoomRecord(previous, next)) scheduleRoomPublish();
      };

      const attachDetailListeners = () => {
        if (detailsAttached || stopped) return;
        detailsAttached = true;
        [
          ['name', 'name'],
          ['shortId', 'shortId'],
          ['photoUrl', 'photoUrl'],
        ].forEach(([path, field]) => {
          const unsubscribe = onValue(ref(db, `rooms_meta/${roomId}/${path}`), (snapshot) => {
            if (field === 'name' && !snapshot.exists()) {
              stopAll();
              roomUnsubscribes.delete(roomId);
              metaById.delete(roomId);
              roomLoadState.set(roomId, 'stale');
              removeMyIndexedRoom(roomId);
              scheduleRoomPublish();
              return;
            }
            commitField(field, snapshot.val());
          }, handleListenerError);
          unsubscribers.push(unsubscribe);
        });
      };

      // lastMessage inherits the room-level membership rule, so it validates
      // access without streaming the large members/logs/settings metadata tree.
      const unsubscribeAccess = onValue(ref(db, `rooms_meta/${roomId}/lastMessage`), (snapshot) => {
        commitField('lastMessage', snapshot.val() || '');
        attachDetailListeners();
      }, handleListenerError);
      unsubscribers.push(unsubscribeAccess);
      roomUnsubscribes.set(roomId, stopAll);
    };

    const removeRoomListener = (roomId) => {
      stopRoomListener(roomId);
      metaById.delete(roomId);
      roomLoadState.delete(roomId);
    };

    const reconcileRoomListeners = () => {
      const indexedRoomIds = [...indexById.keys()].filter((roomId) => roomId && roomId !== 'global');
      indexedRoomIds.forEach(syncRoomListener);
    };

    const applyRoomIndexRows = (rows = []) => {
      const nextIds = new Set();

      rows.forEach((row) => {
        const roomId = row?.id || row?.roomId;
        if (!roomId || roomId === 'global') return;
        nextIds.add(roomId);
        indexById.set(roomId, row);
      });

      [...indexById.keys()].forEach((roomId) => {
        if (nextIds.has(roomId)) return;
        indexById.delete(roomId);
        removeRoomListener(roomId);
      });

      reconcileRoomListeners();
      publishRooms();
    };

    const scheduleRoomIndexRetry = () => {
      if (disposed || refreshRetryTimer || refreshRetryCount >= 2) return;
      const delay = Math.min(1000 * (2 ** Math.min(refreshRetryCount, 4)), 15000);
      refreshRetryTimer = window.setTimeout(() => {
        refreshRetryTimer = null;
        refreshRoomIndex().catch((error) => {
          console.warn('Room index gateway retry failed', error);
        });
      }, delay);
    };

    const refreshRoomIndex = () => {
      if (refreshInFlight) return refreshInFlight;
      const realtimeVersionAtRequest = realtimeIndexVersion;
      refreshInFlight = refreshMyRoomIndexFromGateway()
        .then((gatewayRooms) => {
          if (disposed) return;
          const repairedAt = Date.now();
          roomIndexRepairMemory.set(user.uid, repairedAt);
          try {
            localStorage.setItem(`${ROOM_INDEX_REPAIR_STORAGE_PREFIX}:${user.uid}`, String(repairedAt));
          } catch {
            // The room index still works when persistent storage is unavailable.
          }
          roomIndexResolved = true;
          refreshRetryCount = 0;
          if (!roomIndexAccessDenied && realtimeIndexVersion !== realtimeVersionAtRequest) {
            publishRooms();
            return;
          }
          applyRoomIndexRows(gatewayRooms);
        })
        .catch((error) => {
          if (!disposed) {
            refreshRetryCount += 1;
            scheduleRoomIndexRetry();
          }
          throw error;
        })
        .finally(() => {
          refreshInFlight = null;
        });
      return refreshInFlight;
    };

    const roomIndexRepairIsDue = () => {
      const memoryRepair = roomIndexRepairMemory.get(user.uid) || 0;
      try {
        const lastRepair = Number(localStorage.getItem(`${ROOM_INDEX_REPAIR_STORAGE_PREFIX}:${user.uid}`) || 0);
        const latestRepair = Math.max(lastRepair, memoryRepair);
        return !latestRepair || Date.now() - latestRepair >= ROOM_INDEX_REPAIR_TTL_MS;
      } catch {
        return !memoryRepair || Date.now() - memoryRepair >= ROOM_INDEX_REPAIR_TTL_MS;
      }
    };

    const scheduleRoomIndexRepair = () => {
      if (disposed || refreshScheduleTimer || !roomIndexRepairIsDue()) return;
      refreshScheduleTimer = window.setTimeout(() => {
        refreshScheduleTimer = null;
        refreshRoomIndex().catch((error) => {
          console.warn('Room index backfill failed', error);
        });
      }, 5000);
    };

    const unsubscribeIndex = onValue(ref(db, `user_rooms/${user.uid}`), (snapshot) => {
      realtimeIndexVersion += 1;
      const indexedRooms = [];
      snapshot.forEach((child) => {
        if (!child.key || child.key === 'global') return;
        indexedRooms.push({ id: child.key, ...(child.val() || {}) });
      });
      applyRoomIndexRows(indexedRooms);
      roomIndexResolved = true;
      if (indexedRooms.length) scheduleRoomIndexRepair();
      else refreshRoomIndex().catch((error) => console.warn('Room index recovery failed', error));
    }, (error) => {
      const permissionDenied = /permission/i.test(String(error?.code || error?.message || ''));
      roomIndexAccessDenied = permissionDenied;
      if (permissionDenied) {
        console.info('[chat] realtime room index unavailable; using authenticated room gateway');
      } else {
        console.warn('Room index listener failed', error);
      }
      publishRooms();
      refreshRoomIndex().catch((refreshError) => {
        console.warn('Room index gateway fallback failed', refreshError);
      });
    });

    return () => {
      disposed = true;
      if (refreshRetryTimer) window.clearTimeout(refreshRetryTimer);
      if (refreshScheduleTimer) window.clearTimeout(refreshScheduleTimer);
      unsubscribeIndex();
      roomUnsubscribes.forEach((unsubscribeRoom) => unsubscribeRoom());
      roomUnsubscribes.clear();
    };
  }, [switchRoom, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !activeRoom.id) return undefined;
    let cancelled = false;

    const loadMentionCandidates = async () => {
      const currentRoom = roomsRef.current.find((room) => room.id === activeRoom.id);
      let memberNames = null;
      let entries = [];

      if (activeRoom.id === 'global') {
        const usersSnapshot = await get(ref(db, 'user_directory')).catch(() => null);
        entries = Object.entries(usersSnapshot?.val() || {});
      } else {
        memberNames = currentRoom?.members || {};
        if (!Object.keys(memberNames).length) {
          const membersSnapshot = await get(ref(db, `rooms_meta/${activeRoom.id}/members`)).catch(() => null);
          memberNames = membersSnapshot?.val() || {};
        }
        entries = Object.entries(memberNames || {}).map(([uid, member]) => {
          const profile = member && typeof member === 'object' ? member : {};
          const fallbackName = typeof member === 'string' ? member : profile.displayName || profile.name || 'User';
          return [uid, { ...profile, fallbackName }];
        });
      }

      const nextCandidates = entries
        .filter(([uid]) => uid && uid !== user.uid)
        .map(([uid, profile]) => {
          const name = profile.displayName || profile.name || profile.username || profile.fallbackName || 'User';
          return {
            uid,
            name,
            shortId: profile.shortId || '',
            photoUrl: normalizeStoredAvatarUrl(profile.photoUrl || profile.photoURL),
          };
        })
        .filter((candidate) => candidateMentionHandle(candidate).length >= 2)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (!cancelled) setMentionCandidates(nextCandidates);
    };

    loadMentionCandidates();
    return () => {
      cancelled = true;
    };
  }, [activeRoom.id, user?.uid]);

  useEffect(() => {
    if (didBootRoomRef.current) return;
    didBootRoomRef.current = true;

    const savedRoom = initialRoomPreference;
    if (savedRoom?.roomId) {
      switchRoom(savedRoom.roomId, savedRoom.roomName, savedRoom.shortId, { channelId: savedRoom.channelId || 'general' });
      return;
    }

    switchRoom(window.activeRoomId || GLOBAL_ROOM.id, initialRoom.name || GLOBAL_ROOM.name, window.activeRoomShortId || initialRoom.shortId || GLOBAL_ROOM.shortId);
    // The first room boot should happen once after this React island mounts.
  }, [initialRoom.name, initialRoom.shortId, initialRoomPreference, switchRoom]);

  useEffect(() => {
    if (!user?.uid || !activeRoom.id) return undefined;

    if (muteTimerRef.current) clearTimeout(muteTimerRef.current);

    const muteRef = activeRoom.id === 'global'
      ? ref(db, `users/${user.uid}/isMuted`)
      : ref(db, `rooms_meta/${activeRoom.id}/muted/${user.uid}`);

    const unsubscribe = onValue(muteRef, (snapshot) => {
      if (muteTimerRef.current) clearTimeout(muteTimerRef.current);

      if (!snapshot.exists()) {
        setComposerDisabled(false);
        setPlaceholder(`Message ${activeRoom.name}...`);
        return;
      }

      const value = snapshot.val();
      if (value === true) {
        setComposerDisabled(true);
        setPlaceholder(activeRoom.id === 'global' ? 'You are globally muted.' : 'You are permanently muted in this room.');
        return;
      }

      const timeLeft = Number(value) - Date.now();
      if (timeLeft > 0) {
        setComposerDisabled(true);
        setPlaceholder(`Muted. Unmutes in ${Math.ceil(timeLeft / 60000)}m...`);
        muteTimerRef.current = setTimeout(() => {
          setComposerDisabled(false);
          setPlaceholder(`Message ${activeRoom.name}...`);
          remove(muteRef);
        }, timeLeft);
      } else {
        setComposerDisabled(false);
        setPlaceholder(`Message ${activeRoom.name}...`);
        remove(muteRef);
      }
    });

    return () => {
      unsubscribe();
      if (muteTimerRef.current) clearTimeout(muteTimerRef.current);
    };
  }, [activeRoom.id, activeRoom.name, user?.uid]);

  /* eslint-disable react-hooks/set-state-in-effect -- A scope switch must restore cached message state before realtime events arrive. */
  useEffect(() => {
    if (!activeRoom.id) return undefined;

    const scopeKey = messageScopeKey(activeRoom.id, activeChannelId);
    activeMessageScopeRef.current = scopeKey;
    const cached = messageStateByScopeRef.current.get(scopeKey);
    const currentMessagesRef = roomMessagesRef(activeRoom.id, activeChannelId);
    const latestQuery = query(currentMessagesRef, orderByKey(), limitToLast(30));

    historyRequestIdRef.current += 1;
    clearPendingMessageOps();
    clearScrollSettleTimers();
    pendingHistoryScrollRestoreRef.current = null;
    pendingMessageWindowScrollRestoreRef.current = null;
    delete window.pendingMessageWindowScrollRestore;
    shouldStickToBottomRef.current = cached ? cached.wasAtBottom !== false : true;
    forceScrollToLatestRef.current = cached ? cached.wasAtBottom !== false : true;
    oldestMessageKeyRef.current = cached?.oldestMessageKey ?? null;
    historyExhaustedRef.current = cached?.historyExhausted === true;
    window.oldestMessageKey = oldestMessageKeyRef.current;
    window.isFetchingHistory = false;
    isFetchingHistoryRef.current = false;
    setLoadingHistory(false);
    pendingMessageScrollRestoreRef.current = cached ? {
      scopeKey,
      scrollTop: cached.scrollTop || 0,
      wasAtBottom: cached.wasAtBottom !== false,
    } : null;
    const cachedMessages = cached?.messages || [];
    messagesRef.current = cachedMessages;
    setMessages(cachedMessages);
    setInitialMessagesLoading(cachedMessages.length === 0);
    setMessagesLoadFailed(false);

    const unsubscribeReady = onValue(latestQuery, () => {
      if (activeMessageScopeRef.current !== scopeKey) return;
      setInitialMessagesLoading(false);
      setMessagesLoadFailed(false);
    }, () => {
      if (activeMessageScopeRef.current !== scopeKey) return;
      setInitialMessagesLoading(false);
      setMessagesLoadFailed(true);
    }, { onlyOnce: true });

    const unsubscribeAdd = onChildAdded(latestQuery, (snapshot, previousChildKey) => {
      if (activeMessageScopeRef.current !== scopeKey) return;
      const shouldAdvanceHistoryBoundary = (
        !historyExhaustedRef.current
        && (
          !oldestMessageKeyRef.current
          || (previousChildKey === null && snapshot.key < oldestMessageKeyRef.current)
        )
      );
      if (shouldAdvanceHistoryBoundary) {
        oldestMessageKeyRef.current = snapshot.key;
        window.oldestMessageKey = snapshot.key;
      }
      displayMessage(snapshot.key, snapshot.val(), previousChildKey === null);
    });

    const unsubscribeChange = onChildChanged(latestQuery, (snapshot) => {
      if (activeMessageScopeRef.current !== scopeKey) return;
      updateMessageEl(snapshot.key, snapshot.val());
    });

    const unsubscribeRemove = onChildRemoved(latestQuery, (snapshot) => {
      const removedScope = scopeKey;
      const removedKey = snapshot.key;
      if (activeMessageScopeRef.current !== removedScope) return;
      get(roomMessageRef(activeRoom.id, removedKey, activeChannelId))
        .then((currentSnapshot) => {
          if (activeMessageScopeRef.current !== removedScope || currentSnapshot.exists()) return;
          setMessages((current) => {
            const next = current.filter((message) => message.id !== removedKey);
            messagesRef.current = next;
            return next;
          });
        })
        .catch((error) => console.warn('[chat] could not verify removed message', {
          roomId: activeRoom.id,
          channelId: activeChannelId || 'general',
          errorCode: error?.code || 'unknown',
        }));
    });

    return () => {
      clearPendingMessageOps();
      unsubscribeAdd();
      unsubscribeChange();
      unsubscribeRemove();
      unsubscribeReady();
    };
  }, [activeChannelId, activeRoom.id, clearPendingMessageOps, clearScrollSettleTimers, displayMessage, updateMessageEl]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!activeRoom.id || !window.currentUser?.uid) return undefined;

    setTyping(false);
    const typingRef = roomTypingRef(activeRoom.id, activeChannelId);
    const unsubscribe = onValue(typingRef, (snapshot) => {
      const names = Object.entries(snapshot.val() || {})
        .filter(([uid]) => uid !== window.currentUser?.uid)
        .map(([, name]) => name);
      setTypingNames((current) => (sameStringArray(current, names) ? current : names));
    });

    return () => {
      unsubscribe();
      setTyping(false);
    };
  }, [activeChannelId, activeRoom.id, setTyping]);

  useEffect(() => {
    const searchInput = document.getElementById('room-search-input');
    if (!searchInput) return undefined;

    const handleSearch = () => setSearchQuery(searchInput.value.trim().toLowerCase());
    searchInput.addEventListener('input', handleSearch);
    handleSearch();

    return () => searchInput.removeEventListener('input', handleSearch);
  }, []);

  useEffect(() => {
    if (!listRef.current || loadingHistory) return;

    const shouldForceLatest = forceScrollToLatestRef.current;
    if (!shouldForceLatest && !shouldStickToBottomRef.current) return;

    scrollMessagesToLatest(shouldForceLatest ? 2 : 1, { settle: shouldForceLatest && messages.length > 0 });
  }, [loadingHistory, messages.length, scrollMessagesToLatest]);

  useEffect(() => {
    if (!messages.length || !shouldStickToBottomRef.current || document.hidden) return undefined;
    const frameId = requestAnimationFrame(() => {
      if (isMessageListAtBottom(listRef.current)) void markLatestMessageRead();
    });
    return () => cancelAnimationFrame(frameId);
  }, [markLatestMessageRead, messages.length]);

  /* eslint-disable react-hooks/set-state-in-effect -- Jump feedback mirrors an imperative DOM lookup performed after message renders. */
  useEffect(() => {
    const jump = window.pendingMessageJump;
    if (!jump?.messageId) return;
    if (jump.roomId && jump.roomId !== activeRoom.id) return;
    if ((jump.channelId || 'general') !== activeChannelId) return;

    const target = document.getElementById(`msg-${jump.messageId}`);
    if (!target) {
      setJumpContext((current) => (
        current?.messageId === jump.messageId && current.status === 'loading'
          ? current
          : { ...jump, status: 'loading' }
      ));
      return;
    }

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('message-jump-highlight');
    window.setTimeout(() => target.classList.remove('message-jump-highlight'), 1800);
    window.pendingMessageJump = null;
    setJumpContext({ ...jump, status: 'found' });
    if (jumpNoticeTimerRef.current) window.clearTimeout(jumpNoticeTimerRef.current);
    jumpNoticeTimerRef.current = window.setTimeout(() => {
      jumpNoticeTimerRef.current = null;
      setJumpContext(null);
    }, 1400);
  }, [activeChannelId, activeRoom.id, jumpContext, messages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleLoadHistory = useCallback(async (force = false) => {
    const list = listRef.current;
    if (
      !list
      || isFetchingHistoryRef.current
      || historyExhaustedRef.current
      || !oldestMessageKeyRef.current
    ) return false;
    if (!force && list.scrollTop > 2) return false;

    const scopeKey = activeMessageScopeRef.current;
    const availableHistorySlots = Math.max(0, MESSAGE_ACTIVE_HARD_LIMIT - messagesRef.current.length);
    if (!availableHistorySlots) {
      historyExhaustedRef.current = true;
      const existing = messageStateByScopeRef.current.get(scopeKey) || {};
      cacheMessageScopeState(messageStateByScopeRef.current, scopeKey, {
        ...existing,
        oldestMessageKey: oldestMessageKeyRef.current,
        historyExhausted: true,
      });
      if (force) window.showToast?.('The loaded history limit is reached. Use Latest to return to the newest messages.');
      return false;
    }

    const roomId = activeRoomRef.current.id;
    const channelId = activeChannelRef.current;
    const boundaryKey = oldestMessageKeyRef.current;
    const historyPageSize = Math.min(MESSAGE_HISTORY_PAGE_SIZE, availableHistorySlots);
    const requestId = historyRequestIdRef.current + 1;
    historyRequestIdRef.current = requestId;
    const isCurrentRequest = () => (
      historyRequestIdRef.current === requestId
      && activeMessageScopeRef.current === scopeKey
    );

    isFetchingHistoryRef.current = true;
    window.isFetchingHistory = true;
    forceScrollToLatestRef.current = false;
    shouldStickToBottomRef.current = false;
    clearScrollSettleTimers();
    if (scrollToBottomFrameRef.current) {
      cancelAnimationFrame(scrollToBottomFrameRef.current);
      scrollToBottomFrameRef.current = null;
    }
    setLoadingHistory(true);

    try {
      const oldScrollHeight = list.scrollHeight;
      const oldScrollTop = list.scrollTop;
      const viewportAnchor = captureMessageViewportAnchor(list);
      const snapshot = await get(query(
        roomMessagesRef(roomId, channelId),
        orderByKey(),
        endBefore(boundaryKey),
        limitToLast(historyPageSize),
      ));

      if (!isCurrentRequest()) return false;

      if (snapshot.exists()) {
        const history = [];
        snapshot.forEach((child) => {
          history.push({ id: child.key, ...child.val() });
        });

        pendingHistoryScrollRestoreRef.current = {
          scopeKey,
          requestId,
          scrollTop: oldScrollTop,
          scrollHeight: oldScrollHeight,
          ...(viewportAnchor || {}),
        };
        setMessages((current) => {
          if (!isCurrentRequest()) return current;
          const known = new Set(current.map((message) => message.id));
          const remainingSlots = Math.max(0, MESSAGE_ACTIVE_HARD_LIMIT - current.length);
          const historyToPrepend = remainingSlots
            ? history.filter((message) => !known.has(message.id)).slice(-remainingSlots)
            : [];
          const next = [...historyToPrepend, ...current];
          oldestMessageKeyRef.current = next[0]?.id ?? boundaryKey;
          historyExhaustedRef.current = history.length < historyPageSize
            || next.length >= MESSAGE_ACTIVE_HARD_LIMIT;
          window.oldestMessageKey = oldestMessageKeyRef.current;
          const existing = messageStateByScopeRef.current.get(scopeKey) || {};
          cacheMessageScopeState(messageStateByScopeRef.current, scopeKey, {
            ...existing,
            messages: next,
            oldestMessageKey: oldestMessageKeyRef.current,
            historyExhausted: historyExhaustedRef.current,
          });
          messagesRef.current = next;
          return next;
        });
        return true;
      }

      oldestMessageKeyRef.current = null;
      historyExhaustedRef.current = true;
      window.oldestMessageKey = null;
      const existing = messageStateByScopeRef.current.get(scopeKey) || {};
      cacheMessageScopeState(messageStateByScopeRef.current, scopeKey, {
        ...existing,
        oldestMessageKey: null,
        historyExhausted: true,
      });
      if (force) {
        setJumpContext((current) => current && current.status !== 'found'
          ? { ...current, status: 'exhausted' }
          : current);
      }
      return false;
    } catch (error) {
      if (!isCurrentRequest()) return false;
      if (force) window.showToast?.(`Could not load older history: ${error.message || error}`);
      console.warn('[chat] older history load failed', {
        roomId,
        channelId: channelId || 'general',
        errorCode: error?.code || 'unknown',
      });
      return false;
    } finally {
      if (isCurrentRequest()) {
        isFetchingHistoryRef.current = false;
        window.isFetchingHistory = false;
        setLoadingHistory(false);
      }
    }
  }, [clearScrollSettleTimers]);

  const loadOlderForJump = useCallback(async () => {
    if (historyExhaustedRef.current || !oldestMessageKeyRef.current) {
      window.showToast?.('No older loaded history is available for this jump.');
      setJumpContext((current) => current && current.status !== 'found'
        ? { ...current, status: 'exhausted' }
        : current);
      return;
    }

    if (listRef.current) listRef.current.scrollTop = 0;
    await handleLoadHistory(true);
  }, [handleLoadHistory]);

  const handleMessagesScroll = useCallback(() => {
    if (scrollFrameRef.current) return;

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const list = listRef.current;
      if (!list) return;

      const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
      const hasRecentUserIntent = messageScrollGestureActiveRef.current
        || Date.now() - lastMessageScrollIntentAtRef.current < 1200;
      if (messageScrollGestureActiveRef.current) lastMessageScrollIntentAtRef.current = Date.now();
      shouldStickToBottomRef.current = distanceFromBottom < 120;
      if (shouldStickToBottomRef.current) void markLatestMessageRead();
      if (hasRecentUserIntent && !shouldStickToBottomRef.current) {
        forceScrollToLatestRef.current = false;
        clearScrollSettleTimers();
        if (scrollToBottomFrameRef.current) {
          cancelAnimationFrame(scrollToBottomFrameRef.current);
          scrollToBottomFrameRef.current = null;
        }
      }
      if (hasRecentUserIntent && list.scrollTop <= 2) {
        lastMessageScrollIntentAtRef.current = 0;
        handleLoadHistory();
      }
    });
  }, [clearScrollSettleTimers, handleLoadHistory, markLatestMessageRead]);

  const handleMessagesScrollIntent = useCallback((event) => {
    if (
      event.type === 'keydown'
      && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
    ) return;
    if (event.type === 'pointerdown' || event.type === 'touchstart') {
      messageScrollGestureActiveRef.current = true;
    } else if (['pointerup', 'pointercancel', 'touchend', 'touchcancel'].includes(event.type)) {
      messageScrollGestureActiveRef.current = false;
    }
    lastMessageScrollIntentAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    const endScrollGesture = () => {
      if (!messageScrollGestureActiveRef.current) return;
      messageScrollGestureActiveRef.current = false;
      lastMessageScrollIntentAtRef.current = Date.now();
    };

    window.addEventListener('pointerup', endScrollGesture, { passive: true });
    window.addEventListener('pointercancel', endScrollGesture, { passive: true });
    window.addEventListener('touchend', endScrollGesture, { passive: true });
    window.addEventListener('touchcancel', endScrollGesture, { passive: true });
    window.addEventListener('blur', endScrollGesture);
    return () => {
      window.removeEventListener('pointerup', endScrollGesture);
      window.removeEventListener('pointercancel', endScrollGesture);
      window.removeEventListener('touchend', endScrollGesture);
      window.removeEventListener('touchcancel', endScrollGesture);
      window.removeEventListener('blur', endScrollGesture);
    };
  }, []);

  useEffect(() => () => {
    if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
    if (scrollToBottomFrameRef.current) cancelAnimationFrame(scrollToBottomFrameRef.current);
    if (jumpNoticeTimerRef.current) window.clearTimeout(jumpNoticeTimerRef.current);
    clearScrollSettleTimers();
    clearPendingMessageOps();
  }, [clearPendingMessageOps, clearScrollSettleTimers]);

  useLayoutEffect(() => {
    resizeComposerTextarea();
  }, [draft, resizeComposerTextarea]);

  const handleDraftChange = useCallback((event) => {
    const value = event.target.value;
    setCursorIndex(event.target.selectionStart ?? value.length);
    setDismissedMentionKey('');
    setQuickReplyStatus('');
    setDraft(value);
    writeComposerDraft(activeRoomRef.current.id, activeChannelRef.current, value);
    setTyping(value.trim().length > 0);

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => setTyping(false), 3000);
  }, [setTyping]);

  const slashQuery = getSlashQuery(draft);
  const slashCommands = useMemo(() => getSlashSuggestions(slashQuery), [slashQuery]);
  const slashMenuOpen = slashQuery !== null && !composerDisabled && !isSending;
  const mentionToken = useMemo(() => getMentionToken(draft, cursorIndex), [cursorIndex, draft]);
  const mentionSuggestions = useMemo(
    () => getMentionSuggestions(mentionCandidates, mentionToken),
    [mentionCandidates, mentionToken],
  );
  const mentionKey = mentionToken ? `${activeRoom.id}:${mentionToken.start}:${mentionToken.query}:${draft}` : '';
  const mentionMenuOpen = Boolean(
    mentionToken
    && mentionKey !== dismissedMentionKey
    && !slashMenuOpen
    && !composerDisabled
    && !isSending,
  );

  /* eslint-disable react-hooks/set-state-in-effect -- Query changes intentionally reset keyboard selection for both suggestion menus. */
  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    setMentionSelectedIndex(0);
  }, [mentionToken?.query, activeRoom.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const clearComposerDraft = useCallback(() => {
    setDraft('');
    setQuickReplyStatus('');
    clearComposerDraftStorage(activeRoomRef.current.id, activeChannelRef.current);
    setTyping(false);
  }, [setTyping]);

  const openActivityPanel = useCallback((tab = 'activity') => {
    if (window.openUpdatesPanel?.({ tab })) return;
    document.getElementById('updates-panel')?.classList.add('open');
    window.setUpdatesTab?.(tab);
  }, []);

  const focusSearch = useCallback(() => {
    const input = document.getElementById('room-search-input');
    if (!input) return window.showToast?.('Search is not ready yet.');
    if (window.setRoomSearchOpen?.(true)) return;
    input.classList.add('open');
    input.setAttribute('aria-hidden', 'false');
    input.tabIndex = 0;
    input.focus();
  }, []);

  const openRoomAiFromCatchUp = useCallback(() => {
    if (!openRoomTab('ai')) window.openPersonalAgent?.();
    window.showToast?.('Room AI opened. Ask for a summary when you are ready.', false);
  }, []);

  const reviewCatchUpMessage = useCallback((messageId) => {
    requestMessageJump({
      channelId: activeChannelRef.current,
      messageId,
      roomId: activeRoomRef.current.id,
      source: 'room-catchup',
    });
  }, [requestMessageJump]);

  const postRoomActivitySeparator = useCallback(async (roomId, channelId, activityEvent) => {
    const { postRoomActivityMessage } = await import('./roomActivityMessageRuntime.js');
    await postRoomActivityMessage(roomId, channelId, getProfileSnapshot(), activityEvent);
  }, []);

  const createTaskFromText = useCallback(async (text) => {
    const clean = String(text || '').trim();
    if (!clean) {
      openRoomTab('tasks');
      setTimeout(() => document.getElementById('task-input')?.focus(), 80);
      return;
    }

    const uid = window.currentUser?.uid;
    if (!uid) {
      window.showToast?.('Sign in before creating a task.');
      return;
    }

    const taskRoomId = activeRoomRef.current.id;
    const taskChannelId = activeChannelRef.current;
    try {
      await push(ref(db, `room_tasks/${taskRoomId}`), {
        text: clean.slice(0, 240),
        status: 'todo',
        done: false,
        priority: 'medium',
        by: uid,
        byName: window.userProfileName || 'Anonymous',
        assignee: uid,
        assigneeName: window.userProfileName || 'Anonymous',
        createdAt: serverTimestamp(),
      });
      await postRoomActivitySeparator(taskRoomId, taskChannelId, {
        type: 'task_created',
        label: 'Task created',
        detail: clean,
      }).catch((error) => console.warn('[chat] task activity separator failed', {
        roomId: taskRoomId,
        errorCode: error?.code || 'unknown',
      }));
      window.showToast?.('Task created.', false);
    } catch (error) {
      console.error('Task creation failed', error);
      window.showToast?.(`Task failed: ${error.message || 'Permission denied'}`);
    }
  }, [postRoomActivitySeparator]);

  const createTaskFromCatchUp = useCallback(async (text) => {
    const taskScope = messageScopeKey(activeRoomRef.current.id, activeChannelRef.current);
    const taskText = await requestTextDialog({
      kicker: 'Room catch-up',
      title: 'Save as a task',
      description: 'Review or edit this suggested action before it is added to the room.',
      label: 'Task',
      defaultValue: String(text || '').slice(0, 240),
      confirmText: 'Create task',
      maxLength: 240,
    });
    if (!taskText) return;
    if (messageScopeKey(activeRoomRef.current.id, activeChannelRef.current) !== taskScope) {
      window.showToast?.('Task canceled because the active room changed.');
      return;
    }
    await createTaskFromText(taskText);
  }, [createTaskFromText, requestTextDialog]);

  const postStockQuote = useCallback(async (rawSymbol) => {
    const requestContext = {
      roomId: activeRoomRef.current.id,
      channelId: activeChannelRef.current,
      requesterUid: currentChatUser()?.uid || '',
    };
    if (!requestContext.requesterUid) {
      window.showToast?.('Please sign in before requesting a stock quote.');
      return;
    }
    let symbol = String(rawSymbol || '').replace(/^\$/, '').trim().toUpperCase();
    if (!symbol) {
      symbol = await requestTextDialog({
        kicker: 'Bot Marketplace',
        title: 'Stock Price Tracker',
        description: 'Enter a ticker symbol and the bot will post the latest quote into this channel.',
        label: 'Ticker',
        placeholder: 'AAPL, TSLA, MSFT...',
        confirmText: 'Get Quote',
        maxLength: 16,
      });
      symbol = String(symbol || '').replace(/^\$/, '').trim().toUpperCase();
    }

    const symbols = extractStockSymbols(`/stock ${symbol}`, {}, { commandOnly: true });
    if (!symbols.length) {
      window.showToast?.('Enter a ticker like /stock AAPL.');
      return;
    }

    for (const nextSymbol of symbols) {
      if (currentChatUser()?.uid !== requestContext.requesterUid) {
        window.showToast?.('Stock request canceled because the active account changed.');
        return;
      }
      try {
        const quote = await fetchStockQuote(nextSymbol);
        await postBotMessage(requestContext.roomId, requestContext.channelId, 'Stock Price Bot', formatStockQuote(quote), {
          automationId: 'stockTracker',
          stockQuote: quote,
        }, { requesterUid: requestContext.requesterUid });
      } catch (error) {
        if (error?.code === BOT_REQUESTER_CHANGED_CODE || currentChatUser()?.uid !== requestContext.requesterUid) return;
        await postBotMessage(requestContext.roomId, requestContext.channelId, 'Stock Price Bot', `I couldn't fetch ${nextSymbol}: ${error.message}`, {
          automationId: 'stockTracker',
        }, { requesterUid: requestContext.requesterUid });
      }
    }
  }, [requestTextDialog]);

  const setAutoModerationEnabled = useCallback(async (enabled) => {
    const activeId = activeRoomRef.current.id;
    const activeChannelId = activeChannelRef.current;
    const requesterUid = currentChatUser()?.uid || '';
    if (!activeId || activeId === 'global') {
      window.showToast?.('Auto Moderation is configured per room, not Global Chat.');
      return;
    }
    if (!(await canUseRoomPermission(activeId, 'manageBots', 'App management is disabled in this room.'))) return;
    if (!requesterUid || currentChatUser()?.uid !== requesterUid) throw botRequesterChangedError();

    const currentConfig = botConfigRef.current?.autoModeration || normalizeRoomBotConfig().autoModeration;
    await set(ref(db, `rooms_meta/${activeId}/bots/autoModeration`), {
      enabled: Boolean(enabled),
      blockedWords: (currentConfig.blockedWords || []).join(', ') || 'spam, scam',
      blockLinks: currentConfig.blockLinks === true,
      blockCaps: currentConfig.blockCaps !== false,
      blockFlood: currentConfig.blockFlood !== false,
      updatedAt: Date.now(),
      updatedBy: requesterUid,
    });
    await set(ref(db, `rooms_meta/${activeId}/logs/${Date.now()}`), {
      text: `${window.userProfileName || 'Someone'} ${enabled ? 'enabled' : 'disabled'} the client-side basic message filter.`,
      timestamp: Date.now(),
    });
    await postBotMessage(activeId, activeChannelId, 'Basic Message Filter', enabled
      ? 'The client-side basic filter is on for supported clients. It checks configured keywords, flood text, excessive caps, and restricted links.'
      : 'The client-side basic filter is now off.', {
      automationId: 'autoModeration',
    }, { requesterUid });
    window.showToast?.(`Client-side basic filter ${enabled ? 'enabled' : 'disabled'}.`, false);
  }, []);

  const openFeedbackReport = useCallback(async () => {
    const report = await requestTextDialog({
      kicker: 'Issue report',
      title: 'Report a bug or UI problem',
      description: 'Tell us what broke, what you expected, and any steps to reproduce it. This queues a private issue draft for review.',
      label: 'Report',
      placeholder: 'Example:\nSummary: Global Chat says permission denied.\nSteps: Open Global Chat, type a message, press send.\nExpected: Message posts.\nActual: Permission denied toast.',
      confirmText: 'Submit Report',
      maxLength: 1800,
      multiline: true,
      rows: 9,
    });
    const summary = String(report || '').trim();
    if (!summary) return;

    try {
      const activeRoom = activeRoomRef.current || GLOBAL_ROOM;
      const result = await submitIssueDraft({
        title: summary.split(/\r?\n/).find(Boolean)?.slice(0, 120) || 'Minimalist issue report',
        summary,
        steps: '',
        expected: '',
        actual: '',
        roomId: activeRoom.id || 'global',
        url: window.location.href,
        clientMeta: [
          navigator.userAgent,
          `${window.innerWidth}x${window.innerHeight}`,
          activeChannelRef.current ? `channel:${activeChannelRef.current}` : '',
        ].filter(Boolean).join(' | '),
        userName: window.userProfileName || currentChatUser()?.displayName || '',
      });
      window.showToast?.(`Issue report queued${result?.issueId ? `: ${result.issueId}` : ''}.`, false);
    } catch (error) {
      window.showToast?.(`Issue report failed: ${error.message || error}`);
    }
  }, [requestTextDialog]);

  const canPostToCurrentRoom = useCallback(async (
    roomId = activeRoomRef.current.id,
    requestedChannelId = activeChannelRef.current,
  ) => {
    const activeId = roomId;
    const signedInUser = currentChatUser();
    if (!signedInUser?.uid) {
      window.showToast?.('Your sign-in is still loading. Please refresh or sign in again.');
      return false;
    }

    const [globalBanSnap, globalMuteSnap] = await Promise.all([
      get(ref(db, `users/${signedInUser.uid}/isBanned`)),
      get(ref(db, `users/${signedInUser.uid}/isMuted`)),
    ]);
    if (globalBanSnap.exists() && globalBanSnap.val() === true) {
      window.showToast?.('Your account is banned from posting. Contact support if you think this is a mistake.');
      return false;
    }
    if (globalMuteSnap.exists() && globalMuteSnap.val() === true) {
      window.showToast?.('You have been globally muted by an Admin.');
      return false;
    }

    if (activeId !== 'global') {
      const roomMuteRef = ref(db, `rooms_meta/${activeId}/muted/${signedInUser.uid}`);
      const roomMuteSnap = await get(roomMuteRef);
      if (roomMuteSnap.exists()) {
        const muteValue = roomMuteSnap.val();
        if (muteValue === true) {
          window.showToast?.('You are permanently muted in this room.');
          return false;
        }

        const timeLeft = Number(muteValue) - Date.now();
        if (timeLeft > 0) {
          window.showToast?.(`You are muted for ${Math.ceil(timeLeft / 60000)} more minutes.`);
          return false;
        }

        await remove(roomMuteRef);
      }

      if (!(await canUseRoomPermission(activeId, 'chat', 'Chat messages are disabled in this room.'))) return false;

      const channelId = requestedChannelId || 'general';
      if (channelId !== 'general') {
        const [channelSnapshot, creatorSnapshot, roleSnapshot, permissionSnapshot] = await Promise.all([
          get(ref(db, `rooms_meta/${activeId}/channels/${channelId}`)),
          get(ref(db, `rooms_meta/${activeId}/creatorId`)),
          get(ref(db, `rooms_meta/${activeId}/memberRoles/${signedInUser.uid}`)),
          get(ref(db, `rooms_meta/${activeId}/memberPermissions/${signedInUser.uid}`)),
        ]);
        const channel = normalizeChannel(channelId, channelSnapshot.val() || {});
        const memberPermissions = permissionSnapshot.val() || {};
        const assignedRole = String(roleSnapshot.val() || '');
        const effectiveRole = assignedRole || (
          memberPermissions.moderate === true || memberPermissions.manageChannels === true
            ? 'moderator'
            : ''
        );
        if (!canPostToChannel(channel, {
          uid: signedInUser.uid,
          creatorId: String(creatorSnapshot.val() || ''),
          role: effectiveRole,
        })) {
          window.showToast?.(`#${channel.name} only accepts posts from ${channel.postRole || 'room moderators'}.`);
          return false;
        }
      }
    }

    return true;
  }, []);

  const findPollMessage = useCallback((queryText = '') => {
    const clean = String(queryText || '').trim().replace(/^#?msg-?/i, '');
    const candidates = [...messagesRef.current].reverse().filter((message) => message.poll?.question);
    if (!clean) return candidates[0] || null;
    return candidates.find((message) => message.id === clean || String(message.id || '').startsWith(clean)) || null;
  }, []);

  const closePoll = useCallback(async (messageId) => {
    const uid = window.currentUser?.uid;
    if (!uid) return;
    const pollMessage = findPollMessage(messageId);
    if (!pollMessage) {
      window.showToast?.('No poll found in the loaded messages.');
      return;
    }
    if (pollMessage.uid !== uid) {
      window.showToast?.('Only the poll author can close this poll.');
      return;
    }
    if (isPollClosed(pollMessage.poll)) {
      window.showToast?.('This poll is already closed.', false);
      return;
    }

    const pollRoomId = activeRoomRef.current.id;
    const pollChannelId = activeChannelRef.current;
    try {
      await set(roomMessageChildRef(pollRoomId, pollMessage.id, 'poll/closed', pollChannelId), true);
      await set(roomMessageChildRef(pollRoomId, pollMessage.id, 'poll/closedAt', pollChannelId), Date.now());
      await postRoomActivitySeparator(pollRoomId, pollChannelId, {
        type: 'poll_closed',
        label: 'Poll closed',
        detail: pollMessage.poll?.question || '',
      }).catch((error) => console.warn('[chat] poll activity separator failed', {
        roomId: pollRoomId,
        messageId: pollMessage.id,
        errorCode: error?.code || 'unknown',
      }));
      window.showToast?.('Poll closed.', false);
    } catch (error) {
      window.showToast?.(`Could not close poll: ${error.message || error}`);
    }
  }, [findPollMessage, postRoomActivitySeparator]);

  const showPollResults = useCallback((messageId = '') => {
    const pollMessage = findPollMessage(messageId);
    if (!pollMessage) {
      window.showToast?.('No poll found in the loaded messages.');
      return;
    }
    window.showToast?.(pollResultsText(pollMessage), false);
  }, [findPollMessage]);

  const reportMessage = useCallback(async (message) => {
    if (!message?.id) return;
    const categoryInput = await requestTextDialog({
      kicker: 'Safety',
      title: 'Report message',
      description: 'Reports are private and preserve the message evidence for room moderators.',
      label: 'Category',
      defaultValue: 'other',
      suggestions: ['spam', 'harassment', 'threats', 'hate', 'privacy', 'impersonation', 'other'],
      confirmText: 'Continue',
      maxLength: 32,
    });
    if (!categoryInput) return;
    const reason = await requestTextDialog({
      kicker: 'Report details',
      title: 'What should moderators know?',
      description: 'Describe the issue without adding sensitive information.',
      label: 'Reason',
      multiline: true,
      rows: 5,
      placeholder: 'Why this message should be reviewed…',
      confirmText: 'Submit Report',
      maxLength: 800,
    });
    if (!reason) return;

    try {
      const roomId = activeRoomRef.current.id;
      if (roomId === 'global') {
        await submitIssueDraft({
          title: `Global message report: ${message.id}`,
          summary: `${String(categoryInput).trim().toLowerCase()}: ${reason}`,
          steps: `Review Global Chat message ${message.id}.`,
          expected: 'Global Chat follows the platform safety rules.',
          actual: 'A signed-in member requested a private safety review.',
          roomId,
          url: window.location.href,
          clientMeta: `channel:${activeChannelRef.current || 'general'} | message:${message.id}`,
          userName: window.userProfileName || currentChatUser()?.displayName || '',
        });
        window.showToast?.('Report sent privately for platform review.', false);
        return;
      }
      const idempotencyKey = globalThis.crypto?.randomUUID?.()
        || `${currentChatUser()?.uid || 'user'}_${message.id}_${Date.now()}`;
      await postAuthedJson(ROOM_MODERATION_ENDPOINT(), {
        action: 'report-create',
        roomId,
        idempotencyKey,
        category: String(categoryInput).trim().toLowerCase(),
        reason,
        subject: {
          type: 'message',
          messageId: message.id,
          channelId: activeChannelRef.current || 'general',
        },
      }, 'Please sign in before reporting a message.');
      window.showToast?.('Report sent privately to room moderators.', false);
    } catch (error) {
      window.showToast?.(`Report failed: ${error.message || error}`);
    }
  }, [requestTextDialog]);

  const translateMessage = useCallback(async (message) => {
    if (!message?.id || !message.text) return;
    if (translatedMessages[message.id]) {
      setTranslatedMessages((current) => {
        const next = { ...current };
        delete next[message.id];
        return next;
      });
      return;
    }
    if (translationPendingIds.has(message.id)) return;
    setTranslationPendingIds((current) => new Set(current).add(message.id));
    try {
      const data = await postAuthedJson(TRANSLATE_MESSAGE_ENDPOINT(), {
        roomId: activeRoomRef.current.id,
        channelId: activeChannelRef.current || 'general',
        messageId: message.id,
        targetLanguage: getLocale(),
      }, 'Please sign in before translating a message.');
      setTranslatedMessages((current) => ({
        ...current,
        [message.id]: {
          text: String(data.translation?.text || data.text || ''),
          sourceLanguage: data.translation?.sourceLanguage || data.sourceLanguage || '',
          targetLanguage: data.translation?.targetLanguage || data.targetLanguage || getLocale(),
        },
      }));
    } catch (error) {
      window.showToast?.(`Translation failed: ${error.message || error}`);
    } finally {
      setTranslationPendingIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  }, [translatedMessages, translationPendingIds]);

  const runSlashCommand = useCallback(async (commandInput, argsOverride = '') => {
    const resolved = typeof commandInput === 'string'
      ? findSlashCommand(commandInput)
      : { ...commandInput, args: argsOverride };

    if (!resolved) {
      window.showToast?.('Unknown command. Try /help.');
      clearComposerDraft();
      return true;
    }

    const args = String(resolved.args || '').trim();
    const activeId = activeRoomRef.current.id;
    const notifyKey = `minimalist:notify:${activeId}`;

    clearComposerDraft();
    setCommandListOpen(false);

    try {
      switch (resolved.action) {
        case 'linkPreview': {
          const input = args || await requestTextDialog({
            kicker: 'Safe link preview',
            title: 'Preview a link',
            description: 'Paste an HTTPS link. Minimalist fetches only public web pages through its protected preview service.',
            label: 'Link',
            placeholder: 'https://example.com/article',
            confirmText: 'Preview',
            maxLength: 2048,
          });
          const url = extractFirstPreviewUrl(input);
          if (!url) {
            window.showToast?.('Enter a valid HTTPS link.');
            break;
          }
          if (!(await canPostToCurrentRoom())) break;
          const profile = getProfileSnapshot();
          if (!profile.uid) throw new Error('Please sign in before previewing a link.');
          const preview = await fetchLinkPreview(url);
          const roomId = activeRoomRef.current.id;
          const channelId = activeChannelRef.current;
          await setWithAuthRetry(push(roomMessagesRef(roomId, channelId)), {
            uid: profile.uid,
            name: profile.name,
            photoUrl: profile.photoUrl,
            text: url,
            linkPreview: preview,
            timestamp: serverTimestamp(),
            tier: profile.tier,
          });
          if (roomId !== 'global') {
            const summary = `${profile.name}: ${preview.title}`;
            await set(ref(db, `rooms_meta/${roomId}/lastMessage`), summary.length > 30 ? `${summary.slice(0, 30)}...` : summary);
          }
          void playUiSound('message-sent');
          break;
        }
        case 'commands':
        case 'quick':
          setCommandListOpen(true);
          break;
        case 'search':
          focusSearch();
          break;
        case 'settings':
          window.openSettings?.();
          break;
        case 'notifySchedule':
          await window.openSettings?.();
          await window.ensureNotificationRuntime?.();
          if (typeof window.switchTab === 'function') window.switchTab('pane-notifications', 'tab-btn-notifications');
          else document.getElementById('tab-btn-notifications')?.click();
          window.renderNotificationSettings?.();
          focusNotificationScheduleControl();
          window.showToast?.('Opened notification schedule settings.', false);
          break;
        case 'shortcuts':
          window.showToast?.('Shortcuts: / opens commands · Enter sends · Shift+Enter new line · Esc closes command menu.', false);
          break;
        case 'feedback':
          await openFeedbackReport();
          break;
        case 'attach':
          fileInputRef.current?.click();
          break;
        case 'poll':
          await createPollHandlerRef.current?.();
          break;
        case 'pollClose':
          await closePoll(args);
          break;
        case 'pollResults':
          showPollResults(args);
          break;
        case 'tasks':
          openRoomTab('tasks');
          setTimeout(() => document.getElementById('task-input')?.focus(), 80);
          break;
        case 'taskCreate':
          await createTaskFromText(args);
          break;
        case 'capture':
        case 'captureTask': {
          const latest = [...messagesRef.current].reverse().find((message) => message.text);
          if (!latest) window.showToast?.('No recent message to capture.');
          else await createTaskFromText(latest.text);
          break;
        }
        case 'ai':
        case 'summaryRoom':
          if (!openRoomTab('ai')) window.openPersonalAgent?.();
          if (resolved.action === 'summaryRoom') window.showToast?.('AI opened — choose Summarize to generate the room summary.', false);
          break;
        case 'activity':
          openActivityPanel();
          break;
        case 'leaderboard':
          openActivityPanel('leaderboard');
          break;
        case 'recognition':
          openActivityPanel('recognition');
          break;
        case 'communityAward': {
          const targetRef = args.replace(/^@+/, '') || await requestTextDialog({
            kicker: 'Recognition',
            title: 'Give community award',
            description: 'Enter a username, display name, short ID, or uid.',
            label: 'Member',
            placeholder: '@wayne',
            confirmText: 'Award',
            maxLength: 48,
          });
          if (!targetRef?.trim()) break;
          const result = await window.giveCommunityAward?.(targetRef.trim(), 'community_award');
          if (result?.ok) {
            window.showToast?.('Community award sent.', false);
          } else {
            window.showToast?.(result?.reason === 'not-found' ? 'Could not find that member.' : 'Could not send award.');
          }
          break;
        }
        case 'bookmarks':
          window.openBookmarks?.();
          break;
        case 'invite':
          document.getElementById('room-drop-invite')?.click();
          break;
        case 'audit':
          document.getElementById('room-drop-settings')?.click();
          setTimeout(() => document.getElementById('rs-tab-logs')?.click(), 120);
          break;
        case 'stock':
          await postStockQuote(args);
          break;
        case 'automodOn':
          await setAutoModerationEnabled(true);
          break;
        case 'automodOff':
          await setAutoModerationEnabled(false);
          break;
        case 'home':
          openRoomTab('home');
          break;
        case 'messageMenu':
        case 'quote':
          window.showToast?.('Tip: hover a message and use its action buttons for edit, delete, quote, react, forward, bookmark, flag, and impact.', false);
          break;
        case 'unread':
          jumpToFirstUnread();
          break;
        case 'schedule':
          setScheduleDialogOpen(true);
          break;
        case 'threads':
          setThreadDrawerOpen(true);
          break;
        case 'translateHelp':
          window.showToast?.('Hover a message and choose Translate in its action bar.', false);
          break;
        case 'notifyAll':
          localStorage.setItem(notifyKey, 'all');
          window.refreshNotificationPreferences?.();
          window.showToast?.('All notifications enabled for this room.', false);
          break;
        case 'notifyMentions':
          localStorage.setItem(notifyKey, 'mentions');
          window.refreshNotificationPreferences?.();
          window.showToast?.('Mentions-only notifications enabled.', false);
          break;
        case 'notifyMute':
          localStorage.setItem(notifyKey, 'muted');
          window.refreshNotificationPreferences?.();
          window.showToast?.('Current room muted on this device.', false);
          break;
        case 'notifyDigest':
          localStorage.setItem(notifyKey, 'digest');
          window.refreshNotificationPreferences?.();
          window.showToast?.('Digest notifications enabled on this device.', false);
          break;
        case 'notifyKeywordAdd': {
          const keyword = args || await requestTextDialog({
            kicker: 'Notifications',
            title: 'Add keyword alert',
            description: 'Get alerted when this word or phrase appears in the current room.',
            label: 'Keyword',
            placeholder: 'launch, urgent, your-name...',
            confirmText: 'Add Keyword',
            maxLength: 48,
          });
          if (!keyword?.trim()) break;
          const key = `minimalist:notify-keywords:${activeId}`;
          const list = JSON.parse(localStorage.getItem(key) || '[]');
          const next = [...new Set([...list, keyword.trim().toLowerCase()])];
          localStorage.setItem(key, JSON.stringify(next));
          window.refreshNotificationPreferences?.();
          window.showToast?.(`Keyword alert added: ${keyword.trim()}`, false);
          break;
        }
        case 'notifyKeywordRemove': {
          const keyword = args || await requestTextDialog({
            kicker: 'Notifications',
            title: 'Remove keyword alert',
            description: 'Remove a keyword alert from the current room.',
            label: 'Keyword',
            placeholder: 'launch, urgent, your-name...',
            confirmText: 'Remove Keyword',
            maxLength: 48,
          });
          if (!keyword?.trim()) break;
          const key = `minimalist:notify-keywords:${activeId}`;
          const list = JSON.parse(localStorage.getItem(key) || '[]');
          localStorage.setItem(key, JSON.stringify(list.filter((item) => item !== keyword.trim().toLowerCase())));
          window.refreshNotificationPreferences?.();
          window.showToast?.(`Keyword alert removed: ${keyword.trim()}`, false);
          break;
        }
        case 'dndOn':
          localStorage.setItem('minimalist:dnd', 'on');
          window.refreshNotificationPreferences?.();
          window.showToast?.('Do Not Disturb is on for this device.', false);
          break;
        case 'dndOff':
          localStorage.removeItem('minimalist:dnd');
          window.refreshNotificationPreferences?.();
          window.showToast?.('Do Not Disturb is off.', false);
          break;
        case 'roomFavorite':
        case 'roomUnfavorite': {
          await setRoomFavorite(activeId, resolved.action === 'roomFavorite');
          break;
        }
        case 'moderation':
          document.getElementById('room-drop-settings')?.click();
          window.showToast?.('Open a user profile or context menu to moderate a specific member.', false);
          break;
        case 'report':
          {
            const latestReportable = [...messagesRef.current].reverse().find((message) => message.uid !== currentChatUser()?.uid);
            if (latestReportable) await reportMessage(latestReportable);
            else window.showToast?.('No reportable message is loaded.');
          }
          break;
        case 'comingSoon':
        default:
          window.showToast?.(`${resolved.command} is in the command list. The full workflow is coming next.`, false);
      }
    } catch (error) {
      window.showToast?.(`Command failed: ${error.message}`);
    }

    return true;
  }, [canPostToCurrentRoom, clearComposerDraft, closePoll, createTaskFromText, focusSearch, jumpToFirstUnread, openActivityPanel, openFeedbackReport, postStockQuote, reportMessage, requestTextDialog, setAutoModerationEnabled, setRoomFavorite, showPollResults]);

  const insertMention = useCallback((candidate) => {
    const textarea = textareaRef.current;
    const position = textarea?.selectionStart ?? cursorIndex ?? draft.length;
    const token = getMentionToken(draft, position);
    const handle = candidateMentionHandle(candidate);
    if (!token || !handle) return;

    const mentionText = `@${handle} `;
    const nextDraft = `${draft.slice(0, token.start)}${mentionText}${draft.slice(token.end)}`;
    const nextCursor = token.start + mentionText.length;

    setDraft(nextDraft);
    setCursorIndex(nextCursor);
    setDismissedMentionKey('');
    writeComposerDraft(activeRoomRef.current.id, activeChannelRef.current, nextDraft);
    setTyping(nextDraft.trim().length > 0);

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.selectionStart = nextCursor;
        textareaRef.current.selectionEnd = nextCursor;
      }
    });
  }, [cursorIndex, draft, setTyping]);

  const handleTextareaKeyDown = useCallback((event) => {
    const isComposing = event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229;

    if (mentionMenuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionSelectedIndex((index) => Math.min(index + 1, Math.max(0, mentionSuggestions.length - 1)));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionSelectedIndex((index) => Math.max(index - 1, 0));
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedMentionKey(mentionKey);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey && !isComposing && mentionSuggestions[mentionSelectedIndex]) {
        event.preventDefault();
        insertMention(mentionSuggestions[mentionSelectedIndex]);
        return;
      }
    }

    if (slashMenuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashSelectedIndex((index) => Math.min(index + 1, Math.max(0, slashCommands.length - 1)));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashSelectedIndex((index) => Math.max(index - 1, 0));
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        clearComposerDraft();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey && !isComposing && slashCommands[slashSelectedIndex]) {
        event.preventDefault();
        runSlashCommand(slashCommands[slashSelectedIndex]);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }, [
    clearComposerDraft,
    insertMention,
    mentionKey,
    mentionMenuOpen,
    mentionSelectedIndex,
    mentionSuggestions,
    runSlashCommand,
    slashCommands,
    slashMenuOpen,
    slashSelectedIndex,
  ]);

  const insertCodeSnippet = useCallback((mode) => {
    const textarea = textareaRef.current;
    if (!textarea || composerDisabled || isSendingRef.current) return;

    const start = textarea.selectionStart ?? draft.length;
    const end = textarea.selectionEnd ?? start;
    const selected = draft.slice(start, end);
    const before = draft.slice(0, start);
    const after = draft.slice(end);

    let insertText = '';
    let selectStart = start;
    let selectEnd = start;

    if (mode === 'block') {
      const content = selected || 'code';
      const prefix = before && !before.endsWith('\n') ? '\n' : '';
      const suffix = after && !after.startsWith('\n') ? '\n' : '';
      insertText = `${prefix}\`\`\`\n${content}\n\`\`\`${suffix}`;
      selectStart = start + prefix.length + 4;
      selectEnd = selectStart + content.length;
    } else {
      const content = selected || 'code';
      insertText = `\`${content}\``;
      selectStart = start + 1;
      selectEnd = selectStart + content.length;
    }

    const nextDraft = `${before}${insertText}${after}`;
    setDraft(nextDraft);
    writeComposerDraft(activeRoomRef.current.id, activeChannelRef.current, nextDraft);
    setTyping(nextDraft.trim().length > 0);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = selectStart;
      textarea.selectionEnd = selectEnd;
    });
  }, [composerDisabled, draft, setTyping]);

  const handleFileChange = useCallback(() => {
    const file = fileInputRef.current?.files?.[0] || null;
    setFileSelected(Boolean(file));
    setSelectedFile(file);
  }, []);

  const clearSelectedFile = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFileSelected(false);
    setSelectedFile(null);
  }, []);

  useEffect(() => {
    const zone = document.getElementById('main-chat-area');
    if (!zone) return undefined;

    let dragDepth = 0;
    const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');

    const handleDragEnter = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      zone.classList.add('drag-over');
    };

    const handleDragOver = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };

    const handleDragLeave = () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) zone.classList.remove('drag-over');
    };

    const handleDrop = (event) => {
      dragDepth = 0;
      zone.classList.remove('drag-over');

      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();

      if (fileInputRef.current) {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInputRef.current.files = transfer.files;
        setFileSelected(true);
        setSelectedFile(file);
      }

      window.showToast?.(`${file.name} attached — press send.`, false);
    };

    zone.addEventListener('dragenter', handleDragEnter);
    zone.addEventListener('dragover', handleDragOver);
    zone.addEventListener('dragleave', handleDragLeave);
    zone.addEventListener('drop', handleDrop);

    return () => {
      zone.removeEventListener('dragenter', handleDragEnter);
      zone.removeEventListener('dragover', handleDragOver);
      zone.removeEventListener('dragleave', handleDragLeave);
      zone.removeEventListener('drop', handleDrop);
      zone.classList.remove('drag-over');
    };
  }, []);

  const updateMessageDelivery = useCallback((deliveryId, patch) => {
    setMessageDeliveries((current) => {
      const existing = current.find((delivery) => delivery.id === deliveryId);
      if (!existing) return current;
      const next = current.map((delivery) => (
        delivery.id === deliveryId ? { ...delivery, ...patch } : delivery
      ));
      return next.slice(-40);
    });
  }, []);

  const executeMessageDelivery = useCallback(async (deliveryId) => {
    const attempt = deliveryAttemptsRef.current.get(deliveryId);
    if (!attempt) {
      updateMessageDelivery(deliveryId, {
        state: 'failed',
        error: 'Retry data is no longer available. Copy the message and send it again.',
      });
      return;
    }
    if (isSendingRef.current) {
      window.showToast?.('Another message is still sending. Retry in a moment.', false);
      return;
    }

    const {
      roomId: activeId,
      channelId: submitChannelId,
      scopeKey: submitScopeKey,
      requesterUid,
      text,
      previewUrl,
      file,
      profile,
    } = attempt;
    isSendingRef.current = true;
    setIsSending(true);
    updateMessageDelivery(deliveryId, { state: 'sending', error: '', progress: 0 });

    let deliveryRuntime;
    try {
      deliveryRuntime = await import('./messageDeliveryRuntime.js');
      const botConfig = await deliveryRuntime.preflightMessageDelivery({
        canPost: () => canPostToCurrentRoom(activeId, submitChannelId),
        getCurrentUid: () => currentChatUser()?.uid,
        requesterUid,
        waitForBotConfig: () => waitForRoomBotConfig(activeId, requesterUid),
      });

      const autoModReason = activeId !== 'global' ? detectAutoModeration(text, botConfig.autoModeration) : null;
      if (autoModReason) {
        await postBotMessage(activeId, submitChannelId, 'Basic Message Filter', `${profile.name || 'Someone'} had a message blocked in this app: ${autoModReason}.`, {
          automationId: 'autoModeration',
          moderationEvent: true,
        }, { requesterUid });
        const moderationError = new Error(`Basic filter: ${autoModReason}`);
        moderationError.code = 'moderation_blocked';
        throw moderationError;
      }

      const newMessageRef = roomMessageRef(activeId, deliveryId, submitChannelId);
      attempt.onUploadProgress = ({ progress }) => {
        updateMessageDelivery(deliveryId, { progress });
      };
      await deliveryRuntime.deliverMessageAttempt(attempt, {
        ensureFilePermission: () => canUseRoomPermission(activeId, 'files', 'File uploads are disabled in this room.'),
        writeMessage: async (payload) => {
          if (activeId === 'global') {
            await setWithAuthRetry(newMessageRef, payload);
            return;
          }
          await postAuthedJson(ROOM_MODERATION_ENDPOINT(), {
            action: 'message-send',
            roomId: activeId,
            channelId: submitChannelId || 'general',
            messageId: deliveryId,
            message: payload,
          }, 'Please sign in before sending a room message.');
        },
      });
      updateMessageDelivery(deliveryId, { state: 'sent', error: '', progress: 100 });
      clearComposerDraftStorageIfMatches(activeId, submitChannelId, text);
      void playUiSound('message-sent');

      if (attempt.localImageUrl) URL.revokeObjectURL(attempt.localImageUrl);
      deliveryAttemptsRef.current.delete(deliveryId);
      void removeOutboxAttempt(deliveryId).catch(() => {});

      if (previewUrl) {
        void fetchLinkPreview(previewUrl)
          .then((linkPreview) => set(roomMessageChildRef(activeId, deliveryId, 'linkPreview', submitChannelId), linkPreview))
          .catch((error) => console.warn('[chat] safe link preview unavailable', {
            roomId: activeId,
            channelId: submitChannelId || 'general',
            errorCode: error?.code || 'preview_failed',
          }));
      }

      const trackedStockSymbols = activeId !== 'global' && botConfig.stockTracker.enabled
        ? extractStockSymbols(text, botConfig.stockTracker)
        : [];
      if (trackedStockSymbols.length) {
        void Promise.all(trackedStockSymbols.map(async (symbol) => {
          try {
            const quote = await fetchStockQuote(symbol);
            await postBotMessage(activeId, submitChannelId, 'Stock Price Bot', formatStockQuote(quote), {
              automationId: 'stockTracker',
              stockQuote: quote,
            }, { requesterUid });
          } catch (error) {
            if (error?.code === BOT_REQUESTER_CHANGED_CODE || currentChatUser()?.uid !== requesterUid) return;
            await postBotMessage(activeId, submitChannelId, 'Stock Price Bot', `I couldn't fetch ${symbol}: ${error.message}`, {
              automationId: 'stockTracker',
            }, { requesterUid });
          }
        })).catch((error) => console.warn('Stock bot failed', error));
      }

      if (text) {
        try {
          window.notifyMentions?.(text, activeId, {
            groupId: activeId,
            roomId: activeId,
            roomName: attempt.roomName,
            shortId: attempt.roomShortId,
            channelId: submitChannelId,
            messageId: deliveryId,
          });
        } catch (error) {
          console.warn('[chat] mention notification failed after send', error);
        }
      }
      if (attempt.reply?.uid && attempt.reply.uid !== requesterUid) {
        void postAuthedJson(CREATE_NOTIFICATION_ENDPOINT(), {
          targetUid: attempt.reply.uid,
          type: 'reply',
          text: `${profile.name || 'Someone'} replied to your message`,
          from: profile.name,
          action: 'open-message',
          roomId: activeId,
          roomName: attempt.roomName,
          shortId: attempt.roomShortId,
          channelId: submitChannelId,
          messageId: deliveryId,
          groupId: `${activeId}:${attempt.reply.threadRootId || attempt.reply.id}`,
        }).catch((error) => console.warn('[chat] reply notification failed after send', {
          roomId: activeId,
          errorCode: error?.code || 'unknown',
        }));
      }
      if (attempt.reply?.threadRootId) {
        void toggleThreadFollow(attempt.reply.threadRootId, true, activeId, submitChannelId).catch(() => {});
      }
      try {
        window.bumpMessageCount?.(requesterUid);
        window.awardXP?.(requesterUid, 'technical', 2);
        window.trackQuest?.('message');
      } catch (error) {
        console.warn('[chat] gamification update failed after send', error);
      }

      if (activeId !== 'global') {
        const preview = text ? `${profile.name}: ${text}` : `${profile.name} sent ${file?.type?.startsWith('image/') ? 'an image' : 'a file'}`;
        set(ref(db, `rooms_meta/${activeId}/lastMessage`), preview.length > 30 ? `${preview.substring(0, 30)}...` : preview)
          .catch((error) => console.warn('[chat] last message preview update failed after send', {
            roomId: activeId,
            errorCode: error?.code || 'unknown',
          }));
      }

      if (activeMessageScopeRef.current === submitScopeKey) scrollMessagesToLatest(2, { settle: true });
    } catch (error) {
      void playUiSound('error');
      const errorMessage = deliveryRuntime?.deliveryErrorMessage(error, activeId) || error.message;
      updateMessageDelivery(deliveryId, {
        state: 'failed',
        error: errorMessage,
        progress: 0,
      });
      // Diagnostics only — never log message text, tokens, or PII.
      console.warn('[chat] message delivery failed', {
        roomId: activeId,
        errorCode: error?.code || 'unknown',
      });
      window.showToast?.(`${errorMessage} Use Retry on the message.`);
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  }, [canPostToCurrentRoom, scrollMessagesToLatest, toggleThreadFollow, updateMessageDelivery, waitForRoomBotConfig]);

  const retryMessageDelivery = useCallback((deliveryId) => {
    void executeMessageDelivery(deliveryId);
  }, [executeMessageDelivery]);

  const cancelMessageDelivery = useCallback((deliveryId) => {
    const attempt = deliveryAttemptsRef.current.get(deliveryId);
    if (typeof attempt?.cancelUpload === 'function') {
      attempt.cancelUpload();
      return;
    }
    updateMessageDelivery(deliveryId, {
      state: 'failed',
      error: 'Upload cancelled. Retry when ready.',
      progress: 0,
    });
  }, [updateMessageDelivery]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    const shouldHydrate = outboxHydratedUidRef.current !== user.uid;
    if (shouldHydrate) outboxHydratedUidRef.current = user.uid;
    let disposed = false;

    const retryStoredAttempts = async () => {
      const attemptIds = [...deliveryAttemptsRef.current.values()]
        .filter((attempt) => attempt.requesterUid === user.uid)
        .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0))
        .map((attempt) => attempt.id);
      for (const deliveryId of attemptIds) {
        if (disposed || navigator.onLine === false) break;
        await executeMessageDelivery(deliveryId);
      }
    };

    if (shouldHydrate) {
      loadOutboxAttempts(user.uid).then((records) => {
        if (disposed || !records.length) return;
        const deliveries = records.map((record) => {
          const localImageUrl = record.file?.type?.startsWith('image/')
            ? URL.createObjectURL(record.file)
            : '';
          const optimisticMessage = {
            ...(record.optimisticMessage || {}),
            id: record.id,
            attachedImage: localImageUrl || record.optimisticMessage?.attachedImage || null,
          };
          const attempt = {
            ...record,
            localImageUrl,
            optimisticMessage,
            readTextPreview,
          };
          deliveryAttemptsRef.current.set(record.id, attempt);
          return {
            id: record.id,
            scopeKey: record.scopeKey,
            state: 'failed',
            error: 'Saved in your outbox. Reconnect or choose Retry.',
            progress: 0,
            message: optimisticMessage,
          };
        });
        setMessageDeliveries((current) => {
          const restoredIds = new Set(deliveries.map((delivery) => delivery.id));
          return [...current.filter((delivery) => !restoredIds.has(delivery.id)), ...deliveries].slice(-40);
        });
        if (navigator.onLine !== false) void retryStoredAttempts();
      }).catch((error) => console.warn('[chat] could not restore local outbox', {
        errorCode: error?.name || 'indexeddb_unavailable',
      }));
    }

    const handleOnline = () => {
      void retryStoredAttempts();
    };
    window.addEventListener('online', handleOnline);
    return () => {
      disposed = true;
      window.removeEventListener('online', handleOnline);
    };
  }, [executeMessageDelivery, user?.uid]);

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault();
    const signedInUser = currentChatUser();
    if (!signedInUser?.uid) {
      window.showToast?.('Your sign-in is still loading. Please refresh or sign in again.');
      return;
    }
    if (isSendingRef.current) return;

    const activeId = activeRoomRef.current.id;
    const submitChannelId = activeChannelRef.current;
    const submitScopeKey = messageScopeKey(activeId, submitChannelId);
    const text = draft.trim();
    const file = fileInputRef.current?.files?.[0] || null;
    if (!text && !file) return;
    if (text.startsWith('/') && !file) {
      const slashCommand = findSlashCommand(text);
      if (slashCommand) {
        await runSlashCommand(slashCommand, slashCommand.args);
        return;
      }
      window.showToast?.('Unknown command. Try /help.');
      clearComposerDraft();
      return;
    }

    const profile = getProfileSnapshot();
    const deliveryRef = push(roomMessagesRef(activeId, submitChannelId));
    const deliveryId = deliveryRef.key;
    if (!deliveryId) {
      window.showToast?.('Could not prepare this message. Please try again.');
      return;
    }

    const createdAt = Date.now();
    const localImageUrl = file?.type?.startsWith('image/') ? URL.createObjectURL(file) : '';
    const optimisticMessage = {
      id: deliveryId,
      uid: profile.uid,
      name: profile.name,
      photoUrl: profile.photoUrl,
      text,
      attachedImage: localImageUrl || null,
      attachedFile: file && !localImageUrl ? {
        url: '',
        name: file.name,
        type: file.type || 'File',
        size: file.size,
      } : null,
      timestamp: createdAt,
      tier: profile.tier,
      ...(reply ? { replyTo: { ...reply, roomId: activeId, channelId: submitChannelId } } : {}),
    };
    const attempt = {
      id: deliveryId,
      roomId: activeId,
      roomName: activeRoomRef.current.name,
      roomShortId: activeRoomRef.current.shortId,
      channelId: submitChannelId,
      scopeKey: submitScopeKey,
      requesterUid: signedInUser.uid,
      text,
      previewUrl: extractFirstPreviewUrl(text),
      file,
      reply,
      profile,
      roomEntitlement,
      readTextPreview,
      createdAt,
      localImageUrl,
      optimisticMessage,
    };
    deliveryAttemptsRef.current.set(deliveryId, attempt);
    await saveOutboxAttempt(attempt).catch((error) => {
      console.warn('[chat] local outbox persistence unavailable', {
        errorCode: error?.name || 'indexeddb_unavailable',
      });
    });
    setMessageDeliveries((current) => [...current.filter((delivery) => delivery.id !== deliveryId), {
      id: deliveryId,
      scopeKey: submitScopeKey,
      state: 'sending',
      error: '',
      message: optimisticMessage,
    }].slice(-40));

    shouldStickToBottomRef.current = true;
    forceScrollToLatestRef.current = true;
    setDraft('');
    setQuickReplyStatus('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFileSelected(false);
    setSelectedFile(null);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    setTyping(false);
    cancelReply();
    scrollMessagesToLatest(3, { settle: true, delays: [40, 120, 260, 520, 900] });

    await executeMessageDelivery(deliveryId);
  }, [cancelReply, clearComposerDraft, draft, executeMessageDelivery, reply, roomEntitlement, runSlashCommand, scrollMessagesToLatest, setTyping]);

  const sendSpecialMessage = useCallback(async (extraPayload, previewText) => {
    const signedInUser = currentChatUser();
    if (!signedInUser?.uid || isSendingRef.current) {
      if (!signedInUser?.uid) window.showToast?.('Your sign-in is still loading. Please refresh or sign in again.');
      return;
    }
    isSendingRef.current = true;
    setIsSending(true);

    try {
      if (!(await canPostToCurrentRoom())) return;
      const activeId = activeRoomRef.current.id;
      const profile = getProfileSnapshot();
      await setWithAuthRetry(push(roomMessagesRef(activeId, activeChannelRef.current)), {
        uid: profile.uid,
        name: profile.name,
        photoUrl: profile.photoUrl,
        text: '',
        timestamp: serverTimestamp(),
        tier: profile.tier,
        ...extraPayload,
      });
      void playUiSound('message-sent');

      if (activeId !== 'global') {
        const preview = `${profile.name}: ${previewText}`;
        await set(ref(db, `rooms_meta/${activeId}/lastMessage`), preview.length > 30 ? `${preview.substring(0, 30)}...` : preview);
      }

      window.bumpMessageCount?.(window.currentUser.uid);
      window.awardXP?.(window.currentUser.uid, 'leadership', 4);
    } catch (error) {
      void playUiSound('error');
      window.showToast?.(isPermissionDeniedError(error)
        ? 'You do not have permission to post here right now. Try refreshing or rejoining the room.'
        : `Could not send: ${error.message}`);
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  }, [canPostToCurrentRoom]);

  const scheduleMessage = useCallback(async ({ text, deliverAt }) => {
    const signedInUser = currentChatUser();
    if (!signedInUser?.uid) return;
    setScheduleSubmitting(true);
    try {
      const roomId = activeRoomRef.current.id;
      const channelId = activeChannelRef.current || 'general';
      if (!(await canPostToCurrentRoom(roomId, channelId))) return;
      const scheduled = sanitizeScheduledMessage({
        text,
        deliverAt,
        roomId,
        channelId,
      });
      await postAuthedJson(ROOM_SCHEDULING_ENDPOINT(), {
        action: 'create',
        idempotencyKey: globalThis.crypto?.randomUUID?.() || `${signedInUser.uid}_${Date.now()}`,
        message: scheduled,
      }, 'Please sign in before scheduling a message.');
      if (draft.trim() === scheduled.text) clearComposerDraft();
      setScheduleDialogOpen(false);
      window.showToast?.(`Message scheduled for ${new Date(scheduled.deliverAt).toLocaleString()}.`, false);
    } catch (error) {
      window.showToast?.(`Could not schedule message: ${error.message || error}`);
    } finally {
      setScheduleSubmitting(false);
    }
  }, [canPostToCurrentRoom, clearComposerDraft, draft]);

  const cancelScheduledMessage = useCallback(async (messageId) => {
    const uid = currentChatUser()?.uid;
    if (!uid || !messageId) return;
    try {
      await postAuthedJson(ROOM_SCHEDULING_ENDPOINT(), {
        action: 'cancel',
        scheduleId: messageId,
      }, 'Please sign in before cancelling a scheduled message.');
      window.showToast?.('Scheduled message cancelled.', false);
    } catch (error) {
      window.showToast?.(`Could not cancel scheduled message: ${error.message || error}`);
    }
  }, []);

  const createPoll = useCallback(async () => {
    if (!(await canUseRoomPermission(activeRoomRef.current.id, 'polls', 'Polls are disabled in this room.'))) return;
    setComposerDialogMode('poll');
  }, []);
  useEffect(() => {
    createPollHandlerRef.current = createPoll;
    return () => {
      createPollHandlerRef.current = null;
    };
  }, [createPoll]);

  const submitPollDialog = useCallback(async (draftPoll) => {
    try {
      const poll = createPollPayload(draftPoll);
      await sendSpecialMessage({ poll }, `Poll: ${poll.question}`);
      setComposerDialogMode(null);
      window.showToast?.('Poll posted.', false);
    } catch (error) {
      window.showToast?.(error.message || 'Check the poll details.');
    }
  }, [sendSpecialMessage]);

  const saveReminder = useCallback(async (reminder) => {
    if (!window.currentUser?.uid || !reminder?.text || !reminder?.dueAt) return;
    await set(push(ref(db, `user_reminders/${window.currentUser.uid}`)), {
      text: reminder.text,
      dueAt: reminder.dueAt,
      roomId: activeRoomRef.current.id,
      createdAt: Date.now(),
      source: reminder.source || 'chat',
    });
    window.showToast?.(`Reminder saved for ${formatDueDate(reminder.dueAt)}.`, false);
  }, []);

  const createReminder = useCallback(async () => {
    if (!(await canUseRoomPermission(activeRoomRef.current.id, 'reminders', 'Reminders are disabled in this room.'))) return;
    setComposerDialogMode('reminder');
  }, []);

  const submitReminderDialog = useCallback(async ({ text, dueAtValue }) => {
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      window.showToast?.('Add reminder text first.');
      return;
    }

    const dueAt = parseReminderInput(dueAtValue);
    if (!dueAt || dueAt <= Date.now()) {
      window.showToast?.('Choose a future reminder time.');
      return;
    }

    const reminder = {
      text: cleanText.slice(0, 180),
      dueAt,
      by: window.currentUser.uid,
      byName: window.userProfileName || 'Anonymous',
      source: 'room-message',
    };
    await sendSpecialMessage({ reminder }, `Reminder: ${reminder.text}`);
    await saveReminder(reminder);
    setComposerDialogMode(null);
  }, [saveReminder, sendSpecialMessage]);

  const votePoll = useCallback(async (messageId, optionId) => {
    if (!window.currentUser?.uid) return;
    const pollMessage = messagesRef.current.find((message) => message.id === messageId);
    if (!pollMessage?.poll || isPollClosed(pollMessage.poll)) {
      window.showToast?.('This poll is closed.', false);
      return;
    }
    try {
      const votePath = roomMessageChildRef(
        activeRoomRef.current.id,
        messageId,
        `poll/votes/${window.currentUser.uid}`,
        activeChannelRef.current,
      );
      const currentVote = pollMessage.poll.votes?.[window.currentUser.uid] || null;
      const nextVote = nextPollVoteValue(pollMessage.poll, currentVote, optionId);
      if (nextVote) await set(votePath, nextVote);
      else await remove(votePath);
    } catch (error) {
      window.showToast?.(`Vote failed: ${error.message}`);
    }
  }, []);

  const pickQuickReply = useCallback((suggestion) => {
    const text = String(suggestion || '').trim();
    if (!text || isSendingRef.current) return;

    setDraft(text);
    setCursorIndex(text.length);
    setDismissedMentionKey('');
    setQuickReplyStatus('Reply idea added — review before sending');
    writeComposerDraft(activeRoomRef.current.id, activeChannelRef.current, text);
    setTyping(true);

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => setTyping(false), 3000);

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.selectionStart = text.length;
        textareaRef.current.selectionEnd = text.length;
      }
    });
  }, [setTyping]);

  const typingText = useMemo(() => {
    if (typingNames.length === 1) return `${typingNames[0]} is typing...`;
    if (typingNames.length === 2) return `${typingNames[0]} and ${typingNames[1]} are typing...`;
    return `${typingNames.length} people are typing...`;
  }, [typingNames]);

  const quickReplyViewerName = window.userProfileName || user?.displayName || '';
  const quickReplyViewerShortId = window.userShortId || '';
  const showQuickReplies = !draft.trim() && !composerDisabled && !isSending;
  const composerStatusText = useMemo(() => {
    if (composerDisabled) return 'Read-only in this room';
    if (isSending) return 'Sending message';
    if (quickReplyStatus) return quickReplyStatus;
    if (reply) return `Replying to ${reply.name || 'message'}`;
    if (fileSelected) return 'Attachment ready';
    if (slashMenuOpen) return 'Choose a command';
    if (mentionMenuOpen) return 'Choose a mention';
    return 'Enter sends';
  }, [composerDisabled, fileSelected, isSending, mentionMenuOpen, quickReplyStatus, reply, slashMenuOpen]);

  useEffect(() => {
    if (!user?.uid) return undefined;

    const clearTimers = () => {
      reminderTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      reminderTimersRef.current = [];
    };

    const unsubscribe = onValue(ref(db, `user_reminders/${user.uid}`), (snapshot) => {
      clearTimers();
      const now = Date.now();
      snapshot.forEach((child) => {
        const reminder = child.val() || {};
        if (reminder.firedAt) return;
        const dueAt = Number(reminder.dueAt || 0);
        if (!dueAt) return;

        const fire = () => {
          window.showToast?.(`Reminder: ${reminder.text}`, false);
          update(ref(db, `user_reminders/${user.uid}/${child.key}`), { firedAt: Date.now() }).catch(() => {});
        };

        const delay = dueAt - now;
        if (delay <= 0) fire();
        else if (delay < 2147483647) reminderTimersRef.current.push(window.setTimeout(fire, delay));
      });
    });

    return () => {
      clearTimers();
      unsubscribe();
    };
  }, [user?.uid]);

  return (
    <>
      {roomListHost ? (
        createPortal(
          <RoomList
            activeRoomId={activeRoom.id}
            onHideRoom={hideRoom}
            onOpenQuickSwitch={openQuickSwitcher}
            onSwitchRoom={switchRoom}
            onToggleFavorite={toggleRoomFavorite}
            onUnhideRoom={unhideRoom}
            quickSwitcherOpen={quickSwitcherOpen}
            roomPrefs={roomPrefs}
            rooms={rooms}
          />,
          roomListHost,
        )
      ) : null}

      {channelHost ? (
        createPortal(
          <ChannelBar
            activeChannelId={activeChannelId}
            activeRoomId={activeRoom.id}
            channels={channels}
            onAddChannel={addChannel}
            onConfigureChannel={configureChannel}
            onSwitchChannel={switchChannel}
          />,
          channelHost,
        )
      ) : null}

      {roomHeaderHost ? createPortal(
        <Suspense fallback={null}>
          <LazyRoomHeaderContext activeRoom={activeRoom} />
        </Suspense>,
        roomHeaderHost,
      ) : null}

      <MessageJumpContext
        jump={jumpContext}
        onDismiss={dismissJumpContext}
        onLoadOlder={loadOlderForJump}
      />
      <div id="loading-history" className={loadingHistory ? '' : 'hidden'}>Loading history...</div>
      <MessageList
        activeRoomName={activeRoom.name}
        composerDisabled={composerDisabled}
        editingId={editingId}
        editingText={editingText}
        initialLoading={initialMessagesLoading}
        loadFailed={messagesLoadFailed}
        listRef={listRef}
        locale={locale}
        messageDeliveries={messageDeliveries}
        messageScope={messageScopeKey(activeRoom.id, activeChannelId)}
        messages={messages}
        pinnedMessageId={(
          window.pendingMessageWindowScrollRestore?.scopeKey
            === messageScopeKey(activeRoom.id, activeChannelId)
        )
          ? window.pendingMessageWindowScrollRestore.messageId
          : ''}
        onCancelEdit={cancelEditMessage}
        onCancelDelivery={cancelMessageDelivery}
        onEditingText={setEditingText}
        onJumpToMessage={requestMessageJump}
        onMarkUnread={markMessageUnread}
        onOpenThread={openMessageThread}
        onPrepareReply={prepareReply}
        onReact={reactToMessage}
        onClosePoll={closePoll}
        onReport={reportMessage}
        onRetryDelivery={retryMessageDelivery}
        onSaveEdit={saveEditedMessage}
        onSaveReminder={saveReminder}
        onScroll={handleMessagesScroll}
        onScrollIntent={handleMessagesScrollIntent}
        onTranslate={translateMessage}
        onVotePoll={votePoll}
        firstUnreadMessageId={activeUnread.firstMessageId}
        searchQuery={deferredSearchQuery}
        translatedMessages={translatedMessages}
      />

      {threadDrawerOpen ? (
        <Suspense fallback={null}>
          <LazyThreadDrawer
            key={`${messageScopeKey(activeRoom.id, activeChannelId)}:${activeThreadRootId || 'inbox'}`}
            activeRootId={activeThreadRootId}
            follows={threadFollows}
            messages={messages}
            onClose={() => setThreadDrawerOpen(false)}
            onFollow={toggleThreadFollow}
            onJump={(message) => requestMessageJump({
              messageId: message.id,
              roomId: activeRoom.id,
              channelId: activeChannelId,
              source: 'thread',
              messageText: message.text || '',
            })}
            onMarkRead={markThreadRead}
            onReply={replyInThread}
            onSelectThread={setActiveThreadRootId}
            open={threadDrawerOpen}
            readAtByRoot={threadReadAtByRoot}
            viewerUid={userId}
          />
        </Suspense>
      ) : null}

      <div id="typing-status-container" className={typingNames.length ? '' : 'hidden'}>
        <div className="typing-dots"><div className="dot" /><div className="dot" /><div className="dot" /></div>
        <span id="typing-text">{typingText}</span>
      </div>

      <div id="active-reply-box" className={reply ? '' : 'hidden'}>
        <div className="active-reply-content">
          <strong className="active-reply-label">
            <i className="ph-bold ph-arrow-bend-up-left" aria-hidden="true" />
            <span id="replying-to-name">{reply?.name || ''}</span>
          </strong>
          <span id="replying-to-text">
            {reply?.threadRootId ? 'Thread · ' : ''}
            {reply?.text?.length > 40 ? `${reply.text.substring(0, 40)}...` : reply?.text || ''}
          </span>
        </div>
        <button className="cancel-reply" id="cancel-reply-btn" onClick={cancelReply} type="button" aria-label="Cancel reply">
          <i className="ph-bold ph-x" aria-hidden="true" />
        </button>
      </div>

      <RoomCatchUpStrip
        hidden={!roomCatchUpEnabled || Boolean(draft.trim())}
        key={`room-catchup:${userId}:${messageScopeKey(activeRoom.id, activeChannelId)}`}
        messages={messages}
        onCreateTask={createTaskFromCatchUp}
        onOpenRoomAi={openRoomAiFromCatchUp}
        onReviewMessage={reviewCatchUpMessage}
        scopeKey={messageScopeKey(activeRoom.id, activeChannelId)}
        userId={userId}
        viewerName={window.userProfileName || user?.displayName || ''}
        viewerShortId={window.userShortId || ''}
      />
      {showQuickReplies ? (
        <Suspense fallback={null}>
          <LazyQuickReplies
            messages={messages}
            onPick={pickQuickReply}
            replyTarget={reply}
            scopeKey={messageScopeKey(activeRoom.id, activeChannelId)}
            viewerId={userId}
            viewerName={quickReplyViewerName}
            viewerShortId={quickReplyViewerShortId}
          />
        </Suspense>
      ) : null}
      {slashMenuOpen ? (
        <SlashCommandMenu
          commands={slashCommands}
          onHover={setSlashSelectedIndex}
          onRun={runSlashCommand}
          selectedIndex={slashSelectedIndex}
        />
      ) : null}
      {mentionMenuOpen ? (
        <MentionMenu
          onHover={setMentionSelectedIndex}
          onPick={insertMention}
          selectedIndex={mentionSelectedIndex}
          suggestions={mentionSuggestions}
        />
      ) : null}

      <CommandListModal
        onClose={() => setCommandListOpen(false)}
        onRun={runSlashCommand}
        open={commandListOpen}
      />

      {quickSwitcherOpen ? createPortal(
        <QuickSwitcher
          activeChannelId={activeChannelId}
          activeRoomId={activeRoom.id}
          channels={channels}
          onClose={closeQuickSwitcher}
          onPick={handleQuickSwitchDestination}
          roomPrefs={roomPrefs}
          rooms={rooms}
        />,
        document.body,
      ) : null}

      <ComposerActionDialog
        mode={composerDialogMode}
        onClose={() => setComposerDialogMode(null)}
        onSubmit={composerDialogMode === 'poll' ? submitPollDialog : submitReminderDialog}
        submitting={isSending}
      />

      <SimpleActionDialog
        dialog={simpleDialog}
        onCancel={() => resolveSimpleDialog(null)}
        onSubmit={resolveSimpleDialog}
      />

      {scheduleDialogOpen ? (
        <Suspense fallback={null}>
          <LazyScheduleMessageDialog
            defaultText={draft}
            key={`schedule:${scheduleDialogOpen ? 'open' : 'closed'}`}
            onClose={() => setScheduleDialogOpen(false)}
            onSubmit={scheduleMessage}
            open={scheduleDialogOpen}
            submitting={scheduleSubmitting}
          />
        </Suspense>
      ) : null}

      <form action="" id="chat-form" onSubmit={handleSubmit}>
        <input
          className="hidden"
          id="image-input"
          onChange={handleFileChange}
          ref={fileInputRef}
          type="file"
        />
        {scheduledMessages.length ? (
          <Suspense fallback={null}>
            <LazyScheduledMessageList messages={scheduledMessages} onCancel={cancelScheduledMessage} />
          </Suspense>
        ) : null}
        {selectedFile ? (
          <Suspense fallback={null}>
            <LazyAttachmentPreview file={selectedFile} onRemove={clearSelectedFile} />
          </Suspense>
        ) : null}
        <div className="composer-input-row">
          <textarea
            disabled={composerDisabled || isSending}
            id="message-input"
            onClick={(event) => setCursorIndex(event.currentTarget.selectionStart ?? draft.length)}
            onChange={handleDraftChange}
            onKeyDown={handleTextareaKeyDown}
            onKeyUp={(event) => setCursorIndex(event.currentTarget.selectionStart ?? draft.length)}
            onSelect={(event) => setCursorIndex(event.currentTarget.selectionStart ?? draft.length)}
            placeholder={
              isSending
                ? translate('chat.send.sending', {}, locale)
                : composerDisabled
                  ? placeholder
                  : translate('chat.composer.placeholder', { channel: activeChannelId }, locale)
            }
            ref={textareaRef}
            rows={1}
            aria-label={translate('chat.composer.placeholder', { channel: activeChannelId }, locale)}
            aria-describedby="composer-helper-text"
            value={draft}
          />
          <button
            aria-busy={isSending || undefined}
            className="composer-send-btn"
            disabled={isSending || composerDisabled}
            id="mobile-send-btn"
            title={translate('chat.send', {}, locale)}
            aria-label={translate('chat.send', {}, locale)}
            type="submit"
          >
            <i
              className={`ph-bold ${isSending ? 'ph-spinner-gap message-delivery-spinner' : 'ph-paper-plane-tilt'}`}
              aria-hidden="true"
            />
          </button>
        </div>
        <div className="composer-toolbar">
          <div className="composer-tool-group" aria-label="Message tools">
            <button
              aria-pressed={fileSelected}
              className={`composer-icon-btn ${fileSelected ? 'active' : ''}`}
              disabled={isSending || composerDisabled}
              id="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title={translate('chat.attachment.add', {}, locale)}
              aria-label={translate('chat.attachment.add', {}, locale)}
              type="button"
            >
              <i className="ph-bold ph-paperclip" aria-hidden="true" />
            </button>
            <button
              aria-controls="composer-more-menu"
              aria-expanded={composerMoreOpen}
              aria-haspopup="menu"
              aria-label="More message tools"
              className={`composer-icon-btn ${composerMoreOpen ? 'active' : ''}`}
              disabled={isSending || composerDisabled}
              id="composer-more-trigger"
              onClick={() => setComposerMoreOpen((current) => !current)}
              ref={composerMoreTriggerRef}
              title="More message tools"
              type="button"
            >
              <i className="ph-bold ph-dots-three-outline-vertical" aria-hidden="true" />
            </button>
            {composerMoreOpen ? (
              <Suspense
                fallback={(
                  <ComposerMoreMenuState
                    anchorRef={composerMoreTriggerRef}
                    onClose={() => setComposerMoreOpen(false)}
                  />
                )}
              >
                <LazyComposerMoreMenu
                  anchorRef={composerMoreTriggerRef}
                  onClose={() => setComposerMoreOpen(false)}
                  onCodeBlock={() => insertCodeSnippet('block')}
                  onCreatePoll={createPoll}
                  onCreateReminder={createReminder}
                  onInlineCode={() => insertCodeSnippet('inline')}
                  onJumpToUnread={jumpToFirstUnread}
                  onSchedule={() => setScheduleDialogOpen(true)}
                  onToggleThreads={() => setThreadDrawerOpen((current) => !current)}
                  threadsOpen={threadDrawerOpen}
                  unreadCount={activeUnread.count}
                />
              </Suspense>
            ) : null}
          </div>
          <span className="composer-helper" id="composer-helper-text" aria-live="polite">
            <span className="composer-status">{composerStatusText}</span>
            <span className="composer-shortcut">Shift+Enter for new line</span>
          </span>
        </div>
      </form>
    </>
  );
}
