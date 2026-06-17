// js/app.js
import { db, auth } from './firebase-core.js';
import { ref, set, get, onValue, onChildAdded, onChildChanged, remove, serverTimestamp, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

import './auth.js';
import './rooms.js';
import './chat.js';

// --- GLOBAL STATE ---
window.activeRoomId = 'global';
window.activeRoomShortId = 'GLOBAL';
window.currentRoomListener = null;
window.oldestMessageKey = null;
window.isFetchingHistory = false;
window.activeReplyData = null;
window.currentPmRoomId = null;
window.currentPmTargetUid = null;
window.pmQueryRef = null;
window.MY_ADMIN_UID = "WsREhwYvPxaCSAjz0aqvwAU1leg2"; 
window.activeMessageId = null;

// --- NEW MUTE GLOBALS ---
window.muteTargetUid = null;
window.muteTargetName = null;
window.currentMuteTimeout = null;
window.currentMuteListenerRef = null;

// --- GLOBAL CRASH REPORTER ---
window.addEventListener('error', (event) => { 
    if (event.filename && event.filename.includes('extension')) return;
    if (event.message && event.message.includes('s is not defined')) return;
    window.showToast("Script Crash: " + event.message); 
});
window.addEventListener('unhandledrejection', (event) => { 
    const msg = event.reason?.message || event.reason || "";
    if (typeof msg === 'string' && msg.includes('MetaMask')) return;
    window.showToast("Database/Network Crash: " + msg); 
});

// --- UI HELPERS ---
window.showToast = function(message, isError = true) {
    const toast = document.getElementById('brutalist-toast');
    const toastMsg = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');
    if (toast && toastMsg) {
        toastMsg.textContent = message;
        toastIcon.textContent = isError ? '⚠️' : '✅';
        toast.classList.remove('toast-hidden');
        setTimeout(() => { toast.classList.add('toast-hidden'); }, 4000);
    } else { alert(message); }
};

window.showScreen = function(screenId) {
    document.querySelectorAll('.app-screen').forEach(screen => { screen.classList.add('hidden'); });
    const target = document.getElementById(screenId);
    if(target) target.classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('blipLoaded') === 'true') {
        document.getElementById('loading-screen')?.classList.add('hidden');
        document.getElementById('chat-wrapper')?.classList.remove('hidden');
        document.querySelectorAll('.app-screen:not(#chat-wrapper)').forEach(s => s.classList.add('hidden'));
        
        const desktopNavActions = document.getElementById('nav-actions');
        if (desktopNavActions) {
            desktopNavActions.innerHTML = `<button class="action-btn" id="open-contacts-btn">Contacts</button><button class="action-btn" id="open-settings-btn">Settings</button>`;
        }
    }
});

const savedTheme = localStorage.getItem('theme') || 'light';
document.body.classList.remove('dark-mode', 'gray-mode');
if (savedTheme !== 'light') document.body.classList.add(`${savedTheme}-mode`);

document.querySelectorAll('.theme-select-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const selectedTheme = e.target.getAttribute('data-theme');
        document.body.classList.remove('dark-mode', 'gray-mode');
        if (selectedTheme !== 'light') { document.body.classList.add(`${selectedTheme}-mode`); }
        localStorage.setItem('theme', selectedTheme);
    });
});

let blinkInterval;
let originalTitle = "Minimalist | Chat";
window.playPing = function() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const playNote = (freq, startTime, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sine'; osc.frequency.setValueAtTime(freq, startTime);
            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.08, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.start(startTime); osc.stop(startTime + duration);
        };
        const now = ctx.currentTime;
        playNote(523.25, now, 0.2); playNote(659.25, now + 0.12, 0.4); 
    } catch(e) {}
};

window.triggerNotification = function(senderName) {
    window.playPing(); clearInterval(blinkInterval); let isAlt = false;
    blinkInterval = setInterval(() => {
        document.title = isAlt ? originalTitle : `💬 New PM from ${senderName}!`;
        isAlt = !isAlt;
    }, 1000);
};

window.listenForNotifications = function() {
    if (!window.currentUser) return;
    const inboxRef = ref(db, `inbox/${window.currentUser.uid}`);
    const handleInboxUpdate = (snapshot) => {
        const data = snapshot.val();
        if (data && data.read === false) {
            if (window.currentPmTargetUid !== snapshot.key) window.triggerNotification(data.fromName);
            else set(ref(db, `inbox/${window.currentUser.uid}/${snapshot.key}/read`), true);
        }
    };
    onChildAdded(inboxRef, handleInboxUpdate);
    onChildChanged(inboxRef, handleInboxUpdate);
};

window.openSettings = function() {
    const modalObj = document.getElementById('settings-modal');
    if (!modalObj) { window.location.href = (window.Capacitor && window.Capacitor.isNativePlatform()) ? 'chat.html' : '/chat'; return; }
    
    const safeSetValue = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const safeSetText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    safeSetValue('edit-display-name', window.userProfileName);
    safeSetText('settings-display-name-title', window.userProfileName);
    safeSetValue('edit-pronouns', window.userPronouns);
    safeSetValue('edit-bio', window.userBio);
    safeSetValue('edit-theme-color', window.userThemeColor);

    const preview = document.getElementById('settings-photo-preview');
    if (preview) preview.src = window.getAvatarUrl(window.userProfileName, window.userPhotoUrl);
    
    if (window.currentUser) {
        safeSetText('settings-user-email', "Email: " + (window.currentUser.email || "No email on file"));
        safeSetText('settings-user-phone', "Phone: " + window.userPhone);
        const joinDate = new Date(window.currentUser.metadata.creationTime);
        safeSetText('settings-joined-date', "Joined: " + joinDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
    }
    
    if (typeof window.switchTab === 'function') window.switchTab('pane-profile', 'tab-btn-profile');
    
    modalObj.classList.remove('hidden'); 
    document.getElementById('modal-overlay')?.classList.remove('hidden');
};

window.switchTab = function(paneId, btnId) {
    document.getElementById('pane-profile')?.classList.add('hidden');
    document.getElementById('pane-billing')?.classList.add('hidden');
    document.getElementById('pane-app')?.classList.add('hidden');
    
    document.getElementById('tab-btn-profile')?.classList.remove('active');
    document.getElementById('tab-btn-billing')?.classList.remove('active');
    document.getElementById('tab-btn-app')?.classList.remove('active');
    
    document.getElementById(paneId)?.classList.remove('hidden');
    document.getElementById(btnId)?.classList.add('active');
};

window.updateBillingUI = function() {
    const upgradeAdvancedBtn = document.getElementById('upgrade-advanced-btn');
    const upgradeProBtn = document.getElementById('upgrade-pro-btn');
    const manageBtn = document.getElementById('manage-billing-btn');

    if (window.userTier === 'pro' || window.userTier === 'advanced') {
        if (upgradeAdvancedBtn) upgradeAdvancedBtn.style.display = 'none';
        if (upgradeProBtn) upgradeProBtn.style.display = 'none';
        if (manageBtn) manageBtn.style.display = 'block'; 
    } else {
        if (upgradeAdvancedBtn) upgradeAdvancedBtn.style.display = 'block';
        if (upgradeProBtn) upgradeProBtn.style.display = 'block';
        if (manageBtn) manageBtn.style.display = 'none';
    }
};

document.getElementById('close-settings-btn')?.addEventListener('click', () => {
    document.getElementById('settings-modal')?.classList.add('hidden');
    const profilePopup = document.getElementById('user-profile-popup');
    if (!profilePopup || profilePopup.classList.contains('hidden')) {
        document.getElementById('modal-overlay')?.classList.add('hidden');
    }
});

document.getElementById('toggle-edit-btn')?.addEventListener('click', () => {
    const formFields = document.getElementById('profile-form-fields');
    const saveBtn = document.getElementById('update-profile-btn');
    const isEditing = formFields.style.pointerEvents === 'all';
    
    formFields.style.pointerEvents = isEditing ? 'none' : 'all';
    formFields.style.opacity = isEditing ? '0.7' : '1';
    document.querySelectorAll('#profile-form-fields input, #profile-form-fields textarea').forEach(el => el.readOnly = isEditing);
    document.getElementById('edit-photo-file').disabled = isEditing;
    
    document.getElementById('toggle-edit-btn').textContent = isEditing ? 'Edit Profile' : 'Cancel';
    saveBtn.classList.toggle('hidden', isEditing);
});

document.getElementById('tab-btn-profile')?.addEventListener('click', () => window.switchTab('pane-profile', 'tab-btn-profile'));
document.getElementById('tab-btn-billing')?.addEventListener('click', () => window.switchTab('pane-billing', 'tab-btn-billing'));
document.getElementById('tab-btn-app')?.addEventListener('click', () => window.switchTab('pane-app', 'tab-btn-app'));

document.addEventListener('click', (e) => {
    if (e.target.id === 'toast-close') document.getElementById('brutalist-toast')?.classList.add('toast-hidden');
    if (e.target.id === 'open-settings-btn-mobile' || e.target.id === 'open-settings-btn') { window.openSettings(); }
    if (e.target.id === 'open-rooms-btn-mobile') { document.getElementById('desktop-room-sidebar')?.classList.add('open'); }
    if (e.target.id === 'close-mobile-rooms-btn') { document.getElementById('desktop-room-sidebar')?.classList.remove('open'); }
    if (e.target.id === 'open-contacts-btn-mobile' || e.target.id === 'open-contacts-btn') { if (window.toggleContacts) window.toggleContacts(); }
    
    if (e.target.id === 'open-updates-btn-mobile' || e.target.id === 'open-updates-btn-desktop') {
        e.preventDefault(); 
        const updatesPanel = document.getElementById('updates-panel');
        if (updatesPanel) {
            updatesPanel.classList.toggle('open');
            if (updatesPanel.classList.contains('open') && window.fetchGitHubUpdates) window.fetchGitHubUpdates(); 
        }
    }
    if (e.target.id === 'close-updates-btn') { document.getElementById('updates-panel')?.classList.remove('open'); }
});

window.enterChat = function() {
    try {
        const desktopNavActions = document.getElementById('nav-actions');

        const launchChatUI = () => {
            window.showScreen('chat-wrapper'); 
            
            if(desktopNavActions) {
                desktopNavActions.innerHTML = `<button class="action-btn" id="open-contacts-btn">Contacts</button><button class="action-btn" id="open-settings-btn">Settings</button>`;
            }

            document.getElementById('preview-profile-btn')?.addEventListener('click', () => {
                document.getElementById('user-profile-popup').classList.add('preview-layout');
                if (window.viewUserProfile) window.viewUserProfile(window.currentUser.uid); 
            });
            
            if (!window.chatInitialized) {
                if (window.initializeRooms) window.initializeRooms();
                window.listenForNotifications();
                if (window.initializePresence) window.initializePresence();
                window.chatInitialized = true;

                const pendingJoin = sessionStorage.getItem('pendingJoinUrl');
                const currentPath = window.location.pathname;
                const pathToCheck = pendingJoin || currentPath;

                if (pathToCheck.includes('/join/')) {
                    const urlCode = pathToCheck.split('/join/').pop();
                    if (urlCode && document.getElementById('room-action-modal')) {
                        document.getElementById('room-action-title').textContent = "Join Room";
                        document.getElementById('room-action-label').textContent = "INVITE LINK OR CODE";
                        document.getElementById('room-action-input').value = urlCode;
                        document.getElementById('room-action-submit').textContent = "Join";
                        document.getElementById('room-action-modal').classList.remove('hidden');
                        
                        sessionStorage.removeItem('pendingJoinUrl');
                        if (currentPath.includes('/join/')) {
                            window.history.pushState({}, '', '/chat'); 
                        }
                    }
                }
            }
        };

        if (sessionStorage.getItem('blipLoaded') === 'true') {
            launchChatUI(); 
        } else {
            window.showScreen('loading-screen');
            if(desktopNavActions) desktopNavActions.innerHTML = '';
            setTimeout(() => { sessionStorage.setItem('blipLoaded', 'true'); launchChatUI(); }, 2000);
        }
    } catch (error) { window.showToast("Error launching chat interface: " + error.message); }
};

setInterval(() => {
    const clockEl = document.getElementById('live-clock');
    if (clockEl) clockEl.textContent = `SYSTEM TIME: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}`;
}, 1000);

const openEyes = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='10' y='10' width='80' height='60' rx='25' fill='%23FFD700' stroke='%23000' stroke-width='8'/><path d='M 25 70 L 25 90 L 45 70 Z' fill='%23FFD700' stroke='%23000' stroke-width='8' stroke-linejoin='round'/><circle cx='35' cy='40' r='8' fill='%23000'/><circle cx='65' cy='40' r='8' fill='%23000'/></svg>";
const closedEyes = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='10' y='10' width='80' height='60' rx='25' fill='%23FFD700' stroke='%23000' stroke-width='8'/><path d='M 25 70 L 25 90 L 45 70 Z' fill='%23FFD700' stroke='%23000' stroke-width='8' stroke-linejoin='round'/><line x1='27' y1='40' x2='43' y2='40' stroke='%23000' stroke-width='6' stroke-linecap='round'/><line x1='57' y1='40' x2='73' y2='40' stroke='%23000' stroke-width='6' stroke-linecap='round'/></svg>";
setInterval(() => {
    const favicon = document.getElementById('dynamic-favicon');
    if (favicon) { favicon.href = closedEyes; setTimeout(() => { favicon.href = openEyes; }, 150); }
}, 4000);

window.initializePresence = function() {
    if (!window.currentUser) return;
    const myPresenceRef = ref(db, `presence/${window.currentUser.uid}`);
    onValue(ref(db, '.info/connected'), (snap) => {
        if (snap.val() === true) {
            onDisconnect(myPresenceRef).set({ state: 'offline', lastChanged: serverTimestamp() })
            .then(() => { set(myPresenceRef, { state: 'online', lastChanged: serverTimestamp() }); });
        }
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") { set(myPresenceRef, { state: 'online', lastChanged: serverTimestamp() }); } 
        else { set(myPresenceRef, { state: 'offline', lastChanged: serverTimestamp() }); }
    });
};

window.fetchGitHubUpdates = async function() {
    const list = document.getElementById('updates-list');
    if (!list) return;
    list.innerHTML = '<li style="padding: 2rem; text-align: center; font-weight: 800; animation: textPulse 1.5s infinite;">PULLING COMMITS...</li>';
    try {
        const response = await fetch('https://api.github.com/repos/Hao14/minimalist-chat/commits?per_page=15');
        if (!response.ok) throw new Error("Failed to fetch GitHub data");
        const commits = await response.json();
        list.innerHTML = ''; 
        commits.forEach(commitObj => {
            const msgLines = commitObj.commit.message.split('\n');
            const descHtml = msgLines.slice(1).join('\n').trim() ? `<div class="update-desc">${msgLines.slice(1).join('\n').trim()}</div>` : '';
            list.innerHTML += `<li class="update-card fade-in-up"><div class="update-date">${new Date(commitObj.commit.author.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div><div class="update-title">${msgLines[0]}</div>${descHtml}<div class="update-author"><img src="${commitObj.author ? commitObj.author.avatar_url : 'https://ui-avatars.com/api/?name=Dev&background=000&color=FFD700'}"> ${commitObj.commit.author.name}</div></li>`;
        });
    } catch (err) { list.innerHTML = `<li style="padding: 2rem; text-align: center; color: red; border: 4px solid red; font-weight: bold;">CONNECTION FAILED.</li>`; }
};

const emojis = ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻","💀","☠️","👽","👾","🤖","🎃","👍","👎","❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎"];
const picker = document.getElementById('emoji-picker');
if (picker) {
    emojis.forEach(emoji => {
        const span = document.createElement('span');
        span.textContent = emoji;
        span.onclick = () => { if(window.addReaction) window.addReaction(emoji); };
        picker.appendChild(span);
    });
}

let blipClickCount = 0; let blipClickTimer = null;
document.getElementById('mini-admin-blip')?.addEventListener('click', () => {
    blipClickCount++;
    if (blipClickCount === 5) {
        clearTimeout(blipClickTimer); blipClickCount = 0;
        if (window.currentUser && window.currentUser.uid === window.MY_ADMIN_UID) {
            document.getElementById('admin-dashboard-modal')?.classList.remove('hidden');
            window.showToast("Admin Dashboard Unlocked.", false);
        } else { window.showToast("Access Denied."); }
    } else {
        clearTimeout(blipClickTimer);
        blipClickTimer = setTimeout(() => { blipClickCount = 0; }, 400); 
    }
});

document.getElementById('close-admin-dashboard-btn')?.addEventListener('click', () => document.getElementById('admin-dashboard-modal')?.classList.add('hidden'));
document.getElementById('admin-wipe-btn')?.addEventListener('click', async () => {
    try { await remove(ref(db, 'presence')); window.showToast("Ghost connections wiped successfully!", false); } 
    catch(e) { window.showToast("Failed to wipe connections: " + e.message); }
});
document.getElementById('admin-ban-btn')?.addEventListener('click', () => {
    const target = document.getElementById('admin-target-id').value.trim();
    if (!target) return window.showToast("Enter a UID first!");
    set(ref(db, `users/${target}/isBanned`), true).then(() => window.showToast(`User ${target} banned!`, false)).catch((e) => window.showToast("Ban failed: " + e.message));
});
document.getElementById('admin-mute-btn')?.addEventListener('click', () => {
    const target = document.getElementById('admin-target-id').value.trim();
    if (!target) return window.showToast("Enter a UID first!");
    set(ref(db, `users/${target}/isMuted`), true).then(() => window.showToast(`User ${target} globally muted!`, false)).catch((e) => window.showToast("Mute failed: " + e.message));
});