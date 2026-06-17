import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signInWithPhoneNumber, onAuthStateChanged, signOut, deleteUser, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, set, get, push, onValue, onChildAdded, onChildChanged, off, remove, serverTimestamp, query, limitToLast, orderByKey, endBefore, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getStorage, ref as sRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

// --- GLOBAL CRASH REPORTER ---
window.addEventListener('error', (event) => { 
    if (event.filename && event.filename.includes('extension')) return;
    if (event.message && event.message.includes('s is not defined')) return;
    showToast("Script Crash: " + event.message); 
});

window.addEventListener('unhandledrejection', (event) => { 
    const msg = event.reason?.message || event.reason || "";
    if (typeof msg === 'string' && msg.includes('MetaMask')) return;
    showToast("Database/Network Crash: " + msg); 
});

const firebaseConfig = {
    apiKey: "AIzaSyDAnwh1kYnomfGIMM71J9tCY3tuOV0ejnE",
    authDomain: "chat-app-356c1.firebaseapp.com",
    databaseURL: "https://chat-app-356c1-default-rtdb.firebaseio.com",
    projectId: "chat-app-356c1",
    storageBucket: "chat-app-356c1.firebasestorage.app",
    messagingSenderId: "327658376387",
    appId: "1:327658376387:web:4a47e25dc8156afb7de676",
    measurementId: "G-M3DPZWT9LD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);
const functions = getFunctions(app);

let currentUser = null;
let userProfileName = "Anonymous";
let userPhotoUrl = "";
let userPronouns = "";
let userBio = "";
let userThemeColor = "#FFD700";
let userShortId = "";
let userTier = "free"; 
let userPhone = "No phone on file"; 
let currentPmRoomId = null;
let currentPmTargetUid = null;
let pmQueryRef = null;

// --- MULTI-ROOM STATE ---
let activeRoomId = 'global';
let activeRoomShortId = 'GLOBAL';
let currentRoomListener = null;

let typingTimeout = null;
let isTyping = false;
let activeReplyData = null;
let chatInitialized = false;
let oldestMessageKey = null;
let isFetchingHistory = false;

// --- CUSTOM UI NOTIFICATIONS ---
window.showToast = function(message, isError = true) {
    const toast = document.getElementById('brutalist-toast');
    const toastMsg = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');
    
    if (toast && toastMsg) {
        toastMsg.textContent = message;
        toastIcon.textContent = isError ? '⚠️' : '✅';
        toast.classList.remove('toast-hidden');
        setTimeout(() => { toast.classList.add('toast-hidden'); }, 4000);
    } else {
        alert(message);
    }
};

document.addEventListener('click', (e) => {
    if (e.target.id === 'toast-close') {
        document.getElementById('brutalist-toast').classList.add('toast-hidden');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('blipLoaded') === 'true') {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) loadingScreen.classList.add('hidden');
        
        const chatWrapper = document.getElementById('chat-wrapper');
        if (chatWrapper) {
            document.querySelectorAll('.app-screen').forEach(s => s.classList.add('hidden'));
            chatWrapper.classList.remove('hidden');
        }

        const desktopNavActions = document.getElementById('nav-actions');
        if (desktopNavActions) {
            desktopNavActions.innerHTML = `<button class="action-btn" id="open-contacts-btn">Contacts</button><button class="action-btn" id="open-settings-btn">Settings</button>`;
        }
    }
});

function showScreen(screenId) {
    document.querySelectorAll('.app-screen').forEach(screen => { screen.classList.add('hidden'); });
    const target = document.getElementById(screenId);
    if(target) target.classList.remove('hidden');
}

const savedTheme = localStorage.getItem('theme') || 'light';
document.body.classList.remove('dark-mode', 'gray-mode');
if (savedTheme !== 'light') document.body.classList.add(`${savedTheme}-mode`);

const themeButtons = document.querySelectorAll('.theme-select-btn');
themeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const selectedTheme = e.target.getAttribute('data-theme');
        document.body.classList.remove('dark-mode', 'gray-mode');
        if (selectedTheme !== 'light') { document.body.classList.add(`${selectedTheme}-mode`); }
        localStorage.setItem('theme', selectedTheme);
    });
});

const mobileBtn = document.getElementById('mobile-menu-btn');
if (mobileBtn) {
    mobileBtn.addEventListener('click', () => {
        const menu = document.getElementById('mobile-nav-links');
        if(menu) menu.classList.toggle('hidden');
    });
}

function getAvatarUrl(name, url) {
    if (url && url.trim() !== '') return url;
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=000&color=FFD700&bold=true`;
}

function generateShortId() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

let blinkInterval;
let originalTitle = "Minimalist | Chat";
function playPing() {
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
}

function triggerNotification(senderName) {
    playPing(); clearInterval(blinkInterval); let isAlt = false;
    blinkInterval = setInterval(() => {
        document.title = isAlt ? originalTitle : `💬 New PM from ${senderName}!`;
        isAlt = !isAlt;
    }, 1000);
}

function listenForNotifications() {
    const inboxRef = ref(db, `inbox/${currentUser.uid}`);
    const handleInboxUpdate = (snapshot) => {
        const data = snapshot.val();
        if (data && data.read === false) {
            if (currentPmTargetUid !== snapshot.key) triggerNotification(data.fromName);
            else set(ref(db, `inbox/${currentUser.uid}/${snapshot.key}/read`), true);
        }
    };
    onChildAdded(inboxRef, handleInboxUpdate);
    onChildChanged(inboxRef, handleInboxUpdate);
}

// --- SMART ROUTER & DEEP LINK PRESERVER ---
onAuthStateChanged(auth, async (user) => {
    const currentPage = window.location.pathname;
    const isLoginPage = currentPage.includes('login');
    const isChatPage = currentPage.includes('chat') || currentPage.includes('join');

    const chatUrl = (window.Capacitor && window.Capacitor.isNativePlatform()) ? 'chat.html' : '/chat';
    const loginUrl = (window.Capacitor && window.Capacitor.isNativePlatform()) ? 'login.html' : '/login';

    if (user) {
        document.querySelectorAll('.auth-only').forEach(el => el.classList.remove('hidden'));
        document.querySelectorAll('.guest-only').forEach(el => el.classList.add('hidden'));

        if (isLoginPage) { window.location.replace(chatUrl); return; }
        if (isChatPage) {
            currentUser = user;
            checkUserProfile(user.uid);
        }
    } else {
        document.querySelectorAll('.auth-only').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.guest-only').forEach(el => el.classList.remove('hidden'));

        if (isChatPage) { 
            if (currentPage.includes('join')) sessionStorage.setItem('pendingJoinUrl', currentPage);
            window.location.replace(loginUrl); 
        }
    }
});

async function checkUserProfile(uid) {
    try {
        const snapshot = await get(ref(db, 'users/' + uid));
        if (snapshot.exists()) {
            const data = snapshot.val();
            userProfileName = data.displayName || "Anonymous";
            userPhotoUrl = data.photoUrl || "";
            userPronouns = data.pronouns || "";
            userBio = data.bio || "";
            userThemeColor = data.themeColor || "#FFD700";
            userTier = data.tier || "free"; 
            userPhone = data.phoneNumber || "No phone on file"; 
            updateBillingUI();
            
            if (!data.shortId) {
                userShortId = generateShortId();
                await set(ref(db, 'users/' + uid + '/shortId'), userShortId);
            } else { userShortId = data.shortId; }

            if (!data.createdAt && auth.currentUser) {
                await set(ref(db, 'users/' + uid + '/createdAt'), auth.currentUser.metadata.creationTime);
            }

            enterChat();
        } else { 
            showScreen('profile-setup-container'); 
        }
    } catch (error) {
        showToast("Database Error loading profile: " + error.message);
    }
}

const saveProfileBtn = document.getElementById('save-new-profile-btn');
if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
        try {
            const name = document.getElementById('new-display-name').value.trim();
            const rawPhoto = document.getElementById('new-photo-url').value.trim();
            if (name) {
                const finalPhotoUrl = getAvatarUrl(name, rawPhoto);
                userShortId = generateShortId();
                
                await set(ref(db, 'users/' + currentUser.uid), { 
                    displayName: name, photoUrl: finalPhotoUrl,
                    shortId: userShortId, themeColor: "#FFD700",
                    bio: "I'm new here!", pronouns: ""
                });
                
                userProfileName = name; userPhotoUrl = finalPhotoUrl;
                userThemeColor = "#FFD700"; userBio = "I'm new here!"; userPronouns = "";
                enterChat();
            }
        } catch (error) { showToast("Error saving profile: " + error.message); }
    });
}

window.openSettings = function() {
    const modalObj = document.getElementById('settings-modal');
    if (!modalObj) { window.location.href = (window.Capacitor && window.Capacitor.isNativePlatform()) ? 'chat.html' : '/chat'; return; }
    
    const safeSetValue = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const safeSetText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    safeSetValue('edit-display-name', userProfileName);
    safeSetText('settings-display-name-title', userProfileName);
    safeSetValue('edit-pronouns', userPronouns);
    safeSetValue('edit-bio', userBio);
    safeSetValue('edit-theme-color', userThemeColor);

    const preview = document.getElementById('settings-photo-preview');
    if (preview) preview.src = getAvatarUrl(userProfileName, userPhotoUrl);
    
    if (auth.currentUser) {
        safeSetText('settings-user-email', "Email: " + (auth.currentUser.email || "No email on file"));
        safeSetText('settings-user-phone', "Phone: " + userPhone);
        const joinDate = new Date(auth.currentUser.metadata.creationTime);
        const dateOptions = { month: 'long', day: 'numeric', year: 'numeric' };
        safeSetText('settings-joined-date', "Joined: " + joinDate.toLocaleDateString('en-US', dateOptions));
    }
    
    if (typeof switchTab === 'function') switchTab('pane-profile', 'tab-btn-profile');
    
    const overlayObj = document.getElementById('modal-overlay');
    modalObj.classList.remove('hidden'); 
    if (overlayObj) overlayObj.classList.remove('hidden');
};

window.switchTab = function(paneId, btnId) {
    document.getElementById('pane-profile').classList.add('hidden');
    document.getElementById('pane-billing').classList.add('hidden');
    document.getElementById('pane-app').classList.add('hidden');
    
    document.getElementById('tab-btn-profile').classList.remove('active');
    document.getElementById('tab-btn-billing').classList.remove('active');
    document.getElementById('tab-btn-app').classList.remove('active');
    
    document.getElementById(paneId).classList.remove('hidden');
    document.getElementById(btnId).classList.add('active');
}

const closeSettingsBtn = document.getElementById('close-settings-btn');
if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('hidden');
        const profilePopup = document.getElementById('user-profile-popup');
        if (!profilePopup || profilePopup.classList.contains('hidden')) {
            document.getElementById('modal-overlay').classList.add('hidden');
        }
    });
}

const tabProfileBtn = document.getElementById('tab-btn-profile');
if (tabProfileBtn) {
    tabProfileBtn.addEventListener('click', () => switchTab('pane-profile', 'tab-btn-profile'));
    document.getElementById('tab-btn-billing').addEventListener('click', () => switchTab('pane-billing', 'tab-btn-billing'));
    document.getElementById('tab-btn-app').addEventListener('click', () => switchTab('pane-app', 'tab-btn-app'));
 
    const logoutBtn = document.getElementById('logout-btn');
    if(logoutBtn) logoutBtn.addEventListener('click', () => { 
        document.getElementById('settings-modal').classList.add('hidden'); 
        document.getElementById('modal-overlay').classList.add('hidden'); 
        sessionStorage.removeItem('blipLoaded');
        signOut(auth); 
    });
}

const toggleEditBtn = document.getElementById('toggle-edit-btn');
if (toggleEditBtn) {
    toggleEditBtn.addEventListener('click', () => {
        const formFields = document.getElementById('profile-form-fields');
        const saveBtn = document.getElementById('update-profile-btn');
        const isEditing = formFields.style.pointerEvents === 'all';
        
        formFields.style.pointerEvents = isEditing ? 'none' : 'all';
        formFields.style.opacity = isEditing ? '0.7' : '1';
        document.querySelectorAll('#profile-form-fields input, #profile-form-fields textarea').forEach(el => el.readOnly = isEditing);
        document.getElementById('edit-photo-file').disabled = isEditing;
        
        toggleEditBtn.textContent = isEditing ? 'Edit Profile' : 'Cancel';
        saveBtn.classList.toggle('hidden', isEditing);
    });
}

const updateProfileBtn = document.getElementById('update-profile-btn');
if (updateProfileBtn) {
    updateProfileBtn.addEventListener('click', async () => {
        try {
            const fileInput = document.getElementById('edit-photo-file');
            let finalPhotoUrl = userPhotoUrl;

            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                const fileRef = sRef(storage, `avatars/${currentUser.uid}`);
                await uploadBytesResumable(fileRef, file);
                finalPhotoUrl = await getDownloadURL(fileRef);
            }

            const newName = document.getElementById('edit-display-name').value.trim();
            await set(ref(db, 'users/' + currentUser.uid), { 
                displayName: newName,
                photoUrl: finalPhotoUrl,
                pronouns: document.getElementById('edit-pronouns').value.trim(),
                bio: document.getElementById('edit-bio').value.trim(),
                themeColor: document.getElementById('edit-theme-color').value,
                shortId: userShortId 
            });
            
            userProfileName = newName;
            userPhotoUrl = finalPhotoUrl;
            userPronouns = document.getElementById('edit-pronouns').value.trim();
            userBio = document.getElementById('edit-bio').value.trim();
            userThemeColor = document.getElementById('edit-theme-color').value;

            document.getElementById('toggle-edit-btn').click(); 
            showToast("Profile Updated!");
        } catch (error) { showToast("Error updating profile: " + error.message); }
    });
}

const deleteAccountBtn = document.getElementById('delete-account-btn');
if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async () => {
        const confirmationText = prompt("WARNING: Account deletion is permanent.\nPlease type exactly:\nI WANT DELETION\n\nto confirm.");
        if (confirmationText === "I WANT DELETION") {
            try {
                await remove(ref(db, 'users/' + currentUser.uid));
                await deleteUser(currentUser);
                showToast("Account deleted successfully.");
                window.location.reload();
            } catch (error) {
                if (error.code === 'auth/requires-recent-login') {
                    showToast("For your security, Firebase requires you to log out and log back in right before deleting your account.");
                } else { showToast("Failed to delete account: " + error.message); }
            }
        } else if (confirmationText !== null) { showToast("Account deletion cancelled: You did not type 'I WANT DELETION' correctly."); }
    });
}

document.addEventListener('click', (e) => {
    if (e.target.id === 'open-settings-btn-mobile') { openSettings(); }

    if (e.target.id === 'open-rooms-btn-mobile') {
        const sidebar = document.getElementById('desktop-room-sidebar');
        if (sidebar) sidebar.classList.add('open');
    }
    if (e.target.id === 'close-mobile-rooms-btn') {
        const sidebar = document.getElementById('desktop-room-sidebar');
        if (sidebar) sidebar.classList.remove('open');
    }

    if (e.target.id === 'open-updates-btn-mobile' || e.target.id === 'open-updates-btn-desktop') {
        e.preventDefault(); 
        const updatesPanel = document.getElementById('updates-panel');
        if (updatesPanel) {
            updatesPanel.classList.toggle('open');
            if (updatesPanel.classList.contains('open')) fetchGitHubUpdates(); 
        }
    }
    
    if (e.target.id === 'close-updates-btn') { document.getElementById('updates-panel').classList.remove('open'); }
    
    if (e.target.id === 'open-contacts-btn-mobile') {
        const contactsPanel = document.getElementById('contacts-panel');
        if (!contactsPanel) {
            window.location.href = (window.Capacitor && window.Capacitor.isNativePlatform()) ? 'chat.html' : '/chat'; 
        } else {
            if (typeof toggleContacts === 'function') toggleContacts();
        }
    }
});

// --- NEW: CUSTOM CONTEXT MENU LOGIC ---
let contextTargetUid = null;
let contextTargetName = null;
const contextMenu = document.getElementById('custom-context-menu');

window.showContextMenu = async function(x, y, uid, name) {
    if (uid === currentUser.uid) return; // Disables right-clicking on your own messages
    
    contextTargetUid = uid;
    contextTargetName = name;
    
    // Fetch live friend status
    const friendSnap = await get(ref(db, `friends/${currentUser.uid}/${uid}`));
    const ctxFriendBtn = document.getElementById('ctx-friend-btn');
    if (ctxFriendBtn) {
        if (friendSnap.exists() && friendSnap.val() === 'accepted') {
            ctxFriendBtn.textContent = 'Remove Friend';
            ctxFriendBtn.classList.add('danger-btn');
        } else {
            ctxFriendBtn.textContent = 'Add Friend';
            ctxFriendBtn.classList.remove('danger-btn');
        }
    }
    
    // Fetch local mute status
    const isMuted = localStorage.getItem(`muted_${uid}`) === 'true';
    const ctxMuteBtn = document.getElementById('ctx-mute-btn');
    if (ctxMuteBtn) {
        ctxMuteBtn.textContent = isMuted ? 'Unmute User' : 'Mute User';
    }

    if (contextMenu) {
        let posX = x; let posY = y;
        // Basic overflow protection for small screens
        if (posX + 160 > window.innerWidth) posX -= 160;
        if (posY + 160 > window.innerHeight) posY -= 160;
        
        contextMenu.style.left = `${posX}px`;
        contextMenu.style.top = `${posY}px`;
        contextMenu.classList.remove('hidden');
    }
};

// Global click to close the right-click menu
document.addEventListener('click', () => {
    if (contextMenu && !contextMenu.classList.contains('hidden')) {
        contextMenu.classList.add('hidden');
    }
});

document.getElementById('ctx-copy-btn')?.addEventListener('click', () => {
    if (contextTargetUid) {
        navigator.clipboard.writeText(contextTargetUid);
        showToast("User ID copied!", false);
    }
});

document.getElementById('ctx-friend-btn')?.addEventListener('click', async () => {
    if (!contextTargetUid) return;
    const btn = document.getElementById('ctx-friend-btn');
    if (btn.textContent === 'Remove Friend') {
        await removeFriend(contextTargetUid);
        showToast(`${contextTargetName} removed from friends.`, false);
    } else {
        await sendRequest(contextTargetUid);
        showToast(`Friend request sent to ${contextTargetName}!`, false);
    }
});

document.getElementById('ctx-mute-btn')?.addEventListener('click', () => {
    if (!contextTargetUid) return;
    const isMuted = localStorage.getItem(`muted_${contextTargetUid}`) === 'true';
    if (isMuted) {
        localStorage.removeItem(`muted_${contextTargetUid}`);
        showToast(`Unmuted ${contextTargetName}.`, false);
    } else {
        localStorage.setItem(`muted_${contextTargetUid}`, 'true');
        showToast(`${contextTargetName} has been muted.`, false);
    }
    // Instantly refreshes the chat to hide/show their messages
    switchRoom(activeRoomId, document.getElementById('active-room-name-display').textContent, activeRoomShortId);
});

const emojis = ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻","💀","☠️","👽","👾","🤖","🎃","👍","👎","❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎"];

function populateEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    if (!picker) return; 
    picker.innerHTML = ''; 
    emojis.forEach(emoji => {
        const span = document.createElement('span');
        span.textContent = emoji;
        span.onclick = () => addReaction(emoji);
        picker.appendChild(span);
    });
}
populateEmojiPicker();

window.updateBillingUI = function() {
    const upgradeAdvancedBtn = document.getElementById('upgrade-advanced-btn');
    const upgradeProBtn = document.getElementById('upgrade-pro-btn');
    const manageBtn = document.getElementById('manage-billing-btn');

    if (userTier === 'pro' || userTier === 'advanced') {
        if (upgradeAdvancedBtn) upgradeAdvancedBtn.style.display = 'none';
        if (upgradeProBtn) upgradeProBtn.style.display = 'none';
        if (manageBtn) manageBtn.style.display = 'block'; 
    } else {
        if (upgradeAdvancedBtn) upgradeAdvancedBtn.style.display = 'block';
        if (upgradeProBtn) upgradeProBtn.style.display = 'block';
        if (manageBtn) manageBtn.style.display = 'none';
    }
}

window.enterChat = function() {
    try {
        const desktopNavActions = document.getElementById('nav-actions');

        const launchChatUI = () => {
            showScreen('chat-wrapper'); 
            
            if(desktopNavActions) {
                desktopNavActions.innerHTML = `<button class="action-btn" id="open-contacts-btn">Contacts</button><button class="action-btn" id="open-settings-btn">Settings</button>`;
                
                const settingsBtn = document.getElementById('open-settings-btn');
                if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
                
                const contactsBtn = document.getElementById('open-contacts-btn');
                if (contactsBtn) contactsBtn.addEventListener('click', toggleContacts);
            }

            const previewBtn = document.getElementById('preview-profile-btn');
            if (previewBtn) {
                previewBtn.addEventListener('click', () => {
                    document.getElementById('user-profile-popup').classList.add('preview-layout');
                    viewUserProfile(currentUser.uid); 
                });
            }
            
            if (!chatInitialized) {
                initializeRooms();
                listenForNotifications();
                initializePresence();
                chatInitialized = true;

                const pendingJoin = sessionStorage.getItem('pendingJoinUrl');
                const currentPath = window.location.pathname;
                const pathToCheck = pendingJoin || currentPath;

                if (pathToCheck.includes('/join/')) {
                    const urlCode = pathToCheck.split('/join/').pop();
                    if (urlCode) {
                        currentRoomActionMode = 'join';
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
            showScreen('loading-screen');
            if(desktopNavActions) desktopNavActions.innerHTML = '';
            setTimeout(() => { sessionStorage.setItem('blipLoaded', 'true'); launchChatUI(); }, 2000);
        }
    } catch (error) { showToast("Error launching chat interface: " + error.message); }
}

// --- MULTI-ROOM INITIALIZATION ENGINE ---
function initializeRooms() {
    const roomsMetaRef = ref(db, 'rooms_meta');
    onValue(roomsMetaRef, (snapshot) => {
        const roomListEl = document.getElementById('room-list');
        if(!roomListEl) return;
        roomListEl.innerHTML = '';
        
        let rooms = [];
        snapshot.forEach(child => {
            const data = child.val();
            if (!data.shortId) {
                data.shortId = generateShortId();
                set(ref(db, `rooms_meta/${child.key}/shortId`), data.shortId);
            }
            
            if ((data.members && data.members[currentUser.uid]) || data.creatorId === currentUser.uid) {
                rooms.push({ id: child.key, ...data });
            }
        });
        
        if (!rooms.find(r => r.id === 'global')) {
            rooms.unshift({ id: 'global', name: 'Global Chat', lastMessage: 'Welcome to the server.', shortId: 'GLOBAL' });
        }

        rooms.forEach(room => {
            const li = document.createElement('li');
            li.className = `room-item ${room.id === activeRoomId ? 'active' : ''}`;
            li.innerHTML = `
                <span class="room-name">${room.name}</span>
                <span class="room-preview">${room.lastMessage || 'No messages yet...'}</span>
            `;
            li.onclick = () => switchRoom(room.id, room.name, room.shortId);
            roomListEl.appendChild(li);
        });
    });

    switchRoom('global', 'Global Chat', 'GLOBAL');
}

window.switchRoom = function(roomId, roomName, shortId = '') {
    activeRoomId = roomId;
    activeRoomShortId = shortId || roomId;
    
    document.getElementById('active-room-name-display').textContent = roomName;
    document.getElementById('message-input').placeholder = `Message ${roomName}...`;
    document.getElementById('messages').innerHTML = ''; 
    
    const roomTag = document.getElementById('active-room-tag');
    const inviteBtn = document.getElementById('room-drop-invite');
    
    if (roomId === 'global') {
        if(roomTag) { roomTag.textContent = 'PUBLIC'; roomTag.className = 'tier-badge advanced'; }
        if(inviteBtn) inviteBtn.style.display = 'none'; 
    } else {
        if(roomTag) { roomTag.textContent = 'PRIVATE'; roomTag.className = 'tier-badge pro'; }
        if(inviteBtn) inviteBtn.style.display = 'block'; 
    }

    oldestMessageKey = null;
    isFetchingHistory = false;
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    
    const sidebar = document.getElementById('desktop-room-sidebar');
    if (sidebar) sidebar.classList.remove('open');

    if (currentRoomListener) off(currentRoomListener);
    
    const msgsRef = roomId === 'global' ? ref(db, 'messages') : ref(db, `rooms_data/${roomId}/messages`);
    currentRoomListener = query(msgsRef, limitToLast(30));
    
    onChildAdded(currentRoomListener, (snapshot) => { 
        if(!oldestMessageKey) oldestMessageKey = snapshot.key; 
        displayMessage(snapshot.key, snapshot.val(), false); 
    });
    onChildChanged(currentRoomListener, (snapshot) => { updateMessageReactions(snapshot.key, snapshot.val()); });
    
    bindChatScrolling(msgsRef);
};

// --- CREATE & JOIN ROOM LOGIC ---
const roomActionModal = document.getElementById('room-action-modal');
const roomActionTitle = document.getElementById('room-action-title');
const roomActionLabel = document.getElementById('room-action-label');
const roomActionInput = document.getElementById('room-action-input');
const roomActionSubmit = document.getElementById('room-action-submit');
const closeRoomActionBtn = document.getElementById('close-room-action-btn');

let currentRoomActionMode = 'join'; 

const createBtn = document.getElementById('create-room-btn');
if(createBtn) {
    createBtn.onclick = () => {
        currentRoomActionMode = 'create';
        roomActionTitle.textContent = "Create New Room";
        roomActionLabel.textContent = "ROOM NAME";
        roomActionInput.placeholder = "Enter a name...";
        roomActionInput.value = "";
        roomActionSubmit.textContent = "Create";
        if(roomActionModal) roomActionModal.classList.remove('hidden');
    };
}

const joinBtn = document.getElementById('join-room-btn');
if (joinBtn) {
    joinBtn.onclick = () => {
        currentRoomActionMode = 'join';
        roomActionTitle.textContent = "Join Room";
        roomActionLabel.textContent = "INVITE LINK OR CODE";
        roomActionInput.placeholder = "Paste full link or code...";
        roomActionInput.value = "";
        roomActionSubmit.textContent = "Join";
        if(roomActionModal) roomActionModal.classList.remove('hidden');
    };
}

if (closeRoomActionBtn) {
    closeRoomActionBtn.onclick = () => {
        if(roomActionModal) roomActionModal.classList.add('hidden');
    };
}

if (roomActionSubmit) {
    roomActionSubmit.onclick = async () => {
        let rawVal = roomActionInput.value.trim().toUpperCase(); 
        if (!rawVal) return showToast("Input cannot be empty!");

        let val = rawVal;
        if (val.includes('/JOIN/')) {
            val = val.split('/JOIN/').pop().replace(/[^A-Z0-9-]/g, ''); 
        } else if (val.startsWith('#')) {
            val = val.substring(1);
        }

        if (currentRoomActionMode === 'create') {
            const newRoomRef = push(ref(db, 'rooms_meta'));
            const newShortId = generateShortId();
            
            await set(newRoomRef, { 
                name: val, 
                lastMessage: 'Room created.', 
                shortId: newShortId, 
                creatorId: currentUser.uid, 
                createdAt: serverTimestamp(),
                members: { [currentUser.uid]: userProfileName },
                logs: { [Date.now()]: { text: `${userProfileName} created the room.`, timestamp: Date.now() } }
            });
            
            if(roomActionModal) roomActionModal.classList.add('hidden');
            switchRoom(newRoomRef.key, val, newShortId);
            showToast(`Room created! Invite: #${newShortId}-${userShortId}`, false);
        } else {
            try {
                let targetShortId = val;
                let inviterId = null;
                if (val.includes('-')) {
                    const parts = val.split('-');
                    targetShortId = parts[0];
                    inviterId = parts[1];
                }

                const snapshot = await get(ref(db, 'rooms_meta'));
                let foundRoom = null;
                snapshot.forEach(child => {
                    const data = child.val();
                    if (data.shortId === targetShortId || child.key === targetShortId) { 
                        foundRoom = { key: child.key, ...data };
                    }
                });

                if (foundRoom) {
                    await set(ref(db, `rooms_meta/${foundRoom.key}/members/${currentUser.uid}`), userProfileName);
                    
                    let logText = `${userProfileName} joined the room.`;
                    if (inviterId) logText = `${userProfileName} joined via invite link from user #${inviterId}.`;
                    await set(ref(db, `rooms_meta/${foundRoom.key}/logs/${Date.now()}`), { text: logText, timestamp: Date.now() });

                    if(roomActionModal) roomActionModal.classList.add('hidden');
                    switchRoom(foundRoom.key, foundRoom.name, foundRoom.shortId);
                    showToast("Joined room successfully!", false);
                } else {
                    showToast("Room ID not found. Check for typos!");
                }
            } catch (e) {
                showToast("Error joining room: " + e.message);
            }
        }
    };
}

// --- ROOM SETTINGS DROPDOWN & DASHBOARD LOGIC ---
const roomNameWrapper = document.getElementById('room-name-wrapper');
const roomDropdown = document.getElementById('room-settings-dropdown');
const roomSettingsModal = document.getElementById('room-settings-modal');

if (roomNameWrapper && roomDropdown) {
    roomNameWrapper.addEventListener('click', (e) => {
        e.stopPropagation(); 
        roomDropdown.classList.toggle('hidden');
    });
}

const dropInvite = document.getElementById('room-drop-invite');
if (dropInvite) {
    dropInvite.addEventListener('click', () => {
        if (activeRoomShortId === 'GLOBAL') return;
        
        const uniqueInvite = `${activeRoomShortId}-${userShortId}`;
        const inviteLink = `${window.location.origin}/join/${uniqueInvite}`;
        
        navigator.clipboard.writeText(inviteLink);
        showToast(`Invite Link copied!`, false);
    });
}

document.getElementById('room-drop-settings')?.addEventListener('click', async () => {
    if (activeRoomId === 'global') return showToast("Settings not available for Global Chat.", true);
    
    document.getElementById('room-settings-dropdown').classList.add('hidden');
    if(roomSettingsModal) roomSettingsModal.classList.remove('hidden');
    
    const roomSnap = await get(ref(db, `rooms_meta/${activeRoomId}`));
    if (roomSnap.exists()) {
        const data = roomSnap.val();
        
        const isCreator = data.creatorId === currentUser.uid || (!data.creatorId && Object.keys(data.members || {})[0] === currentUser.uid);
        const deleteBtn = document.getElementById('rs-delete-room-btn');
        const leaveBtn = document.getElementById('rs-leave-room-btn');
        
        if (isCreator) {
            if (deleteBtn) deleteBtn.classList.remove('hidden');
            if (leaveBtn) leaveBtn.classList.add('hidden');
        } else {
            if (deleteBtn) deleteBtn.classList.add('hidden');
            if (leaveBtn) leaveBtn.classList.remove('hidden');
        }
        
        // --- NEW: MODERATION - KICK USERS FROM MEMBERS TAB ---
        const memList = document.getElementById('rs-members-list');
        if (memList) {
            memList.innerHTML = '';
            if (data.members) {
                for (let uid in data.members) {
                    let kickBtnHtml = '';
                    if (isCreator && uid !== currentUser.uid) {
                        kickBtnHtml = `<button class="mini-btn danger kick-user-btn" data-uid="${uid}" data-name="${data.members[uid]}" style="padding: 0.2rem 0.6rem; margin: 0; width: auto; font-size: 0.75rem;">Kick</button>`;
                    }
                    memList.innerHTML += `<li style="padding: 0.8rem; border: 3px solid var(--text-color); border-radius: 8px; font-weight: bold; font-size: 0.95rem; display: flex; justify-content: space-between; align-items: center;">
                        <span>👤 ${data.members[uid]}</span>
                        ${kickBtnHtml}
                    </li>`;
                }
                
                // Attach the Kick listeners safely after generating HTML
                setTimeout(() => {
                    document.querySelectorAll('.kick-user-btn').forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            const targetUid = e.target.getAttribute('data-uid');
                            const targetName = e.target.getAttribute('data-name');
                            
                            if (confirm(`Kick ${targetName} from the room?`)) {
                                await remove(ref(db, `rooms_meta/${activeRoomId}/members/${targetUid}`));
                                await set(ref(db, `rooms_meta/${activeRoomId}/logs/${Date.now()}`), { 
                                    text: `${userProfileName} kicked ${targetName}.`, 
                                    timestamp: Date.now() 
                                });
                                showToast(`${targetName} was kicked.`, false);
                                
                                // Silently re-clicks the settings button to refresh the members list live!
                                document.getElementById('room-drop-settings').click(); 
                            }
                        });
                    });
                }, 50);

            } else { memList.innerHTML = '<li style="color: #888;">No members found.</li>'; }
        }
        
        const whInput = document.getElementById('rs-webhook-input');
        if(whInput) whInput.value = data.webhook || '';
        
        const logList = document.getElementById('rs-logs-list');
        if (logList) {
            logList.innerHTML = '';
            if (data.logs) {
                const logsArr = Object.values(data.logs).sort((a,b) => b.timestamp - a.timestamp);
                logsArr.forEach(l => {
                    let d = new Date(l.timestamp);
                    let tStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    logList.innerHTML += `<li style="padding: 0.8rem; background: rgba(0,0,0,0.05); border-left: 4px solid var(--accent-color); font-family: monospace; font-size: 0.85rem; font-weight: 600;">[${tStr}]<br>${l.text}</li>`;
                });
            } else { logList.innerHTML = '<li style="color: #888;">No logs found.</li>'; }
        }
    }
});

const rsTabs = ['members', 'webhooks', 'logs'];
rsTabs.forEach(tab => {
    const btn = document.getElementById(`rs-tab-${tab}`);
    if(btn) {
        btn.onclick = () => {
            rsTabs.forEach(t => {
                document.getElementById(`rs-tab-${t}`).classList.remove('active');
                document.getElementById(`rs-pane-${t}`).classList.add('hidden');
            });
            btn.classList.add('active');
            document.getElementById(`rs-pane-${tab}`).classList.remove('hidden');
        };
    }
});

document.getElementById('close-room-settings-btn')?.addEventListener('click', () => { 
    if(roomSettingsModal) roomSettingsModal.classList.add('hidden'); 
});

document.getElementById('rs-save-webhook')?.addEventListener('click', async () => {
    const url = document.getElementById('rs-webhook-input').value.trim();
    await set(ref(db, `rooms_meta/${activeRoomId}/webhook`), url);
    showToast("Webhook integration saved!", false);
});

const leaveRoomModal = document.getElementById('leave-room-modal');
const deleteRoomModal = document.getElementById('delete-room-modal');

document.getElementById('rs-leave-room-btn')?.addEventListener('click', () => {
    if(leaveRoomModal) leaveRoomModal.classList.remove('hidden');
});

document.getElementById('cancel-leave-btn')?.addEventListener('click', () => {
    if(leaveRoomModal) leaveRoomModal.classList.add('hidden');
});

document.getElementById('confirm-leave-btn')?.addEventListener('click', async () => {
    if(leaveRoomModal) leaveRoomModal.classList.add('hidden');
    try {
        const roomIdToLeave = activeRoomId;
        if (roomSettingsModal) roomSettingsModal.classList.add('hidden');

        switchRoom('global', 'Global Chat', 'GLOBAL');

        await remove(ref(db, `rooms_meta/${roomIdToLeave}/members/${currentUser.uid}`));
        await set(ref(db, `rooms_meta/${roomIdToLeave}/logs/${Date.now()}`), {
            text: `${userProfileName} left the room.`,
            timestamp: Date.now()
        });

        showToast("You left the room.", false);
    } catch (e) {
        showToast("Error leaving room: " + e.message);
    }
});

document.getElementById('rs-delete-room-btn')?.addEventListener('click', () => {
    const delInput = document.getElementById('delete-room-input');
    if(delInput) delInput.value = ''; 
    if(deleteRoomModal) deleteRoomModal.classList.remove('hidden');
});

document.getElementById('cancel-delete-btn')?.addEventListener('click', () => {
    if(deleteRoomModal) deleteRoomModal.classList.add('hidden');
});

document.getElementById('confirm-delete-btn')?.addEventListener('click', async () => {
    const delInput = document.getElementById('delete-room-input');
    if (delInput && delInput.value.trim().toLowerCase() === 'confirm') {
        if(deleteRoomModal) deleteRoomModal.classList.add('hidden');
        try {
            const roomIdToDelete = activeRoomId;
            if (roomSettingsModal) roomSettingsModal.classList.add('hidden');

            switchRoom('global', 'Global Chat', 'GLOBAL');

            await remove(ref(db, `rooms_meta/${roomIdToDelete}`));
            await remove(ref(db, `rooms_data/${roomIdToDelete}`));

            showToast("Room deleted successfully.", false);
        } catch (e) {
            showToast("Error deleting room: " + e.message);
        }
    } else {
        showToast("You must type 'confirm' exactly.");
    }
});

function bindChatScrolling(msgsRef) {
    const messagesList = document.getElementById('messages');
    if (!messagesList) return;
    
    const newMessagesList = messagesList.cloneNode(true);
    messagesList.parentNode.replaceChild(newMessagesList, messagesList);

    newMessagesList.addEventListener('scroll', async () => {
        if (newMessagesList.scrollTop === 0 && !isFetchingHistory && oldestMessageKey) {
            isFetchingHistory = true;
            const loadingBanner = document.getElementById('loading-history');
            if (loadingBanner) loadingBanner.classList.remove('hidden');
            
            try {
                const oldScrollHeight = newMessagesList.scrollHeight;
                const historyQuery = query(msgsRef, orderByKey(), endBefore(oldestMessageKey), limitToLast(20));
                const snapshot = await get(historyQuery);
                if (loadingBanner) loadingBanner.classList.add('hidden');
                
                if (snapshot.exists()) {
                    const history = [];
                    snapshot.forEach(child => { history.push({ key: child.key, val: child.val() }); });
                    oldestMessageKey = history[0].key;
                    
                    for(let i = history.length - 1; i >= 0; i--) {
                        displayMessage(history[i].key, history[i].val(), true);
                    }
                    newMessagesList.scrollTop = newMessagesList.scrollHeight - oldScrollHeight;
                }
            } catch (err) { console.error("Scroll error:", err); }
            isFetchingHistory = false;
        }
    });
}

const textInput = document.getElementById('message-input');
if (textInput) {
    textInput.addEventListener('input', () => {
        if (!isTyping && textInput.value.trim().length > 0) {
            isTyping = true; set(ref(db, `typing/global/${currentUser.uid}`), userProfileName);
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            isTyping = false; remove(ref(db, `typing/global/${currentUser.uid}`));
        }, 2000);
    });
}

onValue(ref(db, 'typing/global'), (snapshot) => {
    const typists = [];
    snapshot.forEach(child => { if (child.key !== currentUser.uid) typists.push(child.val()); });
    const container = document.getElementById('typing-status-container');
    const textElement = document.getElementById('typing-text');
    if (container && textElement) {
        if (typists.length > 0) {
            textElement.textContent = typists.length === 1 ? `${typists[0]} is typing...` : `${typists.join(', ')} are typing...`;
            container.classList.remove('hidden');
        } else { container.classList.add('hidden'); }
    }
});

const fileInput = document.getElementById('image-input');
const attachBtn = document.getElementById('attach-btn');
const mobileSendBtn = document.getElementById('mobile-send-btn');

if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', function() {
        if(this.files.length > 0) {
            attachBtn.classList.add('active');
            if(mobileSendBtn) mobileSendBtn.classList.remove('hidden');
        } else { 
            attachBtn.classList.remove('active');
            if(mobileSendBtn) mobileSendBtn.classList.add('hidden');
        }
    });
}

// --- MAIN CHAT ENGINE ---
const chatForm = document.getElementById('chat-form');
const messageInputObj = document.getElementById('message-input');

if (messageInputObj) {
    messageInputObj.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); 
            if (chatForm) chatForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
    });
}

if (chatForm) {
    chatForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const text = messageInputObj ? messageInputObj.value.trim() : '';
        const imageInput = document.getElementById('image-input');
        const file = imageInput ? imageInput.files[0] : null;
        const attachBtn = document.getElementById('attach-btn');
        
        if (!text && !file) return;

        try {
            if(messageInputObj) {
                messageInputObj.value = '';
                messageInputObj.rows = 1;
            }
            
            let uploadedImageUrl = null;
            const LIMITS = { free: 1048576, advanced: 1073741824, pro: 8589934592 };
            const activeTier = userTier || 'free'; 
            
            if (file) {
                if (file.size > LIMITS[activeTier]) {
                    showToast(`File too large! Your current plan allows ${activeTier.toUpperCase()} uploads.`);
                    if(imageInput) imageInput.value = ''; 
                    if(attachBtn) attachBtn.classList.remove('active');
                    return;
                }
                const fileRef = sRef(storage, `chat_images/${Date.now()}_${file.name}`);
                await uploadBytesResumable(fileRef, file);
                uploadedImageUrl = await getDownloadURL(fileRef);
            }
            if(imageInput) imageInput.value = ''; 
            if(attachBtn) attachBtn.classList.remove('active');
            
            const mobileSendBtnObj = document.getElementById('mobile-send-btn');
            if(mobileSendBtnObj) mobileSendBtnObj.classList.add('hidden');
            
            const payload = { 
                uid: currentUser.uid, 
                name: userProfileName, 
                photoUrl: userPhotoUrl, 
                text: text, 
                attachedImage: uploadedImageUrl, 
                timestamp: serverTimestamp(),
                tier: userTier 
            };
            if (activeReplyData) payload.replyTo = activeReplyData;
            
            const msgsRef = activeRoomId === 'global' ? ref(db, 'messages') : ref(db, `rooms_data/${activeRoomId}/messages`);
            await set(push(msgsRef), payload);

            if (activeRoomId !== 'global') {
                let previewText = text ? `${userProfileName}: ${text}` : `${userProfileName} sent an image`;
                if (previewText.length > 30) previewText = previewText.substring(0, 30) + '...';
                await set(ref(db, `rooms_meta/${activeRoomId}/lastMessage`), previewText);
            }
            
            if(imageInput) imageInput.value = ''; 
            if(attachBtn) attachBtn.classList.remove('active');
            
            const cancelReplyBtn = document.getElementById('cancel-reply-btn');
            if (cancelReplyBtn && !document.getElementById('active-reply-box').classList.contains('hidden')) {
                cancelReplyBtn.click();
            }
            
        } catch (error) { showToast("Failed to send message: " + error.message); } 
    });
}

const cancelReplyBtn = document.getElementById('cancel-reply-btn');
if (cancelReplyBtn) {
    cancelReplyBtn.addEventListener('click', () => {
        activeReplyData = null; 
        const replyBox = document.getElementById('active-reply-box');
        if (replyBox) replyBox.classList.add('hidden');
    });
}

function displayMessage(messageId, msg, prepend = false) {
    // --- NEW: MUTE FILTER ---
    // Instantly skips rendering if this user is in your local mute list!
    if (localStorage.getItem(`muted_${msg.uid}`) === 'true') return;

    const tempLoader = document.getElementById('temp-msg-loader');
    if (tempLoader) tempLoader.remove();

    const messagesList = document.getElementById('messages');
    if(!messagesList || document.getElementById(`msg-${messageId}`)) return;

    const item = document.createElement('li');
    item.id = `msg-${messageId}`;
    
    let timeString = '';
    if (msg.timestamp) {
        const d = new Date(msg.timestamp);
        timeString = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    if (msg.uid === currentUser.uid) item.classList.add('my-message');

    const avatarImg = msg.photoUrl || getAvatarUrl(msg.name, "");
    const replyHTML = msg.replyTo ? `<div class="reply-quote"><span class="reply-quote-name">↩ Replying to ${msg.replyTo.name}</span>"${msg.replyTo.text}"</div>` : '';
    const attachedImgHTML = msg.attachedImage ? `<img src="${msg.attachedImage}" class="msg-attached-img">` : '';
    const textHTML = msg.text ? `<div class="msg-text">${msg.text}</div>` : '';

    let badgeHTML = '';
    if (msg.tier === 'advanced') badgeHTML = `<span class="tier-badge advanced">ADVANCED</span>`;
    if (msg.tier === 'pro') badgeHTML = `<span class="tier-badge pro">PRO</span>`;

    item.innerHTML = `
        <div class="msg-actions">
            <span class="action-icon" onclick="reactToMessage('${messageId}', '👍')">👍</span>
            <span class="action-icon" onclick="reactToMessage('${messageId}', '❤️')">❤️</span>
            <span class="action-icon more-icon" onclick="toggleEmojiPicker(event, '${messageId}')">⋯</span>
            <span class="action-icon" onclick="prepareReply('${messageId}', '${msg.name.replace(/'/g, "\\'")}', '${msg.text ? msg.text.replace(/'/g, "\\'") : 'Image'}')">↩️</span>
        </div>
        <div class="msg-header" style="cursor: context-menu;">
            <img src="${avatarImg}" class="msg-avatar" alt="Avatar" onclick="viewUserProfile('${msg.uid}')">
            <div class="header-text">
                <span class="msg-name" style="cursor: pointer;" onclick="viewUserProfile('${msg.uid}')">${msg.name}</span>
                ${badgeHTML}
                <span class="msg-time">${timeString}</span>
            </div>
        </div>
        ${replyHTML}${attachedImgHTML}${textHTML}
        <div class="msg-reactions" id="reactions-${messageId}"></div>
    `;

    // --- NEW: RIGHT CLICK CONTEXT MENU LISTENER ---
    const msgHeader = item.querySelector('.msg-header');
    if (msgHeader) {
        msgHeader.addEventListener('contextmenu', (e) => {
            e.preventDefault(); // Stops the default browser right-click menu
            showContextMenu(e.pageX, e.pageY, msg.uid, msg.name);
        });
    }

    if (prepend) { messagesList.prepend(item); } else {
        messagesList.appendChild(item);
        setTimeout(() => { messagesList.scrollTo(0, messagesList.scrollHeight); }, 50);
    }
    if(msg.reactions) updateMessageReactions(messageId, msg);
}

window.prepareReply = function(id, name, text) {
    activeReplyData = { id, name, text };
    document.getElementById('replying-to-name').textContent = name;
    document.getElementById('replying-to-text').textContent = text.length > 40 ? text.substring(0, 40) + '...' : text;
    document.getElementById('active-reply-box').classList.remove('hidden');
    document.getElementById('message-input').focus();
};

window.reactToMessage = async function(messageId, emoji) {
    try { 
        const msgsRef = activeRoomId === 'global' ? ref(db, `messages/${messageId}/reactions/${currentUser.uid}`) : ref(db, `rooms_data/${activeRoomId}/messages/${messageId}/reactions/${currentUser.uid}`);
        
        const snap = await get(msgsRef);
        
        if (snap.exists() && snap.val() === emoji) {
            await remove(msgsRef);
        } else {
            await set(msgsRef, emoji);
        }
    } catch(err) { console.error("Reaction failed", err); }
};

function updateMessageReactions(messageId, msg) {
    const reactionContainer = document.getElementById(`reactions-${messageId}`);
    if (!reactionContainer) return;
    
    reactionContainer.innerHTML = '';
    if (!msg.reactions) return;

    const counts = {};
    let myReaction = null;

    for (const uid in msg.reactions) {
        const emoji = msg.reactions[uid];
        counts[emoji] = (counts[emoji] || 0) + 1;
        if (uid === currentUser.uid) {
            myReaction = emoji;
        }
    }
    
    for (const emoji in counts) {
        const badge = document.createElement('div');
        badge.className = 'reaction-badge';
        
        if (emoji === myReaction) {
            badge.classList.add('user-reacted');
        }
        
        badge.innerHTML = `${emoji} <strong>${counts[emoji]}</strong>`;
        badge.onclick = () => reactToMessage(messageId, emoji);
        
        reactionContainer.appendChild(badge);
    }
}

const loginBtn = document.getElementById('show-login-btn');
const signupBtn = document.getElementById('show-signup-btn');
const loginForm = document.getElementById('email-login-form');
const signupForm = document.getElementById('email-signup-form');

if (loginBtn && signupBtn) {
    loginBtn.addEventListener('click', () => {
        loginBtn.classList.add('active'); signupBtn.classList.remove('active');
        if(loginForm) loginForm.classList.remove('hidden'); 
        if(signupForm) signupForm.classList.add('hidden');
    });
    signupBtn.addEventListener('click', () => {
        signupBtn.classList.add('active'); loginBtn.classList.remove('active');
        if(signupForm) signupForm.classList.remove('hidden'); 
        if(loginForm) loginForm.classList.add('hidden');
    });
}

const loginNext = document.getElementById('login-next-btn');
if (loginNext) {
    loginNext.addEventListener('click', () => {
        if (document.getElementById('login-email').checkValidity()) {
            document.getElementById('login-step-1').classList.add('hidden');
            document.getElementById('login-step-2').classList.remove('hidden');
        } else { document.getElementById('login-email').reportValidity(); }
    });
    document.getElementById('login-back-btn').addEventListener('click', () => {
        document.getElementById('login-step-2').classList.add('hidden');
        document.getElementById('login-step-1').classList.remove('hidden');
    });
}

const signupNext1 = document.getElementById('signup-next-1-btn');
if (signupNext1) {
    signupNext1.addEventListener('click', () => {
        if (document.getElementById('signup-email').checkValidity()) {
            document.getElementById('signup-step-1').classList.add('hidden');
            document.getElementById('signup-step-2').classList.remove('hidden');
        } else { document.getElementById('signup-email').reportValidity(); }
    });
    document.getElementById('signup-back-1-btn').addEventListener('click', () => {
        document.getElementById('signup-step-2').classList.add('hidden');
        document.getElementById('signup-step-1').classList.remove('hidden');
    });
    
    document.getElementById('signup-next-2-btn').addEventListener('click', () => {
        if (document.getElementById('signup-username').checkValidity()) {
            document.getElementById('signup-step-2').classList.add('hidden');
            document.getElementById('signup-step-3').classList.remove('hidden');
        } else { document.getElementById('signup-username').reportValidity(); }
    });
    document.getElementById('signup-back-2-btn').addEventListener('click', () => {
        document.getElementById('signup-step-3').classList.add('hidden');
        document.getElementById('signup-step-2').classList.remove('hidden');
    });
}

if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const username = document.getElementById('signup-username').value;
        const phone = document.getElementById('signup-phone').value;
        
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(userCredential.user, { displayName: username });
            const userShortId = generateShortId();
            await set(ref(db, 'users/' + userCredential.user.uid), { 
                displayName: username, phoneNumber: phone,
                photoUrl: getAvatarUrl(username, ""), shortId: userShortId, 
                themeColor: "#FFD700", bio: "I'm new here!", pronouns: "",
                createdAt: userCredential.user.metadata.creationTime
            });
        } catch (error) { showToast("Sign Up Error: " + error.message); }
    });
}

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        try { await signInWithEmailAndPassword(auth, email, password); } 
        catch (error) { showToast("Login Error: " + error.message); }
    });
}

const googleLoginBtn = document.getElementById('google-login-btn');
if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', async () => { 
        try {
            await signInWithPopup(auth, new GoogleAuthProvider()); 
        } catch (error) {
            if (error.code !== 'auth/popup-closed-by-user') {
                showToast("Google Sign-In failed: " + error.message);
            }
        }
    });
}

const googleSignupBtn = document.getElementById('google-signup-btn');
if (googleSignupBtn) {
    googleSignupBtn.addEventListener('click', async () => { 
        try {
            await signInWithPopup(auth, new GoogleAuthProvider()); 
        } catch (error) {
            if (error.code !== 'auth/popup-closed-by-user') {
                showToast("Google Sign-Up failed: " + error.message);
            }
        }
    });
}

if (window.Capacitor && window.Capacitor.isNativePlatform()) {
    const googleLoginBtnObj = document.getElementById('google-login-btn');
    const googleSignupBtnObj = document.getElementById('google-signup-btn');
    if (googleLoginBtnObj) googleLoginBtnObj.style.display = 'none';
    if (googleSignupBtnObj) googleSignupBtnObj.style.display = 'none';

    const webLinks = document.querySelectorAll('.mobile-link[href="/"], .mobile-link[href="/story"]');
    webLinks.forEach(link => link.style.display = 'none');

    const logoLink = document.getElementById('nav-logo');
    if (logoLink) logoLink.href = 'chat.html';

    const chatLinks = document.querySelectorAll('a[href="/chat"]');
    chatLinks.forEach(link => link.href = 'chat.html');
}

let friendsListenerActive = false;

window.toggleContacts = function() {
    const panel = document.getElementById('contacts-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !friendsListenerActive) {
        onValue(ref(db, 'friends/' + currentUser.uid), () => { renderContactsUI(); });
        onValue(ref(db, 'presence'), () => { renderContactsUI(); }); 
        friendsListenerActive = true;
    }
}

const closeContactsBtn = document.getElementById('close-contacts-btn');
if (closeContactsBtn) {
    closeContactsBtn.addEventListener('click', () => {
        document.getElementById('contacts-panel').classList.remove('open');
        off(ref(db, 'friends/' + currentUser.uid));
        off(ref(db, 'presence')); 
        friendsListenerActive = false;
    });
}

window.sendRequest = async (targetUid) => {
    await set(ref(db, `friends/${currentUser.uid}/${targetUid}`), 'pending_sent');
    await set(ref(db, `friends/${targetUid}/${currentUser.uid}`), 'pending_received');
};
window.acceptRequest = async (targetUid) => {
    await set(ref(db, `friends/${currentUser.uid}/${targetUid}`), 'accepted');
    await set(ref(db, `friends/${targetUid}/${currentUser.uid}`), 'accepted');
};
window.removeFriend = async (targetUid) => {
    await remove(ref(db, `friends/${currentUser.uid}/${targetUid}`));
    await remove(ref(db, `friends/${targetUid}/${currentUser.uid}`));
};

async function renderContactsUI() {
    try {
        const list = document.getElementById('contacts-list');
        if(!list) return;
        list.innerHTML = '<li style="padding: 1rem; text-align: center;">Loading...</li>'; 

        const usersSnap = await get(ref(db, 'users'));
        const friendsSnap = await get(ref(db, 'friends/' + currentUser.uid));
        const presenceSnap = await get(ref(db, 'presence'));

        const allUsers = usersSnap.val() || {};
        const myFriends = friendsSnap.val() || {};
        const presenceData = presenceSnap.val() || {}; 

        let htmlRequests = ''; let htmlFriends = ''; let htmlOthers = '';

        for (const uid in allUsers) {
            if (uid === currentUser.uid) continue;
            const user = allUsers[uid]; const status = myFriends[uid];
            const avatar = user.photoUrl || getAvatarUrl(user.displayName, "");
            
            const isOnline = presenceData[uid] && presenceData[uid].state === 'online';
            const statusClass = isOnline ? 'online' : 'offline';

            const baseItem = `
                <li class="contact-item">
                    <div class="contact-info">
                        <div class="avatar-wrapper" onclick="viewUserProfile('${uid}')" style="cursor: pointer;" title="View Profile">
                            <img src="${avatar}" class="contact-avatar">
                            <div class="status-dot ${statusClass}"></div>
                        </div>
                        <span style="font-weight:600;">${user.displayName}</span>
                        <span class="unread-indicator" id="dot-${uid}"></span>
                    </div>
                    <div class="contact-actions">
            `;
            
            if (status === 'accepted') { 
                htmlFriends += baseItem + `
                    <button class="contact-icon-btn" onclick="openPrivateChat('${uid}', '${user.displayName.replace(/'/g, "\\'")}')" title="Message"><i class="ph-bold ph-chat-circle-text"></i></button>
                    <button class="contact-icon-btn" onclick="showToast('Voice call coming soon!')" title="Voice Call"><i class="ph-bold ph-phone"></i></button>
                    <button class="contact-icon-btn" onclick="showToast('Video call coming soon!')" title="Video Call"><i class="ph-bold ph-video-camera"></i></button>
                    <button class="contact-icon-btn" onclick="viewUserProfile('${uid}')" title="More Options"><i class="ph-bold ph-dots-three-vertical"></i></button>
                </div></li>`; 
            }
            else if (status === 'pending_received') { htmlRequests += baseItem + `<button class="mini-btn" onclick="acceptRequest('${uid}')">Accept</button><button class="mini-btn danger" onclick="removeFriend('${uid}')">Decline</button></div></li>`; } 
            else if (status === 'pending_sent') { htmlOthers += baseItem + `<span style="font-size:0.8rem; color:#888;">Requested</span></div></li>`; } 
            else { htmlOthers += baseItem + `<button class="mini-btn outline" onclick="sendRequest('${uid}')">Add</button></div></li>`; }
        }

        list.innerHTML = '';
        if (htmlRequests) list.innerHTML += `<li class="section-title">Friend Requests</li>` + htmlRequests;
        if (htmlFriends) list.innerHTML += `<li class="section-title">My Friends</li>` + htmlFriends;
        if (htmlOthers) list.innerHTML += `<li class="section-title">People in Room</li>` + htmlOthers;

        for (const uid in myFriends) {
            if (myFriends[uid] === 'accepted') {
                get(ref(db, `inbox/${currentUser.uid}/${uid}`)).then(snap => {
                    if(snap.exists() && snap.val().read === false) {
                        const dot = document.getElementById(`dot-${uid}`);
                        if(dot) dot.classList.add('unread-ping');
                    }
                });
            }
        }
    } catch (err) { console.error("Contacts render failed", err); }
}

function stopNotifications() { clearInterval(blinkInterval); document.title = originalTitle; }
function getPrivateRoomId(uid1, uid2) { return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`; }

window.openPrivateChat = function(targetUid, targetName) {
    try {
        currentPmTargetUid = targetUid; stopNotifications();
        const popup = document.getElementById('pm-popup');
        if(!popup) return;
        document.getElementById('pm-target-name').textContent = targetName;
        document.getElementById('pm-messages').innerHTML = '';

        if (pmQueryRef) off(pmQueryRef);
        set(ref(db, `inbox/${currentUser.uid}/${targetUid}/read`), true);

        currentPmRoomId = getPrivateRoomId(currentUser.uid, targetUid);
        const privateMessagesRef = ref(db, `private_messages/${currentPmRoomId}`);
        pmQueryRef = query(privateMessagesRef, limitToLast(30));

        onChildAdded(pmQueryRef, (snapshot) => {
            const msg = snapshot.val();
            const pmList = document.getElementById('pm-messages');
            const item = document.createElement('li');
            item.classList.add(msg.uid === currentUser.uid ? 'my-pm' : 'their-pm');
            item.textContent = msg.text;
            pmList.appendChild(item);
            pmList.scrollTo(0, pmList.scrollHeight);
        });

        popup.classList.remove('hidden');
    } catch(err) { showToast("Private Message Error: " + err.message); }
}

const pmCloseBtn = document.getElementById('pm-close-btn');
if (pmCloseBtn) {
    pmCloseBtn.addEventListener('click', () => {
        document.getElementById('pm-popup').classList.add('hidden');
        if (pmQueryRef) off(pmQueryRef);
        currentPmRoomId = null; currentPmTargetUid = null;
    });
}

const pmFormObj = document.getElementById('pm-form');
if (pmFormObj) {
    pmFormObj.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pmInput = document.getElementById('pm-input'); const text = pmInput.value.trim();
        if (text && currentPmRoomId) {
            try {
                await push(ref(db, `private_messages/${currentPmRoomId}`), { uid: currentUser.uid, text: text, timestamp: serverTimestamp() });
                await set(ref(db, `inbox/${currentPmTargetUid}/${currentUser.uid}`), { fromName: userProfileName, timestamp: Date.now(), read: false });
                pmInput.value = '';
            } catch(err) { showToast("Failed to send PM: " + err.message); }
        }
    });
}

window.viewUserProfile = async function(targetUid) {
    try {
        const snapshot = await get(ref(db, 'users/' + targetUid));
        if (!snapshot.exists()) return;
        
        const user = snapshot.val();
        const avatar = user.photoUrl || getAvatarUrl(user.displayName, "");
        
        let badgeHtml = '';
        const tier = (user.tier || "").toLowerCase();
        if (tier.includes('pro')) { badgeHtml = `<span class="tier-badge pro">PRO</span>`; } 
        else if (tier.includes('advanced')) { badgeHtml = `<span class="tier-badge advanced">ADVANCED</span>`; }

        document.getElementById('up-avatar').src = avatar;
        document.getElementById('up-name').innerHTML = `${user.displayName} ${badgeHtml}`;
        
        let displayId = user.shortId;
        if (!displayId) displayId = generateShortId();

        document.getElementById('up-pronouns').textContent = user.pronouns || "";
        document.getElementById('up-shortid').textContent = "#" + displayId;
        document.getElementById('up-bio').textContent = user.bio || "No bio yet.";
        document.getElementById('up-banner').style.backgroundColor = user.themeColor || "var(--accent-color)";
        
        const joinedEl = document.getElementById('up-joined');
        if (joinedEl) {
            if (user.createdAt) {
                const d = new Date(user.createdAt);
                joinedEl.textContent = "Joined: " + d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } else {
                joinedEl.textContent = "";
            }
        }
        
        const msgBtn = document.getElementById('up-message-btn');
        if(msgBtn) {
            msgBtn.onclick = () => {
                document.getElementById('user-profile-popup').classList.add('hidden');
                document.getElementById('modal-overlay').classList.add('hidden'); 
                document.getElementById('contacts-panel').classList.remove('open');
                openPrivateChat(targetUid, user.displayName);
            };
        }
        
       const removeBtn = document.getElementById('up-remove-friend-btn');
        const muteBtn = document.getElementById('up-mute-btn');
        const moreDropdown = document.getElementById('profile-more-dropdown');
        if (moreDropdown) moreDropdown.classList.add('hidden'); 

        // --- MUTE / UNMUTE LOGIC ---
        if (muteBtn) {
            if (targetUid === currentUser.uid) {
                muteBtn.style.display = 'none'; // Can't mute yourself!
            } else {
                muteBtn.style.display = 'block';
                const isMuted = localStorage.getItem(`muted_${targetUid}`) === 'true';
                muteBtn.textContent = isMuted ? 'Unmute User' : 'Mute User';
                
                muteBtn.onclick = () => {
                    if (isMuted) {
                        localStorage.removeItem(`muted_${targetUid}`);
                        showToast(`${user.displayName} unmuted!`, false);
                    } else {
                        localStorage.setItem(`muted_${targetUid}`, 'true');
                        showToast(`${user.displayName} muted!`, false);
                    }
                    document.getElementById('modal-overlay').click(); // Close the profile
                    // Refresh the chat to instantly show/hide their messages
                    switchRoom(activeRoomId, document.getElementById('active-room-name-display').textContent, activeRoomShortId);
                };
            }
        }

        // --- REMOVE FRIEND LOGIC ---
        if (removeBtn) {
            get(ref(db, `friends/${currentUser.uid}/${targetUid}`)).then(snap => {
                if (snap.exists() && snap.val() === 'accepted') {
                    removeBtn.style.display = 'block';
                    removeBtn.onclick = () => {
                        removeFriend(targetUid);
                        document.getElementById('modal-overlay').click(); 
                        showToast("Friend removed from contacts.");
                    };
                } else {
                    removeBtn.style.display = 'none'; 
                }
            });
        }

        document.getElementById('user-profile-popup').classList.remove('hidden');
        document.getElementById('modal-overlay').classList.remove('hidden');
    } catch (error) { 
        console.error("Profile Load Error:", error);
        showToast("Failed to load user profile: " + error.message); 
    }
};

const overlayObj = document.getElementById('modal-overlay');
if (overlayObj) {
    overlayObj.addEventListener('click', () => {
        const popup = document.getElementById('user-profile-popup');
        if(popup && !popup.classList.contains('hidden')) {
            popup.classList.add('hidden');
            popup.classList.remove('preview-layout');
            const dropdown = document.getElementById('profile-more-dropdown');
            if (dropdown) dropdown.classList.add('hidden');
        }
        
        const settingsModal = document.getElementById('settings-modal');
        if(!settingsModal || settingsModal.classList.contains('hidden')) {
            overlayObj.classList.add('hidden');
        }
    });
}

const moreProfileBtn = document.getElementById('more-profile-btn');
if (moreProfileBtn) {
    moreProfileBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        document.getElementById('profile-more-dropdown').classList.toggle('hidden');
    });
}

let activeMessageId = null;

window.toggleEmojiPicker = function(event, messageId) {
    activeMessageId = messageId;
    const picker = document.getElementById('emoji-picker');
    if(!picker) return;
    
    picker.style.top = (event.pageY + 10) + 'px';
    picker.style.left = (event.pageX - 50) + 'px';
    picker.classList.remove('hidden');
    
    document.addEventListener('click', function hidePicker(e) {
        if (!e.target.classList.contains('more-icon')) {
            picker.classList.add('hidden');
            document.removeEventListener('click', hidePicker);
        }
    }, { once: true });
};

window.addReaction = function(emoji) {
    if (activeMessageId) {
        reactToMessage(activeMessageId, emoji);
        const picker = document.getElementById('emoji-picker');
        if(picker) picker.classList.add('hidden');
    }
};

document.addEventListener('click', (event) => {
    const advancedBtn = event.target.closest('#upgrade-advanced-btn');
    if (advancedBtn) {
        const url = "https://minimalistchat.lemonsqueezy.com/checkout/buy/b6f29d05-deb2-4314-ab4f-ab9c43b5e6bb"; 
        window.location.href = `${url}?checkout[custom][user_id]=${auth.currentUser.uid}`;
    }

    const proBtn = event.target.closest('#upgrade-pro-btn');
    if (proBtn) {
        const url = "https://minimalistchat.lemonsqueezy.com/checkout/buy/12f9553f-8cb0-4f39-aefc-7ca11ef2f85e"; 
        window.location.href = `${url}?checkout[custom][user_id]=${auth.currentUser.uid}`;
    }

    const manageBtn = event.target.closest('#manage-billing-btn');
    if (manageBtn) {
        window.location.href = "https://minimalist.lemonsqueezy.com/billing";
    }
});

function initLiveClock() {
    const clockEl = document.getElementById('live-clock');
    if (!clockEl) return;
    
    setInterval(() => {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
        });
        clockEl.textContent = `SYSTEM TIME: ${timeString}`;
    }, 1000);
    
    clockEl.textContent = `SYSTEM TIME: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}`;
}
initLiveClock();

function initBlinkingFavicon() {
    const favicon = document.getElementById('dynamic-favicon');
    if (!favicon) return;

    const openEyes = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='10' y='10' width='80' height='60' rx='25' fill='%23FFD700' stroke='%23000' stroke-width='8'/><path d='M 25 70 L 25 90 L 45 70 Z' fill='%23FFD700' stroke='%23000' stroke-width='8' stroke-linejoin='round'/><circle cx='35' cy='40' r='8' fill='%23000'/><circle cx='65' cy='40' r='8' fill='%23000'/></svg>";
    const closedEyes = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='10' y='10' width='80' height='60' rx='25' fill='%23FFD700' stroke='%23000' stroke-width='8'/><path d='M 25 70 L 25 90 L 45 70 Z' fill='%23FFD700' stroke='%23000' stroke-width='8' stroke-linejoin='round'/><line x1='27' y1='40' x2='43' y2='40' stroke='%23000' stroke-width='6' stroke-linecap='round'/><line x1='57' y1='40' x2='73' y2='40' stroke='%23000' stroke-width='6' stroke-linecap='round'/></svg>";

    setInterval(() => {
        favicon.href = closedEyes;
        setTimeout(() => { favicon.href = openEyes; }, 150); 
    }, 4000);
}
initBlinkingFavicon();

window.fixMissingShortIds = async function() {
    try {
        const usersSnap = await get(ref(db, 'users'));
        let fixedCount = 0;
        usersSnap.forEach(childSnap => {
            const userData = childSnap.val();
            if (!userData.shortId) {
                const newId = generateShortId();
                set(ref(db, `users/${childSnap.key}/shortId`), newId);
                console.log(`Fixed ID for ${userData.displayName}: #${newId}`);
                fixedCount++;
            }
        });
        showToast(`Database patched! Fixed ${fixedCount} accounts.`);
    } catch (error) { console.error("Migration failed:", error); }
};

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered!', reg))
            .catch(err => console.error('Service Worker registration failed: ', err));
    });
}

window.initializePresence = function() {
    if (!currentUser) return;
    const myPresenceRef = ref(db, `presence/${currentUser.uid}`);
    const connectedRef = ref(db, '.info/connected');

    onValue(connectedRef, (snap) => {
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

window.wipeGhosts = async function() {
    try { await remove(ref(db, 'presence')); showToast("All ghost connections wiped!"); } 
    catch(e) { console.error("Wipe failed:", e); }
};

async function fetchGitHubUpdates() {
    const list = document.getElementById('updates-list');
    if (!list) return;
    list.innerHTML = '<li style="padding: 2rem; text-align: center; font-weight: 800; animation: textPulse 1.5s infinite;">PULLING COMMITS...</li>';
    
    try {
        const response = await fetch('https://api.github.com/repos/Hao14/minimalist-chat/commits?per_page=15');
        if (!response.ok) throw new Error("Failed to fetch GitHub data");
        
        const commits = await response.json();
        list.innerHTML = ''; 
        
        commits.forEach(commitObj => {
            const rawMsg = commitObj.commit.message;
            const msgLines = rawMsg.split('\n');
            const title = msgLines[0];
            const description = msgLines.slice(1).join('\n').trim();
            const dateObj = new Date(commitObj.commit.author.date);
            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const authorUrl = commitObj.author ? commitObj.author.avatar_url : 'https://ui-avatars.com/api/?name=Dev&background=000&color=FFD700';
            const authorName = commitObj.commit.author.name;
            const descHtml = description ? `<div class="update-desc">${description}</div>` : '';

            list.innerHTML += `
                <li class="update-card fade-in-up">
                    <div class="update-date">${dateStr}</div>
                    <div class="update-title">${title}</div>
                    ${descHtml}
                    <div class="update-author">
                        <img src="${authorUrl}" alt="Author" onerror="this.src='https://ui-avatars.com/api/?name=Dev&background=000&color=FFD700'"> 
                        ${authorName}
                    </div>
                </li>
            `;
        });
    } catch (err) {
        console.error(err);
        list.innerHTML = `<li style="padding: 2rem; text-align: center; color: red; border: 4px solid red; font-weight: bold;">CONNECTION FAILED.</li>`;
    }
}

let blipClickCount = 0;
let blipClickTimer = null;
const MY_ADMIN_UID = "WsREhwYvPxaCSAjz0aqvwAU1leg2"; 

const miniBlip = document.getElementById('mini-admin-blip');
if (miniBlip) {
    miniBlip.addEventListener('click', () => {
        blipClickCount++;
        if (blipClickCount === 5) {
            clearTimeout(blipClickTimer);
            blipClickCount = 0;
            if (currentUser && currentUser.uid === MY_ADMIN_UID) {
                document.getElementById('admin-dashboard-modal').classList.remove('hidden');
                showToast("Admin Dashboard Unlocked.", false);
            } else { showToast("Access Denied. Intruder logged."); }
        } else {
            clearTimeout(blipClickTimer);
            blipClickTimer = setTimeout(() => {
                if (blipClickCount > 0 && blipClickCount < 5) { window.open("https://github.com/Hao14/minimalist-chat/issues", "_blank"); }
                blipClickCount = 0;
            }, 400); 
        }
    });
}

const closeAdminBtn = document.getElementById('close-admin-dashboard-btn');
if (closeAdminBtn) {
    closeAdminBtn.addEventListener('click', () => { document.getElementById('admin-dashboard-modal').classList.add('hidden'); });
}

const adminWipeBtn = document.getElementById('admin-wipe-btn');
if (adminWipeBtn) {
    adminWipeBtn.addEventListener('click', async () => {
        try { await remove(ref(db, 'presence')); showToast("Ghost connections wiped successfully!"); } 
        catch(e) { showToast("Failed to wipe connections: " + e.message); }
    });
}

const adminBanBtn = document.getElementById('admin-ban-btn');
if (adminBanBtn) {
    adminBanBtn.addEventListener('click', () => {
        const target = document.getElementById('admin-target-id').value.trim();
        if (!target) return showToast("Enter a UID first!");
        set(ref(db, `users/${target}/isBanned`), true)
            .then(() => showToast(`User ${target} banned!`))
            .catch((e) => showToast("Ban failed: " + e.message));
    });
}

const adminMuteBtn = document.getElementById('admin-mute-btn');
if (adminMuteBtn) {
    adminMuteBtn.addEventListener('click', () => {
        const target = document.getElementById('admin-target-id').value.trim();
        if (!target) return showToast("Enter a UID first!");
        set(ref(db, `users/${target}/isMuted`), true)
            .then(() => showToast(`User ${target} muted!`))
            .catch((e) => showToast("Mute failed: " + e.message));
    });
}