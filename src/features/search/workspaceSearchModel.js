const FILTER_KEYS = new Set([
  'after',
  'author',
  'before',
  'channel',
  'date',
  'from',
  'has',
  'in',
  'is',
  'mentions',
  'on',
  'room',
]);

const HAS_ALIASES = Object.freeze({
  attachment: 'attachment',
  attachments: 'attachment',
  file: 'attachment',
  files: 'attachment',
  image: 'attachment',
  images: 'attachment',
  link: 'link',
  links: 'link',
  mention: 'mention',
  mentions: 'mention',
  poll: 'poll',
  polls: 'poll',
  reply: 'thread',
  replies: 'thread',
  thread: 'thread',
  threads: 'thread',
});

const URL_PATTERN = /https?:\/\/[^\s<]+/i;
const MENTION_PATTERN = /(^|[\s([{])@[a-z0-9_.-]{1,80}\b/i;

function clean(value) {
  return String(value ?? '').trim().toLowerCase();
}

function trimWrappingQuotes(value) {
  const text = String(value || '').trim();
  if (text.length >= 2 && (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
  )) {
    return text.slice(1, -1);
  }
  return text;
}

function tokenizeQuery(value) {
  return String(value || '').match(/[^\s"']+:"[^"]*"|[^\s"']+:'[^']*'|"[^"]*"|'[^']*'|\S+/g) || [];
}

function addFilter(filters, key, value) {
  const normalized = clean(value);
  if (!normalized) return false;
  if (key === 'room' || key === 'in') filters.rooms.push(normalized);
  else if (key === 'channel') filters.channels.push(normalized.replace(/^#/, ''));
  else if (key === 'from' || key === 'author') filters.authors.push(normalized.replace(/^@/, ''));
  else if (key === 'has') {
    const type = HAS_ALIASES[normalized];
    if (!type) return false;
    filters.has.push(type);
  } else if (key === 'is' && HAS_ALIASES[normalized] === 'thread') {
    filters.has.push('thread');
  } else if (key === 'mentions') {
    filters.mentions.push(normalized.replace(/^@/, ''));
  } else if (key === 'after' || key === 'before' || key === 'date' || key === 'on') {
    if (dateStart(normalized) === null) return false;
    if (key === 'after') filters.after = normalized;
    else if (key === 'before') filters.before = normalized;
    else filters.on = normalized;
  } else {
    return false;
  }
  return true;
}

/**
 * Parse a compact, Slack-style workspace query.
 *
 * Supported filters:
 * room:/in:, channel:, from:/author:, after:, before:, date:/on:,
 * has:attachment|link|poll|mention|thread, and mentions:me|handle.
 */
export function parseWorkspaceSearchQuery(value) {
  const filters = {
    rooms: [],
    channels: [],
    authors: [],
    has: [],
    mentions: [],
    after: '',
    before: '',
    on: '',
  };
  const textTerms = [];

  tokenizeQuery(value).forEach((token) => {
    const colonIndex = token.indexOf(':');
    if (colonIndex > 0) {
      const key = clean(token.slice(0, colonIndex));
      const filterValue = trimWrappingQuotes(token.slice(colonIndex + 1));
      if (FILTER_KEYS.has(key) && filterValue) {
        if (addFilter(filters, key, filterValue)) return;
      }
    }
    const term = clean(trimWrappingQuotes(token));
    if (term) textTerms.push(term);
  });

  filters.rooms = [...new Set(filters.rooms)];
  filters.channels = [...new Set(filters.channels)];
  filters.authors = [...new Set(filters.authors)];
  filters.has = [...new Set(filters.has)];
  filters.mentions = [...new Set(filters.mentions)];

  return {
    raw: String(value || '').trim(),
    text: textTerms.join(' '),
    textTerms,
    filters,
    dateBounds: {
      after: dateStart(filters.after),
      before: dateStart(filters.before),
      on: dateStart(filters.on),
    },
    hasFilters: Boolean(
      filters.rooms.length
      || filters.channels.length
      || filters.authors.length
      || filters.has.length
      || filters.mentions.length
      || filters.after
      || filters.before
      || filters.on
    ),
  };
}

function dateStart(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, month, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month
    || parsed.getDate() !== day
  ) return null;
  return parsed.getTime();
}

function includesEveryFilter(candidates, filters) {
  if (!filters.length) return true;
  const normalized = candidates.map(clean).filter(Boolean);
  return filters.every((filter) => normalized.some((candidate) => candidate.includes(filter)));
}

function pollText(poll) {
  if (!poll || typeof poll !== 'object') return '';
  const options = Array.isArray(poll.options)
    ? poll.options
    : Object.values(poll.options || {});
  return [
    poll.question,
    ...options.map((option) => (typeof option === 'string' ? option : option?.text)),
  ].filter(Boolean).join(' ');
}

function messageSearchText(message) {
  return clean([
    message.text,
    message.name,
    message.roomName,
    message.shortId,
    message.channelName,
    message.channelId,
    message.attachedFile?.name,
    message.attachedFile?.textPreview,
    message.linkPreview?.domain,
    message.linkPreview?.title,
    message.linkPreview?.description,
    pollText(message.poll),
    message.replyTo?.name,
    message.replyTo?.text,
  ].filter(Boolean).join(' '));
}

function hasAttachment(message) {
  return Boolean(
    message.attachedImage
    || message.attachedFile
    || message.attachment
    || message.file
    || message.imageUrl
  );
}

function hasLink(message) {
  return Boolean(message.linkPreview || URL_PATTERN.test(String(message.text || '')));
}

function hasMention(message) {
  const mentions = message.mentions;
  if (Array.isArray(mentions) && mentions.length) return true;
  if (mentions && typeof mentions === 'object' && Object.keys(mentions).length) return true;
  return MENTION_PATTERN.test(String(message.text || ''));
}

function hasThread(message) {
  return Boolean(
    message.replyTo
    || message.threadId
    || message.threadRootId
    || message.parentMessageId
  );
}

function messageHasType(message, type) {
  if (type === 'attachment') return hasAttachment(message);
  if (type === 'link') return hasLink(message);
  if (type === 'poll') return Boolean(message.poll);
  if (type === 'mention') return hasMention(message);
  if (type === 'thread') return hasThread(message);
  return true;
}

function mentionCandidates(message) {
  const candidates = [];
  const mentions = message.mentions;
  if (Array.isArray(mentions)) {
    mentions.forEach((mention) => {
      if (typeof mention === 'string') candidates.push(mention);
      else candidates.push(mention?.uid, mention?.name, mention?.shortId, mention?.handle);
    });
  } else if (mentions && typeof mentions === 'object') {
    Object.entries(mentions).forEach(([key, mention]) => {
      candidates.push(key);
      if (typeof mention === 'string') candidates.push(mention);
      else candidates.push(mention?.uid, mention?.name, mention?.shortId, mention?.handle);
    });
  }
  const text = String(message.text || '');
  for (const match of text.matchAll(/@([a-z0-9_.-]{1,80})\b/gi)) candidates.push(match[1]);
  return candidates.map(clean).filter(Boolean);
}

function matchesMentions(message, filters, viewer = {}) {
  if (!filters.length) return true;
  const candidates = mentionCandidates(message);
  const viewerCandidates = [
    viewer.uid,
    viewer.name,
    viewer.shortId,
    viewer.handle,
  ].map((value) => clean(value).replace(/^@/, '')).filter(Boolean);

  return filters.every((filter) => {
    const expected = filter === 'me' ? viewerCandidates : [filter];
    return expected.some((value) => candidates.some((candidate) => candidate === value));
  });
}

function matchesDateFilters(message, filters, dateBounds = {}) {
  const timestamp = Number(message.timestamp || message.ts || message.createdAt || 0);
  if (!timestamp) return !(filters.after || filters.before || filters.on);

  const after = dateBounds.after !== undefined ? dateBounds.after : dateStart(filters.after);
  if (after !== null && timestamp < after) return false;

  const before = dateBounds.before !== undefined ? dateBounds.before : dateStart(filters.before);
  if (before !== null && timestamp >= before) return false;

  const on = dateBounds.on !== undefined ? dateBounds.on : dateStart(filters.on);
  if (on !== null) {
    const nextDay = new Date(on);
    nextDay.setDate(nextDay.getDate() + 1);
    if (timestamp < on || timestamp >= nextDay.getTime()) return false;
  }

  return true;
}

export function messageMatchesWorkspaceQuery(message, parsedQuery, options = {}) {
  const parsed = parsedQuery?.filters ? parsedQuery : parseWorkspaceSearchQuery(parsedQuery);
  const { filters, textTerms } = parsed;

  if (!textTerms.every((term) => messageSearchText(message).includes(term))) return false;
  if (!includesEveryFilter(
    [message.roomName, message.room, message.roomId, message.shortId],
    filters.rooms,
  )) return false;
  if (!includesEveryFilter(
    [message.channelName, message.channelId],
    filters.channels,
  )) return false;
  if (!includesEveryFilter(
    [message.name, message.uid, message.authorShortId, message.authorHandle],
    filters.authors,
  )) return false;
  if (!filters.has.every((type) => messageHasType(message, type))) return false;
  if (!matchesMentions(message, filters.mentions, options.viewer)) return false;
  return matchesDateFilters(message, filters, parsed.dateBounds);
}

export function filterWorkspaceMessages(messages, parsedQuery, options = {}) {
  const parsed = parsedQuery?.filters ? parsedQuery : parseWorkspaceSearchQuery(parsedQuery);
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => messageMatchesWorkspaceQuery(message, parsed, options))
    .sort((left, right) => (
      Number(right.timestamp || 0) - Number(left.timestamp || 0)
      || String(right.id || '').localeCompare(String(left.id || ''))
    ));
}

function messageIdentity(message) {
  return [
    message.room || message.roomId || 'global',
    message.channelId || 'general',
    message.id || message.messageId || '',
  ].join(':');
}

/**
 * Merge independently paged room/channel indexes without duplicate messages.
 * Incoming fields win so a refreshed page can update edited messages.
 */
export function mergeWorkspaceMessagePages(currentMessages, incomingMessages) {
  const byId = new Map();
  (Array.isArray(currentMessages) ? currentMessages : []).forEach((message) => {
    byId.set(messageIdentity(message), message);
  });
  (Array.isArray(incomingMessages) ? incomingMessages : []).forEach((message) => {
    const key = messageIdentity(message);
    byId.set(key, { ...(byId.get(key) || {}), ...message });
  });
  return [...byId.values()].sort((left, right) => (
    Number(right.timestamp || 0) - Number(left.timestamp || 0)
    || messageIdentity(right).localeCompare(messageIdentity(left))
  ));
}

export function buildMessageJumpContext(message, queryText = '') {
  return {
    messageId: message.messageId || message.id,
    roomId: message.room || message.roomId || 'global',
    roomName: message.roomName || message.name || 'Room',
    shortId: message.shortId || '',
    channelId: message.channelId || 'general',
    channelName: message.channelName || message.channelId || 'general',
    source: 'workspace-search',
    messageText: message.text || '',
    messageTimestamp: Number(message.timestamp || 0),
    searchQuery: String(queryText || '').trim(),
  };
}

export function describeWorkspaceSearchFilters(parsedQuery) {
  const parsed = parsedQuery?.filters ? parsedQuery : parseWorkspaceSearchQuery(parsedQuery);
  const { filters } = parsed;
  return [
    ...filters.rooms.map((value) => `Room: ${value}`),
    ...filters.channels.map((value) => `Channel: #${value}`),
    ...filters.authors.map((value) => `From: ${value}`),
    ...(filters.after ? [`After: ${filters.after}`] : []),
    ...(filters.before ? [`Before: ${filters.before}`] : []),
    ...(filters.on ? [`Date: ${filters.on}`] : []),
    ...filters.has.map((value) => `Has: ${value}`),
    ...filters.mentions.map((value) => `Mentions: ${value}`),
  ];
}
