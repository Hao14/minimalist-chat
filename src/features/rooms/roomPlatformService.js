import { getAuthedJsonHeaders } from '../../lib/authToken.js';

const DEFAULT_ROOM_WEBHOOK_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/roomWebhookConnection';
const REQUEST_TIMEOUT_MS = 15_000;

function roomWebhookEndpoint() {
  return window.ROOM_WEBHOOK_ENDPOINT || DEFAULT_ROOM_WEBHOOK_ENDPOINT;
}

function requiredRoomId(value) {
  const roomId = String(value || '').trim();
  if (!roomId || roomId === 'global') {
    const error = new Error('Choose a private room first.');
    error.code = 'invalid_room';
    error.status = 400;
    throw error;
  }
  return roomId;
}

function operationOptions(value) {
  if (typeof value === 'string') return { roomId: value };
  return value && typeof value === 'object' ? value : {};
}

async function requestRoomWebhook(action, payload) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(roomWebhookEndpoint(), {
      method: 'POST',
      headers: await getAuthedJsonHeaders('Please sign in before managing room connections.'),
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Room webhook operation failed.');
      error.code = data.code || 'room_webhook_failed';
      error.status = response.status;
      error.connection = data.connection || null;
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('The room connection request timed out.');
      timeoutError.code = 'request_timeout';
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function roomWebhookConnectionFromRoom(roomData = {}) {
  const connection = roomData?.connections?.webhook;
  if (!connection || typeof connection !== 'object') return null;
  return {
    type: 'outgoing_webhook',
    provider: String(connection.provider || 'generic'),
    maskedUrl: String(connection.maskedUrl || ''),
    destinationHost: String(connection.destinationHost || ''),
    channelId: String(connection.channelId || 'general'),
    connected: connection.connected === true,
    status: String(connection.status || 'untested'),
    updatedAt: Number(connection.updatedAt || 0),
    updatedBy: String(connection.updatedBy || ''),
    healthUpdatedAt: Number(connection.healthUpdatedAt || 0),
    lastTestAt: Number(connection.lastTestAt || 0),
    lastDeliveryAt: Number(connection.lastDeliveryAt || 0),
    lastSuccessAt: Number(connection.lastSuccessAt || 0),
    lastStatusCode: Number(connection.lastStatusCode || 0),
    lastErrorCode: String(connection.lastErrorCode || ''),
  };
}

export async function saveRoomWebhookConnection(options) {
  const { channelId = 'general', roomId: rawRoomId, url: rawUrl } = operationOptions(options);
  const roomId = requiredRoomId(rawRoomId);
  const url = String(rawUrl || '').trim();
  if (!/^https:\/\/\S+$/i.test(url)) {
    const error = new Error('Enter a valid HTTPS webhook URL.');
    error.code = 'invalid_url';
    error.status = 400;
    throw error;
  }
  return requestRoomWebhook('save', {
    roomId,
    url,
    channelId: String(channelId || 'general').trim() || 'general',
  });
}

export async function testRoomWebhookConnection(options) {
  const { roomId: rawRoomId } = operationOptions(options);
  return requestRoomWebhook('test', { roomId: requiredRoomId(rawRoomId) });
}

export async function disconnectRoomWebhookConnection(options) {
  const { roomId: rawRoomId } = operationOptions(options);
  return requestRoomWebhook('disconnect', { roomId: requiredRoomId(rawRoomId) });
}

