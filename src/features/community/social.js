// js/social.js
// Recognition layer: earned badges, kudos, and @mention notifications.
// Data:
//   users/{uid}/badges/{badgeId} = timestamp        (earned badges)
//   users/{uid}/kudos            = number           (kudos count)
//   users/{uid}/kudosFrom/{uid}  = timestamp        (one kudos per giver, anti-spam)
import { db } from '../../lib/firebase.js';
import { ref, get, increment, set, remove, runTransaction, update } from 'firebase/database';
import { escapeHtml } from '../../lib/text.js';
import { askProfileSpotlight, getLocalAiConfig, getLocalAiStatus, localAiStatusMessage } from '../ai/localAiClient.js';
import { createElement } from 'react';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import Leaderboard from './Leaderboard.jsx';
import RecognitionPanel from './RecognitionPanel.jsx';
import './communityUpdates.css';
import './communityUpdatesCodex.css';
import {
    buildRankSnapshot,
    communityLevel,
    reputationBreakdown,
    totalCommunityXp,
} from './communityPresentation.js';
import { createTimedSingleFlightCache } from './timedSingleFlightCache.js';

// Earned-badge catalog (distinct from paid tier badges).
const BADGES = {
    welcome:      { label: 'Welcome',      icon: 'ph-hand-waving',  color: '#60a5fa' },
    founder:      { label: 'Founder',      icon: 'ph-crown',        color: '#a78bfa' }, // created a room
    first_friend: { label: 'First Friend', icon: 'ph-users',        color: '#34d399' },
    social:       { label: 'Social',       icon: 'ph-users-three',  color: '#22d3ee' }, // 10 friends
    liked:        { label: 'Liked',        icon: 'ph-heart',        color: '#f472b6' }, // 5 kudos
    popular:      { label: 'Popular',      icon: 'ph-star',         color: '#fbbf24' }, // 25 kudos
    member_week:  { label: 'Member of the Week', icon: 'ph-crown',  color: '#f59e0b' },
    community_award: { label: 'Community Award', icon: 'ph-medal',  color: '#fb923c' },
    top_contributor: { label: 'Top Contributor', icon: 'ph-trophy', color: '#38bdf8' },
    anniversary:  { label: 'Anniversary',  icon: 'ph-confetti',     color: '#a78bfa' },
    birthday:     { label: 'Birthday',     icon: 'ph-cake',         color: '#f472b6' },
};
window.BADGE_DEFS = BADGES;
const leaderboardRoot = createHostAwareRoot();
const recognitionRoot = createHostAwareRoot();
const COMMUNITY_PROFILE_CACHE_TTL = 2 * 60 * 1000;
const FOLLOW_SOCIAL_CACHE_TTL = 30 * 1000;
const followStatusCache = createTimedSingleFlightCache({
    ttlMs: FOLLOW_SOCIAL_CACHE_TTL,
    maxEntries: 96,
});
const followCountsCache = createTimedSingleFlightCache({
    ttlMs: FOLLOW_SOCIAL_CACHE_TTL,
    maxEntries: 64,
});
const leaderboardCache = new Map();
const leaderboardLoads = new Map();
let leaderboardRequestId = 0;
let communityProfilesCache = null;
let communityProfilesLoad = null;
let recognitionCache = null;
let recognitionLoad = null;
let recognitionRequestId = 0;

function invalidateCommunityPresentationCache() {
    communityProfilesCache = null;
    leaderboardCache.clear();
    recognitionCache = null;
}

function currentCommunityCacheKey() {
    return window.currentUser?.uid || 'signed-out';
}

function isFreshCommunityCache(entry, key = currentCommunityCacheKey()) {
    return Boolean(entry && entry.key === key && Date.now() - entry.loadedAt < COMMUNITY_PROFILE_CACHE_TTL);
}

function followStatusCacheKey(viewerUid, targetUid) {
    return `${viewerUid}:${targetUid}`;
}

function invalidateFollowSocialCache(viewerUid, targetUid) {
    followStatusCache.invalidate(followStatusCacheKey(viewerUid, targetUid));
    followCountsCache.invalidate(viewerUid);
    followCountsCache.invalidate(targetUid);
}

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
        const giverUid = window.currentUser.uid;
        const givenRef = ref(db, `users/${giverUid}/kudosGiven/${targetUid}`);
        if ((await get(givenRef)).exists()) return { ok: false, reason: 'already' };

        const timestamp = Date.now();
        await update(ref(db), {
            [`users/${giverUid}/kudosGiven/${targetUid}`]: timestamp,
            [`users/${targetUid}/kudosFrom/${giverUid}`]: timestamp,
            [`users/${targetUid}/kudos`]: increment(1),
        });

        for (const badgeId of ['liked', 'popular']) {
            try {
                await set(ref(db, `users/${targetUid}/badges/${badgeId}`), Date.now());
                window.createNotification?.(targetUid, 'badge', `🏅 You earned the "${BADGES[badgeId].label}" badge!`);
            } catch {
                // The badge rule grants this write only when its kudos threshold is reached.
            }
        }
        if (window.createNotification) window.createNotification(targetUid, 'kudos', `👏 ${window.userProfileName || 'Someone'} gave you kudos!`, { groupId: window.currentUser.uid, from: window.userProfileName });
        try {
            await window.awardXP?.(window.currentUser.uid, 'support', 5); // giver earns Support XP
        } catch (error) {
            console.warn('Kudos was sent, but Support XP could not be updated.', error);
        }
        window.trackQuest?.('kudos');
        invalidateCommunityPresentationCache();
        return { ok: true, count: null };
    } catch (e) {
        const code = String(e?.code || '').toLowerCase();
        return { ok: false, reason: code.includes('permission-denied') ? 'already' : e.message };
    }
};

function mentionHandle(value) {
    return String(value || '')
        .trim()
        .replace(/^@+/, '')
        .replace(/[^A-Za-z0-9_-]+/g, '')
        .slice(0, 32)
        .toLowerCase();
}

function addMentionHandles(map, uid, user = {}, fallbackName = '') {
    if (!uid) return;
    const names = [
        fallbackName,
        user.displayName,
        user.name,
        user.username,
        user.shortId,
    ];
    names.forEach((name) => {
        const handle = mentionHandle(name);
        if (handle) map[handle] = uid;
    });
}

// @mention notifications — resolve @handles against room members, and against all users in Global Chat.
window.notifyMentions = async function (text, roomId, context = {}) {
    if (!text || text.indexOf('@') === -1 || !roomId) return;
    try {
        const directory = (await get(ref(db, 'user_directory'))).val() || {};
        const members = roomId === 'global' ? null : ((await get(ref(db, `rooms_meta/${roomId}/members`))).val() || {});
        const byName = {};
        if (members) {
            Object.entries(members).forEach(([uid, name]) => addMentionHandles(byName, uid, directory[uid] || {}, name));
        } else {
            Object.entries(directory).forEach(([uid, user]) => addMentionHandles(byName, uid, user));
        }

        const targets = new Set();
        for (const match of text.matchAll(/(^|[^\w@])@([A-Za-z0-9_-]{2,32})/g)) {
            const uid = byName[mentionHandle(match[2])];
            if (uid) targets.add(uid);
        }

        const senderUid = context.fromUid || window.currentUser?.uid || '';
        if (senderUid) targets.delete(senderUid);

        targets.forEach(uid => window.createNotification?.(uid, 'mention', `${window.userProfileName || 'Someone'} mentioned you.`, {
            groupId: context.groupId || roomId,
            from: window.userProfileName,
            action: 'room-message',
            roomId,
            roomName: context.roomName || document.getElementById('active-room-name-display')?.textContent?.trim() || (roomId === 'global' ? 'Global Chat' : 'Room'),
            shortId: context.shortId || window.activeRoomShortId || (roomId === 'global' ? 'GLOBAL' : ''),
            channelId: context.channelId || window.activeChannelId || 'general',
            messageId: context.messageId || '',
        }));
    } catch (e) { console.error('notifyMentions failed', e); }
};

/* ---------- Reputation & leaderboard ---------- */
// Composite score from data we already store (no hot-path scanning needed).
window.totalXP = totalCommunityXp;
window.totalLevel = communityLevel;
window.computeRep = (user) => reputationBreakdown(user).total;

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
    const viewerUid = window.currentUser.uid;
    const meRef = ref(db, `following/${viewerUid}/${targetUid}`);
    const isFollowing = (await get(meRef)).exists();
    // Drop cached and in-flight reads before and after the mutation so an older
    // request cannot restore stale relationship/count data while writes settle.
    invalidateFollowSocialCache(viewerUid, targetUid);
    try {
        if (isFollowing) {
            await remove(meRef);
            await remove(ref(db, `followers/${targetUid}/${viewerUid}`));
            return false;
        }
        await set(meRef, Date.now());
        await set(ref(db, `followers/${targetUid}/${viewerUid}`), Date.now());
        window.createNotification?.(targetUid, 'follow', `${window.userProfileName || 'Someone'} started following you.`, { groupId: viewerUid, from: window.userProfileName });
        window.awardXP?.(targetUid, 'leadership', 5); // gaining a follower builds Leadership
        return true;
    } finally {
        invalidateFollowSocialCache(viewerUid, targetUid);
    }
};
window.isFollowing = async function (targetUid) {
    const viewerUid = window.currentUser?.uid;
    if (!viewerUid || !targetUid) return false;
    return followStatusCache.load(
        followStatusCacheKey(viewerUid, targetUid),
        async () => (await get(ref(db, `following/${viewerUid}/${targetUid}`))).exists(),
    );
};
window.getFollowCounts = async function (uid) {
    if (!uid) return { followers: 0, following: 0 };
    return followCountsCache.load(uid, async () => {
        const [fr, fg] = await Promise.all([get(ref(db, `followers/${uid}`)), get(ref(db, `following/${uid}`))]);
        return { followers: fr.exists() ? Object.keys(fr.val()).length : 0, following: fg.exists() ? Object.keys(fg.val()).length : 0 };
    });
};

/* ---------- Mutual rooms ---------- */
window.getMutualRooms = async function (targetUid) {
    if (!window.currentUser || !targetUid || targetUid === window.currentUser.uid) return [];
    const mine = (await get(ref(db, `user_rooms/${window.currentUser.uid}`))).val() || {};
    const mutual = [];
    const roomIds = Object.keys(mine).filter((roomId) => roomId && roomId !== 'global').slice(0, 80);
    const snapshots = await Promise.all(roomIds.map((roomId) => get(ref(db, `rooms_meta/${roomId}`)).catch(() => null)));
    snapshots.forEach((snapshot) => {
        const r = snapshot?.val?.() || {};
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
    const directory = (await get(ref(db, 'user_directory'))).val() || {};
    if (directory[val]) return window.viewUserProfile(val);
    const hit = Object.entries(directory).find(([, u]) => (u.shortId || '').toUpperCase() === val.toUpperCase());
    if (hit) window.viewUserProfile(hit[0]);
};
window.profileShareLink = (uid) => `${location.origin}/chat?profile=${uid}`;

/* ---------- AI member spotlight (protected gateway or loopback-only local Ollama) ---------- */
window.cancelProfileSpotlightRequest = function cancelProfileSpotlightRequest() {
    const spotlight = document.getElementById('up-spotlight');
    spotlight?._aiSpotlightAbortController?.abort();
    if (spotlight) {
        spotlight._aiSpotlightAbortController = null;
        delete spotlight.dataset.aiSpotlightRequest;
    }
};

window.generateSpotlight = async function (uid, user) {
    const el = document.getElementById('up-spotlight');
    if (!el) return;
    el._aiSpotlightAbortController?.abort();
    const requestController = new AbortController();
    el._aiSpotlightAbortController = requestController;
    const requestToken = `${uid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    el.dataset.aiSpotlightRequest = requestToken;
    const isCurrentRequest = () => {
        const popup = document.getElementById('user-profile-popup');
        return Boolean(
            !requestController.signal.aborted
            && document.getElementById('up-spotlight') === el
            && el.dataset.aiSpotlightRequest === requestToken
            && popup?.dataset.profileUid === uid
            && !popup.classList.contains('hidden')
        );
    };
    const renderSpotlight = (payload) => {
        if (!isCurrentRequest()) return;
        if (window.renderProfileSpotlight) {
            window.renderProfileSpotlight({ ...payload, onRetry: () => window.generateSpotlight(uid, user) });
        } else {
            el.textContent = payload.text || payload.error || '';
        }
    };
    renderSpotlight({ status: 'loading' });
    try {
        const config = getLocalAiConfig();
        const status = await getLocalAiStatus(config);
        if (!isCurrentRequest()) return;
        if (status.state !== 'ready') {
            renderSpotlight({ status: 'error', error: status.message || localAiStatusMessage(status) });
            return;
        }
        const result = await askProfileSpotlight({
            targetUid: uid,
            user,
            reputation: window.computeRep(user),
            config,
            signal: requestController.signal,
            onQueueUpdate: (queue) => {
                if (queue.status === 'queued') {
                    renderSpotlight({ status: 'loading', text: `Queued safely · position ${Math.max(1, Number(queue.position) || 1)}` });
                } else if (queue.status === 'running') {
                    renderSpotlight({ status: 'loading', text: 'Writing spotlight now…' });
                }
            },
        });
        renderSpotlight({
            status: 'ready',
            text: result.reply,
            provider: result.provider || '',
            model: result.model || '',
        });
    } catch (e) {
        if (!isCurrentRequest()) return;
        renderSpotlight({ status: 'error', error: localAiStatusMessage(e) });
    } finally {
        if (el._aiSpotlightAbortController === requestController) {
            el._aiSpotlightAbortController = null;
        }
    }
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

// Community leaderboard. Identity comes from the public directory; private
// reputation data is read only for the signed-in member until a trusted public
// aggregate is available.
// metric: 'overall' (reputation) or a skill key (leadership/support/technical/creativity) → rank by that skill's XP.
window.renderLeaderboard = async function (metric = 'overall', options = {}) {
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return;
    const requestId = ++leaderboardRequestId;
    const communityKey = currentCommunityCacheKey();
    const cacheKey = `${communityKey}:${metric}`;
    const skills = window.SKILL_DEFS || {};
    const force = options?.force === true;
    const isCurrentHost = () => document.getElementById('leaderboard-list') === listEl;
    const renderLeaderboardState = (payload) => {
        listEl.setAttribute('aria-busy', payload.status === 'loading' ? 'true' : 'false');
        leaderboardRoot.render(listEl, createElement(Leaderboard, {
            communityRankingAvailable: false,
            metric,
            onMetric: window.renderLeaderboard,
            onOpenProfile: (row) => window.viewUserProfile?.(row.uid),
            onRetry: () => window.renderLeaderboard(metric, { force: true }),
            skills,
            ...payload,
        }));
    };

    if (force) {
        leaderboardCache.delete(cacheKey);
        communityProfilesCache = null;
    }

    const cached = force ? null : leaderboardCache.get(cacheKey);
    if (cached) {
        renderLeaderboardState(cached.payload);
        if (Date.now() - cached.loadedAt < COMMUNITY_PROFILE_CACHE_TTL) return;
    } else {
        renderLeaderboardState({ status: 'loading' });
    }

    try {
        let load = leaderboardLoads.get(cacheKey);
        if (!load) {
            load = loadCommunityProfiles().then((profileRows) => {
                const snapshot = buildRankSnapshot({
                    currentUid: window.currentUser?.uid || '',
                    metric,
                    profileRows,
                    skills,
                });
                return { ...snapshot, status: 'ready' };
            }).finally(() => leaderboardLoads.delete(cacheKey));
            leaderboardLoads.set(cacheKey, load);
        }

        const payload = await load;
        leaderboardCache.set(cacheKey, { loadedAt: Date.now(), payload });
        if (requestId === leaderboardRequestId && communityKey === currentCommunityCacheKey() && isCurrentHost()) {
            renderLeaderboardState(payload);
        }
    } catch (e) {
        console.warn('Leaderboard unavailable; using local fallback.', e);
        if (!cached && requestId === leaderboardRequestId && isCurrentHost()) {
            renderLeaderboardState({ error: e.message, status: 'error' });
        }
    }
};

function parseLooseDate(value) {
    if (!value) return null;
    if (typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const date = new Date(trimmed);
        if (!Number.isNaN(date.getTime())) return date;
        const monthDay = trimmed.match(/^(\d{1,2})[/-](\d{1,2})$/);
        if (monthDay) {
            const now = new Date();
            return new Date(now.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]));
        }
    }
    return null;
}

function dayKey(date) {
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function upcomingMeta(date, label) {
    if (!date) return '';
    const now = new Date();
    const thisYear = new Date(now.getFullYear(), date.getMonth(), date.getDate());
    const next = thisYear < new Date(now.getFullYear(), now.getMonth(), now.getDate())
        ? new Date(now.getFullYear() + 1, date.getMonth(), date.getDate())
        : thisYear;
    const days = Math.max(0, Math.round((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000));
    if (days === 0) return `${label} today`;
    if (days === 1) return `${label} tomorrow`;
    return `${label} in ${days} days`;
}

function isWithinNextDays(date, days = 30) {
    if (!date) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let next = new Date(now.getFullYear(), date.getMonth(), date.getDate());
    if (next < today) next = new Date(now.getFullYear() + 1, date.getMonth(), date.getDate());
    return next - today <= days * 86400000;
}

function weeklyActivityScore(user) {
    const activity = user?.activityByDay || {};
    const today = new Date();
    const cutoff = new Date(today);
    cutoff.setDate(today.getDate() - 6);
    cutoff.setHours(0, 0, 0, 0);
    return Object.entries(activity).reduce((sum, [date, count]) => {
        const parsed = new Date(`${date}T00:00:00`);
        if (Number.isNaN(parsed.getTime()) || parsed < cutoff) return sum;
        return sum + Number(count || 0);
    }, 0);
}

async function loadCommunityProfiles() {
    const cacheKey = currentCommunityCacheKey();
    if (isFreshCommunityCache(communityProfilesCache, cacheKey)) return communityProfilesCache.rows;
    if (communityProfilesLoad?.key === cacheKey) return communityProfilesLoad.promise;

    const promise = (async () => {
        const currentUid = window.currentUser?.uid || '';
        const [directorySnapshot, selfSnapshot] = await Promise.all([
            get(ref(db, 'user_directory')).catch((error) => {
                console.warn('Public community directory unavailable.', error);
                return null;
            }),
            currentUid ? get(ref(db, `users/${currentUid}`)).catch((error) => {
                console.warn('Current member profile unavailable.', error);
                return null;
            }) : Promise.resolve(null),
        ]);
        const directory = directorySnapshot?.val?.() || {};
        const selfProfile = selfSnapshot?.val?.() || {};
        const rowsByUid = { ...directory };
        if (currentUid && !rowsByUid[currentUid]) {
            rowsByUid[currentUid] = {
                displayName: selfProfile.displayName || window.userProfileName || window.currentUser?.displayName || 'You',
                photoUrl: selfProfile.photoUrl || window.userPhotoUrl || window.currentUser?.photoURL || '',
                shortId: selfProfile.shortId || window.userShortId || '',
            };
        }

        // `/users/$uid` is private. Community surfaces use the public directory for
        // everyone else and enrich only the signed-in member with their own stats.
        const rows = Object.entries(rowsByUid).map(([uid, publicProfile = {}]) => {
            const privateProfile = uid === currentUid ? selfProfile : {};
            const joinedAt = parseLooseDate(
                privateProfile.joinedAt
                || privateProfile.createdAt
                || privateProfile.created
                || publicProfile?.joinedAt
                || publicProfile?.createdAt
                || publicProfile?.created
            );
            const birthday = parseLooseDate(privateProfile.birthday || privateProfile.birthdate || publicProfile?.birthday || publicProfile?.birthdate);
            return {
                uid,
                name: publicProfile?.displayName || privateProfile.displayName || privateProfile.name || 'Anonymous',
                handle: publicProfile?.username || privateProfile.username || publicProfile?.shortId || privateProfile.shortId || '',
                photo: publicProfile?.photoUrl || privateProfile.photoUrl || '',
                score: window.computeRep(privateProfile),
                lvl: window.totalLevel(privateProfile),
                weekScore: weeklyActivityScore(privateProfile),
                joinedAt,
                birthday,
                privateProfile,
                publicProfile: publicProfile || {},
            };
        });
        communityProfilesCache = { key: cacheKey, loadedAt: Date.now(), rows };
        return rows;
    })();

    communityProfilesLoad = { key: cacheKey, promise };
    try {
        return await promise;
    } finally {
        if (communityProfilesLoad?.promise === promise) communityProfilesLoad = null;
    }
}

window.resolveUserRef = async function resolveUserRef(value) {
    const needle = mentionHandle(String(value || '').trim());
    if (!needle) return null;
    const directory = (await get(ref(db, 'user_directory'))).val() || {};
    if (directory[needle]) return needle;
    const hit = Object.entries(directory).find(([uid, user]) => {
        const candidates = [uid, user?.displayName, user?.name, user?.username, user?.shortId].map(mentionHandle);
        return candidates.includes(needle);
    });
    return hit ? hit[0] : null;
};

window.giveCommunityAward = async function giveCommunityAward(targetRef, badgeId = 'community_award') {
    if (!window.currentUser) return { ok: false, reason: 'auth' };
    const uid = await window.resolveUserRef(targetRef);
    if (!uid) return { ok: false, reason: 'not-found' };
    await window.awardBadge(uid, BADGES[badgeId] ? badgeId : 'community_award');
    try {
        await window.awardXP?.(window.currentUser.uid, 'leadership', 5);
    } catch {
        // XP is a best-effort community bonus; the award itself should still succeed.
    }
    window.createNotification?.(uid, 'award', `${window.userProfileName || 'Someone'} gave you a community award.`, {
        groupId: `${window.currentUser.uid}_${badgeId}`,
        from: window.userProfileName,
    });
    return { ok: true, uid };
};

window.renderRecognition = async function renderRecognition(options = {}) {
    const listEl = document.getElementById('recognition-list');
    if (!listEl) return;
    const requestId = ++recognitionRequestId;
    const communityKey = currentCommunityCacheKey();
    const force = options?.force === true;
    const isCurrentHost = () => document.getElementById('recognition-list') === listEl;
    const renderRecognitionState = (payload) => {
        listEl.setAttribute('aria-busy', payload.status === 'loading' ? 'true' : 'false');
        recognitionRoot.render(listEl, createElement(RecognitionPanel, {
            onGiveKudos: window.giveKudos,
            onOpenProfile: (row) => window.viewUserProfile?.(row.uid),
            onRetry: () => window.renderRecognition({ force: true }),
            ...payload,
        }));
    };

    if (force) {
        communityProfilesCache = null;
        recognitionCache = null;
    }

    const cached = !force && recognitionCache?.key === communityKey ? recognitionCache : null;
    if (cached) {
        renderRecognitionState(cached.payload);
        if (isFreshCommunityCache(cached, communityKey)) return;
    } else {
        renderRecognitionState({ status: 'loading' });
    }

    try {
        let load = recognitionLoad?.key === communityKey ? recognitionLoad.promise : null;
        if (!load) {
            load = loadCommunityProfiles().then((profiles) => {
                const ranked = profiles
                    .map((row) => ({ ...row, score: Number(row.score || 0), weekScore: Number(row.weekScore || 0) }))
                    .sort((a, b) => b.score - a.score);
                const currentUid = window.currentUser?.uid || '';
                const currentMember = ranked.find((row) => row.uid === currentUid) || null;
                const memberOfWeek = [...ranked]
                    .filter((row) => row.weekScore > 0 || row.score > 0)
                    .sort((a, b) => (b.weekScore - a.weekScore) || (b.score - a.score))[0] || null;
                const anniversaries = ranked
                    .filter((row) => isWithinNextDays(row.joinedAt, 30))
                    .map((row) => ({ ...row, meta: upcomingMeta(row.joinedAt, 'Anniversary') }))
                    .sort((a, b) => dayKey(a.joinedAt).localeCompare(dayKey(b.joinedAt)));
                const birthdays = ranked
                    .filter((row) => isWithinNextDays(row.birthday, 30))
                    .map((row) => ({ ...row, meta: upcomingMeta(row.birthday, 'Birthday') }))
                    .sort((a, b) => dayKey(a.birthday).localeCompare(dayKey(b.birthday)));
                return {
                    anniversaries,
                    birthdays,
                    currentUid,
                    kudosCount: Number(currentMember?.privateProfile?.kudos || 0),
                    members: ranked.map(({ handle, name, photo, uid }) => ({ handle, name, photo, uid })),
                    preferredUid: memberOfWeek?.uid === currentUid ? '' : memberOfWeek?.uid || '',
                    sentUids: Object.keys(currentMember?.privateProfile?.kudosGiven || {}),
                    status: 'ready',
                };
            });
            recognitionLoad = { key: communityKey, promise: load };
            const clearRecognitionLoad = () => {
                if (recognitionLoad?.promise === load) recognitionLoad = null;
            };
            load.then(clearRecognitionLoad, clearRecognitionLoad);
        }

        const payload = await load;
        recognitionCache = { key: communityKey, loadedAt: Date.now(), payload };
        if (requestId === recognitionRequestId && communityKey === currentCommunityCacheKey() && isCurrentHost()) {
            renderRecognitionState(payload);
        }
    } catch (e) {
        if (!cached && requestId === recognitionRequestId && isCurrentHost()) {
            renderRecognitionState({ error: e.message, status: 'error' });
        }
    }
};
