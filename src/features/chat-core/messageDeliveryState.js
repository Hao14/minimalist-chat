export const MESSAGE_DELIVERY_STATE = Object.freeze({
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
});

export function mergeMessageDeliveries(messages = [], deliveries = [], scopeKey = '') {
  const scoped = deliveries.filter((delivery) => delivery.scopeKey === scopeKey);
  if (!scoped.length) return messages;

  const deliveryById = new Map(scoped.map((delivery) => [delivery.id, delivery]));
  const remoteIds = new Set(messages.map((message) => message.id));
  const merged = messages.map((message) => {
    const delivery = deliveryById.get(message.id);
    if (!delivery) return message;
    return { ...message, deliveryState: MESSAGE_DELIVERY_STATE.SENT, deliveryError: '' };
  });

  scoped.forEach((delivery) => {
    if (remoteIds.has(delivery.id) || !delivery.message) return;
    const progress = Number(delivery.progress || 0);
    merged.push({
      ...delivery.message,
      deliveryState: delivery.state,
      deliveryError: delivery.error || '',
      ...(progress > 0 ? { deliveryProgress: progress } : {}),
    });
  });
  return merged;
}
