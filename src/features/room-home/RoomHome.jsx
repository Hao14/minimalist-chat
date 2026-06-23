import { useEffect, useMemo, useState } from 'react';
import { get, limitToLast, push, query, ref, remove, set, update } from 'firebase/database';
import { db } from '../../lib/firebase.js';

const defaultDescription = 'A dedicated space for communication, sharing resources, and connecting with the group. Everyone is welcome.';

function safeUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return '#';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function Section({ action, children, icon, title }) {
  return (
    <section className="rh-section">
      <div className="rh-head"><h3><i className={`ph-bold ${icon}`} /> {title}</h3>{action ? <span>{action}</span> : null}</div>
      {children}
    </section>
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
    <Section icon="ph-info" title="About This Room" action={canEdit ? <button type="button" className="rh-edit-btn" onClick={() => { setDraft(data.description || ''); setEditing(true); }}><i className="ph-bold ph-pencil-simple" /> Edit</button> : null}>
      {editing ? (
        <div>
          <textarea className="rh-desc-edit" value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
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
    <Section icon="ph-list-checks" title="Room Rules">
      {rules.length ? rules.map(([key, text], index) => <div key={key} className="rh-rule"><span className="rh-num">{String(index + 1).padStart(2, '0')}</span><span className="rh-rule-text">{text}</span>{canEdit ? <button type="button" className="rh-del" title="Delete" onClick={() => deleteRule(key)}>&times;</button> : null}</div>) : <div className="rh-muted">No rules set yet.</div>}
      {canEdit ? <form className="rh-add-form" onSubmit={addRule}><div className="rh-form-row"><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a rule..." /><button type="submit" className="rh-save-btn">Add</button></div></form> : null}
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
    <Section icon="ph-push-pin" title="Resources">
      {resources.length ? resources.map(([key, resource]) => <div key={key} className="rh-resource-row"><a className="rh-resource" href={safeUrl(resource.url)} target="_blank" rel="noopener noreferrer"><div className="rh-res-body"><div className="rh-res-title"><i className="ph-bold ph-link" /> {resource.title}</div><div className="rh-res-url">{resource.url}</div></div></a>{canEdit ? <button type="button" className="rh-del rh-resource-del" title="Delete" onClick={() => deleteResource(key)}>&times;</button> : null}</div>) : <div className="rh-muted">No resources pinned yet.</div>}
      {canEdit ? <form className="rh-add-form" onSubmit={addResource}><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Resource title..." /><div className="rh-form-row"><input value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://..." /><button type="submit" className="rh-save-btn">Add</button></div></form> : null}
    </Section>
  );
}

function EventsPreview({ canEdit, data, roomId, setData }) {
  const [draft, setDraft] = useState({ title: '', date: '', desc: '' });
  const events = useMemo(() => Object.entries(data.events || {}).sort((a, b) => (a[1].date || '').localeCompare(b[1].date || '')), [data.events]);
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
    <Section icon="ph-calendar-dots" title="Upcoming Events">
      {events.length ? events.map(([key, event]) => {
        const date = event.date ? new Date(`${event.date}T00:00:00`) : null;
        return <div key={key} className="rh-event"><div className="rh-event-date"><span className="rh-d">{date ? date.getDate() : '?'}</span><span className="rh-m">{date ? date.toLocaleDateString('en-US', { month: 'short' }) : ''}</span></div><div className="rh-event-body"><div className="rh-event-title">{event.title}</div>{event.desc ? <div className="rh-event-desc">{event.desc}</div> : null}</div>{canEdit ? <button type="button" className="rh-del" title="Delete" onClick={() => deleteEvent(key)}>&times;</button> : null}</div>;
      }) : <div className="rh-muted">No upcoming events.</div>}
      {canEdit ? <form className="rh-add-form" onSubmit={addEvent}><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Event title..." /><div className="rh-form-row"><input type="date" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /><input value={draft.desc} onChange={(event) => setDraft((current) => ({ ...current, desc: event.target.value }))} placeholder="Details (optional)" /></div><button type="submit" className="rh-save-btn">Add Event</button></form> : null}
    </Section>
  );
}

function Activity({ data, isGlobal }) {
  const logs = Object.values(data.logs || {}).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 6);
  return (
    <Section icon="ph-activity" title="Recent Activity">
      <ul className="rh-activity">
        {isGlobal ? <li className="rh-muted">Global activity log is hidden.</li> : null}
        {!isGlobal && !logs.length ? <li className="rh-muted">No recent activity.</li> : null}
        {!isGlobal ? logs.map((log) => <li key={`${log.timestamp}-${log.text}`}><i className={`ph-bold ${log.text?.includes('joined') ? 'ph-sign-in' : (log.text?.includes('left') || log.text?.includes('kicked') ? 'ph-sign-out' : 'ph-check-circle')}`} /><div><div className="rh-act-text">{log.text}</div><div className="rh-act-time">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div></li>) : null}
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

function Analytics({ data, isGlobal, memberCount, messageCount }) {
  const hasPro = window.userTier === 'pro' || window.currentUser?.uid === window.MY_ADMIN_UID;
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
      {!hasPro ? <div className="rh-muted">Advanced snapshot shown. Upgrade to Pro for analytics in billing.</div> : null}
    </Section>
  );
}

export function RoomHome({ adminUid, getAvatarUrl, roomId, user }) {
  const isGlobal = roomId === 'global';
  const [data, setData] = useState({});
  const [canEdit, setCanEdit] = useState(false);
  const [contributors, setContributors] = useState([]);
  const [messageCount, setMessageCount] = useState('~');
  const memberCount = isGlobal ? '∞' : (Object.keys(data.members || {}).length || 1);
  const createdDate = isGlobal ? 'Day 1' : (data.createdAt ? new Date(data.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

  useEffect(() => {
    let active = true;
    const load = async () => {
      let roomData = {};
      if (!isGlobal) {
        try { roomData = (await get(ref(db, `rooms_meta/${roomId}`))).val() || {}; } catch { roomData = {}; }
      }
      await Promise.resolve();
      if (!active) return;
      setData(roomData);
      setCanEdit(Boolean(user.uid === adminUid || (!isGlobal && roomData.creatorId === user.uid)));
    };
    load();
    return () => { active = false; };
  }, [adminUid, isGlobal, roomId, user.uid]);

  useEffect(() => {
    let active = true;
    const loadContributors = async () => {
      const messagesRef = isGlobal ? ref(db, 'messages') : ref(db, `rooms_data/${roomId}/messages`);
      try {
        const snapshot = await get(query(messagesRef, limitToLast(300)));
        if (!active) return;
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
      } catch {
        if (active) setContributors([]);
      }
    };
    loadContributors();
    return () => { active = false; };
  }, [getAvatarUrl, isGlobal, roomId]);

  const patchRoom = async (patch) => {
    if (!canEdit) return;
    await update(ref(db, `rooms_meta/${roomId}`), patch);
    setData((current) => ({ ...current, ...patch }));
  };

  return (
    <div className="rh-scroll">
      <div className="rh-stats"><div className="rh-stat"><i className="ph-bold ph-chats" /> <span>{messageCount}</span> Messages</div><div className="rh-stat"><i className="ph-bold ph-users" /> <span>{memberCount}</span> Members</div><div className="rh-spacer" /><div className="rh-created">Created <span>{createdDate}</span></div></div>
      <div className="rh-grid">
        <div className="rh-col"><Description canEdit={canEdit} data={data} onPatch={patchRoom} /><Rules canEdit={canEdit} data={data} roomId={roomId} setData={setData} /><Analytics data={data} isGlobal={isGlobal} memberCount={memberCount} messageCount={messageCount} /><Activity data={data} isGlobal={isGlobal} /></div>
        <div className="rh-col"><Resources canEdit={canEdit} data={data} roomId={roomId} setData={setData} /><EventsPreview canEdit={canEdit} data={data} roomId={roomId} setData={setData} /><Contributors contributors={contributors} /><Members data={data} isGlobal={isGlobal} /></div>
      </div>
    </div>
  );
}
