import { useEffect, useMemo, useState } from 'react';
import { limitToLast, onValue, push, query, ref, remove, set, update } from 'firebase/database';
import { db } from '../../lib/firebase.js';
import { useLocale } from '../../lib/useLocale.js';
import { GoogleCalendarLink } from '../calendar/GoogleCalendarLink.jsx';
import { hasRoomAnalytics, useRoomEntitlement } from '../billing/roomEntitlements.js';
import { useRoomTabDataActivity } from '../shell/roomTabActivity.js';
import { formatRoomActivity, getRoomActivityIcon, roomActivityKey } from '../rooms/roomActivity.js';
import './roomHome.css';

const defaultDescription = 'A dedicated space for communication, sharing resources, and connecting with the group. Everyone is welcome.';
const ROOM_TEMPLATE_LABELS = {
  blank: 'Blank room',
  study: 'Study room',
  creator: 'Creator community',
  project: 'Project team',
  support: 'Support group',
  gaming: 'Gaming group',
  club: 'Club hub',
};

function safeUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return '#';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function Section({ action, children, icon, sectionId, title }) {
  return (
    <section className="rh-section" id={sectionId}>
      <div className="rh-head"><h3><i className={`ph-bold ${icon}`} aria-hidden="true" /> {title}</h3>{action ? <span>{action}</span> : null}</div>
      {children}
    </section>
  );
}

function countObject(value) {
  return Object.keys(value || {}).length;
}

function numericCount(value) {
  if (typeof value === 'number') return value;
  const parsed = parseInt(String(value || '').replace(/\D+/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getUpcomingEvents(events) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Object.entries(events || {})
    .filter(([, event]) => {
      if (!event?.date) return true;
      const eventDate = new Date(`${event.date}T00:00:00`);
      return !Number.isNaN(eventDate.getTime()) && eventDate.getTime() >= today.getTime();
    })
    .sort((a, b) => (a[1].date || '').localeCompare(b[1].date || ''));
}

function formatPulseTime(timestamp, locale) {
  const date = new Date(Number(timestamp || 0));
  if (Number.isNaN(date.getTime())) return '';

  const elapsed = Date.now() - date.getTime();
  if (elapsed >= 0 && elapsed < 60000) return 'Just now';
  if (elapsed >= 0 && elapsed < 3600000) return `${Math.max(1, Math.floor(elapsed / 60000))}m ago`;
  if (elapsed >= 0 && elapsed < 86400000) return `${Math.max(1, Math.floor(elapsed / 3600000))}h ago`;
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

function openRoomView(target) {
  const tab = document.querySelector(`.room-tab[data-target="${target}"]`);
  if (tab && !tab.classList.contains('hidden') && tab.getAttribute('aria-disabled') !== 'true') {
    tab.click();
    return true;
  }
  return false;
}

function scrollToRoomHomeSection(sectionId) {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function computeRoomInsights({ contributors, data, isGlobal, memberCount, messageCount }) {
  const messages = numericCount(messageCount);
  const members = isGlobal ? 50 : numericCount(memberCount);
  const channels = isGlobal ? 1 : countObject(data.channels) + 1;
  const resources = countObject(data.resources);
  const events = countObject(data.events);
  const rules = countObject(data.rules);
  const logs = Object.values(data.logs || {});
  const recentActivity = logs.filter((log) => Date.now() - Number(log.timestamp || 0) < 14 * 86400000).length;
  const descriptionScore = data.description ? 10 : 0;
  const topicScore = data.topic ? 8 : 0;
  const health = Math.min(100,
    (messages >= 10 ? 18 : messages >= 1 ? 8 : 0)
    + (members >= 5 ? 14 : members >= 2 ? 8 : 0)
    + descriptionScore
    + topicScore
    + (rules ? 10 : 0)
    + (resources ? 10 : 0)
    + (events ? 10 : 0)
    + (recentActivity ? 12 : 0)
    + (channels > 1 ? 8 : 0)
  );
  const reputation = Math.max(0, (messages * 2) + (members * 12) + (channels * 8) + (resources * 9) + (events * 12) + (rules * 6) + ((contributors?.length || 0) * 10));
  const prestigeLevel = Math.max(1, Math.min(50, Math.floor(reputation / 125) + 1));
  const discovery = data.discovery || {};

  const milestones = [
    { label: 'Room created', done: isGlobal || Boolean(data.createdAt), icon: 'ph-flag' },
    { label: '10 messages', done: messages >= 10, icon: 'ph-chat-circle-text' },
    { label: '5 members', done: members >= 5, icon: 'ph-users-three' },
    { label: 'First resource pinned', done: resources >= 1, icon: 'ph-push-pin' },
    { label: 'First event scheduled', done: events >= 1, icon: 'ph-calendar-dots' },
    { label: 'Prestige level 3', done: prestigeLevel >= 3, icon: 'ph-crown' },
  ];

  const snapshots = [
    ['Messages', messageCount],
    ['Members', memberCount],
    ['Channels', channels],
    ['Resources', resources],
    ['Events', events],
    ['Rules', rules],
  ];

  const timeline = [
    ...(data.createdAt ? [{ ts: Number(data.createdAt), label: 'Room created', icon: 'ph-flag' }] : []),
    ...logs.map((log) => ({ ts: Number(log.timestamp || 0), log, icon: getRoomActivityIcon(log) })),
    ...Object.values(data.events || {}).map((event) => ({
      ts: event.date ? Date.parse(`${event.date}T12:00:00`) : 0,
      label: `Event: ${event.title || 'Untitled'}`,
      icon: 'ph-calendar-dots',
    })),
  ].filter((item) => item.ts).sort((a, b) => b.ts - a.ts).slice(0, 8);

  return {
    category: data.category || data.roomTypeLabel || data.roomType || 'General',
    discoveryEnabled: discovery.enabled === true || data.discoverable === true,
    health,
    milestones,
    recommendationsEnabled: discovery.recommendations !== false,
    reputation,
    snapshots,
    templateLabel: ROOM_TEMPLATE_LABELS[data.template || data.roomTemplate] || data.template || 'Blank room',
    timeline,
    prestigeLevel,
    topic: data.topic || 'No topic set',
  };
}

function RoomIdentityHero({ data, insights, isGlobal }) {
  const bannerStyle = data.bannerUrl
    ? { '--rh-banner-image': `url(${JSON.stringify(data.bannerUrl)})` }
    : undefined;
  return (
    <section className={`rh-identity ${data.bannerUrl ? 'has-banner' : ''}`} style={bannerStyle} aria-labelledby="room-home-title">
      <div>
        <span className="rh-kicker">Room identity</span>
        <h2 id="room-home-title">{data.name || (isGlobal ? 'Global Chat' : 'Room')}</h2>
        <p>{insights.topic}</p>
      </div>
      <div className="rh-chip-row">
        <span><i className="ph-bold ph-shapes" aria-hidden="true" /> {insights.category}</span>
        <span><i className="ph-bold ph-stack" aria-hidden="true" /> {insights.templateLabel}</span>
        <span><i className="ph-bold ph-sparkle" aria-hidden="true" /> Prestige {insights.prestigeLevel}</span>
      </div>
    </section>
  );
}

function RoomPulse({ canEdit, data, isGlobal, messageCount, messagesStatus, memberCount, metaStatus, onPatch }) {
  const { locale, formatDate } = useLocale();
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState(data.topic || '');
  const [topicError, setTopicError] = useState('');
  const [savingTopic, setSavingTopic] = useState(false);
  const latestLog = useMemo(() => Object.values(data.logs || {})
    .filter((log) => Number(log?.timestamp || 0) > 0)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0] || null, [data.logs]);
  const nextEvent = useMemo(() => getUpcomingEvents(data.events)[0]?.[1] || null, [data.events]);
  const focus = useMemo(() => {
    if (metaStatus === 'loading') return { text: 'Loading room setup…' };
    if (metaStatus === 'error') return { text: 'Room setup details are unavailable right now.' };
    if (!data.topic) return { action: 'Add topic', icon: 'ph-pencil-simple', text: 'Add a topic so everyone knows what this room is for.', type: 'topic' };
    if (!countObject(data.resources)) return { action: 'Pin resource', icon: 'ph-push-pin', text: 'Pin a useful link so members can find the essentials faster.', target: 'room-home-resources' };
    if (!getUpcomingEvents(data.events).length) return { action: 'Plan event', icon: 'ph-calendar-plus', text: 'Schedule the next room moment so everyone knows what is ahead.', target: 'room-home-events' };
    if (!countObject(data.rules)) return { action: 'Add rule', icon: 'ph-list-checks', text: 'Add one clear room rule to set expectations for everyone.', target: 'room-home-rules' };
    return { action: 'Open chat', icon: 'ph-chat-circle-dots', text: 'The room is set up. Keep the conversation moving.', type: 'chat' };
  }, [data.events, data.resources, data.rules, data.topic, metaStatus]);

  const saveTopic = async (event) => {
    event.preventDefault();
    if (!topicDraft.trim() || savingTopic) return;
    setSavingTopic(true);
    setTopicError('');
    try {
      await onPatch({ topic: topicDraft.trim().slice(0, 120) });
      setEditingTopic(false);
    } catch {
      setTopicError('Could not save the topic. Try again.');
    } finally {
      setSavingTopic(false);
    }
  };

  const runFocusAction = () => {
    if (focus.type === 'topic') {
      setTopicDraft(data.topic || '');
      setTopicError('');
      setEditingTopic(true);
      return;
    }
    if (focus.type === 'chat') {
      openRoomView('chat');
      return;
    }
    if (focus.target) scrollToRoomHomeSection(focus.target);
  };

  const latestText = messagesStatus === 'loading'
    ? 'Loading recent room activity…'
    : messagesStatus === 'error'
      ? 'Recent room activity is unavailable right now.'
      : isGlobal
        ? `${messageCount} messages are available in Global Chat.`
        : (latestLog?.text || (messageCount === '0' ? 'This room is ready for its first message.' : `${messageCount} messages in this room.`));
  const latestTime = messagesStatus === 'ready' && !isGlobal && latestLog ? formatPulseTime(latestLog.timestamp, locale) : '';
  const nextEventTitle = metaStatus === 'loading' ? 'Loading upcoming events…' : metaStatus === 'error' ? 'Upcoming events are unavailable' : (nextEvent?.title || 'No upcoming events');
  const nextEventDetail = metaStatus === 'loading'
    ? 'Checking this room'
    : metaStatus === 'error'
      ? 'Try again from the notice above'
      : nextEvent?.date
        ? formatDate(new Date(`${nextEvent.date}T12:00:00`), { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Nothing scheduled yet';

  return (
    <section className="rh-pulse" aria-labelledby="room-pulse-title">
      <div className="rh-pulse-intro">
        <span className="rh-pulse-label"><i className="ph-bold ph-pulse" aria-hidden="true" /> Room pulse</span>
        <h3 id="room-pulse-title">Pick up where the room left off.</h3>
        <div className="rh-pulse-actions">
          <button type="button" className="rh-pulse-primary" onClick={() => openRoomView('chat')}><i className="ph-bold ph-chats" aria-hidden="true" /> Open chat</button>
          <button type="button" className="rh-pulse-secondary" onClick={() => scrollToRoomHomeSection('room-home-activity')}>Recent activity <i className="ph-bold ph-arrow-right" aria-hidden="true" /></button>
        </div>
      </div>
      <div className="rh-pulse-item">
        <span className="rh-pulse-item-label"><i className="ph-bold ph-clock-counter-clockwise" aria-hidden="true" /> Latest update</span>
        <strong>{latestText}</strong>
        {latestTime ? <small>{latestTime}</small> : <small>{memberCount} {memberCount === '1' ? 'member' : 'members'}</small>}
        <button type="button" className="rh-text-action" onClick={() => scrollToRoomHomeSection('room-home-activity')}>View recent activity <i className="ph-bold ph-arrow-right" aria-hidden="true" /></button>
      </div>
      <div className="rh-pulse-item">
        <span className="rh-pulse-item-label"><i className="ph-bold ph-calendar-blank" aria-hidden="true" /> Next event</span>
        <strong>{nextEventTitle}</strong>
        <small>{nextEventDetail}</small>
        <button type="button" className="rh-text-action" onClick={() => (openRoomView('events') || scrollToRoomHomeSection('room-home-events'))}>See all events <i className="ph-bold ph-arrow-right" aria-hidden="true" /></button>
      </div>
      <div className="rh-pulse-item rh-pulse-focus">
        <span className="rh-pulse-item-label"><i className="ph-bold ph-target" aria-hidden="true" /> Room focus</span>
        {editingTopic ? (
          <form className="rh-topic-form" onSubmit={saveTopic}>
            <label htmlFor="room-home-topic">Room topic</label>
            <input id="room-home-topic" value={topicDraft} onChange={(event) => setTopicDraft(event.target.value)} maxLength={120} placeholder="What is this room focused on?" autoFocus />
            {topicError ? <span className="rh-topic-error" role="alert">{topicError}</span> : null}
            <div>
              <button type="submit" className="rh-topic-save" disabled={!topicDraft.trim() || savingTopic}>{savingTopic ? 'Saving…' : 'Save topic'}</button>
              <button type="button" className="rh-topic-cancel" onClick={() => setEditingTopic(false)} disabled={savingTopic}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <strong>{focus.text}</strong>
            {focus.action && (canEdit || focus.type !== 'topic') ? <button type="button" className="rh-focus-action" onClick={runFocusAction}><i className={`ph-bold ${focus.icon}`} aria-hidden="true" /> {focus.action}</button> : null}
          </>
        )}
      </div>
    </section>
  );
}

function RoomScores({ insights }) {
  return (
    <Section icon="ph-pulse" title="Room Health">
      <div className="rh-score-grid">
        <div className="rh-score-card">
          <span>Health score</span>
          <strong>{insights.health}%</strong>
          <div className="rh-meter" role="progressbar" aria-label="Room health score" aria-valuemin="0" aria-valuemax="100" aria-valuenow={insights.health}><i style={{ width: `${insights.health}%` }} aria-hidden="true" /></div>
          <small className="rh-live-note">Live from messages, members, channels, events, resources, rules, and recent activity.</small>
        </div>
        <div className="rh-score-card">
          <span>Room reputation</span>
          <strong>{insights.reputation}</strong>
          <small>Activity, resources, members, events, and structure.</small>
        </div>
        <div className="rh-score-card">
          <span>Prestige level</span>
          <strong>{insights.prestigeLevel}</strong>
          <small>Grows as the room becomes more useful.</small>
        </div>
      </div>
    </Section>
  );
}

function Discovery({ insights }) {
  return (
    <Section icon="ph-compass" title="Discovery">
      <div className="rh-discovery-grid">
        <div className={insights.discoveryEnabled ? 'on' : ''}><i className="ph-bold ph-binoculars" aria-hidden="true" /><strong>{insights.discoveryEnabled ? 'Discoverable' : 'Private discovery'}</strong><span>Room discovery</span></div>
        <div className={insights.recommendationsEnabled ? 'on' : ''}><i className="ph-bold ph-sparkle" aria-hidden="true" /><strong>{insights.recommendationsEnabled ? 'Recommendations on' : 'Recommendations off'}</strong><span>Room recommendations</span></div>
        <div><i className="ph-bold ph-stack" aria-hidden="true" /><strong>{insights.templateLabel}</strong><span>Room template</span></div>
      </div>
    </Section>
  );
}

function Milestones({ insights }) {
  return (
    <Section icon="ph-flag-checkered" title="Room Milestones">
      <div className="rh-milestones">
        {insights.milestones.map((item) => (
          <div key={item.label} className={item.done ? 'done' : ''}>
            <i className={`ph-bold ${item.done ? 'ph-check-circle' : item.icon}`} aria-hidden="true" />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Snapshots({ insights }) {
  return (
    <Section icon="ph-camera" title="Room Snapshots">
      <div className="rh-snapshots">
        {insights.snapshots.map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
      </div>
    </Section>
  );
}

function Timeline({ insights }) {
  const { locale, formatDate } = useLocale();
  return (
    <Section icon="ph-timeline" title="Room Timeline">
      <div className="rh-timeline">
        {insights.timeline.length ? insights.timeline.map((item, index) => (
          <div key={item.log ? roomActivityKey(item.log, index) : `${item.ts}-${item.label}-${index}`}>
            <i className={`ph-bold ${item.icon}`} aria-hidden="true" />
            <span>{item.log ? formatRoomActivity(item.log, locale) : item.label}</span>
            <small>{formatDate(item.ts, { month: 'short', day: 'numeric' })}</small>
          </div>
        )) : <div className="rh-muted">No timeline activity yet.</div>}
      </div>
    </Section>
  );
}

function Description({ canEdit, data, onPatch }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.description || '');
  const save = async () => {
    await onPatch({ description: draft.trim() });
    setEditing(false);
  };
  return (
    <Section icon="ph-info" title="About This Room" action={canEdit ? <button type="button" className="rh-edit-btn" aria-label="Edit room description" onClick={() => { setDraft(data.description || ''); setEditing(true); }}><i className="ph-bold ph-pencil-simple" aria-hidden="true" /> Edit</button> : null}>
      {editing ? (
        <div>
          <textarea className="rh-desc-edit" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Room description" autoFocus />
          <div className="rh-inline-actions"><button type="button" className="rh-save-btn" onClick={save}>Save</button><button type="button" className="rh-add-btn" onClick={() => setEditing(false)}>Cancel</button></div>
        </div>
      ) : <p className="rh-desc-text">{data.description || defaultDescription}</p>}
    </Section>
  );
}

function Rules({ canEdit, data, roomId, setData }) {
  const [draft, setDraft] = useState('');
  const rules = useMemo(() => Object.entries(data.rules || {}), [data.rules]);
  const addRule = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const ruleRef = push(ref(db, `rooms_meta/${roomId}/rules`));
    await set(ruleRef, text);
    setData((current) => ({ ...current, rules: { ...(current.rules || {}), [ruleRef.key]: text } }));
    setDraft('');
  };
  const deleteRule = async (key) => {
    await remove(ref(db, `rooms_meta/${roomId}/rules/${key}`));
    setData((current) => { const rules = { ...(current.rules || {}) }; delete rules[key]; return { ...current, rules }; });
  };
  return (
    <Section icon="ph-list-checks" sectionId="room-home-rules" title="Room Rules">
      {rules.length ? rules.map(([key, text], index) => <div key={key} className="rh-rule"><span className="rh-num">{String(index + 1).padStart(2, '0')}</span><span className="rh-rule-text">{text}</span>{canEdit ? <button type="button" className="rh-del" title={`Delete rule: ${text}`} aria-label={`Delete rule: ${text}`} onClick={() => deleteRule(key)}><i className="ph-bold ph-trash" aria-hidden="true" /></button> : null}</div>) : <div className="rh-muted">No rules set yet.</div>}
      {canEdit ? <form className="rh-add-form" aria-label="Add room rule" onSubmit={addRule}><div className="rh-form-row"><input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="New room rule" placeholder="Add a rule..." /><button type="submit" className="rh-save-btn">Add</button></div></form> : null}
    </Section>
  );
}

function Resources({ canEdit, data, roomId, setData }) {
  const [draft, setDraft] = useState({ title: '', url: '' });
  const resources = useMemo(() => Object.entries(data.resources || {}), [data.resources]);
  const addResource = async (event) => {
    event.preventDefault();
    const resource = { title: draft.title.trim(), url: draft.url.trim() };
    if (!resource.title || !resource.url) return;
    const resourceRef = push(ref(db, `rooms_meta/${roomId}/resources`));
    await set(resourceRef, resource);
    setData((current) => ({ ...current, resources: { ...(current.resources || {}), [resourceRef.key]: resource } }));
    setDraft({ title: '', url: '' });
  };
  const deleteResource = async (key) => {
    await remove(ref(db, `rooms_meta/${roomId}/resources/${key}`));
    setData((current) => { const resources = { ...(current.resources || {}) }; delete resources[key]; return { ...current, resources }; });
  };
  return (
    <Section icon="ph-push-pin" sectionId="room-home-resources" title="Resources">
      {resources.length ? resources.map(([key, resource]) => <div key={key} className="rh-resource-row"><a className="rh-resource" href={safeUrl(resource.url)} target="_blank" rel="noopener noreferrer" aria-label={`Open resource ${resource.title} in a new tab`}><div className="rh-res-body"><div className="rh-res-title"><i className="ph-bold ph-link" aria-hidden="true" /> {resource.title}</div><div className="rh-res-url">{resource.url}</div></div></a>{canEdit ? <button type="button" className="rh-del rh-resource-del" title={`Delete resource: ${resource.title}`} aria-label={`Delete resource: ${resource.title}`} onClick={() => deleteResource(key)}><i className="ph-bold ph-trash" aria-hidden="true" /></button> : null}</div>) : <div className="rh-muted">No resources pinned yet.</div>}
      {canEdit ? <form className="rh-add-form" aria-label="Add room resource" onSubmit={addResource}><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} aria-label="Resource title" placeholder="Resource title..." /><div className="rh-form-row"><input type="url" value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} aria-label="Resource URL" autoComplete="url" placeholder="https://..." /><button type="submit" className="rh-save-btn">Add</button></div></form> : null}
    </Section>
  );
}

function EventsPreview({ canEdit, data, roomId, setData }) {
  const { formatDate } = useLocale();
  const [draft, setDraft] = useState({ title: '', date: '', desc: '' });
  const events = useMemo(() => getUpcomingEvents(data.events), [data.events]);
  const addEvent = async (event) => {
    event.preventDefault();
    const next = { title: draft.title.trim(), date: draft.date, desc: draft.desc.trim() };
    if (!next.title || !next.date) return;
    const eventRef = push(ref(db, `rooms_meta/${roomId}/events`));
    await set(eventRef, next);
    setData((current) => ({ ...current, events: { ...(current.events || {}), [eventRef.key]: next } }));
    setDraft({ title: '', date: '', desc: '' });
  };
  const deleteEvent = async (key) => {
    await remove(ref(db, `rooms_meta/${roomId}/events/${key}`));
    setData((current) => { const events = { ...(current.events || {}) }; delete events[key]; return { ...current, events }; });
  };
  return (
    <Section icon="ph-calendar-dots" sectionId="room-home-events" title="Upcoming Events">
      {events.length ? events.map(([key, event]) => {
        const date = event.date ? new Date(`${event.date}T00:00:00`) : null;
        return <div key={key} className="rh-event"><div className="rh-event-date"><span className="rh-d">{date ? date.getDate() : '?'}</span><span className="rh-m">{date ? formatDate(date, { month: 'short' }) : ''}</span></div><div className="rh-event-body"><div className="rh-event-title">{event.title}</div>{event.desc ? <div className="rh-event-desc">{event.desc}</div> : null}</div><div className="rh-event-actions"><GoogleCalendarLink event={event} />{canEdit ? <button type="button" className="rh-del" title={`Delete event: ${event.title}`} aria-label={`Delete event: ${event.title}`} onClick={() => deleteEvent(key)}><i className="ph-bold ph-trash" aria-hidden="true" /></button> : null}</div></div>;
      }) : <div className="rh-muted">No upcoming events.</div>}
      {canEdit ? <form className="rh-add-form" aria-label="Add room event" onSubmit={addEvent}><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} aria-label="Event title" placeholder="Event title..." /><div className="rh-form-row"><input type="date" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} aria-label="Event date" /><input value={draft.desc} onChange={(event) => setDraft((current) => ({ ...current, desc: event.target.value }))} aria-label="Event details (optional)" placeholder="Details (optional)" /></div><button type="submit" className="rh-save-btn">Add Event</button></form> : null}
    </Section>
  );
}

function Activity({ data, isGlobal }) {
  const { locale, formatTime } = useLocale();
  const logs = Object.values(data.logs || {}).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 6);
  return (
    <Section icon="ph-activity" sectionId="room-home-activity" title="Recent Activity">
      <ul className="rh-activity">
        {isGlobal ? <li className="rh-muted">Global activity log is hidden.</li> : null}
        {!isGlobal && !logs.length ? <li className="rh-muted">No recent activity.</li> : null}
        {!isGlobal ? logs.map((log, index) => <li key={roomActivityKey(log, index)}><i className={`ph-bold ${getRoomActivityIcon(log)}`} aria-hidden="true" /><div><div className="rh-act-text">{formatRoomActivity(log, locale)}</div><div className="rh-act-time">{formatTime(log.timestamp)}</div></div></li>) : null}
      </ul>
    </Section>
  );
}

function Contributors({ contributors }) {
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <Section icon="ph-trophy" title="Top Contributors">
      {contributors.length ? contributors.map((contributor, index) => <div key={`${contributor.name}-${index}`} className="rh-contributor"><span className="rh-rank">{medals[index] || index + 1}</span><img src={contributor.avatar} alt="" /><span className="rh-c-name">{contributor.name}</span><span className="rh-c-count">{contributor.count} msg{contributor.count === 1 ? '' : 's'}</span></div>) : <div className="rh-muted">No messages yet.</div>}
    </Section>
  );
}

function Members({ data, isGlobal }) {
  const members = isGlobal ? ['Everyone'] : Object.values(data.members || {});
  return <Section icon="ph-users-three" title="Members"><div className="rh-members">{members.length ? members.map((member) => <span key={member}>{member}</span>) : <span>No members yet</span>}</div></Section>;
}

function Analytics({ data, hasAnalytics, isGlobal, memberCount, messageCount }) {
  const hasPro = hasAnalytics || window.currentUser?.uid === window.MY_ADMIN_UID;
  const channelCount = isGlobal ? 1 : Object.keys(data.channels || {}).length + 1;
  const eventCount = Object.keys(data.events || {}).length;
  const resourceCount = Object.keys(data.resources || {}).length;

  return (
    <Section icon="ph-chart-line-up" title="Room Analytics">
      <div className={`rh-analytics ${hasPro ? '' : 'locked'}`}>
        <div><strong>{messageCount}</strong><span>Messages sampled</span></div>
        <div><strong>{memberCount}</strong><span>Members</span></div>
        <div><strong>{channelCount}</strong><span>Channels</span></div>
        <div><strong>{eventCount}</strong><span>Events</span></div>
        <div><strong>{resourceCount}</strong><span>Resources</span></div>
      </div>
      {!hasPro ? <div className="rh-muted">Analytics unlock with Pro or an assigned paid Room subscription.</div> : null}
    </Section>
  );
}

export function RoomHome({ adminUid, getAvatarUrl, roomId, user }) {
  const { formatDate } = useLocale();
  const isRoomTabActive = useRoomTabDataActivity('home');
  const isGlobal = roomId === 'global';
  const roomEntitlement = useRoomEntitlement(roomId, isRoomTabActive);
  const [roomData, setRoomData] = useState({});
  const [globalData, setGlobalData] = useState({});
  const [roomCanEdit, setRoomCanEdit] = useState(false);
  const [contributors, setContributors] = useState([]);
  const [messageCount, setMessageCount] = useState('—');
  const [metaStatus, setMetaStatus] = useState('loading');
  const [messagesStatus, setMessagesStatus] = useState('loading');
  const [retryVersion, setRetryVersion] = useState(0);
  const data = isGlobal ? globalData : roomData;
  const setDisplayData = isGlobal ? setGlobalData : setRoomData;
  const canEdit = isGlobal ? Boolean(user.uid === adminUid) : roomCanEdit;
  const memberCount = metaStatus === 'loading' ? '—' : (isGlobal ? '∞' : (Object.keys(data.members || {}).length || 1));
  const createdDate = isGlobal ? 'Day 1' : (data.createdAt ? formatDate(data.createdAt, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const insights = useMemo(() => computeRoomInsights({ contributors, data, isGlobal, memberCount, messageCount }), [contributors, data, isGlobal, memberCount, messageCount]);
  const roomHasAnalytics = hasRoomAnalytics(window.userTier || 'free', roomEntitlement, user.uid);
  const hasLoadError = metaStatus === 'error' || messagesStatus === 'error';
  const retryRoomData = () => {
    setMetaStatus('loading');
    setMessagesStatus('loading');
    setMessageCount('—');
    setRetryVersion((current) => current + 1);
  };

  useEffect(() => {
    if (!isRoomTabActive || isGlobal) {
      return undefined;
    }

    const unsubscribe = onValue(ref(db, `rooms_meta/${roomId}`), (snapshot) => {
      const roomData = snapshot.val() || {};
      setRoomData(roomData);
      setRoomCanEdit(Boolean(user.uid === adminUid || roomData.creatorId === user.uid));
      setMetaStatus('ready');
    }, () => {
      setRoomData({});
      setRoomCanEdit(Boolean(user.uid === adminUid));
      setMetaStatus('error');
    });

    return unsubscribe;
  }, [adminUid, isGlobal, isRoomTabActive, retryVersion, roomId, user.uid]);

  useEffect(() => {
    if (!isRoomTabActive || !isGlobal) return undefined;

    const unsubscribe = onValue(ref(db, 'rooms_meta/global'), (snapshot) => {
      setGlobalData(snapshot.val() || {});
      setMetaStatus('ready');
    }, () => {
      setGlobalData({});
      setMetaStatus('error');
    });

    return unsubscribe;
  }, [isGlobal, isRoomTabActive, retryVersion]);

  useEffect(() => {
    if (!isRoomTabActive) return undefined;
    const messagesRef = isGlobal ? ref(db, 'messages') : ref(db, `rooms_data/${roomId}/messages`);
    const unsubscribe = onValue(query(messagesRef, limitToLast(300)), (snapshot) => {
      const tally = {};
      let total = 0;
      snapshot.forEach((child) => {
        const message = child.val();
        total += 1;
        if (!message.uid) return;
        if (!tally[message.uid]) tally[message.uid] = { name: message.name || 'Unknown', photo: message.photoUrl || '', count: 0 };
        tally[message.uid].count += 1;
      });
      setMessageCount(total >= 300 ? '300+' : String(total));
      setContributors(Object.values(tally).sort((a, b) => b.count - a.count).slice(0, 5).map((item) => ({ ...item, avatar: getAvatarUrl?.(item.name, item.photo) || '' })));
      setMessagesStatus('ready');
    }, () => {
      setMessageCount('—');
      setContributors([]);
      setMessagesStatus('error');
    });

    return unsubscribe;
  }, [getAvatarUrl, isGlobal, isRoomTabActive, retryVersion, roomId]);

  const patchRoom = async (patch) => {
    if (!canEdit) return;
    await update(ref(db, `rooms_meta/${roomId}`), patch);
    setDisplayData((current) => ({ ...current, ...patch }));
  };

  return (
    <div className="rh-scroll room-home-v2" aria-busy={metaStatus === 'loading' || messagesStatus === 'loading'}>
      <RoomIdentityHero data={data} insights={insights} isGlobal={isGlobal} />
      <div className="rh-stats"><div className="rh-stat"><i className="ph-bold ph-chats" aria-hidden="true" /> <span>{messageCount}</span> Messages</div><div className="rh-stat"><i className="ph-bold ph-users" aria-hidden="true" /> <span>{memberCount}</span> Members</div><div className="rh-spacer" /><div className="rh-created">Created <span>{createdDate}</span></div></div>
      {hasLoadError ? <div className="rh-load-notice" role="status"><div><i className="ph-bold ph-warning-circle" aria-hidden="true" /><span><strong>Some room details are unavailable.</strong> The page is showing what it could load.</span></div><button type="button" onClick={retryRoomData}>Retry</button></div> : null}
      <RoomPulse canEdit={canEdit} data={data} isGlobal={isGlobal} messageCount={messageCount} messagesStatus={messagesStatus} memberCount={memberCount} metaStatus={metaStatus} onPatch={patchRoom} />
      <div className="rh-grid">
        <div className="rh-col"><Description canEdit={canEdit} data={data} onPatch={patchRoom} /><RoomScores insights={insights} /><Milestones insights={insights} /><Rules canEdit={canEdit} data={data} roomId={roomId} setData={setDisplayData} /><Analytics data={data} hasAnalytics={roomHasAnalytics} isGlobal={isGlobal} memberCount={memberCount} messageCount={messageCount} /><Activity data={data} isGlobal={isGlobal} /></div>
        <div className="rh-col"><Discovery insights={insights} /><Snapshots insights={insights} /><Timeline insights={insights} /><Resources canEdit={canEdit} data={data} roomId={roomId} setData={setDisplayData} /><EventsPreview canEdit={canEdit} data={data} roomId={roomId} setData={setDisplayData} /><Contributors contributors={contributors} /><Members data={data} isGlobal={isGlobal} /></div>
      </div>
    </div>
  );
}
