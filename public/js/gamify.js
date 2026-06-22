// js/gamify.js
// Gamification: skill trees (XP-leveled skills) + daily/weekly quests.
// Data:
//   users/{uid}/xp/{skill}                         = number (lifetime XP per skill)
//   users/{uid}/quests/{periodKey}/{questId}       = { n: progress, done: bool }
import { db } from './firebase-core.js?v=30';
import { ref, get, set, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const XP_PER_LEVEL = 100;

// The four skill trees.
const SKILLS = {
    leadership: { label: 'Leadership', icon: 'ph-crown',      color: '#a78bfa' },
    support:    { label: 'Support',    icon: 'ph-hand-heart', color: '#34d399' },
    technical:  { label: 'Technical',  icon: 'ph-code',       color: '#22d3ee' },
    creativity: { label: 'Creativity', icon: 'ph-palette',    color: '#fb923c' },
};
window.SKILL_DEFS = SKILLS;

const levelOf = (xp) => Math.floor((xp || 0) / XP_PER_LEVEL);

// Award XP to a skill (atomic). Notifies + toasts on level-up.
window.awardXP = async function (uid, skill, amount) {
    if (!uid || !SKILLS[skill] || !amount) return;
    try {
        let before = 0, after = 0;
        await runTransaction(ref(db, `users/${uid}/xp/${skill}`), (c) => { before = c || 0; after = before + amount; return after; });
        if (levelOf(after) > levelOf(before)) {
            window.createNotification?.(uid, 'levelup', `⬆️ ${SKILLS[skill].label} reached level ${levelOf(after)}!`);
            if (uid === window.currentUser?.uid && window.showToast) window.showToast(`⬆️ ${SKILLS[skill].label} Lv.${levelOf(after)}!`, false);
        }
    } catch (e) { console.error('awardXP failed', e); }
};

// Skill-tree UI for the profile popup.
window.renderSkillTree = function (user) {
    const xp = (user && user.xp) || {};
    return `<div class="skilltree">` + Object.entries(SKILLS).map(([k, m]) => {
        const x = xp[k] || 0, lv = levelOf(x), pct = x % XP_PER_LEVEL;
        return `<div class="st-row">
            <span class="st-ico" style="color:${m.color}"><i class="ph-bold ${m.icon}"></i></span>
            <span class="st-name">${m.label}</span>
            <span class="st-lv">Lv ${lv}</span>
            <div class="st-bar"><div class="st-fill" style="width:${pct}%; background:${m.color}"></div></div>
        </div>`;
    }).join('') + `</div>`;
};

/* ---------- Quests ---------- */
const QUESTS = [
    // daily
    { id: 'd_msg',   type: 'daily',  event: 'message', goal: 5, skill: 'technical',  xp: 15, label: 'Send 5 messages' },
    { id: 'd_kudos', type: 'daily',  event: 'kudos',   goal: 2, skill: 'support',    xp: 15, label: 'Give 2 kudos' },
    { id: 'd_react', type: 'daily',  event: 'react',   goal: 3, skill: 'creativity', xp: 10, label: 'React 3 times' },
    // weekly
    { id: 'w_msg',    type: 'weekly', event: 'message', goal: 30, skill: 'technical',  xp: 60, label: 'Send 30 messages' },
    { id: 'w_friend', type: 'weekly', event: 'friend',  goal: 1,  skill: 'support',    xp: 40, label: 'Make a new friend' },
    { id: 'w_room',   type: 'weekly', event: 'room',    goal: 1,  skill: 'leadership', xp: 40, label: 'Create a room' },
];
window.QUEST_DEFS = QUESTS;

function periodKey(type) {
    const d = new Date();
    if (type === 'daily') return 'd_' + d.toISOString().slice(0, 10);
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
    return 'w_' + d.getFullYear() + '_' + week;
}

// Record progress toward any quests listening for this event (current user only).
window.trackQuest = async function (event, amount = 1) {
    if (!window.currentUser) return;
    const uid = window.currentUser.uid;
    for (const q of QUESTS.filter(x => x.event === event)) {
        try {
            const pRef = ref(db, `users/${uid}/quests/${periodKey(q.type)}/${q.id}`);
            const cur = (await get(pRef)).val() || { n: 0, done: false };
            if (cur.done) continue;
            const n = Math.min(q.goal, (cur.n || 0) + amount);
            const done = n >= q.goal;
            await set(pRef, { n, done });
            if (done) {
                window.awardXP(uid, q.skill, q.xp);
                window.createNotification?.(uid, 'quest', `🏆 Quest complete: ${q.label} (+${q.xp} ${SKILLS[q.skill].label} XP)`);
                if (window.showToast) window.showToast(`🏆 Quest complete: ${q.label}`, false);
                if (q.type === 'daily') window.bumpStreak(uid);
            }
        } catch (e) { console.error('trackQuest failed', e); }
    }
};

// Daily streak — counts consecutive days you completed at least one daily quest.
// Every 7 days awards a Leadership bonus. Returns the current streak count.
window.bumpStreak = async function (uid) {
    try {
        const sRef = ref(db, `users/${uid}/streak`);
        const cur = (await get(sRef)).val() || { count: 0, lastDay: '' };
        const today = new Date().toISOString().slice(0, 10);
        if (cur.lastDay === today) return cur.count; // already counted today
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const count = cur.lastDay === yesterday ? (cur.count || 0) + 1 : 1;
        await set(sRef, { count, lastDay: today });
        if (count > 0 && count % 7 === 0) {
            window.awardXP?.(uid, 'leadership', 25);
            if (uid === window.currentUser?.uid && window.showToast) window.showToast(`🔥 ${count}-day streak! +25 Leadership`, false);
        }
        return count;
    } catch (e) { console.error('bumpStreak failed', e); return 0; }
};

// Quest panel UI.
window.renderQuests = async function () {
    const el = document.getElementById('quests-list');
    if (!el) return;
    el.innerHTML = `<li class="q-empty">Loading quests…</li>`;
    try {
        const uid = window.currentUser.uid;
        const [ds, ws, st] = await Promise.all([
            get(ref(db, `users/${uid}/quests/${periodKey('daily')}`)),
            get(ref(db, `users/${uid}/quests/${periodKey('weekly')}`)),
            get(ref(db, `users/${uid}/streak`)),
        ]);
        const prog = { daily: ds.val() || {}, weekly: ws.val() || {} };
        // Streak only counts if completed today or yesterday (otherwise it's broken).
        const streak = st.val() || { count: 0, lastDay: '' };
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const liveStreak = (streak.lastDay === today || streak.lastDay === yesterday) ? streak.count : 0;
        const row = (q) => {
            const p = prog[q.type][q.id] || { n: 0, done: false };
            const pct = Math.min(100, Math.round((p.n / q.goal) * 100));
            const sk = SKILLS[q.skill];
            return `<li class="q-row ${p.done ? 'q-done' : ''}">
                <div class="q-top"><span class="q-label">${q.label}</span><span class="q-reward" style="color:${sk.color}">+${q.xp} ${sk.label}</span></div>
                <div class="q-bar"><div class="q-fill" style="width:${pct}%; background:${sk.color}"></div></div>
                <div class="q-meta">${p.done ? '✓ Complete' : `${p.n}/${q.goal}`}</div>
            </li>`;
        };
        el.innerHTML = `<li class="q-streak">🔥 ${liveStreak} day streak</li>`
            + `<li class="q-section">Daily</li>` + QUESTS.filter(q => q.type === 'daily').map(row).join('')
            + `<li class="q-section">Weekly</li>` + QUESTS.filter(q => q.type === 'weekly').map(row).join('');
    } catch (e) { el.innerHTML = `<li class="q-empty">Couldn't load quests.</li>`; }
};
