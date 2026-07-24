const os = require('node:os');
const path = require('node:path');

const DEFAULT_UPSTREAM = 'http://127.0.0.1:11435';
const DEFAULT_MANAGED_HOST = '127.0.0.1:11435';
const DEFAULT_NUM_PARALLEL = 4;
const DEFAULT_MAX_QUEUE = 100;

function positiveInteger(value, fallback, label, maximum) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return parsed;
}

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function defaultModelStore(environment = process.env) {
  const userProfile = String(environment.USERPROFILE || os.homedir()).trim();
  if (!userProfile) throw new Error('A Windows user profile is required for the protected Ollama model store.');
  return path.resolve(userProfile, '.ollama', 'models');
}

function resolveManagedOllamaConfig(environment = process.env) {
  const upstream = String(environment.OLLAMA_UPSTREAM || DEFAULT_UPSTREAM).replace(/\/+$/, '');
  const host = String(environment.OLLAMA_BRIDGE_OLLAMA_HOST || DEFAULT_MANAGED_HOST).trim();
  const approvedModelStore = defaultModelStore(environment);
  const configuredStore = String(environment.OLLAMA_BRIDGE_MODEL_STORE || '').trim();
  const modelStore = configuredStore || approvedModelStore;
  const numParallel = positiveInteger(
    environment.OLLAMA_BRIDGE_OLLAMA_NUM_PARALLEL,
    DEFAULT_NUM_PARALLEL,
    'Managed Ollama NUM_PARALLEL',
    32,
  );
  const maxQueue = positiveInteger(
    environment.OLLAMA_BRIDGE_OLLAMA_MAX_QUEUE,
    DEFAULT_MAX_QUEUE,
    'Managed Ollama MAX_QUEUE',
    10_000,
  );
  const flashAttention = enabled(environment.OLLAMA_BRIDGE_OLLAMA_FLASH_ATTENTION);
  const kvCacheType = String(environment.OLLAMA_BRIDGE_OLLAMA_KV_CACHE_TYPE || '').trim().toLowerCase();
  return {
    upstream,
    host,
    modelStore,
    approvedModelStore,
    numParallel,
    maxQueue,
    flashAttention,
    kvCacheType,
  };
}

function assertSafeManagedOllamaConfig(config) {
  const numParallel = config.numParallel ?? DEFAULT_NUM_PARALLEL;
  const maxQueue = config.maxQueue ?? DEFAULT_MAX_QUEUE;
  const flashAttention = Boolean(config.flashAttention);
  const kvCacheType = String(config.kvCacheType || '').trim().toLowerCase();
  let upstream;
  let managed;
  try {
    upstream = new URL(config.upstream);
    managed = new URL(`http://${config.host}`);
  } catch {
    throw new Error('Managed Ollama requires valid loopback host and upstream URLs.');
  }

  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!loopbackHosts.has(upstream.hostname) || !loopbackHosts.has(managed.hostname)) {
    throw new Error('Managed Ollama must use a loopback-only host.');
  }
  if (upstream.origin !== managed.origin || upstream.pathname !== '/' || upstream.search || upstream.hash) {
    throw new Error('Managed Ollama host must exactly match the configured upstream origin.');
  }
  if (upstream.port === '11434') {
    throw new Error('Managed Ollama refuses port 11434 because it is reserved for the user tray app.');
  }
  if (!path.isAbsolute(config.modelStore)) {
    throw new Error('Managed Ollama requires an absolute model-store path.');
  }
  if (path.resolve(config.modelStore).toLowerCase() !== path.resolve(config.approvedModelStore).toLowerCase()) {
    throw new Error('Managed Ollama must use the approved default user model store.');
  }
  if (!Number.isInteger(numParallel) || numParallel < 1 || numParallel > 32) {
    throw new Error('Managed Ollama NUM_PARALLEL must be an integer from 1 through 32.');
  }
  if (!Number.isInteger(maxQueue) || maxQueue < 1 || maxQueue > 10_000) {
    throw new Error('Managed Ollama MAX_QUEUE must be an integer from 1 through 10000.');
  }
  if (kvCacheType && kvCacheType !== 'q8_0') {
    throw new Error('Managed Ollama KV cache type must be empty or q8_0.');
  }
  if (kvCacheType === 'q8_0' && !flashAttention) {
    throw new Error('Managed Ollama q8_0 KV cache requires Flash Attention.');
  }
}

function managedOllamaEnvironment(environment, config) {
  const numParallel = config.numParallel ?? DEFAULT_NUM_PARALLEL;
  const maxQueue = config.maxQueue ?? DEFAULT_MAX_QUEUE;
  const flashAttention = Boolean(config.flashAttention);
  const kvCacheType = String(config.kvCacheType || '').trim().toLowerCase();
  const childEnvironment = {
    ...environment,
    OLLAMA_HOST: config.host,
    OLLAMA_MODELS: config.modelStore,
    OLLAMA_NUM_PARALLEL: String(numParallel),
    OLLAMA_MAX_QUEUE: String(maxQueue),
    OLLAMA_DEBUG_LOG_REQUESTS: 'false',
  };
  delete childEnvironment.OLLAMA_FLASH_ATTENTION;
  delete childEnvironment.OLLAMA_KV_CACHE_TYPE;
  if (flashAttention) childEnvironment.OLLAMA_FLASH_ATTENTION = '1';
  if (kvCacheType) childEnvironment.OLLAMA_KV_CACHE_TYPE = kvCacheType;
  return childEnvironment;
}

module.exports = {
  DEFAULT_MAX_QUEUE,
  DEFAULT_MANAGED_HOST,
  DEFAULT_NUM_PARALLEL,
  DEFAULT_UPSTREAM,
  assertSafeManagedOllamaConfig,
  defaultModelStore,
  managedOllamaEnvironment,
  resolveManagedOllamaConfig,
};
