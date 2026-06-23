// js/social.js
// Recognition layer: earned badges, kudos, and @mention notifications.
// Data:
//   users/{uid}/badges/{badgeId} = timestamp        (earned badges)
//   users/{uid}/kudos            = number           (kudos count)
//   users/{uid}/kudosFrom/{uid}  = timestamp        (one kudos per giver, anti-spam)
import { db } from '../../lib/firebase.js';
import { ref, get, set, remove, runTransaction } from 'firebase/database';
import { escapeHtml } from '../../lib/text.js';

// Earned-badge catalog (distinct from paid tier badges).
const BADGES = {
    welcome:      { label: 'Welcome',      icon: 'ph-hand-waving',  color: '#60a5fa' },
    founder:      { label: 'Founder',      icon: 'ph-crown',        color: '#a78bfa' }, // created a room
    first_friend: { label: 'First Friend', icon: 'ph-users',        color: '#34d399' },
    social:       { label: 'Social',       icon: 'ph-users-three',  color: '#22d3ee' }, // 10 friends
    liked:        { label: 'Liked',        icon: 'ph-heart',        color: '#f472b6' }, // 5 kudos
    popular:      { label: 'Popular',      icon: 'ph-star',         color: '#fbbf24' }, // 25 kudos
};
window.BADGE_DEFS = BADGES;

// Award a badge (idempotent — only fires/notifies the first time).
window.awardBadge = async function (uid, badgeId) {
    if (!uid || !BADGES[badgeId]) return;
    try {
        const bRef = ref(db, `users/${uid}/badges/${badgeId}`);
        if ((await get(bRef)).exists()) return;
        await set(bRef, Date.now());
        if (window.createNotification) window.createNotification(uid, 'badge', `🏅 You earned the "${BADGES[badgeId].label}" badge!`);
        if (uid === window.currentUser?.uid && window.showToast) window.showToast(`🏅 Badge earned: ${BADGES[badgeId].label}`, false);
    } catch (e) { console.error('awardBadge failed', e); }
};

// Render earned badges as chips for the profile popup.
window.renderBadges = function (badges) {
    return Object.keys(badges || {}).filter(id => BADGES[id]).map(id => {
        const b = BADGES[id];
        return `<span class="earned-badge" title="${b.label}" style="--badge-color:${b.color}"><i class="ph-bold ${b.icon}"></i> ${b.label}</span>`;
    }).join('');
};

// Give kudos — one per giver, per recipient. Returns {ok, count|reason}.
window.giveKudos = async function (targetUid) {
    if (!window.currentUser || !targetUid || targetUid === window.currentUser.uid) return { ok: false, reason: 'self' };
    try {
        const fromRef = ref(db, `users/${targetUid}/kudosFrom/${window.currentUser.uid}`);
        if ((await get(fromRef)).exists()) return { ok: false, reason: 'already' };
        await set(fromRef, Date.now());
        let newCount = 0;
        await runTransaction(ref(db, `users/${targetUid}/kudos`), (c) => { newCount = (c || 0) + 1; return newCount; });
        if (window.createNotification) window.createNotification(targetUid, 'kudos', `👏 ${window.userProfileName || 'Someone'} gave you kudos!`, { groupId: window.currentUser.uid, from: window.userProfileName });
        if (newCount >= 5) window.awardBadge(targetUid, 'liked');
        if (newCount >= 25) window.awardBadge(targetUid, 'popular');
        window.awardXP?.(window.currentUser.uid, 'support', 5); // giver earns Support XP
        window.trackQuest?.('kudos');
        return { ok: true, count: newCount };
    } catch (e) { return { ok: false, reason: e.message }; }
};

// @mention notifications — resolve @name tokens against the current room's member roster.
// (Global room has no roster; multi-word display names aren't mentionable by design.)
window.notifyMentions = async function (text, roomId) {
    if (!text || text.indexOf('@') === -1 || !roomId || roomId === 'global') return;
    try {
        const members = (await get(ref(db, `rooms_meta/${roomId}/members`))).val() || {};
        const byName = {};
        Object.entries(members).forEach(([uid, name]) => { if (name) byName[String(name).toLowerCase()] = uid; });
        const targets = new Set();
        (text.match(/(^|[^\w@])@(\w{2,32})/g) || []).forEach(tok => {
            const uid = byName[tok.slice(tok.indexOf('@') + 1).toLowerCase()];
            if (uid) targets.add(uid);
        });
        targets.forEach(uid => window.createNotification?.(uid, 'mention', `${window.userProfileName || 'Someone'} mentioned you.`, { groupId: roomId, from: window.userProfileName }));
    } catch (e) { console.error('notifyMentions failed', e); }
};

/* ---------- Reputation & leaderboard ---------- */
// Composite score from data we already store (no hot-path scanning needed).
window.totalXP = (user) => user && user.xp ? Object.values(user.xp).reduce((a, b) => a + (b || 0), 0) : 0;
window.totalLevel = (user) => Math.floor(window.totalXP(user) / 100);
window.computeRep = function (user) {
    const msgs = (user && user.stats && user.stats.messages) || 0;
    const kudos = (user && user.kudos) || 0;
    const badges = user && user.badges ? Object.keys(user.badges).length : 0;
    return msgs * 1 + kudos * 5 + badges * 10 + window.totalXP(user);
};

// Fire-and-forget activity tracking: total contribution + per-day bucket (for the heatmap).
window.bumpMessageCount = function (uid) {
    if (!uid) return;
    runTransaction(ref(db, `users/${uid}/stats/messages`), (c) => (c || 0) + 1).catch(() => {});
    const today = new Date().toISOString().slice(0, 10);
    runTransaction(ref(db, `users/${uid}/activityByDay/${today}`), (c) => (c || 0) + 1).catch(() => {});
};

/* ---------- Activity feed & heatmap ---------- */
function relTime(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Merge timestamped events we already store into one recent feed (no per-event log needed).
window.buildActivityFeed = function (user, limit = 6) {
    const events = [];
    Object.entries(user?.badges || {}).forEach(([id, ts]) => {
        const b = window.BADGE_DEFS?.[id];
        if (b && typeof ts === 'number') events.push({ ts, icon: b.icon, text: `Earned the “${b.label}” badge` });
    });
    Object.values(user?.kudosFrom || {}).forEach(ts => { if (typeof ts === 'number') events.push({ ts, icon: 'ph-hand-heart', text: 'Received kudos' }); });
    Object.entries(user?.activityByDay || {}).forEach(([date, count]) => {
        const ts = Date.parse(date + 'T12:00:00');
        if (!isNaN(ts)) events.push({ ts, icon: 'ph-chat-circle', text: `${count} message${count > 1 ? 's' : ''}` });
    });
    return events.sort((a, b) => b.ts - a.ts).slice(0, limit)
        .map(e => `<li class="act-item"><i class="ph-bold ${e.icon}"></i> <span>${escapeHtml(e.text)}</span> <span class="act-time">${relTime(e.ts)}</span></li>`).join('');
};

/* ---------- Follow system (async, one-directional — distinct from mutual friends) ---------- */
window.toggleFollow = async function (targetUid) {
    if (!window.currentUser || !targetUid || targetUid === window.currentUser.uid) return null;
    const meRef = ref(db, `following/${window.currentUser.uid}/${targetUid}`);
    const isFollowing = (await get(meRef)).exists();
    if (isFollowing) {
        await remove(meRef);
        await remove(ref(db, `followers/${targetUid}/${window.currentUser.uid}`));
        return false;
    }
    await set(meRef, Date.now());
    await set(ref(db, `followers/${targetUid}/${window.currentUser.uid}`), Date.now());
    window.createNotification?.(targetUid, 'follow', `${window.userProfileName || 'Someone'} started following you.`, { groupId: window.currentUser.uid, from: window.userProfileName });
    window.awardXP?.(targetUid, 'leadership', 5); // gaining a follower builds Leadership
    return true;
};
window.isFollowing = async function (targetUid) {
    if (!window.currentUser || !targetUid) return false;
    return (await get(ref(db, `following/${window.currentUser.uid}/${targetUid}`))).exists();
};
window.getFollowCounts = async function (uid) {
    const [fr, fg] = await Promise.all([get(ref(db, `followers/${uid}`)), get(ref(db, `following/${uid}`))]);
    return { followers: fr.exists() ? Object.keys(fr.val()).length : 0, following: fg.exists() ? Object.keys(fg.val()).length : 0 };
};

/* ---------- Mutual rooms ---------- */
window.getMutualRooms = async function (targetUid) {
    if (!window.currentUser || !targetUid || targetUid === window.currentUser.uid) return [];
    const meta = (await get(ref(db, 'rooms_meta'))).val() || {};
    const mutual = [];
    Object.values(meta).forEach(r => {
        const m = r.members || {};
        if (m[window.currentUser.uid] && m[targetUid]) mutual.push(r.name || 'Room');
    });
    return mutual;
};

/* ---------- Public profile deep links ---------- */
// Resolve a uid or shortId (with/without #) and open that profile.
window.openProfileByRef = async function (val) {
    if (!val || !window.viewUserProfile) return;
    val = String(val).replace(/^#/, '');
    if ((await get(ref(db, `users/${val}`))).exists()) return window.viewUserProfile(val);
    const users = (await get(ref(db, 'users'))).val() || {};
    const hit = Object.entries(users).find(([, u]) => (u.shortId || '').toUpperCase() === val.toUpperCase());
    if (hit) window.viewUserProfile(hit[0]);
};
window.profileShareLink = (uid) => `${location.origin}/chat?profile=${uid}`;

/* ---------- AI member spotlight (Groq; graceful if not deployed) ---------- */
window.generateSpotlight = async function (uid, user) {
    const el = document.getElementById('up-spotlight');
    if (!el) return;
    if (!window.AI_CHAT_ENDPOINT) { el.innerHTML = `<div class="ai-empty">AI spotlight needs the aiChat function deployed.</div>`; return; }
    el.innerHTML = `<div class="ai-progress"><div class="ai-spinner"></div><span>Writing spotlight…</span></div>`;
    const ctx = `Member: ${user.displayName || 'Member'}\nBio: ${user.bio || '—'}\nStatus: ${user.status || '—'}\nReputation: ${window.computeRep(user)}\nBadges: ${Object.keys(user.badges || {}).join(', ') || 'none'}\nKudos: ${user.kudos || 0}\nMessages: ${(user.stats && user.stats.messages) || 0}`;
    try {
        const r = await fetch(window.AI_CHAT_ENDPOINT, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context: ctx, messages: [{ role: 'user', content: 'Write a warm 1–2 sentence community spotlight for this member based only on the context. Do not invent facts.' }] })
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.reply) {
            el.innerHTML = `<div class="profile-spotlight-text">✨ ${escapeHtml(data.reply)}</div><button id="up-spotlight-btn" class="ai-btn ai-btn-ghost"><i class="ph-bold ph-arrows-clockwise"></i> Regenerate</button>`;
            document.getElementById('up-spotlight-btn')?.addEventListener('click', () => window.generateSpotlight(uid, user));
        } else { el.innerHTML = `<div class="ai-empty">${escapeHtml(data.error || 'Spotlight unavailable.')}</div>`; }
    } catch (e) { el.innerHTML = `<div class="ai-empty">Couldn't reach AI: ${escapeHtml(e.message)}</div>`; }
};

/* ---------- Skills & endorsements ---------- */
// Rebuild the skills object from a comma-separated list, preserving endorsements for kept skills.
window.buildSkills = async function (uid, text) {
    const names = (text || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 12);
    const existing = (await get(ref(db, `users/${uid}/skills`))).val() || {};
    const out = {};
    names.forEach(name => {
        const key = (name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)) || 'skill';
        if (out[key]) return;
        const prev = existing[key] || {};
        out[key] = { name: name.slice(0, 30), count: prev.count || 0, by: prev.by || null };
    });
    return out;
};
window.skillsToText = (skills) => Object.values(skills || {}).map(s => s.name).filter(Boolean).join(', ');

window.renderSkills = function (skills) {
    const entries = Object.entries(skills || {});
    if (!entries.length) return '';
    return entries.map(([key, s]) =>
        `<span class="skill-chip"><span class="skill-name">${escapeHtml(s.name || key)}</span><button class="skill-endorse" data-skill="${key}" title="Endorse">+${s.count || 0}</button></span>`
    ).join('');
};

window.endorseSkill = async function (targetUid, key) {
    if (!window.currentUser || !targetUid || targetUid === window.currentUser.uid) return { ok: false, reason: 'self' };
    const byRef = ref(db, `users/${targetUid}/skills/${key}/by/${window.currentUser.uid}`);
    if ((await get(byRef)).exists()) return { ok: false, reason: 'already' };
    await set(byRef, true);
    let count = 0;
    await runTransaction(ref(db, `users/${targetUid}/skills/${key}/count`), (c) => { count = (c || 0) + 1; return count; });
    window.createNotification?.(targetUid, 'endorse', `${window.userProfileName || 'Someone'} endorsed your skill.`, { groupId: window.currentUser.uid, from: window.userProfileName });
    window.awardXP?.(window.currentUser.uid, 'support', 3); // endorsing others builds Support
    return { ok: true, count };
};

// GitHub-style contribution heatmap for the last ~14 weeks.
window.renderHeatmap = function (activityByDay) {
    const days = activityByDay || {};
    const WEEKS = 14;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - (WEEKS * 7 - 1)); start.setDate(start.getDate() - start.getDay()); // back to Sunday
    const level = (n) => n <= 0 ? 0 : n < 3 ? 1 : n < 6 ? 2 : n < 12 ? 3 : 4;
    let cols = '';
    for (let w = 0; w < WEEKS; w++) {
        let cells = '';
        for (let d = 0; d < 7; d++) {
            const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
            if (day > today) { cells += `<span class="hm-cell hm-empty"></span>`; continue; }
            const key = day.toISOString().slice(0, 10);
            const n = days[key] || 0;
            cells += `<span class="hm-cell hm-l${level(n)}" title="${key}: ${n}"></span>`;
        }
        cols += `<div class="hm-col">${cells}</div>`;
    }
    return `<div class="hm-grid">${cols}</div>`;
};

// Global, cross-room leaderboard by reputation. Reads the user directory once.
// metric: 'overall' (reputation) or a skill key (leadership/support/technical/creativity) → rank by that skill's XP.
window.renderLeaderboard = async function (metric = 'overall') {
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return;
    const skills = window.SKILL_DEFS || {};
    const filters = `<li class="lb-filters">`
        + `<button class="lb-filter ${metric === 'overall' ? 'active' : ''}" data-metric="overall">Overall</button>`
        + Object.entries(skills).map(([k, m]) => `<button class="lb-filter ${metric === k ? 'active' : ''}" data-metric="${k}" style="${metric === k ? `background:${m.color};border-color:${m.color};color:#111` : ''}"><i class="ph-bold ${m.icon}"></i></button>`).join('')
        + `</li>`;
    const wireFilters = () => listEl.querySelectorAll('.lb-filter').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); window.renderLeaderboard(b.dataset.metric); }));
    listEl.innerHTML = filters + `<li class="lb-empty">Loading…</li>`;
    try {
        const users = (await get(ref(db, 'users'))).val() || {};
        const isSkill = !!skills[metric];
        const scoreOf = (u) => isSkill ? ((u.xp && u.xp[metric]) || 0) : window.computeRep(u);
        const unit = isSkill ? `${skills[metric].label} XP` : 'pts';
        const ranked = Object.entries(users)
            .map(([uid, u]) => ({ uid, name: u.displayName || 'Anonymous', photo: u.photoUrl || '', score: scoreOf(u), lvl: window.totalLevel(u) }))
            .filter(u => u.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 25);
        const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`);
        listEl.innerHTML = filters + (ranked.length ? ranked.map((u, i) => `
            <li class="lb-row" onclick="viewUserProfile('${u.uid}')">
                <span class="lb-rank">${medal(i)}</span>
                <img class="lb-avatar" src="${escapeHtml(u.photo || window.getAvatarUrl(u.name, ''))}" alt="">
                <span class="lb-name">${escapeHtml(u.name)} <span class="lb-lvl">Lv ${u.lvl}</span></span>
                <span class="lb-rep">${u.score} ${escapeHtml(unit)}</span>
            </li>`).join('') : `<li class="lb-empty">No ranked members yet.</li>`);
        wireFilters();
    } catch (e) {
        listEl.innerHTML = filters + `<li class="lb-empty">Couldn't load leaderboard: ${escapeHtml(e.message)}</li>`;
        wireFilters();
    }
};
