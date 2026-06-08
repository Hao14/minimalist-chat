import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, set, get, push, onValue, onChildAdded, onChildChanged, off, remove, serverTimestamp, query, limitToLast, orderByKey, endBefore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getStorage, ref as sRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

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

let currentUser = null;
let userProfileName = "Anonymous";
let userPhotoUrl = "";
let currentPmRoomId = null;
let currentPmTargetUid = null;
let pmQueryRef = null;

let typingTimeout = null;
let isTyping = false;
let activeReplyData = null;
let chatInitialized = false;
let oldestMessageKey = null;
let isFetchingHistory = false;

// --- UI SCREEN MANAGER ---
function showScreen(screenId) {
    // Hide all main screens
    document.querySelectorAll('.app-screen').forEach(screen => {
        screen.classList.add('hidden');
    });
    // Show requested screen
    const target = document.getElementById(screenId);
    if(target) target.classList.remove('hidden');
}

// --- DARK MODE LOGIC ---
if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');
document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
});

// --- MOBILE MENU LOGIC ---
document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    const menu = document.getElementById('mobile-nav-links');
    menu.classList.toggle('hidden');
});

function getAvatarUrl(name, url) {
    if (url && url.trim() !== '') return url;
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=000&color=FFD700&bold=true`;
}

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

// --- AUTH & PROFILE ---
onAuthStateChanged(auth, async (user) => {
    if (user) { 
        currentUser = user; 
        checkUserProfile(user.uid); 
    } else {
        showScreen('login-container');
        document.getElementById('messages').innerHTML = ''; 
    }
});

async function checkUserProfile(uid) {
    const snapshot = await get(ref(db, 'users/' + uid));
    if (snapshot.exists()) {
        userProfileName = snapshot.val().displayName;
        userPhotoUrl = snapshot.val().photoUrl || "";
        enterChat();
    } else { 
        showScreen('profile-setup-container'); 
    }
}

document.getElementById('save-new-profile-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-display-name').value.trim();
    const rawPhoto = document.getElementById('new-photo-url').value.trim();
    if (name) {
        const finalPhotoUrl = getAvatarUrl(name, rawPhoto);
        await set(ref(db, 'users/' + currentUser.uid), { displayName: name, photoUrl: finalPhotoUrl });
        userProfileName = name; userPhotoUrl = finalPhotoUrl;
        enterChat();
    }
});

// --- SETTINGS ---
const modal = document.getElementById('settings-modal');
const overlay = document.getElementById('modal-overlay');

function openSettings() {
    document.getElementById('edit-display-name').value = userProfileName;
    document.getElementById('edit-photo-url').value = userPhotoUrl.includes('ui-avatars.com') ? '' : userPhotoUrl;
    document.getElementById('settings-photo-preview').src = getAvatarUrl(userProfileName, userPhotoUrl);
    modal.classList.remove('hidden'); 
    overlay.classList.remove('hidden');
}

document.getElementById('close-settings-btn').addEventListener('click', () => { modal.classList.add('hidden'); overlay.classList.add('hidden'); });
document.getElementById('logout-btn').addEventListener('click', () => { modal.classList.add('hidden'); overlay.classList.add('hidden'); signOut(auth); });
document.getElementById('open-settings-btn-mobile').addEventListener('click', () => {
    document.getElementById('mobile-nav-links').classList.add('hidden');
    openSettings(); 
});

document.getElementById('update-profile-btn').addEventListener('click', async () => {
    const newName = document.getElementById('edit-display-name').value.trim();
    const newPhoto = document.getElementById('edit-photo-url').value.trim();
    if (newName) {
        const finalPhotoUrl = getAvatarUrl(newName, newPhoto);
        await set(ref(db, 'users/' + currentUser.uid), { displayName: newName, photoUrl: finalPhotoUrl });
        userProfileName = newName; userPhotoUrl = finalPhotoUrl;
        modal.classList.add('hidden'); overlay.classList.add('hidden');
    }
});

// --- MAIN ENTRY & INFINITE SCROLL ---
function enterChat() {
    showScreen('chat-wrapper');
    
    // Inject the desktop action buttons dynamically
    const desktopNavActions = document.getElementById('nav-actions');
    if(desktopNavActions) {
        desktopNavActions.innerHTML = `<button class="action-btn" id="open-contacts-btn">Contacts</button><button class="action-btn" id="open-settings-btn">Settings</button>`;
        
        document.getElementById('open-settings-btn').addEventListener('click', openSettings);
        
        document.getElementById('open-contacts-btn').addEventListener('click', () => {
            const panel = document.getElementById('contacts-panel');
            panel.classList.toggle('open');
            // If you had the real-time friend load logic here, it will still trigger
        });
    }
    
    if (!chatInitialized) {
        initializeChatMemory();
        listenForNotifications();
        chatInitialized = true;
    }
}
function initializeChatMemory() {
    const messagesRef = ref(db, 'messages');
    const messagesList = document.getElementById('messages');
    
    // Initial load of 30 messages
    const recentMessages = query(messagesRef, limitToLast(30));
    onChildAdded(recentMessages, (snapshot) => { 
        if(!oldestMessageKey) oldestMessageKey = snapshot.key; 
        displayMessage(snapshot.key, snapshot.val(), false); 
    });
    onChildChanged(recentMessages, (snapshot) => { updateMessageReactions(snapshot.key, snapshot.val()); });

    // Infinite Scroll Listener
    messagesList.addEventListener('scroll', async () => {
        if (messagesList.scrollTop === 0 && !isFetchingHistory && oldestMessageKey) {
            isFetchingHistory = true;
            document.getElementById('loading-history').classList.remove('hidden');
            
            const oldScrollHeight = messagesList.scrollHeight;
            const historyQuery = query(messagesRef, orderByKey(), endBefore(oldestMessageKey), limitToLast(20));
            
            const snapshot = await get(historyQuery);
            document.getElementById('loading-history').classList.add('hidden');
            
            if (snapshot.exists()) {
                const history = [];
                snapshot.forEach(child => { history.push({ key: child.key, val: child.val() }); });
                oldestMessageKey = history[0].key;
                
                for(let i = history.length - 1; i >= 0; i--) {
                    displayMessage(history[i].key, history[i].val(), true);
                }
                messagesList.scrollTop = messagesList.scrollHeight - oldScrollHeight;
            }
            isFetchingHistory = false;
        }
    });

    const textInput = document.getElementById('message-input');
    textInput.addEventListener('input', () => {
        if (!isTyping && textInput.value.trim().length > 0) {
            isTyping = true; set(ref(db, `typing/global/${currentUser.uid}`), userProfileName);
        }
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            isTyping = false; remove(ref(db, `typing/global/${currentUser.uid}`));
        }, 2000);
    });

    onValue(ref(db, 'typing/global'), (snapshot) => {
        const typists = [];
        snapshot.forEach(child => { if (child.key !== currentUser.uid) typists.push(child.val()); });
        const container = document.getElementById('typing-status-container');
        if (typists.length > 0) {
            document.getElementById('typing-text').textContent = typists.length === 1 ? `${typists[0]} is typing...` : `${typists.join(', ')} are typing...`;
            container.classList.remove('hidden');
        } else { container.classList.add('hidden'); }
    });

    document.getElementById('cancel-reply-btn').addEventListener('click', () => {
        activeReplyData = null; document.getElementById('active-reply-box').classList.add('hidden');
    });

    // Handle Attachments UI
    const fileInput = document.getElementById('image-input');
    const attachBtn = document.getElementById('attach-btn');
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', function() {
        if(this.files.length > 0) attachBtn.classList.add('active');
        else attachBtn.classList.remove('active');
    });

    document.getElementById('chat-form').addEventListener('submit', async function(e) {
        e.preventDefault();
        const text = textInput.value.trim(); const file = document.getElementById('image-input').files[0];
        if (!text && !file) return;

        const sendBtn = document.getElementById('send-message-btn');
        sendBtn.textContent = '...'; sendBtn.disabled = true;
        let uploadedImageUrl = null;

        try {
            if (file) {
                const fileRef = sRef(storage, `chat_images/${Date.now()}_${file.name}`);
                await uploadBytesResumable(fileRef, file);
                uploadedImageUrl = await getDownloadURL(fileRef);
            }
            const payload = { uid: currentUser.uid, name: userProfileName, photoUrl: userPhotoUrl, text: text, attachedImage: uploadedImageUrl, timestamp: serverTimestamp() };
            if (activeReplyData) payload.replyTo = activeReplyData;
            
            await set(push(messagesRef), payload);
            textInput.value = ''; document.getElementById('image-input').value = ''; attachBtn.classList.remove('active');
            document.getElementById('cancel-reply-btn').click();
        } catch (error) {} 
        finally { sendBtn.textContent = 'Send'; sendBtn.disabled = false; }
    });
}

function displayMessage(messageId, msg, prepend = false) {
    const messagesList = document.getElementById('messages');
    if(document.getElementById(`msg-${messageId}`)) return;

    const item = document.createElement('li');
    item.id = `msg-${messageId}`;
    const timeString = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    if (msg.uid === currentUser.uid) item.classList.add('my-message');

    const avatarImg = msg.photoUrl || getAvatarUrl(msg.name, "");
    const replyHTML = msg.replyTo ? `<div class="reply-quote"><span class="reply-quote-name">↩ Replying to ${msg.replyTo.name}</span>"${msg.replyTo.text}"</div>` : '';
    const attachedImgHTML = msg.attachedImage ? `<img src="${msg.attachedImage}" class="msg-attached-img">` : '';
    const textHTML = msg.text ? `<div class="msg-text">${msg.text}</div>` : '';

    item.innerHTML = `
        <div class="msg-actions">
            <span class="action-icon" onclick="reactToMessage('${messageId}', '👍')">👍</span>
            <span class="action-icon" onclick="reactToMessage('${messageId}', '❤️')">❤️</span>
            <span class="action-icon" onclick="prepareReply('${messageId}', '${msg.name}', '${msg.text ? msg.text.replace(/'/g, "\\'") : 'Image'}')">↩️</span>
        </div>
        <div class="msg-header">
            <img src="${avatarImg}" class="msg-avatar" alt="Avatar">
            <div class="header-text"><span class="msg-name">${msg.name}</span><span class="msg-time">${timeString}</span></div>
        </div>
        ${replyHTML}${attachedImgHTML}${textHTML}
        <div class="msg-reactions" id="reactions-${messageId}"></div>
    `;

    if (prepend) {
        messagesList.prepend(item);
    } else {
        messagesList.appendChild(item);
        setTimeout(() => { messagesList.scrollTo(0, messagesList.scrollHeight); }, 50);
    }
    if(msg.reactions) updateMessageReactions(messageId, msg);
}

// --- GLOBAL HELPERS ---
window.prepareReply = function(id, name, text) {
    activeReplyData = { id, name, text };
    document.getElementById('replying-to-name').textContent = name;
    document.getElementById('replying-to-text').textContent = text.length > 40 ? text.substring(0, 40) + '...' : text;
    document.getElementById('active-reply-box').classList.remove('hidden');
    document.getElementById('message-input').focus();
};

window.reactToMessage = async function(messageId, emoji) {
    await set(ref(db, `messages/${messageId}/reactions/${currentUser.uid}`), emoji);
};

function updateMessageReactions(messageId, msg) {
    const reactionContainer = document.getElementById(`reactions-${messageId}`);
    if (!reactionContainer || !msg.reactions) return;
    const counts = {};
    for (const uid in msg.reactions) counts[msg.reactions[uid]] = (counts[msg.reactions[uid]] || 0) + 1;
    reactionContainer.innerHTML = '';
    for (const emoji in counts) {
        const badge = document.createElement('div'); badge.className = 'reaction-badge';
        badge.innerHTML = `${emoji} <strong>${counts[emoji]}</strong>`; reactionContainer.appendChild(badge);
    }
}

// --- LOGIN BINDINGS ---
document.getElementById('google-login-btn').addEventListener('click', async () => { try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (error) {} });
document.getElementById('send-code-btn').addEventListener('click', async () => {
    if (!window.recaptchaVerifier) window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { 'size': 'invisible' });
    try { 
        window.confirmationResult = await signInWithPhoneNumber(auth, document.getElementById('phone-input').value, window.recaptchaVerifier); 
        document.getElementById('phone-step-1').classList.add('hidden'); 
        document.getElementById('phone-step-2').classList.remove('hidden'); 
    } catch (error) {}
});
document.getElementById('verify-code-btn').addEventListener('click', async () => { try { await window.confirmationResult.confirm(document.getElementById('code-input').value); } catch (error) {} });