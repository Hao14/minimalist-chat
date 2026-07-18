const os = require('node:os');
const path = require('node:path');

const DEFAULT_UPSTREAM = 'http://127.0.0.1:11435';
const DEFAULT_MANAGED_HOST = '127.0.0.1:11435';

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
  return { upstream, host, modelStore, approvedModelStore };
}

function assertSafeManagedOllamaConfig(config) {
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
}

function managedOllamaEnvironment(environment, config) {
  return {
    ...environment,
    OLLAMA_HOST: config.host,
    OLLAMA_MODELS: config.modelStore,
  };
}

module.exports = {
  DEFAULT_MANAGED_HOST,
  DEFAULT_UPSTREAM,
  assertSafeManagedOllamaConfig,
  defaultModelStore,
  managedOllamaEnvironment,
  resolveManagedOllamaConfig,
};
