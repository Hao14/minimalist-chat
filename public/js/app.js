// js/app.js
// 1. IMPORT FIREBASE CORE & DB
import { db, auth } from './firebase-core.js';
import { ref, set, get, onValue, onChildAdded, onChildChanged, remove, serverTimestamp, onDisconnect, push } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
// 2. IMPORT YOUR MODULES TO ACTIVATE THEM
import './auth.js';
import './rooms.js';
import './chat.js';
import './docs.js';
import './whiteboard.js';
import './roomhome.js';

// --- GLOBAL STATE (Shared across files) ---
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
window.muteTargetUid = null;
window.muteTargetName = null;
window.currentMuteTimeout = null;
window.currentMuteListenerRef = null;
window.chatInitialized = false;

// --- GLOBAL CRASH REPORTER ---
window.addEventListener('error', (event) => { 
    if (event.filename && event.filename.includes('extension')) return;
    if (event.message && event.message.includes('s is not defined')) return;
    if(window.showToast) window.showToast("Script Crash: " + event.message); 
});
window.addEventListener('unhandledrejection', (event) => { 
    const msg = event.reason?.message || event.reason || "";
    if (typeof msg === 'string' && msg.includes('MetaMask')) return;
    if(window.showToast) window.showToast("Database/Network Crash: " + msg); 
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
    
    // NEW: Automatically hide the footer when the chat interface is active!
    const footer = document.querySelector('footer');
    if (footer) {
        footer.style.display = (screenId === 'chat-wrapper') ? 'none' : 'block';
    }
};

// --- THEME ---
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

// --- NOTIFICATIONS ---
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

window.listenForPmInbox = function() {
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

// --- SETTINGS UI ---
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

const SETTINGS_TABS = ['profile', 'billing', 'app'];
window.switchTab = function(paneId, btnId) {
    SETTINGS_TABS.forEach(t => {
        document.getElementById(`pane-${t}`)?.classList.add('hidden');
        document.getElementById(`tab-btn-${t}`)?.classList.remove('active');
    });
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

// --- GLOBAL CLICK LISTENER (TOASTS & PANEL CLOSE BUTTONS) ---
// Navigation button handling is managed by the MASTER NAVIGATION CONTROLLER below.
document.addEventListener('click', (e) => {
    if (e.target.id === 'toast-close') document.getElementById('brutalist-toast')?.classList.add('toast-hidden');
    if (e.target.id === 'close-mobile-rooms-btn') document.getElementById('desktop-room-sidebar')?.classList.remove('open');
    if (e.target.id === 'close-updates-btn') document.getElementById('updates-panel')?.classList.remove('open');
});


// --- MAIN ENTRY POINT WITH TERMINAL BOOTLOADER ---
window.enterChat = function() {
    try {
        const desktopNavActions = document.getElementById('nav-actions');

        const launchChatUI = () => {
            window.showScreen('chat-wrapper'); 

            document.getElementById('preview-profile-btn')?.addEventListener('click', () => {
                document.getElementById('user-profile-popup').classList.add('preview-layout');
                if (window.viewUserProfile) window.viewUserProfile(window.currentUser.uid); 
            });
            
            if (!window.chatInitialized) {
                if (window.initializeRooms) window.initializeRooms();
                window.listenForPmInbox();
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

        // If they already booted up this session, skip the terminal.
        if (sessionStorage.getItem('blipLoaded') === 'true') {
            launchChatUI(); 
        } else {
            window.showScreen('loading-screen');
            if(desktopNavActions) desktopNavActions.innerHTML = '';
            
            // THE 9 BOOT LINES
            const bootLines = [
                "Initializing core system...",
                "Mounting secure protocols...",
                "Establishing socket connection...",
                "Verifying user identity...",
                "Loading module: auth.js...",
                "Loading module: rooms.js...",
                "Loading module: chat.js...",
                "Syncing realtime database...",
                "System ready."
            ];

            const seqContainer = document.getElementById('boot-sequence');
            if (seqContainer) {
                seqContainer.innerHTML = '';
                let currentLine = 0;

                const showNextLine = () => {
                    // Turn previous line's prefix into a checkmark and remove cursor
                    if (currentLine > 0) {
                        const prev = document.getElementById(`boot-line-${currentLine - 1}`);
                        if (prev) {
                            prev.querySelector('.boot-prefix').textContent = '✓';
                            const cursor = prev.querySelector('.boot-cursor');
                            if (cursor) cursor.remove();
                        }
                    }

                    if (currentLine < bootLines.length) {
                        // Print the new line
                        const li = document.createElement('div');
                        li.id = `boot-line-${currentLine}`;
                        li.className = 'boot-line';
                        li.innerHTML = `<span class="boot-prefix">›</span><span class="boot-text">${bootLines[currentLine]}</span><span class="boot-cursor"></span>`;
                        seqContainer.appendChild(li);

                        const isLast = (currentLine === bootLines.length - 1);
                        currentLine++;
                        
                        // Random delay between lines to look like a real machine booting
                        const delay = isLast ? 800 : Math.floor(Math.random() * 200) + 100;
                        setTimeout(showNextLine, delay);
                    } else {
                        // The boot is finished. Fade out the screen.
                        const loader = document.getElementById('loading-screen');
                        if (loader) {
                            loader.style.opacity = '0'; // CSS fade
                            setTimeout(() => {
                                sessionStorage.setItem('blipLoaded', 'true');
                                launchChatUI();
                                loader.classList.add('hidden');
                                loader.style.opacity = '1'; // Reset for next time
                            }, 500); // Wait for the fade to finish
                        }
                    }
                };
                
                // Start the terminal sequence
                setTimeout(showNextLine, 300);
            } else {
                // Failsafe
                setTimeout(() => { sessionStorage.setItem('blipLoaded', 'true'); launchChatUI(); }, 2000);
            }
        }
    } catch (error) { window.showToast("Error launching chat interface: " + error.message); }
};
// --- BACKGROUND SERVICES ---
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
        list.innerHTML = commits.map(commitObj => {
            const msgLines = commitObj.commit.message.split('\n');
            const descHtml = msgLines.slice(1).join('\n').trim() ? `<div class="update-desc">${msgLines.slice(1).join('\n').trim()}</div>` : '';
            return `<li class="update-card fade-in-up"><div class="update-date">${new Date(commitObj.commit.author.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div><div class="update-title">${msgLines[0]}</div>${descHtml}<div class="update-author"><img src="${commitObj.author ? commitObj.author.avatar_url : 'https://ui-avatars.com/api/?name=Dev&background=000&color=FFD700'}"> ${commitObj.commit.author.name}</div></li>`;
        }).join('');
    } catch (err) { list.innerHTML = `<li style="padding: 2rem; text-align: center; color: red; border: 4px solid red; font-weight: bold;">CONNECTION FAILED.</li>`; }
};

// --- EMOJI PICKER POPULATION ---
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

// --- ADMIN TOOLS ---
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
// --- NEW: MOBILE UI FIXES & SEARCH LOGIC ---
document.addEventListener('click', (e) => {
    
    // 1. Handle Mobile Back Button
    if (e.target.closest('#mobile-back-to-rooms')) {
        document.getElementById('desktop-room-sidebar')?.classList.add('open');
    }
    
    // 2. Clear room search bar automatically when switching rooms
    if (e.target.closest('.room-item')) {
        const roomSearch = document.getElementById('room-search-input');
        if (roomSearch) roomSearch.value = '';
    }
    // 4. Handle Updates Panel Tabs
    if (e.target.id === 'tab-notifications') {
        document.getElementById('tab-notifications').classList.add('active');
        document.getElementById('tab-changelog').classList.remove('active');
        document.getElementById('notifications-list').classList.remove('hidden');
        document.getElementById('updates-list').classList.add('hidden');
    }
    
    if (e.target.id === 'tab-changelog') {
        document.getElementById('tab-changelog').classList.add('active');
        document.getElementById('tab-notifications').classList.remove('active');
        document.getElementById('updates-list').classList.remove('hidden');
        document.getElementById('notifications-list').classList.add('hidden');
    }
});
// 3. Live Search Filter Logic
document.addEventListener('input', (e) => {
    // Filter Main Room Messages
    if (e.target.id === 'room-search-input') {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('#messages li').forEach(msg => {
            const text = msg.textContent.toLowerCase();
            msg.style.display = text.includes(query) ? 'flex' : 'none';
        });
    }
    
    // Filter Private Messages
    if (e.target.id === 'pm-search-input') {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('#pm-messages li').forEach(msg => {
            const text = msg.textContent.toLowerCase();
            msg.style.display = text.includes(query) ? 'list-item' : 'none';
        });
    }

    // NEW: Filter Contacts via Database Query
    if (e.target.id === 'contact-search-input') {
        if (window.renderContactsUI) window.renderContactsUI();
    }
});
// --- CLOSE MODALS ON OUTSIDE CLICK ---
document.addEventListener('click', (e) => {
    // 1. Safely Close User Profile Popup
    const profilePopup = document.getElementById('user-profile-popup');
    if (profilePopup && !profilePopup.classList.contains('hidden')) {
        // Ignore the click if it was INSIDE the popup, or on the buttons that open it
        if (!e.target.closest('#user-profile-popup') && 
            !e.target.closest('.msg-avatar') && 
            !e.target.closest('.msg-name') && 
            !e.target.closest('.avatar-wrapper') && 
            !e.target.closest('.contact-icon-btn') && 
            !e.target.closest('#preview-profile-btn')) {
            
            profilePopup.classList.add('hidden');
            
            // Only hide the background overlay if Settings isn't open behind it
            const settings = document.getElementById('settings-modal');
            if (!settings || settings.classList.contains('hidden')) {
                document.getElementById('modal-overlay')?.classList.add('hidden');
            }
        }
    }

    // 2. Safely Close all other Modals (Join, Mute, Delete, etc.)
    if (e.target.id === 'modal-overlay') {
        const modals = ['room-action-modal', 'room-settings-modal', 'leave-room-modal', 'delete-room-modal', 'mute-user-modal', 'admin-dashboard-modal'];
        modals.forEach(id => document.getElementById(id)?.classList.add('hidden'));
        
        const settings = document.getElementById('settings-modal');
        if (!settings || settings.classList.contains('hidden')) {
            document.getElementById('modal-overlay')?.classList.add('hidden');
        }
    }
});
// --- REAL-TIME NOTIFICATION ENGINE ---

window.createNotification = async function(targetUid, type, text) {
    try {
        // Prevent sending notifications to yourself
        if (!targetUid || targetUid === window.currentUser.uid) return; 
        
        const pushRef = push(ref(db, `notifications/${targetUid}`));
        await set(pushRef, { 
            type: type, 
            text: text, 
            timestamp: Date.now() 
        });
    } catch (err) { console.error("Failed to push notification", err); }
};

window.clearNotification = async function(notifId) {
    try {
        await remove(ref(db, `notifications/${window.currentUser.uid}/${notifId}`));
    } catch (err) { console.error("Failed to clear notification", err); }
};

window.listenForNotifications = function() {
    if (!window.currentUser) return;
    
    onValue(ref(db, `notifications/${window.currentUser.uid}`), (snapshot) => {
        const list = document.getElementById('notifications-list');
        const deskBell = document.getElementById('open-updates-btn-desktop');
        const mobBell = document.getElementById('open-updates-btn-mobile');
        
        if (!list) return;

        if (snapshot.exists()) {
            const notifs = Object.entries(snapshot.val()).sort((a,b) => b[1].timestamp - a[1].timestamp);
            
            if (deskBell) deskBell.style.color = '#FF3B30';
            if (mobBell) mobBell.style.color = '#FF3B30';

            list.style.padding = "0"; list.style.gap = "0";
            const today = new Date();
            const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

            list.innerHTML = notifs.map(([nId, n]) => {
                let title = "SYSTEM ALERT"; let icon = "ph-bold ph-bell";
                if (n.type === 'message') { title = "NEW MESSAGE"; icon = "ph-bold ph-chat-circle-text"; }
                else if (n.type === 'friend') { title = "FRIEND REQUEST"; icon = "ph-bold ph-user-plus"; }
                else if (n.type === 'room') { title = "ROOM ACTIVITY"; icon = "ph-bold ph-users-three"; }

                const d = new Date(n.timestamp);
                let timeStr = d.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'});
                if (d.toDateString() === yesterday.toDateString()) timeStr = "Yesterday";
                else if (d.toDateString() !== today.toDateString()) timeStr = d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});

                return `
                    <li class="modern-notif" style="padding: 1.2rem 1.5rem; border-bottom: 2px solid var(--text-color); display: flex; align-items: center; gap: 15px;">
                        <i class="${icon}" style="font-size: 1.8rem; color: var(--text-color); flex-shrink: 0;"></i>
                        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column;">
                            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; gap: 10px;">
                                <span style="font-size: 0.9rem; font-weight: 800; color: var(--text-color); letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</span>
                                <span style="font-size: 0.75rem; font-weight: 800; color: #888; flex-shrink: 0;">${timeStr}</span>
                            </div>
                            <span style="font-size: 0.95rem; font-weight: 600; color: var(--text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n.text}</span>
                        </div>
                        <span onclick="clearNotification('${nId}')" class="notif-close-btn" style="font-size: 1.5rem; cursor: pointer; color: var(--text-color); display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 35px; height: 35px; transition: color 0.2s;">
                            <i class="ph-bold ph-x"></i>
                        </span>
                    </li>
                `;
            }).join('');
        } else {
            if (deskBell) deskBell.style.color = 'var(--text-color)';
            if (mobBell) mobBell.style.color = 'var(--text-color)';
            list.style.padding = "1.5rem"; 
            list.innerHTML = `<div style="text-align: center; color: #888; margin-top: 2rem; font-weight: bold;"><i class="ph-bold ph-bell-slash" style="font-size: 3rem; margin-bottom: 1rem; display: block; color: var(--text-color);"></i>You're all caught up!</div>`;
        }
    });
};
/* --- MASTER NAVIGATION CONTROLLER (FIX DOUBLE FIRE) --- */
document.addEventListener('click', (e) => {
    const isRooms = e.target.closest('#open-rooms-btn-mobile');
    const isContacts = e.target.closest('#open-contacts-btn') || e.target.closest('#open-contacts-btn-mobile');
    const isUpdates = e.target.closest('#open-updates-btn-desktop') || e.target.closest('#open-updates-btn-mobile');
    const isSettings = e.target.closest('#open-settings-btn') || e.target.closest('#open-settings-btn-mobile');

    // If the user clicked ANY navigation button...
    if (isRooms || isContacts || isUpdates || isSettings) {
        e.stopImmediatePropagation(); // Instantly kill the old double-firing listeners!
        e.preventDefault();

        const roomsSidebar = document.getElementById('desktop-room-sidebar');
        const contactsPanel = document.getElementById('contacts-panel');
        const updatesPanel = document.getElementById('updates-panel');
        const settingsModal = document.getElementById('settings-modal');

        // 1. Remember what was currently open
        const wasRoomsOpen = roomsSidebar?.classList.contains('open');
        const wasContactsOpen = contactsPanel?.classList.contains('open');
        const wasUpdatesOpen = updatesPanel?.classList.contains('open');
        const wasSettingsOpen = settingsModal && !settingsModal.classList.contains('hidden');

        // 2. Force close all panels for a clean slate
        if (roomsSidebar) roomsSidebar.classList.remove('open');
        if (contactsPanel) contactsPanel.classList.remove('open');
        if (updatesPanel) updatesPanel.classList.remove('open');
        if (settingsModal) {
            settingsModal.classList.add('hidden');
            document.getElementById('modal-overlay')?.classList.add('hidden');
        }

        // 3. Open ONLY the requested panel (acts as an exclusive toggle)
        if (isRooms && !wasRoomsOpen && roomsSidebar) {
            roomsSidebar.classList.add('open');
        }

        if (isContacts && !wasContactsOpen) {
            // Since we explicitly closed it above, toggleContacts will perfectly open it!
            if (window.toggleContacts) window.toggleContacts();
        }

        if (isUpdates && !wasUpdatesOpen && updatesPanel) {
            updatesPanel.classList.add('open');
            if (window.fetchGitHubUpdates) window.fetchGitHubUpdates();
        }

        if (isSettings && !wasSettingsOpen) {
            if (window.openSettings) window.openSettings();
        }
    }
}, true); // The "true" enables the Capture Phase, intercepting the click early!
// --- TOGGLE HEADER SEARCH BAR ---
document.addEventListener('click', (e) => {
    if (e.target.closest('#toggle-room-search-btn')) {
        const searchInput = document.getElementById('room-search-input');
        if (searchInput) {
            searchInput.classList.toggle('open');
            if (searchInput.classList.contains('open')) {
                searchInput.focus(); // Auto-focus so you can type immediately
            } else {
                // Clear the text and trigger an update to reset the chat feed
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }
});
// --- ROOM DASHBOARD TAB SWITCHING ---
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('room-tab')) {
        const targetView = e.target.getAttribute('data-target');
        
        // 1. Update Tab Visuals
        document.querySelectorAll('.room-tab').forEach(tab => tab.classList.remove('active'));
        e.target.classList.add('active');
        
        // 2. Hide all views, show the target view
        document.querySelectorAll('.room-view').forEach(view => view.classList.add('hidden'));
        document.getElementById(`room-view-${targetView}`)?.classList.remove('hidden');
        
        // 3. Auto-scroll chat to bottom if returning to the Chat tab
        if (targetView === 'chat') {
            const msgs = document.getElementById('messages');
            if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }

        // 4. Lazy-load room features when their tab is opened
        if (targetView === 'home' && window.loadRoomHome) window.loadRoomHome();
        if (targetView === 'docs' && window.loadRoomDocs) window.loadRoomDocs();
        if (targetView === 'whiteboard' && window.loadRoomWhiteboard) window.loadRoomWhiteboard();
    }
});

// --- ROOM CHANGE HOOK: land on the Home tab and refresh its data ---
window.onRoomChanged = function() {
    // Reset the sub-nav so every room opens on its Home page, not straight into chat.
    document.querySelectorAll('.room-tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-target') === 'home');
    });
    document.querySelectorAll('.room-view').forEach(view => view.classList.add('hidden'));
    document.getElementById('room-view-home')?.classList.remove('hidden');

    if (window.loadRoomHome) window.loadRoomHome();
};