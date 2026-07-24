import { classifyWinstonSensitivity } from './winstonPrivacy.js';

export const WINSTON_ADAPTIVE_ROUTING_VERSION = 1;

const PROVIDERS = Object.freeze(['local', 'cloudflare', 'groq']);
const PROVIDER_ORDER = Object.freeze({
  local: 0,
  cloudflare: 1,
  groq: 2,
});
const PROVIDER_DEFAULTS = Object.freeze({
  local: Object.freeze({
    available: true,
    healthy: true,
    latencyMs: 900,
    errorRate: 0,
    queueDepth: 0,
    queueCapacity: 10,
    supports: Object.freeze(['text', 'image', 'document']),
  }),
  cloudflare: Object.freeze({
    available: true,
    healthy: true,
    latencyMs: 1_100,
    errorRate: 0,
    queueDepth: 0,
    queueCapacity: 40,
    supports: Object.freeze(['text', 'image', 'document']),
  }),
  groq: Object.freeze({
    available: true,
    healthy: true,
    latencyMs: 700,
    errorRate: 0,
    queueDepth: 0,
    queueCapacity: 40,
    supports: Object.freeze(['text', 'audio', 'document']),
  }),
});
const COMPLEX_INTENT = /\b(?:analy[sz]e|compare|investigate|strategy|strategic|plan|reason|trade-?offs?|comprehensive|synthesi[sz]e|architecture|debug|diagnose|prove|evaluate|research)\b/i;
const CODE_SIGNAL = /(?:```|(?:^|\n)\s*(?:function|class|interface|const|let|var|def|SELECT|CREATE TABLE)\b|(?:TypeError|ReferenceError|stack trace))/i;

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function normalizeAttachmentKind(value) {
  const candidate = String(
    typeof value === 'string'
      ? value
      : value?.kind || value?.type || value?.mimeType || '',
  ).trim().toLowerCase();
  if (candidate === 'text' || candidate.startsWith('text/')) return 'text';
  if (candidate.startsWith('image/') || ['image', 'photo', 'vision'].includes(candidate)) return 'image';
  if (candidate.startsWith('audio/') || ['audio', 'voice', 'recording'].includes(candidate)) return 'audio';
  if (candidate.startsWith('video/') || candidate === 'video') return 'video';
  if (
    candidate.includes('spreadsheet')
    || candidate.includes('excel')
    || candidate.includes('csv')
    || ['xlsx', 'xls', 'csv', 'sheet'].includes(candidate)
  ) return 'spreadsheet';
  if (
    candidate.includes('pdf')
    || candidate.includes('word')
    || candidate.includes('document')
    || ['doc', 'docx', 'txt', 'file'].includes(candidate)
  ) return 'document';
  return candidate ? 'other' : '';
}

function normalizeAttachments(value) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(source.map(normalizeAttachmentKind).filter(Boolean))].slice(0, 8);
}

function normalizeSupports(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.map(normalizeAttachmentKind).filter(Boolean))].slice(0, 8);
}

function queueForProvider(queue, provider, fallback, providerState = {}) {
  const source = queue?.[provider];
  if (typeof source === 'number') {
    return {
      depth: boundedNumber(source, fallback.queueDepth, 0, 100_000),
      capacity: boundedNumber(providerState.queueCapacity, fallback.queueCapacity, 1, 100_000),
    };
  }
  return {
    depth: boundedNumber(
      source?.depth ?? source?.queued ?? providerState.queueDepth,
      fallback.queueDepth,
      0,
      100_000,
    ),
    capacity: boundedNumber(
      source?.capacity ?? providerState.queueCapacity,
      fallback.queueCapacity,
      1,
      100_000,
    ),
  };
}

function normalizeProviderState(provider, providerHealth, queue) {
  const fallback = PROVIDER_DEFAULTS[provider];
  const source = providerHealth?.[provider] || {};
  const providerQueue = queueForProvider(queue, provider, fallback, source);
  return {
    provider,
    available: source.available !== false,
    healthy: source.healthy !== false,
    latencyMs: boundedNumber(source.latencyMs, fallback.latencyMs, 0, 120_000),
    errorRate: boundedNumber(source.errorRate, fallback.errorRate, 0, 1),
    queueDepth: providerQueue.depth,
    queueCapacity: providerQueue.capacity,
    supports: normalizeSupports(source.supports, fallback.supports),
  };
}

function feedbackRate(value) {
  if (typeof value === 'number') return boundedNumber(value, 0.5, 0, 1);
  const helpful = boundedNumber(value?.helpful, 0, 0, 1_000_000);
  const total = boundedNumber(value?.total, 0, 0, 1_000_000);
  return total > 0 ? helpful / total : 0.5;
}

export function scoreWinstonPromptComplexity(prompt, { attachments = [] } = {}) {
  const text = String(prompt || '').slice(0, 200_000);
  const kinds = normalizeAttachments(attachments);
  const reasons = [];
  let score = 0;

  if (text.length >= 2_500) {
    score += 3;
    reasons.push('very_long_prompt');
  } else if (text.length >= 900) {
    score += 2;
    reasons.push('long_prompt');
  } else if (text.length >= 350) {
    score += 1;
    reasons.push('medium_prompt');
  }
  if (COMPLEX_INTENT.test(text)) {
    score += 3;
    reasons.push('complex_intent');
  }
  if (CODE_SIGNAL.test(text)) {
    score += 2;
    reasons.push('code_or_debugging');
  }
  const questionCount = (text.match(/\?/g) || []).length;
  const listCount = (text.match(/(?:^|\n)\s*(?:\d+[.)]|[-*])\s+/g) || []).length;
  if (questionCount >= 2 || listCount >= 2) {
    score += 2;
    reasons.push('multi_part');
  }
  if (kinds.some((kind) => ['document', 'spreadsheet', 'video'].includes(kind))) {
    score += 2;
    reasons.push('complex_attachment');
  } else if (kinds.length) {
    score += 1;
    reasons.push('attachment');
  }

  const boundedScore = Math.max(0, Math.min(10, score));
  return Object.freeze({
    score: boundedScore,
    band: boundedScore >= 7 ? 'high' : boundedScore >= 4 ? 'medium' : 'low',
    attachmentKinds: Object.freeze(kinds),
    reasons: Object.freeze(reasons.slice(0, 8)),
  });
}

function requiredCapabilities(attachmentKinds) {
  return [...new Set(['text', ...attachmentKinds.map((kind) => (
    kind === 'spreadsheet' ? 'document' : kind
  ))])];
}

function supportsRequest(providerState, capabilities) {
  return capabilities.every((capability) => providerState.supports.includes(capability));
}

function providerScore(state, {
  complexity,
  feedback,
  localMetrics,
  sensitivity,
  attachmentKinds,
}) {
  const base = { local: 72, cloudflare: 66, groq: 64 }[state.provider];
  const queueRatio = Math.min(2, state.queueDepth / state.queueCapacity);
  let score = base;

  score -= Math.min(42, queueRatio * 32);
  score -= Math.min(24, state.errorRate * 60);
  score -= Math.min(18, state.latencyMs / 1_500);
  score += (feedbackRate(feedback?.providers?.[state.provider]) - 0.5) * 24;

  if (state.provider === 'local') {
    const ttftMs = boundedNumber(localMetrics?.ttftMs, 1_500, 0, 120_000);
    const tokensPerSecond = boundedNumber(localMetrics?.tokensPerSecond, 10, 0, 1_000);
    score += ttftMs <= 1_200 ? 7 : ttftMs >= 6_000 ? -16 : 0;
    score += tokensPerSecond >= 15 ? 8 : tokensPerSecond < 4 ? -14 : 0;
    if (sensitivity.sensitive) score += 14;
  }
  if (state.provider === 'groq' && attachmentKinds.includes('audio')) score += 18;
  if (state.provider === 'cloudflare' && complexity.band === 'medium') score += 3;
  if (state.provider !== 'local' && sensitivity.sensitive) score -= 8;

  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}

function selectModelProfile(requestedProfile, complexity, feedback) {
  const requested = String(requestedProfile || 'auto').trim().toLowerCase();
  if (requested === 'fast' || requested === 'smart') {
    return {
      requestedProfile: requested,
      modelProfile: requested,
      automatic: false,
      reason: 'user_selected',
    };
  }

  const fastRate = feedbackRate(feedback?.profiles?.fast);
  const smartRate = feedbackRate(feedback?.profiles?.smart);
  let modelProfile = complexity.score >= 4 ? 'smart' : 'fast';
  let reason = complexity.reasons[0] || 'short_request';
  if (complexity.score === 3 && smartRate - fastRate >= 0.25) {
    modelProfile = 'smart';
    reason = 'feedback_prefers_smart';
  } else if (complexity.score === 4 && fastRate - smartRate >= 0.35) {
    modelProfile = 'fast';
    reason = 'feedback_prefers_fast';
  }
  return {
    requestedProfile: 'auto',
    modelProfile,
    automatic: true,
    reason,
  };
}

export function decideWinstonAdaptiveRoute({
  prompt = '',
  attachments = [],
  requestedProfile = 'auto',
  routingPolicy = 'balanced',
  providerHealth = {},
  queue = {},
  localMetrics = {},
  feedback = {},
  sensitivity,
} = {}) {
  const classification = sensitivity?.version
    ? sensitivity
    : classifyWinstonSensitivity(prompt);
  const complexity = scoreWinstonPromptComplexity(prompt, { attachments });
  const model = selectModelProfile(requestedProfile, complexity, feedback);
  const localOnly = routingPolicy === 'local-only' || classification.localOnly === true;
  const capabilities = requiredCapabilities(complexity.attachmentKinds);
  const states = PROVIDERS.map((provider) => normalizeProviderState(provider, providerHealth, queue));
  const excluded = [];

  const candidates = states.flatMap((state) => {
    if (localOnly && state.provider !== 'local') {
      excluded.push({ provider: state.provider, reason: 'local_only' });
      return [];
    }
    if (!state.available || !state.healthy) {
      excluded.push({ provider: state.provider, reason: !state.available ? 'unavailable' : 'unhealthy' });
      return [];
    }
    if (!supportsRequest(state, capabilities)) {
      excluded.push({ provider: state.provider, reason: 'unsupported_attachment' });
      return [];
    }
    if (state.queueDepth >= state.queueCapacity * 2) {
      excluded.push({ provider: state.provider, reason: 'queue_saturated' });
      return [];
    }
    return [{
      provider: state.provider,
      score: providerScore(state, {
        complexity,
        feedback,
        localMetrics,
        sensitivity: classification,
        attachmentKinds: complexity.attachmentKinds,
      }),
      queueDepth: state.queueDepth,
      queueCapacity: state.queueCapacity,
    }];
  }).sort((left, right) => (
    right.score - left.score
    || PROVIDER_ORDER[left.provider] - PROVIDER_ORDER[right.provider]
  ));

  const selected = candidates[0] || null;
  const reasons = [
    localOnly ? 'local_only' : 'adaptive_route',
    model.reason,
    ...(selected && selected.queueDepth >= selected.queueCapacity ? ['queue_pressure'] : []),
    ...(selected?.provider === 'groq' && complexity.attachmentKinds.includes('audio')
      ? ['audio_specialist']
      : []),
  ];

  return Object.freeze({
    version: WINSTON_ADAPTIVE_ROUTING_VERSION,
    requestedProfile: model.requestedProfile,
    modelProfile: model.modelProfile,
    automaticProfile: model.automatic,
    provider: selected?.provider || null,
    fallbackProviders: Object.freeze(candidates.slice(1, 3).map(({ provider }) => provider)),
    routeBlocked: !selected,
    localOnly,
    complexityScore: complexity.score,
    complexityBand: complexity.band,
    attachmentKinds: complexity.attachmentKinds,
    reasons: Object.freeze([...new Set(
      !selected ? [...reasons, 'no_healthy_capable_provider'] : reasons,
    )].slice(0, 8)),
    providerScores: Object.freeze(Object.fromEntries(
      candidates.map(({ provider, score }) => [provider, score]),
    )),
    excludedProviders: Object.freeze(excluded.slice(0, 3).map((entry) => Object.freeze(entry))),
  });
}
