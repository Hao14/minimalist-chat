// js/chat.js
import { db, storage } from './firebase-core.js';
import { escapeHtml } from './utils.js';
import { ref, set, get, push, remove, serverTimestamp, query, limitToLast, orderByKey, endBefore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { ref as sRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// --- CHAT MESSAGING ---
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

        // Admin Security Check
        const globalMuteSnap = await get(ref(db, `users/${window.currentUser.uid}/isMuted`));
        if (globalMuteSnap.exists() && globalMuteSnap.val() === true) return window.showToast("You have been globally muted by an Admin.");

        // Double check room mute specifically on server submit
        if (window.activeRoomId !== 'global') {
            const roomMuteSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}/muted/${window.currentUser.uid}`));
            if (roomMuteSnap.exists()) {
                if (roomMuteSnap.val() === true) return window.showToast("You are permanently muted in this room.");
                
                const timeLeft = roomMuteSnap.val() - Date.now();
                if (timeLeft > 0) {
                    return window.showToast(`You are muted for ${Math.ceil(timeLeft / 60000)} more minutes.`);
                } else {
                    // Time naturally expired, silently clean up database and allow message
                    await remove(ref(db, `rooms_meta/${window.activeRoomId}/muted/${window.currentUser.uid}`));
                }
            }
        }
        
        const text = messageInputObj ? messageInputObj.value.trim() : '';
        const imageInput = document.getElementById('image-input');
        const file = imageInput ? imageInput.files[0] : null;
        
        if (!text && !file) return;

        try {
            if(messageInputObj) { messageInputObj.value = ''; messageInputObj.rows = 1; }
            let uploadedImageUrl = null;
            
            if (file) {
                const LIMITS = { free: 1048576, advanced: 1073741824, pro: 8589934592 };
                if (file.size > LIMITS[window.userTier || 'free']) return window.showToast(`File too large!`);
                
                const fileRef = sRef(storage, `chat_images/${Date.now()}_${file.name}`);
                await uploadBytesResumable(fileRef, file);
                uploadedImageUrl = await getDownloadURL(fileRef);
            }
            
            if(imageInput) imageInput.value = ''; 
            document.getElementById('attach-btn')?.classList.remove('active');
            
            const payload = { 
                uid: window.currentUser.uid, name: window.userProfileName, photoUrl: window.userPhotoUrl, 
                text: text, attachedImage: uploadedImageUrl, timestamp: serverTimestamp(), tier: window.userTier 
            };
            if (window.activeReplyData) payload.replyTo = window.activeReplyData;
            
            const msgsRef = window.activeRoomId === 'global' ? ref(db, 'messages') : ref(db, `rooms_data/${window.activeRoomId}/messages`);
            await set(push(msgsRef), payload);

            if (window.activeRoomId !== 'global') {
                let pText = text ? `${window.userProfileName}: ${text}` : `${window.userProfileName} sent an image`;
                await set(ref(db, `rooms_meta/${window.activeRoomId}/lastMessage`), pText.length > 30 ? pText.substring(0,30)+'...' : pText);
            }
            
            if (!document.getElementById('active-reply-box').classList.contains('hidden')) document.getElementById('cancel-reply-btn').click();
        } catch (error) { window.showToast("Failed to send message: " + error.message); } 
    });
}

document.getElementById('attach-btn')?.addEventListener('click', () => document.getElementById('image-input')?.click());
document.getElementById('image-input')?.addEventListener('change', function() {
    document.getElementById('attach-btn')?.classList.toggle('active', this.files.length > 0);
});

document.getElementById('cancel-reply-btn')?.addEventListener('click', () => {
    window.activeReplyData = null; document.getElementById('active-reply-box')?.classList.add('hidden');
});
window.prepareReply = function(id, name, text) {
    window.activeReplyData = { id, name, text };
    document.getElementById('replying-to-name').textContent = name;
    document.getElementById('replying-to-text').textContent = text.length > 40 ? text.substring(0, 40) + '...' : text;
    document.getElementById('active-reply-box').classList.remove('hidden');
    document.getElementById('message-input').focus();
};

window.displayMessage = function(messageId, msg, prepend = false) {
    document.getElementById('temp-msg-loader')?.remove();

    const messagesList = document.getElementById('messages');
    if(!messagesList || document.getElementById(`msg-${messageId}`)) return;

    const item = document.createElement('li'); item.id = `msg-${messageId}`;
    if (msg.uid === window.currentUser.uid) item.classList.add('my-message');

    let timeString = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const avatarImg = msg.photoUrl || window.getAvatarUrl(msg.name, "");
    const replyHTML = msg.replyTo ? `<div class="reply-quote"><span class="reply-quote-name">↩ Replying to ${escapeHtml(msg.replyTo.name)}</span>"${escapeHtml(msg.replyTo.text)}"</div>` : '';
    const attachedImgHTML = msg.attachedImage ? `<img src="${encodeURI(msg.attachedImage)}" class="msg-attached-img">` : '';
    let badgeHTML = msg.tier === 'advanced' ? `<span class="tier-badge advanced">ADVANCED</span>` : (msg.tier === 'pro' ? `<span class="tier-badge pro">PRO</span>` : '');

    item.innerHTML = `
        <div class="msg-actions">
            <span class="action-icon" onclick="reactToMessage('${messageId}', '👍')">👍</span>
            <span class="action-icon" onclick="reactToMessage('${messageId}', '❤️')">❤️</span>
            <span class="action-icon more-icon" onclick="toggleEmojiPicker(event, '${messageId}')">⋯</span>
            <span class="action-icon reply-icon">↩️</span>
        </div>
        <div class="msg-header" style="cursor: context-menu;">
            <img src="${encodeURI(avatarImg)}" class="msg-avatar" alt="Avatar" onclick="viewUserProfile('${msg.uid}')">
            <div class="header-text">
                <span class="msg-name" style="cursor: pointer;" onclick="viewUserProfile('${msg.uid}')">${escapeHtml(msg.name)}</span>
                ${badgeHTML} <span class="msg-time">${timeString}</span>
            </div>
        </div>
        ${replyHTML}${attachedImgHTML}<div class="msg-text">${escapeHtml(msg.text || '')}</div>
        <div class="msg-reactions" id="reactions-${messageId}"></div>
    `;

    // Reply uses a listener (not inline onclick) so names/text can't break out of the markup.
    item.querySelector('.reply-icon')?.addEventListener('click', () => window.prepareReply(messageId, msg.name, msg.text || 'Image'));

    item.querySelector('.msg-header')?.addEventListener('contextmenu', (e) => {
        e.preventDefault(); window.showContextMenu(e.pageX, e.pageY, msg.uid, msg.name);
    });

    if (prepend) messagesList.prepend(item); 
    else { messagesList.appendChild(item); setTimeout(() => { messagesList.scrollTo(0, messagesList.scrollHeight); }, 50); }
}

window.bindChatScrolling = function(msgsRef) {
    const messagesList = document.getElementById('messages');
    if (!messagesList) return;
    
    const newMessagesList = messagesList.cloneNode(true);
    messagesList.parentNode.replaceChild(newMessagesList, messagesList);

    newMessagesList.addEventListener('scroll', async () => {
        if (newMessagesList.scrollTop === 0 && !window.isFetchingHistory && window.oldestMessageKey) {
            window.isFetchingHistory = true;
            document.getElementById('loading-history')?.classList.remove('hidden');
            try {
                const oldScrollHeight = newMessagesList.scrollHeight;
                const snapshot = await get(query(msgsRef, orderByKey(), endBefore(window.oldestMessageKey), limitToLast(20)));
                document.getElementById('loading-history')?.classList.add('hidden');
                
                if (snapshot.exists()) {
                    const history = [];
                    snapshot.forEach(child => { history.push({ key: child.key, val: child.val() }); });
                    window.oldestMessageKey = history[0].key;
                    for(let i = history.length - 1; i >= 0; i--) window.displayMessage(history[i].key, history[i].val(), true);
                    newMessagesList.scrollTop = newMessagesList.scrollHeight - oldScrollHeight;
                }
            } catch (err) {}
            window.isFetchingHistory = false;
        }
    });
}

window.reactToMessage = async function(messageId, emoji) {
    const msgsRef = window.activeRoomId === 'global' ? ref(db, `messages/${messageId}/reactions/${window.currentUser.uid}`) : ref(db, `rooms_data/${window.activeRoomId}/messages/${messageId}/reactions/${window.currentUser.uid}`);
    const snap = await get(msgsRef);
    if (snap.exists() && snap.val() === emoji) await remove(msgsRef);
    else await set(msgsRef, emoji);
};

window.toggleEmojiPicker = function(event, messageId) {
    window.activeMessageId = messageId;
    const picker = document.getElementById('emoji-picker');
    picker.style.top = (event.pageY + 10) + 'px'; picker.style.left = (event.pageX - 50) + 'px';
    picker.classList.remove('hidden');
    document.addEventListener('click', function hidePicker(e) {
        if (!e.target.classList.contains('more-icon')) { picker.classList.add('hidden'); document.removeEventListener('click', hidePicker); }
    }, { once: true });
};
window.addReaction = function(emoji) {
    if (window.activeMessageId) { window.reactToMessage(window.activeMessageId, emoji); document.getElementById('emoji-picker')?.classList.add('hidden'); }
};

// --- CUSTOM CONTEXT MENU (RIGHT CLICK) ---
const contextMenu = document.getElementById('custom-context-menu');

// Opens the Profile Page
window.viewUserProfile = async function(targetUid) {
    try {
        const snapshot = await get(ref(db, 'users/' + targetUid));
        if (!snapshot.exists()) return;
        
        const user = snapshot.val();
        const avatar = user.photoUrl || window.getAvatarUrl(user.displayName, "");
        
        let badgeHtml = '';
        const tier = (user.tier || "").toLowerCase();
        if (tier.includes('pro')) { badgeHtml = `<span class="tier-badge pro">PRO</span>`; } 
        else if (tier.includes('advanced')) { badgeHtml = `<span class="tier-badge advanced">ADVANCED</span>`; }

        document.getElementById('up-avatar').src = avatar;
        document.getElementById('up-name').innerHTML = `${escapeHtml(user.displayName)} ${badgeHtml}`;
        
        let displayId = user.shortId || window.generateShortId();
        document.getElementById('up-pronouns').textContent = user.pronouns || "";
        document.getElementById('up-shortid').textContent = "#" + displayId;
        document.getElementById('up-bio').textContent = user.bio || "No bio yet.";
        document.getElementById('up-banner').style.backgroundColor = user.themeColor || "var(--accent-color)";
        
        const msgBtn = document.getElementById('up-message-btn');
        if(msgBtn) {
            msgBtn.onclick = () => {
                document.getElementById('user-profile-popup').classList.add('hidden');
                document.getElementById('modal-overlay').classList.add('hidden'); 
                document.getElementById('contacts-panel').classList.remove('open');
                window.openPrivateChat(targetUid, user.displayName);
            };
        }
        
        document.getElementById('user-profile-popup').classList.remove('hidden');
        document.getElementById('modal-overlay').classList.remove('hidden');
        document.getElementById('profile-more-dropdown')?.classList.add('hidden'); 
    } catch (error) { window.showToast("Failed to load user profile: " + error.message); }
};

// Opens the Right Click Menu
window.showContextMenu = async function(x, y, uid, name) {
    if (uid === window.currentUser.uid) return; 
    window.contextTargetUid = uid; window.contextTargetName = name;
    
    const friendSnap = await get(ref(db, `friends/${window.currentUser.uid}/${uid}`));
    const ctxFriendBtn = document.getElementById('ctx-friend-btn');
    if (ctxFriendBtn) {
        if (friendSnap.exists() && friendSnap.val() === 'accepted') { ctxFriendBtn.textContent = 'Remove Friend'; ctxFriendBtn.style.color = 'red'; } 
        else { ctxFriendBtn.textContent = 'Add Friend'; ctxFriendBtn.style.color = 'inherit'; }
    }

    const ctxMuteBtn = document.getElementById('ctx-mute-btn');
    if (ctxMuteBtn) {
        let isCreator = false;
        if (window.activeRoomId !== 'global') {
            const roomSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}/creatorId`));
            if (roomSnap.exists() && roomSnap.val() === window.currentUser.uid) isCreator = true;
        }
        if (isCreator || (window.currentUser.uid === window.MY_ADMIN_UID && window.activeRoomId === 'global')) {
            ctxMuteBtn.style.display = 'block';
            const muteSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}/muted/${uid}`));
            const isMuted = muteSnap.exists() && muteSnap.val() > Date.now();
            ctxMuteBtn.textContent = isMuted ? 'Unmute User' : 'Mute User';
            ctxMuteBtn.style.color = isMuted ? 'red' : 'inherit';
        } else { ctxMuteBtn.style.display = 'none'; }
    }

    if (contextMenu) {
        let posX = x; let posY = y;
        if (posX + 160 > window.innerWidth) posX -= 160;
        if (posY + 160 > window.innerHeight) posY -= 160;
        contextMenu.style.left = `${posX}px`; contextMenu.style.top = `${posY}px`;
        contextMenu.classList.remove('hidden');
    }
};

document.addEventListener('click', () => contextMenu?.classList.add('hidden'));

document.getElementById('ctx-copy-btn')?.addEventListener('click', () => {
    if (window.contextTargetUid) { navigator.clipboard.writeText(window.contextTargetUid); window.showToast("User ID copied!", false); }
});

document.getElementById('ctx-friend-btn')?.addEventListener('click', async () => {
    if (!window.contextTargetUid) return;
    if (document.getElementById('ctx-friend-btn').textContent === 'Remove Friend') {
        await window.removeFriend(window.contextTargetUid); window.showToast(`${window.contextTargetName} removed from friends.`, false);
    } else {
        await window.sendRequest(window.contextTargetUid); window.showToast(`Friend request sent to ${window.contextTargetName}!`, false);
    }
});

// Checks if we should open the Mute Duration Modal, or just instantly Unmute
document.getElementById('ctx-mute-btn')?.addEventListener('click', async () => {
    if (!window.contextTargetUid) return;
    const muteRef = ref(db, `rooms_meta/${window.activeRoomId}/muted/${window.contextTargetUid}`);
    const muteSnap = await get(muteRef);
    
    if (muteSnap.exists() && muteSnap.val() > Date.now()) { 
        await remove(muteRef); 
        window.showToast(`Unmuted ${window.contextTargetName} in this room.`, false); 
    } else { 
        // Open the duration modal instead of a simple toggle!
        window.muteTargetUid = window.contextTargetUid;
        window.muteTargetName = window.contextTargetName;
        const modalTargetName = document.getElementById('mute-target-name');
        if(modalTargetName) modalTargetName.textContent = window.contextTargetName;
        document.getElementById('mute-user-modal')?.classList.remove('hidden');
    }
    contextMenu?.classList.add('hidden');
});