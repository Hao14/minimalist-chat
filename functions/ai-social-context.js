'use strict';

const WINSTON_EVENT_LOOKUP_MAX_RESULTS = 24;

function compact(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function clip(value, limit) {
    const text = compact(value);
    return text.length > limit ? text.slice(0, limit) : text;
}

function winstonEventLookupIntent(value) {
    const query = compact(value).toLowerCase();
    return Boolean(query && /\b(?:event|events|calendar|schedule|scheduled|appointment|appointments|meeting|meetings|agenda|happening)\b/i.test(query));
}

function eventDateKey(value) {
    const date = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function eventTimeKey(value) {
    const time = String(value || '').trim();
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '';
}

function authorizedRoom(roomId, room, uid) {
    return roomId === 'global' || room?.creatorId === uid || Object.prototype.hasOwnProperty.call(room?.members || {}, uid);
}

function selectAuthorizedWinstonEvents({ uid, rooms, query = '', now = Date.now(), maxEvents = WINSTON_EVENT_LOOKUP_MAX_RESULTS } = {}) {
    const ownerUid = String(uid || '').trim();
    if (!ownerUid || !rooms || typeof rooms !== 'object') return [];
    const today = new Date(Math.max(0, Number(now) || Date.now())).toISOString().slice(0, 10);
    const wantsPast = /\b(?:past|previous|last|earlier|history|was)\b/i.test(String(query || ''));
    const wantsAll = /\b(?:all|every)\b/i.test(String(query || ''));
    const rows = [];

    for (const [roomId, room] of Object.entries(rooms)) {
        if (!/^[A-Za-z0-9_-]{1,160}$/.test(roomId) || !authorizedRoom(roomId, room, ownerUid)) continue;
        const roomName = clip(room?.name || (roomId === 'global' ? 'Global Chat' : 'Room'), 120);
        for (const [eventId, event] of Object.entries(room?.events || {})) {
            if (!/^[A-Za-z0-9_-]{1,160}$/.test(eventId) || !event || typeof event !== 'object') continue;
            const date = eventDateKey(event.date);
            const title = clip(event.title, 120);
            if (!date || !title) continue;
            const time = eventTimeKey(event.time);
            const dateTimeKey = `${date}T${time || '23:59'}`;
            const isPast = date < today;
            if (!wantsAll && wantsPast !== isPast) continue;
            rows.push({
                roomId,
                roomName,
                eventId,
                title,
                date,
                time,
                duration: Math.max(0, Math.min(1440, Math.floor(Number(event.duration) || 0))),
                location: clip(event.location, 160),
                description: clip(event.desc || event.description, 360),
                createdAt: Math.max(0, Math.floor(Number(event.createdAt) || 0)),
                dateTimeKey,
                isPast
            });
        }
    }

    rows.sort((left, right) => {
        if (wantsPast && !wantsAll) return right.dateTimeKey.localeCompare(left.dateTimeKey);
        const byDate = left.dateTimeKey.localeCompare(right.dateTimeKey);
        if (byDate) return byDate;
        return left.roomName.localeCompare(right.roomName) || left.title.localeCompare(right.title);
    });
    return rows.slice(0, Math.max(1, Math.min(WINSTON_EVENT_LOOKUP_MAX_RESULTS, Number(maxEvents) || WINSTON_EVENT_LOOKUP_MAX_RESULTS)));
}

module.exports = {
    WINSTON_EVENT_LOOKUP_MAX_RESULTS,
    selectAuthorizedWinstonEvents,
    winstonEventLookupIntent
};
