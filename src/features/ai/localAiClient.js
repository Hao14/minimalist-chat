import { getAuthedJsonHeaders } from '../../lib/authToken.js';
import { onValue, ref } from 'firebase/database';
import { auth, db } from '../../lib/firebase.js';
import {
  aiModelProfileDetails,
  loadAiModelProfile,
  normalizeAiModelProfile,
} from './modelProfiles.js';
import {
  buildAiGatewayActionPayload,
  buildAiGatewayCancelPayload,
  buildAiGatewayChatPayload,
  buildAiGatewayQueueStatusPayload,
  buildAiGatewayStatusPayload,
  buildPersonalAiMemoryPayload,
} from './gatewayPayload.js';
import {
  normalizeAiActions,
  normalizeAiClarification,
  normalizeAiMemories,
  normalizeAiRoutingPolicy,
  normalizeAiSources,
  relevantAiMemories,
} from './aiAgentUi.js';
import {
  formatStockQuoteReply,
  formatStockQuoteUnavailableReply,
  formatStockTickerRequiredReply,
  resolveStockQuoteRequest,
} from './stockQuoteTool.js';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_VISION_MODEL = 'qwen2.5vl:7b';
const DEFAULT_AI_PROVIDER = 'local';
const DEFAULT_TIMEOUT_MS = 90000;
const DEFAULT_VISION_TIMEOUT_MS = 180000;
const STATUS_TIMEOUT_MS = 4500;
const GATEWAY_WAKE_TIMEOUT_MS = 45000;
const QUEUE_STATUS_FALLBACK_MS = 30000;
const MAX_CONTEXT_CHARS = 14000;
const MAX_MESSAGE_CHARS = 4000;
const PERSONAL_AGENT_NAME = 'Winston';
const DEFAULT_STOCK_QUOTE_ENDPOINT = 'https://us-central1-chat-app-356c1.cloudfunctions.net/stockQuote';
const AI_CLARIFICATION_START = '[[MINIMALIST_CLARIFICATION]]';
const AI_CLARIFICATION_END = '[[/MINIMALIST_CLARIFICATION]]';
const AI_CLARIFICATION_MAX_MARKER_CHARS = 2_048;
const AI_CLARIFICATION_RULES = `
- Ask a clarifying question only when missing information would materially change the answer.
- Write the question normally in your reply, then append exactly one machine-readable block using this format:
[[MINIMALIST_CLARIFICATION]]
{"question":"Which option should I use?","options":[{"label":"First"},{"label":"Second"}],"allowFreeText":true}
[[/MINIMALIST_CLARIFICATION]]
- Give 2 to 5 short, distinct options. The block must be valid JSON. Do not use the block when no clarification is needed.`;
const MONTH_INDEX = new Map([
  ['jan', 0], ['january', 0],
  ['feb', 1], ['february', 1],
  ['mar', 2], ['march', 2],
  ['apr', 3], ['april', 3],
  ['may', 4],
  ['jun', 5], ['june', 5],
  ['jul', 6], ['july', 6],
  ['aug', 7], ['august', 7],
  ['sep', 8], ['sept', 8], ['september', 8],
  ['oct', 9], ['october', 9],
  ['nov', 10], ['november', 10],
  ['dec', 11], ['december', 11],
]);

const ROOM_AGENT_SYSTEM = `You are the local Room Agent for Minimalist Chat.

Rules:
- Use only the provided room context.
- If the answer is not in the context, say what is missing and suggest a useful next step.
- Be concise. Prefer short sections and bullet points.
- When summarizing, use these sections when relevant: Summary, Key Decisions, Open Questions, Next Steps.
- When extracting tasks, format each as: owner - task - due date or priority. Use "Owner not specified" when unknown.
- Do not claim to take actions in the app. You can draft text, plans, and suggestions only.
${AI_CLARIFICATION_RULES}`;

const PERSONAL_AGENT_SYSTEM = `You are a private local AI agent inside Minimalist Chat.

Rules:
- Help the signed-in user think, plan, draft, summarize, prioritize, and make sense of their rooms.
- Use the provided room context when relevant.
- Use the user's saved agent instructions and memory as preferences, not as factual proof.
- If the context does not contain an answer, say what is missing and offer a useful next step.
- Do not claim to take actions in the app. You can draft text, plans, and suggestions only.
- Be concise, warm, and useful.
${AI_CLARIFICATION_RULES}`;

const SPOTLIGHT_SYSTEM = `Write a warm 1-2 sentence community spotlight based only on the provided member context. Do not invent facts.`;

const CALENDAR_PHOTO_SYSTEM = `You extract calendar events from screenshots or photos.

Rules:
- Use only what is visible in the image.
- Extract only real calendar, agenda, schedule, event, or appointment entries.
- If the image is not a calendar, agenda, schedule, event list, invitation, or appointment screen, return {"events":[]}.
- Do not output days off as events. Ignore labels like "No shift", "- No Shift -", "Off", "Day off", "Not scheduled", "Unavailable", "PTO", "Vacation", and "Holiday" unless they include a real appointment or shift time.
- Ignore app error messages, notifications, settings text, button labels, model names, and generic UI copy.
- Return valid JSON only. Do not include prose or markdown.
- Resolve relative dates against the provided current date.
- If no year is visible, choose the current or next upcoming occurrence.
- If an end time is shown, include it as endTime.
- If only a duration is shown, include duration in minutes.
- If a field is unknown, use an empty string or 0.`;

export class LocalAiError extends Error {
  constructor(message, state = 'request-failed', details = {}) {
    super(message);
    this.name = 'LocalAiError';
    this.state = state;
    this.details = details;
  }
}

function truncate(value, limit) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function stripPartialClarificationStart(value) {
  const text = String(value || '');
  for (let length = Math.min(text.length, AI_CLARIFICATION_START.length - 1); length > 0; length -= 1) {
    if (text.endsWith(AI_CLARIFICATION_START.slice(0, length))) return text.slice(0, -length);
  }
  return text;
}

export function parseAiClarificationResponse(value, { partial = false } = {}) {
  const source = String(value || '');
  const firstStart = source.indexOf(AI_CLARIFICATION_START);
  if (firstStart < 0) {
    return { reply: stripPartialClarificationStart(source).trim(), interaction: null };
  }

  let visibleReply = source.slice(0, firstStart).trim();
  let interaction = null;
  const marker = source.slice(firstStart);
  if (marker.length > AI_CLARIFICATION_MAX_MARKER_CHARS) return { reply: visibleReply, interaction: null };
  const firstEnd = marker.indexOf(AI_CLARIFICATION_END, AI_CLARIFICATION_START.length);
  if (firstEnd < 0 || marker.slice(firstEnd + AI_CLARIFICATION_END.length).trim()) {
    return { reply: visibleReply, interaction: null };
  }
  const encoded = marker.slice(AI_CLARIFICATION_START.length, firstEnd).trim();
  try {
    const parsed = JSON.parse(encoded);
    interaction = normalizeAiClarification({
      ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
      type: 'clarification',
    });
  } catch {
    // The marker and everything after it stay hidden when local JSON is malformed.
  }
  if (interaction && !partial) {
    const comparableReply = visibleReply.toLocaleLowerCase().replace(/[?!.]+$/g, '').trim();
    const comparableQuestion = interaction.question.toLocaleLowerCase().replace(/[?!.]+$/g, '').trim();
    if (!comparableReply.includes(comparableQuestion)) {
      visibleReply = [visibleReply, interaction.question].filter(Boolean).join('\n\n');
    }
  }
  return {
    reply: visibleReply,
    interaction,
  };
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function validDateKey(year, month, day) {
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    parsed.getFullYear() !== Number(year)
    || parsed.getMonth() !== Number(month) - 1
    || parsed.getDate() !== Number(day)
  ) return '';
  return localDateKey(parsed);
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function isLocalPage() {
  if (typeof window === 'undefined') return true;
  return isLoopbackHost(window.location.hostname) || window.location.protocol === 'file:';
}

export function getLocalAiConfig(overrides = {}) {
  const modelProfile = normalizeAiModelProfile(
    overrides.modelProfile || loadAiModelProfile() || window.AI_MODEL_PROFILE,
  );
  const requestedModelProfile = ['auto', 'fast', 'smart'].includes(String(overrides.requestedModelProfile || '').toLowerCase())
    ? String(overrides.requestedModelProfile).toLowerCase()
    : modelProfile;
  const profile = aiModelProfileDetails(modelProfile);
  const fastModel = overrides.fastModel
    || window.OLLAMA_FAST_MODEL
    || overrides.model
    || window.OLLAMA_MODEL
    || aiModelProfileDetails('fast').model;
  const smartModel = overrides.smartModel
    || window.OLLAMA_SMART_MODEL
    || aiModelProfileDetails('smart').model;
  return {
    baseUrl: overrides.baseUrl || window.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL,
    modelProfile,
    requestedModelProfile,
    model: modelProfile === 'smart' ? smartModel : fastModel,
    modelLabel: profile.label,
    contextWindow: Math.max(2048, Math.min(8192, Number(profile.contextWindow) || 8192)),
    thinking: profile.thinking === true,
    fastModel,
    smartModel,
    visionModel: overrides.visionModel || window.OLLAMA_VISION_MODEL || DEFAULT_OLLAMA_VISION_MODEL,
    provider: overrides.provider || window.AI_PROVIDER || DEFAULT_AI_PROVIDER,
    routingPolicy: normalizeAiRoutingPolicy(overrides.routingPolicy || window.AI_ROUTING_POLICY || 'balanced'),
    gatewayEndpoint: overrides.gatewayEndpoint || window.AI_GATEWAY_ENDPOINT || window.AI_CHAT_ENDPOINT || '',
    profileEndpoint: overrides.profileEndpoint || window.AI_PROFILE_ENDPOINT || '',
    calendarEndpoint: overrides.calendarEndpoint || window.AI_CALENDAR_ENDPOINT || '',
    flags: { ...(window.MINIMALIST_FLAGS || {}), ...(overrides.flags || {}) },
  };
}

export function shouldUseGatewayAi(config = {}) {
  const nextConfig = getLocalAiConfig(config);
  return nextConfig.provider === 'gateway' && Boolean(nextConfig.gatewayEndpoint);
}

export function shouldUseServerAiProfile(config = {}) {
  const nextConfig = getLocalAiConfig(config);
  return shouldUseGatewayAi(nextConfig) && nextConfig.flags?.aiServerProfile === true && Boolean(nextConfig.profileEndpoint);
}

export function getLocalVisionAiConfig(overrides = {}) {
  const config = getLocalAiConfig(overrides);
  return {
    baseUrl: config.baseUrl,
    model: overrides.visionModel || config.visionModel || overrides.model,
  };
}

export function normalizeOllamaBaseUrl(baseUrl) {
  const raw = String(baseUrl || DEFAULT_OLLAMA_BASE_URL).trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new LocalAiError('Local AI needs a valid Ollama URL.', 'blocked');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new LocalAiError('Local AI needs an http or https Ollama URL.', 'blocked');
  }

  if (!isLoopbackHost(url.hostname)) {
    throw new LocalAiError('Local AI is restricted to loopback Ollama hosts.', 'blocked');
  }

  if (!isLocalPage() && url.protocol === 'http:') {
    throw new LocalAiError('Local AI needs a local page or same-origin bridge to reach Ollama from this deployment.', 'blocked');
  }

  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path === '/' ? '' : path}`;
}

function endpoint(baseUrl, path) {
  return `${normalizeOllamaBaseUrl(baseUrl)}${path}`;
}

function withTimeout(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  externalSignal?.addEventListener?.('abort', abort, { once: true });
  if (externalSignal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    cleanup() {
      window.clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', abort);
    },
  };
}

async function fetchJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const timed = withTimeout(timeoutMs, options.signal);
  try {
    const response = await fetch(url, { ...options, signal: timed.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error || data?.message || `Ollama request failed (${response.status}).`;
      const state = response.status === 404 || /not found|pull/i.test(message) ? 'missing-model' : 'request-failed';
      throw new LocalAiError(message, state, { status: response.status });
    }
    return data;
  } catch (error) {
    if (error instanceof LocalAiError) throw error;
    if (error?.name === 'AbortError') {
      throw new LocalAiError('The local agent stopped responding. Check Ollama and try again.', 'request-failed');
    }
    throw new LocalAiError(error?.message || 'Ollama is not reachable on this device.', 'offline');
  } finally {
    timed.cleanup();
  }
}

async function streamOllamaChat(url, payload, { signal, onProgress, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const timed = withTimeout(timeoutMs, signal);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, stream: true }),
      signal: timed.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const message = data?.error || data?.message || `Ollama request failed (${response.status}).`;
      const state = response.status === 404 || /not found|pull/i.test(message) ? 'missing-model' : 'request-failed';
      throw new LocalAiError(message, state, { status: response.status });
    }
    if (!response.body?.getReader) {
      throw new LocalAiError('This browser cannot read the local AI stream.', 'request-failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reply = '';
    let visibleReply = '';
    let lastChunk = {};
    const readLine = (line) => {
      const text = String(line || '').trim();
      if (!text) return;
      const chunk = JSON.parse(text);
      lastChunk = chunk;
      const delta = String(chunk?.message?.content || '');
      if (!delta) return;
      reply += delta;
      const parsed = parseAiClarificationResponse(reply, { partial: true });
      if (parsed.reply === visibleReply) return;
      const visibleDelta = parsed.reply.startsWith(visibleReply)
        ? parsed.reply.slice(visibleReply.length)
        : '';
      visibleReply = parsed.reply;
      onProgress?.({
        delta: visibleDelta,
        text: visibleReply,
        status: 'running',
        provider: 'local-ollama',
        model: chunk?.model || payload.model,
      });
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(readLine);
      if (done) break;
    }
    if (buffer.trim()) readLine(buffer);
    const parsed = parseAiClarificationResponse(reply);
    if (!parsed.reply && !parsed.interaction) throw new LocalAiError('The local agent returned an empty response.', 'request-failed');
    return {
      reply: parsed.reply,
      interaction: parsed.interaction,
      model: lastChunk?.model || payload.model,
      provider: 'local-ollama',
      stats: lastChunk,
    };
  } catch (error) {
    if (error instanceof LocalAiError) throw error;
    if (error?.name === 'AbortError') {
      if (signal?.aborted) throw new LocalAiError('Request stopped.', 'cancelled', { cancelled: true });
      throw new LocalAiError('The local agent stopped responding. Check Ollama and try again.', 'request-failed');
    }
    throw new LocalAiError(error?.message || 'Ollama is not reachable on this device.', 'offline');
  } finally {
    timed.cleanup();
  }
}

function modelInstalled(models, model) {
  return models.some((entry) => entry?.name === model || entry?.model === model);
}

export function localAiStatusMessage(statusOrError) {
  const state = statusOrError?.state || 'request-failed';
  const model = statusOrError?.model || getLocalAiConfig().model;
  const modelProfile = normalizeAiModelProfile(statusOrError?.modelProfile || getLocalAiConfig().modelProfile);
  const profileLabel = aiModelProfileDetails(modelProfile).label;
  const provider = statusOrError?.provider || getLocalAiConfig().provider;
  if (provider === 'gateway') {
    if (state === 'standby') return 'Ready on demand · wakes automatically if it has been idle.';
    if (state === 'checking') return 'Checking the protected AI gateway…';
    if (state === 'warming') return 'Waking AI after idle… this can take up to 30 seconds.';
    if (state === 'ready') return `${profileLabel} AI ready · ${model}`;
    if (state === 'missing-model') return statusOrError?.message || `${profileLabel} AI is not installed on the protected bridge. Open Minimalist Analysis to install it.`;
    if (state === 'blocked') return statusOrError?.message || 'AI gateway is not configured for this deployment.';
    if (state === 'unavailable') return 'AI could not be reached after waiting for wake-up. The protected host may be unavailable.';
    return statusOrError?.message || 'The AI gateway is not reachable right now.';
  }
  if (state === 'checking') return 'Checking local Ollama...';
  if (state === 'warming') return 'Starting Ollama... first response may take a moment.';
  if (state === 'ready') return `${profileLabel} local agent ready · ${model}`;
  if (state === 'missing-model') return `${profileLabel} model "${model}" is not installed. Run: ollama pull ${model}`;
  if (state === 'blocked') return statusOrError?.message || 'Local AI needs a configured local or same-origin Ollama endpoint.';
  if (state === 'offline') return 'Ollama is not reachable on this device. Start Ollama, then retry.';
  return statusOrError?.message || 'The local agent stopped responding. Check Ollama and try again.';
}

export async function getLocalAiStatus(configOverrides = {}, { wake = false } = {}) {
  const config = getLocalAiConfig(configOverrides);
  if (shouldUseGatewayAi(config)) {
    try {
      const statusPayload = wake
        ? buildAiGatewayStatusPayload(config.requestedModelProfile || config.modelProfile, { wake: true, routingPolicy: config.routingPolicy })
        : buildAiGatewayStatusPayload(config.requestedModelProfile || config.modelProfile, { routingPolicy: config.routingPolicy });
      const data = await fetchAuthedJson(
        config.gatewayEndpoint,
        statusPayload,
        undefined,
        wake ? GATEWAY_WAKE_TIMEOUT_MS : STATUS_TIMEOUT_MS,
      );
      const model = data?.model || 'Bananas gateway';
      return {
        ...config,
        state: 'ready',
        model,
        modelProfile: normalizeAiModelProfile(data?.modelProfile || config.modelProfile),
        profiles: Array.isArray(data?.profiles) ? data.profiles : [],
        gatewayProvider: data?.provider || '',
        bananaTier: data?.tier || '',
        message: localAiStatusMessage({ ...config, state: 'ready', provider: 'gateway', model, modelProfile: data?.modelProfile }),
      };
    } catch (error) {
      const state = ['blocked', 'missing-model'].includes(error?.state)
        ? error.state
        : wake
          ? 'unavailable'
          : error?.state || 'offline';
      return {
        ...config,
        state,
        profiles: Array.isArray(error?.details?.profiles) ? error.details.profiles : [],
        message: localAiStatusMessage({ ...config, state, provider: 'gateway', message: error?.message, modelProfile: error?.details?.modelProfile }),
        error,
      };
    }
  }
  if (config.provider === 'gateway' && !config.gatewayEndpoint) {
    return {
      ...config,
      state: 'blocked',
      message: localAiStatusMessage({ ...config, state: 'blocked', provider: 'gateway', message: 'AI gateway endpoint is missing.' }),
    };
  }
  try {
    const data = await fetchJson(endpoint(config.baseUrl, '/api/tags'), { method: 'GET' }, STATUS_TIMEOUT_MS);
    const models = Array.isArray(data?.models) ? data.models : [];
    if (!modelInstalled(models, config.model)) {
      return {
        ...config,
        models,
        state: 'missing-model',
        message: localAiStatusMessage({ state: 'missing-model', model: config.model }),
      };
    }
    return {
      ...config,
      models,
      state: 'ready',
      message: localAiStatusMessage({ state: 'ready', model: config.model }),
    };
  } catch (error) {
    const state = error?.state || 'offline';
    return {
      ...config,
      state,
      message: localAiStatusMessage({ state, model: config.model, message: error?.message }),
      error,
    };
  }
}

function contextToString(context = {}) {
  const lines = [];
  const messages = Array.isArray(context.messages) ? context.messages : [];
  const tasks = Array.isArray(context.tasks) ? context.tasks : [];
  const docs = Array.isArray(context.docs) ? context.docs : [];
  const events = Array.isArray(context.events) ? context.events : [];

  if (messages.length) {
    lines.push(`Recent messages:\n${messages.slice(-80).map((message) => {
      const name = truncate(message.name || 'Someone', 80);
      return `${name}: ${truncate(message.text, 800)}`;
    }).join('\n')}`);
  }
  if (tasks.length) {
    lines.push(`Tasks:\n${tasks.slice(-80).map((task) => `- [${task.done ? 'done' : 'open'}] ${truncate(task.text, 500)}${task.byName ? ` (by ${truncate(task.byName, 80)})` : ''}`).join('\n')}`);
  }
  if (events.length) {
    lines.push(`Events:\n${events.slice(-80).map((event) => `- ${truncate(`${event.date || ''} ${event.time || ''} ${event.title || ''}`.trim(), 500)}`).join('\n')}`);
  }
  if (docs.length) {
    lines.push(`Documents: ${docs.slice(-80).map((document) => truncate(document.title || 'Untitled', 120)).join(', ')}`);
  }
  return truncate(lines.join('\n\n'), MAX_CONTEXT_CHARS);
}

function sanitizeConversation(messages = [], limit = 14) {
  return messages.slice(-limit).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: truncate(message.content, MAX_MESSAGE_CHARS),
  })).filter((message) => message.content);
}

async function chatWithOllama({
  config,
  context = '',
  messages = [],
  system,
  temperature = 0.3,
  signal,
  onProgress,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const nextConfig = getLocalAiConfig(config);
  const payloadMessages = [
    { role: 'system', content: system },
    context ? { role: 'system', content: `Current context:\n${truncate(context, MAX_CONTEXT_CHARS)}` } : null,
    ...sanitizeConversation(messages),
  ].filter(Boolean);

  const payload = {
    model: nextConfig.model,
    think: nextConfig.thinking,
    options: { temperature, num_ctx: nextConfig.contextWindow },
    messages: payloadMessages,
  };
  if (typeof onProgress === 'function') {
    return streamOllamaChat(endpoint(nextConfig.baseUrl, '/api/chat'), payload, {
      signal,
      onProgress,
      timeoutMs,
    });
  }

  const data = await fetchJson(endpoint(nextConfig.baseUrl, '/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, stream: false }),
    signal,
  }, timeoutMs);

  const parsed = parseAiClarificationResponse(data?.message?.content);
  if (!parsed.reply && !parsed.interaction) throw new LocalAiError('The local agent returned an empty response.', 'request-failed');
  return {
    reply: parsed.reply,
    interaction: parsed.interaction,
    model: data?.model || nextConfig.model,
    provider: 'local-ollama',
    stats: data,
  };
}

function newRequestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function authHeaders() {
  try {
    return await getAuthedJsonHeaders('Please sign in again before using AI.');
  } catch (error) {
    throw new LocalAiError(error?.message || 'Please sign in again before using AI.', 'blocked');
  }
}

async function fetchAuthedJson(url, body, signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const timed = withTimeout(timeoutMs, signal);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
      signal: timed.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error || data?.message || `AI gateway failed (${response.status}).`;
      const state = data?.code === 'AI_MODEL_NOT_INSTALLED'
        ? 'missing-model'
        : response.status === 401 || response.status === 403
          ? 'blocked'
          : 'request-failed';
      throw new LocalAiError(message, state, {
        status: response.status,
        code: data?.code || '',
        queueStatus: data?.status || '',
        cancelled: data?.cancelled === true,
        model: data?.model || '',
        modelProfile: data?.modelProfile || '',
        profiles: Array.isArray(data?.profiles) ? data.profiles : [],
        bananas: data?.bananas || null,
        retryAfterSeconds: data?.retryAfterSeconds || null,
      });
    }
    return data;
  } catch (error) {
    if (error instanceof LocalAiError) throw error;
    if (error?.name === 'AbortError') {
      if (signal?.aborted) throw new LocalAiError('Request stopped.', 'cancelled', { cancelled: true });
      throw new LocalAiError('The AI gateway stopped responding. Try again in a moment.', 'request-failed');
    }
    throw new LocalAiError(error?.message || 'The AI gateway is not reachable.', 'offline');
  } finally {
    timed.cleanup();
  }
}

function queuedGatewayError(data) {
  const queueError = data?.error && typeof data.error === 'object' ? data.error : {};
  const message = queueError.message || data?.error || 'The queued AI request failed.';
  const code = queueError.code || data?.code || 'AI_QUEUE_JOB_FAILED';
  return new LocalAiError(message, data?.status === 'cancelled' ? 'cancelled' : 'request-failed', {
    status: 422,
    queueStatus: data?.status,
    code,
    jobId: data?.jobId || '',
    requestId: data?.requestId || '',
    bananas: data?.bananas || null,
  });
}

function waitForQueuedGatewayResult({ endpoint: gatewayEndpoint, initial, signal, onQueueUpdate }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = null;
    let pollTimer = null;
    let realtimeWatchdog = null;
    let realtimeSeen = false;
    let polling = false;
    let pollDelayMs = QUEUE_STATUS_FALLBACK_MS;

    function stopPolling() {
      polling = false;
      if (pollTimer) window.clearTimeout(pollTimer);
      pollTimer = null;
    }

    const cleanup = () => {
      unsubscribe?.();
      unsubscribe = null;
      stopPolling();
      if (realtimeWatchdog) window.clearTimeout(realtimeWatchdog);
      realtimeWatchdog = null;
      signal?.removeEventListener?.('abort', handleAbort);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const handleStatus = (data) => {
      if (settled || !data || data.jobId !== initial.jobId) return false;
      onQueueUpdate?.(data);
      if (data.status === 'completed') {
        if (!String(data.reply || '').trim()) {
          settle(reject, new LocalAiError('The queued AI request completed without a reply.', 'request-failed'));
        } else {
          settle(resolve, data);
        }
        return true;
      }
      if (data.status === 'failed' || data.status === 'cancelled') {
        settle(reject, queuedGatewayError(data));
        return true;
      }
      return false;
    };
    const schedulePoll = () => {
      if (settled || !polling) return;
      pollTimer = window.setTimeout(pollOnce, pollDelayMs);
    };
    const pollOnce = async () => {
      if (settled || !polling) return;
      try {
        const data = await fetchAuthedJson(
          gatewayEndpoint,
          buildAiGatewayQueueStatusPayload(initial.jobId),
          signal,
          15000,
        );
        if (handleStatus(data)) return;
      } catch (error) {
        if (signal?.aborted) {
          settle(reject, error);
          return;
        }
        if ([401, 403, 404].includes(Number(error?.details?.status || 0))) {
          settle(reject, error);
          return;
        }
      }
      schedulePoll();
    };
    const startPolling = (delayMs = QUEUE_STATUS_FALLBACK_MS) => {
      const nextDelay = Math.max(2000, Number(delayMs) || QUEUE_STATUS_FALLBACK_MS);
      const shouldAccelerate = polling && nextDelay < pollDelayMs;
      pollDelayMs = nextDelay;
      if (settled) return;
      if (shouldAccelerate && pollTimer) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
        schedulePoll();
        return;
      }
      if (polling) return;
      polling = true;
      pollTimer = window.setTimeout(pollOnce, pollDelayMs);
    };
    function handleAbort() {
      settle(reject, new LocalAiError(
        'Stopped waiting locally. The accepted AI request remains in the server queue.',
        'request-failed',
        { jobId: initial.jobId, requestId: initial.requestId },
      ));
    }

    signal?.addEventListener?.('abort', handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }

    handleStatus(initial);
    if (settled) return;
    const uid = auth.currentUser?.uid;
    if (uid && /^[a-f0-9]{64}$/.test(String(initial.jobId || ''))) {
      try {
        const stop = onValue(
          ref(db, `ai_queue_status/${uid}/${initial.jobId}`),
          (snapshot) => {
            const value = snapshot.val();
            if (value) {
              realtimeSeen = true;
              stopPolling();
              if (realtimeWatchdog) window.clearTimeout(realtimeWatchdog);
              realtimeWatchdog = null;
            }
            handleStatus(value);
          },
          () => {
            if (realtimeWatchdog) window.clearTimeout(realtimeWatchdog);
            realtimeWatchdog = null;
            startPolling(initial.pollAfterMs);
          },
        );
        if (settled) stop();
        else {
          unsubscribe = stop;
          if (!realtimeSeen) {
            realtimeWatchdog = window.setTimeout(
              () => startPolling(initial.pollAfterMs),
              QUEUE_STATUS_FALLBACK_MS,
            );
          }
        }
      } catch {
        startPolling(initial.pollAfterMs);
      }
    } else {
      startPolling(initial.pollAfterMs);
    }
  });
}

async function chatWithGateway({
  config,
  mode,
  roomId = 'global',
  channelId = 'general',
  messages = [],
  targetUid = '',
  requestMode = 'chat',
  routingPolicy = 'balanced',
  selectedRoomIds = [],
  attachment = null,
  attachments = [],
  contextSelection = null,
  verificationMode = 'auto',
  planMode = false,
  signal,
  onQueueUpdate,
  onProgress,
}) {
  const nextConfig = getLocalAiConfig(config);
  let data = await fetchAuthedJson(nextConfig.gatewayEndpoint, buildAiGatewayChatPayload({
    mode,
    roomId,
    channelId,
    messages: sanitizeConversation(messages),
    modelProfile: nextConfig.requestedModelProfile || nextConfig.modelProfile,
    targetUid,
    requestMode,
    routingPolicy,
    selectedRoomIds,
    attachment,
    attachments,
    contextSelection,
    verificationMode,
    planMode,
    requestId: newRequestId(),
  }), signal);
  if (data?.queued || data?.status === 'queued' || data?.status === 'running') {
    data = await waitForQueuedGatewayResult({
      endpoint: nextConfig.gatewayEndpoint,
      initial: data,
      signal,
      onQueueUpdate: (status) => {
        onQueueUpdate?.(status);
        const partial = parseAiClarificationResponse(status?.partialReply || status?.partial, { partial: true }).reply;
        if (partial) onProgress?.({
          text: partial,
          status: status.status || 'running',
          jobId: status.jobId || '',
          provider: status.provider || '',
          model: status.model || '',
        });
      },
    });
  } else if (data?.status === 'failed' || data?.status === 'cancelled') {
    throw queuedGatewayError(data);
  }
  onQueueUpdate?.({ ...data, status: 'completed', queued: false });
  const parsed = parseAiClarificationResponse(data?.reply);
  const interaction = normalizeAiClarification(data?.interaction) || parsed.interaction;
  if (!parsed.reply && !interaction) throw new LocalAiError('The AI gateway returned an empty response.', 'request-failed');
  return {
    reply: parsed.reply,
    interaction,
    model: data?.model || 'AI gateway',
    modelProfile: normalizeAiModelProfile(data?.modelProfile || nextConfig.modelProfile),
    provider: data?.provider || '',
    routingMode: data?.routingMode || data?.route || '',
    routingPolicy: normalizeAiRoutingPolicy(data?.routingPolicy || routingPolicy),
    routeReceipt: data?.routeReceipt && typeof data.routeReceipt === 'object'
      ? { ...data.routeReceipt }
      : null,
    contextReceipt: data?.contextReceipt && typeof data.contextReceipt === 'object'
      ? { ...data.contextReceipt }
      : null,
    verification: data?.verification && typeof data.verification === 'object'
      ? { ...data.verification }
      : null,
    plan: data?.plan && typeof data.plan === 'object'
      ? { ...data.plan }
      : null,
    sources: normalizeAiSources(data?.sources),
    actions: normalizeAiActions(data?.actions),
    memorySuggestion: data?.memorySuggestion && typeof data.memorySuggestion === 'object'
      ? { ...data.memorySuggestion }
      : null,
    memorySuggestions: Array.isArray(data?.memorySuggestions)
      ? data.memorySuggestions.slice(0, 3).map((suggestion) => ({ ...suggestion }))
      : [],
    jobId: data?.jobId || '',
    bananasUsed: data?.bananasUsed,
    bananasRemaining: data?.bananasRemaining,
    bananaLimit: data?.bananaLimit,
    bananaWindow: data?.bananaWindow,
    bananaWindowLabel: data?.bananaWindowLabel,
    bananaResetsAt: data?.bananaResetsAt,
    bananaTier: data?.bananaTier,
    fiveHourBananasUsed: data?.fiveHourBananasUsed,
    fiveHourBananasRemaining: data?.fiveHourBananasRemaining,
    fiveHourBananaLimit: data?.fiveHourBananaLimit,
    fiveHourBananaResetsAt: data?.fiveHourBananaResetsAt,
    weeklyBananasUsed: data?.weeklyBananasUsed,
    weeklyBananasRemaining: data?.weeklyBananasRemaining,
    weeklyBananaLimit: data?.weeklyBananaLimit,
    weeklyBananaResetsAt: data?.weeklyBananaResetsAt,
    bananas: data?.bananas,
    requestId: data?.requestId,
    stats: data,
  };
}

export async function cancelQueuedAiRequest({ config, jobId } = {}) {
  const nextConfig = getLocalAiConfig(config);
  const id = String(jobId || '').trim();
  if (!shouldUseGatewayAi(nextConfig) || !id) {
    return { cancelled: false, status: 'not-queued', jobId: id };
  }
  const data = await fetchAuthedJson(
    nextConfig.gatewayEndpoint,
    buildAiGatewayCancelPayload(id),
    undefined,
    15000,
  );
  return {
    ...data,
    jobId: data?.jobId || id,
    status: data?.status || (data?.cancelled ? 'cancelled' : 'unknown'),
    cancelled: data?.cancelled === true || data?.status === 'cancelled',
  };
}

export async function confirmAiAction({ config, actionId } = {}) {
  const nextConfig = getLocalAiConfig(config);
  if (!shouldUseGatewayAi(nextConfig)) throw new LocalAiError('Confirmed actions require the protected gateway.', 'blocked');
  const data = await fetchAuthedJson(
    nextConfig.gatewayEndpoint,
    buildAiGatewayActionPayload('confirm-action', actionId),
    undefined,
    20000,
  );
  const action = normalizeAiActions([data?.action, ...(Array.isArray(data?.actions) ? data.actions : [])])
    .find((entry) => entry.id === String(actionId || '').trim() && entry.status === 'confirmed');
  if (!action) throw new LocalAiError('The server returned an invalid action confirmation.', 'request-failed');
  return { ...data, action, actions: [action] };
}

export async function dismissAiAction({ config, actionId } = {}) {
  const nextConfig = getLocalAiConfig(config);
  if (!shouldUseGatewayAi(nextConfig)) return { dismissed: true, actionId };
  try {
    return await fetchAuthedJson(
      nextConfig.gatewayEndpoint,
      buildAiGatewayActionPayload('dismiss-action', actionId),
      undefined,
      15000,
    );
  } catch (error) {
    if (Number(error?.details?.status || 0) === 404) return { dismissed: true, actionId, localOnly: true };
    throw error;
  }
}

export async function loadPersonalAiProfileFromServer({ config, signal } = {}) {
  const nextConfig = getLocalAiConfig(config);
  if (!shouldUseServerAiProfile(nextConfig)) return null;
  const data = await fetchAuthedJson(nextConfig.profileEndpoint, { action: 'load' }, signal, 15000);
  return data?.profile || null;
}

export async function savePersonalAiProfileToServer({ profile, config, signal } = {}) {
  const nextConfig = getLocalAiConfig(config);
  if (!shouldUseServerAiProfile(nextConfig)) return null;
  const data = await fetchAuthedJson(nextConfig.profileEndpoint, { action: 'save', profile }, signal, 15000);
  return data?.profile || null;
}

export async function loadPersonalAiMemoriesFromServer({ config, signal } = {}) {
  const nextConfig = getLocalAiConfig(config);
  if (!shouldUseServerAiProfile(nextConfig)) return [];
  const data = await fetchAuthedJson(
    nextConfig.profileEndpoint,
    buildPersonalAiMemoryPayload('memory-list'),
    signal,
    15000,
  );
  return normalizeAiMemories(data?.memories);
}

export async function createPersonalAiMemoryOnServer({ config, memory, signal } = {}) {
  const nextConfig = getLocalAiConfig(config);
  if (!shouldUseServerAiProfile(nextConfig)) throw new LocalAiError('Synced memory is unavailable.', 'blocked');
  const data = await fetchAuthedJson(
    nextConfig.profileEndpoint,
    buildPersonalAiMemoryPayload('memory-create', { memory }),
    signal,
    15000,
  );
  return {
    memory: normalizeAiMemories(data?.memory ? [data.memory] : [])[0] || null,
    memories: normalizeAiMemories(data?.memories),
  };
}

export async function deletePersonalAiMemoryFromServer({ config, memoryId, signal } = {}) {
  const nextConfig = getLocalAiConfig(config);
  if (!shouldUseServerAiProfile(nextConfig)) throw new LocalAiError('Synced memory is unavailable.', 'blocked');
  return fetchAuthedJson(
    nextConfig.profileEndpoint,
    buildPersonalAiMemoryPayload('memory-delete', { memoryId }),
    signal,
    15000,
  );
}

export async function updatePersonalAiMemoryOnServer({ config, memoryId, memory, signal } = {}) {
  const nextConfig = getLocalAiConfig(config);
  if (!shouldUseServerAiProfile(nextConfig)) throw new LocalAiError('Synced memory is unavailable.', 'blocked');
  const data = await fetchAuthedJson(
    nextConfig.profileEndpoint,
    buildPersonalAiMemoryPayload('memory-update', { memoryId, memory }),
    signal,
    15000,
  );
  return {
    memory: normalizeAiMemories(data?.memory ? [data.memory] : [])[0] || null,
    memories: normalizeAiMemories(data?.memories),
  };
}

export async function extractCalendarEventsFromGateway({ image, mimeType = 'image/jpeg', config, signal } = {}) {
  const nextConfig = getLocalAiConfig(config);
  if (!shouldUseGatewayAi(nextConfig) || !nextConfig.calendarEndpoint) return null;
  const data = await fetchAuthedJson(nextConfig.calendarEndpoint, {
    image,
    mimeType,
    today: localDateKey(),
    requestId: newRequestId(),
  }, signal, DEFAULT_VISION_TIMEOUT_MS);
  return {
    events: sanitizeCalendarEvents(data?.events),
    model: data?.model || 'Calendar gateway',
    bananasUsed: data?.bananasUsed,
    bananasRemaining: data?.bananasRemaining,
    bananaLimit: data?.bananaLimit,
    bananaWindow: data?.bananaWindow,
    bananaWindowLabel: data?.bananaWindowLabel,
    bananaResetsAt: data?.bananaResetsAt,
    bananaTier: data?.bananaTier,
    fiveHourBananasUsed: data?.fiveHourBananasUsed,
    fiveHourBananasRemaining: data?.fiveHourBananasRemaining,
    fiveHourBananaLimit: data?.fiveHourBananaLimit,
    fiveHourBananaResetsAt: data?.fiveHourBananaResetsAt,
    weeklyBananasUsed: data?.weeklyBananasUsed,
    weeklyBananasRemaining: data?.weeklyBananasRemaining,
    weeklyBananaLimit: data?.weeklyBananaLimit,
    weeklyBananaResetsAt: data?.weeklyBananaResetsAt,
    bananas: data?.bananas,
    requestId: data?.requestId,
    raw: data,
  };
}

function extractJsonObject(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new LocalAiError('The local vision model did not return readable calendar JSON.', 'request-failed');
  }
}

function normalizeClock(value) {
  let text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  text = text
    .replace(/\s+/g, '')
    .replace(/[.]/g, '')
    .replace(/^(\d{1,2})(am|pm)$/i, '$1:00$2');
  const ampm = text.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/i);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2] || 0);
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return '';
    if (ampm[3] === 'pm' && hour < 12) hour += 12;
    if (ampm[3] === 'am' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeDate(value, today = localDateKey()) {
  const text = String(value || '').trim();
  if (!text) return '';
  const direct = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (direct) return validDateKey(direct[1], direct[2], direct[3]);
  const slashYearFirst = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (slashYearFirst) return validDateKey(slashYearFirst[1], slashYearFirst[2], slashYearFirst[3]);
  const slashYearLast = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (slashYearLast) {
    const rawYear = Number(slashYearLast[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return validDateKey(year, slashYearLast[1], slashYearLast[2]);
  }
  const monthName = text.match(/^([a-zA-Z]+)\s+(\d{1,2})(?:,\s*(\d{2,4}))?$/);
  if (monthName) {
    const month = MONTH_INDEX.get(monthName[1].toLowerCase());
    if (month == null) return '';
    const todayDate = new Date(`${today}T00:00:00`);
    let year = monthName[3] ? Number(monthName[3]) : todayDate.getFullYear();
    if (year < 100) year += 2000;
    let parsed = new Date(year, month, Number(monthName[2]));
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month || parsed.getDate() !== Number(monthName[2])) return '';
    if (!monthName[3] && parsed < todayDate) parsed = new Date(year + 1, month, Number(monthName[2]));
    return localDateKey(parsed);
  }
  return '';
}

function normalizeCalendarLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCalendarOffDayLabel(value) {
  const label = normalizeCalendarLabel(value);
  if (!label) return true;
  const exactLabels = [
    'off',
    'holiday',
    'pto',
    'vacation',
  ];
  if (exactLabels.includes(label)) return true;
  return [
    'no shift',
    'no shifts',
    'day off',
    'off day',
    'not scheduled',
    'unscheduled',
    'no schedule',
    'no work',
    'not working',
    'unavailable',
  ].some((phrase) => label === phrase || label.startsWith(`${phrase} `) || label.includes(` ${phrase} `));
}

function sanitizeCalendarEvents(events) {
  if (!Array.isArray(events)) return [];
  const today = localDateKey();
  return events.map((event) => {
    return {
      title: truncate(event?.title || '', 180),
      date: normalizeDate(event?.date, today),
      time: normalizeClock(event?.time),
      endTime: normalizeClock(event?.endTime),
      duration: Math.max(0, parseInt(event?.duration, 10) || 0),
      location: truncate(event?.location || '', 180),
    };
  }).filter((event) => event.title && event.date && !isCalendarOffDayLabel(event.title));
}

export function buildPersonalAgentContext(profile = {}, userName = 'the user', memories = [], roomId = '') {
  const memoryLines = relevantAiMemories(memories, roomId)
    .slice(0, 16)
    .map((memory) => `- [${memory.scope}] ${truncate(memory.text, 600)}`)
    .join('\n');
  return [
    `Agent name: ${PERSONAL_AGENT_NAME}`,
    `User: ${truncate(userName, 120)}`,
    profile.instructions ? `User instructions:\n${truncate(profile.instructions, 1600)}` : '',
    profile.tone ? `Preferred tone:\n${truncate(profile.tone, 400)}` : '',
    profile.memory ? `Saved memory/preferences:\n${truncate(profile.memory, 2200)}` : '',
    memoryLines ? `Explicit structured memories:\n${memoryLines}` : '',
  ].filter(Boolean).join('\n\n');
}

export function buildProfileSpotlightContext(user = {}, reputation = 0) {
  return [
    `Member: ${truncate(user.displayName || 'Member', 120)}`,
    `Bio: ${truncate(user.bio || '-', 800)}`,
    `Status: ${truncate(user.status || '-', 400)}`,
    `Reputation: ${reputation}`,
    `Badges: ${Object.keys(user.badges || {}).join(', ') || 'none'}`,
    `Kudos: ${user.kudos || 0}`,
    `Messages: ${(user.stats && user.stats.messages) || 0}`,
  ].join('\n');
}

export async function askRoomAgent({
  context,
  messages,
  config,
  roomId = 'global',
  channelId = 'general',
  routingPolicy = 'balanced',
  attachment = null,
  attachments = [],
  contextSelection = null,
  verificationMode = 'auto',
  planMode = false,
  signal,
  onQueueUpdate,
  onProgress,
}) {
  if (shouldUseGatewayAi(config)) {
    return chatWithGateway({
      config,
      mode: 'room',
      roomId,
      channelId,
      messages,
      routingPolicy,
      attachment,
      attachments,
      contextSelection,
      verificationMode,
      planMode,
      signal,
      onQueueUpdate,
      onProgress,
    });
  }
  if (attachment) throw new LocalAiError('Image questions use the protected vision gateway.', 'blocked');
  return chatWithOllama({
    config,
    context: contextToString(context),
    messages,
    system: ROOM_AGENT_SYSTEM,
    temperature: 0.3,
    signal,
    onProgress,
  });
}

export async function tryAgentLiveTool({ context, messages, signal } = {}) {
  const request = resolveStockQuoteRequest({ context, messages });
  if (!request) return null;
  if (!request.symbol) {
    return {
      reply: formatStockTickerRequiredReply(),
      provider: 'market-data',
      model: '',
      toolOnly: true,
    };
  }

  const quoteEndpoint = window.STOCK_QUOTE_ENDPOINT || DEFAULT_STOCK_QUOTE_ENDPOINT;
  try {
    const quote = await fetchAuthedJson(quoteEndpoint, { symbol: request.symbol }, signal, 15000);
    return {
      reply: formatStockQuoteReply(quote, request),
      provider: 'market-data',
      model: String(quote?.provider || 'Latest quote'),
      toolOnly: true,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      reply: formatStockQuoteUnavailableReply(request.symbol),
      provider: 'market-data',
      model: '',
      toolOnly: true,
    };
  }
}

export async function askPersonalAgent({
  context,
  messages,
  profile,
  memories = [],
  userName,
  config,
  roomId = 'global',
  channelId = 'general',
  requestMode = 'chat',
  selectedRoomIds = [],
  routingPolicy = 'balanced',
  attachment = null,
  attachments = [],
  contextSelection = null,
  verificationMode = 'auto',
  planMode = false,
  signal,
  onQueueUpdate,
  onProgress,
}) {
  if (shouldUseGatewayAi(config)) {
    return chatWithGateway({
      config,
      mode: requestMode === 'briefing' ? 'briefing' : 'personal',
      roomId,
      channelId,
      messages,
      requestMode,
      selectedRoomIds,
      routingPolicy,
      attachment,
      attachments,
      contextSelection,
      verificationMode,
      planMode,
      signal,
      onQueueUpdate,
      onProgress,
    });
  }
  if (requestMode === 'briefing' && selectedRoomIds.some((selectedId) => selectedId !== roomId)) {
    throw new LocalAiError('Cross-room briefing requires the protected gateway.', 'blocked');
  }
  const localAttachments = Array.isArray(attachments) ? attachments : [];
  if (attachment || localAttachments.some((item) => item?.kind !== 'document')) {
    throw new LocalAiError('Image and audio questions use the protected gateway.', 'blocked');
  }
  if (contextSelection?.scope === 'workspace' || contextSelection?.roomIds?.some((selectedId) => selectedId !== roomId)) {
    throw new LocalAiError('Cross-room context requires the protected gateway.', 'blocked');
  }
  const fileContext = localAttachments
    .map((item) => String(item?.text || '').trim())
    .filter(Boolean)
    .join('\n\n');
  const personalContext = [
    buildPersonalAgentContext(profile, userName, memories, roomId),
    contextToString(context),
    fileContext ? `User-selected file text (untrusted):\n${fileContext}` : '',
  ].filter(Boolean).join('\n\n');
  return chatWithOllama({
    config,
    context: personalContext,
    messages,
    system: PERSONAL_AGENT_SYSTEM,
    temperature: 0.35,
    signal,
    onProgress,
  });
}

export async function askProfileSpotlight({ targetUid, user, reputation, config, signal, onQueueUpdate }) {
  if (shouldUseGatewayAi(config)) {
    return chatWithGateway({
      config,
      mode: 'spotlight',
      targetUid,
      messages: [{ role: 'user', content: 'Write the member spotlight now.' }],
      signal,
      onQueueUpdate,
    });
  }
  return chatWithOllama({
    config,
    context: buildProfileSpotlightContext(user, reputation),
    messages: [{ role: 'user', content: 'Write the member spotlight now.' }],
    system: SPOTLIGHT_SYSTEM,
    temperature: 0.35,
    signal,
  });
}

export async function extractCalendarEventsFromPhoto({ image, mimeType = 'image/jpeg', config, signal }) {
  const nextConfig = getLocalVisionAiConfig(config);
  const today = localDateKey();
  const prompt = `Current date: ${today}
Image MIME type: ${mimeType || 'image/jpeg'}

Extract real work shifts, events, appointments, meetings, or dated schedule entries visible in this image.
Return {"events":[]} if this is not a calendar, agenda, schedule, event list, invitation, or appointment image.
Do not create events for days off or empty schedule labels. Ignore labels like "No shift", "- No Shift -", "Off", "Day off", "Not scheduled", "Unavailable", "PTO", "Vacation", and "Holiday" unless they include a real appointment or shift time.
Resolve relative dates against the current date. If no year is visible, choose the current or next upcoming occurrence.

Return ONLY this JSON shape:
{"events":[{"title":"string","date":"YYYY-MM-DD","time":"24-hour HH:MM start or empty string","endTime":"24-hour HH:MM end or empty string","duration":integer minutes (0 if unknown),"location":"string or empty"}]}`;

  const data = await fetchJson(endpoint(nextConfig.baseUrl, '/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: nextConfig.model,
      stream: false,
      format: 'json',
      options: { temperature: 0, num_predict: 900 },
      messages: [
        { role: 'system', content: CALENDAR_PHOTO_SYSTEM },
        { role: 'user', content: prompt, images: [String(image || '')] },
      ],
    }),
    signal,
  }, DEFAULT_VISION_TIMEOUT_MS);

  const parsed = extractJsonObject(data?.message?.content);
  return {
    events: sanitizeCalendarEvents(parsed?.events),
    model: data?.model || nextConfig.model,
    raw: parsed,
  };
}
