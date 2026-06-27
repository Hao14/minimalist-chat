import { useEffect, useRef, useState } from 'react';
import { get, limitToLast, query, ref, set } from 'firebase/database';
import { db } from '../../lib/firebase.js';

async function runSearch(queryText, getAvatarUrl) {
  const uid = window.currentUser?.uid;
  const [roomsSnapshot, usersSnapshot] = await Promise.all([get(ref(db, 'rooms_meta')), get(ref(db, 'user_directory'))]);
  const rooms = [];
  roomsSnapshot.forEach((child) => {
    const room = child.val();
    const mine = (room.members && room.members[uid]) || room.creatorId === uid;
    const discoverable = room.discovery?.enabled === true || room.discoverable === true;
    const searchableText = [
      room.name,
      room.shortId,
      room.topic,
      room.category,
      room.roomTypeLabel,
      room.template,
    ].filter(Boolean).join(' ').toLowerCase();
    if ((mine || discoverable || child.key === 'global') && searchableText.includes(queryText)) {
      rooms.push({
        id: child.key,
        name: room.name || 'Room',
        shortId: room.shortId || '',
        mine: Boolean(mine || child.key === 'global'),
        discoverable,
        category: room.category || room.roomTypeLabel || '',
        topic: room.topic || '',
        recommended: room.discovery?.recommendations !== false,
      });
    }
  });
  if ('global chat'.includes(queryText) && !rooms.find((room) => room.id === 'global')) rooms.unshift({ id: 'global', name: 'Global Chat', shortId: 'GLOBAL' });

  const people = [];
  const users = usersSnapshot.val() || {};
  Object.entries(users).forEach(([id, user]) => {
    if (id === uid) return;
    if ((user.displayName || '').toLowerCase().includes(queryText) || (user.shortId || '').toLowerCase().includes(queryText)) people.push({ id, name: user.displayName || 'Unknown', photo: user.photoUrl || '', shortId: user.shortId || '', avatar: getAvatarUrl?.(user.displayName, user.photoUrl) || '' });
  });

  const sources = [{ dbRef: ref(db, 'messages'), room: 'global', name: 'Global Chat', shortId: 'GLOBAL' }];
  if (window.activeRoomId && window.activeRoomId !== 'global') sources.push({ dbRef: ref(db, `rooms_data/${window.activeRoomId}/messages`), room: window.activeRoomId, name: document.getElementById('active-room-name-display')?.textContent || 'Room', shortId: window.activeRoomShortId || '' });
  const snapshots = await Promise.all(sources.map((source) => get(query(source.dbRef, limitToLast(300)))));
  const messages = [];
  snapshots.forEach((snapshot, index) => {
    const source = sources[index];
    snapshot.forEach((child) => {
      const message = child.val();
      if ((message.text || '').toLowerCase().includes(queryText)) messages.push({ text: message.text, name: message.name, room: source.room, roomName: source.name, shortId: source.shortId });
    });
  });
  return { rooms, people, messages: messages.reverse().slice(0, 50) };
}

function ResultItem({ children, icon, index = 0, kind = 'result', onClick }) {
  return (
    <button
      type="button"
      className={`search-item search-item-${kind}`}
      onClick={onClick}
      style={{ '--search-item-delay': `${Math.min(index, 9) * 34}ms` }}
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
  const [results, setResults] = useState({ query: '', rooms: [], people: [], messages: [], error: '' });
  const inputRef = useRef(null);
  const openRef = useRef(false);

  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    const openButton = document.getElementById('open-search-btn');
    // Clicking the nav icon toggles: open if closed, close if already open.
    const toggleSearch = () => {
      if (openRef.current) { setOpen(false); return; }
      setSearchText('');
      setActiveScope('all');
      setResults({ query: '', rooms: [], people: [], messages: [], error: '' });
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
    document.getElementById('search-modal')?.classList.toggle('hidden', !open);
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const queryText = searchText.trim().toLowerCase();
    if (queryText.length < 2) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const nextResults = await runSearch(queryText, getAvatarUrl);
        if (active) setResults({ query: queryText, ...nextResults, error: '' });
      } catch (error) {
        if (active) setResults({ query: queryText, rooms: [], people: [], messages: [], error: `Search failed: ${error.message}` });
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [getAvatarUrl, searchText]);

  const close = () => setOpen(false);
  const goToRoom = async (room) => {
    if (!room.mine && room.discoverable && window.currentUser?.uid) {
      await set(ref(db, `rooms_meta/${room.id}/members/${window.currentUser.uid}`), window.userProfileName || 'Anonymous');
      await set(ref(db, `rooms_meta/${room.id}/logs/${Date.now()}`), { text: `${window.userProfileName || 'Someone'} joined from room discovery.`, timestamp: Date.now() });
      window.showToast?.(`Joined ${room.name}.`, false);
    }
    close();
    window.switchRoom?.(room.id || room.room, room.name || room.roomName, room.shortId);
    if (room.room) window.setTimeout(() => document.querySelector('.room-tab[data-target="chat"]')?.click(), 400);
  };
  const viewPerson = (person) => { close(); window.viewUserProfile?.(person.id); };
  const queryText = searchText.trim().toLowerCase();
  const searching = queryText.length >= 2 && results.query !== queryText;
  const hasResults = results.rooms.length || results.people.length || results.messages.length;

  const resultCount = results.rooms.length + results.people.length + results.messages.length;
  const visibleRooms = activeScope === 'all' || activeScope === 'rooms';
  const visiblePeople = activeScope === 'all' || activeScope === 'people';
  const visibleMessages = activeScope === 'all' || activeScope === 'messages';
  const visibleResultCount =
    (visibleRooms ? results.rooms.length : 0) +
    (visiblePeople ? results.people.length : 0) +
    (visibleMessages ? results.messages.length : 0);
  const hasVisibleResults = visibleResultCount > 0;
  const scopeOptions = [
    { id: 'all', icon: 'ph-sparkle', label: 'All', count: resultCount },
    { id: 'rooms', icon: 'ph-chats', label: 'Rooms', count: results.rooms.length },
    { id: 'people', icon: 'ph-users', label: 'People', count: results.people.length },
    { id: 'messages', icon: 'ph-chat-text', label: 'Messages', count: results.messages.length },
  ];

  return (
    <div className={`search-box search-pro-shell ${searching ? 'is-searching' : ''}`} onClick={(event) => event.stopPropagation()}>
      <div className="search-glow search-glow-one" aria-hidden="true" />
      <div className="search-glow search-glow-two" aria-hidden="true" />
      <div className="search-hero">
        <div className="search-hero-orb" aria-hidden="true">
          <i className="ph-bold ph-command" />
        </div>
        <div>
          <span className="search-kicker">Universal Search</span>
          <h2>Find anything, fast.</h2>
          <p>Jump through rooms, people, and recent messages without losing your place.</p>
          <div className="search-hero-meta" aria-hidden="true">
            <span><i className="ph-bold ph-pulse" /> Live index</span>
            <span>{queryText ? `${resultCount} matches` : 'Ready'}</span>
          </div>
        </div>
        <button type="button" id="close-search-btn" className="search-close-btn" onClick={close} aria-label="Close search">
          <i className="ph-bold ph-x" aria-hidden="true" />
        </button>
      </div>
      <div className="search-input-row">
        <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
        <input
          ref={inputRef}
          id="global-search-input"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search rooms, people, messages..."
          autoComplete="off"
        />
        {queryText ? (
          <button type="button" className="search-clear-btn" onClick={() => { setSearchText(''); setActiveScope('all'); }} aria-label="Clear search">
            <i className="ph-bold ph-backspace" aria-hidden="true" />
          </button>
        ) : null}
        {queryText ? <span className="search-count-pill">{searching ? 'Syncing' : `${resultCount} found`}</span> : null}
      </div>
      <div className="search-scope-row" role="tablist" aria-label="Search scope">
        {scopeOptions.map((scope) => (
          <button
            key={scope.id}
            type="button"
            className={`search-scope-pill ${activeScope === scope.id ? 'active' : ''}`}
            onClick={() => setActiveScope(scope.id)}
            role="tab"
            aria-selected={activeScope === scope.id}
          >
            <i className={`ph-bold ${scope.icon}`} aria-hidden="true" />
            <span>{scope.label}</span>
            <strong>{scope.count}</strong>
          </button>
        ))}
      </div>
      <div id="search-results" className={hasVisibleResults ? 'search-results has-results' : 'search-results'}>
        {!queryText ? <SearchState icon="ph-bold ph-sparkle" title="Start typing" body="Search across your workspace without leaving the current room." /> : null}
        {queryText && queryText.length < 2 ? <SearchState icon="ph-bold ph-keyboard" title="Keep going" body="Type at least 2 characters to begin searching." /> : null}
        {searching ? <SearchState icon="ph-bold ph-circle-notch search-spin" title="Searching" body="Checking rooms, people, and recent messages…" /> : null}
        {!searching && results.error ? <SearchState icon="ph-bold ph-warning-circle" title="Search paused" body={results.error} /> : null}
        {!searching && !results.error && queryText.length >= 2 && !hasResults ? <SearchState icon="ph-bold ph-binoculars" title="No matches yet" body="Try a room name, username, short ID, or a phrase from a message." /> : null}
        {!searching && hasResults && !hasVisibleResults ? <SearchState icon="ph-bold ph-faders" title="No matches in this filter" body="Try switching back to All or choosing another result type." /> : null}
        {!searching && visibleRooms && results.rooms.length ? (
          <Section title="Rooms" icon="ph-bold ph-chats" count={results.rooms.length} kind="rooms">
            {results.rooms.map((room, index) => (
              <ResultItem key={room.id} kind="room" index={index} icon={<i className="ph-bold ph-chats" aria-hidden="true" />} onClick={() => goToRoom(room)}>
                <div className="search-item-body">
                  <div className="search-item-title">{room.name}</div>
                  <div className="search-item-sub">{room.mine ? (room.shortId ? `#${room.shortId}` : 'Room') : `Discoverable${room.category ? ` · ${room.category}` : ''}`}</div>
                  {!room.mine && room.recommended ? <div className="search-item-sub">Recommended by topic/category match</div> : null}
                </div>
              </ResultItem>
            ))}
          </Section>
        ) : null}
        {!searching && visiblePeople && results.people.length ? (
          <Section title="People" icon="ph-bold ph-users" count={results.people.length} kind="people">
            {results.people.map((person, index) => (
              <ResultItem key={person.id} kind="person" index={index} icon={<img className="search-item-avatar" src={person.avatar} alt="" />} onClick={() => viewPerson(person)}>
                <div className="search-item-body">
                  <div className="search-item-title">{person.name}</div>
                  <div className="search-item-sub">{person.shortId ? `#${person.shortId}` : 'Profile'}</div>
                </div>
              </ResultItem>
            ))}
          </Section>
        ) : null}
        {!searching && visibleMessages && results.messages.length ? (
          <Section title="Messages" icon="ph-bold ph-chat-text" count={results.messages.length} kind="messages">
            {results.messages.map((message, index) => (
              <ResultItem key={`${message.room}-${index}`} kind="message" index={index} icon={<i className="ph-bold ph-chat-text" aria-hidden="true" />} onClick={() => goToRoom(message)}>
                <div className="search-item-body">
                  <div className="search-item-title">{(message.text || '').slice(0, 120)}</div>
                  <div className="search-item-sub">{message.name || 'Someone'} · in {message.roomName}</div>
                </div>
              </ResultItem>
            ))}
          </Section>
        ) : null}
      </div>
      <div className="search-footer-hint">
        <span><i className="ph-bold ph-keyboard" /> Esc closes</span>
        <span><i className="ph-bold ph-cursor-click" /> Click a result to jump</span>
      </div>
    </div>
  );
}
