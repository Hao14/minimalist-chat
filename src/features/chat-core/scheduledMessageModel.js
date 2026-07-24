const MAX_SCHEDULED_TEXT_LENGTH = 8_000;

export function sanitizeScheduledMessage(input = {}, now = Date.now()) {
  const text = String(input.text || '').trim().slice(0, MAX_SCHEDULED_TEXT_LENGTH);
  const deliverAt = Number(input.deliverAt || 0);
  const roomId = String(input.roomId || '').trim();
  const channelId = String(input.channelId || 'general').trim() || 'general';

  if (!text) throw new Error('Add a message to schedule.');
  if (!roomId) throw new Error('Choose a room.');
  if (!Number.isFinite(deliverAt) || deliverAt < Number(now) + 60_000) {
    throw new Error('Choose a delivery time at least one minute from now.');
  }

  return {
    text,
    deliverAt,
    roomId,
    channelId,
    status: 'pending',
    createdAt: Number(now),
  };
}

export function scheduledMessageStatusLabel(message = {}, now = Date.now()) {
  if (message.status === 'sent') return 'Sent';
  if (message.status === 'cancelled') return 'Cancelled';
  if (message.status === 'failed') return 'Needs attention';
  if (Number(message.deliverAt || 0) <= Number(now)) return 'Sending soon';
  return 'Scheduled';
}
