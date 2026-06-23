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

const GLOBAL_ROOM = {
  id: 'global',
  name: 'Global Chat',
  lastMessage: 'Welcome to the server.',
  shortId: 'GLOBAL',
};

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

function getProfileSnapshot() {
  return {
    uid: window.currentUser?.uid,
    name: window.userProfileName || 'Anonymous',
    photoUrl: window.userPhotoUrl || '',
    tier: window.userTier || 'free',
    shortId: window.userShortId || '',
  };
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
    .filter((name) => /^msg-/.test(name))
    .join(' ');
  if (allowedClasses) props.className = allowedClasses;

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

function roomInitials(name) {
  return String(name || 'Room')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || 'R';
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

function RoomList({ rooms, activeRoomId, onSwitchRoom }) {
  return (
    <>
      {rooms.map((room) => (
        <li
          key={room.id}
          className={`room-item ${room.id === activeRoomId ? 'active' : ''}`}
          title={room.name}
          onClick={() => onSwitchRoom(room.id, room.name, room.shortId)}
        >
          <RoomIcon room={room} />
          <span className="room-copy">
            <span className="room-name">{room.name}</span>
            <span className="room-preview">{room.lastMessage || 'No messages yet...'}</span>
          </span>
        </li>
      ))}
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

function buildSmartReplies(messages) {
  const last = [...messages].reverse().find((message) => message.uid !== window.currentUser?.uid && (message.text || message.attachedFile || message.poll || message.reminder));
  if (!last) return [];

  const text = String(last.text || '').toLowerCase();
  if (last.attachedFile) return ['Got it, I’ll review this.', 'Thanks for sending it.', 'I’ll check and reply soon.'];
  if (last.poll) return ['I voted.', 'Good options.', 'Let’s go with the top choice.'];
  if (last.reminder) return ['Thanks for the reminder.', 'I’ll be there.', 'Can you remind me again later?'];
  if (text.includes('?')) return ['Yes, that works.', 'Can you clarify?', 'I’ll check and get back to you.'];
  if (text.includes('thanks') || text.includes('thank you')) return ['Anytime!', 'No problem.', 'Happy to help.'];
  if (text.includes('meet') || text.includes('deadline') || text.includes('tomorrow')) return ['I’ll add a reminder.', 'That time works for me.', 'Can we confirm the details?'];
  return ['Sounds good.', 'I agree.', 'I’ll take a look.'];
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

function MessageItem({
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
      className={`${isMine ? 'my-message' : ''} ${message.important ? 'msg-important' : ''}`}
      id={`msg-${message.id}`}
      style={{ display: isVisible ? 'flex' : 'none' }}
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
  const [roomListHost, setRoomListHost] = useState(null);
  const [channelHost, setChannelHost] = useState(null);
  const [rooms, setRooms] = useState([GLOBAL_ROOM]);
  const [activeRoom, setActiveRoom] = useState(GLOBAL_ROOM);
  const [channels, setChannels] = useState([{ id: 'general', name: 'general' }]);
  const [activeChannelId, setActiveChannelId] = useState('general');
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

  const roomsRef = useRef([GLOBAL_ROOM]);
  const activeRoomRef = useRef(GLOBAL_ROOM);
  const activeChannelRef = useRef('general');
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
    activeRoomRef.current = activeRoom;
  }, [activeRoom]);

  useEffect(() => {
    const bar = document.getElementById('room-channel-bar');
    bar?.classList.toggle('hidden', activeRoom.id === 'global');

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

  const switchRoom = useCallback((roomId, roomName, shortId = '') => {
    const knownRoom = roomsRef.current.find((room) => room.id === roomId);
    const nextRoom = {
      id: roomId || 'global',
      name: roomName || knownRoom?.name || (roomId === 'global' ? GLOBAL_ROOM.name : 'Room'),
      shortId: shortId || knownRoom?.shortId || (roomId === 'global' ? GLOBAL_ROOM.shortId : roomId),
    };

    window.activeRoomId = nextRoom.id;
    window.activeRoomShortId = nextRoom.shortId;
    window.activeChannelId = 'general';
    window.oldestMessageKey = null;
    window.isFetchingHistory = false;
    window.activeReplyData = null;

    setHeaderRoom(nextRoom.id, nextRoom.name);
    clearRoomSearch();
    document.getElementById('desktop-room-sidebar')?.classList.remove('open');

    oldestMessageKeyRef.current = null;
    isFetchingHistoryRef.current = false;
    shouldStickToBottomRef.current = true;
    setActiveRoom(nextRoom);
    setActiveChannelId('general');
    setMessages([]);
    setReply(null);
    setEditingId(null);
    setDraft(localStorage.getItem(`draft:${nextRoom.id}`) || '');
    setPlaceholder(`Message ${nextRoom.name}...`);
    setComposerDisabled(false);
    setSearchQuery('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFileSelected(false);

    setTimeout(() => window.onRoomChanged?.(), 0);
  }, []);

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
    clearRoomSearch();
    setActiveChannelId(channelId || 'general');
    window.activeChannelId = channelId || 'general';
    shouldStickToBottomRef.current = true;
  }, []);

  const addChannel = useCallback(async () => {
    if (activeRoomRef.current.id === 'global') return;
    const name = window.prompt('Channel name?');
    const id = slugChannel(name);
    if (!id) return;
    await set(ref(db, `rooms_meta/${activeRoomRef.current.id}/channels/${id}`), {
      name: id,
      createdAt: Date.now(),
      by: window.currentUser?.uid || '',
    });
    setActiveChannelId(id);
    window.showToast?.(`#${id} created.`, false);
  }, []);

  const displayMessage = useCallback((messageId, message, prepend = false) => {
    setMessages((current) => mergeMessage(current, messageId, message, prepend));
  }, []);

  const updateMessageEl = useCallback((messageId, message) => {
    setMessages((current) => mergeMessage(current, messageId, message));
  }, []);

  const deleteMessage = useCallback(async (messageId) => {
    if (!confirm('Delete this message for everyone?')) return;
    try {
      await remove(roomMessageRef(activeRoomRef.current.id, messageId, activeChannelRef.current));
    } catch (error) {
      window.showToast?.(`Delete failed: ${error.message}`);
    }
  }, []);

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
    window.bindChatScrolling = () => {};
    window.bindRoomTyping = () => {};
    window.loadDraft = (roomId) => setDraft(localStorage.getItem(`draft:${roomId}`) || '');
  }, [
    addReaction,
    deleteMessage,
    displayMessage,
    prepareReply,
    reactToMessage,
    registerApi,
    startEditMessage,
    switchRoom,
    toggleEmojiPicker,
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

      if (!nextRooms.some((room) => room.id === activeRoomRef.current.id)) {
        switchRoom('global', GLOBAL_ROOM.name, GLOBAL_ROOM.shortId);
      }

      Promise.allSettled(missingShortIdWrites);
    });

    return unsubscribe;
  }, [switchRoom, user?.uid]);

  useEffect(() => {
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
    setDraft(value);
    localStorage.setItem(`draft:${activeRoomRef.current.id}`, value);
    setTyping(value.trim().length > 0);

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => setTyping(false), 3000);
  }, [setTyping]);

  const handleTextareaKeyDown = useCallback((event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }, []);

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

      const chatPermSnap = await get(ref(db, `rooms_meta/${activeId}/permissions/chat`)).catch(() => null);
      if (chatPermSnap?.exists() && chatPermSnap.val() === false) {
        window.showToast?.('Chat messages are disabled in this room.');
        return false;
      }
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

    isSendingRef.current = true;
    setIsSending(true);

    try {
      if (!(await canPostToCurrentRoom())) return;

      let uploadedImageUrl = null;
      let uploadedFile = null;
      const profile = getProfileSnapshot();
      let reservedUploadRef = null;
      let reservedUploadBytes = 0;

      if (file) {
        if (activeId !== 'global') {
          const filePermSnap = await get(ref(db, `rooms_meta/${activeId}/permissions/files`)).catch(() => null);
          if (filePermSnap?.exists() && filePermSnap.val() === false) {
            window.showToast?.('File uploads are disabled in this room.');
            return;
          }
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

      await set(push(roomMessagesRef(activeId, activeChannelRef.current)), payload);

      if (text) window.notifyMentions?.(text, activeId);
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
  }, [canPostToCurrentRoom, cancelReply, draft, reply, setTyping]);

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
    const question = window.prompt('Poll question?');
    if (!question?.trim()) return;
    const rawOptions = window.prompt('Options separated by commas? Example: Yes, No, Maybe');
    const options = [...new Set(String(rawOptions || '').split(',').map((option) => option.trim()).filter(Boolean))].slice(0, 6);
    if (options.length < 2) {
      window.showToast?.('A poll needs at least two options.');
      return;
    }

    await sendSpecialMessage({
      poll: {
        question: question.trim().slice(0, 180),
        options: options.map((option, index) => ({ id: `o${index}`, text: option.slice(0, 80) })),
        createdAt: Date.now(),
      },
    }, `Poll: ${question.trim()}`);
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
    const text = window.prompt('Reminder text?');
    if (!text?.trim()) return;
    const when = window.prompt('When? Example: 2026-06-22 17:30');
    const dueAt = parseReminderInput(when);
    if (!dueAt || dueAt <= Date.now()) {
      window.showToast?.('Use a future date/time like 2026-06-22 17:30.');
      return;
    }

    const reminder = {
      text: text.trim().slice(0, 180),
      dueAt,
      by: window.currentUser.uid,
      byName: window.userProfileName || 'Anonymous',
      source: 'room-message',
    };
    await sendSpecialMessage({ reminder }, `Reminder: ${reminder.text}`);
    await saveReminder(reminder);
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
          <RoomList rooms={rooms} activeRoomId={activeRoom.id} onSwitchRoom={switchRoom} />,
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
        {messages.map((message) => (
          <MessageItem
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
            onChange={handleDraftChange}
            onKeyDown={handleTextareaKeyDown}
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
