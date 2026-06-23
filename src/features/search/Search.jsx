import { useEffect, useRef, useState } from 'react';
import { get, limitToLast, query, ref } from 'firebase/database';
import { db } from '../../lib/firebase.js';

async function runSearch(queryText, getAvatarUrl) {
  const uid = window.currentUser?.uid;
  const [roomsSnapshot, usersSnapshot] = await Promise.all([get(ref(db, 'rooms_meta')), get(ref(db, 'users'))]);
  const rooms = [];
  roomsSnapshot.forEach((child) => {
    const room = child.val();
    const mine = (room.members && room.members[uid]) || room.creatorId === uid;
    if ((mine || child.key === 'global') && (room.name || '').toLowerCase().includes(queryText)) rooms.push({ id: child.key, name: room.name || 'Room', shortId: room.shortId || '' });
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

function ResultItem({ children, icon, onClick }) {
  return <button type="button" className="search-item" onClick={onClick}>{icon}{children}</button>;
}

function Section({ children, title }) {
  return <><div className="search-section">{title}</div>{children}</>;
}

export function Search({ getAvatarUrl }) {
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState({ query: '', rooms: [], people: [], messages: [], error: '' });
  const inputRef = useRef(null);

  useEffect(() => {
    const openButton = document.getElementById('open-search-btn');
    const openSearch = () => {
      setSearchText('');
      setResults({ query: '', rooms: [], people: [], messages: [], error: '' });
      setOpen(true);
    };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    openButton?.addEventListener('click', openSearch);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      openButton?.removeEventListener('click', openSearch);
      document.removeEventListener('keydown', closeOnEscape);
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
  const goToRoom = (room) => {
    close();
    window.switchRoom?.(room.id || room.room, room.name || room.roomName, room.shortId);
    if (room.room) window.setTimeout(() => document.querySelector('.room-tab[data-target="chat"]')?.click(), 400);
  };
  const viewPerson = (person) => { close(); window.viewUserProfile?.(person.id); };
  const queryText = searchText.trim().toLowerCase();
  const searching = queryText.length >= 2 && results.query !== queryText;
  const hasResults = results.rooms.length || results.people.length || results.messages.length;

  return (
    <div className="search-box" onClick={(event) => event.stopPropagation()}>
      <div className="search-input-row"><i className="ph-bold ph-magnifying-glass" /><input ref={inputRef} id="global-search-input" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search messages, rooms, people..." autoComplete="off" /><button type="button" id="close-search-btn" onClick={close}>✖</button></div>
      <div id="search-results">
        {!queryText ? <div className="search-hint">Type to search rooms, people and messages…</div> : null}
        {queryText && queryText.length < 2 ? <div className="search-hint">Type at least 2 characters…</div> : null}
        {searching ? <div className="search-hint">Searching…</div> : null}
        {!searching && results.error ? <div className="search-hint">{results.error}</div> : null}
        {!searching && !results.error && queryText.length >= 2 && !hasResults ? <div className="search-hint">No results.</div> : null}
        {!searching && results.rooms.length ? <Section title="Rooms">{results.rooms.map((room) => <ResultItem key={room.id} icon={<i className="ph-bold ph-chats" />} onClick={() => goToRoom(room)}><div className="search-item-body"><div className="search-item-title">{room.name}</div><div className="search-item-sub">Room</div></div></ResultItem>)}</Section> : null}
        {!searching && results.people.length ? <Section title="People">{results.people.map((person) => <ResultItem key={person.id} icon={<img className="search-item-avatar" src={person.avatar} alt="" />} onClick={() => viewPerson(person)}><div className="search-item-body"><div className="search-item-title">{person.name}</div><div className="search-item-sub">#{person.shortId}</div></div></ResultItem>)}</Section> : null}
        {!searching && results.messages.length ? <Section title="Messages">{results.messages.map((message, index) => <ResultItem key={`${message.room}-${index}`} icon={<i className="ph-bold ph-chat-text" />} onClick={() => goToRoom(message)}><div className="search-item-body"><div className="search-item-title">{(message.text || '').slice(0, 80)}</div><div className="search-item-sub">{message.name || ''} · in {message.roomName}</div></div></ResultItem>)}</Section> : null}
      </div>
    </div>
  );
}
