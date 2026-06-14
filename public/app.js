import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signInWithPhoneNumber, onAuthStateChanged, signOut, deleteUser, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
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
let userTier = "free"; // <-- ADD THIS LINE
let userPhone = "No phone on file"; // <-- ADD THIS LINE
let currentPmRoomId = null;
let currentPmTargetUid = null;
let pmQueryRef = null;

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
        
        // Slide it down
        toast.classList.remove('toast-hidden');
        
        // Auto-hide after 4 seconds
        setTimeout(() => {
            toast.classList.add('toast-hidden');
        }, 4000);
    } else {
        // Fallback just in case the HTML is missing
        alert(message);
    }
};

// Make the close button work
document.addEventListener('click', (e) => {
    if (e.target.id === 'toast-close') {
        document.getElementById('brutalist-toast').classList.add('toast-hidden');
    }
});
// --- HANDLE GOOGLE REDIRECT RETURN ---
// When the app reloads after Google login, check if anything went wrong
getRedirectResult(auth).catch((error) => {
    // We only alert if there is a real error, ignoring minor network interruptions
    if (error.code !== 'auth/redirect-cancelled-by-user') {
        console.error("Google Auth Error:", error);
        showToast("Google Sign-In failed: " + error.message);
    }
});
// --- OPTIMISTIC UI RENDERING ---
document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('blipLoaded') === 'true') {
        
        // 1. Hide the loading screen immediately
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) loadingScreen.classList.add('hidden');
        
        // 2. Instantly draw the chat UI shell 
        const chatWrapper = document.getElementById('chat-wrapper');
        if (chatWrapper) {
            document.querySelectorAll('.app-screen').forEach(s => s.classList.add('hidden'));
            chatWrapper.classList.remove('hidden');
        }

        // 3. NEW: Instantly draw the top buttons so the header doesn't jump!
        const desktopNavActions = document.getElementById('nav-actions');
        if (desktopNavActions) {
            desktopNavActions.innerHTML = `<button class="action-btn" id="open-contacts-btn">Contacts</button><button class="action-btn" id="open-settings-btn">Settings</button>`;
        }

        // 4. NEW: Add a temporary pulsing loader inside the chat box
        const messagesList = document.getElementById('messages');
        if (messagesList && messagesList.innerHTML.trim() === '') {
            messagesList.innerHTML = `<li id="temp-msg-loader" style="text-align: center; color: #888; font-weight: 800; margin-top: 2rem; list-style: none; animation: textPulse 1.5s infinite ease-in-out;">DECRYPTING MESSAGES...</li>`;
        }
    }
});
// --- UI SCREEN MANAGER ---
function showScreen(screenId) {
    document.querySelectorAll('.app-screen').forEach(screen => { screen.classList.add('hidden'); });
    const target = document.getElementById(screenId);
    if(target) target.classList.remove('hidden');
}

if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');
const themeBtn = document.getElementById('theme-toggle-btn');
if (themeBtn) {
    themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
    });
}

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

// --- NOTIFICATIONS ---
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

// --- THE SECURITY BOUNCER ---
onAuthStateChanged(auth, async (user) => {
    const currentPage = window.location.pathname;
    const isLoginPage = currentPage.includes('login.html');
    const isChatPage = currentPage.includes('chat.html');

    if (user) {
        document.querySelectorAll('.auth-only').forEach(el => el.classList.remove('hidden'));
        document.querySelectorAll('.guest-only').forEach(el => el.classList.add('hidden'));

        if (isLoginPage) { window.location.replace('chat.html'); return; }
        if (isChatPage) {
            currentUser = user;
            checkUserProfile(user.uid);
        }
    } else {
        document.querySelectorAll('.auth-only').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.guest-only').forEach(el => el.classList.remove('hidden'));

        if (isChatPage) { window.location.replace('login.html'); }
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
            userTier = data.tier || "free"; // <-- ADD THIS LINE
            userPhone = data.phoneNumber || "No phone on file"; // <-- ADD THIS LINE
            updateBillingUI();
            
            if (!data.shortId) {
                userShortId = generateShortId();
                await set(ref(db, 'users/' + uid + '/shortId'), userShortId);
            } else { userShortId = data.shortId; }

            // --- NEW: BACKFILL CREATION DATE ---
            // If the user's public profile is missing a join date, silently add it!
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

// --- SETTINGS MODAL & PROFILE LOGIC ---
window.openSettings = function() {
    const modalObj = document.getElementById('settings-modal');
    
    // SAFETY CHECK: Redirect to chat page if settings modal doesn't exist
    if (!modalObj) {
        window.location.href = 'chat.html';
        return;
    }
    

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
        
        // --- NEW: Inject the phone number ---
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

const tabProfileBtn = document.getElementById('tab-btn-profile');
if (tabProfileBtn) {
    tabProfileBtn.addEventListener('click', () => switchTab('pane-profile', 'tab-btn-profile'));
    document.getElementById('tab-btn-billing').addEventListener('click', () => switchTab('pane-billing', 'tab-btn-billing'));
    document.getElementById('tab-btn-app').addEventListener('click', () => switchTab('pane-app', 'tab-btn-app'));
    
    const logoutBtn = document.getElementById('logout-btn');
    if(logoutBtn) logoutBtn.addEventListener('click', () => { 
        document.getElementById('settings-modal').classList.add('hidden'); 
        document.getElementById('modal-overlay').classList.add('hidden'); 
        // Add this line inside your logout button click event
        sessionStorage.removeItem('blipLoaded');
        signOut(auth); 
    });
    
    const openSettingsMobile = document.getElementById('open-settings-btn-mobile');
    if(openSettingsMobile) openSettingsMobile.addEventListener('click', () => { 
        document.getElementById('mobile-nav-links').classList.add('hidden'); 
        openSettings(); 
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

// --- EMOJI PICKER ---
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

// --- MAIN CHAT ENGINE ---
// --- MOVE THIS OUTSIDE OF enterChat() ---

// --- THIS UPDATES THE BUTTONS ---
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

        // Wrap the actual chat launch sequence in a helper function
        const launchChatUI = () => {
            showScreen('chat-wrapper'); 
            
            if(desktopNavActions) {
                desktopNavActions.innerHTML = `<button class="action-btn" id="open-contacts-btn">Contacts</button><button class="action-btn" id="open-settings-btn">Settings</button>`;
                document.getElementById('open-settings-btn').addEventListener('click', openSettings);
                document.getElementById('open-contacts-btn').addEventListener('click', toggleContacts);
            }
            
            const myStatusRef = ref(db, `presence/${currentUser.uid}`);
            const connectedRef = ref(db, '.info/connected');
            
            onValue(connectedRef, (snap) => {
                if (snap.val() === true) {
                    onDisconnect(myStatusRef).set({ state: 'offline', last_changed: serverTimestamp() }).then(() => {
                        set(myStatusRef, { state: 'online', last_changed: serverTimestamp() });
                    });
                }
            });

            const previewBtn = document.getElementById('preview-profile-btn');
            if (previewBtn) {
                previewBtn.addEventListener('click', () => {
                    document.getElementById('user-profile-popup').classList.add('preview-layout');
                    viewUserProfile(currentUser.uid); 
                });
            }
            
            if (!chatInitialized) {
                initializeChatMemory();
                listenForNotifications();
                chatInitialized = true;
            }
        };

        // --- THE FIX: CHECK SESSION MEMORY ---
        // If they already loaded the chat this session, skip the delay completely!
        if (sessionStorage.getItem('blipLoaded') === 'true') {
            launchChatUI(); 
        } else {
            // First time logging in: Show Blip, wait 2 seconds, then save to memory
            showScreen('loading-screen');
            if(desktopNavActions) desktopNavActions.innerHTML = '';
            
            setTimeout(() => {
                sessionStorage.setItem('blipLoaded', 'true'); // Save to memory
                launchChatUI();
            }, 2000);
        }

    } catch (error) { showToast("Error launching chat interface: " + error.message); }
}

function initializeChatMemory() {
    const messagesRef = ref(db, 'messages');
    const messagesList = document.getElementById('messages');
    if (!messagesList) return;
    
    const recentMessages = query(messagesRef, limitToLast(30));
    onChildAdded(recentMessages, (snapshot) => { 
        if(!oldestMessageKey) oldestMessageKey = snapshot.key; 
        displayMessage(snapshot.key, snapshot.val(), false); 
    });
    onChildChanged(recentMessages, (snapshot) => { updateMessageReactions(snapshot.key, snapshot.val()); });

    messagesList.addEventListener('scroll', async () => {
        if (messagesList.scrollTop === 0 && !isFetchingHistory && oldestMessageKey) {
            isFetchingHistory = true;
            const loadingBanner = document.getElementById('loading-history');
            if (loadingBanner) loadingBanner.classList.remove('hidden');
            
            try {
                const oldScrollHeight = messagesList.scrollHeight;
                const historyQuery = query(messagesRef, orderByKey(), endBefore(oldestMessageKey), limitToLast(20));
                const snapshot = await get(historyQuery);
                if (loadingBanner) loadingBanner.classList.add('hidden');
                
                if (snapshot.exists()) {
                    const history = [];
                    snapshot.forEach(child => { history.push({ key: child.key, val: child.val() }); });
                    oldestMessageKey = history[0].key;
                    
                    for(let i = history.length - 1; i >= 0; i--) {
                        displayMessage(history[i].key, history[i].val(), true);
                    }
                    messagesList.scrollTop = messagesList.scrollHeight - oldScrollHeight;
                }
            } catch (err) { console.error("Scroll error:", err); }
            isFetchingHistory = false;
        }
    });

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
    if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', function() {
            if(this.files.length > 0) attachBtn.classList.add('active');
            else attachBtn.classList.remove('active');
        });
    }
}

const chatForm = document.getElementById('chat-form');
if (chatForm) {
    chatForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const sendBtn = document.getElementById('send-message-btn');
        if(sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending...'; }

        const textInput = document.getElementById('message-input');
        const text = textInput ? textInput.value.trim() : '';
        const imageInput = document.getElementById('image-input');
        const file = imageInput ? imageInput.files[0] : null;
        
        try {
            let uploadedImageUrl = null;
            
            // Apply Tier Limits for Uploads
            const LIMITS = { free: 1048576, advanced: 1073741824, pro: 8589934592 };
            
            // OPTIMIZATION: Use the global userTier variable we fetched on login!
            const activeTier = userTier || 'free'; 
            
            if (file) {
                if (file.size > LIMITS[activeTier]) {
                    showToast(`File too large! Your current plan allows ${activeTier.toUpperCase()} uploads.`);
                    if(sendBtn) { sendBtn.textContent = 'SEND'; sendBtn.disabled = false; }
                    // Clear the file input so they don't accidentally try sending it again
                    imageInput.value = ''; 
                    attachBtn.classList.remove('active');
                    return;
                }
                const fileRef = sRef(storage, `chat_images/${Date.now()}_${file.name}`);
                await uploadBytesResumable(fileRef, file);
                uploadedImageUrl = await getDownloadURL(fileRef);
            }
            
            const payload = { 
                uid: currentUser.uid, 
                name: userProfileName, 
                photoUrl: userPhotoUrl, 
                text: text, 
                attachedImage: uploadedImageUrl, 
                timestamp: serverTimestamp(), // <--- MAKE SURE THIS COMMA IS HERE!
                tier: userTier 
            };
            if (activeReplyData) payload.replyTo = activeReplyData;
            
            await set(push(ref(db, 'messages')), payload);
            
            if(textInput) textInput.value = ''; 
            if(imageInput) imageInput.value = ''; 
            const attachBtn = document.getElementById('attach-btn');
            if(attachBtn) attachBtn.classList.remove('active');
            
            const cancelReplyBtn = document.getElementById('cancel-reply-btn');
            if (cancelReplyBtn && !document.getElementById('active-reply-box').classList.contains('hidden')) {
                cancelReplyBtn.click();
            }
            
        } catch (error) { showToast("Failed to send message: " + error.message); } 
        finally { if(sendBtn) { sendBtn.textContent = 'SEND'; sendBtn.disabled = false; } }
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
    // --- NEW: Remove the temporary loader when the first real message arrives ---
    const tempLoader = document.getElementById('temp-msg-loader');
    if (tempLoader) tempLoader.remove();

    const messagesList = document.getElementById('messages');
    if(!messagesList || document.getElementById(`msg-${messageId}`)) return;

    const item = document.createElement('li');
    item.id = `msg-${messageId}`;
    
    // FORMAT DATE & TIME (e.g., 6/9/2026 9:25 AM)
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

    // GENERATE TIER BADGES
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
        <div class="msg-header">
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
        const myReactionRef = ref(db, `messages/${messageId}/reactions/${currentUser.uid}`);
        const snap = await get(myReactionRef);
        
        // UNDO LOGIC: If you click the exact same emoji you already used, remove it!
        if (snap.exists() && snap.val() === emoji) {
            await remove(myReactionRef);
        } else {
            // Otherwise, apply the new reaction
            await set(myReactionRef, emoji);
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

    // Tally the emojis and figure out which one belongs to the current user
    for (const uid in msg.reactions) {
        const emoji = msg.reactions[uid];
        counts[emoji] = (counts[emoji] || 0) + 1;
        if (uid === currentUser.uid) {
            myReaction = emoji;
        }
    }
    
    // Draw the badges
    for (const emoji in counts) {
        const badge = document.createElement('div');
        badge.className = 'reaction-badge';
        
        // Highlight this specific badge if it's the one the user selected
        if (emoji === myReaction) {
            badge.classList.add('user-reacted');
        }
        
        badge.innerHTML = `${emoji} <strong>${counts[emoji]}</strong>`;
        
        // ECHO LOGIC: Clicking an existing badge triggers that specific reaction
        badge.onclick = () => reactToMessage(messageId, emoji);
        
        reactionContainer.appendChild(badge);
    }
}

// --- AUTH FORMS ---
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
                createdAt: userCredential.user.metadata.creationTime // <-- NEW!
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
    googleLoginBtn.addEventListener('click', () => { 
        // Instantly redirects the page to Google
        signInWithRedirect(auth, new GoogleAuthProvider()); 
    });
}

const googleSignupBtn = document.getElementById('google-signup-btn');
if (googleSignupBtn) {
    googleSignupBtn.addEventListener('click', () => { 
        // Instantly redirects the page to Google
        signInWithRedirect(auth, new GoogleAuthProvider()); 
    });
}

// --- FRIENDS & PMS ---
let friendsListenerActive = false;

window.toggleContacts = function() {
    const panel = document.getElementById('contacts-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !friendsListenerActive) {
        onValue(ref(db, 'friends/' + currentUser.uid), () => { renderContactsUI(); });
        friendsListenerActive = true;
    }
}

const closeContactsBtn = document.getElementById('close-contacts-btn');
if (closeContactsBtn) {
    closeContactsBtn.addEventListener('click', () => {
        document.getElementById('contacts-panel').classList.remove('open');
        off(ref(db, 'friends/' + currentUser.uid));
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
                    <div class="contact-info" onclick="viewUserProfile('${uid}')">
                        <div class="avatar-wrapper">
                            <img src="${avatar}" class="contact-avatar">
                            <div class="status-dot ${statusClass}"></div>
                        </div>
                        <span style="font-weight:600;">${user.displayName}</span>
                        <span class="unread-indicator" id="dot-${uid}"></span>
                    </div>
                    <div class="contact-actions">
            `;
            if (status === 'accepted') { htmlFriends += baseItem + `<button class="mini-btn danger" onclick="removeFriend('${uid}')" title="Remove Friend">✖</button></div></li>`; } 
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
// --- VIEW USER PROFILE (THE DEFINITIVE VERSION) ---
window.viewUserProfile = async function(targetUid) {
    try {
        const snapshot = await get(ref(db, 'users/' + targetUid));
        if (!snapshot.exists()) return;
        
        const user = snapshot.val();
        const avatar = user.photoUrl || getAvatarUrl(user.displayName, "");
        
        // 1. Render Tier Badges
        let badgeHtml = '';
        const tier = (user.tier || "").toLowerCase();
        if (tier.includes('pro')) {
            badgeHtml = `<span class="tier-badge pro">PRO</span>`;
        } else if (tier.includes('advanced')) {
            badgeHtml = `<span class="tier-badge advanced">ADVANCED</span>`;
        }

        document.getElementById('up-avatar').src = avatar;
        document.getElementById('up-name').innerHTML = `${user.displayName} ${badgeHtml}`;
        
        // 2. THE VISUAL PATCH: Fake it till they make it!
        // Generates a visual ID to hide the #000000 error without triggering Firebase Security Rules
        let displayId = user.shortId;
        if (!displayId) displayId = generateShortId();

        document.getElementById('up-pronouns').textContent = user.pronouns || "";
        document.getElementById('up-shortid').textContent = "#" + displayId;
        document.getElementById('up-bio').textContent = user.bio || "No bio yet.";
        document.getElementById('up-banner').style.backgroundColor = user.themeColor || "var(--accent-color)";
        
        // 3. Render Joined Date
        const joinedEl = document.getElementById('up-joined');
        if (joinedEl) {
            if (user.createdAt) {
                const d = new Date(user.createdAt);
                joinedEl.textContent = "Joined: " + d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } else {
                joinedEl.textContent = "";
            }
        }
        
        // 4. Setup PM Button
        const msgBtn = document.getElementById('up-message-btn');
        if(msgBtn) {
            msgBtn.onclick = () => {
                document.getElementById('user-profile-popup').classList.add('hidden');
                document.getElementById('modal-overlay').classList.add('hidden'); 
                document.getElementById('contacts-panel').classList.remove('open');
                openPrivateChat(targetUid, user.displayName);
            };
        }

        // Show Modal
        document.getElementById('user-profile-popup').classList.remove('hidden');
        document.getElementById('modal-overlay').classList.remove('hidden');
    } catch (error) { 
        console.error("Profile Load Error:", error);
        showToast("Failed to load user profile: " + error.message); 
    }
};
const closeProfileBtn = document.getElementById('close-profile-btn');
if (closeProfileBtn) {
    closeProfileBtn.addEventListener('click', () => {
        const popup = document.getElementById('user-profile-popup');
        if(popup) { popup.classList.add('hidden'); popup.classList.remove('preview-layout'); }
        if(document.getElementById('settings-modal') && document.getElementById('settings-modal').classList.contains('hidden')) {
            document.getElementById('modal-overlay').classList.add('hidden');
        }
    });
}

const closeSettingsBtn = document.getElementById('close-settings-btn');
if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => { 
        document.getElementById('settings-modal').classList.add('hidden'); 
        document.getElementById('modal-overlay').classList.add('hidden'); 
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

// --- BILLING LOGIC ---
document.addEventListener('click', (event) => {
    // 1. Upgrade Advanced
    const advancedBtn = event.target.closest('#upgrade-advanced-btn');
    if (advancedBtn) {
        // REPLACE THE URL BELOW with the one you copied from Lemon Squeezy
        const url = "https://minimalistchat.lemonsqueezy.com/checkout/buy/b6f29d05-deb2-4314-ab4f-ab9c43b5e6bb"; 
        window.location.href = `${url}?checkout[custom][user_id]=${auth.currentUser.uid}`;
    }

    // 2. Upgrade Pro
    const proBtn = event.target.closest('#upgrade-pro-btn');
    if (proBtn) {
        // REPLACE THE URL BELOW with the one you copied from Lemon Squeezy
        const url = "https://minimalistchat.lemonsqueezy.com/checkout/buy/12f9553f-8cb0-4f39-aefc-7ca11ef2f85e"; 
        window.location.href = `${url}?checkout[custom][user_id]=${auth.currentUser.uid}`;
    }

    // 3. Manage Billing
    const manageBtn = event.target.closest('#manage-billing-btn');
    if (manageBtn) {
        // This takes them to their Lemon Squeezy billing portal
        window.location.href = "https://minimalist.lemonsqueezy.com/billing";
    }
});
// --- LIVE FOOTER CLOCK ---
function initLiveClock() {
    const clockEl = document.getElementById('live-clock');
    if (!clockEl) return;
    
    // Updates the clock every 1000 milliseconds (1 second)
    setInterval(() => {
        const now = new Date();
        
        // Formats the time to look like "08:09:45 PM PDT"
        const timeString = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
        });
        
        clockEl.textContent = `SYSTEM TIME: ${timeString}`;
    }, 1000);
    
    // Run it once immediately so there is no 1-second delay on page load
    clockEl.textContent = `SYSTEM TIME: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}`;
}
initLiveClock();

// --- BLIP FAVICON ANIMATION ---
function initBlinkingFavicon() {
    const favicon = document.getElementById('dynamic-favicon');
    if (!favicon) return;

    // Blip with open eyes (Circles)
    const openEyes = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='10' y='10' width='80' height='60' rx='25' fill='%23FFD700' stroke='%23000' stroke-width='8'/><path d='M 25 70 L 25 90 L 45 70 Z' fill='%23FFD700' stroke='%23000' stroke-width='8' stroke-linejoin='round'/><circle cx='35' cy='40' r='8' fill='%23000'/><circle cx='65' cy='40' r='8' fill='%23000'/></svg>";
    
    // Blip with closed eyes (Flat lines)
    const closedEyes = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='10' y='10' width='80' height='60' rx='25' fill='%23FFD700' stroke='%23000' stroke-width='8'/><path d='M 25 70 L 25 90 L 45 70 Z' fill='%23FFD700' stroke='%23000' stroke-width='8' stroke-linejoin='round'/><line x1='27' y1='40' x2='43' y2='40' stroke='%23000' stroke-width='6' stroke-linecap='round'/><line x1='57' y1='40' x2='73' y2='40' stroke='%23000' stroke-width='6' stroke-linecap='round'/></svg>";

    // Every 4 seconds, close the eyes, then open them 150 milliseconds later
    setInterval(() => {
        favicon.href = closedEyes;
        
        setTimeout(() => {
            favicon.href = openEyes;
        }, 150); // 150ms is the perfect speed for a natural human blink
        
    }, 4000);
}

// Start the animation!
initBlinkingFavicon();
// --- DATABASE MIGRATION SCRIPT ---
// Run this in the console to fix all old accounts missing a Short ID
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
    } catch (error) {
        console.error("Migration failed:", error);
    }
};

// --- PWA SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered!', reg))
            .catch(err => console.error('Service Worker registration failed: ', err));
    });
}