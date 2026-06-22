// js/chat.js
import { db, storage } from './firebase-core.js?v=30';
import { escapeHtml, renderMessageText } from './utils.js?v=30';
import { ref, set, get, push, update, remove, onValue, onDisconnect, off, serverTimestamp, query, limitToLast, orderByKey, endBefore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
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

    // Drafts + typing indicator
    messageInputObj.addEventListener('input', () => {
        if (window.activeRoomId) localStorage.setItem(`draft:${window.activeRoomId}`, messageInputObj.value);
        setTyping(messageInputObj.value.trim().length > 0);
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => setTyping(false), 3000);
    });
}

// --- TYPING INDICATOR ---
let typingTimer = null;
let typingListenerRef = null;

function setTyping(isTyping) {
    if (!window.currentUser || !window.activeRoomId) return;
    const myRef = ref(db, `typing/${window.activeRoomId}/${window.currentUser.uid}`);
    if (isTyping) {
        set(myRef, window.userProfileName || 'Someone');
        onDisconnect(myRef).remove();
    } else {
        remove(myRef);
    }
}

window.bindRoomTyping = function(roomId) {
    if (typingListenerRef) off(typingListenerRef);
    setTyping(false); // clear any stale "typing" flag from the room we just left
    typingListenerRef = ref(db, `typing/${roomId}`);
    onValue(typingListenerRef, (snap) => {
        const container = document.getElementById('typing-status-container');
        const textEl = document.getElementById('typing-text');
        if (!container) return;
        const names = Object.entries(snap.val() || {})
            .filter(([uid]) => uid !== window.currentUser.uid)
            .map(([, n]) => n);
        if (!names.length) { container.classList.add('hidden'); return; }
        if (textEl) {
            textEl.textContent = names.length === 1 ? `${names[0]} is typing...`
                : names.length === 2 ? `${names[0]} and ${names[1]} are typing...`
                : `${names.length} people are typing...`;
        }
        container.classList.remove('hidden');
    });
};

// --- DRAFTS ---
window.loadDraft = function(roomId) {
    if (messageInputObj) messageInputObj.value = localStorage.getItem(`draft:${roomId}`) || '';
};

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
            localStorage.removeItem(`draft:${window.activeRoomId}`);
            clearTimeout(typingTimer); setTyping(false);
            let uploadedImageUrl = null;
            
            if (file) {
                const LIMITS = { free: 1048576, advanced: 1073741824, pro: 8589934592 };
                if (file.size > LIMITS[window.userTier || 'free']) return window.showToast(`File too large!`);
                
                const fileRef = sRef(storage, `chat_images/${Date.now()}_${file.name}`);
                await uploadBytesResumable(fileRef, file);
                uploadedImageUrl = await getDownloadURL(fileRef);
                window.awardXP?.(window.currentUser.uid, 'creativity', 3); // sharing images builds Creativity
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

            // Notify anyone @mentioned by name in this room, and bump the sender's contribution count.
            if (text) window.notifyMentions?.(text, window.activeRoomId);
            window.bumpMessageCount?.(window.currentUser.uid);
            window.awardXP?.(window.currentUser.uid, 'technical', 2);
            window.trackQuest?.('message');

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
    if (msg.important) item.classList.add('msg-important');
    // Cache the message so message-tools (forward/bookmark/impact/thread) can read it without re-fetching.
    window.msgCache = window.msgCache || {};
    window.msgCache[messageId] = { id: messageId, ...msg };

    let timeString = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const avatarImg = msg.photoUrl || window.getAvatarUrl(msg.name, "");
    const replyHTML = msg.replyTo ? `<div class="reply-quote"><span class="reply-quote-name">↩ Replying to ${escapeHtml(msg.replyTo.name)}</span>"${escapeHtml(msg.replyTo.text)}"</div>` : '';
    const attachedImgHTML = msg.attachedImage ? `<img src="${encodeURI(msg.attachedImage)}" class="msg-attached-img">` : '';
    let badgeHTML = msg.tier === 'advanced' ? `<span class="tier-badge advanced">ADVANCED</span>` : (msg.tier === 'pro' ? `<span class="tier-badge pro">PRO</span>` : '');

    const isMine = msg.uid === window.currentUser.uid;
    const canDelete = isMine || window.currentUser.uid === window.MY_ADMIN_UID;
    const editIcon = isMine ? `<span class="action-icon edit-icon" title="Edit">✏️</span>` : '';
    const deleteIcon = canDelete ? `<span class="action-icon delete-icon" title="Delete">🗑️</span>` : '';
    const editedHTML = msg.edited ? `<span class="msg-edited" id="ed-${messageId}">(edited)</span>` : `<span class="msg-edited" id="ed-${messageId}"></span>`;

    item.innerHTML = `
        <div class="msg-actions">
            <span class="action-icon" onclick="reactToMessage('${messageId}', '👍')">👍</span>
            <span class="action-icon" onclick="reactToMessage('${messageId}', '❤️')">❤️</span>
            <span class="action-icon more-icon" onclick="toggleEmojiPicker(event, '${messageId}')" title="React">😊</span>
            <span class="action-icon reply-icon" title="Reply">↩️</span>
            <span class="action-icon msg-menu-icon" title="More actions">⋮</span>
            ${editIcon}${deleteIcon}
        </div>
        <div class="msg-header" style="cursor: context-menu;">
            <img src="${encodeURI(avatarImg)}" class="msg-avatar" alt="Avatar" onclick="viewUserProfile('${msg.uid}')">
            <div class="header-text">
                <span class="msg-name" style="cursor: pointer;" onclick="viewUserProfile('${msg.uid}')">${escapeHtml(msg.name)}</span>
                ${badgeHTML} <span class="msg-time">${timeString}</span> ${editedHTML}
                <span class="msg-flag" id="flag-${messageId}" title="Important" style="${msg.important ? '' : 'display:none;'}">⚑</span>
            </div>
        </div>
        ${replyHTML}${attachedImgHTML}<div class="msg-text" id="mt-${messageId}">${renderMessageText(msg.text || '')}</div>
        <div class="msg-reactions" id="reactions-${messageId}"></div>
    `;

    // Reply uses a listener (not inline onclick) so names/text can't break out of the markup.
    item.querySelector('.reply-icon')?.addEventListener('click', () => window.prepareReply(messageId, msg.name, msg.text || 'Image'));
    item.querySelector('.edit-icon')?.addEventListener('click', () => window.editMessage(messageId));
    item.querySelector('.delete-icon')?.addEventListener('click', () => window.deleteMessage(messageId));
    item.querySelector('.msg-menu-icon')?.addEventListener('click', (e) => window.openMsgMenu?.(e, messageId));

    item.querySelector('.msg-header')?.addEventListener('contextmenu', (e) => {
        e.preventDefault(); window.showContextMenu(e.pageX, e.pageY, msg.uid, msg.name);
    });

    if (prepend) messagesList.prepend(item);
    else { messagesList.appendChild(item); setTimeout(() => { messagesList.scrollTo(0, messagesList.scrollHeight); }, 50); }
    renderReactions(messageId, msg.reactions);
}

// Aggregate { uid: emoji } into emoji pills with counts; click a pill to toggle your own reaction.
function renderReactions(messageId, reactions) {
    const el = document.getElementById(`reactions-${messageId}`);
    if (!el) return;
    const counts = {};
    Object.entries(reactions || {}).forEach(([uid, emoji]) => {
        if (!emoji) return;
        counts[emoji] = counts[emoji] || { n: 0, mine: false };
        counts[emoji].n++;
        if (uid === window.currentUser.uid) counts[emoji].mine = true;
    });
    const entries = Object.entries(counts);
    if (!entries.length) { el.innerHTML = ''; return; }
    el.innerHTML = entries.map(([emoji, info]) =>
        `<button class="reaction-pill ${info.mine ? 'mine' : ''}" data-emoji="${escapeHtml(emoji)}">${escapeHtml(emoji)} ${info.n}</button>`).join('');
    el.querySelectorAll('.reaction-pill').forEach(b =>
        b.addEventListener('click', () => window.reactToMessage(messageId, b.dataset.emoji)));
}

// Resolve the DB ref for a message in the currently active room.
function activeMsgRef(id) {
    return window.activeRoomId === 'global'
        ? ref(db, `messages/${id}`)
        : ref(db, `rooms_data/${window.activeRoomId}/messages/${id}`);
}

// Re-render an existing message in place (used by the live "child changed" listener).
window.updateMessageEl = function(messageId, msg) {
    const mt = document.getElementById(`mt-${messageId}`);
    if (mt && !mt.querySelector('.msg-edit-area')) mt.innerHTML = renderMessageText(msg.text || '');
    const ed = document.getElementById(`ed-${messageId}`);
    if (ed) ed.textContent = msg.edited ? '(edited)' : '';
    // Importance flag can change live.
    const li = document.getElementById(`msg-${messageId}`);
    if (li) li.classList.toggle('msg-important', !!msg.important);
    const flag = document.getElementById(`flag-${messageId}`);
    if (flag) flag.style.display = msg.important ? '' : 'none';
    renderReactions(messageId, msg.reactions);
    if (window.msgCache) window.msgCache[messageId] = { id: messageId, ...msg };
};

window.editMessage = async function(messageId) {
    const mt = document.getElementById(`mt-${messageId}`);
    if (!mt || mt.querySelector('.msg-edit-area')) return;
    let current = '';
    try { const snap = await get(activeMsgRef(messageId)); current = snap.exists() ? (snap.val().text || '') : ''; } catch {}
    const prev = mt.innerHTML;
    mt.innerHTML = `
        <textarea class="msg-edit-area" rows="2"></textarea>
        <div class="msg-edit-actions">
            <button class="msg-edit-save">Save</button>
            <button class="msg-edit-cancel">Cancel</button>
        </div>`;
    const ta = mt.querySelector('.msg-edit-area');
    ta.value = current; ta.focus();
    mt.querySelector('.msg-edit-cancel').addEventListener('click', () => { mt.innerHTML = prev; });
    mt.querySelector('.msg-edit-save').addEventListener('click', async () => {
        const newText = ta.value.trim();
        if (!newText) return window.showToast('Message cannot be empty. Use delete instead.');
        try {
            await update(activeMsgRef(messageId), { text: newText, edited: true });
            // Re-render locally now (updateMessageEl skips while the edit area is open);
            // remote clients re-render via the "child changed" listener.
            mt.innerHTML = renderMessageText(newText);
            const ed = document.getElementById(`ed-${messageId}`);
            if (ed) ed.textContent = '(edited)';
        } catch (e) { window.showToast('Edit failed: ' + e.message); mt.innerHTML = prev; }
    });
};

window.deleteMessage = async function(messageId) {
    if (!confirm('Delete this message for everyone?')) return;
    try { await remove(activeMsgRef(messageId)); }
    catch (e) { window.showToast('Delete failed: ' + e.message); }
};

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
    else {
        await set(msgsRef, emoji);
        window.awardXP?.(window.currentUser.uid, 'creativity', 2);
        window.trackQuest?.('react');
    }
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
// Inline profile-card preview rendered *inside* the Settings pane (no separate popup that gets clipped).
window.renderSettingsCardPreview = async function () {
    const el = document.getElementById('settings-card-inline-preview');
    if (!el) return;
    const uid = window.currentUser.uid;
    let user = {};
    try { user = (await get(ref(db, 'users/' + uid))).val() || {}; } catch {}
    const avatar = user.photoUrl || window.getAvatarUrl(user.displayName, "");
    const bannerStyle = user.bannerUrl
        ? `background-image:url("${encodeURI(user.bannerUrl)}");background-size:cover;background-position:center;`
        : `background:${user.themeColor || 'var(--accent-color)'};`;
    el.innerHTML = `
        <div class="scp-card">
            <div class="scp-banner" style="${bannerStyle}"><img class="scp-avatar" src="${escapeHtml(avatar)}" alt=""></div>
            <div class="scp-body">
                <div class="scp-name-row">
                    <span class="profile-display-name">${escapeHtml(user.displayName || 'You')}</span>
                    ${user.pronouns ? `<span class="profile-pronouns">${escapeHtml(user.pronouns)}</span>` : ''}
                    ${user.flair ? `<span class="profile-flair">${escapeHtml(user.flair)}</span>` : ''}
                </div>
                <div><span class="profile-short-id">#${escapeHtml(user.shortId || '')}</span></div>
                ${user.status ? `<div class="profile-status">${escapeHtml(user.status)}</div>` : ''}
                <div class="profile-bio">${escapeHtml(user.bio || 'No bio yet.')}</div>
                <div class="profile-links">${window.renderProfileLinks ? window.renderProfileLinks(user.links) : ''}</div>
                <div class="profile-section-label">Skill Trees</div>
                ${window.renderSkillTree ? window.renderSkillTree(user) : ''}
                <div class="profile-badges">${window.renderBadges ? window.renderBadges(user.badges) : ''}</div>
                <div class="profile-rep"><i class="ph-bold ph-trophy"></i> ${window.computeRep ? window.computeRep(user) : 0} reputation</div>
            </div>
        </div>`;
};

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
        const upStatus = document.getElementById('up-status');
        if (upStatus) { upStatus.textContent = user.status || ""; upStatus.style.display = user.status ? "" : "none"; }
        document.getElementById('up-bio').textContent = user.bio || "No bio yet.";
        const upLinks = document.getElementById('up-links');
        if (upLinks) upLinks.innerHTML = window.renderProfileLinks ? window.renderProfileLinks(user.links) : "";
        const upFlair = document.getElementById('up-flair');
        if (upFlair) { upFlair.textContent = user.flair || ""; upFlair.style.display = user.flair ? "" : "none"; }
        // Skills + endorsements
        const upSkills = document.getElementById('up-skills');
        if (upSkills && window.renderSkills) {
            upSkills.innerHTML = window.renderSkills(user.skills);
            const selfSkills = targetUid === window.currentUser.uid;
            upSkills.querySelectorAll('.skill-endorse').forEach(b => {
                b.disabled = selfSkills;
                if (!selfSkills) b.onclick = async () => {
                    b.disabled = true;
                    const res = await window.endorseSkill(targetUid, b.dataset.skill);
                    if (res.ok) b.textContent = '+' + res.count;
                    else { b.disabled = res.reason === 'already'; if (res.reason === 'already') window.showToast('Already endorsed.'); }
                };
            });
        }
        const upTree = document.getElementById('up-skilltree');
        if (upTree && window.renderSkillTree) upTree.innerHTML = window.renderSkillTree(user);
        const upBadges = document.getElementById('up-badges');
        if (upBadges) upBadges.innerHTML = window.renderBadges ? window.renderBadges(user.badges) : "";
        const upJoined = document.getElementById('up-joined');
        if (upJoined) upJoined.textContent = "Joined: " + (user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : "Unknown");
        const upRep = document.getElementById('up-rep');
        if (upRep && window.computeRep) upRep.innerHTML = `<i class="ph-bold ph-trophy"></i> ${window.computeRep(user)} reputation`;
        const upHeat = document.getElementById('up-heatmap');
        if (upHeat && window.renderHeatmap) upHeat.innerHTML = window.renderHeatmap(user.activityByDay);
        const upAct = document.getElementById('up-activity');
        if (upAct && window.buildActivityFeed) { const feed = window.buildActivityFeed(user); upAct.innerHTML = feed || `<li class="act-empty">No activity yet.</li>`; }

        // --- Discovery & networking (Batch 5) ---
        const isMe = targetUid === window.currentUser.uid;

        // Follow button + follower/following counts
        const followBtn = document.getElementById('up-follow-btn');
        if (followBtn) {
            followBtn.style.display = isMe ? 'none' : '';
            if (!isMe && window.isFollowing) {
                const following = await window.isFollowing(targetUid);
                followBtn.textContent = following ? 'Following' : 'Follow';
                followBtn.classList.toggle('is-following', following);
                followBtn.onclick = async () => {
                    followBtn.disabled = true;
                    const now = await window.toggleFollow(targetUid);
                    followBtn.textContent = now ? 'Following' : 'Follow';
                    followBtn.classList.toggle('is-following', !!now);
                    followBtn.disabled = false;
                    if (window.getFollowCounts) { const c = await window.getFollowCounts(targetUid); document.getElementById('up-follow-stats').textContent = `${c.followers} followers · ${c.following} following`; }
                };
            }
        }
        if (window.getFollowCounts) { const c = await window.getFollowCounts(targetUid); document.getElementById('up-follow-stats').textContent = `${c.followers} followers · ${c.following} following`; }

        // Mutual rooms
        const upMutual = document.getElementById('up-mutual');
        if (upMutual) {
            if (isMe) { upMutual.style.display = 'none'; }
            else if (window.getMutualRooms) {
                const rooms = await window.getMutualRooms(targetUid);
                upMutual.style.display = rooms.length ? '' : 'none';
                if (rooms.length) upMutual.innerHTML = `<i class="ph-bold ph-door-open"></i> ${rooms.length} mutual room${rooms.length > 1 ? 's' : ''}: ${escapeHtml(rooms.slice(0, 3).join(', '))}${rooms.length > 3 ? '…' : ''}`;
            }
        }

        // AI spotlight (reset + wire)
        const spot = document.getElementById('up-spotlight');
        if (spot) spot.innerHTML = `<button id="up-spotlight-btn" class="ai-btn ai-btn-ghost"><i class="ph-bold ph-sparkle"></i> AI Spotlight</button>`;
        document.getElementById('up-spotlight-btn')?.addEventListener('click', () => window.generateSpotlight(targetUid, user));

        // Share / copy profile link
        const shareBtn = document.getElementById('up-share-btn');
        if (shareBtn) shareBtn.onclick = async () => {
            try { await navigator.clipboard.writeText(window.profileShareLink(targetUid)); window.showToast('Profile link copied!', false); }
            catch { window.showToast('Link: ' + window.profileShareLink(targetUid)); }
        };
        const upBanner = document.getElementById('up-banner');
        upBanner.style.backgroundColor = user.themeColor || "var(--accent-color)";
        if (user.bannerUrl) { upBanner.style.backgroundImage = `url("${encodeURI(user.bannerUrl)}")`; upBanner.style.backgroundSize = 'cover'; upBanner.style.backgroundPosition = 'center'; }
        else { upBanner.style.backgroundImage = 'none'; }

        // Kudos count + give-kudos button (hidden on your own profile)
        const isSelf = targetUid === window.currentUser.uid;
        document.getElementById('up-kudos-count').textContent = user.kudos || 0;
        const kudosBtn = document.getElementById('up-kudos-btn');
        if (kudosBtn) {
            kudosBtn.style.display = isSelf ? 'none' : '';
            const alreadyGave = !isSelf && user.kudosFrom && user.kudosFrom[window.currentUser.uid];
            kudosBtn.disabled = !!alreadyGave;
            kudosBtn.onclick = async () => {
                kudosBtn.disabled = true;
                const res = await window.giveKudos(targetUid);
                if (res.ok) { document.getElementById('up-kudos-count').textContent = res.count; window.showToast('Kudos sent! 👏', false); }
                else { kudosBtn.disabled = res.reason === 'already'; if (res.reason === 'already') window.showToast('You already gave kudos.'); }
            };
        }

        // Live presence dot
        try {
            const pSnap = await get(ref(db, 'presence/' + targetUid));
            const online = pSnap.exists() && pSnap.val().state === 'online';
            const dot = document.getElementById('up-presence');
            if (dot) { dot.className = 'up-presence status-dot ' + (online ? 'online' : 'offline'); dot.title = online ? 'Online' : 'Offline'; }
        } catch {}
        
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