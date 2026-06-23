// js/rooms.js
import { db, storage } from '../../lib/firebase.js';
import { escapeHtml } from '../../lib/text.js';
import { ref, set, get, push, remove, serverTimestamp } from 'firebase/database';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { mountChatCore, switchChatRoom } from '../chat-core/mountChatCore.js';

window.initializeRooms = function() {
    mountChatCore({ user: window.currentUser });
    switchChatRoom(window.activeRoomId || 'global', 'Global Chat', 'GLOBAL');

    if (window.innerWidth <= 768) {
        document.getElementById('desktop-room-sidebar')?.classList.add('open');
    }
};
window.switchRoom = switchChatRoom;

// --- CREATE & JOIN ROOM LOGIC ---
let currentRoomActionMode = 'join'; 
const roomActionModal = document.getElementById('room-action-modal');
const ROOM_PICTURE_MAX_BYTES = 5 * 1024 * 1024;

function roomInitials(name) {
    return String(name || 'Room')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part[0] || '')
        .join('')
        .toUpperCase() || 'R';
}

function renderRoomPicturePreview(url, name) {
    const preview = document.getElementById('rs-room-picture-preview');
    if (!preview) return;

    if (url) {
        preview.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
        return;
    }

    preview.innerHTML = `<span>${escapeHtml(roomInitials(name))}</span>`;
}

function setRoomPictureBusy(isBusy) {
    const saveBtn = document.getElementById('rs-save-room-picture-btn');
    const removeBtn = document.getElementById('rs-remove-room-picture-btn');
    const input = document.getElementById('rs-room-picture-input');
    if (saveBtn) {
        saveBtn.disabled = isBusy;
        saveBtn.textContent = isBusy ? 'Saving…' : 'Save Picture';
    }
    if (removeBtn) removeBtn.disabled = isBusy;
    if (input) input.disabled = isBusy;
}

function roomCreationLimitForTier(tier) {
    if (tier === 'pro') return Infinity;
    if (tier === 'advanced') return 5;
    return 3;
}

async function canCreateAnotherRoom() {
    const tier = String(window.userTier || 'free').toLowerCase();
    const limit = roomCreationLimitForTier(tier);
    if (!Number.isFinite(limit) || window.currentUser?.uid === window.MY_ADMIN_UID) return true;

    const snapshot = await get(ref(db, 'rooms_meta'));
    let created = 0;
    snapshot.forEach(child => {
        if (child.key !== 'global' && child.val()?.creatorId === window.currentUser?.uid) created += 1;
    });

    if (created >= limit) {
        const label = tier === 'advanced' ? 'Advanced' : 'Base';
        window.showToast(`${label} can create up to ${limit} rooms. Upgrade to Pro for unlimited rooms.`);
        return false;
    }
    return true;
}

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
        if (!(await canCreateAnotherRoom())) return;
        const newRoomRef = push(ref(db, 'rooms_meta'));
        const newShortId = window.generateShortId();
        await set(newRoomRef, { 
            name: val, lastMessage: 'Room created.', shortId: newShortId, creatorId: window.currentUser.uid, createdAt: serverTimestamp(),
            members: { [window.currentUser.uid]: window.userProfileName },
            logs: { [Date.now()]: { text: `${window.userProfileName} created the room.`, timestamp: Date.now() } }
        });
        if(roomActionModal) roomActionModal.classList.add('hidden');
        if (window.awardBadge) window.awardBadge(window.currentUser.uid, 'founder');
        window.awardXP?.(window.currentUser.uid, 'leadership', 30);
        window.trackQuest?.('room');
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
                
                // NEW: Send notification to the room's creator!
                if (window.createNotification && foundRoom.creatorId) window.createNotification(foundRoom.creatorId, 'room', `${window.userProfileName || 'Someone'} joined your room!`);
                
                if(roomActionModal) roomActionModal.classList.add('hidden');
                window.switchRoom(foundRoom.key, foundRoom.name, foundRoom.shortId);
                window.showToast("Joined room successfully!", false);
            }
             else { window.showToast("Room ID not found. Check for typos!"); }
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

        const pictureInput = document.getElementById('rs-room-picture-input');
        if (pictureInput) pictureInput.value = '';
        renderRoomPicturePreview(data.photoUrl || '', data.name);

        const pictureHelp = document.getElementById('rs-room-picture-help');
        if (pictureHelp) {
            pictureHelp.textContent = isCreator
                ? 'Upload a square image for the collapsed room rail. Images can be up to 5MB.'
                : 'Only the room creator can change this room picture.';
        }

        document.getElementById('rs-save-room-picture-btn')?.toggleAttribute('disabled', !isCreator);
        document.getElementById('rs-remove-room-picture-btn')?.toggleAttribute('disabled', !isCreator || !data.photoUrl);
        pictureInput?.toggleAttribute('disabled', !isCreator);
        
        const memList = document.getElementById('rs-members-list');
        if (memList) {
            memList.innerHTML = '';
            if (data.members) {
                for (let uid in data.members) {
                    let kickBtnHtml = (isCreator && uid !== window.currentUser.uid) ? `<button class="mini-btn danger kick-user-btn" data-uid="${uid}" data-name="${escapeHtml(data.members[uid])}" style="padding: 0.2rem 0.6rem; margin: 0; width: auto; font-size: 0.75rem;">Kick</button>` : '';
                    memList.innerHTML += `<li style="padding: 0.8rem; border: 3px solid var(--text-color); border-radius: 8px; font-weight: bold; font-size: 0.95rem; display: flex; justify-content: space-between; align-items: center;"><span>👤 ${escapeHtml(data.members[uid])}</span>${kickBtnHtml}</li>`;
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

        const channelList = document.getElementById('rs-channel-list');
        if (channelList) {
            const channels = data.channels || {};
            channelList.innerHTML = `<li><span># general</span><em>Original room chat</em></li>`;
            Object.entries(channels).forEach(([id, channel]) => {
                channelList.innerHTML += `<li><span># ${escapeHtml(channel.name || id)}</span><button class="mini-btn danger rs-delete-channel" data-channel="${escapeHtml(id)}">Delete</button></li>`;
            });
            channelList.querySelectorAll('.rs-delete-channel').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.getAttribute('data-channel');
                    if (!id || !confirm(`Delete #${id}? Messages already sent there remain in storage but the channel is hidden.`)) return;
                    await remove(ref(db, `rooms_meta/${window.activeRoomId}/channels/${id}`));
                    window.showToast(`#${id} deleted.`, false);
                    document.getElementById('room-drop-settings')?.click();
                });
            });
        }

        const permissions = data.permissions || {};
        const setChecked = (id, value) => {
            const input = document.getElementById(id);
            if (input) input.checked = value !== false;
        };
        setChecked('perm-chat', permissions.chat);
        setChecked('perm-files', permissions.files);
        setChecked('perm-docs', permissions.docs);
        setChecked('perm-whiteboard', permissions.whiteboard);
        setChecked('perm-calls', permissions.calls);
        
        const logList = document.getElementById('rs-logs-list');
        if (logList) {
            logList.innerHTML = '';
            if (data.logs) {
                Object.values(data.logs).sort((a,b) => b.timestamp - a.timestamp).forEach(l => {
                    let d = new Date(l.timestamp);
                    logList.innerHTML += `<li style="padding: 0.8rem; background: rgba(0,0,0,0.05); border-left: 4px solid var(--accent-color); font-family: monospace; font-size: 0.85rem; font-weight: 600;">[${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}]<br>${escapeHtml(l.text)}</li>`;
                });
            } else { logList.innerHTML = '<li style="color: #888;">No logs found.</li>'; }
        }
    }
});

const rsTabs = ['members', 'channels', 'permissions', 'webhooks', 'logs'];
rsTabs.forEach(tab => {
    const btn = document.getElementById(`rs-tab-${tab}`);
    if(btn) {
        btn.onclick = () => {
            rsTabs.forEach(t => { document.getElementById(`rs-tab-${t}`).classList.remove('active'); document.getElementById(`rs-pane-${t}`).classList.add('hidden'); });
            btn.classList.add('active'); document.getElementById(`rs-pane-${tab}`).classList.remove('hidden');
        };
    }
});

function closeRoomSettings() {
    document.getElementById('room-settings-modal')?.classList.add('hidden');
}

document.getElementById('close-room-settings-btn')?.addEventListener('click', closeRoomSettings);
document.getElementById('close-room-settings-x')?.addEventListener('click', closeRoomSettings);
document.getElementById('room-settings-modal')?.addEventListener('click', (event) => {
    if (event.target?.id === 'room-settings-modal') closeRoomSettings();
});

document.getElementById('rs-room-picture-input')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type?.startsWith('image/')) {
        event.target.value = '';
        window.showToast('Choose an image file for the room picture.');
        return;
    }

    if (file.size > ROOM_PICTURE_MAX_BYTES) {
        event.target.value = '';
        window.showToast('Room picture must be 5MB or smaller.');
        return;
    }

    const previewUrl = URL.createObjectURL(file);
    renderRoomPicturePreview(previewUrl, window.activeRoomId);
    setTimeout(() => URL.revokeObjectURL(previewUrl), 2500);
});

document.getElementById('rs-save-room-picture-btn')?.addEventListener('click', async () => {
    if (!window.activeRoomId || window.activeRoomId === 'global') return;

    const roomSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}`));
    const roomData = roomSnap.val() || {};
    const isCreator = roomData.creatorId === window.currentUser?.uid || (!roomData.creatorId && Object.keys(roomData.members || {})[0] === window.currentUser?.uid);
    if (!isCreator) return window.showToast('Only the room creator can change the room picture.');

    const input = document.getElementById('rs-room-picture-input');
    const file = input?.files?.[0];
    if (!file) return window.showToast('Choose a room picture first.');
    if (!file.type?.startsWith('image/')) return window.showToast('Choose an image file for the room picture.');
    if (file.size > ROOM_PICTURE_MAX_BYTES) return window.showToast('Room picture must be 5MB or smaller.');

    setRoomPictureBusy(true);
    try {
        const safeName = file.name.replace(/[^a-z0-9_.-]/gi, '_').slice(-80);
        const target = storageRef(storage, `room_pictures/${window.activeRoomId}/${Date.now()}_${safeName}`);
        await uploadBytesResumable(target, file);
        const photoUrl = await getDownloadURL(target);
        await set(ref(db, `rooms_meta/${window.activeRoomId}/photoUrl`), photoUrl);
        await set(ref(db, `rooms_meta/${window.activeRoomId}/logs/${Date.now()}`), { text: `${window.userProfileName} updated the room picture.`, timestamp: Date.now() });
        renderRoomPicturePreview(photoUrl, roomData.name);
        if (input) input.value = '';
        document.getElementById('rs-remove-room-picture-btn')?.removeAttribute('disabled');
        window.showToast('Room picture updated.', false);
    } catch (error) {
        window.showToast(`Room picture failed: ${error.message}`);
    } finally {
        setRoomPictureBusy(false);
    }
});

document.getElementById('rs-remove-room-picture-btn')?.addEventListener('click', async () => {
    if (!window.activeRoomId || window.activeRoomId === 'global') return;
    let removedPicture = false;

    const roomSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}`));
    const roomData = roomSnap.val() || {};
    const isCreator = roomData.creatorId === window.currentUser?.uid || (!roomData.creatorId && Object.keys(roomData.members || {})[0] === window.currentUser?.uid);
    if (!isCreator) return window.showToast('Only the room creator can change the room picture.');

    setRoomPictureBusy(true);
    try {
        await remove(ref(db, `rooms_meta/${window.activeRoomId}/photoUrl`));
        await set(ref(db, `rooms_meta/${window.activeRoomId}/logs/${Date.now()}`), { text: `${window.userProfileName} removed the room picture.`, timestamp: Date.now() });
        renderRoomPicturePreview('', roomData.name);
        removedPicture = true;
        window.showToast('Room picture removed.', false);
    } catch (error) {
        window.showToast(`Could not remove room picture: ${error.message}`);
    } finally {
        setRoomPictureBusy(false);
        if (removedPicture) document.getElementById('rs-remove-room-picture-btn')?.setAttribute('disabled', '');
    }
});

document.getElementById('rs-save-webhook')?.addEventListener('click', async () => {
    await set(ref(db, `rooms_meta/${window.activeRoomId}/webhook`), document.getElementById('rs-webhook-input').value.trim());
    window.showToast("Webhook integration saved!", false);
});

document.getElementById('rs-add-channel-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('rs-channel-input');
    const clean = (input?.value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    if (!clean) return window.showToast('Enter a channel name first.');
    await set(ref(db, `rooms_meta/${window.activeRoomId}/channels/${clean}`), {
        name: clean,
        by: window.currentUser.uid,
        createdAt: Date.now(),
    });
    if (input) input.value = '';
    window.showToast(`#${clean} created.`, false);
    document.getElementById('room-drop-settings')?.click();
});

document.getElementById('rs-save-permissions-btn')?.addEventListener('click', async () => {
    const checked = id => document.getElementById(id)?.checked !== false;
    await set(ref(db, `rooms_meta/${window.activeRoomId}/permissions`), {
        chat: checked('perm-chat'),
        files: checked('perm-files'),
        docs: checked('perm-docs'),
        whiteboard: checked('perm-whiteboard'),
        calls: checked('perm-calls'),
        updatedAt: Date.now(),
        updatedBy: window.currentUser.uid,
    });
    window.showToast('Room permissions saved.', false);
});

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

// --- TIMED MUTE UI LOGIC ---
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
