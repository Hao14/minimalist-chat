// js/rooms.js
import { db } from '../../lib/firebase.js';
import { getStorageUploadTools } from '../../lib/firebaseStorage.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ref, set, get, push, remove, serverTimestamp } from 'firebase/database';
import { mountChatCore, switchChatRoom } from '../chat-core/mountChatCore.js';
import {
    RoomAuditLog,
    RoomChannelsList,
    RoomInvitePanel,
    RoomMembersList,
    RoomPicturePreview,
} from './RoomControlPanels.jsx';

window.initializeRooms = function() {
    mountChatCore({ user: window.currentUser });

    if (window.innerWidth <= 768) {
        document.getElementById('desktop-room-sidebar')?.classList.add('open');
    }
};
window.switchRoom = switchChatRoom;

// --- CREATE & JOIN ROOM LOGIC ---
let currentRoomActionMode = 'join'; 
const roomActionModal = document.getElementById('room-action-modal');
const ROOM_PICTURE_MAX_BYTES = 5 * 1024 * 1024;
const ROOM_BANNER_MAX_BYTES = 8 * 1024 * 1024;
const reactRoots = new WeakMap();
const ROOM_TYPE_OPTIONS = {
    friends: { label: 'Friends group', description: 'Private-feeling space for close groups.' },
    community: { label: 'Club or community', description: 'Organized space for clubs, creators, teams, and communities.' },
};
const createRoomDraft = {
    step: 1,
    type: '',
    pictureFile: null,
    picturePreviewUrl: '',
};

function renderReact(target, element) {
    if (!target) return;
    let root = reactRoots.get(target);
    if (!root) {
        root = createRoot(target);
        reactRoots.set(target, root);
    }
    root.render(element);
}

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

    renderReact(preview, createElement(RoomPicturePreview, { url, initials: roomInitials(name) }));
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

function renderRoomBannerPreview(url) {
    const preview = document.getElementById('rs-room-banner-preview');
    if (!preview) return;
    preview.classList.toggle('has-banner', Boolean(url));
    preview.style.backgroundImage = url
        ? `linear-gradient(90deg, rgba(0,0,0,0.58), rgba(0,0,0,0.12)), url("${url}")`
        : '';
}

function setRoomBannerBusy(isBusy) {
    const saveBtn = document.getElementById('rs-save-room-banner-btn');
    const removeBtn = document.getElementById('rs-remove-room-banner-btn');
    const input = document.getElementById('rs-room-banner-input');
    if (saveBtn) {
        saveBtn.disabled = isBusy;
        saveBtn.textContent = isBusy ? 'Saving…' : 'Save Banner';
    }
    if (removeBtn) removeBtn.disabled = isBusy;
    if (input) input.disabled = isBusy;
}

function setRoomIdentityBusy(isBusy) {
    const saveBtn = document.getElementById('rs-save-room-identity-btn');
    if (saveBtn) {
        saveBtn.disabled = isBusy;
        saveBtn.textContent = isBusy ? 'Saving…' : 'Save Room Identity';
    }
}

function setRoomIdentityControls(data = {}, canEdit = false) {
    setControlValue('rs-room-description-input', data.description || '');
    setControlValue('rs-room-topic-input', data.topic || '');
    setControlValue('rs-room-category-input', data.category || data.roomTypeLabel || data.roomType || '');
    setControlValue('rs-room-template-select', data.template || data.roomTemplate || 'blank');
    setControlChecked('rs-room-discoverable', data.discovery?.enabled === true || data.discoverable === true);
    setControlChecked('rs-room-recommendations', data.discovery?.recommendations !== false);
    renderRoomBannerPreview(data.bannerUrl || '');
    document.getElementById('rs-remove-room-banner-btn')?.toggleAttribute('disabled', !canEdit || !data.bannerUrl);
    [
        'rs-room-banner-input',
        'rs-save-room-banner-btn',
        'rs-room-description-input',
        'rs-room-topic-input',
        'rs-room-category-input',
        'rs-room-template-select',
        'rs-room-discoverable',
        'rs-room-recommendations',
        'rs-save-room-identity-btn',
    ].forEach(id => setControlDisabled(id, !canEdit));
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

const ROOM_PERMISSION_KEYS = [
    'chat',
    'files',
    'polls',
    'reminders',
    'docs',
    'whiteboard',
    'calls',
    'video',
    'screenShare',
    'invites',
    'createChannels',
    'manageChannels',
    'webhooks',
];

const ROOM_PERMISSION_DEFAULTS = {
    manageChannels: false,
    webhooks: false,
};

const ROOM_PERMISSION_LABELS = {
    chat: 'Chat',
    files: 'Files',
    polls: 'Polls',
    reminders: 'Reminders',
    docs: 'Docs',
    whiteboard: 'Whiteboard',
    calls: 'Voice calls',
    video: 'Video calls',
    screenShare: 'Screen share',
    invites: 'Invites',
    createChannels: 'Create channels',
    manageChannels: 'Manage channels',
    webhooks: 'Webhooks & bots',
};

const ROOM_SUBSCRIPTION_PLANS = {
    base: {
        label: 'Base room',
        priceLabel: '$0',
        monthlyPrice: 0,
        maxUsers: 0,
        features: ['Current room limits'],
    },
    advanced: {
        label: 'Advanced Room',
        priceLabel: '$9.99/mo',
        monthlyPrice: 9.99,
        maxUsers: 20,
        features: ['2GB/file', '4GB daily upload', 'Video calls', 'Screen share 1080p/60', 'Room analytics'],
    },
    pro: {
        label: 'Pro Room',
        priceLabel: '$14.99/mo',
        monthlyPrice: 14.99,
        maxUsers: 50,
        features: ['3GB/file', '9GB daily upload', 'System-limit screen share', 'Everything in Advanced Room'],
    },
};

let latestRoomSettingsData = null;
let latestRoomSubscriptionCanEdit = false;

function isCurrentRoomCreator(roomData = {}) {
    const uid = window.currentUser?.uid;
    if (!uid) return false;
    if (uid === window.MY_ADMIN_UID) return true;
    if (roomData.creatorId) return roomData.creatorId === uid;
    return Object.keys(roomData.members || {})[0] === uid;
}

function permissionEnabled(permissions = {}, key) {
    if (Object.prototype.hasOwnProperty.call(permissions || {}, key)) return permissions[key] !== false;
    return ROOM_PERMISSION_DEFAULTS[key] ?? true;
}

function userPermissionEnabled(roomData = {}, key, uid = window.currentUser?.uid) {
    const overrides = uid ? roomData.memberPermissions?.[uid] : null;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key] !== false;
    return permissionEnabled(roomData.permissions, key);
}

async function getActiveRoomMeta() {
    if (!window.activeRoomId || window.activeRoomId === 'global') return {};
    const snapshot = await get(ref(db, `rooms_meta/${window.activeRoomId}`));
    return snapshot.val() || {};
}

async function canUseRoomPermission(key, deniedMessage) {
    if (!window.activeRoomId || window.activeRoomId === 'global') return true;
    const roomData = await getActiveRoomMeta();
    if (isCurrentRoomCreator(roomData)) return true;
    if (!userPermissionEnabled(roomData, key)) {
        window.showToast(deniedMessage);
        return false;
    }
    return true;
}

function setControlDisabled(id, disabled) {
    const element = document.getElementById(id);
    if (!element) return;
    element.toggleAttribute('disabled', disabled);
}

function setControlChecked(id, checked) {
    const element = document.getElementById(id);
    if (!element) return;
    element.checked = Boolean(checked);
}

function setControlValue(id, value) {
    const element = document.getElementById(id);
    if (!element) return;
    element.value = value || '';
}

function renderMemberPermissionOverrides(roomData = {}, canEdit = false) {
    const target = document.getElementById('rs-member-permissions-list');
    if (!target) return;

    const members = Object.entries(roomData.members || {})
        .map(([uid, name]) => ({ uid, name: String(name || 'Member') }))
        .sort((a, b) => a.name.localeCompare(b.name));

    target.innerHTML = '';
    if (!members.length) {
        const empty = document.createElement('div');
        empty.className = 'rs-empty-row';
        empty.textContent = 'Members appear here after they join this room.';
        target.appendChild(empty);
        return;
    }

    members.forEach((member) => {
        const overrides = roomData.memberPermissions?.[member.uid] || {};
        const card = document.createElement('article');
        card.className = 'member-permission-row';
        card.dataset.uid = member.uid;

        const head = document.createElement('div');
        head.className = 'member-permission-row-head';

        const avatar = document.createElement('span');
        avatar.className = 'member-permission-avatar';
        avatar.textContent = roomInitials(member.name);

        const copy = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = member.name;
        const status = document.createElement('small');
        const overrideCount = Object.keys(overrides).length;
        status.textContent = overrideCount ? `${overrideCount} custom permission${overrideCount === 1 ? '' : 's'}` : 'Using room defaults';
        copy.append(name, status);
        head.append(avatar, copy);

        const grid = document.createElement('div');
        grid.className = 'member-permission-grid';
        ROOM_PERMISSION_KEYS.forEach((key) => {
            const label = document.createElement('label');
            label.className = 'member-permission-select';

            const span = document.createElement('span');
            span.textContent = ROOM_PERMISSION_LABELS[key] || key;

            const select = document.createElement('select');
            select.dataset.uid = member.uid;
            select.dataset.key = key;
            select.disabled = !canEdit;

            const defaultValue = permissionEnabled(roomData.permissions, key);
            [
                ['', `Room default: ${defaultValue ? 'Allow' : 'Deny'}`],
                ['true', 'Allow'],
                ['false', 'Deny'],
            ].forEach(([value, text]) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = text;
                select.appendChild(option);
            });

            if (Object.prototype.hasOwnProperty.call(overrides, key)) {
                select.value = overrides[key] !== false ? 'true' : 'false';
            }

            label.append(span, select);
            grid.appendChild(label);
        });

        card.append(head, grid);
        target.appendChild(card);
    });
}

function readMemberPermissionOverrides() {
    return Array.from(document.querySelectorAll('#rs-member-permissions-list select[data-uid][data-key]'))
        .reduce((acc, select) => {
            if (!select.value) return acc;
            const uid = select.dataset.uid;
            const key = select.dataset.key;
            if (!uid || !key) return acc;
            if (!acc[uid]) acc[uid] = {};
            acc[uid][key] = select.value === 'true';
            return acc;
        }, {});
}

function getSelectedRoomSubscriptionPlan() {
    const checked = document.querySelector('input[name="rs-room-subscription-plan"]:checked');
    return ROOM_SUBSCRIPTION_PLANS[checked?.value] ? checked.value : 'base';
}

function readRoomSubscriptionSelection() {
    return Array.from(document.querySelectorAll('.rs-room-user-boost:checked')).reduce((acc, input) => {
        if (input.dataset.uid) acc[input.dataset.uid] = true;
        return acc;
    }, {});
}

function updateRoomSubscriptionCount() {
    const planId = getSelectedRoomSubscriptionPlan();
    const plan = ROOM_SUBSCRIPTION_PLANS[planId] || ROOM_SUBSCRIPTION_PLANS.base;
    const countNode = document.getElementById('rs-room-subscription-count');
    const limitNode = document.getElementById('rs-room-subscription-limit');
    const selectedCount = plan.maxUsers
        ? document.querySelectorAll('.rs-room-user-boost:checked').length
        : 0;

    if (countNode) countNode.textContent = `${selectedCount}/${plan.maxUsers}`;
    if (limitNode) {
        limitNode.textContent = plan.maxUsers
            ? `Select up to ${plan.maxUsers} room members for ${plan.label} benefits.`
            : 'Choose a paid room plan to select boosted users.';
    }
}

function renderRoomSubscriptionMembers(roomData = {}, selectedUsers = {}, canEdit = false) {
    const list = document.getElementById('rs-room-subscription-user-list');
    if (!list) return;

    const planId = getSelectedRoomSubscriptionPlan();
    const plan = ROOM_SUBSCRIPTION_PLANS[planId] || ROOM_SUBSCRIPTION_PLANS.base;
    const members = Object.entries(roomData.members || {}).map(([uid, name]) => ({
        uid,
        name: String(name || 'Member'),
    }));

    list.replaceChildren();

    if (!plan.maxUsers) {
        const empty = document.createElement('p');
        empty.className = 'room-subscription-empty';
        empty.textContent = 'Base room is active. Pick Advanced or Pro to boost selected room members.';
        list.appendChild(empty);
        updateRoomSubscriptionCount();
        return;
    }

    if (!members.length) {
        const empty = document.createElement('p');
        empty.className = 'room-subscription-empty';
        empty.textContent = 'Members will appear here after they join this room.';
        list.appendChild(empty);
        updateRoomSubscriptionCount();
        return;
    }

    members.forEach((member) => {
        const label = document.createElement('label');
        label.className = 'room-subscription-user';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'rs-room-user-boost';
        input.dataset.uid = member.uid;
        input.checked = Boolean(selectedUsers?.[member.uid]);
        input.disabled = !canEdit;
        input.addEventListener('change', () => {
            const selected = Array.from(document.querySelectorAll('.rs-room-user-boost:checked'));
            if (selected.length > plan.maxUsers) {
                input.checked = false;
                window.showToast?.(`${plan.label} can boost up to ${plan.maxUsers} users.`);
            }
            updateRoomSubscriptionCount();
        });

        const avatar = document.createElement('span');
        avatar.className = 'room-subscription-user-avatar';
        avatar.textContent = member.name.slice(0, 2).toUpperCase();

        const copy = document.createElement('span');
        copy.className = 'room-subscription-user-copy';
        const strong = document.createElement('strong');
        strong.textContent = member.name;
        const small = document.createElement('small');
        small.textContent = member.uid === window.currentUser?.uid ? 'You' : 'Room member';
        copy.append(strong, small);

        label.append(input, avatar, copy);
        list.appendChild(label);
    });

    updateRoomSubscriptionCount();
}

function renderRoomSubscriptionControls(roomData = {}, canEdit = false) {
    latestRoomSettingsData = roomData;
    latestRoomSubscriptionCanEdit = canEdit;
    const subscription = roomData.roomSubscription || {};
    const planId = ROOM_SUBSCRIPTION_PLANS[subscription.plan] ? subscription.plan : 'base';

    Object.keys(ROOM_SUBSCRIPTION_PLANS).forEach((id) => {
        const radio = document.getElementById(`rs-room-plan-${id}`);
        if (!radio) return;
        radio.checked = id === planId;
        radio.disabled = !canEdit;
        radio.onchange = () => {
            renderRoomSubscriptionMembers(
                latestRoomSettingsData || {},
                readRoomSubscriptionSelection(),
                latestRoomSubscriptionCanEdit,
            );
        };
    });

    renderRoomSubscriptionMembers(roomData, subscription.selectedUsers || {}, canEdit);
    setControlDisabled('rs-save-room-subscription-btn', !canEdit);
}

function webhookConfigFromRoom(roomData = {}) {
    const raw = roomData.webhook;
    if (raw && typeof raw === 'object') {
        return {
            url: String(raw.url || '').trim(),
            channelId: String(raw.channelId || roomData.webhookChannel || 'general'),
        };
    }
    return {
        url: String(raw || '').trim(),
        channelId: String(roomData.webhookChannel || 'general'),
    };
}

function botConfigFromRoom(roomData = {}) {
    const bots = roomData.bots || {};
    const stockTracker = bots.stockTracker || {};
    const autoModeration = bots.autoModeration || {};
    return {
        stockTracker: {
            enabled: stockTracker.enabled === true,
            symbols: String(stockTracker.symbols || ''),
        },
        autoModeration: {
            enabled: autoModeration.enabled === true,
            blockedWords: String(autoModeration.blockedWords || 'spam, scam'),
            blockLinks: autoModeration.blockLinks === true,
            blockCaps: autoModeration.blockCaps !== false,
            blockFlood: autoModeration.blockFlood !== false,
        },
    };
}

function populateWebhookChannelSelect(roomData = {}, selectedChannelId = 'general') {
    const select = document.getElementById('rs-webhook-channel');
    if (!select) return;

    select.innerHTML = '';
    const options = [
        ['general', '# general'],
        ...Object.entries(roomData.channels || {}).map(([id, channel]) => [id, `# ${channel?.name || id}`]),
    ];

    options.forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    });

    select.value = options.some(([value]) => value === selectedChannelId) ? selectedChannelId : 'general';
}

function setHidden(id, shouldHide) {
    document.getElementById(id)?.classList.toggle('hidden', shouldHide);
}

function setRoomActionSubtitle(text) {
    const subtitle = document.getElementById('room-action-subtitle');
    if (subtitle) subtitle.textContent = text || '';
}

function revokeCreateRoomPicturePreview() {
    if (createRoomDraft.picturePreviewUrl) {
        URL.revokeObjectURL(createRoomDraft.picturePreviewUrl);
        createRoomDraft.picturePreviewUrl = '';
    }
}

function resetCreateRoomDraft() {
    revokeCreateRoomPicturePreview();
    createRoomDraft.step = 1;
    createRoomDraft.type = '';
    createRoomDraft.pictureFile = null;

    document.querySelectorAll('.room-type-option').forEach((button) => button.classList.remove('selected'));
    const nameInput = document.getElementById('create-room-name-input');
    if (nameInput) nameInput.value = '';
    const pictureInput = document.getElementById('create-room-picture-input');
    if (pictureInput) pictureInput.value = '';
    const preview = document.getElementById('create-room-picture-preview');
    if (preview) preview.innerHTML = '<i class="ph-bold ph-image"></i>';
}

function setRoomCreateStep(step) {
    createRoomDraft.step = step;
    setHidden('room-create-type-step', step !== 1);
    setHidden('room-create-details-step', step !== 2);
    setHidden('room-create-back-btn', step === 1);

    const stepLabel = document.getElementById('room-create-step-label');
    if (stepLabel) stepLabel.textContent = step === 1 ? 'Step 1 of 2' : 'Step 2 of 2';

    const typeLabel = ROOM_TYPE_OPTIONS[createRoomDraft.type]?.label || 'Choose room type';
    const typePill = document.getElementById('room-create-type-pill');
    if (typePill) typePill.textContent = step === 1 ? 'Choose room type' : typeLabel;

    const submit = document.getElementById('room-action-submit');
    if (submit) submit.textContent = step === 1 ? 'Next' : 'Create room';

    setRoomActionSubtitle(step === 1
        ? 'What kind of room are you creating?'
        : 'Now give it a name and optional picture.');

    if (step === 2) setTimeout(() => document.getElementById('create-room-name-input')?.focus(), 0);
}

function selectCreateRoomType(type) {
    if (!ROOM_TYPE_OPTIONS[type]) return;
    createRoomDraft.type = type;
    document.querySelectorAll('.room-type-option').forEach((button) => {
        button.classList.toggle('selected', button.dataset.roomType === type);
    });
}

function openCreateRoomModal() {
    currentRoomActionMode = 'create';
    resetCreateRoomDraft();
    document.getElementById('room-action-title').textContent = 'Create room';
    setHidden('room-join-fields', true);
    setHidden('create-room-wizard', false);
    setRoomCreateStep(1);
    if (roomActionModal) roomActionModal.classList.remove('hidden');
}

function openJoinRoomModal(prefill = '') {
    currentRoomActionMode = 'join';
    resetCreateRoomDraft();
    document.getElementById('room-action-title').textContent = "Join Room";
    setRoomActionSubtitle('Paste a room link or invite code.');
    document.getElementById('room-action-label').textContent = "INVITE LINK OR CODE";
    document.getElementById('room-action-input').placeholder = "Paste full link or code...";
    document.getElementById('room-action-input').value = prefill;
    document.getElementById('room-action-submit').textContent = "Join";
    setHidden('room-join-fields', false);
    setHidden('create-room-wizard', true);
    setHidden('room-create-back-btn', true);
    if(roomActionModal) roomActionModal.classList.remove('hidden');
}

window.openJoinRoomModal = openJoinRoomModal;
window.openCreateRoomModal = openCreateRoomModal;

function normalizeRoomInviteCode(rawValue = '') {
    let value = String(rawValue || '').trim();
    if (!value) return '';

    try {
        const parsed = new URL(value, window.location.origin);
        const joinIndex = parsed.pathname.toLowerCase().lastIndexOf('/join/');
        if (joinIndex >= 0) value = parsed.pathname.slice(joinIndex + 6);
    } catch {
        const match = value.match(/\/join\/([^?#\s]+)/i);
        if (match?.[1]) value = match[1];
    }

    value = value.split(/[?#]/)[0].trim();
    if (value.startsWith('#')) value = value.slice(1);
    return value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

async function findRoomByInviteCode(rawValue) {
    const code = normalizeRoomInviteCode(rawValue);
    if (!code) return { code, foundRoom: null, inviterId: null };

    const targetShortId = code.includes('-') ? code.split('-')[0] : code;
    const inviterId = code.includes('-') ? code.split('-').slice(1).join('-') : null;
    const snapshot = await get(ref(db, 'rooms_meta'));
    let foundRoom = null;

    snapshot.forEach(child => {
        const room = child.val() || {};
        const shortId = String(room.shortId || '').toUpperCase();
        const key = String(child.key || '').toUpperCase();
        if (shortId === targetShortId || key === targetShortId) foundRoom = { key: child.key, ...room };
    });

    return { code, targetShortId, inviterId, foundRoom };
}

async function joinRoomFromInvite(rawValue, options = {}) {
    const { openModalOnFailure = false } = options;
    const code = normalizeRoomInviteCode(rawValue);
    if (!code) {
        window.showToast("Invite link or code is empty.");
        if (openModalOnFailure) openJoinRoomModal(rawValue);
        return false;
    }

    if (!window.currentUser?.uid) {
        sessionStorage.setItem('pendingJoinUrl', `/join/${code}`);
        window.showToast("Please sign in first, then the invite link will continue.");
        return false;
    }

    try {
        const { inviterId, foundRoom } = await findRoomByInviteCode(code);
        if (!foundRoom) {
            window.showToast("Room ID not found. Check for typos!");
            if (openModalOnFailure) openJoinRoomModal(rawValue);
            return false;
        }

        const alreadyMember = Boolean(foundRoom.members?.[window.currentUser.uid]);
        if (!alreadyMember) {
            await set(ref(db, `rooms_meta/${foundRoom.key}/members/${window.currentUser.uid}`), window.userProfileName);
            const logText = inviterId
                ? `${window.userProfileName} joined via invite link from user #${inviterId}.`
                : `${window.userProfileName} joined the room.`;
            await set(ref(db, `rooms_meta/${foundRoom.key}/logs/${Date.now()}`), { text: logText, timestamp: Date.now() });

            if (window.createNotification && foundRoom.creatorId) {
                window.createNotification(foundRoom.creatorId, 'room', `${window.userProfileName || 'Someone'} joined your room!`);
            }

            await sendAiWelcomeMessage(foundRoom.key, foundRoom.name, window.userProfileName || 'new member');
        }

        if(roomActionModal) roomActionModal.classList.add('hidden');
        document.getElementById('room-invite-modal')?.classList.add('hidden');
        window.switchRoom(foundRoom.key, foundRoom.name, foundRoom.shortId);
        window.showToast(alreadyMember ? "You're already in this room." : "Joined room successfully!", false);
        return true;
    } catch (e) {
        window.showToast("Error joining room: " + e.message);
        if (openModalOnFailure) openJoinRoomModal(rawValue);
        return false;
    }
}

function buildAiWelcomeText(roomName, userName) {
    const cleanRoom = String(roomName || 'this room').trim();
    const cleanName = String(userName || 'there').trim();
    return `Welcome to ${cleanRoom}, ${cleanName}! I’m the room AI agent — I can help summarize the chat, brainstorm ideas, explain code, and turn the conversation into next steps.`;
}

async function sendAiWelcomeMessage(roomId, roomName, joinedName) {
    if (!roomId || roomId === 'global') return;

    const text = buildAiWelcomeText(roomName, joinedName);
    const preview = `AI Agent: Welcome ${joinedName || 'a new member'}!`;

    try {
        await set(push(ref(db, `rooms_data/${roomId}/messages`)), {
            uid: 'minimalist-ai-agent',
            name: 'AI Agent',
            photoUrl: '',
            text,
            timestamp: serverTimestamp(),
            tier: 'bot',
            bot: true,
            aiAgent: true,
            system: true,
        });

        await set(ref(db, `rooms_meta/${roomId}/lastMessage`), preview.length > 30 ? `${preview.substring(0, 30)}...` : preview);
    } catch {
        // Joining the room should still succeed if the optional bot greeting fails.
    }
}

window.joinRoomFromInvite = joinRoomFromInvite;
window.normalizeRoomInviteCode = normalizeRoomInviteCode;

function buildActiveRoomInviteLink() {
    if (!window.activeRoomShortId || window.activeRoomShortId === 'GLOBAL') return '';
    return `${window.location.origin}/join/${window.activeRoomShortId}-${window.userShortId}`;
}

async function copyInviteLink(inviteLink) {
    try {
        await navigator.clipboard.writeText(inviteLink);
    } catch {
        const input = document.getElementById('room-invite-link');
        input?.select();
        document.execCommand('copy');
    }
    window.showToast('Invite link copied.', false);
}

let roomInviteRoot = null;
let invitePanelState = {
    title: 'Invite to Room',
    inviteLink: '',
    targets: [],
    loading: false,
    error: '',
    forwardingUid: '',
    sentUids: new Set(),
};

function setInvitePanelState(patch) {
    invitePanelState = { ...invitePanelState, ...patch };
    renderRoomInvitePanel();
}

function closeRoomInvitePanel() {
    document.getElementById('room-invite-modal')?.classList.add('hidden');
}

async function handleForwardInvite(target) {
    if (!target?.uid || !invitePanelState.inviteLink) return;
    setInvitePanelState({ forwardingUid: target.uid });
    try {
        await forwardInviteThroughPm(target, invitePanelState.inviteLink);
        const nextSent = new Set(invitePanelState.sentUids);
        nextSent.add(target.uid);
        setInvitePanelState({ sentUids: nextSent, forwardingUid: '' });
        window.showToast(`Invite forwarded to ${target.name}.`, false);
    } catch (error) {
        setInvitePanelState({ forwardingUid: '' });
        window.showToast(`Could not forward invite: ${error.message}`);
    }
}

function renderRoomInvitePanel() {
    const modal = document.getElementById('room-invite-modal');
    if (!modal || !roomInviteRoot) return;

    roomInviteRoot.render(createElement(RoomInvitePanel, {
        ...invitePanelState,
        onClose: closeRoomInvitePanel,
        onCopy: () => {
            if (invitePanelState.inviteLink) copyInviteLink(invitePanelState.inviteLink);
        },
        onRefresh: () => renderRoomInviteTargets(),
        onForward: handleForwardInvite,
    }));
}

function ensureRoomInviteModal() {
    let modal = document.getElementById('room-invite-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'room-invite-modal';
        modal.className = 'hidden modal-overlay room-invite-overlay';
        document.body.appendChild(modal);
    }

    if (!roomInviteRoot) {
        roomInviteRoot = createRoot(modal);
        renderRoomInvitePanel();
    }

    if (modal.dataset.wired !== 'true') {
        modal.dataset.wired = 'true';
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeRoomInvitePanel();
        });
    }
    return modal;
}

async function getRoomInviteTargets() {
    const myUid = window.currentUser?.uid;
    if (!myUid) return [];

    const roomMembersPromise = window.activeRoomId && window.activeRoomId !== 'global'
        ? get(ref(db, `rooms_meta/${window.activeRoomId}/members`))
        : Promise.resolve({ val: () => ({}) });

    const [usersSnap, friendsSnap, roomMembersSnap] = await Promise.all([
        get(ref(db, 'user_directory')),
        get(ref(db, `friends/${myUid}`)),
        roomMembersPromise,
    ]);

    const users = usersSnap.val() || {};
    const friends = friendsSnap.val() || {};
    const roomMembers = roomMembersSnap.val() || {};

    return Object.entries(friends)
        .filter(([uid, status]) => uid !== myUid && status === 'accepted' && !roomMembers[uid])
        .map(([uid]) => {
            const user = users[uid] || {};
            const name = user.displayName || user.name || 'Unknown';
            return {
                uid,
                name,
                photoUrl: user.photoUrl || window.getAvatarUrl?.(name, '') || '',
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function forwardInviteThroughPm(target, inviteLink) {
    const myUid = window.currentUser?.uid;
    if (!myUid || !target?.uid || !inviteLink) return;

    const pmRoomId = myUid < target.uid ? `${myUid}_${target.uid}` : `${target.uid}_${myUid}`;
    const roomName = document.getElementById('active-room-name-display')?.textContent?.trim() || 'this room';
    const text = `Room invite: ${roomName}\n${inviteLink}`;
    const lastText = `Room invite: ${roomName}`;

    await push(ref(db, `private_messages/${pmRoomId}`), {
        uid: myUid,
        text,
        type: 'room_invite',
        roomId: window.activeRoomId,
        roomName,
        inviteLink,
        readBy: { [myUid]: Date.now() },
        timestamp: serverTimestamp(),
    });

    await set(ref(db, `inbox/${target.uid}/${myUid}`), {
        fromName: window.userProfileName || 'Someone',
        senderUid: myUid,
        timestamp: Date.now(),
        lastText,
        read: false,
    });

    await set(ref(db, `inbox/${myUid}/${target.uid}`), {
        fromName: target.name,
        senderUid: target.uid,
        timestamp: Date.now(),
        lastText,
        read: true,
    });

    window.createNotification?.(
        target.uid,
        'message',
        `${window.userProfileName || 'Someone'} sent you a room invite.`,
        {
            groupId: myUid,
            from: window.userProfileName || 'Someone',
            action: 'pm',
            pmTargetUid: myUid,
            pmTargetName: window.userProfileName || 'Someone',
        },
    );
}

async function renderRoomInviteTargets() {
    ensureRoomInviteModal();
    setInvitePanelState({
        inviteLink: invitePanelState.inviteLink || buildActiveRoomInviteLink(),
        loading: true,
        error: '',
    });

    try {
        const targets = await getRoomInviteTargets();
        setInvitePanelState({
            targets: targets.map((target) => ({ ...target, initials: roomInitials(target.name) })),
            loading: false,
            error: '',
        });
    } catch (error) {
        setInvitePanelState({
            targets: [],
            loading: false,
            error: 'Could not load contacts. Copy the invite link instead.',
        });
        window.showToast(`Invite contacts failed: ${error.message}`);
    }
}

async function openRoomInvitePanel() {
    if (window.activeRoomShortId === 'GLOBAL' || window.activeRoomId === 'global') {
        window.showToast('Global Chat does not need an invite link.');
        return;
    }
    if (!(await canUseRoomPermission('invites', 'Invites are disabled in this room.'))) return;

    const modal = ensureRoomInviteModal();
    const inviteLink = buildActiveRoomInviteLink();
    setInvitePanelState({
        title: `Invite to ${document.getElementById('active-room-name-display')?.textContent?.trim() || 'Room'}`,
        inviteLink,
        targets: [],
        loading: false,
        error: '',
        forwardingUid: '',
        sentUids: new Set(),
    });
    document.getElementById('room-settings-dropdown')?.classList.add('hidden');
    modal.classList.remove('hidden');
    await renderRoomInviteTargets();
}

function setRoomActionBusy(isBusy) {
    const submit = document.getElementById('room-action-submit');
    const back = document.getElementById('room-create-back-btn');
    const close = document.getElementById('close-room-action-btn');
    if (submit) {
        submit.disabled = isBusy;
        if (currentRoomActionMode === 'create' && createRoomDraft.step === 2) {
            submit.textContent = isBusy ? 'Creating…' : 'Create room';
        }
    }
    if (back) back.disabled = isBusy;
    if (close) close.disabled = isBusy;
    document.querySelectorAll('.room-type-option').forEach((button) => {
        button.toggleAttribute('disabled', isBusy);
    });
}

async function uploadCreateRoomPicture(roomId) {
    const file = createRoomDraft.pictureFile;
    if (!file) return '';
    const safeName = file.name.replace(/[^a-z0-9_.-]/gi, '_').slice(-80);
    const { getDownloadURL, storage, storageRef, uploadBytesResumable } = await getStorageUploadTools();
    const target = storageRef(storage, `room_pictures/${roomId}/${Date.now()}_${safeName}`);
    await uploadBytesResumable(target, file);
    return getDownloadURL(target);
}

async function createRoomFromWizard() {
    if (createRoomDraft.step === 1) {
        if (!createRoomDraft.type) return window.showToast('Choose a room type first.');
        setRoomCreateStep(2);
        return;
    }

    const rawName = document.getElementById('create-room-name-input')?.value?.trim() || '';
    if (!rawName) return window.showToast('Room name cannot be empty.');
    if (!createRoomDraft.type) {
        setRoomCreateStep(1);
        return window.showToast('Choose a room type first.');
    }
    if (!(await canCreateAnotherRoom())) return;

    setRoomActionBusy(true);
    try {
        const val = rawName.toUpperCase();
        const roomKind = ROOM_TYPE_OPTIONS[createRoomDraft.type];
        const newRoomRef = push(ref(db, 'rooms_meta'));
        const newShortId = window.generateShortId();
        const photoUrl = await uploadCreateRoomPicture(newRoomRef.key);
        const payload = {
            name: val,
            lastMessage: 'Room created.',
            shortId: newShortId,
            creatorId: window.currentUser.uid,
            createdAt: serverTimestamp(),
            roomType: createRoomDraft.type,
            roomTypeLabel: roomKind.label,
            description: roomKind.description,
            topic: createRoomDraft.type === 'community' ? 'Welcome, introductions, and shared updates.' : 'A private place to keep the group in sync.',
            category: createRoomDraft.type === 'community' ? 'Community' : 'Friends',
            template: createRoomDraft.type === 'community' ? 'club' : 'blank',
            discovery: {
                enabled: createRoomDraft.type === 'community',
                recommendations: true,
                updatedAt: Date.now(),
                updatedBy: window.currentUser.uid,
            },
            members: { [window.currentUser.uid]: window.userProfileName },
            logs: {
                [Date.now()]: {
                    text: `${window.userProfileName} created the ${roomKind.label.toLowerCase()} room.`,
                    timestamp: Date.now(),
                },
            },
        };
        if (photoUrl) payload.photoUrl = photoUrl;

        await set(newRoomRef, payload);
        if (roomActionModal) roomActionModal.classList.add('hidden');
        if (window.awardBadge) window.awardBadge(window.currentUser.uid, 'founder');
        window.awardXP?.(window.currentUser.uid, 'leadership', 30);
        window.trackQuest?.('room');
        window.switchRoom(newRoomRef.key, val, newShortId);
        window.showToast(`Room created! Invite: #${newShortId}-${window.userShortId}`, false);
        resetCreateRoomDraft();
    } catch (error) {
        window.showToast(`Could not create room: ${error.message}`);
    } finally {
        setRoomActionBusy(false);
    }
}

document.getElementById('create-room-btn')?.addEventListener('click', () => {
    openCreateRoomModal();
});

document.getElementById('join-room-btn')?.addEventListener('click', () => {
    openJoinRoomModal();
});

document.getElementById('close-room-action-btn')?.addEventListener('click', () => {
    resetCreateRoomDraft();
    if(roomActionModal) roomActionModal.classList.add('hidden');
});

document.querySelectorAll('.room-type-option').forEach((button) => {
    button.addEventListener('click', () => {
        selectCreateRoomType(button.dataset.roomType);
        setRoomCreateStep(2);
    });
});

document.getElementById('room-create-back-btn')?.addEventListener('click', () => {
    if (currentRoomActionMode === 'create') {
        setRoomCreateStep(1);
    }
});

document.getElementById('create-room-picture-input')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0] || null;
    revokeCreateRoomPicturePreview();
    createRoomDraft.pictureFile = null;

    if (!file) return;
    if (!file.type?.startsWith('image/')) {
        event.target.value = '';
        return window.showToast('Choose an image file for the room picture.');
    }
    if (file.size > ROOM_PICTURE_MAX_BYTES) {
        event.target.value = '';
        return window.showToast('Room picture must be 5MB or smaller.');
    }

    createRoomDraft.pictureFile = file;
    createRoomDraft.picturePreviewUrl = URL.createObjectURL(file);
    const preview = document.getElementById('create-room-picture-preview');
    if (preview) preview.innerHTML = `<img src="${createRoomDraft.picturePreviewUrl}" alt="">`;
});

document.getElementById('create-room-name-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        document.getElementById('room-action-submit')?.click();
    }
});

document.getElementById('room-action-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        document.getElementById('room-action-submit')?.click();
    }
});

document.getElementById('room-action-submit')?.addEventListener('click', async () => {
    if (currentRoomActionMode === 'create') {
        await createRoomFromWizard();
        return;
    }

    const inputEl = document.getElementById('room-action-input');
    const rawVal = inputEl.value.trim();
    if (!rawVal) return window.showToast("Input cannot be empty!");
    await joinRoomFromInvite(rawVal, { openModalOnFailure: false });
});

// --- ROOM SETTINGS & MODERATION ---
const roomDropdown = document.getElementById('room-settings-dropdown');
document.getElementById('room-name-wrapper')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.refreshRoomPreferenceControls?.();
    roomDropdown?.classList.toggle('hidden');
});
document.addEventListener('click', () => roomDropdown?.classList.add('hidden'));

document.getElementById('room-drop-invite')?.addEventListener('click', () => {
    openRoomInvitePanel();
});

document.getElementById('room-drop-favorite')?.addEventListener('click', async () => {
    document.getElementById('room-settings-dropdown')?.classList.add('hidden');
    await window.toggleActiveRoomFavorite?.();
    window.refreshRoomPreferenceControls?.();
});

document.getElementById('room-drop-hide')?.addEventListener('click', async () => {
    document.getElementById('room-settings-dropdown')?.classList.add('hidden');
    await window.hideActiveRoom?.();
    window.refreshRoomPreferenceControls?.();
});

document.getElementById('room-drop-settings')?.addEventListener('click', async () => {
    if (window.activeRoomId === 'global') return window.showToast("Settings not available for Global Chat.", true);
    document.getElementById('room-settings-dropdown')?.classList.add('hidden');
    document.getElementById('room-settings-modal')?.classList.remove('hidden');
    
    const roomSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}`));
    if (roomSnap.exists()) {
        const data = roomSnap.val();
        const isCreator = isCurrentRoomCreator(data);
        const canManageChannels = isCreator || permissionEnabled(data.permissions, 'manageChannels');
        const canManageWebhooks = isCreator || permissionEnabled(data.permissions, 'webhooks');
        
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
        const bannerInput = document.getElementById('rs-room-banner-input');
        if (bannerInput) bannerInput.value = '';
        setRoomIdentityControls(data, isCreator);
        
        const memList = document.getElementById('rs-members-list');
        if (memList) {
            const members = Object.entries(data.members || {}).map(([uid, name]) => ({ uid, name }));
            renderReact(memList, createElement(RoomMembersList, {
                members,
                canKick: isCreator,
                currentUserId: window.currentUser?.uid,
                onKick: async (member) => {
                    if (await window.appConfirm({
                        kicker: 'Room moderation',
                        title: 'Kick member?',
                        message: `Kick ${member.name} from the room?`,
                        confirmText: 'Kick',
                        destructive: true,
                    })) {
                        await remove(ref(db, `rooms_meta/${window.activeRoomId}/members/${member.uid}`));
                        await set(ref(db, `rooms_meta/${window.activeRoomId}/logs/${Date.now()}`), { text: `${window.userProfileName} kicked ${member.name}.`, timestamp: Date.now() });
                        window.showToast(`${member.name} was kicked.`, false);
                        document.getElementById('room-drop-settings')?.click();
                    }
                },
            }));
        }
        
        const webhookConfig = webhookConfigFromRoom(data);
        if(document.getElementById('rs-webhook-input')) document.getElementById('rs-webhook-input').value = webhookConfig.url;
        populateWebhookChannelSelect(data, webhookConfig.channelId);
        setControlDisabled('rs-webhook-input', !canManageWebhooks);
        setControlDisabled('rs-webhook-channel', !canManageWebhooks);
        setControlDisabled('rs-save-webhook', !canManageWebhooks);
        const botConfig = botConfigFromRoom(data);
        setControlChecked('rs-stock-bot-enabled', botConfig.stockTracker.enabled);
        setControlValue('rs-stock-symbols', botConfig.stockTracker.symbols);
        setControlChecked('rs-automod-bot-enabled', botConfig.autoModeration.enabled);
        setControlValue('rs-automod-words', botConfig.autoModeration.blockedWords);
        setControlChecked('rs-automod-links', botConfig.autoModeration.blockLinks);
        ['rs-stock-bot-enabled', 'rs-stock-symbols', 'rs-automod-bot-enabled', 'rs-automod-words', 'rs-automod-links', 'rs-save-bots']
            .forEach(id => setControlDisabled(id, !canManageWebhooks));
        setControlDisabled('rs-channel-input', !canManageChannels);
        setControlDisabled('rs-add-channel-btn', !canManageChannels);
        renderRoomSubscriptionControls(data, isCreator);

        const channelList = document.getElementById('rs-channel-list');
        if (channelList) {
            const channels = Object.entries(data.channels || {}).map(([id, channel]) => ({
                id,
                name: channel?.name || id,
            }));
            renderReact(channelList, createElement(RoomChannelsList, {
                channels,
                canManageChannels,
                onDelete: async (id) => {
                    if (!(await canUseRoomPermission('manageChannels', 'Channel management is disabled in this room.'))) return;
                    if (!id) return;
                    const confirmed = await window.appConfirm({
                        kicker: 'Channels',
                        title: `Delete #${id}?`,
                        message: 'Messages already sent there remain in storage, but the channel will be hidden.',
                        confirmText: 'Delete Channel',
                        destructive: true,
                    });
                    if (!confirmed) return;
                    await Promise.all([
                        remove(ref(db, `rooms_meta/${window.activeRoomId}/channels/${id}`)),
                        remove(ref(db, `room_calls/${window.activeRoomId}/channels/${id}`)),
                    ]);
                    window.showToast(`#${id} deleted.`, false);
                    document.getElementById('room-drop-settings')?.click();
                },
            }));
        }

        const permissions = data.permissions || {};
        const setPermissionChecked = (id, key) => {
            const input = document.getElementById(id);
            if (input) input.checked = permissionEnabled(permissions, key);
        };
        setPermissionChecked('perm-chat', 'chat');
        setPermissionChecked('perm-files', 'files');
        setPermissionChecked('perm-polls', 'polls');
        setPermissionChecked('perm-reminders', 'reminders');
        setPermissionChecked('perm-docs', 'docs');
        setPermissionChecked('perm-whiteboard', 'whiteboard');
        setPermissionChecked('perm-calls', 'calls');
        setPermissionChecked('perm-video', 'video');
        setPermissionChecked('perm-screen-share', 'screenShare');
        setPermissionChecked('perm-invites', 'invites');
        setPermissionChecked('perm-create-channels', 'createChannels');
        setPermissionChecked('perm-manage-channels', 'manageChannels');
        setPermissionChecked('perm-webhooks', 'webhooks');
        ROOM_PERMISSION_KEYS.forEach(key => {
            const id = `perm-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
            setControlDisabled(id, !isCreator);
        });
        setControlDisabled('rs-save-permissions-btn', !isCreator);
        renderMemberPermissionOverrides(data, isCreator);
        
        const logList = document.getElementById('rs-logs-list');
        if (logList) {
            const logs = Object.values(data.logs || {})
                .sort((a,b) => b.timestamp - a.timestamp)
                .map((log) => {
                    const date = new Date(log.timestamp);
                    return {
                        text: log.text || '',
                        timestamp: log.timestamp || 0,
                        dateLabel: `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`,
                    };
                });
            renderReact(logList, createElement(RoomAuditLog, { logs }));
        }
    }
});

const rsTabs = ['overview', 'members', 'channels', 'permissions', 'webhooks', 'subscription', 'logs'];
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

document.getElementById('rs-room-banner-input')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type?.startsWith('image/')) {
        event.target.value = '';
        window.showToast('Choose an image file for the room banner.');
        return;
    }

    if (file.size > ROOM_BANNER_MAX_BYTES) {
        event.target.value = '';
        window.showToast('Room banner must be 8MB or smaller.');
        return;
    }

    const previewUrl = URL.createObjectURL(file);
    renderRoomBannerPreview(previewUrl);
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
        const { getDownloadURL, storage, storageRef, uploadBytesResumable } = await getStorageUploadTools();
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

document.getElementById('rs-save-room-banner-btn')?.addEventListener('click', async () => {
    if (!window.activeRoomId || window.activeRoomId === 'global') return;

    const roomSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}`));
    const roomData = roomSnap.val() || {};
    if (!isCurrentRoomCreator(roomData)) return window.showToast('Only the room creator can change the room banner.');

    const input = document.getElementById('rs-room-banner-input');
    const file = input?.files?.[0];
    if (!file) return window.showToast('Choose a room banner first.');
    if (!file.type?.startsWith('image/')) return window.showToast('Choose an image file for the room banner.');
    if (file.size > ROOM_BANNER_MAX_BYTES) return window.showToast('Room banner must be 8MB or smaller.');

    setRoomBannerBusy(true);
    try {
        const safeName = file.name.replace(/[^a-z0-9_.-]/gi, '_').slice(-80);
        const { getDownloadURL, storage, storageRef, uploadBytesResumable } = await getStorageUploadTools();
        const target = storageRef(storage, `room_banners/${window.activeRoomId}/${Date.now()}_${safeName}`);
        await uploadBytesResumable(target, file);
        const bannerUrl = await getDownloadURL(target);
        await set(ref(db, `rooms_meta/${window.activeRoomId}/bannerUrl`), bannerUrl);
        await set(ref(db, `rooms_meta/${window.activeRoomId}/logs/${Date.now()}`), { text: `${window.userProfileName} updated the room banner.`, timestamp: Date.now() });
        renderRoomBannerPreview(bannerUrl);
        if (input) input.value = '';
        document.getElementById('rs-remove-room-banner-btn')?.removeAttribute('disabled');
        window.showToast('Room banner updated.', false);
    } catch (error) {
        window.showToast(`Room banner failed: ${error.message}`);
    } finally {
        setRoomBannerBusy(false);
    }
});

document.getElementById('rs-remove-room-banner-btn')?.addEventListener('click', async () => {
    if (!window.activeRoomId || window.activeRoomId === 'global') return;
    const roomSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}`));
    const roomData = roomSnap.val() || {};
    if (!isCurrentRoomCreator(roomData)) return window.showToast('Only the room creator can change the room banner.');

    setRoomBannerBusy(true);
    try {
        await remove(ref(db, `rooms_meta/${window.activeRoomId}/bannerUrl`));
        await set(ref(db, `rooms_meta/${window.activeRoomId}/logs/${Date.now()}`), { text: `${window.userProfileName} removed the room banner.`, timestamp: Date.now() });
        renderRoomBannerPreview('');
        document.getElementById('rs-remove-room-banner-btn')?.setAttribute('disabled', '');
        window.showToast('Room banner removed.', false);
    } catch (error) {
        window.showToast(`Could not remove room banner: ${error.message}`);
    } finally {
        setRoomBannerBusy(false);
        document.getElementById('rs-remove-room-banner-btn')?.setAttribute('disabled', '');
    }
});

document.getElementById('rs-save-room-identity-btn')?.addEventListener('click', async () => {
    if (!window.activeRoomId || window.activeRoomId === 'global') return;
    const roomSnap = await get(ref(db, `rooms_meta/${window.activeRoomId}`));
    const roomData = roomSnap.val() || {};
    if (!isCurrentRoomCreator(roomData)) return window.showToast('Only the room creator can change room identity.');

    const description = (document.getElementById('rs-room-description-input')?.value || '').trim().slice(0, 600);
    const topic = (document.getElementById('rs-room-topic-input')?.value || '').trim().slice(0, 90);
    const category = (document.getElementById('rs-room-category-input')?.value || '').trim().slice(0, 36);
    const template = document.getElementById('rs-room-template-select')?.value || 'blank';
    const discoveryEnabled = document.getElementById('rs-room-discoverable')?.checked === true;
    const recommendations = document.getElementById('rs-room-recommendations')?.checked !== false;

    setRoomIdentityBusy(true);
    try {
        await Promise.all([
            set(ref(db, `rooms_meta/${window.activeRoomId}/description`), description),
            set(ref(db, `rooms_meta/${window.activeRoomId}/topic`), topic),
            set(ref(db, `rooms_meta/${window.activeRoomId}/category`), category),
            set(ref(db, `rooms_meta/${window.activeRoomId}/template`), template),
            set(ref(db, `rooms_meta/${window.activeRoomId}/discovery`), {
                enabled: discoveryEnabled,
                recommendations,
                updatedAt: Date.now(),
                updatedBy: window.currentUser.uid,
            }),
            set(ref(db, `rooms_meta/${window.activeRoomId}/logs/${Date.now()}`), { text: `${window.userProfileName} updated room identity.`, timestamp: Date.now() }),
        ]);
        window.showToast('Room identity saved.', false);
        window.loadRoomHome?.();
    } catch (error) {
        window.showToast(`Could not save room identity: ${error.message}`);
    } finally {
        setRoomIdentityBusy(false);
    }
});

document.getElementById('rs-save-webhook')?.addEventListener('click', async () => {
    if (!(await canUseRoomPermission('webhooks', 'Webhook management is disabled in this room.'))) return;
    const url = document.getElementById('rs-webhook-input')?.value.trim() || '';
    const channelId = document.getElementById('rs-webhook-channel')?.value || 'general';

    if (!url) {
        await remove(ref(db, `rooms_meta/${window.activeRoomId}/webhook`));
        await remove(ref(db, `rooms_meta/${window.activeRoomId}/webhookChannel`));
        await set(ref(db, `rooms_meta/${window.activeRoomId}/logs/${Date.now()}`), { text: `${window.userProfileName} removed the room webhook.`, timestamp: Date.now() });
        window.showToast("Webhook integration removed.", false);
        return;
    }

    await set(ref(db, `rooms_meta/${window.activeRoomId}/webhook`), {
        url,
        channelId,
        updatedAt: Date.now(),
        updatedBy: window.currentUser.uid,
    });
    await set(ref(db, `rooms_meta/${window.activeRoomId}/logs/${Date.now()}`), { text: `${window.userProfileName} updated the webhook for #${channelId}.`, timestamp: Date.now() });
    window.showToast(`Webhook saved for #${channelId}.`, false);
});

document.getElementById('rs-save-bots')?.addEventListener('click', async () => {
    if (!(await canUseRoomPermission('webhooks', 'Bot management is disabled in this room.'))) return;
    if (!window.activeRoomId || window.activeRoomId === 'global') return window.showToast('Bots are configured per room.');

    const cleanSymbols = (document.getElementById('rs-stock-symbols')?.value || '')
        .split(/[\s,]+/)
        .map(symbol => symbol.replace(/^\$/, '').trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 12)
        .join(', ');
    const cleanWords = (document.getElementById('rs-automod-words')?.value || '')
        .split(/[,|\n]/)
        .map(word => word.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 40)
        .join(', ');

    await set(ref(db, `rooms_meta/${window.activeRoomId}/bots`), {
        stockTracker: {
            enabled: document.getElementById('rs-stock-bot-enabled')?.checked === true,
            symbols: cleanSymbols,
            updatedAt: Date.now(),
            updatedBy: window.currentUser.uid,
        },
        autoModeration: {
            enabled: document.getElementById('rs-automod-bot-enabled')?.checked === true,
            blockedWords: cleanWords || 'spam, scam',
            blockLinks: document.getElementById('rs-automod-links')?.checked === true,
            blockCaps: true,
            blockFlood: true,
            updatedAt: Date.now(),
            updatedBy: window.currentUser.uid,
        },
    });
    await set(ref(db, `rooms_meta/${window.activeRoomId}/logs/${Date.now()}`), { text: `${window.userProfileName} updated the Bot Marketplace.`, timestamp: Date.now() });
    window.showToast('Bot Marketplace saved.', false);
});

document.getElementById('rs-save-room-subscription-btn')?.addEventListener('click', async () => {
    if (!window.activeRoomId || window.activeRoomId === 'global') return window.showToast('Room subscriptions are configured per private room.');
    const roomData = await getActiveRoomMeta();
    if (!isCurrentRoomCreator(roomData)) return window.showToast('Only the room creator can change room subscription.');

    const planId = getSelectedRoomSubscriptionPlan();
    const plan = ROOM_SUBSCRIPTION_PLANS[planId] || ROOM_SUBSCRIPTION_PLANS.base;
    const selectedUsers = plan.maxUsers ? readRoomSubscriptionSelection() : {};
    const selectedCount = Object.keys(selectedUsers).length;

    if (selectedCount > plan.maxUsers) {
        window.showToast(`${plan.label} can boost up to ${plan.maxUsers} users.`);
        return;
    }

    await set(ref(db, `rooms_meta/${window.activeRoomId}/roomSubscription`), {
        plan: planId,
        label: plan.label,
        priceLabel: plan.priceLabel,
        monthlyPrice: plan.monthlyPrice,
        maxSelectedUsers: plan.maxUsers,
        selectedUsers,
        features: plan.features,
        status: planId === 'base' ? 'inactive' : 'configured',
        updatedAt: Date.now(),
        updatedBy: window.currentUser.uid,
    });
    await set(ref(db, `rooms_meta/${window.activeRoomId}/logs/${Date.now()}`), {
        text: `${window.userProfileName} updated room subscription to ${plan.label}.`,
        timestamp: Date.now(),
    });
    window.showToast(
        planId === 'base'
            ? 'Room subscription reset to Base.'
            : `${plan.label} saved for ${selectedCount}/${plan.maxUsers} selected users. Add Stripe prices before charging.`,
        false,
    );
});

document.getElementById('rs-add-channel-btn')?.addEventListener('click', async () => {
    if (!(await canUseRoomPermission('createChannels', 'Channel creation is disabled in this room.'))) return;
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
    const roomData = await getActiveRoomMeta();
    if (!isCurrentRoomCreator(roomData)) return window.showToast('Only the room creator can change permissions.');

    const checked = id => document.getElementById(id)?.checked !== false;
    await set(ref(db, `rooms_meta/${window.activeRoomId}/permissions`), {
        chat: checked('perm-chat'),
        files: checked('perm-files'),
        polls: checked('perm-polls'),
        reminders: checked('perm-reminders'),
        docs: checked('perm-docs'),
        whiteboard: checked('perm-whiteboard'),
        calls: checked('perm-calls'),
        video: checked('perm-video'),
        screenShare: checked('perm-screen-share'),
        invites: checked('perm-invites'),
        createChannels: checked('perm-create-channels'),
        manageChannels: checked('perm-manage-channels'),
        webhooks: checked('perm-webhooks'),
        updatedAt: Date.now(),
        updatedBy: window.currentUser.uid,
    });
    await set(ref(db, `rooms_meta/${window.activeRoomId}/memberPermissions`), readMemberPermissionOverrides());
    await set(ref(db, `rooms_meta/${window.activeRoomId}/logs/${Date.now()}`), { text: `${window.userProfileName} updated room permissions.`, timestamp: Date.now() });
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
        await set(ref(db, `rooms_meta/${roomIdToLeave}/logs/${Date.now()}`), { text: `${window.userProfileName} left the room.`, timestamp: Date.now() });
        await remove(ref(db, `rooms_meta/${roomIdToLeave}/members/${window.currentUser.uid}`));
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
            await remove(ref(db, `rooms_data/${roomIdToDelete}`));
            await remove(ref(db, `rooms_meta/${roomIdToDelete}`));
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
