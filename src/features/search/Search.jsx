import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { getAuthedJsonHeaders } from '../../lib/authToken.js';
import {
  buildMessageJumpContext,
  describeWorkspaceSearchFilters,
  filterWorkspaceMessages,
  parseWorkspaceSearchQuery,
} from './workspaceSearchModel.js';
import {
  loadOlderWorkspaceMessages,
  loadWorkspacePeopleDirectory,
  loadWorkspaceSearchIndex,
} from './workspaceSearchService.js';
import './search.css';

const EMPTY_SEARCH_META = {
  hasMore: false,
  loadedMessageCount: 0,
  messageMatchCount: 0,
  sourceCount: 0,
  failedSourceCount: 0,
};
const EMPTY_SEARCH_RESULTS = {
  query: '',
  rooms: [],
  people: [],
  messages: [],
  meta: EMPTY_SEARCH_META,
  error: '',
};
const ROOM_SEARCH_ENDPOINT = () => window.ROOM_SEARCH_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/searchDiscoverableRooms';
const JOIN_DISCOVERABLE_ROOM_ENDPOINT = () => window.JOIN_DISCOVERABLE_ROOM_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/joinDiscoverableRoom';
const MESSAGE_RESULT_LIMIT = 80;
const QUICK_MESSAGE_FILTERS = [
  {
    token: 'has:attachment',
    aliases: ['has:attachment', 'has:attachments', 'has:file', 'has:files', 'has:image', 'has:images'],
    label: 'Files',
    icon: 'ph-paperclip',
    type: 'attachment',
  },
  {
    token: 'has:link',
    aliases: ['has:link', 'has:links'],
    label: 'Links',
    icon: 'ph-link',
    type: 'link',
  },
  {
    token: 'has:poll',
    aliases: ['has:poll', 'has:polls'],
    label: 'Polls',
    icon: 'ph-chart-bar',
    type: 'poll',
  },
  {
    token: 'has:mention',
    aliases: ['has:mention', 'has:mentions'],
    label: 'Mentions',
    icon: 'ph-at',
    type: 'mention',
  },
  {
    token: 'has:thread',
    aliases: ['has:thread', 'has:threads', 'has:reply', 'has:replies', 'is:thread'],
    label: 'Threads',
    icon: 'ph-chats-circle',
    type: 'thread',
  },
];
const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_YEAR_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});
const OTHER_YEAR_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function highlightedParts(value, queryText) {
  const text = String(value || '');
  const terms = [...new Set(String(queryText || '').trim().toLowerCase().split(/\s+/).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  if (!text || !terms.length) return [{ text, match: false }];

  const lowerText = text.toLowerCase();
  const ranges = [];
  terms.forEach((term) => {
    let start = 0;
    let index = lowerText.indexOf(term, start);
    while (index !== -1) {
      ranges.push([index, index + term.length]);
      start = index + term.length;
      index = lowerText.indexOf(term, start);
    }
  });

  if (!ranges.length) return [{ text, match: false }];

  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  ranges.forEach(([start, end]) => {
    const previous = merged[merged.length - 1];
    if (previous && start <= previous[1]) {
      previous[1] = Math.max(previous[1], end);
    } else {
      merged.push([start, end]);
    }
  });

  const parts = [];
  let cursor = 0;
  merged.forEach(([start, end]) => {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    cursor = end;
  });
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}

function HighlightText({ queryText, text }) {
  return highlightedParts(text, queryText).map((part, index) => (
    part.match ? <mark key={`${part.text}-${index}`} className="search-match">{part.text}</mark> : <span key={`${part.text}-${index}`}>{part.text}</span>
  ));
}

async function authHeaders() {
  if (!window.currentUser?.getIdToken) throw new Error('Please sign in again before searching rooms.');
  return getAuthedJsonHeaders('Please sign in again before searching rooms.');
}

async function joinDiscoverableRoom(room) {
  if (!window.currentUser?.uid || !room?.id) throw new Error('Please sign in again before joining rooms.');
  const response = await fetch(JOIN_DISCOVERABLE_ROOM_ENDPOINT(), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      roomId: room.id,
      displayName: window.userProfileName || 'Anonymous',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not join room.');
  return data?.room || room;
}

async function searchDiscoverableRooms(queryText, signal) {
  if (!window.currentUser?.uid) return [];
  const response = await fetch(ROOM_SEARCH_ENDPOINT(), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ query: queryText }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not search discoverable rooms.');
  return Array.isArray(data.rooms) ? data.rooms : [];
}

function matchRank(value, queryText) {
  const text = String(value || '').toLowerCase();
  if (text === queryText) return 0;
  if (text.startsWith(queryText)) return 1;
  return 2;
}

function matchesAllTerms(value, terms) {
  const text = String(value || '').toLowerCase();
  return terms.every((term) => text.includes(term));
}

function toggleQueryToken(value, filter) {
  const tokens = String(value || '').trim().split(/\s+/).filter(Boolean);
  const aliases = new Set(filter.aliases);
  const without = tokens.filter((item) => !aliases.has(item.toLowerCase()));
  return without.length === tokens.length
    ? [...tokens, filter.token].join(' ')
    : without.join(' ');
}

async function runSearch(queryValue, getAvatarUrl, signal, { loadOlder = false } = {}) {
  const uid = window.currentUser?.uid;
  if (!uid) return EMPTY_SEARCH_RESULTS;
  const parsedQuery = parseWorkspaceSearchQuery(queryValue);
  const queryText = parsedQuery.text;
  const [workspaceIndex, discoverableRooms, users] = await Promise.all([
    loadOlder ? loadOlderWorkspaceMessages(uid) : loadWorkspaceSearchIndex(uid),
    queryText.length >= 2 ? searchDiscoverableRooms(queryText, signal).catch((error) => {
      if (error?.name === 'AbortError') throw error;
      return [];
    }) : [],
    loadWorkspacePeopleDirectory(uid),
  ]);

  const roomTerms = parsedQuery.textTerms.length
    ? parsedQuery.textTerms
    : parsedQuery.filters.rooms;
  const rooms = [];
  workspaceIndex.rooms.forEach((room) => {
    const searchableText = [
      room.name,
      room.shortId,
      room.topic,
      room.category,
    ].filter(Boolean).join(' ');
    if (roomTerms.length && matchesAllTerms(searchableText, roomTerms)) {
      rooms.push({
        id: room.id,
        name: room.name || 'Room',
        shortId: room.shortId || '',
        mine: true,
        discoverable: false,
        category: '',
        topic: '',
        recommended: true,
      });
    }
  });
  discoverableRooms.forEach((room) => {
    const roomId = room.id || room.key;
    if (!roomId || rooms.some((existing) => existing.id === roomId)) return;
    rooms.push({
      id: roomId,
      name: room.name || 'Room',
      shortId: room.shortId || '',
      mine: false,
      discoverable: true,
      category: room.category || '',
      topic: room.topic || '',
      recommended: room.recommended !== false,
      lastMessage: room.lastMessage || '',
      creatorId: room.creatorId || '',
    });
  });

  const people = [];
  const peopleTerms = parsedQuery.textTerms.length
    ? parsedQuery.textTerms
    : parsedQuery.filters.authors;
  Object.entries(users || {}).forEach(([id, user]) => {
    if (id === uid) return;
    const searchableText = `${user.displayName || ''} ${user.shortId || ''}`;
    if (peopleTerms.length && matchesAllTerms(searchableText, peopleTerms)) {
      people.push({
        id,
        name: user.displayName || 'Unknown',
        photo: user.photoUrl || '',
        shortId: user.shortId || '',
        avatar: getAvatarUrl?.(user.displayName, user.photoUrl) || '',
      });
    }
  });

  const messageMatches = filterWorkspaceMessages(workspaceIndex.messages, parsedQuery, {
    viewer: {
      uid,
      name: window.userProfileName || window.currentUser?.displayName || '',
      shortId: window.userShortId || window.currentUserShortId || '',
    },
  });
  const messages = messageMatches.slice(0, MESSAGE_RESULT_LIMIT);
  rooms.sort((a, b) => matchRank(a.name, queryText) - matchRank(b.name, queryText) || a.name.localeCompare(b.name));
  people.sort((a, b) => matchRank(a.name, queryText) - matchRank(b.name, queryText) || a.name.localeCompare(b.name));
  return {
    rooms: rooms.slice(0, 20),
    people: people.slice(0, 20),
    messages,
    meta: {
      hasMore: workspaceIndex.hasMore,
      loadedMessageCount: workspaceIndex.loadedMessageCount,
      messageMatchCount: messageMatches.length,
      sourceCount: workspaceIndex.sourceCount,
      failedSourceCount: workspaceIndex.failedSourceCount,
    },
  };
}

function ResultItem({ active = false, children, disabled = false, icon, index = 0, kind = 'result', onClick, onHover }) {
  return (
    <button
      type="button"
      className={`search-item search-item-${kind} ${active ? 'is-active' : ''}`}
      onClick={onClick}
      onMouseEnter={onHover}
      disabled={disabled}
      data-search-index={index}
      aria-current={active ? 'true' : undefined}
    >
      <span className="search-item-icon">{icon}</span>
      {children}
      <i className="ph-bold ph-arrow-up-right search-item-arrow" aria-hidden="true" />
    </button>
  );
}

function Section({ children, count, icon, kind = 'results', title }) {
  return (
    <section className={`search-section-block search-section-${kind}`}>
      <div className="search-section">
        <span><i className={icon} aria-hidden="true" /> {title}</span>
        <strong>{count}</strong>
      </div>
      <div className="search-section-results">{children}</div>
    </section>
  );
}

function SearchState({ body, icon, title }) {
  return (
    <div className="search-state">
      <div className="search-state-icon"><i className={icon} aria-hidden="true" /></div>
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function formatMessageDate(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return '';
  return (new Date(value).getFullYear() === CURRENT_YEAR
    ? CURRENT_YEAR_DATE_FORMATTER
    : OTHER_YEAR_DATE_FORMATTER
  ).format(value);
}

export function Search({ getAvatarUrl, initialOpen = false }) {
  const [open, setOpen] = useState(() => Boolean(initialOpen));
  const [searchText, setSearchText] = useState('');
  const [activeScope, setActiveScope] = useState('all');
  const [results, setResults] = useState(EMPTY_SEARCH_RESULTS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [joiningId, setJoiningId] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const deferredSearchText = useDeferredValue(searchText);
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const openRef = useRef(false);
  const returnFocusRef = useRef(null);
  const requestedReturnFocusRef = useRef(null);
  const searchRequestVersionRef = useRef(0);
  const loadOlderControllerRef = useRef(null);

  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    const openButtons = [
      document.getElementById('open-search-btn'),
      document.getElementById('open-search-btn-mobile'),
    ].filter(Boolean);
    // Clicking the nav icon toggles: open if closed, close if already open.
    const toggleSearch = (event) => {
      if (openRef.current) { setOpen(false); return; }
      requestedReturnFocusRef.current = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      setSearchText('');
      setActiveScope('all');
      setResults(EMPTY_SEARCH_RESULTS);
      setActiveIndex(0);
      setJoiningId('');
      setLoadingOlder(false);
      setOpen(true);
    };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    const closeFromBackdrop = () => setOpen(false);
    openButtons.forEach((button) => button.addEventListener('click', toggleSearch));
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('minimalist:close-search', closeFromBackdrop);
    return () => {
      openButtons.forEach((button) => button.removeEventListener('click', toggleSearch));
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('minimalist:close-search', closeFromBackdrop);
    };
  }, []);

  useEffect(() => {
    const modal = document.getElementById('search-modal');
    const openButtons = [
      document.getElementById('open-search-btn'),
      document.getElementById('open-search-btn-mobile'),
    ].filter(Boolean);
    const visibleOpenButton = openButtons.find((button) => button.offsetParent !== null)
      || document.getElementById('open-more-btn-mobile')
      || openButtons[0];
    let focusFrame = 0;
    modal?.classList.toggle('hidden', !open);
    modal?.setAttribute('aria-hidden', open ? 'false' : 'true');
    openButtons.forEach((button) => button.setAttribute('aria-expanded', open ? 'true' : 'false'));
    if (open) {
      const requestedReturnFocus = requestedReturnFocusRef.current;
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      returnFocusRef.current = requestedReturnFocus && requestedReturnFocus.offsetParent !== null
        ? requestedReturnFocus
        : activeElement && activeElement.offsetParent !== null
          ? activeElement
          : visibleOpenButton;
      const siblings = [...(modal?.parentElement?.children || [])].filter((element) => element !== modal);
      siblings.forEach((element) => {
        element.dataset.searchPreviousAriaHidden = element.getAttribute('aria-hidden') ?? '';
        element.inert = true;
        element.setAttribute('aria-hidden', 'true');
      });
      focusFrame = window.requestAnimationFrame(() => {
        focusFrame = 0;
        inputRef.current?.focus();
      });
      return () => {
        if (focusFrame) window.cancelAnimationFrame(focusFrame);
        siblings.forEach((element) => {
          element.inert = false;
          const previous = element.dataset.searchPreviousAriaHidden;
          if (previous) element.setAttribute('aria-hidden', previous);
          else element.removeAttribute('aria-hidden');
          delete element.dataset.searchPreviousAriaHidden;
        });
      };
    } else if (returnFocusRef.current && document.contains(returnFocusRef.current)) {
      returnFocusRef.current.focus();
      requestedReturnFocusRef.current = null;
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    const queryValue = deferredSearchText.trim();
    const queryKey = queryValue.toLowerCase();
    loadOlderControllerRef.current?.abort();
    loadOlderControllerRef.current = null;
    if (!open || queryKey.length < 2) {
      searchRequestVersionRef.current += 1;
      const resetTimer = window.setTimeout(() => setLoadingOlder(false), 0);
      return () => window.clearTimeout(resetTimer);
    }
    const requestVersion = searchRequestVersionRef.current + 1;
    searchRequestVersionRef.current = requestVersion;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingOlder(false);
      try {
        const nextResults = await runSearch(queryValue, getAvatarUrl, controller.signal);
        if (active && searchRequestVersionRef.current === requestVersion) {
          setResults({ ...nextResults, query: queryKey, error: '' });
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (active && searchRequestVersionRef.current === requestVersion) {
          setResults({
            query: queryKey,
            rooms: [],
            people: [],
            messages: [],
            meta: EMPTY_SEARCH_META,
            error: `Search failed: ${error.message}`,
          });
        }
      }
    }, 180);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [deferredSearchText, getAvatarUrl, open]);

  useEffect(() => {
    if (!open) return undefined;
    const trapFocus = (event) => {
      if (event.key !== 'Tab' || !rootRef.current) return;
      const focusable = [...rootRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')]
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => document.removeEventListener('keydown', trapFocus);
  }, [open]);

  const close = () => setOpen(false);
  const goToRoom = async (room) => {
    if (!room.mine && room.discoverable && window.currentUser?.uid) {
      if (joiningId === room.id) return;
      setJoiningId(room.id);
      try {
        room = await joinDiscoverableRoom(room);
        window.showToast?.(`Joined ${room.name}.`, false);
      } catch (error) {
        window.showToast?.(error.message || 'Could not join room.');
        setJoiningId('');
        return;
      }
    }
    close();
    const roomId = room.id || room.room;
    if (room.messageId) {
      const jump = buildMessageJumpContext(room, deferredSearchText);
      window.pendingMessageJump = jump;
      window.switchRoom?.(jump.roomId, jump.roomName, jump.shortId, { channelId: jump.channelId });
      window.dispatchEvent(new CustomEvent('minimalist:message-jump', { detail: jump }));
    } else {
      window.switchRoom?.(roomId, room.name || room.roomName, room.shortId);
    }
    if (room.room) window.setTimeout(() => document.querySelector('.room-tab[data-target="chat"]')?.click(), 400);
  };
  const viewPerson = (person) => { close(); window.viewUserProfile?.(person.id); };
  const queryValue = deferredSearchText.trim();
  const queryText = queryValue.toLowerCase();
  const parsedQuery = useMemo(
    () => parseWorkspaceSearchQuery(queryValue),
    [queryValue],
  );
  const highlightQueryText = parsedQuery.text;
  const filterLabels = useMemo(
    () => describeWorkspaceSearchFilters(parsedQuery),
    [parsedQuery],
  );
  const inputStale = searchText !== deferredSearchText;
  const queryReady = queryText.length >= 2;
  const activeResults = queryReady ? results : EMPTY_SEARCH_RESULTS;
  const searching = queryReady && (results.query !== queryText || inputStale);
  const hasResults = activeResults.rooms.length || activeResults.people.length || activeResults.messages.length;
  const canShowResults = queryText.length >= 2 && !searching;

  const messageMatchCount = Number(activeResults.meta?.messageMatchCount ?? activeResults.messages.length);
  const resultCount = activeResults.rooms.length + activeResults.people.length + messageMatchCount;
  const visibleRooms = activeScope === 'all' || activeScope === 'rooms';
  const visiblePeople = activeScope === 'all' || activeScope === 'people';
  const visibleMessages = activeScope === 'all' || activeScope === 'messages';
  const flatResults = useMemo(() => [
    ...(visibleRooms ? activeResults.rooms.map((item) => ({ type: 'room', item })) : []),
    ...(visiblePeople ? activeResults.people.map((item) => ({ type: 'person', item })) : []),
    ...(visibleMessages ? activeResults.messages.map((item) => ({ type: 'message', item })) : []),
  ], [activeResults.messages, activeResults.people, activeResults.rooms, visibleMessages, visiblePeople, visibleRooms]);
  const visibleResultCount =
    (visibleRooms ? activeResults.rooms.length : 0) +
    (visiblePeople ? activeResults.people.length : 0) +
    (visibleMessages ? activeResults.messages.length : 0);
  const hasVisibleResults = visibleResultCount > 0;
  const peopleOffset = visibleRooms ? activeResults.rooms.length : 0;
  const messagesOffset = peopleOffset + (visiblePeople ? activeResults.people.length : 0);
  const safeActiveIndex = flatResults.length ? Math.min(activeIndex, flatResults.length - 1) : 0;

  const loadOlderMessages = async () => {
    if (loadingOlder || !activeResults.meta?.hasMore || !window.currentUser?.uid) return;
    loadOlderControllerRef.current?.abort();
    const controller = new AbortController();
    loadOlderControllerRef.current = controller;
    const requestVersion = searchRequestVersionRef.current + 1;
    searchRequestVersionRef.current = requestVersion;
    setLoadingOlder(true);
    try {
      const nextResults = await runSearch(
        deferredSearchText.trim(),
        getAvatarUrl,
        controller.signal,
        { loadOlder: true },
      );
      if (searchRequestVersionRef.current === requestVersion) {
        setResults({ ...nextResults, query: queryText, error: '' });
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        window.showToast?.(`Could not search older messages: ${error.message}`);
      }
    } finally {
      if (loadOlderControllerRef.current === controller) {
        loadOlderControllerRef.current = null;
        if (searchRequestVersionRef.current === requestVersion) setLoadingOlder(false);
      }
    }
  };

  useEffect(() => {
    if (!flatResults.length) return;
    document.querySelector(`[data-search-index="${safeActiveIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [flatResults.length, safeActiveIndex]);

  const openFlatResult = (entry) => {
    if (!entry) return;
    if (entry.type === 'person') viewPerson(entry.item);
    else goToRoom(entry.item);
  };
  const handleInputKeyDown = (event) => {
    if (!flatResults.length || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowDown') setActiveIndex((index) => (index + 1) % flatResults.length);
    else if (event.key === 'ArrowUp') setActiveIndex((index) => (index - 1 + flatResults.length) % flatResults.length);
    else openFlatResult(flatResults[safeActiveIndex]);
  };
  const scopeOptions = [
    { id: 'all', icon: 'ph-sparkle', label: 'All', count: resultCount },
    { id: 'rooms', icon: 'ph-chats', label: 'Rooms', count: activeResults.rooms.length },
    { id: 'people', icon: 'ph-users', label: 'People', count: activeResults.people.length },
    { id: 'messages', icon: 'ph-chat-text', label: 'Messages', count: messageMatchCount },
  ];
  const handleScopeKeyDown = (event, index) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const lastIndex = scopeOptions.length - 1;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? lastIndex
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (index === 0 ? lastIndex : index - 1)
          : (index === lastIndex ? 0 : index + 1);
    setActiveScope(scopeOptions[nextIndex].id);
    setActiveIndex(0);
    window.requestAnimationFrame(() => {
      document.querySelectorAll('.search-scope-pill')[nextIndex]?.focus();
    });
  };

  return (
    <div ref={rootRef} className={`search-box search-pro-shell ${searching ? 'is-searching' : ''}`} role="dialog" aria-modal="true" aria-labelledby="search-dialog-title" aria-describedby="search-dialog-description" onClick={(event) => event.stopPropagation()}>
      <header className="search-command-head">
        <div className="search-command-title">
          <span className="search-command-icon" aria-hidden="true"><i className="ph-bold ph-command" /></span>
          <div><span>Universal search</span><h2 id="search-dialog-title">Search workspace</h2></div>
        </div>
        <button type="button" id="close-search-btn" className="search-close-btn" onClick={close} aria-label="Close search">
          <i className="ph-bold ph-x" aria-hidden="true" />
        </button>
      </header>
      <p id="search-dialog-description" className="search-sr-only">Find rooms, people, and recent messages without losing your place.</p>
      <div className="search-input-row">
        <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
        <input
          ref={inputRef}
          id="global-search-input"
          type="search"
          value={searchText}
          onChange={(event) => { setSearchText(event.target.value); setActiveIndex(0); }}
          onKeyDown={handleInputKeyDown}
          placeholder="Search messages or use room:, from:, has:..."
          autoComplete="off"
          aria-label="Search rooms, people, and messages; filters include room, channel, author, date, and content type"
        />
        {queryText ? (
          <button type="button" className="search-clear-btn" onClick={() => { setSearchText(''); setActiveScope('all'); setResults(EMPTY_SEARCH_RESULTS); setActiveIndex(0); inputRef.current?.focus(); }} aria-label="Clear search">
            <i className="ph-bold ph-x" aria-hidden="true" />
          </button>
        ) : null}
        {queryText ? <span className="search-count-pill">{searching ? 'Syncing' : `${resultCount} found`}</span> : null}
        {!queryText ? <kbd className="search-shortcut">Ctrl K</kbd> : null}
      </div>
      <div className="search-scope-row" role="group" aria-label="Search scope">
        {scopeOptions.map((scope, index) => (
          <button
            key={scope.id}
            type="button"
            className={`search-scope-pill ${activeScope === scope.id ? 'active' : ''}`}
            onClick={() => { setActiveScope(scope.id); setActiveIndex(0); }}
            onKeyDown={(event) => handleScopeKeyDown(event, index)}
            aria-pressed={activeScope === scope.id}
          >
            <i className={`ph-bold ${scope.icon}`} aria-hidden="true" />
            <span>{scope.label}</span>
            <strong>{scope.count}</strong>
          </button>
        ))}
      </div>
      <div className="search-filter-tools">
        <div className="search-quick-filters" role="group" aria-label="Message content filters">
          {QUICK_MESSAGE_FILTERS.map((filter) => {
            const active = parsedQuery.filters.has.includes(filter.type);
            return (
              <button
                key={filter.token}
                type="button"
                className={active ? 'is-active' : ''}
                aria-pressed={active}
                onClick={() => {
                  setSearchText((value) => toggleQueryToken(value, filter));
                  setActiveIndex(0);
                }}
              >
                <i className={`ph-bold ${filter.icon}`} aria-hidden="true" />
                {filter.label}
              </button>
            );
          })}
        </div>
        <span className="search-filter-help">Filters: room: · channel: · from: · after: · before:</span>
        {filterLabels.length ? (
          <div className="search-active-filters" aria-label="Active search filters">
            {filterLabels.map((label) => <span key={label}>{label}</span>)}
          </div>
        ) : null}
      </div>
      <div id="search-results" className={hasVisibleResults ? 'search-results has-results' : 'search-results'} aria-live="polite" aria-busy={searching || loadingOlder}>
        {!queryText ? <SearchState icon="ph-bold ph-sparkle" title="Start typing" body="Search every channel in every room you have joined." /> : null}
        {queryText && queryText.length < 2 ? <SearchState icon="ph-bold ph-keyboard" title="Keep going" body="Type at least 2 characters to begin searching." /> : null}
        {searching ? <SearchState icon="ph-bold ph-circle-notch search-spin" title="Searching" body="Checking every accessible room and channel…" /> : null}
        {!searching && activeResults.error ? <SearchState icon="ph-bold ph-warning-circle" title="Search paused" body={activeResults.error} /> : null}
        {!searching && !activeResults.error && queryText.length >= 2 && !hasResults ? <SearchState icon="ph-bold ph-binoculars" title="No matches yet" body="Try another phrase or load older messages below." /> : null}
        {!searching && queryText.length >= 2 && hasResults && !hasVisibleResults ? <SearchState icon="ph-bold ph-faders" title="No matches in this filter" body="Try switching back to All or choosing another result type." /> : null}
        {canShowResults && visibleRooms && activeResults.rooms.length ? (
          <Section title="Rooms" icon="ph-bold ph-chats" count={activeResults.rooms.length} kind="rooms">
            {activeResults.rooms.map((room, index) => (
              <ResultItem key={room.id} kind="room" index={index} active={safeActiveIndex === index} onHover={() => setActiveIndex(index)} disabled={joiningId === room.id} icon={<i className={`ph-bold ${joiningId === room.id ? 'ph-circle-notch search-spin' : 'ph-chats'}`} aria-hidden="true" />} onClick={() => goToRoom(room)}>
                <div className="search-item-body">
                  <div className="search-item-title"><HighlightText text={room.name} queryText={highlightQueryText} /></div>
                  <div className="search-item-sub">
                    {joiningId === room.id ? 'Joining room…' : room.mine ? (
                      room.shortId ? <HighlightText text={`#${room.shortId}`} queryText={highlightQueryText} /> : 'Room'
                    ) : (
                      <HighlightText text={`Discoverable${room.category ? ` · ${room.category}` : ''}`} queryText={highlightQueryText} />
                    )}
                  </div>
                  {!room.mine && room.recommended ? <div className="search-item-sub">Recommended by topic/category match</div> : null}
                </div>
              </ResultItem>
            ))}
          </Section>
        ) : null}
        {canShowResults && visiblePeople && activeResults.people.length ? (
          <Section title="People" icon="ph-bold ph-users" count={activeResults.people.length} kind="people">
            {activeResults.people.map((person, index) => (
              <ResultItem key={person.id} kind="person" index={peopleOffset + index} active={safeActiveIndex === peopleOffset + index} onHover={() => setActiveIndex(peopleOffset + index)} icon={<img className="search-item-avatar" src={person.avatar} alt="" />} onClick={() => viewPerson(person)}>
                <div className="search-item-body">
                  <div className="search-item-title"><HighlightText text={person.name} queryText={highlightQueryText} /></div>
                  <div className="search-item-sub">{person.shortId ? <HighlightText text={`#${person.shortId}`} queryText={highlightQueryText} /> : 'Profile'}</div>
                </div>
              </ResultItem>
            ))}
          </Section>
        ) : null}
        {canShowResults && visibleMessages && activeResults.messages.length ? (
          <Section
            title="Messages"
            icon="ph-bold ph-chat-text"
            count={messageMatchCount > activeResults.messages.length ? `${activeResults.messages.length} of ${messageMatchCount}` : messageMatchCount}
            kind="messages"
          >
            {activeResults.messages.map((message, index) => (
              <ResultItem key={`${message.room}-${message.channelId}-${message.id}`} kind="message" index={messagesOffset + index} active={safeActiveIndex === messagesOffset + index} onHover={() => setActiveIndex(messagesOffset + index)} icon={<i className="ph-bold ph-chat-text" aria-hidden="true" />} onClick={() => goToRoom(message)}>
                <div className="search-item-body">
                  <div className="search-item-title"><HighlightText text={(message.text || message.poll?.question || message.attachedFile?.name || 'Shared message').slice(0, 160)} queryText={highlightQueryText} /></div>
                  <div className="search-item-sub">
                    <HighlightText
                      text={`${message.name || 'Someone'} · ${message.roomName} · #${message.channelName || message.channelId || 'general'}${message.timestamp ? ` · ${formatMessageDate(message.timestamp)}` : ''}`}
                      queryText={highlightQueryText}
                    />
                  </div>
                </div>
              </ResultItem>
            ))}
          </Section>
        ) : null}
        {canShowResults && visibleMessages && activeResults.meta?.sourceCount ? (
          <div className="search-index-status">
            <span>
              Searched {activeResults.meta.loadedMessageCount.toLocaleString()} recent messages
              {' '}across {activeResults.meta.sourceCount.toLocaleString()} channels.
            </span>
            {activeResults.meta.failedSourceCount ? <small>{activeResults.meta.failedSourceCount} unavailable.</small> : null}
          </div>
        ) : null}
        {canShowResults && visibleMessages && activeResults.meta?.hasMore ? (
          <button
            type="button"
            className="search-load-older"
            onClick={loadOlderMessages}
            disabled={loadingOlder}
          >
            <i className={`ph-bold ${loadingOlder ? 'ph-circle-notch search-spin' : 'ph-clock-counter-clockwise'}`} aria-hidden="true" />
            {loadingOlder ? 'Searching older messages…' : 'Search older messages'}
          </button>
        ) : null}
      </div>
      <div className="search-footer-hint">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> open</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  );
}
