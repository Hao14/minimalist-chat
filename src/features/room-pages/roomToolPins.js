export const MAX_PINNED_ROOM_TOOLS = 3;

const DEFAULT_PIN_PRIORITY = Object.freeze([
  'docs',
  'tasks',
  'events',
  'whiteboard',
  'calendar',
  'ai',
  'calls',
]);

function cleanStoragePart(value, fallback) {
  return encodeURIComponent(String(value || fallback).slice(0, 256));
}

export function roomToolPinsStorageKey(userId, roomId) {
  return `minimalist:room-tool-pins:v1:${cleanStoragePart(userId, 'anonymous')}:${cleanStoragePart(roomId, 'global')}`;
}

export function normalizeRoomToolPins(pins, enabledTools = []) {
  const enabled = new Set(enabledTools);
  const normalized = [];
  for (const value of Array.isArray(pins) ? pins : []) {
    const key = String(value || '').trim();
    if (!key || !enabled.has(key) || normalized.includes(key)) continue;
    normalized.push(key);
    if (normalized.length === MAX_PINNED_ROOM_TOOLS) break;
  }
  return normalized;
}

export function defaultRoomToolPins(enabledTools = []) {
  const enabled = new Set(enabledTools);
  return DEFAULT_PIN_PRIORITY.filter((key) => enabled.has(key)).slice(0, MAX_PINNED_ROOM_TOOLS);
}

export function loadRoomToolPins(storage, userId, roomId, enabledTools = []) {
  const key = roomToolPinsStorageKey(userId, roomId);
  try {
    const raw = storage?.getItem?.(key);
    if (raw === null || raw === undefined) return defaultRoomToolPins(enabledTools);
    return normalizeRoomToolPins(JSON.parse(raw), enabledTools);
  } catch {
    return defaultRoomToolPins(enabledTools);
  }
}

export function saveRoomToolPins(storage, userId, roomId, pins = []) {
  const key = roomToolPinsStorageKey(userId, roomId);
  try {
    storage?.setItem?.(key, JSON.stringify(pins.slice(0, MAX_PINNED_ROOM_TOOLS)));
    return true;
  } catch {
    return false;
  }
}

export function toggleRoomToolPin(currentPins, toolKey, enabledTools = []) {
  const normalized = normalizeRoomToolPins(currentPins, enabledTools);
  if (normalized.includes(toolKey)) {
    return { pins: normalized.filter((key) => key !== toolKey), error: '' };
  }
  if (!enabledTools.includes(toolKey)) return { pins: normalized, error: 'unavailable' };
  if (normalized.length >= MAX_PINNED_ROOM_TOOLS) return { pins: normalized, error: 'limit' };
  return { pins: [...normalized, toolKey], error: '' };
}
