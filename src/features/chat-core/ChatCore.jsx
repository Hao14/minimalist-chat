import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  runTransaction,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from '../../lib/firebase.js';
import { renderMessageText } from '../../lib/text.js';
import { getRequiredIdToken } from '../../lib/authToken.js';

const GLOBAL_ROOM = {
  id: 'global',
  name: 'Global Chat',
  lastMessage: 'Welcome to the server.',
  shortId: 'GLOBAL',
};

const LAST_ROOM_STORAGE_PREFIX = 'minimalist:last-room';

const uploadLimits = {
  free: {
    label: 'Base',
    perFile: 10 * 1024 * 1024,
    daily: 500 * 1024 * 1024,
  },
  advanced: {
    label: 'Advanced',
    perFile: 700 * 1024 * 1024,
    daily: 1.5 * 1024 * 1024 * 1024,
  },
  pro: {
    label: 'Pro',
    perFile: 3 * 1024 * 1024 * 1024,
    daily: 9 * 1024 * 1024 * 1024,
  },
};

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
      ['/msg schedule', 'Schedule a message', 'comingSoon'],
      ['/msg ephemeral', 'Send disappearing message', 'comingSoon'],
      ['/msg unread', 'Jump to first unread', 'unread'],
      ['/msg bookmark', 'Bookmark a message', 'bookmarks'],
      ['/msg collect', 'Add message to a collection', 'bookmarks'],
      ['/msg flag', 'Mark message as important', 'messageMenu'],
      ['/msg impact', 'View message impact', 'messageMenu'],
      ['/thread create', 'Start a threaded conversation', 'comingSoon'],
      ['/quote', 'Quote reply to a message', 'quote'],
      ['/react', 'Add a reaction', 'messageMenu'],
      ['/gif', 'Search and send a GIF', 'comingSoon'],
      ['/voice', 'Send voice message', 'comingSoon'],
      ['/transcribe', 'Transcribe voice message', 'comingSoon'],
      ['/upload', 'Upload a file', 'attach'],
      ['/attach', 'Attach file to message', 'attach'],
      ['/preview', 'Generate link preview', 'comingSoon'],
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
      ['/notify schedule', 'Set notification schedule', 'comingSoon'],
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
      ['/poll close', 'Close poll', 'comingSoon'],
      ['/poll results', 'View poll results', 'comingSoon'],
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
      ['/automod on', 'Enable auto moderation', 'comingSoon'],
      ['/automod off', 'Disable auto moderation', 'comingSoon'],
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
    commands: [
      ['/stock', 'Ask the Stock Price Tracker bot for a quote, e.g. /stock AAPL', 'stock'],
      ['/automod on', 'Enable Auto Moderation bot in this room', 'automodOn'],
      ['/automod off', 'Disable Auto Moderation bot in this room', 'automodOff'],
    ],
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

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function roomMessagesRef(roomId, channelId = 'general') {
  if (roomId === 'global') return ref(db, 'messages');
  if (!channelId || channelId === 'general') return ref(db, `rooms_data/${roomId}/messages`);
  return ref(db, `rooms_data/${roomId}/channels/${channelId}/messages`);
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
  return {
    uid: window.currentUser?.uid,
    name: window.userProfileName || 'Anonymous',
    photoUrl: window.userPhotoUrl || '',
    tier: window.userTier || 'free',
    shortId: window.userShortId || '',
  };
}

const ROOM_PERMISSION_DEFAULTS = {
  manageChannels: false,
  webhooks: false,
};

const DEFAULT_AUTOMOD_BLOCKED_WORDS = ['spam', 'scam'];

function normalizedBotConfig(roomData = {}) {
  const bots = roomData.bots || {};
  const stockTracker = bots.stockTracker || {};
  const autoModeration = bots.autoModeration || {};
  return {
    stockTracker: {
      enabled: stockTracker.enabled === true,
      symbols: String(stockTracker.symbols || '')
        .split(/[\s,]+/)
        .map((symbol) => symbol.replace(/^\$/, '').trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 12),
    },
    autoModeration: {
      enabled: autoModeration.enabled === true,
      blockLinks: autoModeration.blockLinks === true,
      blockCaps: autoModeration.blockCaps !== false,
      blockFlood: autoModeration.blockFlood !== false,
      blockedWords: String(autoModeration.blockedWords || DEFAULT_AUTOMOD_BLOCKED_WORDS.join(', '))
        .split(/[,|\n]/)
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 40),
    },
  };
}

async function getRoomBotConfig(roomId) {
  if (!roomId || roomId === 'global') return normalizedBotConfig();
  const snapshot = await get(ref(db, `rooms_meta/${roomId}`)).catch(() => null);
  return normalizedBotConfig(snapshot?.val() || {});
}

function detectAutoModeration(text, config) {
  const clean = String(text || '').trim();
  if (!config?.enabled || !clean) return null;
  const lowered = clean.toLowerCase();

  const matchedWord = (config.blockedWords || []).find((word) => {
    if (!word) return false;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i').test(clean);
  });
  if (matchedWord) return `blocked keyword “${matchedWord}”`;

  if (config.blockLinks && /(https?:\/\/|www\.)\S+/i.test(clean)) return 'links are restricted in this room';
  if (config.blockFlood && /(.)\1{7,}/i.test(clean.replace(/\s+/g, ''))) return 'repeated-character flood detected';

  const letters = clean.replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '');
  if (config.blockCaps && letters.length >= 18 && upper.length / letters.length > 0.82) return 'excessive caps detected';

  return null;
}

function extractStockSymbols(text, config = {}, { commandOnly = false } = {}) {
  const clean = String(text || '').trim();
  const symbols = new Set();
  const commandMatch = clean.match(/^\/stock(?:\s+|:)([A-Za-z][A-Za-z0-9.-]{0,15})/i);
  if (commandMatch) symbols.add(commandMatch[1].toUpperCase());

  if (!commandOnly) {
    for (const match of clean.matchAll(/(^|[^\w])\$([A-Za-z][A-Za-z0-9.-]{0,9})\b/g)) {
      symbols.add(match[2].toUpperCase());
    }

    const tracked = new Set((config.symbols || []).map((symbol) => symbol.toUpperCase()));
    if (tracked.size) {
      for (const symbol of tracked) {
        if (new RegExp(`(^|[^A-Za-z0-9])${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i').test(clean)) {
          symbols.add(symbol);
        }
      }
    }
  }

  return [...symbols].slice(0, 3);
}

async function fetchStockQuote(symbol) {
  const endpoint = window.STOCK_QUOTE_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/stockQuote';
  const token = await getRequiredIdToken('Please sign in before using the stock bot.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ symbol }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Stock quote failed');
  return data;
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

async function postBotMessage(roomId, channelId, botName, text, extra = {}) {
  const message = {
    uid: `bot-${String(botName || 'minimalist').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: botName,
    photoUrl: '',
    text,
    timestamp: serverTimestamp(),
    tier: 'bot',
    bot: true,
    ...extra,
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
  return ROOM_PERMISSION_DEFAULTS[key] ?? true;
}

function userPermissionValue(roomData = {}, key, uid = window.currentUser?.uid) {
  const overrides = uid ? roomData.memberPermissions?.[uid] : null;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key] !== false;
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

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

function MessageText({ text }) {
  const nodes = useMemo(() => {
    const html = renderMessageText(text || '');
    const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    return Array.from(parsed.body.firstChild?.childNodes || []).map((node, index) => renderMessageTextNode(node, index));
  }, [text]);

  return nodes;
}

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

function mergeMessage(list, messageId, message, prepend = false) {
  const existing = list.findIndex((item) => item.id === messageId);
  if (existing >= 0) {
    const next = [...list];
    next[existing] = { id: messageId, ...message };
    return next;
  }

  const item = { id: messageId, ...message };
  return prepend ? [item, ...list] : [...list, item];
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
  roomSearch.value = '';
  roomSearch.dispatchEvent(new Event('input', { bubbles: true }));
}

function updateMessageCache(messages) {
  window.msgCache = messages.reduce((acc, message) => {
    acc[message.id] = message;
    return acc;
  }, {});
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
        <img src={room.photoUrl} alt="" />
      </span>
    );
  }

  return <span className="room-icon room-icon-fallback" aria-hidden="true">{roomInitials(room.name)}</span>;
}

function RoomListItem({
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
      onClick={handleSwitch}
    >
      <RoomIcon room={room} />
      <span className="room-copy">
        <span className="room-name">
          {room.name}
          {isFavorite ? <span className="room-favorite-mark" aria-label="Favorite room">★</span> : null}
        </span>
        <span className="room-preview">{hidden ? 'Hidden room' : (room.lastMessage || 'No messages yet...')}</span>
      </span>
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
}

function RoomList({ rooms, roomPrefs, activeRoomId, onSwitchRoom, onToggleFavorite, onHideRoom, onUnhideRoom }) {
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
}

function ChannelBar({ activeRoomId, channels, activeChannelId, onSwitchChannel, onAddChannel }) {
  if (activeRoomId === 'global') return null;
  return (
    <>
      {channels.map((channel) => (
        <button
          key={channel.id}
          type="button"
          className={`channel-chip ${channel.id === activeChannelId ? 'active' : ''}`}
          onClick={() => onSwitchChannel(channel.id)}
        >
          # {channel.name}
        </button>
      ))}
      <button type="button" className="channel-chip channel-add" onClick={onAddChannel}>+ Channel</button>
    </>
  );
}

function ReactionPills({ message, onReact }) {
  const reactions = useMemo(() => {
    const counts = {};
    Object.entries(message.reactions || {}).forEach(([uid, emoji]) => {
      if (!emoji) return;
      counts[emoji] = counts[emoji] || { n: 0, mine: false };
      counts[emoji].n += 1;
      if (uid === window.currentUser?.uid) counts[emoji].mine = true;
    });
    return Object.entries(counts);
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

  return (
    <div className={`msg-file-text-preview ${expanded ? 'expanded' : ''}`}>
      <pre>{file.textPreview}{file.textPreviewTruncated && !expanded ? '\n…' : ''}</pre>
      {(file.textPreviewTruncated || file.textPreview.length > 700) ? (
        <button className="msg-preview-toggle" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Collapse preview' : 'Expand text preview'}
        </button>
      ) : null}
    </div>
  );
}

function PollCard({ message, onVotePoll }) {
  const poll = message.poll;
  if (!poll?.question) return null;

  const votes = poll.votes || {};
  const options = poll.options || [];
  const total = Object.keys(votes).length;
  const myVote = votes[window.currentUser?.uid];

  return (
    <div className="poll-card">
      <div className="poll-title"><i className="ph-bold ph-chart-bar" /> {poll.question}</div>
      {options.map((option) => {
        const count = Object.values(votes).filter((value) => value === option.id).length;
        const pct = total ? Math.round((count / total) * 100) : 0;
        return (
          <button
            className={`poll-option ${myVote === option.id ? 'mine' : ''}`}
            key={option.id}
            type="button"
            onClick={() => onVotePoll(message.id, option.id)}
          >
            <span className="poll-bar" style={{ width: `${pct}%` }} />
            <span>{option.text} · {count} vote{count === 1 ? '' : 's'} {total ? `(${pct}%)` : ''}</span>
          </button>
        );
      })}
      <div className="poll-meta">{total} total vote{total === 1 ? '' : 's'}</div>
    </div>
  );
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

function addSmartReply(list, ...suggestions) {
  suggestions.forEach((suggestion) => {
    const clean = String(suggestion || '').trim();
    if (!clean) return;
    if (!list.some((existing) => existing.toLowerCase() === clean.toLowerCase())) list.push(clean);
  });
  return list;
}

function messageMentionsMe(text) {
  const myName = String(window.userProfileName || '').trim().toLowerCase();
  const myShortId = String(window.userShortId || '').trim().toLowerCase();
  const lower = String(text || '').toLowerCase();
  return Boolean(
    (myName && lower.includes(`@${myName}`))
    || (myName && lower.includes(myName))
    || (myShortId && lower.includes(myShortId))
  );
}

function buildSmartReplies(messages) {
  const relevantMessages = [...messages]
    .filter((message) => message.uid !== window.currentUser?.uid && (message.text || message.attachedImage || message.attachedFile || message.poll || message.reminder))
    .slice(-8);
  const last = [...relevantMessages].reverse()[0];
  if (!last) return [];

  const suggestions = [];
  const text = String(last.text || '').trim();
  const lower = text.toLowerCase();
  const recentText = relevantMessages.map((message) => String(message.text || '')).join(' ').toLowerCase();
  const isQuestion = /[?？]\s*$/.test(text) || /^(can|could|would|will|do|does|did|is|are|should|what|when|where|who|why|how)\b/i.test(text);
  const directMention = messageMentionsMe(text);

  if (last.aiAgent || last.bot) {
    addSmartReply(suggestions, 'Thanks, glad to be here.', 'Can you summarize the room?', 'Show me the next steps.');
  }

  if (directMention) {
    addSmartReply(suggestions, 'I’m on it.', 'I’ll check now.', 'Can you send one more detail?');
  }

  if (last.attachedFile || last.attachedImage) {
    addSmartReply(suggestions, 'I’ll review this now.', 'Thanks, got the file.', 'I’ll check and reply soon.');
  }

  if (last.poll) {
    addSmartReply(suggestions, 'I voted.', 'I like the top option.', 'Let’s decide after a few votes.');
  }

  if (last.reminder) {
    addSmartReply(suggestions, 'Thanks for the reminder.', 'I’ll be there.', 'I added it to my list.');
  }

  if (/\b(hi|hello|hey|yo|gm|good morning|good afternoon|good evening)\b/.test(lower)) {
    addSmartReply(suggestions, 'Hey! What’s up?', 'Hi, good to see you.', 'Hey — how can I help?');
  }

  if (/\b(thanks|thank you|ty|appreciate)\b/.test(lower)) {
    addSmartReply(suggestions, 'Anytime!', 'No problem.', 'Glad it helped.');
  }

  if (/\b(sorry|my bad|apologies)\b/.test(lower)) {
    addSmartReply(suggestions, 'No worries.', 'You’re good.', 'All good, thanks for the update.');
  }

  if (/\b(error|bug|broken|issue|not working|failed|crash|stuck|can'?t|unable)\b/.test(lower)) {
    addSmartReply(suggestions, 'I’m looking into it now.', 'Can you send the exact error?', 'I’ll test a fix.');
  }

  if (/\b(code|react|vite|firebase|stripe|deploy|css|api|function|server|node|npm|build|lint|commit|pr)\b/.test(lower) || /```|`/.test(text)) {
    addSmartReply(suggestions, 'I’ll test the change.', 'Can you paste the error?', 'That looks like a code-path issue.');
  }

  if (/\b(meet|meeting|call|voice|video|schedule|calendar|today|tomorrow|tonight|deadline|due|time)\b/.test(lower)) {
    addSmartReply(suggestions, 'That time works for me.', 'Can we confirm the time?', 'I’ll add a reminder.');
  }

  if (/\b(file|pdf|image|photo|screenshot|upload|attach|link|doc|document)\b/.test(lower)) {
    addSmartReply(suggestions, 'Send it here and I’ll check.', 'I’ll review the attachment.', 'Can you resend the link?');
  }

  if (/\b(choose|which|option|vote|decide|pick|prefer|better)\b/.test(lower)) {
    addSmartReply(suggestions, 'I’d go with the simpler option.', 'Let’s compare both quickly.', 'I’m good with that choice.');
  }

  if (/\b(done|finished|complete|fixed|works|working|looks good|sounds good|ship)\b/.test(lower)) {
    addSmartReply(suggestions, 'Nice, works for me.', 'Let’s ship it.', 'Good call.');
  }

  if (isQuestion) {
    if (/^(when|what time)\b/i.test(text)) addSmartReply(suggestions, 'Today works for me.', 'What time are you thinking?', 'Can we do tomorrow?');
    else if (/^(where)\b/i.test(text)) addSmartReply(suggestions, 'Can you send the location?', 'I can meet there.', 'Drop the link here.');
    else if (/^(who)\b/i.test(text)) addSmartReply(suggestions, 'I can take this.', 'Who should we loop in?', 'Let’s ask the room.');
    else if (/^(how|why)\b/i.test(text)) addSmartReply(suggestions, 'I can walk through it.', 'Let me check and explain.', 'Can you show an example?');
    else addSmartReply(suggestions, 'Yes, that works.', 'I’ll check and get back to you.', 'Can you clarify one detail?');
  }

  if (recentText.includes('reminder') || recentText.includes('deadline')) addSmartReply(suggestions, 'I’ll set a reminder.');
  if (recentText.includes('poll') || recentText.includes('vote')) addSmartReply(suggestions, 'I’ll vote now.');
  if (recentText.includes('upload') || recentText.includes('file')) addSmartReply(suggestions, 'I’ll check the file.');

  addSmartReply(suggestions, 'Sounds good.', 'I agree.', 'I’ll take a look.');
  return suggestions.slice(0, 3);
}

function SmartReplies({ suggestions, onPick }) {
  if (!suggestions.length) return null;
  return (
    <div className="smart-replies">
      <span className="smart-replies-label">Smart replies</span>
      {suggestions.map((suggestion) => (
        <button className="smart-reply-chip" key={suggestion} type="button" onClick={() => onPick(suggestion)}>
          {suggestion}
        </button>
      ))}
    </div>
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

function ComposerActionDialog({ mode, onClose, onSubmit, submitting }) {
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState('Yes, No, Maybe');
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
      ? { question: pollQuestion, optionsText: pollOptions }
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

function SimpleActionDialog({ dialog, onCancel, onSubmit }) {
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue(dialog?.defaultValue || '');
  }, [dialog]);

  if (!dialog) return null;
  const isConfirm = dialog.type === 'confirm';
  const isChannelDialog = dialog.variant === 'channel';
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
              <input
                autoFocus
                name="value"
                value={value}
                maxLength={dialog.maxLength || 120}
                placeholder={dialog.placeholder || ''}
                onChange={(event) => setValue(event.target.value)}
              />
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

function MessageItem({
  animationIndex = 0,
  message,
  searchQuery,
  editingId,
  editingText,
  onEditingText,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onPrepareReply,
  onReact,
  onSaveReminder,
  onVotePoll,
}) {
  const isMine = message.uid === window.currentUser?.uid;
  const canDelete = isMine || window.currentUser?.uid === window.MY_ADMIN_UID;
  const avatar = message.photoUrl || window.getAvatarUrl?.(message.name, '') || '';
  const isEditing = editingId === message.id;
  const isVisible = !searchQuery || messageSearchText(message).includes(searchQuery);

  return (
    <li
      className={`chat-message ${isMine ? 'my-message' : ''} ${message.important ? 'msg-important' : ''}`}
      id={`msg-${message.id}`}
      style={{ display: isVisible ? 'flex' : 'none', '--message-index': animationIndex % 10 }}
    >
      <div className="msg-actions">
        <span className="action-icon" onClick={() => onReact(message.id, '👍')}>👍</span>
        <span className="action-icon" onClick={() => onReact(message.id, '❤️')}>❤️</span>
        <span
          className="action-icon more-icon"
          onClick={(event) => window.toggleEmojiPicker?.(event, message.id)}
          title="React"
        >
          😊
        </span>
        <span
          className="action-icon reply-icon"
          onClick={() => onPrepareReply(message.id, message.name, message.text || 'Image')}
          title="Reply"
        >
          ↩️
        </span>
        <span
          className="action-icon msg-menu-icon"
          onClick={(event) => window.openMsgMenu?.(event, message.id)}
          title="More actions"
        >
          ⋮
        </span>
        {isMine ? <span className="action-icon edit-icon" onClick={() => onStartEdit(message.id)} title="Edit">✏️</span> : null}
        {canDelete ? <span className="action-icon delete-icon" onClick={() => onDelete(message.id)} title="Delete">🗑️</span> : null}
      </div>

      <div
        className="msg-header"
        onContextMenu={(event) => {
          event.preventDefault();
          window.showContextMenu?.(event.pageX, event.pageY, message.uid, message.name);
        }}
        style={{ cursor: 'context-menu' }}
      >
        <img
          alt="Avatar"
          className="msg-avatar"
          onClick={() => window.viewUserProfile?.(message.uid)}
          src={avatar}
        />
        <div className="header-text">
          <span className="msg-name" onClick={() => window.viewUserProfile?.(message.uid)} style={{ cursor: 'pointer' }}>
            {message.name}
          </span>
          {message.aiAgent || message.bot ? <span className="tier-badge ai">AI</span> : null}
          {message.tier === 'advanced' ? <span className="tier-badge advanced">ADVANCED</span> : null}
          {message.tier === 'pro' ? <span className="tier-badge pro">PRO</span> : null}
          <span className="msg-time">{formatTime(message.timestamp)}</span>
          <span className="msg-edited" id={`ed-${message.id}`}>{message.edited ? '(edited)' : ''}</span>
          <span
            className="msg-flag"
            id={`flag-${message.id}`}
            style={{ display: message.important ? '' : 'none' }}
            title="Important"
          >
            ⚑
          </span>
        </div>
      </div>

      {message.replyTo ? (
        <div className="reply-quote">
          <span className="reply-quote-name">↩ {message.replyTo.name}</span>
          <span className="reply-quote-text">{message.replyTo.text}</span>
        </div>
      ) : null}

      {message.attachedImage ? (
        <img className="msg-attached-img" src={message.attachedImage} alt="Attachment" />
      ) : null}

      {message.attachedFile && !message.attachedImage ? (
        <div className="msg-file-card">
          <a className="msg-file-main" href={message.attachedFile.url} target="_blank" rel="noreferrer">
            <span className="msg-file-icon"><i className="ph-bold ph-file-arrow-down" /></span>
            <span className="msg-file-info">
              <strong>{message.attachedFile.name || 'Attachment'}</strong>
              <small>{message.attachedFile.type || 'File'} · {formatBytes(Number(message.attachedFile.size || 0))}</small>
            </span>
          </a>
          <TextFilePreview file={message.attachedFile} />
        </div>
      ) : null}

      <PollCard message={message} onVotePoll={onVotePoll} />
      <ReminderCard message={message} onSaveReminder={onSaveReminder} />

      <div className="msg-text" id={`mt-${message.id}`}>
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
          <MessageText text={message.text} />
        )}
      </div>

      <ReactionPills message={message} onReact={onReact} />
    </li>
  );
}

export function ChatCore({ user, registerApi }) {
  const initialRoomPreferenceRef = useRef(readLastRoomPreference(user?.uid));
  const initialRoom = roomFromPreference(initialRoomPreferenceRef.current);
  const initialChannelId = initialRoom.id === 'global' ? 'general' : (initialRoomPreferenceRef.current?.channelId || 'general');
  const [roomListHost, setRoomListHost] = useState(null);
  const [channelHost, setChannelHost] = useState(null);
  const [rooms, setRooms] = useState([GLOBAL_ROOM]);
  const [roomPrefs, setRoomPrefs] = useState({});
  const [activeRoom, setActiveRoom] = useState(initialRoom);
  const [channels, setChannels] = useState([{ id: 'general', name: 'general' }]);
  const [activeChannelId, setActiveChannelId] = useState(initialChannelId);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState(null);
  const [typingNames, setTypingNames] = useState([]);
  const [composerDisabled, setComposerDisabled] = useState(false);
  const [placeholder, setPlaceholder] = useState('Message Global Chat...');
  const [fileSelected, setFileSelected] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [commandListOpen, setCommandListOpen] = useState(false);
  const [composerDialogMode, setComposerDialogMode] = useState(null);
  const [simpleDialog, setSimpleDialog] = useState(null);
  const [mentionCandidates, setMentionCandidates] = useState([]);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState('');

  const roomsRef = useRef([GLOBAL_ROOM]);
  const roomPrefsRef = useRef({});
  const activeRoomRef = useRef(initialRoom);
  const activeChannelRef = useRef(initialChannelId);
  const messagesRef = useRef([]);
  const oldestMessageKeyRef = useRef(null);
  const isFetchingHistoryRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const listRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimerRef = useRef(null);
  const muteTimerRef = useRef(null);
  const isSendingRef = useRef(false);
  const reminderTimersRef = useRef([]);
  const simpleDialogResolverRef = useRef(null);

  useEffect(() => {
    setRoomListHost(document.getElementById('room-list'));
    setChannelHost(document.getElementById('room-channel-list'));
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

  useEffect(() => {
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  useEffect(() => {
    writeLastRoomPreference(activeRoom, activeChannelId, user?.uid);
  }, [activeChannelId, activeRoom, user?.uid]);

  useEffect(() => {
    const bar = document.getElementById('room-channel-bar');
    if (window.syncRoomChannelBar) {
      window.syncRoomChannelBar();
    } else {
      const activeTab = document.querySelector('.room-tab.active')?.getAttribute('data-target');
      bar?.classList.toggle('hidden', activeRoom.id === 'global' || activeTab !== 'chat');
    }

    if (activeRoom.id === 'global') {
      setChannels([{ id: 'general', name: 'general' }]);
      setActiveChannelId('general');
      return undefined;
    }

    return onValue(ref(db, `rooms_meta/${activeRoom.id}/channels`), (snapshot) => {
      const value = snapshot.val() || {};
      const nextChannels = [
        { id: 'general', name: 'general' },
        ...Object.entries(value).map(([id, channel]) => ({ id, name: channel.name || id })),
      ];
      setChannels(nextChannels);
      if (!nextChannels.some((channel) => channel.id === activeChannelRef.current)) setActiveChannelId('general');
    });
  }, [activeRoom.id]);

  useEffect(() => {
    messagesRef.current = messages;
    updateMessageCache(messages);
  }, [messages]);

  const setTyping = useCallback((isTyping) => {
    if (!window.currentUser?.uid || !activeRoomRef.current?.id) return;
    const typingRef = ref(db, `typing/${activeRoomRef.current.id}/${window.currentUser.uid}`);

    if (isTyping) {
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
      favoriteBtn.textContent = prefs.favorite ? '★ Unfavorite Room' : '☆ Favorite Room';
      favoriteBtn.classList.toggle('active', prefs.favorite === true);
    }

    if (hideBtn) {
      hideBtn.style.display = roomId === GLOBAL_ROOM.id ? 'none' : 'block';
      hideBtn.textContent = 'Hide Room';
    }
  }, []);

  const updateRoomPreference = useCallback(async (roomId, patch) => {
    if (!user?.uid || !roomId) {
      window.showToast?.('Sign in to save room preferences.');
      return false;
    }

    if (roomId === GLOBAL_ROOM.id && patch?.hidden) {
      window.showToast?.("Global Chat can't be hidden.");
      return false;
    }

    await update(ref(db, `user_room_preferences/${user.uid}/${roomId}`), {
      ...patch,
      updatedAt: Date.now(),
    });
    return true;
  }, [user?.uid]);

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

    window.activeRoomId = nextRoom.id;
    window.activeRoomShortId = nextRoom.shortId;
    window.activeChannelId = nextChannelId;
    window.oldestMessageKey = null;
    window.isFetchingHistory = false;
    window.activeReplyData = null;

    activeRoomRef.current = nextRoom;
    activeChannelRef.current = nextChannelId;
    writeLastRoomPreference(nextRoom, nextChannelId, user?.uid);
    setHeaderRoom(nextRoom.id, nextRoom.name);
    clearRoomSearch();
    document.getElementById('desktop-room-sidebar')?.classList.remove('open');

    oldestMessageKeyRef.current = null;
    isFetchingHistoryRef.current = false;
    shouldStickToBottomRef.current = true;
    setActiveRoom(nextRoom);
    setActiveChannelId(nextChannelId);
    setMessages([]);
    setReply(null);
    setEditingId(null);
    setDraft(localStorage.getItem(`draft:${nextRoom.id}`) || '');
    setPlaceholder(`Message ${nextRoom.name}...`);
    setComposerDisabled(false);
    setSearchQuery('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFileSelected(false);

    setTimeout(() => refreshRoomPreferenceControls(), 0);
    setTimeout(() => window.onRoomChanged?.(), 0);
  }, [refreshRoomPreferenceControls, user?.uid]);

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

  const prepareReply = useCallback((id, name, text) => {
    const nextReply = { id, name, text };
    window.activeReplyData = nextReply;
    setReply(nextReply);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const cancelReply = useCallback(() => {
    window.activeReplyData = null;
    setReply(null);
  }, []);

  const switchChannel = useCallback((channelId) => {
    const nextChannelId = channelId || 'general';
    clearRoomSearch();
    setActiveChannelId(nextChannelId);
    activeChannelRef.current = nextChannelId;
    window.activeChannelId = nextChannelId;
    writeLastRoomPreference(activeRoomRef.current, nextChannelId, user?.uid);
    shouldStickToBottomRef.current = true;
  }, [user?.uid]);

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
    await set(ref(db, `rooms_meta/${activeRoomRef.current.id}/channels/${id}`), {
      name: id,
      createdAt: Date.now(),
      by: window.currentUser?.uid || '',
    });
    setActiveChannelId(id);
    window.showToast?.(`#${id} created.`, false);
  }, [requestTextDialog]);

  const displayMessage = useCallback((messageId, message, prepend = false) => {
    setMessages((current) => mergeMessage(current, messageId, message, prepend));
  }, []);

  const updateMessageEl = useCallback((messageId, message) => {
    setMessages((current) => mergeMessage(current, messageId, message));
  }, []);

  const deleteMessage = useCallback(async (messageId) => {
    const confirmed = await requestConfirmDialog({
      kicker: 'Delete',
      title: 'Delete message?',
      description: 'This removes the message for everyone in the room.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await remove(roomMessageRef(activeRoomRef.current.id, messageId, activeChannelRef.current));
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

  const saveEditedMessage = useCallback(async (messageId) => {
    const newText = editingText.trim();
    if (!newText) {
      window.showToast?.('Message cannot be empty. Use delete instead.');
      return;
    }

    try {
      await update(roomMessageRef(activeRoomRef.current.id, messageId, activeChannelRef.current), { text: newText, edited: true });
      setEditingId(null);
      setEditingText('');
    } catch (error) {
      window.showToast?.(`Edit failed: ${error.message}`);
    }
  }, [editingText]);

  const reactToMessage = useCallback(async (messageId, emoji) => {
    if (!window.currentUser?.uid) return;
    const reactionRef = roomMessageChildRef(activeRoomRef.current.id, messageId, `reactions/${window.currentUser.uid}`, activeChannelRef.current);

    const snapshot = await get(reactionRef);
    if (snapshot.exists() && snapshot.val() === emoji) {
      await remove(reactionRef);
      return;
    }

    await set(reactionRef, emoji);
    window.awardXP?.(window.currentUser.uid, 'creativity', 2);
    window.trackQuest?.('react');
  }, []);

  const addReaction = useCallback((emoji) => {
    if (!window.activeMessageId) return;
    reactToMessage(window.activeMessageId, emoji);
    document.getElementById('emoji-picker')?.classList.add('hidden');
  }, [reactToMessage]);

  const toggleEmojiPicker = useCallback((event, messageId) => {
    window.activeMessageId = messageId;
    const picker = document.getElementById('emoji-picker');
    if (!picker) return;

    picker.style.top = `${event.pageY + 10}px`;
    picker.style.left = `${event.pageX - 50}px`;
    picker.classList.remove('hidden');

    document.addEventListener('click', function hidePicker(clickEvent) {
      if (!clickEvent.target.classList.contains('more-icon')) picker.classList.add('hidden');
      document.removeEventListener('click', hidePicker);
    }, { once: true });
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
    window.addReaction = addReaction;
    window.toggleEmojiPicker = toggleEmojiPicker;
    window.setRoomFavorite = setRoomFavorite;
    window.toggleRoomFavorite = toggleRoomFavorite;
    window.toggleActiveRoomFavorite = () => toggleRoomFavorite(activeRoomRef.current);
    window.hideRoom = hideRoom;
    window.hideActiveRoom = () => hideRoom(activeRoomRef.current);
    window.unhideRoom = unhideRoom;
    window.refreshRoomPreferenceControls = refreshRoomPreferenceControls;
    window.bindChatScrolling = () => {};
    window.bindRoomTyping = () => {};
    window.loadDraft = (roomId) => setDraft(localStorage.getItem(`draft:${roomId}`) || '');
  }, [
    addReaction,
    deleteMessage,
    displayMessage,
    hideRoom,
    prepareReply,
    reactToMessage,
    registerApi,
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
    if (!user?.uid) return undefined;

    const unsubscribe = onValue(ref(db, 'rooms_meta'), (snapshot) => {
      const nextRooms = [GLOBAL_ROOM];
      const missingShortIdWrites = [];

      snapshot.forEach((child) => {
        if (child.key === 'global') return;

        const data = child.val() || {};
        const isMember = data.members && data.members[user.uid];
        const isCreator = data.creatorId === user.uid;
        if (!isMember && !isCreator) return;

        let shortId = data.shortId;
        if (!shortId) {
          shortId = window.generateShortId?.() || Math.random().toString(36).substring(2, 8).toUpperCase();
          missingShortIdWrites.push(set(ref(db, `rooms_meta/${child.key}/shortId`), shortId));
        }

        nextRooms.push({ id: child.key, ...data, shortId });
      });

      roomsRef.current = nextRooms;
      setRooms(nextRooms);

      const currentRoom = nextRooms.find((room) => room.id === activeRoomRef.current.id);
      if (!currentRoom) {
        switchRoom('global', GLOBAL_ROOM.name, GLOBAL_ROOM.shortId);
      } else if (currentRoom.name !== activeRoomRef.current.name || currentRoom.shortId !== activeRoomRef.current.shortId) {
        const updatedRoom = {
          id: currentRoom.id,
          name: currentRoom.name,
          shortId: currentRoom.shortId,
        };
        activeRoomRef.current = updatedRoom;
        setActiveRoom(updatedRoom);
        setHeaderRoom(updatedRoom.id, updatedRoom.name);
      }

      Promise.allSettled(missingShortIdWrites);
    });

    return unsubscribe;
  }, [switchRoom, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !activeRoom.id) return undefined;
    let cancelled = false;

    const loadMentionCandidates = async () => {
      const usersSnapshot = await get(ref(db, 'user_directory')).catch(() => null);
      const users = usersSnapshot?.val() || {};
      const currentRoom = roomsRef.current.find((room) => room.id === activeRoom.id);
      let memberNames = null;

      if (activeRoom.id !== 'global') {
        memberNames = currentRoom?.members || {};
        if (!Object.keys(memberNames).length) {
          const membersSnapshot = await get(ref(db, `rooms_meta/${activeRoom.id}/members`)).catch(() => null);
          memberNames = membersSnapshot?.val() || {};
        }
      }

      const entries = activeRoom.id === 'global'
        ? Object.entries(users)
        : Object.entries(memberNames || {}).map(([uid, fallbackName]) => [uid, { ...(users[uid] || {}), fallbackName }]);

      const nextCandidates = entries
        .filter(([uid]) => uid && uid !== user.uid)
        .map(([uid, profile]) => {
          const name = profile.displayName || profile.name || profile.username || profile.fallbackName || 'User';
          return {
            uid,
            name,
            shortId: profile.shortId || '',
            photoUrl: profile.photoUrl || profile.photoURL || window.getAvatarUrl?.(name, '') || '',
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
  }, [activeRoom.id, rooms, user?.uid]);

  useEffect(() => {
    const savedRoom = initialRoomPreferenceRef.current;
    if (savedRoom?.roomId) {
      switchRoom(savedRoom.roomId, savedRoom.roomName, savedRoom.shortId, { channelId: savedRoom.channelId || 'general' });
      return;
    }

    switchRoom(window.activeRoomId || GLOBAL_ROOM.id, activeRoom.name || GLOBAL_ROOM.name, window.activeRoomShortId || GLOBAL_ROOM.shortId);
    // The first room boot should happen once after this React island mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    if (!activeRoom.id) return undefined;

    const currentMessagesRef = roomMessagesRef(activeRoom.id, activeChannelId);
    const latestQuery = query(currentMessagesRef, limitToLast(30));

    setMessages([]);
    oldestMessageKeyRef.current = null;
    window.oldestMessageKey = null;
    window.isFetchingHistory = false;

    const unsubscribeAdd = onChildAdded(latestQuery, (snapshot) => {
      if (!oldestMessageKeyRef.current) {
        oldestMessageKeyRef.current = snapshot.key;
        window.oldestMessageKey = snapshot.key;
      }
      displayMessage(snapshot.key, snapshot.val(), false);
    });

    const unsubscribeChange = onChildChanged(latestQuery, (snapshot) => {
      updateMessageEl(snapshot.key, snapshot.val());
    });

    const unsubscribeRemove = onChildRemoved(latestQuery, (snapshot) => {
      setMessages((current) => current.filter((message) => message.id !== snapshot.key));
    });

    return () => {
      unsubscribeAdd();
      unsubscribeChange();
      unsubscribeRemove();
    };
  }, [activeChannelId, activeRoom.id, displayMessage, updateMessageEl]);

  useEffect(() => {
    if (!activeRoom.id || !window.currentUser?.uid) return undefined;

    setTyping(false);
    const typingRef = ref(db, `typing/${activeRoom.id}`);
    const unsubscribe = onValue(typingRef, (snapshot) => {
      const names = Object.entries(snapshot.val() || {})
        .filter(([uid]) => uid !== window.currentUser?.uid)
        .map(([, name]) => name);
      setTypingNames(names);
    });

    return () => {
      unsubscribe();
      setTyping(false);
    };
  }, [activeRoom.id, setTyping]);

  useEffect(() => {
    const searchInput = document.getElementById('room-search-input');
    if (!searchInput) return undefined;

    const handleSearch = () => setSearchQuery(searchInput.value.trim().toLowerCase());
    searchInput.addEventListener('input', handleSearch);
    handleSearch();

    return () => searchInput.removeEventListener('input', handleSearch);
  }, []);

  useEffect(() => {
    if (!listRef.current || !shouldStickToBottomRef.current || loadingHistory) return;
    listRef.current.scrollTo(0, listRef.current.scrollHeight);
  }, [loadingHistory, messages]);

  useEffect(() => {
    const jump = window.pendingMessageJump;
    if (!jump?.messageId) return;
    if (jump.roomId && jump.roomId !== activeRoom.id) return;
    if ((jump.channelId || 'general') !== activeChannelId) return;

    const target = document.getElementById(`msg-${jump.messageId}`);
    if (!target) return;

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('message-jump-highlight');
    window.setTimeout(() => target.classList.remove('message-jump-highlight'), 1800);
    window.pendingMessageJump = null;
  }, [activeChannelId, activeRoom.id, messages]);

  const handleLoadHistory = useCallback(async () => {
    const list = listRef.current;
    if (!list || isFetchingHistoryRef.current || !oldestMessageKeyRef.current) return;
    if (list.scrollTop > 0) return;

    isFetchingHistoryRef.current = true;
    window.isFetchingHistory = true;
    setLoadingHistory(true);

    try {
      const oldScrollHeight = list.scrollHeight;
      const snapshot = await get(query(
        roomMessagesRef(activeRoomRef.current.id, activeChannelRef.current),
        orderByKey(),
        endBefore(oldestMessageKeyRef.current),
        limitToLast(20),
      ));

      if (snapshot.exists()) {
        const history = [];
        snapshot.forEach((child) => {
          history.push({ id: child.key, ...child.val() });
        });

        oldestMessageKeyRef.current = history[0]?.id || oldestMessageKeyRef.current;
        window.oldestMessageKey = oldestMessageKeyRef.current;
        setMessages((current) => {
          const known = new Set(current.map((message) => message.id));
          return [...history.filter((message) => !known.has(message.id)), ...current];
        });

        requestAnimationFrame(() => {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight - oldScrollHeight;
        });
      }
    } finally {
      isFetchingHistoryRef.current = false;
      window.isFetchingHistory = false;
      setLoadingHistory(false);
    }
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    shouldStickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    if (list.scrollTop === 0) handleLoadHistory();
  }, [handleLoadHistory]);

  const handleDraftChange = useCallback((event) => {
    const value = event.target.value;
    setCursorIndex(event.target.selectionStart ?? value.length);
    setDismissedMentionKey('');
    setDraft(value);
    localStorage.setItem(`draft:${activeRoomRef.current.id}`, value);
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

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    setMentionSelectedIndex(0);
  }, [mentionToken?.query, activeRoom.id]);

  const clearComposerDraft = useCallback(() => {
    setDraft('');
    localStorage.removeItem(`draft:${activeRoomRef.current.id}`);
    setTyping(false);
  }, [setTyping]);

  const openActivityPanel = useCallback(() => {
    document.getElementById('updates-panel')?.classList.add('open');
    window.fetchGitHubUpdates?.();
  }, []);

  const focusSearch = useCallback(() => {
    const input = document.getElementById('room-search-input');
    if (!input) return window.showToast?.('Search is not ready yet.');
    input.classList.add('open');
    input.focus();
  }, []);

  const createTaskFromText = useCallback(async (text) => {
    const clean = String(text || '').trim();
    if (!clean) {
      openRoomTab('tasks');
      setTimeout(() => document.getElementById('task-input')?.focus(), 80);
      return;
    }

    await push(ref(db, `room_tasks/${activeRoomRef.current.id}`), {
      text: clean.slice(0, 240),
      status: 'todo',
      done: false,
      priority: 'medium',
      by: window.currentUser.uid,
      byName: window.userProfileName || 'Anonymous',
      assignee: window.currentUser.uid,
      assigneeName: window.userProfileName || 'Anonymous',
      createdAt: serverTimestamp(),
    });
    window.showToast?.('Task created.', false);
  }, []);

  const postStockQuote = useCallback(async (rawSymbol) => {
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
      try {
        const quote = await fetchStockQuote(nextSymbol);
        await postBotMessage(activeRoomRef.current.id, activeChannelRef.current, 'Stock Price Bot', formatStockQuote(quote), {
          stockQuote: quote,
        });
      } catch (error) {
        await postBotMessage(activeRoomRef.current.id, activeChannelRef.current, 'Stock Price Bot', `I couldn't fetch ${nextSymbol}: ${error.message}`);
      }
    }
  }, [requestTextDialog]);

  const setAutoModerationEnabled = useCallback(async (enabled) => {
    const activeId = activeRoomRef.current.id;
    if (!activeId || activeId === 'global') {
      window.showToast?.('Auto Moderation is configured per room, not Global Chat.');
      return;
    }
    if (!(await canUseRoomPermission(activeId, 'webhooks', 'Bot management is disabled in this room.'))) return;

    await set(ref(db, `rooms_meta/${activeId}/bots/autoModeration/enabled`), Boolean(enabled));
    await set(ref(db, `rooms_meta/${activeId}/logs/${Date.now()}`), {
      text: `${window.userProfileName || 'Someone'} ${enabled ? 'enabled' : 'disabled'} Auto Moderation bot.`,
      timestamp: Date.now(),
    });
    await postBotMessage(activeId, activeChannelRef.current, 'Auto Moderation Bot', enabled
      ? 'Auto Moderation is online. I’ll block configured keywords, flood text, excessive caps, and restricted links.'
      : 'Auto Moderation is now offline.');
    window.showToast?.(`Auto Moderation ${enabled ? 'enabled' : 'disabled'}.`, false);
  }, []);

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
        case 'shortcuts':
          window.showToast?.('Shortcuts: / opens commands · Enter sends · Shift+Enter new line · Esc closes command menu.', false);
          break;
        case 'feedback':
          window.location.href = 'mailto:support@minimalist.com?subject=Minimalist%20Chat%20Feedback';
          break;
        case 'attach':
          fileInputRef.current?.click();
          break;
        case 'poll':
          document.getElementById('poll-btn')?.click();
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
          openActivityPanel();
          setTimeout(() => document.getElementById('tab-leaderboard')?.click(), 80);
          break;
        case 'recognition':
          openActivityPanel();
          setTimeout(() => document.getElementById('tab-recognition')?.click(), 80);
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
          listRef.current?.scrollTo(0, listRef.current.scrollHeight);
          window.showToast?.('Jumped to the latest message.', false);
          break;
        case 'notifyAll':
          localStorage.setItem(notifyKey, 'all');
          window.showToast?.('All notifications enabled for this room.', false);
          break;
        case 'notifyMentions':
          localStorage.setItem(notifyKey, 'mentions');
          window.showToast?.('Mentions-only notifications enabled.', false);
          break;
        case 'notifyMute':
          localStorage.setItem(notifyKey, 'muted');
          window.showToast?.('Current room muted on this device.', false);
          break;
        case 'notifyDigest':
          localStorage.setItem(notifyKey, 'digest');
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
          window.showToast?.(`Keyword alert removed: ${keyword.trim()}`, false);
          break;
        }
        case 'dndOn':
          localStorage.setItem('minimalist:dnd', 'on');
          window.showToast?.('Do Not Disturb is on for this device.', false);
          break;
        case 'dndOff':
          localStorage.removeItem('minimalist:dnd');
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
          window.showToast?.('Report noted locally. A full moderation queue can be wired next.', false);
          break;
        case 'comingSoon':
        default:
          window.showToast?.(`${resolved.command} is in the command list. The full workflow is coming next.`, false);
      }
    } catch (error) {
      window.showToast?.(`Command failed: ${error.message}`);
    }

    return true;
  }, [clearComposerDraft, createTaskFromText, focusSearch, openActivityPanel, postStockQuote, requestTextDialog, setAutoModerationEnabled, setRoomFavorite]);

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
    localStorage.setItem(`draft:${activeRoomRef.current.id}`, nextDraft);
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

      if (event.key === 'Enter' && !event.shiftKey && mentionSuggestions[mentionSelectedIndex]) {
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

      if (event.key === 'Enter' && !event.shiftKey && slashCommands[slashSelectedIndex]) {
        event.preventDefault();
        runSlashCommand(slashCommands[slashSelectedIndex]);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
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
    localStorage.setItem(`draft:${activeRoomRef.current.id}`, nextDraft);
    setTyping(nextDraft.trim().length > 0);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = selectStart;
      textarea.selectionEnd = selectEnd;
    });
  }, [composerDisabled, draft, setTyping]);

  const handleFileChange = useCallback(() => {
    setFileSelected(!!fileInputRef.current?.files?.length);
  }, []);

  const canPostToCurrentRoom = useCallback(async () => {
    const activeId = activeRoomRef.current.id;

    const globalMuteSnap = await get(ref(db, `users/${window.currentUser.uid}/isMuted`));
    if (globalMuteSnap.exists() && globalMuteSnap.val() === true) {
      window.showToast?.('You have been globally muted by an Admin.');
      return false;
    }

    if (activeId !== 'global') {
      const roomMuteRef = ref(db, `rooms_meta/${activeId}/muted/${window.currentUser.uid}`);
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
    }

    return true;
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

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault();
    if (!window.currentUser?.uid) return;
    if (isSendingRef.current) return;

    const activeId = activeRoomRef.current.id;
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

    isSendingRef.current = true;
    setIsSending(true);

    try {
      if (!(await canPostToCurrentRoom())) return;

      const botConfig = await getRoomBotConfig(activeId);
      const autoModReason = activeId !== 'global' ? detectAutoModeration(text, botConfig.autoModeration) : null;
      if (autoModReason) {
        window.showToast?.(`Auto Moderation blocked this message: ${autoModReason}`);
        await postBotMessage(activeId, activeChannelRef.current, 'Auto Moderation Bot', `${window.userProfileName || 'Someone'} had a message blocked: ${autoModReason}.`, {
          moderationEvent: true,
        });
        return;
      }

      let uploadedImageUrl = null;
      let uploadedFile = null;
      const profile = getProfileSnapshot();
      let reservedUploadRef = null;
      let reservedUploadBytes = 0;

      if (file) {
        if (activeId !== 'global') {
          if (!(await canUseRoomPermission(activeId, 'files', 'File uploads are disabled in this room.'))) return;
        }

        const limits = uploadLimits[profile.tier] || uploadLimits.free;
        if (file.size > limits.perFile) {
          window.showToast?.(`${limits.label} allows up to ${formatBytes(limits.perFile)} per file.`);
          return;
        }

        reservedUploadRef = ref(db, `upload_usage/${window.currentUser.uid}/${todayKey()}`);
        reservedUploadBytes = file.size;
        const reservation = await runTransaction(reservedUploadRef, (current) => {
          const used = Number(current || 0);
          if (used + file.size > limits.daily) return;
          return used + file.size;
        });

        if (!reservation.committed) {
          window.showToast?.(`${limits.label} daily upload limit reached. Daily max is ${formatBytes(limits.daily)}.`);
          return;
        }

        const safeName = file.name.replace(/[^\w.\-()[\] ]+/g, '_');
        const target = storageRef(storage, `chat_files/${activeId}/${Date.now()}_${safeName}`);
        try {
          await uploadBytesResumable(target, file);
          const fileUrl = await getDownloadURL(target);
          if (file.type.startsWith('image/')) uploadedImageUrl = fileUrl;
          const textPreview = await readTextPreview(file);
          uploadedFile = {
            url: fileUrl,
            name: file.name,
            type: file.type || 'File',
            size: file.size,
            ...(textPreview || {}),
          };
          window.awardXP?.(window.currentUser.uid, 'creativity', 3);
        } catch (error) {
          if (reservedUploadRef && reservedUploadBytes) {
            await runTransaction(reservedUploadRef, (current) => Math.max(0, Number(current || 0) - reservedUploadBytes));
          }
          throw error;
        }
      }

      setDraft('');
      localStorage.removeItem(`draft:${activeId}`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFileSelected(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      setTyping(false);

      const payload = {
        uid: profile.uid,
        name: profile.name,
        photoUrl: profile.photoUrl,
        text,
        attachedImage: uploadedImageUrl,
        attachedFile: uploadedFile,
        timestamp: serverTimestamp(),
        tier: profile.tier,
      };

      if (reply) payload.replyTo = reply;

      const newMessageRef = push(roomMessagesRef(activeId, activeChannelRef.current));
      await set(newMessageRef, payload);

      const trackedStockSymbols = activeId !== 'global' && botConfig.stockTracker.enabled
        ? extractStockSymbols(text, botConfig.stockTracker)
        : [];
      if (trackedStockSymbols.length) {
        void Promise.all(trackedStockSymbols.map(async (symbol) => {
          try {
            const quote = await fetchStockQuote(symbol);
            await postBotMessage(activeId, activeChannelRef.current, 'Stock Price Bot', formatStockQuote(quote), {
              stockQuote: quote,
            });
          } catch (error) {
            await postBotMessage(activeId, activeChannelRef.current, 'Stock Price Bot', `I couldn't fetch ${symbol}: ${error.message}`);
          }
        })).catch((error) => console.warn('Stock bot failed', error));
      }

      if (text) {
        window.notifyMentions?.(text, activeId, {
          groupId: activeId,
          roomId: activeId,
          roomName: activeRoomRef.current.name,
          shortId: activeRoomRef.current.shortId,
          channelId: activeChannelRef.current,
          messageId: newMessageRef.key,
        });
      }
      window.bumpMessageCount?.(window.currentUser.uid);
      window.awardXP?.(window.currentUser.uid, 'technical', 2);
      window.trackQuest?.('message');

      if (activeId !== 'global') {
        const preview = text ? `${profile.name}: ${text}` : `${profile.name} sent ${file?.type?.startsWith('image/') ? 'an image' : 'a file'}`;
        await set(ref(db, `rooms_meta/${activeId}/lastMessage`), preview.length > 30 ? `${preview.substring(0, 30)}...` : preview);
      }

      cancelReply();
      shouldStickToBottomRef.current = true;
    } catch (error) {
      window.showToast?.(`Failed to send message: ${error.message}`);
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  }, [canPostToCurrentRoom, cancelReply, clearComposerDraft, draft, reply, runSlashCommand, setTyping]);

  const sendSpecialMessage = useCallback(async (extraPayload, previewText) => {
    if (!window.currentUser?.uid || isSendingRef.current) return;
    isSendingRef.current = true;
    setIsSending(true);

    try {
      if (!(await canPostToCurrentRoom())) return;
      const activeId = activeRoomRef.current.id;
      const profile = getProfileSnapshot();
      await set(push(roomMessagesRef(activeId, activeChannelRef.current)), {
        uid: profile.uid,
        name: profile.name,
        photoUrl: profile.photoUrl,
        text: '',
        timestamp: serverTimestamp(),
        tier: profile.tier,
        ...extraPayload,
      });

      if (activeId !== 'global') {
        const preview = `${profile.name}: ${previewText}`;
        await set(ref(db, `rooms_meta/${activeId}/lastMessage`), preview.length > 30 ? `${preview.substring(0, 30)}...` : preview);
      }

      window.bumpMessageCount?.(window.currentUser.uid);
      window.awardXP?.(window.currentUser.uid, 'leadership', 4);
    } catch (error) {
      window.showToast?.(`Could not send: ${error.message}`);
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  }, [canPostToCurrentRoom]);

  const createPoll = useCallback(async () => {
    if (!(await canUseRoomPermission(activeRoomRef.current.id, 'polls', 'Polls are disabled in this room.'))) return;
    setComposerDialogMode('poll');
  }, []);

  const submitPollDialog = useCallback(async ({ question, optionsText }) => {
    const cleanQuestion = String(question || '').trim();
    if (!cleanQuestion) {
      window.showToast?.('Add a poll question first.');
      return;
    }

    const options = [...new Set(String(optionsText || '').split(/[\n,]/).map((option) => option.trim()).filter(Boolean))].slice(0, 6);
    if (options.length < 2) {
      window.showToast?.('A poll needs at least two options.');
      return;
    }

    await sendSpecialMessage({
      poll: {
        question: cleanQuestion.slice(0, 180),
        options: options.map((option, index) => ({ id: `o${index}`, text: option.slice(0, 80) })),
        createdAt: Date.now(),
      },
    }, `Poll: ${cleanQuestion}`);
    setComposerDialogMode(null);
    window.showToast?.('Poll posted.', false);
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
    try {
      await set(roomMessageChildRef(activeRoomRef.current.id, messageId, `poll/votes/${window.currentUser.uid}`, activeChannelRef.current), optionId);
    } catch (error) {
      window.showToast?.(`Vote failed: ${error.message}`);
    }
  }, []);

  const pickSmartReply = useCallback((suggestion) => {
    setDraft(suggestion);
    localStorage.setItem(`draft:${activeRoomRef.current.id}`, suggestion);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const typingText = useMemo(() => {
    if (typingNames.length === 1) return `${typingNames[0]} is typing...`;
    if (typingNames.length === 2) return `${typingNames[0]} and ${typingNames[1]} are typing...`;
    return `${typingNames.length} people are typing...`;
  }, [typingNames]);

  const smartReplies = useMemo(() => (draft.trim() || composerDisabled ? [] : buildSmartReplies(messages)), [composerDisabled, draft, messages]);

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
            onSwitchRoom={switchRoom}
            onToggleFavorite={toggleRoomFavorite}
            onUnhideRoom={unhideRoom}
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
            onSwitchChannel={switchChannel}
          />,
          channelHost,
        )
      ) : null}

      <div id="loading-history" className={loadingHistory ? '' : 'hidden'}>Loading history...</div>
      <ul id="messages" onScroll={handleMessagesScroll} ref={listRef}>
        {messages.map((message, index) => (
          <MessageItem
            animationIndex={index}
            editingId={editingId}
            editingText={editingText}
            key={message.id}
            message={message}
            onCancelEdit={() => {
              setEditingId(null);
              setEditingText('');
            }}
            onDelete={deleteMessage}
            onEditingText={setEditingText}
            onPrepareReply={prepareReply}
            onReact={reactToMessage}
            onSaveReminder={saveReminder}
            onSaveEdit={saveEditedMessage}
            onStartEdit={startEditMessage}
            onVotePoll={votePoll}
            searchQuery={searchQuery}
          />
        ))}
      </ul>

      <div id="typing-status-container" className={typingNames.length ? '' : 'hidden'}>
        <div className="typing-dots"><div className="dot" /><div className="dot" /><div className="dot" /></div>
        <span id="typing-text">{typingText}</span>
      </div>

      <div id="active-reply-box" className={reply ? '' : 'hidden'}>
        <div className="active-reply-content">
          <strong className="active-reply-label">↩ <span id="replying-to-name">{reply?.name || ''}</span></strong>
          <span id="replying-to-text">{reply?.text?.length > 40 ? `${reply.text.substring(0, 40)}...` : reply?.text || ''}</span>
        </div>
        <span className="cancel-reply" id="cancel-reply-btn" onClick={cancelReply}>✖</span>
      </div>

      <SmartReplies suggestions={smartReplies} onPick={pickSmartReply} />
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

      <form action="" id="chat-form" onSubmit={handleSubmit}>
        <input
          className="hidden"
          id="image-input"
          onChange={handleFileChange}
          ref={fileInputRef}
          type="file"
        />
        <div className="composer-input-row">
          <textarea
            disabled={composerDisabled || isSending}
            id="message-input"
            onClick={(event) => setCursorIndex(event.currentTarget.selectionStart ?? draft.length)}
            onChange={handleDraftChange}
            onKeyDown={handleTextareaKeyDown}
            onKeyUp={(event) => setCursorIndex(event.currentTarget.selectionStart ?? draft.length)}
            onSelect={(event) => setCursorIndex(event.currentTarget.selectionStart ?? draft.length)}
            placeholder={isSending ? 'Sending…' : placeholder}
            ref={textareaRef}
            rows={1}
            value={draft}
          />
          <button
            className="composer-send-btn"
            disabled={isSending || composerDisabled}
            id="mobile-send-btn"
            title="Send message"
            aria-label="Send message"
            type="submit"
          >
            <i className="ph-bold ph-arrow-right" />
          </button>
        </div>
        <div className="composer-toolbar">
          <div className="composer-tool-group" aria-label="Message tools">
            <button
              className={`composer-icon-btn ${fileSelected ? 'active' : ''}`}
              disabled={isSending || composerDisabled}
              id="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach file"
              aria-label="Attach file"
              type="button"
            >
              <i className="ph-bold ph-paperclip" />
            </button>
            <button
              className="composer-icon-btn"
              disabled={isSending || composerDisabled}
              id="inline-code-btn"
              onClick={() => insertCodeSnippet('inline')}
              title="Inline code"
              aria-label="Inline code"
              type="button"
            >
              <i className="ph-bold ph-code" />
            </button>
            <button
              className="composer-icon-btn"
              disabled={isSending || composerDisabled}
              id="code-block-btn"
              onClick={() => insertCodeSnippet('block')}
              title="Code block"
              aria-label="Code block"
              type="button"
            >
              <i className="ph-bold ph-brackets-curly" />
            </button>
            <button
              className="composer-icon-btn"
              disabled={isSending || composerDisabled}
              id="poll-btn"
              onClick={createPoll}
              title="Create poll"
              aria-label="Create poll"
              type="button"
            >
              <i className="ph-bold ph-chart-bar" />
            </button>
            <button
              className="composer-icon-btn"
              disabled={isSending || composerDisabled}
              id="reminder-btn"
              onClick={createReminder}
              title="Create reminder"
              aria-label="Create reminder"
              type="button"
            >
              <i className="ph-bold ph-alarm" />
            </button>
          </div>
          <span className="composer-hint">Enter ↵ send · Shift+Enter new line</span>
        </div>
      </form>
    </>
  );
}
