import { useEffect, useState, useSyncExternalStore } from 'react';

export const ROOM_TAB_CHANGE_EVENT = 'minimalist:room-tab-change';

const subscribers = new Set();
let listening = false;

function activeSnapshot() {
  if (typeof document === 'undefined') return 'hidden:';
  const activePanelId = document.querySelector('.room-view.active:not(.hidden)')?.id || '';
  const activeView = activePanelId.startsWith('room-view-')
    ? activePanelId.slice('room-view-'.length)
    : document.querySelector('.room-tab.active')?.getAttribute('data-target') || '';
  return `${document.visibilityState}:${activeView}`;
}

function notifySubscribers() {
  subscribers.forEach((notify) => notify());
}

function startListening() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener(ROOM_TAB_CHANGE_EVENT, notifySubscribers);
  document.addEventListener('visibilitychange', notifySubscribers);
}

function stopListening() {
  if (!listening || subscribers.size) return;
  listening = false;
  window.removeEventListener(ROOM_TAB_CHANGE_EVENT, notifySubscribers);
  document.removeEventListener('visibilitychange', notifySubscribers);
}

function subscribe(notify) {
  subscribers.add(notify);
  startListening();
  return () => {
    subscribers.delete(notify);
    stopListening();
  };
}

export function useRoomTabActivity(view) {
  const snapshot = useSyncExternalStore(subscribe, activeSnapshot, () => 'hidden:');
  return snapshot === `visible:${view}`;
}

export function useRoomTabDataActivity(view, deactivationDelayMs = 12_000) {
  const active = useRoomTabActivity(view);
  const [retained, setRetained] = useState(active);

  useEffect(() => {
    const retain = active;
    const delay = active
      || typeof document === 'undefined'
      || document.visibilityState !== 'visible'
      || deactivationDelayMs <= 0
      ? 0
      : deactivationDelayMs;
    const timer = window.setTimeout(() => setRetained(retain), delay);
    return () => window.clearTimeout(timer);
  }, [active, deactivationDelayMs]);

  return active || retained;
}
