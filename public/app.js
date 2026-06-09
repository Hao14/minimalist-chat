import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, set, get, push, onValue, onChildAdded, onChildChanged, off, remove, serverTimestamp, query, limitToLast, orderByKey, endBefore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getStorage, ref as sRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// --- GLOBAL CRASH REPORTER ---
// This stops silent failures. If the app breaks, it will alert you.
window.addEventListener('error', (event) => {
    alert("Script Crash: " + event.message);
});
window.addEventListener('unhandledrejection', (event) => {
    alert("Database/Network Crash: " + (event.reason.message || event.reason));
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

let currentUser = null;
let userProfileName = "Anonymous";
let userPhotoUrl = "";
let userPronouns = "";
let userBio = "";
let userThemeColor = "#FFD700";
let userShortId = "";
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
    document.querySelectorAll('.app-screen').forEach(screen => {
        screen.classList.add('hidden');
    });
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
function generateShortId() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

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
    try {
        const snapshot = await get(ref(db, 'users/' + uid));
        if (snapshot.exists()) {
            const data = snapshot.val();
            userProfileName = data.displayName || "Anonymous";
            userPhotoUrl = data.photoUrl || "";
            userPronouns = data.pronouns || "";
            userBio = data.bio || "";
            userThemeColor = data.themeColor || "#FFD700";
            
            if (!data.shortId) {
                userShortId = generateShortId();
                await set(ref(db, 'users/' + uid + '/shortId'), userShortId);
            } else {
                userShortId = data.shortId;
            }
            enterChat();
        } else { 
            showScreen('profile-setup-container'); 
        }
    } catch (error) {
        alert("Database Error loading profile: " + error.message);
    }
}

document.getElementById('save-new-profile-btn').addEventListener('click', async () => {
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
    } catch (error) {
        alert("Error saving profile: " + error.message);
    }
});

// --- SETTINGS ---
// --- SETTINGS ---
const modal = document.getElementById('settings-modal');
const overlay = document.getElementById('modal-overlay');

function openSettings() {
    document.getElementById('edit-display-name').value = userProfileName;
    document.getElementById('settings-display-name-title').textContent = userProfileName; // Updates title in card
    document.getElementById('edit-photo-url').value = userPhotoUrl.includes('ui-avatars.com') ? '' : userPhotoUrl;
    document.getElementById('edit-pronouns').value = userPronouns;
    document.getElementById('edit-bio').value = userBio;
    document.getElementById('edit-theme-color').value = userThemeColor;
    document.getElementById('settings-photo-preview').src = getAvatarUrl(userProfileName, userPhotoUrl);
    
    // Always open to the Profile tab by default
    switchTab('pane-profile', 'tab-btn-profile');
    
    modal.classList.remove('hidden'); 
    overlay.classList.remove('hidden');
}

// Tab Switching Logic
function switchTab(paneId, btnId) {
    document.getElementById('pane-profile').classList.add('hidden');
    document.getElementById('pane-app').classList.add('hidden');
    document.getElementById('tab-btn-profile').classList.remove('active');
    document.getElementById('tab-btn-app').classList.remove('active');
    
    document.getElementById(paneId).classList.remove('hidden');
    document.getElementById(btnId).classList.add('active');
}

// Tab Event Listeners
document.getElementById('tab-btn-profile').addEventListener('click', () => switchTab('pane-profile', 'tab-btn-profile'));
document.getElementById('tab-btn-app').addEventListener('click', () => switchTab('pane-app', 'tab-btn-app'));

// Close Buttons
document.getElementById('close-settings-btn').addEventListener('click', () => { modal.classList.add('hidden'); overlay.classList.add('hidden'); });
document.getElementById('logout-btn').addEventListener('click', () => { modal.classList.add('hidden'); overlay.classList.add('hidden'); signOut(auth); });
document.getElementById('open-settings-btn-mobile').addEventListener('click', () => {
    document.getElementById('mobile-nav-links').classList.add('hidden');
    openSettings(); 
});

// Save Button
document.getElementById('update-profile-btn').addEventListener('click', async () => {
    try {
        const newName = document.getElementById('edit-display-name').value.trim();
        const newPhoto = document.getElementById('edit-photo-url').value.trim();
        
        if (newName) {
            const finalPhotoUrl = getAvatarUrl(newName, newPhoto);
            userProfileName = newName; userPhotoUrl = finalPhotoUrl;
            userPronouns = document.getElementById('edit-pronouns').value.trim();
            userBio = document.getElementById('edit-bio').value.trim();
            userThemeColor = document.getElementById('edit-theme-color').value;

            await set(ref(db, 'users/' + currentUser.uid), { 
                displayName: userProfileName, 
                photoUrl: userPhotoUrl,
                pronouns: userPronouns,
                bio: userBio,
                themeColor: userThemeColor,
                shortId: userShortId 
            });
            
            modal.classList.add('hidden'); overlay.classList.add('hidden');
        }
    } catch (error) {
        alert("Error updating profile: " + error.message);
    }
});
// --- MAIN ENTRY & INFINITE SCROLL ---
function enterChat() {
    try {
        showScreen('chat-wrapper');
        
        const desktopNavActions = document.getElementById('nav-actions');
        if(desktopNavActions) {
            desktopNavActions.innerHTML = `<button class="action-btn" id="open-contacts-btn">Contacts</button><button class="action-btn" id="open-settings-btn">Settings</button>`;
            document.getElementById('open-settings-btn').addEventListener('click', openSettings);
            document.getElementById('open-contacts-btn').addEventListener('click', toggleContacts);
        }
        
        if (!chatInitialized) {
            initializeChatMemory();
            listenForNotifications();
            chatInitialized = true;
        }
    } catch (error) {
        alert("Error launching chat interface: " + error.message);
    }
}

function initializeChatMemory() {
    const messagesRef = ref(db, 'messages');
    const messagesList = document.getElementById('messages');
    
    const recentMessages = query(messagesRef, limitToLast(30));
    onChildAdded(recentMessages, (snapshot) => { 
        if(!oldestMessageKey) oldestMessageKey = snapshot.key; 
        displayMessage(snapshot.key, snapshot.val(), false); 
    });
    onChildChanged(recentMessages, (snapshot) => { updateMessageReactions(snapshot.key, snapshot.val()); });

    messagesList.addEventListener('scroll', async () => {
        if (messagesList.scrollTop === 0 && !isFetchingHistory && oldestMessageKey) {
            isFetchingHistory = true;
            document.getElementById('loading-history').classList.remove('hidden');
            
            try {
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
            } catch (err) {
                console.error("Scroll error:", err);
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

    const fileInput = document.getElementById('image-input');
    const attachBtn = document.getElementById('attach-btn');
    if (attachBtn) {
        attachBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', function() {
            if(this.files.length > 0) attachBtn.classList.add('active');
            else attachBtn.classList.remove('active');
        });
    }

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
            textInput.value = ''; document.getElementById('image-input').value = ''; 
            if(attachBtn) attachBtn.classList.remove('active');
            document.getElementById('cancel-reply-btn').click();
        } catch (error) {
            alert("Failed to send message: " + error.message);
        } finally { sendBtn.textContent = 'Send'; sendBtn.disabled = false; }
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
    try {
        await set(ref(db, `messages/${messageId}/reactions/${currentUser.uid}`), emoji);
    } catch(err) { console.error("Reaction failed", err); }
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

// --- LOGIN BINDINGS (REVERTED TO POPUP FOR STABILITY) ---
document.getElementById('google-login-btn').addEventListener('click', async () => { 
    try { 
        await signInWithPopup(auth, new GoogleAuthProvider()); 
    } catch (error) {
        alert("Google Auth Error: " + error.message);
    } 
});

document.getElementById('send-code-btn').addEventListener('click', async () => {
    try {
        if (!window.recaptchaVerifier) window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { 'size': 'invisible' });
        window.confirmationResult = await signInWithPhoneNumber(auth, document.getElementById('phone-input').value, window.recaptchaVerifier); 
        document.getElementById('phone-step-1').classList.add('hidden'); 
        document.getElementById('phone-step-2').classList.remove('hidden'); 
    } catch (error) {
        alert("SMS Failed: " + error.message);
    }
});

document.getElementById('verify-code-btn').addEventListener('click', async () => { 
    try { 
        await window.confirmationResult.confirm(document.getElementById('code-input').value); 
    } catch (error) {
        alert("Verification Error: " + error.message);
    } 
});

// --- FRIEND SYSTEM & CONTACTS ---
let friendsListenerActive = false;

function toggleContacts() {
    const panel = document.getElementById('contacts-panel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !friendsListenerActive) {
        onValue(ref(db, 'friends/' + currentUser.uid), () => { renderContactsUI(); });
        friendsListenerActive = true;
    }
}

document.getElementById('close-contacts-btn').addEventListener('click', () => {
    document.getElementById('contacts-panel').classList.remove('open');
    off(ref(db, 'friends/' + currentUser.uid));
    friendsListenerActive = false;
});

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
        list.innerHTML = '<li style="padding: 1rem; text-align: center;">Loading...</li>'; 

        const usersSnap = await get(ref(db, 'users'));
        const friendsSnap = await get(ref(db, 'friends/' + currentUser.uid));

        const allUsers = usersSnap.val() || {};
        const myFriends = friendsSnap.val() || {};

        let htmlRequests = '';
        let htmlFriends = '';
        let htmlOthers = '';

        for (const uid in allUsers) {
            if (uid === currentUser.uid) continue;

            const user = allUsers[uid];
            const status = myFriends[uid];
            const avatar = user.photoUrl || getAvatarUrl(user.displayName, "");

            const baseItem = `
                <li class="contact-item">
                    <div class="contact-info" onclick="viewUserProfile('${uid}')">
                        <img src="${avatar}" class="contact-avatar">
                        <span style="font-weight:600;">${user.displayName}</span>
                        <span class="unread-indicator" id="dot-${uid}"></span>
                    </div>
                    <div class="contact-actions">
            `;

            if (status === 'accepted') {
                htmlFriends += baseItem + `<button class="mini-btn danger" onclick="removeFriend('${uid}')" title="Remove Friend">✖</button></div></li>`;
            } else if (status === 'pending_received') {
                htmlRequests += baseItem + `<button class="mini-btn" onclick="acceptRequest('${uid}')">Accept</button><button class="mini-btn danger" onclick="removeFriend('${uid}')">Decline</button></div></li>`;
            } else if (status === 'pending_sent') {
                htmlOthers += baseItem + `<span style="font-size:0.8rem; color:#888;">Requested</span></div></li>`;
            } else {
                htmlOthers += baseItem + `<button class="mini-btn outline" onclick="sendRequest('${uid}')">Add Friend</button></div></li>`;
            }
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
    } catch (err) {
        console.error("Contacts render failed", err);
    }
}

// --- PRIVATE MESSAGING LOGIC ---
function stopNotifications() {
    clearInterval(blinkInterval);
    document.title = originalTitle;
}

function getPrivateRoomId(uid1, uid2) { return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`; }

window.openPrivateChat = function(targetUid, targetName) {
    try {
        currentPmTargetUid = targetUid;
        stopNotifications();

        const popup = document.getElementById('pm-popup');
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
    } catch(err) {
        alert("Private Message Error: " + err.message);
    }
}

document.getElementById('pm-close-btn').addEventListener('click', () => {
    document.getElementById('pm-popup').classList.add('hidden');
    if (pmQueryRef) off(pmQueryRef);
    currentPmRoomId = null; currentPmTargetUid = null;
});

document.getElementById('pm-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pmInput = document.getElementById('pm-input');
    const text = pmInput.value.trim();

    if (text && currentPmRoomId) {
        try {
            await push(ref(db, `private_messages/${currentPmRoomId}`), {
                uid: currentUser.uid, text: text, timestamp: serverTimestamp()
            });
            await set(ref(db, `inbox/${currentPmTargetUid}/${currentUser.uid}`), {
                fromName: userProfileName, timestamp: Date.now(), read: false
            });
            pmInput.value = '';
        } catch(err) {
            alert("Failed to send PM: " + err.message);
        }
    }
});

// --- USER PROFILE POPUP LOGIC ---
window.viewUserProfile = async function(targetUid) {
    try {
        const snapshot = await get(ref(db, 'users/' + targetUid));
        if (!snapshot.exists()) return;
        
        const user = snapshot.val();
        const avatar = user.photoUrl || getAvatarUrl(user.displayName, "");
        
        document.getElementById('up-avatar').src = avatar;
        document.getElementById('up-name').textContent = user.displayName;
        document.getElementById('up-pronouns').textContent = user.pronouns || "";
        document.getElementById('up-shortid').textContent = "#" + (user.shortId || "000000");
        document.getElementById('up-bio').textContent = user.bio || "No bio yet.";
        document.getElementById('up-banner').style.backgroundColor = user.themeColor || "var(--accent-color)";
        
        const msgBtn = document.getElementById('up-message-btn');
        msgBtn.onclick = () => {
            // Set up the Message Button
    const msgBtn = document.getElementById('up-message-btn');
    msgBtn.onclick = () => {
        document.getElementById('user-profile-popup').classList.add('hidden');
        document.getElementById('modal-overlay').classList.add('hidden'); // <--- ADD THIS LINE
        document.getElementById('contacts-panel').classList.remove('open');
        openPrivateChat(targetUid, user.displayName);
    };
            document.getElementById('user-profile-popup').classList.add('hidden');
            document.getElementById('contacts-panel').classList.remove('open');
            openPrivateChat(targetUid, user.displayName);
        };

        document.getElementById('user-profile-popup').classList.remove('hidden');
        document.getElementById('modal-overlay').classList.remove('hidden');
    } catch (error) {
        alert("Failed to load user profile: " + error.message);
    }
};

document.getElementById('close-profile-btn').addEventListener('click', () => {
    document.getElementById('user-profile-popup').classList.add('hidden');
    if(document.getElementById('settings-modal').classList.contains('hidden')) {
        document.getElementById('modal-overlay').classList.add('hidden');
    }
});