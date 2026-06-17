// js/rooms.js
import { db } from './firebase-core.js';
import { ref, set, get, push, onValue, onChildAdded, off, remove, serverTimestamp, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

window.initializeRooms = function() {
    const roomsMetaRef = ref(db, 'rooms_meta');
    onValue(roomsMetaRef, (snapshot) => {
        const roomListEl = document.getElementById('room-list');
        if(!roomListEl) return;
        roomListEl.innerHTML = '';
        
        let rooms = [];
        snapshot.forEach(child => {
            const data = child.val();
            if (!data.shortId) {
                data.shortId = window.generateShortId();
                set(ref(db, `rooms_meta/${child.key}/shortId`), data.shortId);
            }
            if ((data.members && data.members[window.currentUser.uid]) || data.creatorId === window.currentUser.uid) {
                rooms.push({ id: child.key, ...data });
            }
        });
        
        if (!rooms.find(r => r.id === 'global')) {
            rooms.unshift({ id: 'global', name: 'Global Chat', lastMessage: 'Welcome to the server.', shortId: 'GLOBAL' });
        }

        rooms.forEach(room => {
            const li = document.createElement('li');
            li.className = `room-item ${room.id === window.activeRoomId ? 'active' : ''}`;
            li.innerHTML = `<span class="room-name">${room.name}</span><span class="room-preview">${room.lastMessage || 'No messages yet...'}</span>`;
            li.onclick = () => window.switchRoom(room.id, room.name, room.shortId);
            roomListEl.appendChild(li);
        });
    });
    window.switchRoom('global', 'Global Chat', 'GLOBAL');
};

window.switchRoom = function(roomId, roomName, shortId = '') {
    window.activeRoomId = roomId;
    window.activeRoomShortId = shortId || roomId;
    
    document.getElementById('active-room-name-display').textContent = roomName;
    const msgInput = document.getElementById('message-input');
    if (msgInput) {
        msgInput.placeholder = `Message ${roomName}...`;
        msgInput.disabled = false;
    }
    document.getElementById('messages').innerHTML = ''; 
    
    const roomTag = document.getElementById('active-room-tag');
    const inviteBtn = document.getElementById('room-drop-invite');
    
    // --- LIVE MUTE CHECKER & COUNTDOWN ---
    if (window.currentMuteListenerRef) off(window.currentMuteListenerRef);
    clearTimeout(window.currentMuteTimeout);

    if (roomId === 'global') {
        if(roomTag) { roomTag.textContent = 'PUBLIC'; roomTag.className = 'tier-badge advanced'; }
        if(inviteBtn) inviteBtn.style.display = 'none'; 
        
        window.currentMuteListenerRef = ref(db, `users/${window.currentUser.uid}/isMuted`);
        onValue(window.currentMuteListenerRef, (snap) => {
            if (snap.exists() && snap.val() === true && msgInput) {
                msgInput.disabled = true; msgInput.placeholder = "You are globally muted.";
            } else if (msgInput) {
                msgInput.disabled = false; msgInput.placeholder = `Message ${roomName}...`;
            }
        });
    } else {
        if(roomTag) { roomTag.textContent = 'PRIVATE'; roomTag.className = 'tier-badge pro'; }
        if(inviteBtn) inviteBtn.style.display = 'block'; 
        
        window.currentMuteListenerRef = ref(db, `rooms_meta/${roomId}/muted/${window.currentUser.uid}`);
        onValue(window.currentMuteListenerRef, (snap) => {
            clearTimeout(window.currentMuteTimeout);
            if (snap.exists() && snap.val() !== true) { // New Timestamp format
                const unmuteTime = snap.val();
                const timeLeft = unmuteTime - Date.now();
                
                if (timeLeft > 0) {
                    if (msgInput) {
                        msgInput.disabled = true;
                        msgInput.placeholder = `Muted. Unmutes in ${Math.ceil(timeLeft / 60000)}m...`;
                    }
                    // Auto-unlock when time expires!
                    window.currentMuteTimeout = setTimeout(() => {
                        if (msgInput) { msgInput.disabled = false; msgInput.placeholder = `Message ${roomName}...`; }
                        remove(ref(db, `rooms_meta/${roomId}/muted/${window.currentUser.uid}`));
                    }, timeLeft);
                } else {
                    // Time passed while offline
                    if (msgInput) { msgInput.disabled = false; msgInput.placeholder = `Message ${roomName}...`; }
                    remove(ref(db, `rooms_meta/${roomId}/muted/${window.currentUser.uid}`));
                }
            } else if (snap.exists() && snap.val() === true) { // Old True/False format
                if (msgInput) { msgInput.disabled = true; msgInput.placeholder = "You are permanently muted in this room."; }
            } else {
                if (msgInput) { msgInput.disabled = false; msgInput.placeholder = `Message ${roomName}...`; }
            }
        });
    }

    window.oldestMessageKey = null;
    window.isFetchingHistory = false;
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    const sidebar = document.getElementById('desktop-room-sidebar');
    if (sidebar) sidebar.classList.remove('open');

    if (window.currentRoomListener) off(window.currentRoomListener);
    
    const msgsRef = roomId === 'global' ? ref(db, 'messages') : ref(db, `rooms_data/${roomId}/messages`);
    window.currentRoomListener = query(msgsRef, limitToLast(30));
    
    onChildAdded(window.currentRoomListener, (snapshot) => { 
        if(!window.oldestMessageKey) window.oldestMessageKey = snapshot.key; 
        if(window.displayMessage) window.displayMessage(snapshot.key, snapshot.val(), false); 
    });
    if (window.bindChatScrolling) window.bindChatScrolling(msgsRef);
};

// --- CREATE & JOIN ROOM LOGIC ---
let currentRoomActionMode = 'join'; 
const roomActionModal = document.getElementById('room-action-modal');

document.getElementById('create-room-btn')?.addEventListener('click', () => {
    currentRoomActionMode = 'create';
    document.getElementById('room-action-title').textContent = "Create New Room";
    document.getElementById('room-action-label').textContent = "ROOM NAME";
    document.getElementById('room-action-input').placeholder = "Enter a name...";
    document.getElementById('room-action-input').value = "";
    document.getElementById('room-action-submit').textContent = "Create";
    if(roomActionModal) roomActionModal.classList.remove('hidden');
});

document.getElementById('join-room-btn')?.addEventListener('click', () => {
    currentRoomActionMode = 'join';
    document.getElementById('room-action-title').textContent = "Join Room";
    document.getElementById('room-action-label').textContent = "INVITE LINK OR CODE";
    document.getElementById('room-action-input').placeholder = "Paste full link or code...";
    document.getElementById('room-action-input').value = "";
    document.getElementById('room-action-submit').textContent = "Join";
    if(roomActionModal) roomActionModal.classList.remove('hidden');
});

document.getElementById('close-room-action-btn')?.addEventListener('click', () => {
    if(roomActionModal) roomActionModal.classList.add('hidden');
});

document.getElementById('room-action-submit')?.addEventListener('click', async () => {
    const inputEl = document.getElementById('room-action-input');
    let rawVal = inputEl.value.trim().toUpperCase(); 
    if (!rawVal) return window.showToast("Input cannot be empty!");

    let val = rawVal.includes('/JOIN/') ? rawVal.split('/JOIN/').pop().replace(/[^A-Z0-9-]/g, '') : (rawVal.startsWith('#') ? rawVal.substring(1) : rawVal);

    if (currentRoomActionMode === 'create') {
        const newRoomRef = push(ref(db, 'rooms_meta'));
        const newShortId = window.generateShortId();
        await set(newRoomRef, { 
            name: val, lastMessage: 'Room created.', shortId: newShortId, creatorId: window.currentUser.uid, createdAt: serverTimestamp(),
            members: { [window.currentUser.uid]: window.userProfileName },
            logs: { [Date.now()]: { text: `${window.userProfileName} created the room.`, timestamp: Date.now() } }
        });
        if(roomActionModal) roomActionModal.classList.add('hidden');
        window.switchRoom(newRoomRef.key, val, newShortId);
        window.showToast(`Room created! Invite: #${newShortId}-${window.userShortId}`, false);
    } else {
        try {
            let targetShortId = val.includes('-') ? val.split('-')[0] : val;
            let inviterId = val.includes('-') ? val.split('-')[1] : null;

            const snapshot = await get(ref(db, 'rooms_meta'));
            let foundRoom = null;
            snapshot.forEach(child => {
                if (child.val().shortId === targetShortId || child.key === targetShortId) foundRoom = { key: child.key, ...child.val() };
            });

            if (foundRoom) {
                await set(ref(db, `rooms_meta/${foundRoom.key}/members/${window.currentUser.uid}`), window.userProfileName);
                let logText = inviterId ? `${window.userProfileName} joined via invite link from user #${inviterId}.` : `${window.userProfileName} joined the room.`;
                await set(ref(db, `rooms_meta/${foundRoom.key}/logs/${Date.now()}`), { text: logText, timestamp: Date.now() });
                if(roomActionModal) roomActionModal.classList.add('hidden');
                window.switchRoom(foundRoom.key, foundRoom.name, foundRoom.shortId);
                window.showToast("Joined room successfully!", false);
            } else { window.showToast("Room ID not found. Check for typos!"); }
        } catch (e) { window.showToast("Error joining room: " + e.message); }
    }
});

// --- ROOM SETTINGS & MODERATION ---
const roomDropdown = document.getElementById('room-settings-dropdown');
document.getElementById('room-name-wrapper')?.addEventListener('click', (e) => {
    e.stopPropagation(); roomDropdown?.classList.toggle('hidden');
});
document.addEventListener('click', () => roomDropdown?.classList.add('hidden'));

document.getElementById('room-drop-invite')?.addEventListener('click', () => {
    if (window.activeRoomShortId === 'GLOBAL') return;
    const inviteLink = `${window.location.origin}/join/${window.activeRoomShortId}-${window.userShortId}`;
    navigator.clipboard.writeText(inviteLink);
    window.showToast(`Invite Link copied!`, false);
});

document.getElementById('room-drop-settings')?.addEventListener('click', async () => {
    if (window.activeRoomId === 'global') return window.showToast("Settings not available for Global Chat.", true);
    document.getElementById('room-settings-dropdown')?.classList.add('hidden');
    document.getElementById('room-settings-modal')?.classList.remove('hidden');
    
    const roomSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}`));
    if (roomSnap.exists()) {
        const data = roomSnap.val();
        const isCreator = data.creatorId === window.currentUser.uid || (!data.creatorId && Object.keys(data.members || {})[0] === window.currentUser.uid);
        
        document.getElementById('rs-delete-room-btn')?.classList.toggle('hidden', !isCreator);
        document.getElementById('rs-leave-room-btn')?.classList.toggle('hidden', isCreator);
        
        const memList = document.getElementById('rs-members-list');
        if (memList) {
            memList.innerHTML = '';
            if (data.members) {
                for (let uid in data.members) {
                    let kickBtnHtml = (isCreator && uid !== window.currentUser.uid) ? `<button class="mini-btn danger kick-user-btn" data-uid="${uid}" data-name="${data.members[uid]}" style="padding: 0.2rem 0.6rem; margin: 0; width: auto; font-size: 0.75rem;">Kick</button>` : '';
                    memList.innerHTML += `<li style="padding: 0.8rem; border: 3px solid var(--text-color); border-radius: 8px; font-weight: bold; font-size: 0.95rem; display: flex; justify-content: space-between; align-items: center;"><span>👤 ${data.members[uid]}</span>${kickBtnHtml}</li>`;
                }
                setTimeout(() => {
                    document.querySelectorAll('.kick-user-btn').forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            const targetUid = e.target.getAttribute('data-uid');
                            const targetName = e.target.getAttribute('data-name');
                            if (confirm(`Kick ${targetName} from the room?`)) {
                                await remove(ref(db, `rooms_meta/${window.activeRoomId}/members/${targetUid}`));
                                await set(ref(db, `rooms_meta/${window.activeRoomId}/logs/${Date.now()}`), { text: `${window.userProfileName} kicked ${targetName}.`, timestamp: Date.now() });
                                window.showToast(`${targetName} was kicked.`, false);
                                document.getElementById('room-drop-settings').click(); 
                            }
                        });
                    });
                }, 50);
            } else { memList.innerHTML = '<li style="color: #888;">No members found.</li>'; }
        }
        
        if(document.getElementById('rs-webhook-input')) document.getElementById('rs-webhook-input').value = data.webhook || '';
        
        const logList = document.getElementById('rs-logs-list');
        if (logList) {
            logList.innerHTML = '';
            if (data.logs) {
                Object.values(data.logs).sort((a,b) => b.timestamp - a.timestamp).forEach(l => {
                    let d = new Date(l.timestamp);
                    logList.innerHTML += `<li style="padding: 0.8rem; background: rgba(0,0,0,0.05); border-left: 4px solid var(--accent-color); font-family: monospace; font-size: 0.85rem; font-weight: 600;">[${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}]<br>${l.text}</li>`;
                });
            } else { logList.innerHTML = '<li style="color: #888;">No logs found.</li>'; }
        }
    }
});

// Settings Tabs
const rsTabs = ['members', 'webhooks', 'logs'];
rsTabs.forEach(tab => {
    const btn = document.getElementById(`rs-tab-${tab}`);
    if(btn) {
        btn.onclick = () => {
            rsTabs.forEach(t => { document.getElementById(`rs-tab-${t}`).classList.remove('active'); document.getElementById(`rs-pane-${t}`).classList.add('hidden'); });
            btn.classList.add('active'); document.getElementById(`rs-pane-${tab}`).classList.remove('hidden');
        };
    }
});

document.getElementById('close-room-settings-btn')?.addEventListener('click', () => document.getElementById('room-settings-modal')?.classList.add('hidden'));
document.getElementById('rs-save-webhook')?.addEventListener('click', async () => {
    await set(ref(db, `rooms_meta/${window.activeRoomId}/webhook`), document.getElementById('rs-webhook-input').value.trim());
    window.showToast("Webhook integration saved!", false);
});

// Leave / Delete Modals
document.getElementById('rs-leave-room-btn')?.addEventListener('click', () => document.getElementById('leave-room-modal')?.classList.remove('hidden'));
document.getElementById('cancel-leave-btn')?.addEventListener('click', () => document.getElementById('leave-room-modal')?.classList.add('hidden'));
document.getElementById('confirm-leave-btn')?.addEventListener('click', async () => {
    document.getElementById('leave-room-modal')?.classList.add('hidden');
    try {
        const roomIdToLeave = window.activeRoomId;
        document.getElementById('room-settings-modal')?.classList.add('hidden');
        window.switchRoom('global', 'Global Chat', 'GLOBAL');
        await remove(ref(db, `rooms_meta/${roomIdToLeave}/members/${window.currentUser.uid}`));
        await set(ref(db, `rooms_meta/${roomIdToLeave}/logs/${Date.now()}`), { text: `${window.userProfileName} left the room.`, timestamp: Date.now() });
        window.showToast("You left the room.", false);
    } catch (e) { window.showToast("Error leaving room: " + e.message); }
});

document.getElementById('rs-delete-room-btn')?.addEventListener('click', () => {
    if(document.getElementById('delete-room-input')) document.getElementById('delete-room-input').value = ''; 
    document.getElementById('delete-room-modal')?.classList.remove('hidden');
});
document.getElementById('cancel-delete-btn')?.addEventListener('click', () => document.getElementById('delete-room-modal')?.classList.add('hidden'));
document.getElementById('confirm-delete-btn')?.addEventListener('click', async () => {
    const delInput = document.getElementById('delete-room-input');
    if (delInput && delInput.value.trim().toLowerCase() === 'confirm') {
        document.getElementById('delete-room-modal')?.classList.add('hidden');
        try {
            const roomIdToDelete = window.activeRoomId;
            document.getElementById('room-settings-modal')?.classList.add('hidden');
            window.switchRoom('global', 'Global Chat', 'GLOBAL');
            await remove(ref(db, `rooms_meta/${roomIdToDelete}`));
            await remove(ref(db, `rooms_data/${roomIdToDelete}`));
            window.showToast("Room deleted successfully.", false);
        } catch (e) { window.showToast("Error deleting room: " + e.message); }
    } else { window.showToast("You must type 'confirm' exactly."); }
});

// --- NEW TIMED MUTE UI LOGIC ---
let selectedMuteTime = 0;
document.querySelectorAll('.mute-duration-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.mute-duration-btn').forEach(b => b.classList.remove('active', 'btn-dark'));
        e.target.classList.add('active', 'btn-dark');
        selectedMuteTime = parseInt(e.target.getAttribute('data-time'));
        const customInput = document.getElementById('mute-custom-time');
        if(customInput) customInput.value = '';
    });
});

document.getElementById('mute-custom-time')?.addEventListener('input', (e) => {
    document.querySelectorAll('.mute-duration-btn').forEach(b => b.classList.remove('active', 'btn-dark'));
    selectedMuteTime = parseInt(e.target.value) || 0;
});

document.getElementById('cancel-mute-btn')?.addEventListener('click', () => {
    document.getElementById('mute-user-modal')?.classList.add('hidden');
});

document.getElementById('confirm-mute-btn')?.addEventListener('click', async () => {
    if (selectedMuteTime <= 0) return window.showToast("Select a valid mute duration!");
    if (!window.muteTargetUid) return;

    const unmuteTime = Date.now() + (selectedMuteTime * 60 * 1000);
    
    try {
        await set(ref(db, `rooms_meta/${window.activeRoomId}/muted/${window.muteTargetUid}`), unmuteTime);
        window.showToast(`${window.muteTargetName} has been muted for ${selectedMuteTime} minutes.`, false);
        document.getElementById('mute-user-modal').classList.add('hidden');
    } catch (err) {
        window.showToast("Failed to mute user: " + err.message);
    }
});

// --- CONTACTS & FRIENDS ---
window.toggleContacts = function() {
    const panel = document.getElementById('contacts-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
        onValue(ref(db, 'friends/' + window.currentUser.uid), window.renderContactsUI);
        onValue(ref(db, 'presence'), window.renderContactsUI); 
    }
}
document.getElementById('close-contacts-btn')?.addEventListener('click', () => {
    document.getElementById('contacts-panel')?.classList.remove('open');
    off(ref(db, 'friends/' + window.currentUser.uid)); off(ref(db, 'presence')); 
});

window.sendRequest = async (targetUid) => { await set(ref(db, `friends/${window.currentUser.uid}/${targetUid}`), 'pending_sent'); await set(ref(db, `friends/${targetUid}/${window.currentUser.uid}`), 'pending_received'); };
window.acceptRequest = async (targetUid) => { await set(ref(db, `friends/${window.currentUser.uid}/${targetUid}`), 'accepted'); await set(ref(db, `friends/${targetUid}/${window.currentUser.uid}`), 'accepted'); };
window.removeFriend = async (targetUid) => { await remove(ref(db, `friends/${window.currentUser.uid}/${targetUid}`)); await remove(ref(db, `friends/${targetUid}/${window.currentUser.uid}`)); };

window.renderContactsUI = async function() {
    try {
        const list = document.getElementById('contacts-list');
        if(!list) return;

        const usersSnap = await get(ref(db, 'users'));
        const friendsSnap = await get(ref(db, 'friends/' + window.currentUser.uid));
        const presenceSnap = await get(ref(db, 'presence'));

        const allUsers = usersSnap.val() || {}; const myFriends = friendsSnap.val() || {}; const presenceData = presenceSnap.val() || {}; 
        let htmlRequests = '', htmlFriends = '', htmlOthers = '';

        for (const uid in allUsers) {
            if (uid === window.currentUser.uid) continue;
            const user = allUsers[uid]; const status = myFriends[uid];
            const avatar = user.photoUrl || window.getAvatarUrl(user.displayName, "");
            const statusClass = (presenceData[uid] && presenceData[uid].state === 'online') ? 'online' : 'offline';

            const baseItem = `<li class="contact-item"><div class="contact-info"><div class="avatar-wrapper" onclick="viewUserProfile('${uid}')" style="cursor: pointer;" title="View Profile"><img src="${avatar}" class="contact-avatar"><div class="status-dot ${statusClass}"></div></div><span style="font-weight:600;">${user.displayName}</span><span class="unread-indicator" id="dot-${uid}"></span></div><div class="contact-actions">`;
            
            if (status === 'accepted') htmlFriends += baseItem + `<button class="contact-icon-btn" onclick="openPrivateChat('${uid}', '${user.displayName.replace(/'/g, "\\'")}')" title="Message"><i class="ph-bold ph-chat-circle-text"></i></button><button class="contact-icon-btn" onclick="viewUserProfile('${uid}')" title="More Options"><i class="ph-bold ph-dots-three-vertical"></i></button></div></li>`; 
            else if (status === 'pending_received') htmlRequests += baseItem + `<button class="mini-btn" onclick="acceptRequest('${uid}')">Accept</button><button class="mini-btn danger" onclick="removeFriend('${uid}')">Decline</button></div></li>`;
            else if (status === 'pending_sent') htmlOthers += baseItem + `<span style="font-size:0.8rem; color:#888;">Requested</span></div></li>`;
            else htmlOthers += baseItem + `<button class="mini-btn outline" onclick="sendRequest('${uid}')">Add</button></div></li>`;
        }
        list.innerHTML = '';
        if (htmlRequests) list.innerHTML += `<li class="section-title">Friend Requests</li>` + htmlRequests;
        if (htmlFriends) list.innerHTML += `<li class="section-title">My Friends</li>` + htmlFriends;
        if (htmlOthers) list.innerHTML += `<li class="section-title">People in Room</li>` + htmlOthers;
    } catch (err) { console.error("Contacts render failed", err); }
};

window.openPrivateChat = function(targetUid, targetName) {
    window.currentPmTargetUid = targetUid;
    document.getElementById('pm-target-name').textContent = targetName;
    document.getElementById('pm-messages').innerHTML = '';
    window.currentPmRoomId = window.currentUser.uid < targetUid ? `${window.currentUser.uid}_${targetUid}` : `${targetUid}_${window.currentUser.uid}`;
    
    if (window.pmQueryRef) off(window.pmQueryRef);
    set(ref(db, `inbox/${window.currentUser.uid}/${targetUid}/read`), true);

    window.pmQueryRef = query(ref(db, `private_messages/${window.currentPmRoomId}`), limitToLast(30));
    onChildAdded(window.pmQueryRef, (snapshot) => {
        const msg = snapshot.val();
        const pmList = document.getElementById('pm-messages');
        const item = document.createElement('li');
        item.classList.add(msg.uid === window.currentUser.uid ? 'my-pm' : 'their-pm');
        item.textContent = msg.text;
        pmList.appendChild(item);
        pmList.scrollTo(0, pmList.scrollHeight);
    });
    document.getElementById('pm-popup')?.classList.remove('hidden');
}

document.getElementById('pm-close-btn')?.addEventListener('click', () => {
    document.getElementById('pm-popup').classList.add('hidden');
    if (window.pmQueryRef) off(window.pmQueryRef);
    window.currentPmRoomId = null; window.currentPmTargetUid = null;
});

document.getElementById('pm-form')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const pmInput = document.getElementById('pm-input'); const text = pmInput.value.trim();
    if (text && window.currentPmRoomId) {
        await push(ref(db, `private_messages/${window.currentPmRoomId}`), { uid: window.currentUser.uid, text: text, timestamp: serverTimestamp() });
        await set(ref(db, `inbox/${window.currentPmTargetUid}/${window.currentUser.uid}`), { fromName: window.userProfileName, timestamp: Date.now(), read: false });
        pmInput.value = '';
    }
});