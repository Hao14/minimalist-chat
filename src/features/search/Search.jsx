import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { get, limitToLast, query, ref } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { getAuthedJsonHeaders } from '../../lib/authToken.js';
import './search.css';

const EMPTY_SEARCH_RESULTS = { query: '', rooms: [], people: [], messages: [], error: '' };
const ROOM_SEARCH_ENDPOINT = () => window.ROOM_SEARCH_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/searchDiscoverableRooms';
const JOIN_DISCOVERABLE_ROOM_ENDPOINT = () => window.JOIN_DISCOVERABLE_ROOM_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/joinDiscoverableRoom';
const SEARCH_INDEX_TTL = 2 * 60 * 1000;
const MESSAGE_INDEX_TTL = 30 * 1000;
let baseIndexCache = null;
let baseIndexLoad = null;
const messageIndexCache = new Map();

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

async function loadBaseIndex(uid) {
  const fresh = baseIndexCache?.uid === uid && Date.now() - baseIndexCache.loadedAt < SEARCH_INDEX_TTL;
  if (fresh) return baseIndexCache;
  if (baseIndexLoad?.uid === uid) return baseIndexLoad.promise;
  const promise = Promise.all([
    get(ref(db, `user_rooms/${uid}`)),
    get(ref(db, 'user_directory')),
  ]).then(([roomsSnapshot, usersSnapshot]) => {
    const rooms = [];
    roomsSnapshot.forEach((child) => rooms.push({ id: child.key, ...(child.val() || {}) }));
    baseIndexCache = { uid, loadedAt: Date.now(), rooms, users: usersSnapshot.val() || {} };
    return baseIndexCache;
  }).finally(() => {
    if (baseIndexLoad?.promise === promise) baseIndexLoad = null;
  });
  baseIndexLoad = { uid, promise };
  return promise;
}

async function loadMessageIndex(uid) {
  const roomId = window.activeRoomId || 'global';
  const cacheKey = `${uid}:${roomId}`;
  const cached = messageIndexCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < MESSAGE_INDEX_TTL) return cached.messages;
  if (cached?.promise) return cached.promise;

  const sources = [{ dbRef: ref(db, 'messages'), room: 'global', name: 'Global Chat', shortId: 'GLOBAL', channelId: 'general' }];
  if (roomId !== 'global') {
    sources.push({
      dbRef: ref(db, `rooms_data/${roomId}/messages`),
      room: roomId,
      name: document.getElementById('active-room-name-display')?.textContent || 'Room',
      shortId: window.activeRoomShortId || '',
      channelId: 'general',
    });
  }
  const promise = Promise.all(sources.map((source) => get(query(source.dbRef, limitToLast(300)))))
    .then((snapshots) => {
      const messages = [];
      snapshots.forEach((snapshot, index) => {
        const source = sources[index];
        snapshot.forEach((child) => {
          const message = child.val() || {};
          messages.push({
            id: child.key,
            messageId: child.key,
            text: message.text || '',
            name: message.name || 'Someone',
            timestamp: Number(message.ts || message.timestamp || message.createdAt || 0),
            room: source.room,
            roomName: source.name,
            shortId: source.shortId,
            channelId: source.channelId,
          });
        });
      });
      messages.sort((a, b) => b.timestamp - a.timestamp);
      messageIndexCache.set(cacheKey, { loadedAt: Date.now(), messages });
      if (messageIndexCache.size > 8) messageIndexCache.delete(messageIndexCache.keys().next().value);
      return messages;
    });
  messageIndexCache.set(cacheKey, { loadedAt: 0, messages: [], promise });
  return promise;
}

function matchRank(value, queryText) {
  const text = String(value || '').toLowerCase();
  if (text === queryText) return 0;
  if (text.startsWith(queryText)) return 1;
  return 2;
}

async function runSearch(queryText, getAvatarUrl, signal) {
  const uid = window.currentUser?.uid;
  if (!uid) return EMPTY_SEARCH_RESULTS;
  const [baseIndex, discoverableRooms, messageIndex] = await Promise.all([
    loadBaseIndex(uid),
    searchDiscoverableRooms(queryText, signal).catch((error) => {
      if (error?.name === 'AbortError') throw error;
      return [];
    }),
    loadMessageIndex(uid),
  ]);
  const rooms = [];
  baseIndex.rooms.forEach((room) => {
    const searchableText = [
      room.name,
      room.shortId,
    ].filter(Boolean).join(' ').toLowerCase();
    if (searchableText.includes(queryText)) {
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
  if ('global chat'.includes(queryText) && !rooms.find((room) => room.id === 'global')) rooms.unshift({ id: 'global', name: 'Global Chat', shortId: 'GLOBAL' });
  discoverableRooms.forEach((room) => {
    if (rooms.some((existing) => existing.id === room.id)) return;
    rooms.push({
      id: room.id || room.key,
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
  const users = baseIndex.users;
  Object.entries(users).forEach(([id, user]) => {
    if (id === uid) return;
    if ((user.displayName || '').toLowerCase().includes(queryText) || (user.shortId || '').toLowerCase().includes(queryText)) people.push({ id, name: user.displayName || 'Unknown', photo: user.photoUrl || '', shortId: user.shortId || '', avatar: getAvatarUrl?.(user.displayName, user.photoUrl) || '' });
  });

  const messages = messageIndex.filter((message) => message.text.toLowerCase().includes(queryText)).slice(0, 30);
  rooms.sort((a, b) => matchRank(a.name, queryText) - matchRank(b.name, queryText) || a.name.localeCompare(b.name));
  people.sort((a, b) => matchRank(a.name, queryText) - matchRank(b.name, queryText) || a.name.localeCompare(b.name));
  return { rooms: rooms.slice(0, 20), people: people.slice(0, 20), messages };
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

export function Search({ getAvatarUrl, initialOpen = false }) {
  const [open, setOpen] = useState(() => Boolean(initialOpen));
  const [searchText, setSearchText] = useState('');
  const [activeScope, setActiveScope] = useState('all');
  const [results, setResults] = useState(EMPTY_SEARCH_RESULTS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [joiningId, setJoiningId] = useState('');
  const deferredSearchText = useDeferredValue(searchText);
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const openRef = useRef(false);
  const returnFocusRef = useRef(null);

  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    const openButton = document.getElementById('open-search-btn');
    // Clicking the nav icon toggles: open if closed, close if already open.
    const toggleSearch = () => {
      if (openRef.current) { setOpen(false); return; }
      setSearchText('');
      setActiveScope('all');
      setResults(EMPTY_SEARCH_RESULTS);
      setActiveIndex(0);
      setJoiningId('');
      setOpen(true);
    };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    const closeFromBackdrop = () => setOpen(false);
    openButton?.addEventListener('click', toggleSearch);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('minimalist:close-search', closeFromBackdrop);
    return () => {
      openButton?.removeEventListener('click', toggleSearch);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('minimalist:close-search', closeFromBackdrop);
    };
  }, []);

  useEffect(() => {
    const modal = document.getElementById('search-modal');
    const openButton = document.getElementById('open-search-btn');
    let focusFrame = 0;
    modal?.classList.toggle('hidden', !open);
    modal?.setAttribute('aria-hidden', open ? 'false' : 'true');
    openButton?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : openButton;
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
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    const queryText = deferredSearchText.trim().toLowerCase();
    if (queryText.length < 2) {
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const nextResults = await runSearch(queryText, getAvatarUrl, controller.signal);
        if (active) setResults({ query: queryText, ...nextResults, error: '' });
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (active) setResults({ query: queryText, rooms: [], people: [], messages: [], error: `Search failed: ${error.message}` });
      }
    }, 180);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [deferredSearchText, getAvatarUrl]);

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
      const jump = {
        messageId: room.messageId,
        roomId,
        roomName: room.name || room.roomName,
        shortId: room.shortId || '',
        channelId: room.channelId || 'general',
        source: 'search',
        messageText: room.text || '',
      };
      window.pendingMessageJump = jump;
      window.switchRoom?.(roomId, jump.roomName, jump.shortId, { channelId: jump.channelId });
      window.dispatchEvent(new CustomEvent('minimalist:message-jump', { detail: jump }));
    } else {
      window.switchRoom?.(roomId, room.name || room.roomName, room.shortId);
    }
    if (room.room) window.setTimeout(() => document.querySelector('.room-tab[data-target="chat"]')?.click(), 400);
  };
  const viewPerson = (person) => { close(); window.viewUserProfile?.(person.id); };
  const queryText = deferredSearchText.trim().toLowerCase();
  const inputStale = searchText !== deferredSearchText;
  const queryReady = queryText.length >= 2;
  const activeResults = queryReady ? results : EMPTY_SEARCH_RESULTS;
  const searching = queryReady && (results.query !== queryText || inputStale);
  const hasResults = activeResults.rooms.length || activeResults.people.length || activeResults.messages.length;
  const canShowResults = queryText.length >= 2 && !searching;

  const resultCount = activeResults.rooms.length + activeResults.people.length + activeResults.messages.length;
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
    { id: 'messages', icon: 'ph-chat-text', label: 'Messages', count: activeResults.messages.length },
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
          placeholder="Search rooms, people, messages..."
          autoComplete="off"
          aria-label="Search rooms, people, and messages"
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
      <div id="search-results" className={hasVisibleResults ? 'search-results has-results' : 'search-results'} aria-live="polite" aria-busy={searching}>
        {!queryText ? <SearchState icon="ph-bold ph-sparkle" title="Start typing" body="Search across your workspace without leaving the current room." /> : null}
        {queryText && queryText.length < 2 ? <SearchState icon="ph-bold ph-keyboard" title="Keep going" body="Type at least 2 characters to begin searching." /> : null}
        {searching ? <SearchState icon="ph-bold ph-circle-notch search-spin" title="Searching" body="Checking rooms, people, and recent messages…" /> : null}
        {!searching && activeResults.error ? <SearchState icon="ph-bold ph-warning-circle" title="Search paused" body={activeResults.error} /> : null}
        {!searching && !activeResults.error && queryText.length >= 2 && !hasResults ? <SearchState icon="ph-bold ph-binoculars" title="No matches yet" body="Try a room name, username, short ID, or a phrase from a message." /> : null}
        {!searching && queryText.length >= 2 && hasResults && !hasVisibleResults ? <SearchState icon="ph-bold ph-faders" title="No matches in this filter" body="Try switching back to All or choosing another result type." /> : null}
        {canShowResults && visibleRooms && activeResults.rooms.length ? (
          <Section title="Rooms" icon="ph-bold ph-chats" count={activeResults.rooms.length} kind="rooms">
            {activeResults.rooms.map((room, index) => (
              <ResultItem key={room.id} kind="room" index={index} active={safeActiveIndex === index} onHover={() => setActiveIndex(index)} disabled={joiningId === room.id} icon={<i className={`ph-bold ${joiningId === room.id ? 'ph-circle-notch search-spin' : 'ph-chats'}`} aria-hidden="true" />} onClick={() => goToRoom(room)}>
                <div className="search-item-body">
                  <div className="search-item-title"><HighlightText text={room.name} queryText={queryText} /></div>
                  <div className="search-item-sub">
                    {joiningId === room.id ? 'Joining room…' : room.mine ? (
                      room.shortId ? <HighlightText text={`#${room.shortId}`} queryText={queryText} /> : 'Room'
                    ) : (
                      <HighlightText text={`Discoverable${room.category ? ` · ${room.category}` : ''}`} queryText={queryText} />
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
                  <div className="search-item-title"><HighlightText text={person.name} queryText={queryText} /></div>
                  <div className="search-item-sub">{person.shortId ? <HighlightText text={`#${person.shortId}`} queryText={queryText} /> : 'Profile'}</div>
                </div>
              </ResultItem>
            ))}
          </Section>
        ) : null}
        {canShowResults && visibleMessages && activeResults.messages.length ? (
          <Section title="Messages" icon="ph-bold ph-chat-text" count={activeResults.messages.length} kind="messages">
            {activeResults.messages.map((message, index) => (
              <ResultItem key={`${message.room}-${message.id}`} kind="message" index={messagesOffset + index} active={safeActiveIndex === messagesOffset + index} onHover={() => setActiveIndex(messagesOffset + index)} icon={<i className="ph-bold ph-chat-text" aria-hidden="true" />} onClick={() => goToRoom(message)}>
                <div className="search-item-body">
                  <div className="search-item-title"><HighlightText text={(message.text || '').slice(0, 120)} queryText={queryText} /></div>
                  <div className="search-item-sub"><HighlightText text={`${message.name || 'Someone'} · in ${message.roomName}`} queryText={queryText} /></div>
                </div>
              </ResultItem>
            ))}
          </Section>
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
