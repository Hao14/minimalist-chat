import { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '../../lib/firebase.js';

const ROOM_PLAN_RANK = Object.freeze({ base: 0, advanced: 1, pro: 2 });

export const ROOM_BENEFIT_LIMITS = Object.freeze({
  advanced: Object.freeze({
    label: 'Advanced Room',
    perFile: 2 * 1024 * 1024 * 1024,
    daily: 4 * 1024 * 1024 * 1024,
    video: true,
    analytics: true,
    screenShareTier: 'advanced',
  }),
  pro: Object.freeze({
    label: 'Pro Room',
    perFile: 3 * 1024 * 1024 * 1024,
    daily: 9 * 1024 * 1024 * 1024,
    video: true,
    analytics: true,
    screenShareTier: 'pro',
  }),
});

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeRoomEntitlement(value = {}) {
  const entitlement = safeObject(value);
  const plan = ROOM_BENEFIT_LIMITS[entitlement.plan] ? entitlement.plan : 'base';
  const status = String(entitlement.status || 'inactive').toLowerCase();
  const active = entitlement.active === true && (status === 'active' || status === 'trialing');

  return {
    active,
    plan,
    status,
    billingOwnerUid: String(entitlement.billingOwnerUid || ''),
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd === true,
    currentPeriodEnd: Number(entitlement.currentPeriodEnd || 0),
    maxSelectedUsers: Number(entitlement.maxSelectedUsers || 0),
    selectedUsers: safeObject(entitlement.selectedUsers),
    updatedAt: Number(entitlement.updatedAt || 0),
  };
}

export function roomBenefitPlanForUser(entitlementValue, uid) {
  if (!uid) return 'base';
  const entitlement = normalizeRoomEntitlement(entitlementValue);
  if (!entitlement.active || entitlement.selectedUsers[uid] !== true) return 'base';
  return entitlement.plan;
}

export function roomUploadLimits(accountLimits, entitlementValue, uid) {
  const account = accountLimits || {};
  const roomPlan = roomBenefitPlanForUser(entitlementValue, uid);
  const room = ROOM_BENEFIT_LIMITS[roomPlan];
  if (!room) return account;

  return {
    label: room.label,
    perFile: Math.max(Number(account.perFile || 0), room.perFile),
    daily: Math.max(Number(account.daily || 0), room.daily),
  };
}

export function effectiveScreenShareTier(accountTier, entitlementValue, uid) {
  const normalizedAccountTier = ROOM_PLAN_RANK[accountTier] == null ? 'base' : accountTier;
  const roomTier = ROOM_BENEFIT_LIMITS[roomBenefitPlanForUser(entitlementValue, uid)]?.screenShareTier || 'base';
  return ROOM_PLAN_RANK[roomTier] > ROOM_PLAN_RANK[normalizedAccountTier] ? roomTier : normalizedAccountTier;
}

export function canUseRoomVideo(accountTier, entitlementValue, uid) {
  return String(accountTier || '').toLowerCase() === 'pro'
    || ROOM_BENEFIT_LIMITS[roomBenefitPlanForUser(entitlementValue, uid)]?.video === true;
}

export function hasRoomAnalytics(accountTier, entitlementValue, uid) {
  return String(accountTier || '').toLowerCase() === 'pro'
    || ROOM_BENEFIT_LIMITS[roomBenefitPlanForUser(entitlementValue, uid)]?.analytics === true;
}

export function useRoomEntitlement(roomId, enabled = true) {
  const [snapshotState, setSnapshotState] = useState({ roomId: '', value: {} });

  useEffect(() => {
    if (!enabled || !roomId || roomId === 'global') {
      return undefined;
    }

    return onValue(
      ref(db, `room_billing/${roomId}/entitlement`),
      (snapshot) => setSnapshotState({ roomId, value: snapshot.val() || {} }),
      (error) => {
        console.warn('[room-billing] entitlement subscription failed', error?.code || error?.message || error);
        setSnapshotState({ roomId, value: {} });
      },
    );
  }, [enabled, roomId]);

  return useMemo(
    () => normalizeRoomEntitlement(snapshotState.roomId === roomId ? snapshotState.value : {}),
    [roomId, snapshotState],
  );
}
