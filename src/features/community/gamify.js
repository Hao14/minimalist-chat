// js/gamify.js
// Gamification: skill trees (XP-leveled skills) + daily/weekly quests.
// Data:
//   users/{uid}/xp/{skill}                         = number (lifetime XP per skill)
//   users/{uid}/quests/{periodKey}/{questId}       = { n: progress, done: bool }
import { db } from '../../lib/firebase.js';
import { ref, get, set, runTransaction, onValue } from 'firebase/database';
import { createElement } from 'react';
import { playUiSound } from '../audio/uiSoundService.js';
import { createHostAwareRoot } from '../shell/hostAwareRoot.js';
import QuestList from './QuestList.jsx';

const XP_PER_LEVEL = 100;
const questsRoot = createHostAwareRoot();
let questsLiveUnsubscribe = null;
let questRenderGeneration = 0;
let questLiveContextKey = '';
let questLiveHost = null;
let questLiveRender = null;
let questBoundaryTimer = null;
let questRestoreFocus = false;

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
            if (uid === window.currentUser?.uid) {
                void playUiSound('achievement', { dedupeKey: `level:${uid}:${skill}:${levelOf(after)}` });
                if (window.showToast) window.showToast(`⬆️ ${SKILLS[skill].label} Lv.${levelOf(after)}!`, false);
            }
        }
    } catch (e) { console.error('awardXP failed', e); }
};

// Skill-tree UI for the profile popup.
window.renderSkillTree = function (user) {
    const xp = (user && user.xp) || {};
    return `<div class="skilltree">` + Object.entries(SKILLS).map(([k, m]) => {
        const x = xp[k] || 0, lv = levelOf(x), pct = x % XP_PER_LEVEL;
        return `<div class="st-row" style="--st-color:${m.color}">
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
                void playUiSound('achievement', { dedupeKey: `quest:${periodKey(q.type)}:${q.id}` });
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
function computeLiveStreak(streak) {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    return (streak.lastDay === today || streak.lastDay === yesterday) ? (streak.count || 0) : 0;
}

function nextQuestBoundaryDelay() {
    const now = new Date();
    const nextUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const nextLocalMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    return Math.max(1000, Math.min(nextUtcMidnight, nextLocalMidnight) - now.getTime() + 1000);
}

function scheduleQuestBoundaryRefresh(renderGeneration) {
    if (questBoundaryTimer) clearTimeout(questBoundaryTimer);
    questBoundaryTimer = window.setTimeout(() => {
        questBoundaryTimer = null;
        if (renderGeneration !== questRenderGeneration) return;

        const panel = document.getElementById('updates-panel');
        const questTab = document.getElementById('tab-quests');
        const questList = document.getElementById('quests-list');
        const questViewIsActive = panel?.classList.contains('open')
            && questTab?.getAttribute('aria-selected') === 'true'
            && questList?.getAttribute('aria-hidden') !== 'true';

        if (questViewIsActive) window.renderQuests?.({ force: true });
    }, nextQuestBoundaryDelay());
}

function stopQuestLiveSync() {
    questRenderGeneration += 1;
    if (questBoundaryTimer) clearTimeout(questBoundaryTimer);
    questBoundaryTimer = null;
    questsLiveUnsubscribe?.();
    questsLiveUnsubscribe = null;
    questLiveContextKey = '';
    questLiveHost = null;
    questLiveRender = null;
    questRestoreFocus = false;
}

window.stopQuestLiveSync = stopQuestLiveSync;

window.renderQuests = function ({ force = false, restoreFocus = false } = {}) {
    const el = document.getElementById('quests-list');
    if (!el) return false;

    const uid = window.currentUser?.uid;
    const dailyKey = periodKey('daily');
    const weeklyKey = periodKey('weekly');
    const contextKey = uid ? `${uid}|${dailyKey}|${weeklyKey}` : '';

    if (!force
        && contextKey
        && questLiveContextKey === contextKey
        && questLiveHost === el
        && questsLiveUnsubscribe
        && questLiveRender) {
        questRestoreFocus = questRestoreFocus || restoreFocus;
        questLiveRender();
        return true;
    }

    stopQuestLiveSync();
    const renderGeneration = questRenderGeneration;
    const renderQuestNode = (node) => {
        if (renderGeneration !== questRenderGeneration || !el.isConnected) return false;
        return questsRoot.render(el, node);
    };
    questRestoreFocus = restoreFocus;
    el.setAttribute('aria-busy', 'true');
    renderQuestNode(createElement(QuestList, { status: 'loading' }));

    try {
        if (!uid) throw new Error('Sign in to view quests.');

        const state = {
            daily: { status: 'loading', value: null, error: null },
            weekly: { status: 'loading', value: null, error: null },
            streak: { status: 'loading', value: null, error: null },
        };

        const renderLiveState = () => {
            const sources = Object.values(state);
            const failedSource = sources.find((source) => source.status === 'error');
            if (failedSource) {
                el.setAttribute('aria-busy', 'false');
                renderQuestNode(createElement(QuestList, {
                    status: 'error',
                    error: failedSource.error?.message || 'Quest progress is temporarily unavailable.',
                    onRetry: () => window.renderQuests?.({ force: true, restoreFocus: true }),
                }));
                return;
            }

            if (sources.some((source) => source.status !== 'ready')) {
                el.setAttribute('aria-busy', 'true');
                renderQuestNode(createElement(QuestList, { status: 'loading' }));
                return;
            }

            el.setAttribute('aria-busy', 'false');
            renderQuestNode(createElement(QuestList, {
                liveStreak: computeLiveStreak(state.streak.value || {}),
                progress: {
                    daily: state.daily.value || {},
                    weekly: state.weekly.value || {},
                },
                quests: QUESTS,
                restoreFocus: questRestoreFocus,
                skills: SKILLS,
                status: 'ready',
            }));

            if (questRestoreFocus) {
                questRestoreFocus = false;
                window.requestAnimationFrame(() => {
                    if (renderGeneration !== questRenderGeneration || !el.isConnected) return;
                    el.querySelector('#quest-board-summary')?.focus({ preventScroll: true });
                });
            }
        };

        const bindQuestSource = (source, path) => onValue(ref(db, path), (snapshot) => {
            state[source] = { status: 'ready', value: snapshot.val() || {}, error: null };
            renderLiveState();
        }, (error) => {
            state[source] = { status: 'error', value: null, error };
            renderLiveState();
        });

        questLiveContextKey = contextKey;
        questLiveHost = el;
        questLiveRender = renderLiveState;
        const unsubs = [];
        const unsubscribeSources = () => {
            unsubs.forEach((unsubscribe) => {
                try {
                    unsubscribe();
                } catch (error) {
                    console.warn('Quest listener cleanup failed.', error);
                }
            });
        };
        try {
            unsubs.push(
                bindQuestSource('daily', `users/${uid}/quests/${dailyKey}`),
                bindQuestSource('weekly', `users/${uid}/quests/${weeklyKey}`),
                bindQuestSource('streak', `users/${uid}/streak`),
            );
        } catch (error) {
            unsubscribeSources();
            throw error;
        }

        questsLiveUnsubscribe = unsubscribeSources;
        scheduleQuestBoundaryRefresh(renderGeneration);
        return true;
    } catch (error) {
        el.setAttribute('aria-busy', 'false');
        renderQuestNode(createElement(QuestList, {
            status: 'error',
            error: error.message,
            onRetry: () => window.renderQuests?.({ force: true, restoreFocus: true }),
        }));
        return false;
    }
};
