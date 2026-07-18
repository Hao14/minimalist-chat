import { normalizeAiModelProfile } from './modelProfiles.js';

export function buildAiGatewayStatusPayload(modelProfile, { wake = false } = {}) {
  return {
    action: 'status',
    modelProfile: normalizeAiModelProfile(modelProfile),
    ...(wake === true ? { wake: true } : {}),
  };
}

export function buildAiGatewayQueueStatusPayload(jobId) {
  return { action: 'queue-status', jobId: String(jobId || '').trim() };
}

export function buildAiGatewayCancelPayload(jobId) {
  return { action: 'cancel-job', jobId: String(jobId || '').trim() };
}

export function buildAiGatewayChatPayload({
  channelId = 'general',
  messages = [],
  mode = 'room',
  modelProfile,
  requestId,
  roomId = 'global',
  targetUid = '',
} = {}) {
  const safeMode = mode === 'personal' || mode === 'spotlight' ? mode : 'room';
  return {
    mode: safeMode,
    roomId,
    channelId,
    messages,
    modelProfile: normalizeAiModelProfile(modelProfile),
    ...(safeMode === 'spotlight' && targetUid ? { targetUid } : {}),
    requestId,
  };
}
