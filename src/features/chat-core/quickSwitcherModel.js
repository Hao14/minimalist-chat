const GLOBAL_ROOM_ID = 'global';

function roomPreference(roomPrefs, roomId) {
  return roomPrefs?.[roomId] || {};
}

function sortRoomsForQuickSwitch(rooms, roomPrefs) {
  return rooms
    .map((room, index) => ({ room, index, prefs: roomPreference(roomPrefs, room.id) }))
    .sort((left, right) => {
      if (left.room.id === GLOBAL_ROOM_ID) return -1;
      if (right.room.id === GLOBAL_ROOM_ID) return 1;

      const leftFavorite = left.prefs.favorite === true;
      const rightFavorite = right.prefs.favorite === true;
      if (leftFavorite !== rightFavorite) return leftFavorite ? -1 : 1;
      if (leftFavorite && rightFavorite) {
        return Number(right.prefs.favoriteAt || 0) - Number(left.prefs.favoriteAt || 0)
          || left.index - right.index;
      }
      return left.index - right.index;
    })
    .map(({ room }) => room);
}

function normalizedChannels(room, activeChannels, activeRoomId) {
  const channelsById = new Map();
  const addChannel = (idValue, channel = {}) => {
    const id = String(idValue || channel.id || '').trim();
    if (!id) return;
    const name = String(channel.name || id).trim() || id;
    channelsById.set(id, { id, name });
  };

  // Every room has an implicit general destination, including Global Chat.
  addChannel('general', { name: 'general' });

  if (Array.isArray(room?.channels)) {
    room.channels.forEach((channel) => addChannel(channel?.id, channel));
  } else if (room?.channels && typeof room.channels === 'object') {
    Object.entries(room.channels).forEach(([id, channel]) => addChannel(id, channel || {}));
  }

  // The active-room listener is the freshest source and may resolve before the
  // room-index metadata copy. Reusing it avoids a new database read path.
  if (room?.id === activeRoomId) {
    (activeChannels || []).forEach((channel) => addChannel(channel?.id, channel));
  }

  return [...channelsById.values()];
}

function wordStartsWith(text, needle) {
  return text.split(/[^a-z0-9]+/).some((part) => part.startsWith(needle));
}

function destinationScore(destination, needle) {
  if (!needle) return 0;

  const label = destination.name.toLowerCase();
  const parent = String(destination.roomName || '').toLowerCase();
  const meta = String(destination.meta || '').toLowerCase();
  const searchable = `${label} ${parent} ${meta}`;
  let score = Number.POSITIVE_INFINITY;

  if (label === needle) score = 0;
  else if (label.startsWith(needle)) score = 8;
  else if (wordStartsWith(label, needle)) score = 14;
  else if (parent === needle) score = 18;
  else if (parent.startsWith(needle)) score = 22;
  else if (wordStartsWith(parent, needle)) score = 26;
  else if (searchable.includes(needle)) score = 34;

  if (!Number.isFinite(score)) return score;
  if (destination.current) score -= 3;
  if (destination.favorite) score -= 1;
  return score;
}

function rankedMatches(destinations, needle) {
  const matches = destinations
    .map((destination, stableIndex) => ({
      destination,
      score: destinationScore(destination, needle),
      stableIndex,
    }))
    .filter(({ score }) => Number.isFinite(score));

  if (needle) matches.sort((left, right) => left.score - right.score || left.stableIndex - right.stableIndex);
  return matches.map(({ destination }) => destination);
}

export function buildQuickSwitchModel({
  rooms = [],
  roomPrefs = {},
  activeChannels = [],
  activeRoomId = GLOBAL_ROOM_ID,
  activeChannelId = 'general',
  query = '',
  filter = 'all',
} = {}) {
  const trimmedQuery = String(query || '').trim();
  const channelOnlyPrefix = trimmedQuery.startsWith('#');
  const needle = (channelOnlyPrefix ? trimmedQuery.slice(1) : trimmedQuery).trim().toLowerCase();
  const effectiveFilter = channelOnlyPrefix ? 'channels' : filter;
  const visibleRooms = sortRoomsForQuickSwitch(
    rooms.filter((room) => room?.id && (room.id === GLOBAL_ROOM_ID || !roomPreference(roomPrefs, room.id).hidden)),
    roomPrefs,
  );

  const roomDestinations = visibleRooms.map((room) => {
    const favorite = roomPreference(roomPrefs, room.id).favorite === true;
    return {
      type: 'room',
      key: `room:${room.id}`,
      room,
      roomId: room.id,
      name: String(room.name || 'Room'),
      roomName: String(room.name || 'Room'),
      meta: room.id === GLOBAL_ROOM_ID ? 'Public' : String(room.shortId || ''),
      favorite,
      current: room.id === activeRoomId,
    };
  });

  const channelDestinations = visibleRooms.flatMap((room) => {
    const favorite = roomPreference(roomPrefs, room.id).favorite === true;
    return normalizedChannels(room, activeChannels, activeRoomId).map((channel) => ({
      type: 'channel',
      key: `channel:${room.id}:${channel.id}`,
      room,
      roomId: room.id,
      channelId: channel.id,
      name: channel.name,
      roomName: String(room.name || 'Room'),
      meta: `${room.name || 'Room'} ${room.shortId || ''}`.trim(),
      favorite,
      current: room.id === activeRoomId && channel.id === activeChannelId,
    }));
  });

  const matchedRooms = effectiveFilter === 'channels' ? [] : rankedMatches(roomDestinations, needle);
  const matchedChannels = effectiveFilter === 'rooms' ? [] : rankedMatches(channelDestinations, needle);
  const groups = [];

  if (!needle && effectiveFilter !== 'channels') {
    const currentRoom = matchedRooms.find((destination) => destination.current);
    if (currentRoom) groups.push({ id: 'current', label: 'Current', destinations: [currentRoom] });
    const otherRooms = matchedRooms.filter((destination) => !destination.current);
    if (otherRooms.length) groups.push({ id: 'rooms', label: 'Rooms', destinations: otherRooms });
  } else if (matchedRooms.length) {
    groups.push({ id: 'rooms', label: 'Rooms', destinations: matchedRooms });
  }

  if (matchedChannels.length) groups.push({ id: 'channels', label: 'Channels', destinations: matchedChannels });

  const results = groups.flatMap((group) => group.destinations);
  return {
    groups,
    results,
    effectiveFilter,
    counts: {
      all: roomDestinations.length + channelDestinations.length,
      rooms: roomDestinations.length,
      channels: channelDestinations.length,
      visible: results.length,
    },
  };
}

