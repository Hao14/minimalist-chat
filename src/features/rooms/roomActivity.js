import { getLocale, translate } from '../../lib/i18n.js';

export const ROOM_ACTIVITY_VERSION = 1;

const EVENT_CONFIG = Object.freeze({
  room_created: Object.freeze({ messageKey: 'room.activity.created', icon: 'ph-flag' }),
  member_joined: Object.freeze({ messageKey: 'room.activity.joined', icon: 'ph-sign-in' }),
  member_joined_via_invite: Object.freeze({ messageKey: 'room.activity.joinedViaInvite', icon: 'ph-link' }),
  member_removed: Object.freeze({ messageKey: 'room.activity.memberRemoved', icon: 'ph-sign-out' }),
  room_picture_updated: Object.freeze({ messageKey: 'room.activity.pictureUpdated', icon: 'ph-image' }),
  room_picture_removed: Object.freeze({ messageKey: 'room.activity.pictureRemoved', icon: 'ph-image-broken' }),
  room_banner_updated: Object.freeze({ messageKey: 'room.activity.bannerUpdated', icon: 'ph-panorama' }),
  room_banner_removed: Object.freeze({ messageKey: 'room.activity.bannerRemoved', icon: 'ph-image-broken' }),
  room_identity_updated: Object.freeze({ messageKey: 'room.activity.identityUpdated', icon: 'ph-identification-card' }),
  room_app_updated: Object.freeze({ messageKey: 'room.activity.appUpdated', icon: 'ph-puzzle-piece' }),
  room_app_removed: Object.freeze({ messageKey: 'room.activity.appRemoved', icon: 'ph-puzzle-piece' }),
  room_permissions_updated: Object.freeze({ messageKey: 'room.activity.permissionsUpdated', icon: 'ph-shield-check' }),
  member_left: Object.freeze({ messageKey: 'room.activity.left', icon: 'ph-sign-out' }),
});

const ALLOWED_ARGUMENTS = Object.freeze(['actor', 'target', 'inviterId', 'subject']);

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function cleanArguments(args = {}) {
  return Object.fromEntries(ALLOWED_ARGUMENTS
    .filter((key) => args[key] !== undefined && args[key] !== null && cleanText(args[key], 160))
    .map((key) => [key, cleanText(args[key], 160)]));
}

function translatedArguments(eventCode, eventArgs, locale) {
  const args = { ...eventArgs };
  if (eventCode === 'room_created' && args.subject) {
    const typeKey = args.subject === 'community' ? 'community' : 'friends';
    args.subject = translate(`room.type.${typeKey}`, {}, locale);
  }
  return args;
}

export function createRoomActivity(eventCode, eventArgs, text, timestamp = Date.now()) {
  if (!EVENT_CONFIG[eventCode]) throw new Error(`Unknown room activity event: ${eventCode}`);
  return {
    eventCode,
    eventVersion: ROOM_ACTIVITY_VERSION,
    eventArgs: cleanArguments(eventArgs),
    text: cleanText(text, 500) || translate('room.activity.fallback'),
    timestamp: Number(timestamp),
  };
}

export function formatRoomActivity(log, locale = getLocale()) {
  const eventCode = cleanText(log?.eventCode, 64);
  const config = EVENT_CONFIG[eventCode];
  if (!config || Number(log?.eventVersion || 0) !== ROOM_ACTIVITY_VERSION) {
    return cleanText(log?.text, 500) || translate('room.activity.fallback', {}, locale);
  }
  return translate(config.messageKey, translatedArguments(eventCode, log.eventArgs || {}, locale), locale);
}

export function getRoomActivityIcon(log) {
  const eventCode = cleanText(log?.eventCode, 64);
  if (EVENT_CONFIG[eventCode]) return EVENT_CONFIG[eventCode].icon;
  const legacyText = cleanText(log?.text, 500).toLocaleLowerCase('en');
  if (legacyText.includes('joined')) return 'ph-sign-in';
  if (legacyText.includes('left') || legacyText.includes('kicked') || legacyText.includes('removed')) return 'ph-sign-out';
  return 'ph-check-circle';
}

export function roomActivityKey(log, index = 0) {
  return `${Number(log?.timestamp || 0)}-${cleanText(log?.eventCode || log?.text, 80)}-${index}`;
}
