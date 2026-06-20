// js/social.js
// Recognition layer: earned badges, kudos, and @mention notifications.
// Data:
//   users/{uid}/badges/{badgeId} = timestamp        (earned badges)
//   users/{uid}/kudos            = number           (kudos count)
//   users/{uid}/kudosFrom/{uid}  = timestamp        (one kudos per giver, anti-spam)
import { db } from './firebase-core.js?v=19';
import { ref, get, set, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { escapeHtml } from './utils.js?v=19';

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
window.computeRep = function (user) {
    const msgs = (user && user.stats && user.stats.messages) || 0;
    const kudos = (user && user.kudos) || 0;
    const badges = user && user.badges ? Object.keys(user.badges).length : 0;
    return msgs * 1 + kudos * 5 + badges * 10;
};

// Fire-and-forget message counter (feeds reputation/leaderboard "contribution").
window.bumpMessageCount = function (uid) {
    if (!uid) return;
    runTransaction(ref(db, `users/${uid}/stats/messages`), (c) => (c || 0) + 1).catch(() => {});
};

// Global, cross-room leaderboard by reputation. Reads the user directory once.
window.renderLeaderboard = async function () {
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return;
    listEl.innerHTML = `<li class="lb-empty">Loading leaderboard…</li>`;
    try {
        const users = (await get(ref(db, 'users'))).val() || {};
        const ranked = Object.entries(users)
            .map(([uid, u]) => ({ uid, name: u.displayName || 'Anonymous', photo: u.photoUrl || '', rep: window.computeRep(u), kudos: u.kudos || 0 }))
            .filter(u => u.rep > 0)
            .sort((a, b) => b.rep - a.rep)
            .slice(0, 25);
        if (!ranked.length) { listEl.innerHTML = `<li class="lb-empty">No ranked members yet. Send messages and earn kudos to climb!</li>`; return; }
        const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`);
        listEl.innerHTML = ranked.map((u, i) => `
            <li class="lb-row" onclick="viewUserProfile('${u.uid}')">
                <span class="lb-rank">${medal(i)}</span>
                <img class="lb-avatar" src="${escapeHtml(u.photo || window.getAvatarUrl(u.name, ''))}" alt="">
                <span class="lb-name">${escapeHtml(u.name)}</span>
                <span class="lb-rep">${u.rep} pts</span>
            </li>`).join('');
    } catch (e) {
        listEl.innerHTML = `<li class="lb-empty">Couldn't load leaderboard: ${escapeHtml(e.message)}</li>`;
    }
};
