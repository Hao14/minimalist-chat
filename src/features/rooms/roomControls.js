// js/rooms.js
import { db } from '../../lib/firebase.js';
import { getStorageUploadTools } from '../../lib/firebaseStorage.js';
import { imageUploadMetadata, optimizeImageForUpload } from '../../lib/imageUploadOptimization.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ref, set, get, push, remove, serverTimestamp, update } from 'firebase/database';
import { mountChatCore, switchChatRoom } from '../chat-core/mountChatCore.js';
import { getAuthedJsonHeaders } from '../../lib/authToken.js';
import {
    disconnectRoomWebhookConnection,
    saveRoomWebhookConnection,
    testRoomWebhookConnection,
} from './roomPlatformService.js';
import {
    disconnectGoogleCalendarConnection,
    getGoogleCalendarConnectionState,
    GOOGLE_CALENDAR_CONNECTION_EVENT,
} from '../calendar/googleCalendarConnectionState.js';
import {
    RoomAuditLog,
    RoomChannelsList,
    RoomInvitePanel,
    RoomMembersList,
    RoomPicturePreview,
} from './RoomControlPanels.jsx';
import { ROOM_BILLING_PLANS, roomBillingPlan } from '../billing/roomBillingPlans.js';
import { normalizeRoomEntitlement } from '../billing/roomEntitlements.js';
import { createRoomActivity } from './roomActivity.js';
import {
    createRoomBillingPortal,
    createRoomCheckout,
    readRoomBillingReturn,
    syncRoomCheckout,
    updateRoomBenefitUsers,
} from '../billing/roomBillingService.js';
import {
    ROOM_PERMISSION_DEFAULTS,
    ROOM_PERMISSION_KEYS,
    ROOM_PERMISSION_LABELS,
    effectiveMemberPermissionEnabled,
    normalizeSparsePermissionOverrides,
    permissionEnabled,
    permissionInputId,
    permissionSummary,
} from './roomPermissions.js';

let roomBillingReturnHandled = false;

function clearRoomBillingReturnParams() {
    const url = new URL(window.location.href);
    ['room_billing', 'room_id', 'session_id'].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

async function handleRoomBillingReturn() {
    if (roomBillingReturnHandled) return;
    const billingReturn = readRoomBillingReturn();
    if (!billingReturn) return;
    roomBillingReturnHandled = true;

    try {
        if (billingReturn.status === 'success') {
            const result = await syncRoomCheckout({
                roomId: billingReturn.roomId,
                sessionId: billingReturn.sessionId,
            });
            const entitlement = normalizeRoomEntitlement(result.entitlement);
            window.showToast?.(
                `${roomBillingPlan(entitlement.plan).label} is active. Open Room subscription to add users to the plan.`,
                false,
            );
        } else if (billingReturn.status === 'cancelled') {
            window.showToast?.('Room checkout was cancelled. No room plan was changed.', false);
        } else if (billingReturn.status === 'portal-return') {
            window.showToast?.('Room billing details refreshed from Stripe.', false);
        }
    } catch (error) {
        console.error('Could not finish room billing return', error);
        window.showToast?.(error?.message || 'Room billing could not be confirmed. Open Room subscription to retry.');
    } finally {
        clearRoomBillingReturnParams();
    }
}

window.initializeRooms = function() {
    if (!window.currentUser?.uid) {
        throw new Error('Sign-in is still loading. Please refresh or sign in again.');
    }

    const chatCoreReady = mountChatCore({ user: window.currentUser });
    window.setTimeout(() => void handleRoomBillingReturn(), 0);

    if (window.innerWidth <= 768) {
        document.getElementById('desktop-room-sidebar')?.classList.add('open');
    }

    return chatCoreReady;
};
window.switchRoom = switchChatRoom;

// --- CREATE & JOIN ROOM LOGIC ---
let currentRoomActionMode = 'join'; 
const roomActionModal = document.getElementById('room-action-modal');
let roomActionReturnFocus = null;
const ROOM_PICTURE_MAX_BYTES = 5 * 1024 * 1024;
const ROOM_BANNER_MAX_BYTES = 8 * 1024 * 1024;
const reactRoots = new WeakMap();
const ROOM_TYPE_OPTIONS = {
    friends: { label: 'Friends group', description: 'Private-feeling space for close groups.' },
    community: { label: 'Community', description: 'Discoverable space for clubs, creators, teams, and communities.' },
};
const createRoomDraft = {
    step: 1,
    type: '',
    pictureFile: null,
    picturePreviewUrl: '',
};

function safeRoomIndexText(value, fallback, max = 180) {
    const text = String(value || fallback || '').trim();
    return text.slice(0, max) || String(fallback || '').slice(0, max);
}

function roomIndexPayload(roomId, room = {}) {
    return {
        name: safeRoomIndexText(room.name, roomId === 'global' ? 'Global Chat' : 'Room', 120),
        shortId: safeRoomIndexText(room.shortId, roomId === 'global' ? 'GLOBAL' : roomId, 40),
        lastMessage: safeRoomIndexText(room.lastMessage, '', 180),
        creatorId: safeRoomIndexText(room.creatorId, '', 128),
        updatedAt: Date.now(),
    };
}

async function writeMyRoomIndex(roomId, room = {}) {
    const uid = window.currentUser?.uid;
    if (!uid || !roomId || roomId === 'global') return;
    await set(ref(db, `user_rooms/${uid}/${roomId}`), roomIndexPayload(roomId, room)).catch((error) => {
        console.warn('Could not update room index', roomId, error);
    });
}

async function removeMyRoomIndex(roomId) {
    const uid = window.currentUser?.uid;
    if (!uid || !roomId || roomId === 'global') return;
    await remove(ref(db, `user_rooms/${uid}/${roomId}`)).catch((error) => {
        console.warn('Could not remove room index', roomId, error);
    });
}

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
    ['rs-room-picture-preview', 'rs-room-settings-picture'].forEach(id => {
        const preview = document.getElementById(id);
        if (preview) renderReact(preview, createElement(RoomPicturePreview, { url, initials: roomInitials(name) }));
    });
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
        ? `url("${url}")`
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

    const snapshot = await get(ref(db, `user_rooms/${window.currentUser?.uid}`)).catch(() => null);
    let created = 0;
    snapshot?.forEach?.(child => {
        const room = child.val() || {};
        if (child.key !== 'global' && room.creatorId === window.currentUser?.uid) created += 1;
    });

    if (created >= limit) {
        const label = tier === 'advanced' ? 'Advanced' : 'Base';
        window.showToast(`${label} can create up to ${limit} rooms. Upgrade to Pro for unlimited rooms.`);
        return false;
    }
    return true;
}

const ROOM_SUBSCRIPTION_PLANS = ROOM_BILLING_PLANS;
const MANAGEABLE_ROOM_SUBSCRIPTION_STATUSES = new Set([
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'paused',
]);

function hasManageableRoomSubscription(entitlement = {}) {
    return entitlement.plan !== 'base'
        && Boolean(entitlement.billingOwnerUid)
        && MANAGEABLE_ROOM_SUBSCRIPTION_STATUSES.has(entitlement.status);
}

function roomBillingStatusLabel(entitlement = {}) {
    if (entitlement.cancelAtPeriodEnd && entitlement.active) return 'Ending';
    if (entitlement.status === 'trialing') return 'Trialing';
    if (entitlement.status === 'past_due') return 'Past due';
    if (entitlement.status === 'unpaid') return 'Unpaid';
    if (entitlement.status === 'paused') return 'Paused';
    return entitlement.active ? 'Active' : 'Free';
}

let latestRoomSettingsData = null;
let latestRoomSubscriptionCanEdit = false;
let latestRoomBillingEntitlement = normalizeRoomEntitlement({});
let latestMemberPermissionOverrides = {};
let latestPermissionRoomData = {};
let latestPermissionCanEdit = false;
let activeMemberPermissionEditorUid = '';

function isCurrentRoomCreator(roomData = {}) {
    const uid = window.currentUser?.uid;
    if (!uid) return false;
    if (uid === window.MY_ADMIN_UID) return true;
    if (roomData.creatorId) return roomData.creatorId === uid;
    return Object.keys(roomData.members || {})[0] === uid;
}

function userPermissionEnabled(roomData = {}, key, uid = window.currentUser?.uid) {
    return effectiveMemberPermissionEnabled(roomData, key, uid);
}

async function getActiveRoomMeta(roomId = window.activeRoomId) {
    if (!roomId || roomId === 'global') return {};
    const snapshot = await get(ref(db, `rooms_meta/${roomId}`));
    return snapshot.val() || {};
}

async function canUseRoomPermission(key, deniedMessage, roomId = window.activeRoomId) {
    if (!roomId || roomId === 'global') return true;
    const roomData = await getActiveRoomMeta(roomId);
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

function updatePermissionSummary() {
    const permissions = Object.fromEntries(ROOM_PERMISSION_KEYS.map((key) => {
        const input = document.getElementById(permissionInputId(key));
        return [key, input?.checked ?? ROOM_PERMISSION_DEFAULTS[key]];
    }));
    const summary = permissionSummary(permissions);
    const overrideCount = Object.values(latestMemberPermissionOverrides).reduce(
        (count, overrides) => count + Object.keys(normalizeSparsePermissionOverrides(overrides)).length,
        0,
    );
    const allowedNode = document.getElementById('rs-permissions-allowed-count');
    const restrictedNode = document.getElementById('rs-permissions-restricted-count');
    const overridesNode = document.getElementById('rs-permissions-overrides-count');
    if (allowedNode) allowedNode.textContent = String(summary.allowed);
    if (restrictedNode) restrictedNode.textContent = String(summary.restricted);
    if (overridesNode) overridesNode.textContent = String(overrideCount);
}

function setPermissionSaveStatus(message, tone = '') {
    const status = document.getElementById('rs-permissions-save-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
}

function setPermissionSaveBusy(isBusy) {
    setControlDisabled('rs-save-permissions-btn', isBusy || !latestPermissionCanEdit);
    setControlDisabled('rs-reset-permissions-btn', isBusy || !latestPermissionCanEdit);
    setControlDisabled('rs-member-permission-search', isBusy);
    ROOM_PERMISSION_KEYS.forEach((key) => setControlDisabled(permissionInputId(key), isBusy || !latestPermissionCanEdit));
    document.querySelectorAll('#rs-member-permissions-list select')
        .forEach((control) => control.toggleAttribute('disabled', isBusy || !latestPermissionCanEdit));
    document.querySelectorAll('#rs-member-permissions-list button')
        .forEach((control) => control.toggleAttribute('disabled', isBusy));
}

function renderMemberPermissionRows() {
    const target = document.getElementById('rs-member-permissions-list');
    if (!target) return;

    const roomData = latestPermissionRoomData;
    const creatorId = roomData.creatorId || Object.keys(roomData.members || {})[0] || '';
    const searchTerm = String(document.getElementById('rs-member-permission-search')?.value || '')
        .trim()
        .toLocaleLowerCase();
    const members = Object.entries(roomData.members || {})
        .map(([uid, name]) => ({ uid, name: String(name || 'Member') }))
        .filter((member) => member.uid !== creatorId && member.uid !== window.MY_ADMIN_UID)
        .filter((member) => !searchTerm || member.name.toLocaleLowerCase().includes(searchTerm))
        .sort((a, b) => a.name.localeCompare(b.name));

    target.replaceChildren();
    if (!members.length) {
        const empty = document.createElement('div');
        empty.className = 'rs-empty-row';
        empty.textContent = searchTerm
            ? 'No members match that search.'
            : 'Other members appear here after they join this room.';
        target.appendChild(empty);
        updatePermissionSummary();
        return;
    }

    members.forEach((member) => {
        const overrides = latestMemberPermissionOverrides[member.uid] || {};
        const card = document.createElement('article');
        const isEditing = activeMemberPermissionEditorUid === member.uid;
        card.className = `member-permission-row${isEditing ? ' is-editing' : ''}`;
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
        const editButton = document.createElement('button');
        const editorId = `member-permission-editor-${member.uid}`;
        editButton.type = 'button';
        editButton.className = 'mini-btn member-permission-edit-btn';
        editButton.textContent = isEditing ? 'Close' : (latestPermissionCanEdit ? 'Edit access' : 'View access');
        editButton.setAttribute('aria-expanded', String(isEditing));
        editButton.setAttribute('aria-controls', editorId);
        editButton.addEventListener('click', () => {
            activeMemberPermissionEditorUid = isEditing ? '' : member.uid;
            renderMemberPermissionRows();
            const updatedRow = Array.from(target.querySelectorAll('.member-permission-row'))
                .find((row) => row.dataset.uid === member.uid);
            updatedRow?.querySelector('.member-permission-edit-btn')?.focus();
        });
        head.append(avatar, copy, editButton);

        card.append(head);
        if (isEditing) {
            const grid = document.createElement('div');
            grid.className = 'member-permission-grid';
            grid.id = editorId;
            grid.setAttribute('role', 'group');
            grid.setAttribute('aria-label', `${member.name} permission exceptions`);
            ROOM_PERMISSION_KEYS.forEach((key) => {
                const label = document.createElement('label');
                label.className = 'member-permission-select';

                const span = document.createElement('span');
                span.textContent = ROOM_PERMISSION_LABELS[key] || key;

                const select = document.createElement('select');
                select.dataset.uid = member.uid;
                select.dataset.key = key;
                select.disabled = !latestPermissionCanEdit;

                const defaultValue = permissionEnabled(roomData.permissions, key);
                [
                    ['', `Inherit · ${defaultValue ? 'Allow' : 'Deny'}`],
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
                select.addEventListener('change', () => {
                    const next = { ...(latestMemberPermissionOverrides[member.uid] || {}) };
                    if (!select.value) delete next[key];
                    else next[key] = select.value === 'true';
                    if (Object.keys(next).length) latestMemberPermissionOverrides[member.uid] = next;
                    else delete latestMemberPermissionOverrides[member.uid];
                    status.textContent = Object.keys(next).length
                        ? `${Object.keys(next).length} custom permission${Object.keys(next).length === 1 ? '' : 's'}`
                        : 'Using room defaults';
                    setPermissionSaveStatus('Unsaved permission changes.');
                    updatePermissionSummary();
                });

                label.append(span, select);
                grid.appendChild(label);
            });
            card.appendChild(grid);
        }

        target.appendChild(card);
    });
    updatePermissionSummary();
}

function renderMemberPermissionOverrides(roomData = {}, canEdit = false) {
    latestPermissionRoomData = roomData;
    latestPermissionCanEdit = canEdit;
    activeMemberPermissionEditorUid = '';
    latestMemberPermissionOverrides = Object.fromEntries(
        Object.entries(roomData.memberPermissions || {})
            .map(([uid, overrides]) => [uid, normalizeSparsePermissionOverrides(overrides)])
            .filter(([, overrides]) => Object.keys(overrides).length),
    );
    const search = document.getElementById('rs-member-permission-search');
    if (search) {
        search.value = '';
        search.disabled = false;
        search.oninput = renderMemberPermissionRows;
    }
    renderMemberPermissionRows();
}

function readMemberPermissionOverrides() {
    return Object.fromEntries(
        Object.entries(latestMemberPermissionOverrides)
            .map(([uid, overrides]) => [uid, normalizeSparsePermissionOverrides(overrides)])
            .filter(([, overrides]) => Object.keys(overrides).length),
    );
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

function roomBillingDateLabel(timestamp) {
    if (!Number(timestamp)) return '';
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(new Date(timestamp));
}

function setRoomBillingActionStatus(message, tone = '') {
    const status = document.getElementById('rs-room-billing-action-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
}

function setRoomBillingBusy(isBusy, message = '') {
    const lockedBySubscription = latestRoomBillingEntitlement.active;
    const canEdit = latestRoomSubscriptionCanEdit;
    document.querySelectorAll('input[name="rs-room-subscription-plan"]').forEach((radio) => {
        radio.disabled = isBusy || !canEdit || lockedBySubscription;
    });
    document.querySelectorAll('.rs-room-user-boost').forEach((input) => {
        input.disabled = isBusy || !canEdit || !lockedBySubscription;
    });
    setControlDisabled('rs-manage-room-billing-btn', isBusy || !canEdit);
    if (isBusy) setControlDisabled('rs-save-room-subscription-btn', true);
    else updateRoomSubscriptionCount();
    if (message) setRoomBillingActionStatus(message);
}

function updateRoomSubscriptionCount() {
    const entitlement = latestRoomBillingEntitlement;
    const hasSubscription = hasManageableRoomSubscription(entitlement);
    const planId = hasSubscription ? entitlement.plan : getSelectedRoomSubscriptionPlan();
    const plan = roomBillingPlan(planId);
    const assignmentUnlocked = entitlement.active;
    const countNode = document.getElementById('rs-room-subscription-count');
    const limitNode = document.getElementById('rs-room-subscription-limit');
    const actionButton = document.getElementById('rs-save-room-subscription-btn');
    const checkoutPlan = document.getElementById('rs-room-checkout-plan');
    const checkoutPrice = document.getElementById('rs-room-checkout-price');
    const checkoutRenewal = document.getElementById('rs-room-checkout-renewal');
    const selectedCount = assignmentUnlocked && plan.maxUsers
        ? document.querySelectorAll('.rs-room-user-boost:checked').length
        : 0;

    if (countNode) countNode.textContent = assignmentUnlocked ? `${selectedCount}/${plan.maxUsers}` : 'Locked';
    if (limitNode) {
        limitNode.textContent = assignmentUnlocked
            ? `Add up to ${plan.maxUsers} room members to ${plan.label}.`
            : 'Available after Stripe confirms the room subscription.';
    }
    if (checkoutPlan) checkoutPlan.textContent = plan.maxUsers ? plan.label : 'Choose a paid plan';
    if (checkoutPrice) checkoutPrice.textContent = plan.maxUsers ? plan.recurringPriceLabel : 'No charge selected';
    if (checkoutRenewal) {
        checkoutRenewal.textContent = entitlement.active
            ? (entitlement.cancelAtPeriodEnd ? 'Benefits remain available until the subscription ends.' : 'Your room subscription renews automatically until canceled.')
            : 'Paid room plans renew monthly until canceled.';
    }
    if (actionButton) {
        actionButton.textContent = entitlement.active
            ? 'Save added users'
            : (hasSubscription
                ? 'Manage subscription in Stripe'
                : (plan.maxUsers ? `Purchase ${plan.label} with Stripe` : 'Choose a paid plan'));
        actionButton.disabled = !latestRoomSubscriptionCanEdit
            || (hasSubscription && !entitlement.active)
            || (!hasSubscription && !plan.maxUsers);
    }

    Object.keys(ROOM_SUBSCRIPTION_PLANS).forEach((id) => {
        const radio = document.getElementById(`rs-room-plan-${id}`);
        const state = document.getElementById(`rs-room-plan-${id}-state`);
        const choice = radio?.closest('.room-plan-choice');
        const selected = id === planId;
        choice?.classList.toggle('is-current', selected);
        choice?.classList.toggle('is-unavailable', hasSubscription && !selected);
        choice?.setAttribute('aria-disabled', String(Boolean(radio?.disabled)));
        if (state) {
            state.textContent = entitlement.active && id === entitlement.plan
                ? 'Active'
                : (selected
                    ? (hasSubscription ? roomBillingStatusLabel(entitlement) : (id === 'base' ? 'Current' : 'Selected'))
                    : (hasSubscription ? 'Manage in Stripe' : 'Choose'));
        }
    });
}

function renderRoomSubscriptionMembers(roomData = {}, selectedUsers = {}, canEdit = false) {
    const list = document.getElementById('rs-room-subscription-user-list');
    if (!list) return;
    const section = document.getElementById('rs-room-subscription-members');
    const lock = document.getElementById('rs-room-subscription-lock');
    const assignmentUnlocked = latestRoomBillingEntitlement.active;

    section?.classList.toggle('is-locked', !assignmentUnlocked);
    section?.setAttribute('aria-disabled', assignmentUnlocked ? 'false' : 'true');
    lock?.classList.toggle('hidden', assignmentUnlocked);
    list.classList.toggle('hidden', !assignmentUnlocked);
    list.replaceChildren();

    if (!assignmentUnlocked) {
        updateRoomSubscriptionCount();
        return;
    }

    const planId = latestRoomBillingEntitlement.plan;
    const plan = roomBillingPlan(planId);
    const memberMap = new Map(Object.entries(roomData.members || {}).map(([uid, name]) => [
        uid,
        String(name || 'Member'),
    ]));
    if (roomData.creatorId && !memberMap.has(roomData.creatorId)) {
        memberMap.set(
            roomData.creatorId,
            roomData.creatorId === window.currentUser?.uid
                ? String(window.userProfileName || 'Room owner')
                : 'Room owner',
        );
    }
    const members = Array.from(memberMap, ([uid, name]) => ({ uid, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

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
        label.classList.toggle('is-selected', input.checked);

        const marker = document.createElement('span');
        marker.className = 'room-subscription-user-state';
        marker.textContent = 'Included';
        marker.hidden = !input.checked;
        marker.setAttribute('aria-hidden', String(!input.checked));

        input.addEventListener('change', () => {
            const selected = Array.from(document.querySelectorAll('.rs-room-user-boost:checked'));
            if (selected.length > plan.maxUsers) {
                input.checked = false;
                window.showToast?.(`${plan.label} supports up to ${plan.maxUsers} assigned members.`);
            }
            label.classList.toggle('is-selected', input.checked);
            marker.hidden = !input.checked;
            marker.setAttribute('aria-hidden', String(!input.checked));
            setRoomBillingActionStatus(
                latestRoomBillingEntitlement.active
                    ? 'Benefit assignment has unsaved changes.'
                    : 'Selection ready for secure Stripe Checkout.',
            );
            updateRoomSubscriptionCount();
        });

        const avatar = document.createElement('span');
        avatar.className = 'room-subscription-user-avatar';
        avatar.textContent = roomInitials(member.name);

        const copy = document.createElement('span');
        copy.className = 'room-subscription-user-copy';
        const strong = document.createElement('strong');
        strong.textContent = member.name;
        const small = document.createElement('small');
        small.textContent = member.uid === window.currentUser?.uid
            ? 'You · room benefit recipient'
            : 'Room member';
        copy.append(strong, small);

        label.append(input, avatar, copy, marker);
        list.appendChild(label);
    });

    updateRoomSubscriptionCount();
}

function renderRoomSubscriptionControls(roomData = {}, canEdit = false) {
    latestRoomSettingsData = roomData;
    latestRoomSubscriptionCanEdit = canEdit;
    latestRoomBillingEntitlement = normalizeRoomEntitlement(roomData.roomBillingEntitlement);
    const entitlement = latestRoomBillingEntitlement;
    const hasSubscription = hasManageableRoomSubscription(entitlement);
    const planId = hasSubscription ? entitlement.plan : 'base';
    const plan = roomBillingPlan(planId);

    Object.keys(ROOM_SUBSCRIPTION_PLANS).forEach((id) => {
        const radio = document.getElementById(`rs-room-plan-${id}`);
        if (!radio) return;
        radio.checked = id === planId;
        radio.disabled = !canEdit || hasSubscription;
        radio.onchange = () => {
            updateRoomSubscriptionCount();
            setRoomBillingActionStatus(
                radio.value === 'base'
                    ? 'Choose a paid plan to open Stripe Checkout.'
                    : `${roomBillingPlan(radio.value).label} selected. Purchase opens secure Stripe Checkout.`,
            );
        };
    });

    const currentPlan = document.getElementById('rs-room-billing-current-plan');
    const status = document.getElementById('rs-room-billing-status');
    const owner = document.getElementById('rs-room-billing-owner');
    const renewal = document.getElementById('rs-room-billing-renewal');
    const manageButton = document.getElementById('rs-manage-room-billing-btn');
    if (currentPlan) currentPlan.textContent = plan.label;
    if (status) {
        status.textContent = hasSubscription ? roomBillingStatusLabel(entitlement) : 'Free';
        status.dataset.state = hasSubscription ? entitlement.status : 'free';
        status.dataset.tone = entitlement.active
            ? (entitlement.cancelAtPeriodEnd ? 'warning' : 'success')
            : (hasSubscription ? 'warning' : 'neutral');
        status.classList.toggle('is-active', entitlement.active && !entitlement.cancelAtPeriodEnd);
    }
    if (owner) {
        owner.textContent = hasSubscription
            ? (entitlement.billingOwnerUid === window.currentUser?.uid ? 'You · room owner' : 'Room owner')
            : 'No billing owner';
    }
    if (renewal) {
        const date = roomBillingDateLabel(entitlement.currentPeriodEnd);
        renewal.textContent = entitlement.active
            ? (date
                ? `${entitlement.cancelAtPeriodEnd ? 'Access ends' : 'Renews'} ${date}`
                : 'Stripe subscription active')
            : (hasSubscription ? 'Payment needs attention in Stripe' : 'No recurring room charge');
    }
    manageButton?.classList.toggle('hidden', !hasSubscription || !canEdit);
    if (manageButton) manageButton.disabled = !hasSubscription || !canEdit;

    renderRoomSubscriptionMembers(
        roomData,
        entitlement.active ? entitlement.selectedUsers : {},
        canEdit,
    );
    setRoomBillingActionStatus(
        canEdit
            ? (entitlement.active
                ? 'Add users to the plan here. Plan changes and cancellation open in Stripe’s billing portal.'
                : (hasSubscription
                    ? 'Open Stripe to update payment details or manage this room subscription. Benefits stay locked until payment is active.'
                    : 'Choose a paid plan to open Stripe Checkout. Add users unlocks after payment succeeds.'))
            : 'Only the room owner can manage this subscription.',
    );
}

function maskWebhookEndpoint(rawUrl = '') {
    try {
        const parsed = new URL(String(rawUrl || '').trim());
        const tail = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean).at(-1) || '';
        const maskedTail = tail ? `••••${tail.slice(-4)}` : '';
        return `${parsed.hostname}${maskedTail ? `/${maskedTail}` : ''}`;
    } catch {
        return '';
    }
}

function webhookConfigFromRoom(roomData = {}) {
    const connection = roomData.connections?.webhook || {};
    const legacy = roomData.webhook;
    const legacyUrl = typeof legacy === 'object' ? String(legacy.url || '').trim() : String(legacy || '').trim();
    const connected = connection.connected === true || Boolean(legacyUrl);
    return {
        connected,
        endpointLabel: String(connection.maskedUrl || connection.endpointLabel || '').trim() || maskWebhookEndpoint(legacyUrl),
        channelId: String(connection.channelId || (typeof legacy === 'object' ? legacy.channelId : '') || roomData.webhookChannel || 'general'),
        health: String(connection.status || connection.health || (connected ? 'unknown' : 'disconnected')),
        lastTestAt: Number(connection.lastTestAt || 0),
        lastDeliveryAt: Number(connection.lastDeliveryAt || 0),
    };
}

function botConfigFromRoom(roomData = {}) {
    const bots = roomData.bots || {};
    const stockInstalled = Object.prototype.hasOwnProperty.call(bots, 'stockTracker');
    const autoModerationInstalled = Object.prototype.hasOwnProperty.call(bots, 'autoModeration');
    const stockTracker = bots.stockTracker || {};
    const autoModeration = bots.autoModeration || {};
    return {
        stockTracker: {
            installed: stockInstalled,
            enabled: stockTracker.enabled === true,
            symbols: String(stockTracker.symbols || ''),
        },
        autoModeration: {
            installed: autoModerationInstalled,
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

function setPlatformStatus(id, label, tone = 'neutral') {
    const status = document.getElementById(id);
    if (!status) return;
    const dot = status.querySelector('.apps-status-dot');
    const text = status.querySelector('span:last-child');
    if (dot) dot.className = `apps-status-dot is-${tone}`;
    if (text) text.textContent = label;
}

function formatPlatformTimestamp(value) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '';
    try {
        return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(Number(value));
    } catch {
        return '';
    }
}

function renderPlatformManager(roomData = {}, { canManageBots = false, canManageConnections = false } = {}) {
    const botConfig = botConfigFromRoom(roomData);
    const webhookConfig = webhookConfigFromRoom(roomData);
    const installedBots = [botConfig.stockTracker.installed, botConfig.autoModeration.installed].filter(Boolean).length;
    const connectedRoomServices = webhookConfig.connected ? 1 : 0;

    const botCount = document.getElementById('rs-platform-bot-count');
    const installedCount = document.getElementById('rs-installed-count');
    const connectionCount = document.getElementById('rs-platform-connection-count');
    if (botCount) botCount.textContent = String(installedBots);
    if (installedCount) installedCount.textContent = `${installedBots} installed`;
    if (connectionCount) connectionCount.textContent = String(connectedRoomServices);

    const stockRow = document.getElementById('rs-installed-stock-row');
    const automodRow = document.getElementById('rs-installed-automod-row');
    stockRow?.classList.toggle('hidden', !botConfig.stockTracker.installed);
    automodRow?.classList.toggle('hidden', !botConfig.autoModeration.installed);
    document.getElementById('rs-installed-empty')?.classList.toggle('hidden', installedBots > 0);

    setPlatformStatus('rs-stock-status', botConfig.stockTracker.enabled ? 'Active' : botConfig.stockTracker.installed ? 'Paused' : 'Not installed', botConfig.stockTracker.enabled ? 'healthy' : 'neutral');
    setPlatformStatus('rs-automod-status', botConfig.autoModeration.enabled ? 'Active' : botConfig.autoModeration.installed ? 'Paused' : 'Not installed', botConfig.autoModeration.enabled ? 'healthy' : 'neutral');
    const stockAction = document.getElementById('rs-stock-market-action');
    const automodAction = document.getElementById('rs-automod-market-action');
    if (stockAction) stockAction.textContent = botConfig.stockTracker.installed ? 'Configure watcher' : 'Install watcher';
    if (automodAction) automodAction.textContent = botConfig.autoModeration.installed ? 'Configure guard' : 'Install guard';

    const webhookLabel = document.getElementById('rs-webhook-endpoint-label');
    const webhookChannel = document.getElementById('rs-webhook-channel-label');
    const webhookHealth = document.getElementById('rs-webhook-health-copy');
    if (webhookLabel) webhookLabel.textContent = webhookConfig.endpointLabel || 'No endpoint configured';
    if (webhookChannel) webhookChannel.textContent = webhookConfig.connected ? `#${webhookConfig.channelId}` : '—';
    const healthLabel = webhookConfig.health === 'healthy'
        ? 'Healthy'
        : webhookConfig.health === 'error'
            ? 'Needs attention'
            : webhookConfig.connected ? 'Not tested' : 'Not connected';
    setPlatformStatus('rs-webhook-status', healthLabel, webhookConfig.health === 'healthy' ? 'healthy' : webhookConfig.health === 'error' ? 'error' : 'neutral');
    if (webhookHealth) {
        const checkedAt = formatPlatformTimestamp(webhookConfig.lastTestAt || webhookConfig.lastDeliveryAt);
        webhookHealth.textContent = checkedAt ? `${healthLabel} · Last checked ${checkedAt}` : `${healthLabel}.`;
    }

    ['rs-stock-bot-enabled', 'rs-stock-symbols', 'rs-automod-bot-enabled', 'rs-automod-words', 'rs-automod-links',
        'rs-automod-caps', 'rs-automod-flood', 'rs-save-stock-bot', 'rs-remove-stock-bot', 'rs-save-automod-bot', 'rs-remove-automod-bot']
        .forEach(id => setControlDisabled(id, !canManageBots));
    setControlDisabled('rs-remove-stock-bot', !canManageBots || !botConfig.stockTracker.installed);
    setControlDisabled('rs-remove-automod-bot', !canManageBots || !botConfig.autoModeration.installed);
    ['rs-webhook-input', 'rs-webhook-channel', 'rs-save-webhook']
        .forEach(id => setControlDisabled(id, !canManageConnections));
    ['rs-test-webhook', 'rs-test-webhook-detail', 'rs-disconnect-webhook']
        .forEach(id => setControlDisabled(id, !canManageConnections || !webhookConfig.connected));
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

function updateCreateRoomPreview() {
    const name = document.getElementById('create-room-name-input')?.value?.trim() || '';
    const namePreview = document.getElementById('room-create-preview-name');
    const nameCount = document.getElementById('create-room-name-count');
    const typePreview = document.getElementById('room-create-preview-type');
    const privacyCopy = document.getElementById('room-create-privacy-copy');
    const privacyIcon = document.getElementById('room-create-privacy-icon');
    const reviewAvatar = document.getElementById('room-create-review-avatar');
    const type = ROOM_TYPE_OPTIONS[createRoomDraft.type];

    if (namePreview) namePreview.textContent = name || 'Your room name';
    if (nameCount) nameCount.textContent = `${name.length} / 42`;
    if (typePreview) typePreview.textContent = type?.label || 'Choose a room type';
    if (privacyCopy) privacyCopy.textContent = createRoomDraft.type === 'community'
        ? 'Discoverable · anyone can request to join'
        : 'Private · invited people only';
    if (privacyIcon) privacyIcon.className = `ph-bold ${createRoomDraft.type === 'community' ? 'ph-globe-hemisphere-west' : 'ph-lock-key'}`;
    if (reviewAvatar) {
        if (createRoomDraft.picturePreviewUrl) reviewAvatar.innerHTML = `<img src="${createRoomDraft.picturePreviewUrl}" alt="">`;
        else reviewAvatar.innerHTML = name
            ? `<span>${name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()}</span>`
            : '<i class="ph-bold ph-chats"></i>';
    }
}

function resetCreateRoomDraft() {
    revokeCreateRoomPicturePreview();
    createRoomDraft.step = 1;
    createRoomDraft.type = '';
    createRoomDraft.pictureFile = null;

    document.querySelectorAll('.room-type-option').forEach((button) => {
        button.classList.remove('selected');
        button.setAttribute('aria-pressed', 'false');
    });
    const nameInput = document.getElementById('create-room-name-input');
    if (nameInput) nameInput.value = '';
    const pictureInput = document.getElementById('create-room-picture-input');
    if (pictureInput) pictureInput.value = '';
    const preview = document.getElementById('create-room-picture-preview');
    if (preview) preview.innerHTML = '<i class="ph-bold ph-image"></i>';
    updateCreateRoomPreview();
}

function setRoomCreateStep(step) {
    createRoomDraft.step = step;
    setHidden('room-create-type-step', step !== 1);
    setHidden('room-create-details-step', step !== 2);
    setHidden('room-create-back-btn', step === 1);
    const wizard = document.getElementById('create-room-wizard');
    if (wizard) wizard.dataset.step = String(step);

    const stepLabel = document.getElementById('room-create-step-label');
    if (stepLabel) stepLabel.textContent = '1 · Room type';

    const typePill = document.getElementById('room-create-type-pill');
    if (typePill) typePill.textContent = '2 · Details';

    const submit = document.getElementById('room-action-submit');
    if (submit) submit.textContent = step === 1 ? 'Next' : 'Create room';

    setRoomActionSubtitle(step === 1
        ? 'Choose who this space is for.'
        : 'Name the room, add an optional picture, then review it.');

    if (step === 2) {
        updateCreateRoomPreview();
        setTimeout(() => document.getElementById('create-room-name-input')?.focus(), 0);
    } else setTimeout(() => document.querySelector('.room-type-option')?.focus(), 0);
}

function selectCreateRoomType(type) {
    if (!ROOM_TYPE_OPTIONS[type]) return;
    createRoomDraft.type = type;
    document.querySelectorAll('.room-type-option').forEach((button) => {
        button.classList.toggle('selected', button.dataset.roomType === type);
        button.setAttribute('aria-pressed', button.dataset.roomType === type ? 'true' : 'false');
    });
    updateCreateRoomPreview();
}

function openCreateRoomModal() {
    currentRoomActionMode = 'create';
    roomActionReturnFocus = document.activeElement;
    resetCreateRoomDraft();
    document.getElementById('room-action-title').textContent = 'Create room';
    setHidden('room-join-fields', true);
    setHidden('create-room-wizard', false);
    setRoomCreateStep(1);
    if (roomActionModal) {
        roomActionModal.dataset.mode = 'create';
        roomActionModal.classList.remove('hidden');
        roomActionModal.setAttribute('aria-hidden', 'false');
    }
}

function openJoinRoomModal(prefill = '') {
    currentRoomActionMode = 'join';
    roomActionReturnFocus = document.activeElement;
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
    if(roomActionModal) {
        roomActionModal.dataset.mode = 'join';
        roomActionModal.classList.remove('hidden');
        roomActionModal.setAttribute('aria-hidden', 'false');
    }
    setTimeout(() => document.getElementById('room-action-input')?.focus(), 0);
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
    const inviteSnapshot = await get(ref(db, `room_invites/${code}`));
    const invite = inviteSnapshot.val() || {};
    const roomId = invite.roomId || '';
    const roomSnapshot = roomId ? await get(ref(db, `rooms_meta/${roomId}`)) : null;
    const room = roomSnapshot?.val?.() || null;
    const foundRoom = room ? { key: roomId, ...room } : null;

    return { code, targetShortId, inviterId, foundRoom };
}

function closeRoomActionModal() {
    if (document.getElementById('room-action-submit')?.disabled) return;
    resetCreateRoomDraft();
    if (!roomActionModal) return;
    roomActionModal.classList.add('hidden');
    roomActionModal.setAttribute('aria-hidden', 'true');
    if (roomActionReturnFocus instanceof HTMLElement && document.contains(roomActionReturnFocus)) {
        roomActionReturnFocus.focus();
    }
    roomActionReturnFocus = null;
}

function joinRoomEndpoint() {
    return window.JOIN_ROOM_ENDPOINT || 'https://us-central1-chat-app-356c1.cloudfunctions.net/joinRoomByInvite';
}

async function joinRoomThroughGateway(code) {
    const response = await fetch(joinRoomEndpoint(), {
        method: 'POST',
        headers: await getAuthedJsonHeaders('Please sign in first, then the invite link will continue.'),
        body: JSON.stringify({
            code,
            displayName: window.userProfileName || window.currentUser?.displayName || 'Anonymous',
            photoUrl: window.currentUser?.photoURL || '',
        }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Room invite failed.');
    return data;
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
        let joined;
        try {
            joined = await joinRoomThroughGateway(code);
        } catch (gatewayError) {
            const localDev = /^localhost$|^127\.0\.0\.1$/.test(window.location.hostname || '');
            if (!localDev) throw gatewayError;

            const fallback = await findRoomByInviteCode(code);
            if (!fallback.foundRoom) throw gatewayError;
            const canSelfJoinFallback = Boolean(
                fallback.foundRoom.members?.[window.currentUser.uid]
                || fallback.foundRoom.public === true
                || fallback.foundRoom.discovery?.enabled === true
            );
            if (!canSelfJoinFallback) throw gatewayError;
            joined = {
                room: { id: fallback.foundRoom.key, key: fallback.foundRoom.key, ...fallback.foundRoom },
                inviterId: fallback.inviterId,
                alreadyMember: Boolean(fallback.foundRoom.members?.[window.currentUser.uid]),
            };
        }

        const foundRoom = joined.room || null;
        if (!foundRoom) {
            window.showToast("Room ID not found. Check for typos!");
            if (openModalOnFailure) openJoinRoomModal(rawValue);
            return false;
        }

        const roomId = foundRoom.key || foundRoom.id;
        const alreadyMember = Boolean(joined.alreadyMember || foundRoom.members?.[window.currentUser.uid]);
        if (!alreadyMember && !joined.joinedByServer) {
            const now = Date.now();
            const logText = joined.inviterId
                ? `${window.userProfileName} joined via invite link from user #${joined.inviterId}.`
                : `${window.userProfileName} joined the room.`;
            const eventCode = joined.inviterId ? 'member_joined_via_invite' : 'member_joined';
            await update(ref(db), {
                [`user_rooms/${window.currentUser.uid}/${roomId}`]: roomIndexPayload(roomId, foundRoom),
                [`rooms_meta/${roomId}/members/${window.currentUser.uid}`]: window.userProfileName,
                [`rooms_meta/${roomId}/logs/${now}`]: createRoomActivity(eventCode, {
                    actor: window.userProfileName,
                    inviterId: joined.inviterId,
                }, logText, now),
            });

            if (window.createNotification && foundRoom.creatorId) {
                window.createNotification(foundRoom.creatorId, 'room', `${window.userProfileName || 'Someone'} joined your room!`, {
                    groupId: roomId,
                    roomId,
                    roomName: foundRoom.name || 'Room',
                    shortId: foundRoom.shortId || '',
                    from: window.userProfileName || 'Someone',
                });
            }

            await sendAiWelcomeMessage(roomId, foundRoom.name, window.userProfileName || 'new member');
        } else {
            await writeMyRoomIndex(roomId, foundRoom);
        }

        if(roomActionModal) {
            roomActionModal.classList.add('hidden');
            roomActionModal.setAttribute('aria-hidden', 'true');
        }
        document.getElementById('room-invite-modal')?.classList.add('hidden');
        window.switchRoom(roomId, foundRoom.name, foundRoom.shortId);
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
    const uid = window.currentUser?.uid;
    if (!uid) return;

    const text = buildAiWelcomeText(roomName, joinedName);
    const preview = `AI Agent: Welcome ${joinedName || 'a new member'}!`;

    try {
        await set(push(ref(db, `rooms_data/${roomId}/messages`)), {
            uid,
            name: 'AI Agent',
            photoUrl: window.userPhotoUrl || window.currentUser?.photoURL || '',
            text,
            timestamp: serverTimestamp(),
            tier: window.userTier || 'free',
            bot: true,
            botName: 'AI Agent',
            requestedBy: uid,
            requestedByName: window.userProfileName || window.currentUser?.displayName || joinedName || 'Someone',
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

function inviteCodeFromLink(inviteLink) {
    return normalizeRoomInviteCode(inviteLink);
}

async function publishRoomInvite(inviteLink, roomId = window.activeRoomId) {
    const code = inviteCodeFromLink(inviteLink);
    if (!code || !roomId || roomId === 'global') return;
    await set(ref(db, `room_invites/${code}`), {
        roomId,
        shortId: safeRoomIndexText(window.activeRoomShortId, '', 40),
        inviterUid: window.currentUser?.uid || '',
        createdAt: Date.now(),
    }).catch((error) => {
        console.warn('Could not publish room invite', error);
    });
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
                photoUrl: window.getAvatarUrl?.(name, user.photoUrl) || '',
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
    await publishRoomInvite(inviteLink);
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
    const cancel = document.getElementById('room-action-cancel-btn');
    if (submit) {
        submit.disabled = isBusy;
        if (currentRoomActionMode === 'create' && createRoomDraft.step === 2) {
            submit.textContent = isBusy ? 'Creating…' : 'Create room';
        } else if (currentRoomActionMode === 'join') {
            submit.textContent = isBusy ? 'Joining…' : 'Join';
        }
    }
    if (back) back.disabled = isBusy;
    if (close) close.disabled = isBusy;
    if (cancel) cancel.disabled = isBusy;
    ['create-room-name-input', 'create-room-picture-input', 'room-action-input'].forEach((id) => {
        const control = document.getElementById(id);
        if (control) control.disabled = isBusy;
    });
    document.querySelectorAll('.room-type-option').forEach((button) => {
        button.toggleAttribute('disabled', isBusy);
    });
}

async function uploadCreateRoomPicture(roomId) {
    const file = createRoomDraft.pictureFile;
    if (!file) return '';
    const uploadFile = await optimizeImageForUpload(file, { maxWidth: 512, maxHeight: 512 });
    const safeName = (uploadFile.name || file.name).replace(/[^a-z0-9_.-]/gi, '_').slice(-80);
    const { getDownloadURL, storage, storageRef, uploadBytesResumable } = await getStorageUploadTools();
    const target = storageRef(storage, `room_pictures/${roomId}/${Date.now()}_${safeName}`);
    await uploadBytesResumable(target, uploadFile, imageUploadMetadata(uploadFile, { versioned: true }));
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
        const roomCreatedAt = Date.now();
        const createdLogText = `${window.userProfileName} created the ${roomKind.label.toLowerCase()} room.`;
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
            permissions: {
                chat: true,
                files: true,
                polls: true,
                reminders: true,
                docs: true,
                whiteboard: true,
                calls: true,
                video: true,
                screenShare: true,
                invites: true,
                createChannels: true,
                manageChannels: false,
                manageBots: false,
                manageConnections: false,
                webhooks: false,
                updatedAt: Date.now(),
                updatedBy: window.currentUser.uid,
            },
            members: { [window.currentUser.uid]: window.userProfileName },
            logs: {
                [roomCreatedAt]: createRoomActivity('room_created', {
                    actor: window.userProfileName,
                    subject: createRoomDraft.type,
                }, createdLogText, roomCreatedAt),
            },
        };
        if (photoUrl) payload.photoUrl = photoUrl;

        await update(ref(db), {
            [`rooms_meta/${newRoomRef.key}`]: payload,
            [`user_rooms/${window.currentUser.uid}/${newRoomRef.key}`]: roomIndexPayload(newRoomRef.key, payload),
        });
        await publishRoomInvite(`${window.location.origin}/join/${newShortId}-${window.userShortId}`, newRoomRef.key);
        if (roomActionModal) {
            roomActionModal.classList.add('hidden');
            roomActionModal.setAttribute('aria-hidden', 'true');
        }
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
    closeRoomActionModal();
});

document.getElementById('room-action-cancel-btn')?.addEventListener('click', closeRoomActionModal);

roomActionModal?.addEventListener('click', (event) => {
    if (event.target === roomActionModal) closeRoomActionModal();
});

document.querySelectorAll('.room-type-option').forEach((button) => {
    button.addEventListener('click', () => {
        selectCreateRoomType(button.dataset.roomType);
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

    if (!file) {
        updateCreateRoomPreview();
        return;
    }
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
    updateCreateRoomPreview();
});

document.getElementById('create-room-name-input')?.addEventListener('input', updateCreateRoomPreview);

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
    setRoomActionBusy(true);
    try {
        await joinRoomFromInvite(rawVal, { openModalOnFailure: false });
    } finally {
        setRoomActionBusy(false);
    }
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

document.addEventListener('keydown', (event) => {
    if (!roomActionModal || roomActionModal.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeRoomActionModal();
        return;
    }
    if (event.key === 'Tab') {
        const focusable = [...document.querySelectorAll('#room-action-card button:not([disabled]):not(.hidden), #room-action-card input:not([disabled]):not(.hidden), #room-action-card label[for]')]
            .filter((element) => element.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
});

let roomSettingsLoadVersion = 0;
let roomSettingsReturnFocus = null;

function setRoomSettingsLoading(isLoading, status = isLoading ? 'Loading' : 'Ready') {
    const card = document.getElementById('room-settings-card');
    const content = card?.querySelector('.room-settings-content');
    const statusNode = document.getElementById('rs-room-settings-status');
    card?.classList.toggle('is-loading', isLoading);
    card?.classList.toggle('has-load-error', !isLoading && status === 'Could not load');
    content?.setAttribute('aria-busy', String(isLoading));
    if (statusNode) statusNode.textContent = status;
}

function setRoomSettingsHeader(data = {}) {
    const name = String(data.name || 'Room').trim() || 'Room';
    const nameNode = document.getElementById('rs-room-settings-name');
    const privacyNode = document.getElementById('rs-room-settings-privacy');
    if (nameNode) nameNode.textContent = name;
    if (privacyNode) {
        const discoverable = data.discovery?.enabled === true || data.discoverable === true;
        privacyNode.textContent = discoverable ? 'Discoverable room' : 'Private room';
    }
    renderRoomPicturePreview(data.photoUrl || '', name);
}

document.getElementById('room-drop-settings')?.addEventListener('click', async () => {
    if (window.activeRoomId === 'global') return window.showToast("Settings not available for Global Chat.", true);
    const roomId = window.activeRoomId;
    const loadVersion = ++roomSettingsLoadVersion;
    const modal = document.getElementById('room-settings-modal');
    const activeElement = document.activeElement;
    roomSettingsReturnFocus = activeElement?.closest?.('#room-settings-dropdown')
        ? document.getElementById('room-name-wrapper')
        : activeElement;
    document.getElementById('room-settings-dropdown')?.classList.add('hidden');
    modal?.classList.remove('hidden');
    modal?.setAttribute('aria-hidden', 'false');
    setRoomSettingsLoading(true);
    requestAnimationFrame(() => {
        const activeTab = document.querySelector('#room-settings-card .settings-tab.active');
        activeTab?.focus({ preventScroll: true });
    });

    try {
        const [roomSnap, billingSnap] = await Promise.all([
            get(ref(db, `rooms_meta/${roomId}`)),
            get(ref(db, `room_billing/${roomId}/entitlement`)).catch((error) => {
                console.warn('Could not load room billing entitlement', error?.code || error?.message || error);
                return null;
            }),
        ]);
        if (loadVersion !== roomSettingsLoadVersion || modal?.classList.contains('hidden')) return;
        if (window.activeRoomId !== roomId) {
            closeRoomSettings();
            return;
        }
        if (!roomSnap.exists()) throw new Error('This room is no longer available.');

        const data = {
            ...roomSnap.val(),
            roomBillingEntitlement: billingSnap?.val?.() || {},
        };
        setRoomSettingsHeader(data);
        const isCreator = isCurrentRoomCreator(data);
        const canCreateChannels = isCreator || userPermissionEnabled(data, 'createChannels');
        const canManageChannels = isCreator || userPermissionEnabled(data, 'manageChannels');
        const canManageBots = isCreator || userPermissionEnabled(data, 'manageBots');
        const canManageConnections = isCreator || userPermissionEnabled(data, 'manageConnections');
        
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
                        const now = Date.now();
                        const logText = `${window.userProfileName} kicked ${member.name}.`;
                        await update(ref(db), {
                            [`rooms_meta/${roomId}/members/${member.uid}`]: null,
                            [`rooms_meta/${roomId}/logs/${now}`]: createRoomActivity('member_removed', {
                                actor: window.userProfileName,
                                target: member.name,
                            }, logText, now),
                        });
                        window.showToast(`${member.name} was kicked.`, false);
                        document.getElementById('room-drop-settings')?.click();
                    }
                },
            }));
        }
        
        const webhookConfig = webhookConfigFromRoom(data);
        const webhookInput = document.getElementById('rs-webhook-input');
        if (webhookInput) {
            webhookInput.value = '';
            webhookInput.placeholder = webhookConfig.connected
                ? 'Paste a new HTTPS URL to replace the saved endpoint'
                : 'https://hooks.example.com/...';
        }
        populateWebhookChannelSelect(data, webhookConfig.channelId);
        const botConfig = botConfigFromRoom(data);
        setControlChecked('rs-stock-bot-enabled', botConfig.stockTracker.enabled);
        setControlValue('rs-stock-symbols', botConfig.stockTracker.symbols);
        setControlChecked('rs-automod-bot-enabled', botConfig.autoModeration.enabled);
        setControlValue('rs-automod-words', botConfig.autoModeration.blockedWords);
        setControlChecked('rs-automod-links', botConfig.autoModeration.blockLinks);
        setControlChecked('rs-automod-caps', botConfig.autoModeration.blockCaps);
        setControlChecked('rs-automod-flood', botConfig.autoModeration.blockFlood);
        resetPlatformButtonsBusyState();
        renderPlatformManager(data, { canManageBots, canManageConnections });
        renderGoogleCalendarConnectionStatus();
        activatePlatformView('installed');
        setControlDisabled('rs-channel-input', !canCreateChannels);
        setControlDisabled('rs-add-channel-btn', !canCreateChannels);
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
                    if (!(await canUseRoomPermission('manageChannels', 'Channel management is disabled in this room.', roomId))) return;
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
                        remove(ref(db, `rooms_meta/${roomId}/channels/${id}`)),
                        remove(ref(db, `room_calls/${roomId}/channels/${id}`)),
                    ]);
                    window.showToast(`#${id} deleted.`, false);
                    document.getElementById('room-drop-settings')?.click();
                },
            }));
        }

        const permissions = data.permissions || {};
        ROOM_PERMISSION_KEYS.forEach((key) => {
            const input = document.getElementById(permissionInputId(key));
            if (!input) return;
            input.checked = permissionEnabled(permissions, key);
            input.disabled = !isCreator;
            input.onchange = () => {
                setPermissionSaveStatus('Unsaved permission changes.');
                updatePermissionSummary();
            };
        });
        setControlDisabled('rs-save-permissions-btn', !isCreator);
        setControlDisabled('rs-reset-permissions-btn', !isCreator);
        renderMemberPermissionOverrides(data, isCreator);
        setPermissionSaveStatus(
            isCreator ? 'Changes apply after you save.' : 'Only the room owner can change access.',
        );
        
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
        setRoomSettingsLoading(false, 'Ready');
    } catch (error) {
        if (loadVersion !== roomSettingsLoadVersion || modal?.classList.contains('hidden')) return;
        if (window.activeRoomId !== roomId) {
            closeRoomSettings();
            return;
        }
        setRoomSettingsLoading(false, 'Could not load');
        window.showToast(error?.message || 'Room settings could not be loaded.');
    }
});

const rsTabs = ['overview', 'members', 'channels', 'permissions', 'webhooks', 'subscription', 'logs'];
const roomSettingsCompactQuery = window.matchMedia('(max-width: 900px)');

function syncRoomSettingsTabOrientation() {
    document.querySelector('#room-settings-card .settings-tablist')
        ?.setAttribute('aria-orientation', roomSettingsCompactQuery.matches ? 'horizontal' : 'vertical');
}

function resetRoomSettingsContentScroll() {
    const content = document.querySelector('#room-settings-card .room-settings-content');
    if (!content) return;
    content.scrollTop = 0;
    content.scrollLeft = 0;
    requestAnimationFrame(() => {
        content.scrollTop = 0;
        content.scrollLeft = 0;
    });
}

syncRoomSettingsTabOrientation();
roomSettingsCompactQuery.addEventListener?.('change', syncRoomSettingsTabOrientation);

function activateRoomSettingsTab(tab, { focus = false } = {}) {
    const previousTab = rsTabs.find((key) => document.getElementById(`rs-tab-${key}`)?.classList.contains('active'));
    rsTabs.forEach(key => {
        const tabButton = document.getElementById(`rs-tab-${key}`);
        const pane = document.getElementById(`rs-pane-${key}`);
        const isActive = key === tab;
        tabButton?.classList.toggle('active', isActive);
        tabButton?.setAttribute('aria-selected', String(isActive));
        if (tabButton) tabButton.tabIndex = isActive ? 0 : -1;
        pane?.classList.toggle('hidden', !isActive);
        pane?.setAttribute('aria-hidden', String(!isActive));
    });

    const activeButton = document.getElementById(`rs-tab-${tab}`);
    if (previousTab !== tab) {
        resetRoomSettingsContentScroll();
    }
    if (focus) activeButton?.focus({ preventScroll: true });
    if (roomSettingsCompactQuery.matches) {
        activeButton?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
}

rsTabs.forEach(tab => {
    const btn = document.getElementById(`rs-tab-${tab}`);
    if (!btn) return;
    btn.addEventListener('click', () => activateRoomSettingsTab(tab));
    btn.addEventListener('keydown', event => {
        const currentIndex = rsTabs.indexOf(tab);
        let targetIndex = currentIndex;
        if (event.key === 'Home') targetIndex = 0;
        else if (event.key === 'End') targetIndex = rsTabs.length - 1;
        else if (['ArrowRight', 'ArrowDown'].includes(event.key)) targetIndex = (currentIndex + 1) % rsTabs.length;
        else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) targetIndex = (currentIndex - 1 + rsTabs.length) % rsTabs.length;
        else return;
        event.preventDefault();
        activateRoomSettingsTab(rsTabs[targetIndex], { focus: true });
    });
});

function closeRoomSettings() {
    roomSettingsLoadVersion += 1;
    const modal = document.getElementById('room-settings-modal');
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    setRoomSettingsLoading(false, 'Ready');
    const returnTarget = roomSettingsReturnFocus;
    roomSettingsReturnFocus = null;
    if (returnTarget?.isConnected) requestAnimationFrame(() => returnTarget.focus({ preventScroll: true }));
}

document.getElementById('close-room-settings-btn')?.addEventListener('click', closeRoomSettings);
document.getElementById('close-room-settings-x')?.addEventListener('click', closeRoomSettings);
document.getElementById('room-settings-modal')?.addEventListener('click', (event) => {
    if (event.target?.id === 'room-settings-modal') closeRoomSettings();
});
document.getElementById('room-settings-modal')?.addEventListener('keydown', event => {
    const modal = document.getElementById('room-settings-modal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (event.key === 'Escape') {
        if (document.querySelector('#rs-pane-webhooks:not(.hidden) [data-rs-platform-detail]:not(.hidden)')) {
            event.preventDefault();
            event.stopPropagation();
            closePlatformDetail();
            return;
        }
        const nestedDialogOpen = ['leave-room-modal', 'delete-room-modal']
            .some(id => !document.getElementById(id)?.classList.contains('hidden'));
        if (!nestedDialogOpen) {
            event.preventDefault();
            event.stopPropagation();
            closeRoomSettings();
        }
        return;
    }

    if (event.key !== 'Tab') return;
    const focusable = Array.from(modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(node => !node.closest('.hidden') && node.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
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
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return;

    const roomSnap = await get(ref(db, `rooms_meta/${roomId}`));
    const roomData = roomSnap.val() || {};
    if (!isCurrentRoomCreator(roomData)) return window.showToast('Only the room creator can change the room picture.');

    const input = document.getElementById('rs-room-picture-input');
    const file = input?.files?.[0];
    if (!file) return window.showToast('Choose a room picture first.');
    if (!file.type?.startsWith('image/')) return window.showToast('Choose an image file for the room picture.');
    if (file.size > ROOM_PICTURE_MAX_BYTES) return window.showToast('Room picture must be 5MB or smaller.');

    setRoomPictureBusy(true);
    try {
        const uploadFile = await optimizeImageForUpload(file, { maxWidth: 512, maxHeight: 512 });
        const safeName = (uploadFile.name || file.name).replace(/[^a-z0-9_.-]/gi, '_').slice(-80);
        const { getDownloadURL, storage, storageRef, uploadBytesResumable } = await getStorageUploadTools();
        const target = storageRef(storage, `room_pictures/${roomId}/${Date.now()}_${safeName}`);
        await uploadBytesResumable(target, uploadFile, imageUploadMetadata(uploadFile, { versioned: true }));
        const photoUrl = await getDownloadURL(target);
        const now = Date.now();
        const logText = `${window.userProfileName} updated the room picture.`;
        await update(ref(db), {
            [`rooms_meta/${roomId}/photoUrl`]: photoUrl,
            [`rooms_meta/${roomId}/logs/${now}`]: createRoomActivity('room_picture_updated', { actor: window.userProfileName }, logText, now),
        });
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
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return;
    let removedPicture = false;

    const roomSnap = await get(ref(db, `rooms_meta/${roomId}`));
    const roomData = roomSnap.val() || {};
    if (!isCurrentRoomCreator(roomData)) return window.showToast('Only the room creator can change the room picture.');

    setRoomPictureBusy(true);
    try {
        const now = Date.now();
        const logText = `${window.userProfileName} removed the room picture.`;
        await update(ref(db), {
            [`rooms_meta/${roomId}/photoUrl`]: null,
            [`rooms_meta/${roomId}/logs/${now}`]: createRoomActivity('room_picture_removed', { actor: window.userProfileName }, logText, now),
        });
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
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return;

    const roomSnap = await get(ref(db, `rooms_meta/${roomId}`));
    const roomData = roomSnap.val() || {};
    if (!isCurrentRoomCreator(roomData)) return window.showToast('Only the room creator can change the room banner.');

    const input = document.getElementById('rs-room-banner-input');
    const file = input?.files?.[0];
    if (!file) return window.showToast('Choose a room banner first.');
    if (!file.type?.startsWith('image/')) return window.showToast('Choose an image file for the room banner.');
    if (file.size > ROOM_BANNER_MAX_BYTES) return window.showToast('Room banner must be 8MB or smaller.');

    setRoomBannerBusy(true);
    try {
        const uploadFile = await optimizeImageForUpload(file, { maxWidth: 1600, maxHeight: 900 });
        const safeName = (uploadFile.name || file.name).replace(/[^a-z0-9_.-]/gi, '_').slice(-80);
        const { getDownloadURL, storage, storageRef, uploadBytesResumable } = await getStorageUploadTools();
        const target = storageRef(storage, `room_banners/${roomId}/${Date.now()}_${safeName}`);
        await uploadBytesResumable(target, uploadFile, imageUploadMetadata(uploadFile, { versioned: true }));
        const bannerUrl = await getDownloadURL(target);
        const now = Date.now();
        const logText = `${window.userProfileName} updated the room banner.`;
        await update(ref(db), {
            [`rooms_meta/${roomId}/bannerUrl`]: bannerUrl,
            [`rooms_meta/${roomId}/logs/${now}`]: createRoomActivity('room_banner_updated', { actor: window.userProfileName }, logText, now),
        });
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
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return;
    const roomSnap = await get(ref(db, `rooms_meta/${roomId}`));
    const roomData = roomSnap.val() || {};
    if (!isCurrentRoomCreator(roomData)) return window.showToast('Only the room creator can change the room banner.');

    setRoomBannerBusy(true);
    try {
        const now = Date.now();
        const logText = `${window.userProfileName} removed the room banner.`;
        await update(ref(db), {
            [`rooms_meta/${roomId}/bannerUrl`]: null,
            [`rooms_meta/${roomId}/logs/${now}`]: createRoomActivity('room_banner_removed', { actor: window.userProfileName }, logText, now),
        });
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
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return;
    const roomSnap = await get(ref(db, `rooms_meta/${roomId}`));
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
        const now = Date.now();
        const logText = `${window.userProfileName} updated room identity.`;
        await update(ref(db), {
            [`rooms_meta/${roomId}/description`]: description,
            [`rooms_meta/${roomId}/topic`]: topic,
            [`rooms_meta/${roomId}/category`]: category,
            [`rooms_meta/${roomId}/template`]: template,
            [`rooms_meta/${roomId}/discovery`]: {
                enabled: discoveryEnabled,
                recommendations,
                updatedAt: now,
                updatedBy: window.currentUser.uid,
            },
            [`rooms_meta/${roomId}/logs/${now}`]: createRoomActivity('room_identity_updated', { actor: window.userProfileName }, logText, now),
        });
        window.showToast('Room identity saved.', false);
        window.loadRoomHome?.();
    } catch (error) {
        window.showToast(`Could not save room identity: ${error.message}`);
    } finally {
        setRoomIdentityBusy(false);
    }
});

let activePlatformView = 'installed';
let platformDetailReturnFocus = null;

function setPlatformActionStatus(message = '', tone = 'neutral') {
    const status = document.getElementById('rs-platform-action-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
}

function activatePlatformView(view = 'installed', { focus = false } = {}) {
    const nextView = ['installed', 'marketplace', 'connections'].includes(view) ? view : 'installed';
    const changedView = activePlatformView !== nextView;
    activePlatformView = nextView;
    platformDetailReturnFocus = null;

    document.querySelectorAll('[data-rs-platform-detail]').forEach((detail) => {
        detail.classList.add('hidden');
        detail.setAttribute('aria-hidden', 'true');
    });
    document.querySelectorAll('[data-rs-platform-main]').forEach((node) => node.classList.remove('hidden'));

    document.querySelectorAll('[data-rs-platform-tab]').forEach((button) => {
        if (button.getAttribute('role') !== 'tab') return;
        const selected = button.dataset.rsPlatformTab === nextView;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.tabIndex = selected ? 0 : -1;
        if (selected && focus) button.focus();
    });
    ['installed', 'marketplace', 'connections'].forEach((key) => {
        const panel = document.getElementById(`rs-platform-view-${key}`);
        if (!panel) return;
        const selected = key === nextView;
        panel.classList.toggle('hidden', !selected);
        panel.setAttribute('aria-hidden', selected ? 'false' : 'true');
    });
    if (changedView) {
        resetRoomSettingsContentScroll();
    }
    setPlatformActionStatus('');
}

function openPlatformDetail(detailKey, source = null) {
    const detail = document.getElementById(`rs-platform-detail-${detailKey}`);
    if (!detail) return;
    platformDetailReturnFocus = source?.isConnected ? source : null;
    const sourcePanel = source?.closest?.('[id^="rs-platform-view-"]');
    if (sourcePanel?.id) activePlatformView = sourcePanel.id.replace('rs-platform-view-', '');
    const currentBots = botConfigFromRoom(latestRoomSettingsData || {});
    if (source?.id === 'rs-stock-market-action' && !currentBots.stockTracker.installed) {
        document.getElementById('rs-stock-bot-enabled').checked = true;
    }
    if (source?.id === 'rs-automod-market-action' && !currentBots.autoModeration.installed) {
        document.getElementById('rs-automod-bot-enabled').checked = true;
    }

    document.querySelectorAll('[data-rs-platform-main]').forEach((node) => node.classList.add('hidden'));
    document.querySelectorAll('[data-rs-platform-detail]').forEach((node) => {
        const selected = node === detail;
        node.classList.toggle('hidden', !selected);
        node.setAttribute('aria-hidden', selected ? 'false' : 'true');
    });
    resetRoomSettingsContentScroll();
    detail.querySelector('input:not([type="checkbox"]), input[type="checkbox"], textarea, select, button')?.focus();
    setPlatformActionStatus('');
}

function closePlatformDetail() {
    const returnTarget = platformDetailReturnFocus;
    const returnView = activePlatformView;
    activatePlatformView(returnView);
    requestAnimationFrame(() => {
        if (returnTarget?.isConnected && !returnTarget.closest('.hidden') && returnTarget.getClientRects().length > 0) {
            returnTarget.focus({ preventScroll: true });
            return;
        }
        document.querySelector('.apps-local-tab[aria-selected="true"]')?.focus({ preventScroll: true });
    });
}

document.querySelectorAll('[data-rs-platform-tab]').forEach((button) => {
    button.addEventListener('click', () => activatePlatformView(button.dataset.rsPlatformTab, { focus: true }));
    if (button.getAttribute('role') !== 'tab') return;
    button.addEventListener('keydown', (event) => {
        const tabs = Array.from(document.querySelectorAll('.apps-local-tab[role="tab"]'));
        const index = tabs.indexOf(button);
        if (index < 0) return;
        let nextIndex = index;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else return;
        event.preventDefault();
        tabs[nextIndex]?.click();
    });
});
document.querySelectorAll('[data-rs-open-detail]').forEach((button) => {
    button.addEventListener('click', () => openPlatformDetail(button.dataset.rsOpenDetail, button));
});
document.querySelectorAll('[data-rs-close-detail]').forEach((button) => {
    button.addEventListener('click', closePlatformDetail);
});

let platformActionSequence = 0;

function createPlatformActionContext(roomId = window.activeRoomId) {
    return {
        roomId: String(roomId || ''),
        settingsVersion: roomSettingsLoadVersion,
        token: `platform-${++platformActionSequence}`,
    };
}

function isPlatformActionContextCurrent(context) {
    const modal = document.getElementById('room-settings-modal');
    return Boolean(context?.roomId)
        && context.roomId === window.activeRoomId
        && context.settingsVersion === roomSettingsLoadVersion
        && !modal?.classList.contains('hidden');
}

function setPlatformButtonsBusy(ids, busy, busyLabel = 'Working…', token = '') {
    ids.forEach((id) => {
        const button = document.getElementById(id);
        if (!button) return;
        if (busy) {
            if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent;
            button.dataset.platformBusyToken = token;
            button.textContent = busyLabel;
            button.disabled = true;
        } else {
            if (token && button.dataset.platformBusyToken !== token) return;
            button.textContent = button.dataset.idleLabel || button.textContent;
            delete button.dataset.idleLabel;
            delete button.dataset.platformBusyToken;
            button.disabled = false;
        }
    });
}

function resetPlatformButtonsBusyState() {
    document.querySelectorAll('[data-platform-busy-token]').forEach((button) => {
        button.textContent = button.dataset.idleLabel || button.textContent;
        delete button.dataset.idleLabel;
        delete button.dataset.platformBusyToken;
    });
}

function renderLatestPlatformManager() {
    const roomData = latestRoomSettingsData || {};
    const isCreator = isCurrentRoomCreator(roomData);
    renderPlatformManager(roomData, {
        canManageBots: isCreator || userPermissionEnabled(roomData, 'manageBots'),
        canManageConnections: isCreator || userPermissionEnabled(roomData, 'manageConnections'),
    });
}

async function refreshPlatformManager(roomId = window.activeRoomId, context = createPlatformActionContext(roomId)) {
    if (!roomId || roomId === 'global') return;
    const snapshot = await get(ref(db, `rooms_meta/${roomId}`));
    if (!isPlatformActionContextCurrent(context)) return false;
    const roomData = snapshot.val() || {};
    latestRoomSettingsData = roomData;
    const botConfig = botConfigFromRoom(roomData);
    setControlChecked('rs-stock-bot-enabled', botConfig.stockTracker.enabled);
    setControlValue('rs-stock-symbols', botConfig.stockTracker.symbols);
    setControlChecked('rs-automod-bot-enabled', botConfig.autoModeration.enabled);
    setControlValue('rs-automod-words', botConfig.autoModeration.blockedWords);
    setControlChecked('rs-automod-links', botConfig.autoModeration.blockLinks);
    setControlChecked('rs-automod-caps', botConfig.autoModeration.blockCaps);
    setControlChecked('rs-automod-flood', botConfig.autoModeration.blockFlood);
    renderLatestPlatformManager();
    renderGoogleCalendarConnectionStatus();
    return true;
}

async function persistRoomBot(botId, { removeApp = false } = {}) {
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return window.showToast('Room apps are configured per room.');
    if (!(await canUseRoomPermission('manageBots', 'App management is disabled in this room.', roomId))) return;
    if (window.activeRoomId !== roomId) return;

    const actionContext = createPlatformActionContext(roomId);
    const isStock = botId === 'stockTracker';
    const buttonIds = isStock
        ? ['rs-save-stock-bot', 'rs-remove-stock-bot']
        : ['rs-save-automod-bot', 'rs-remove-automod-bot'];
    setPlatformButtonsBusy(buttonIds, true, removeApp ? 'Removing…' : 'Saving…', actionContext.token);
    setPlatformActionStatus(removeApp ? 'Removing room app…' : 'Saving room app…');

    try {
        const now = Date.now();
        if (removeApp) {
            await remove(ref(db, `rooms_meta/${roomId}/bots/${botId}`));
        } else if (isStock) {
            const cleanSymbols = (document.getElementById('rs-stock-symbols')?.value || '')
                .split(/[\s,]+/)
                .map(symbol => symbol.replace(/^\$/, '').trim().toUpperCase())
                .filter(Boolean)
                .slice(0, 12)
                .join(', ');
            await set(ref(db, `rooms_meta/${roomId}/bots/stockTracker`), {
                enabled: document.getElementById('rs-stock-bot-enabled')?.checked === true,
                symbols: cleanSymbols,
                updatedAt: now,
                updatedBy: window.currentUser.uid,
            });
        } else {
            const cleanWords = (document.getElementById('rs-automod-words')?.value || '')
                .split(/[,|\n]/)
                .map(word => word.trim().toLowerCase())
                .filter(Boolean)
                .slice(0, 40)
                .join(', ');
            await set(ref(db, `rooms_meta/${roomId}/bots/autoModeration`), {
                enabled: document.getElementById('rs-automod-bot-enabled')?.checked === true,
                blockedWords: cleanWords || 'spam, scam',
                blockLinks: document.getElementById('rs-automod-links')?.checked === true,
                blockCaps: document.getElementById('rs-automod-caps')?.checked !== false,
                blockFlood: document.getElementById('rs-automod-flood')?.checked !== false,
                updatedAt: now,
                updatedBy: window.currentUser.uid,
            });
        }

        const displayName = isStock ? 'Ticker mention watcher' : 'Basic Message Filter';
        const logText = `${window.userProfileName} ${removeApp ? 'removed' : 'updated'} ${displayName}.`;
        await set(ref(db, `rooms_meta/${roomId}/logs/${now}`), createRoomActivity(
            removeApp ? 'room_app_removed' : 'room_app_updated',
            { actor: window.userProfileName, subject: displayName },
            logText,
            now,
        ));
        if (!(await refreshPlatformManager(roomId, actionContext))) return;
        const enabledId = isStock ? 'rs-stock-bot-enabled' : 'rs-automod-bot-enabled';
        const enabled = document.getElementById(enabledId)?.checked === true && !removeApp;
        activatePlatformView(removeApp ? 'marketplace' : 'installed');
        if (removeApp) {
            setPlatformActionStatus(`${displayName} removed.`, 'success');
            window.showToast(`${displayName} removed.`, false);
        } else {
            const stateLabel = enabled ? 'Active' : 'Paused';
            setPlatformActionStatus(`${displayName} saved · ${stateLabel}.`, 'success');
            window.showToast(`${displayName} saved (${stateLabel.toLowerCase()}).`, false);
        }
    } catch (error) {
        if (isPlatformActionContextCurrent(actionContext)) {
            setPlatformActionStatus(error.message || 'Room app could not be saved.', 'error');
            window.showToast(`Could not save room app: ${error.message}`);
        }
    } finally {
        if (isPlatformActionContextCurrent(actionContext)) {
            setPlatformButtonsBusy(buttonIds, false, 'Working…', actionContext.token);
            renderLatestPlatformManager();
        }
    }
}

document.getElementById('rs-save-stock-bot')?.addEventListener('click', () => persistRoomBot('stockTracker'));
document.getElementById('rs-save-automod-bot')?.addEventListener('click', () => persistRoomBot('autoModeration'));
document.getElementById('rs-remove-stock-bot')?.addEventListener('click', async () => {
    if (await window.appConfirm?.({
        kicker: 'Room app',
        title: 'Remove ticker mention watcher?',
        message: 'Automatic ticker replies will stop. The built-in /stock command remains available.',
        confirmText: 'Remove',
        destructive: true,
    })) await persistRoomBot('stockTracker', { removeApp: true });
});
document.getElementById('rs-remove-automod-bot')?.addEventListener('click', async () => {
    if (await window.appConfirm?.({
        kicker: 'Room app',
        title: 'Remove Basic Message Filter?',
        message: 'Supported clients will stop checking outgoing room messages.',
        confirmText: 'Remove',
        destructive: true,
    })) await persistRoomBot('autoModeration', { removeApp: true });
});

document.getElementById('rs-save-webhook')?.addEventListener('click', async () => {
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return window.showToast('Connections are configured per room.');
    if (!(await canUseRoomPermission('manageConnections', 'Connection management is disabled in this room.', roomId))) return;
    if (window.activeRoomId !== roomId) return;
    const url = document.getElementById('rs-webhook-input')?.value.trim() || '';
    const channelId = document.getElementById('rs-webhook-channel')?.value || 'general';
    if (!url) {
        setPlatformActionStatus('Paste the complete HTTPS webhook URL before saving.', 'error');
        document.getElementById('rs-webhook-input')?.focus();
        return;
    }

    const actionContext = createPlatformActionContext(roomId);
    setPlatformButtonsBusy(['rs-save-webhook', 'rs-test-webhook-detail', 'rs-disconnect-webhook'], true, 'Saving…', actionContext.token);
    setPlatformActionStatus('Validating and saving the connection…');
    try {
        await saveRoomWebhookConnection({ roomId, url, channelId });
        const input = document.getElementById('rs-webhook-input');
        if (input) input.value = '';
        if (!(await refreshPlatformManager(roomId, actionContext))) return;
        activatePlatformView('connections');
        setPlatformActionStatus('Webhook connected. Run a test whenever the destination changes.', 'success');
        window.showToast(`Webhook connected to #${channelId}.`, false);
    } catch (error) {
        if (isPlatformActionContextCurrent(actionContext)) {
            setPlatformActionStatus(error.message || 'Webhook could not be saved.', 'error');
            window.showToast(error.message || 'Webhook could not be saved.');
        }
    } finally {
        if (isPlatformActionContextCurrent(actionContext)) {
            setPlatformButtonsBusy(['rs-save-webhook', 'rs-test-webhook-detail', 'rs-disconnect-webhook'], false, 'Working…', actionContext.token);
            renderLatestPlatformManager();
        }
    }
});

async function testActiveRoomWebhook() {
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return window.showToast('Connections are configured per room.');
    if (!(await canUseRoomPermission('manageConnections', 'Connection management is disabled in this room.', roomId))) return;
    if (window.activeRoomId !== roomId) return;
    const actionContext = createPlatformActionContext(roomId);
    setPlatformButtonsBusy(['rs-test-webhook', 'rs-test-webhook-detail'], true, 'Testing…', actionContext.token);
    setPlatformActionStatus('Sending a safe test payload…');
    try {
        await testRoomWebhookConnection({ roomId });
        if (!(await refreshPlatformManager(roomId, actionContext))) return;
        setPlatformActionStatus('Webhook test delivered successfully.', 'success');
        window.showToast('Webhook test delivered.', false);
    } catch (error) {
        await refreshPlatformManager(roomId, actionContext).catch(() => false);
        if (isPlatformActionContextCurrent(actionContext)) {
            setPlatformActionStatus(error.message || 'Webhook test failed.', 'error');
            window.showToast(error.message || 'Webhook test failed.');
        }
    } finally {
        if (isPlatformActionContextCurrent(actionContext)) {
            setPlatformButtonsBusy(['rs-test-webhook', 'rs-test-webhook-detail'], false, 'Working…', actionContext.token);
            renderLatestPlatformManager();
        }
    }
}
document.getElementById('rs-test-webhook')?.addEventListener('click', testActiveRoomWebhook);
document.getElementById('rs-test-webhook-detail')?.addEventListener('click', testActiveRoomWebhook);

document.getElementById('rs-disconnect-webhook')?.addEventListener('click', async () => {
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return;
    if (!(await canUseRoomPermission('manageConnections', 'Connection management is disabled in this room.', roomId))) return;
    const confirmed = await window.appConfirm?.({
        kicker: 'Room connection',
        title: 'Disconnect outgoing webhook?',
        message: 'New room messages will stop being sent to the external endpoint.',
        confirmText: 'Disconnect',
        destructive: true,
    });
    if (!confirmed) return;

    if (window.activeRoomId !== roomId) return;
    const actionContext = createPlatformActionContext(roomId);
    setPlatformButtonsBusy(['rs-save-webhook', 'rs-test-webhook-detail', 'rs-disconnect-webhook'], true, 'Disconnecting…', actionContext.token);
    setPlatformActionStatus('Disconnecting webhook…');
    try {
        await disconnectRoomWebhookConnection({ roomId });
        if (!(await refreshPlatformManager(roomId, actionContext))) return;
        activatePlatformView('connections');
        setPlatformActionStatus('Webhook disconnected.', 'success');
        window.showToast('Webhook disconnected.', false);
    } catch (error) {
        if (isPlatformActionContextCurrent(actionContext)) {
            setPlatformActionStatus(error.message || 'Webhook could not be disconnected.', 'error');
            window.showToast(error.message || 'Webhook could not be disconnected.');
        }
    } finally {
        if (isPlatformActionContextCurrent(actionContext)) {
            setPlatformButtonsBusy(['rs-save-webhook', 'rs-test-webhook-detail', 'rs-disconnect-webhook'], false, 'Working…', actionContext.token);
            renderLatestPlatformManager();
        }
    }
});

let googleCalendarDisconnecting = false;

function renderGoogleCalendarConnectionStatus() {
    const connected = getGoogleCalendarConnectionState(window.currentUser?.uid);
    const disconnectButton = document.getElementById('rs-disconnect-google-calendar');
    setPlatformStatus(
        'rs-google-calendar-status',
        googleCalendarDisconnecting ? 'Disconnecting…' : connected ? 'Connected on this device' : 'Not connected',
        connected ? 'healthy' : 'neutral',
    );
    if (disconnectButton) {
        disconnectButton.classList.toggle('hidden', !connected && !googleCalendarDisconnecting);
        disconnectButton.disabled = googleCalendarDisconnecting || !connected;
        disconnectButton.textContent = googleCalendarDisconnecting ? 'Disconnecting…' : 'Disconnect';
        disconnectButton.setAttribute('aria-busy', String(googleCalendarDisconnecting));
    }
}
window.addEventListener(GOOGLE_CALENDAR_CONNECTION_EVENT, renderGoogleCalendarConnectionStatus);
document.getElementById('rs-disconnect-google-calendar')?.addEventListener('click', async () => {
    const connectionUid = String(window.currentUser?.uid || '');
    if (!connectionUid || googleCalendarDisconnecting) return;

    googleCalendarDisconnecting = true;
    renderGoogleCalendarConnectionStatus();
    setPlatformActionStatus('Disconnecting Google Calendar…');
    try {
        const result = await disconnectGoogleCalendarConnection(connectionUid);
        if (String(window.currentUser?.uid || '') !== connectionUid) return;
        if (!result.disconnected) throw new Error('Google Calendar could not be disconnected.');
        if (result.hadToken && !result.revoked) {
            setPlatformActionStatus('Disconnected on this device, but Google token revocation could not be confirmed.', 'error');
            window.showToast('Google Calendar disconnected here, but token revocation could not be confirmed.');
        } else {
            setPlatformActionStatus('Google Calendar disconnected.', 'success');
            window.showToast('Google Calendar disconnected.', false);
        }
    } catch (error) {
        if (String(window.currentUser?.uid || '') === connectionUid) {
            setPlatformActionStatus(error.message || 'Google Calendar could not be disconnected.', 'error');
            window.showToast(error.message || 'Google Calendar could not be disconnected.');
        }
    } finally {
        googleCalendarDisconnecting = false;
        renderGoogleCalendarConnectionStatus();
    }
});
document.getElementById('rs-open-google-calendar')?.addEventListener('click', () => {
    closeRoomSettings();
    const calendarTab = document.getElementById('room-tab-calendar');
    if (calendarTab) {
        calendarTab.click();
        return;
    }
    window.loadRoomCalendar?.();
    window.showToast('Calendar opened. Use its Google Calendar banner to connect or disconnect.', false);
});
document.getElementById('rs-save-room-subscription-btn')?.addEventListener('click', async () => {
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return window.showToast('Room subscriptions are configured per private room.');
    if (hasManageableRoomSubscription(latestRoomBillingEntitlement) && !latestRoomBillingEntitlement.active) {
        setRoomBillingActionStatus('Use Manage subscription to update payment details in Stripe.', 'error');
        window.showToast('Open Manage subscription to fix this room’s billing status.');
        return;
    }
    let redirecting = false;
    setRoomBillingBusy(true, latestRoomBillingEntitlement.active ? 'Saving benefit assignment…' : 'Creating secure Stripe Checkout…');
    try {
        const roomData = await getActiveRoomMeta(roomId);
        if (!isCurrentRoomCreator(roomData)) throw new Error('Only the room creator can change room subscription.');

        if (latestRoomBillingEntitlement.active) {
            const selectedUserIds = Object.keys(readRoomSubscriptionSelection());
            const result = await updateRoomBenefitUsers({ roomId, selectedUserIds });
            latestRoomBillingEntitlement = normalizeRoomEntitlement(result.entitlement);
            latestRoomSettingsData = {
                ...(latestRoomSettingsData || roomData),
                roomBillingEntitlement: result.entitlement,
            };
            renderRoomSubscriptionControls(latestRoomSettingsData, true);
            setRoomBillingActionStatus('Benefit assignment saved.', 'success');
            window.showToast('Room benefit assignment saved.', false);
            return;
        }

        const planId = getSelectedRoomSubscriptionPlan();
        const plan = roomBillingPlan(planId);
        if (!plan.maxUsers) throw new Error('Choose Advanced Room or Pro Room first.');
        const result = await createRoomCheckout({
            roomId,
            plan: planId,
            selectedUserIds: [],
            origin: window.location.origin,
        });
        if (!result.url) throw new Error('Stripe did not return a checkout URL.');
        redirecting = true;
        setRoomBillingActionStatus(`Opening Stripe Checkout for ${plan.label}…`);
        window.location.assign(result.url);
    } catch (error) {
        console.error('Could not update room subscription', error);
        setRoomBillingActionStatus(error?.message || 'Room subscription could not be updated.', 'error');
        window.showToast(error?.message || 'Room subscription could not be updated.');
    } finally {
        if (!redirecting) setRoomBillingBusy(false);
    }
});

document.getElementById('rs-manage-room-billing-btn')?.addEventListener('click', async () => {
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return window.showToast('Room billing is configured per private room.');
    let redirecting = false;
    setRoomBillingBusy(true, 'Opening Stripe billing portal…');
    try {
        const result = await createRoomBillingPortal({ roomId, origin: window.location.origin });
        if (!result.url) throw new Error('Stripe did not return a billing portal URL.');
        redirecting = true;
        window.location.assign(result.url);
    } catch (error) {
        console.error('Could not open room billing portal', error);
        setRoomBillingActionStatus(error?.message || 'Room billing portal could not be opened.', 'error');
        window.showToast(error?.message || 'Room billing portal could not be opened.');
    } finally {
        if (!redirecting) setRoomBillingBusy(false);
    }
});

document.getElementById('rs-add-channel-btn')?.addEventListener('click', async () => {
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return window.showToast('Channels are configured per room.');
    if (!(await canUseRoomPermission('createChannels', 'Channel creation is disabled in this room.', roomId))) return;
    const input = document.getElementById('rs-channel-input');
    const clean = (input?.value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    if (!clean) return window.showToast('Enter a channel name first.');
    await set(ref(db, `rooms_meta/${roomId}/channels/${clean}`), {
        name: clean,
        by: window.currentUser.uid,
        createdAt: Date.now(),
    });
    if (input) input.value = '';
    window.showToast(`#${clean} created.`, false);
    document.getElementById('room-drop-settings')?.click();
});

document.getElementById('rs-reset-permissions-btn')?.addEventListener('click', () => {
    if (!latestRoomSettingsData || !latestPermissionCanEdit) return;
    ROOM_PERMISSION_KEYS.forEach((key) => {
        const input = document.getElementById(permissionInputId(key));
        if (input) input.checked = permissionEnabled(latestRoomSettingsData.permissions, key);
    });
    renderMemberPermissionOverrides(latestRoomSettingsData, latestPermissionCanEdit);
    setPermissionSaveStatus('Unsaved changes reset to the last saved access policy.');
});

document.getElementById('rs-save-permissions-btn')?.addEventListener('click', async () => {
    const roomId = window.activeRoomId;
    if (!roomId || roomId === 'global') return window.showToast('Permissions are configured per private room.');
    setPermissionSaveBusy(true);
    setPermissionSaveStatus('Saving access policy…');
    try {
        const roomData = await getActiveRoomMeta(roomId);
        if (!isCurrentRoomCreator(roomData)) throw new Error('Only the room creator can change permissions.');

        const missingKey = ROOM_PERMISSION_KEYS.find((key) => !document.getElementById(permissionInputId(key)));
        if (missingKey) throw new Error(`The ${ROOM_PERMISSION_LABELS[missingKey]} control did not load. Reopen settings and try again.`);

        const now = Date.now();
        const permissions = Object.fromEntries(ROOM_PERMISSION_KEYS.map((key) => [
            key,
            document.getElementById(permissionInputId(key)).checked === true,
        ]));
        const memberPermissions = readMemberPermissionOverrides();
        await update(ref(db), {
            [`rooms_meta/${roomId}/permissions`]: {
                ...permissions,
                updatedAt: now,
                updatedBy: window.currentUser.uid,
            },
            [`rooms_meta/${roomId}/memberPermissions`]: Object.keys(memberPermissions).length ? memberPermissions : null,
            [`rooms_meta/${roomId}/logs/${now}`]: {
                ...createRoomActivity(
                    'room_permissions_updated',
                    { actor: window.userProfileName },
                    `${window.userProfileName} updated room permissions.`,
                    now,
                ),
            },
        });

        latestRoomSettingsData = {
            ...(latestRoomSettingsData || roomData),
            permissions,
            memberPermissions,
        };
        renderMemberPermissionOverrides(latestRoomSettingsData, true);
        setPermissionSaveStatus('Access policy saved.', 'success');
        window.showToast('Room permissions saved.', false);
    } catch (error) {
        console.error('Could not save room permissions', error);
        setPermissionSaveStatus(error?.message || 'Could not save permissions.', 'error');
        window.showToast(error?.message || 'Could not save permissions.');
    } finally {
        setPermissionSaveBusy(false);
    }
});

document.getElementById('rs-leave-room-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('leave-room-modal');
    if (!modal) return;
    modal.dataset.roomId = window.activeRoomId || '';
    modal.classList.remove('hidden');
});
document.getElementById('cancel-leave-btn')?.addEventListener('click', () => document.getElementById('leave-room-modal')?.classList.add('hidden'));
document.getElementById('confirm-leave-btn')?.addEventListener('click', async () => {
    const leaveModal = document.getElementById('leave-room-modal');
    const roomIdToLeave = leaveModal?.dataset.roomId || '';
    leaveModal?.classList.add('hidden');
    if (!roomIdToLeave || roomIdToLeave === 'global') return window.showToast('This room is no longer available.');
    try {
        closeRoomSettings();
        const now = Date.now();
        const logText = `${window.userProfileName} left the room.`;
        await update(ref(db), {
            [`rooms_meta/${roomIdToLeave}/logs/${now}`]: createRoomActivity('member_left', { actor: window.userProfileName }, logText, now),
            [`rooms_meta/${roomIdToLeave}/members/${window.currentUser.uid}`]: null,
            [`user_rooms/${window.currentUser.uid}/${roomIdToLeave}`]: null,
        });
        window.switchRoom('global', 'Global Chat', 'GLOBAL');
        window.showToast("You left the room.", false);
    } catch (e) { window.showToast("Error leaving room: " + e.message); }
});

document.getElementById('rs-delete-room-btn')?.addEventListener('click', () => {
    const deleteModal = document.getElementById('delete-room-modal');
    if(document.getElementById('delete-room-input')) document.getElementById('delete-room-input').value = ''; 
    if (!deleteModal) return;
    deleteModal.dataset.roomId = window.activeRoomId || '';
    deleteModal.classList.remove('hidden');
});
document.getElementById('cancel-delete-btn')?.addEventListener('click', () => document.getElementById('delete-room-modal')?.classList.add('hidden'));
document.getElementById('confirm-delete-btn')?.addEventListener('click', async () => {
    const delInput = document.getElementById('delete-room-input');
    const deleteModal = document.getElementById('delete-room-modal');
    const roomIdToDelete = deleteModal?.dataset.roomId || '';
    if (delInput && delInput.value.trim().toLowerCase() === 'confirm') {
        deleteModal?.classList.add('hidden');
        if (!roomIdToDelete || roomIdToDelete === 'global') return window.showToast('This room is no longer available.');
        try {
            closeRoomSettings();
            window.switchRoom('global', 'Global Chat', 'GLOBAL');
            await remove(ref(db, `rooms_data/${roomIdToDelete}`));
            await remove(ref(db, `rooms_meta/${roomIdToDelete}`));
            await removeMyRoomIndex(roomIdToDelete);
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
