import { classifyWinstonSensitivity } from './winstonPrivacy.js';

export const WINSTON_VAULT_SCHEMA_VERSION = 2;
export const WINSTON_VAULT_DEFAULT_RETENTION_DAYS = 90;

const DATABASE_VERSION = 1;
const KEY_ID = 'winston-vault-aes-gcm-v1';
const STORES = Object.freeze({
  keys: 'keys',
  records: 'records',
  meta: 'meta',
});
const RETENTION_KEY = 'retention-days';
const MAX_RETENTION_DAYS = 3_650;
const MAX_SERIALIZED_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function boundedRetentionDays(value) {
  const days = Math.floor(Number(value));
  if (!Number.isFinite(days)) return WINSTON_VAULT_DEFAULT_RETENTION_DAYS;
  return Math.max(1, Math.min(MAX_RETENTION_DAYS, days));
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionFinished(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
  });
}

function openVaultDatabase(indexedDB, databaseName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORES.keys)) database.createObjectStore(STORES.keys);
      if (!database.objectStoreNames.contains(STORES.records)) database.createObjectStore(STORES.records);
      if (!database.objectStoreNames.contains(STORES.meta)) database.createObjectStore(STORES.meta);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Winston secure vault could not open.'));
    request.onblocked = () => reject(new Error('Winston secure vault upgrade is blocked.'));
  });
}

function normalizeBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  return new Uint8Array();
}

function bytesToBase64(value) {
  const bytes = normalizeBytes(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function additionalData(recordId, cryptoVersion = 1) {
  return encoder.encode(`minimalist-winston-vault:${recordId}:crypto-v${cryptoVersion}`);
}

function safeRecordId(value) {
  const id = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(id) ? id : '';
}

function safeTimestamp(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function safeMetadata(value) {
  const source = value && typeof value === 'object' ? value : {};
  const severity = ['none', 'low', 'medium', 'high', 'critical'].includes(source.severity)
    ? source.severity
    : 'none';
  const categories = [...new Set(
    (Array.isArray(source.categories) ? source.categories : [])
      .map((category) => String(category || '').trim().toLowerCase())
      .filter((category) => /^[a-z][a-z0-9_]{1,40}$/.test(category)),
  )].slice(0, 12);
  return { severity, categories };
}

export function migrateWinstonVaultRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const version = Math.floor(Number(value.schemaVersion ?? value.version) || 1);
  if (version < 1 || version > WINSTON_VAULT_SCHEMA_VERSION) return null;
  const id = safeRecordId(value.id);
  const iv = normalizeBytes(value.iv);
  const ciphertext = normalizeBytes(value.ciphertext);
  if (!id || iv.length !== 12 || !ciphertext.length) return null;

  if (version === 1) {
    return {
      id,
      schemaVersion: 2,
      cryptoVersion: 1,
      algorithm: 'AES-GCM',
      iv,
      ciphertext,
      createdAt: safeTimestamp(value.createdAt),
      updatedAt: safeTimestamp(value.updatedAt),
      expiresAt: safeTimestamp(value.expiresAt),
      metadata: safeMetadata(value.metadata),
    };
  }

  if (value.algorithm !== 'AES-GCM' || Number(value.cryptoVersion) !== 1) return null;
  return {
    id,
    schemaVersion: WINSTON_VAULT_SCHEMA_VERSION,
    cryptoVersion: 1,
    algorithm: 'AES-GCM',
    iv,
    ciphertext,
    createdAt: safeTimestamp(value.createdAt),
    updatedAt: safeTimestamp(value.updatedAt),
    expiresAt: safeTimestamp(value.expiresAt),
    metadata: safeMetadata(value.metadata),
  };
}

function serializePayload(key, value) {
  const serialized = JSON.stringify({ key: String(key), value });
  if (encoder.encode(serialized).byteLength > MAX_SERIALIZED_BYTES) {
    throw new Error('Winston vault records are limited to 2 MB.');
  }
  return serialized;
}

async function digestRecordId(crypto, key) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(key)));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function encryptPayload(crypto, cryptoKey, recordId, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: additionalData(recordId),
    tagLength: 128,
  }, cryptoKey, encoder.encode(payload));
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

async function decryptPayload(crypto, cryptoKey, record) {
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: normalizeBytes(record.iv),
    additionalData: additionalData(record.id, record.cryptoVersion),
    tagLength: 128,
  }, cryptoKey, normalizeBytes(record.ciphertext));
  return JSON.parse(decoder.decode(plaintext));
}

function safeUnsupportedResult(operation) {
  if (operation === 'get') return null;
  if (operation === 'list') return [];
  if (operation === 'export') {
    return {
      version: WINSTON_VAULT_SCHEMA_VERSION,
      encrypted: true,
      supported: false,
      records: [],
    };
  }
  return { ok: false, reason: 'secure_storage_unavailable' };
}

export function createWinstonEncryptedVault({
  indexedDB = globalThis.indexedDB,
  crypto = globalThis.crypto,
  databaseName = 'minimalist-winston-secure-vault',
  now = () => Date.now(),
} = {}) {
  const supported = Boolean(
    indexedDB?.open
    && crypto?.subtle?.generateKey
    && crypto?.subtle?.encrypt
    && crypto?.subtle?.decrypt
    && crypto?.subtle?.digest
    && crypto?.getRandomValues,
  );
  let databasePromise;

  const database = () => {
    if (!supported) return Promise.resolve(null);
    if (!databasePromise) databasePromise = openVaultDatabase(indexedDB, databaseName);
    return databasePromise;
  };

  const readStore = async (storeName, action) => {
    const db = await database();
    const transaction = db.transaction(storeName, 'readonly');
    const result = await action(transaction.objectStore(storeName));
    await transactionFinished(transaction);
    return result;
  };

  const writeStore = async (storeName, action) => {
    const db = await database();
    const transaction = db.transaction(storeName, 'readwrite');
    const result = await action(transaction.objectStore(storeName));
    await transactionFinished(transaction);
    return result;
  };

  const getOrCreateKey = async () => {
    const existing = await readStore(STORES.keys, (store) => requestResult(store.get(KEY_ID)));
    if (existing) return existing;
    const generated = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    return writeStore(STORES.keys, async (store) => {
      const raced = await requestResult(store.get(KEY_ID));
      if (raced) return raced;
      await requestResult(store.put(generated, KEY_ID));
      return generated;
    });
  };

  const getRetentionDays = async () => {
    if (!supported) return WINSTON_VAULT_DEFAULT_RETENTION_DAYS;
    const stored = await readStore(STORES.meta, (store) => requestResult(store.get(RETENTION_KEY)));
    return boundedRetentionDays(stored);
  };

  const setRetentionDays = async (days) => {
    if (!supported) return safeUnsupportedResult('set');
    const value = boundedRetentionDays(days);
    await writeStore(STORES.meta, (store) => requestResult(store.put(value, RETENTION_KEY)));
    return { ok: true, days: value };
  };

  const set = async (key, value, {
    expiresAt = 0,
    sensitivity,
  } = {}) => {
    if (!supported) return safeUnsupportedResult('set');
    const logicalKey = String(key || '').trim();
    if (!logicalKey || logicalKey.length > 500) {
      return { ok: false, reason: 'invalid_key' };
    }
    let serialized;
    try {
      serialized = serializePayload(logicalKey, value);
    } catch (error) {
      return {
        ok: false,
        reason: error?.message?.includes('2 MB') ? 'record_too_large' : 'not_serializable',
      };
    }
    const classification = sensitivity?.version
      ? sensitivity
      : classifyWinstonSensitivity(serialized);
    const recordId = await digestRecordId(crypto, logicalKey);
    const cryptoKey = await getOrCreateKey();
    const encrypted = await encryptPayload(crypto, cryptoKey, recordId, serialized);
    const timestamp = safeTimestamp(now());
    const retentionDays = await getRetentionDays();
    const record = {
      id: recordId,
      schemaVersion: WINSTON_VAULT_SCHEMA_VERSION,
      cryptoVersion: 1,
      algorithm: 'AES-GCM',
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: safeTimestamp(expiresAt) || timestamp + (retentionDays * 24 * 60 * 60 * 1_000),
      metadata: {
        severity: classification.severity,
        categories: classification.categories.map(({ id }) => id),
      },
    };
    const existing = await readStore(STORES.records, (store) => requestResult(store.get(recordId)));
    if (existing) record.createdAt = safeTimestamp(existing.createdAt) || timestamp;
    await writeStore(STORES.records, (store) => requestResult(store.put(record, recordId)));
    return {
      ok: true,
      id: recordId,
      expiresAt: record.expiresAt,
      encrypted: true,
      sensitivity: record.metadata.severity,
    };
  };

  const get = async (key) => {
    if (!supported) return safeUnsupportedResult('get');
    const recordId = await digestRecordId(crypto, String(key || '').trim());
    const stored = await readStore(STORES.records, (store) => requestResult(store.get(recordId)));
    const record = migrateWinstonVaultRecord(stored);
    if (!record) return null;
    if (record.expiresAt > 0 && record.expiresAt <= safeTimestamp(now())) {
      await writeStore(STORES.records, (store) => requestResult(store.delete(recordId)));
      return null;
    }
    const cryptoKey = await getOrCreateKey();
    const payload = await decryptPayload(crypto, cryptoKey, record);
    return payload?.key === String(key || '').trim() ? payload.value : null;
  };

  const remove = async (key) => {
    if (!supported) return safeUnsupportedResult('delete');
    const recordId = await digestRecordId(crypto, String(key || '').trim());
    await writeStore(STORES.records, (store) => requestResult(store.delete(recordId)));
    return { ok: true };
  };

  const purgeExpired = async ({ at = now() } = {}) => {
    if (!supported) return safeUnsupportedResult('delete');
    const timestamp = safeTimestamp(at);
    const records = await readStore(STORES.records, (store) => requestResult(store.getAll()));
    const expiredIds = records
      .map(migrateWinstonVaultRecord)
      .filter((record) => record && record.expiresAt > 0 && record.expiresAt <= timestamp)
      .map(({ id }) => id);
    if (expiredIds.length) {
      await writeStore(STORES.records, async (store) => {
        for (const id of expiredIds) await requestResult(store.delete(id));
      });
    }
    return { ok: true, deleted: expiredIds.length };
  };

  const list = async ({ includeValues = false } = {}) => {
    if (!supported) return safeUnsupportedResult('list');
    await purgeExpired();
    const records = (await readStore(STORES.records, (store) => requestResult(store.getAll())))
      .map(migrateWinstonVaultRecord)
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
    if (!includeValues) {
      return records.map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        expiresAt: record.expiresAt,
        metadata: record.metadata,
      }));
    }
    const cryptoKey = await getOrCreateKey();
    return Promise.all(records.map(async (record) => {
      const payload = await decryptPayload(crypto, cryptoKey, record);
      return {
        key: payload.key,
        value: payload.value,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        expiresAt: record.expiresAt,
        metadata: record.metadata,
      };
    }));
  };

  const exportData = async ({ decrypted = false } = {}) => {
    if (!supported) return safeUnsupportedResult('export');
    await purgeExpired();
    if (decrypted) {
      return {
        version: WINSTON_VAULT_SCHEMA_VERSION,
        encrypted: false,
        exportedAt: safeTimestamp(now()),
        records: await list({ includeValues: true }),
      };
    }
    const records = (await readStore(STORES.records, (store) => requestResult(store.getAll())))
      .map(migrateWinstonVaultRecord)
      .filter(Boolean)
      .map((record) => ({
        ...record,
        iv: bytesToBase64(record.iv),
        ciphertext: bytesToBase64(record.ciphertext),
      }));
    return {
      version: WINSTON_VAULT_SCHEMA_VERSION,
      encrypted: true,
      exportedAt: safeTimestamp(now()),
      records,
    };
  };

  const deleteAll = async () => {
    if (!supported) return safeUnsupportedResult('delete');
    const db = await database();
    const transaction = db.transaction(Object.values(STORES), 'readwrite');
    for (const storeName of Object.values(STORES)) {
      await requestResult(transaction.objectStore(storeName).clear());
    }
    await transactionFinished(transaction);
    return { ok: true };
  };

  const migrateFromStorage = async ({
    storage = globalThis.localStorage,
    storageKey,
    transform = (value) => value,
  } = {}) => {
    if (!supported) return { ...safeUnsupportedResult('set'), migrated: false };
    const legacyKey = String(storageKey || '').trim();
    if (!legacyKey || typeof storage?.getItem !== 'function') {
      return { ok: false, migrated: false, reason: 'invalid_source' };
    }
    let raw;
    try {
      raw = storage.getItem(legacyKey);
    } catch {
      return { ok: false, migrated: false, reason: 'source_unavailable' };
    }
    if (raw === null) return { ok: true, migrated: false, reason: 'source_empty' };
    let value;
    try {
      value = transform(JSON.parse(raw));
    } catch {
      return { ok: false, migrated: false, reason: 'source_invalid' };
    }
    const result = await set(`legacy:${legacyKey}`, value);
    if (!result.ok) return { ...result, migrated: false };
    try {
      storage.removeItem(legacyKey);
    } catch {
      return { ok: true, migrated: true, sourceRemoved: false };
    }
    return { ok: true, migrated: true, sourceRemoved: true };
  };

  const gracefully = (operation, action, fallback = () => safeUnsupportedResult(operation)) => (
    async (...args) => {
      try {
        return await action(...args);
      } catch {
        return fallback();
      }
    }
  );

  return Object.freeze({
    supported,
    set: gracefully('set', set),
    get: gracefully('get', get),
    delete: gracefully('delete', remove),
    list: gracefully('list', list),
    purgeExpired: gracefully('delete', purgeExpired),
    getRetentionDays: gracefully(
      'get',
      getRetentionDays,
      () => WINSTON_VAULT_DEFAULT_RETENTION_DAYS,
    ),
    setRetentionDays: gracefully('set', setRetentionDays),
    exportData: gracefully('export', exportData),
    deleteAll: gracefully('delete', deleteAll),
    migrateFromStorage: gracefully(
      'set',
      migrateFromStorage,
      () => ({ ...safeUnsupportedResult('set'), migrated: false }),
    ),
  });
}

export function deserializeWinstonVaultExport(value) {
  const source = value && typeof value === 'object' ? value : {};
  if (source.encrypted !== true || Number(source.version) > WINSTON_VAULT_SCHEMA_VERSION) return [];
  return (Array.isArray(source.records) ? source.records : []).flatMap((record) => {
    try {
      const migrated = migrateWinstonVaultRecord({
        ...record,
        iv: base64ToBytes(record.iv),
        ciphertext: base64ToBytes(record.ciphertext),
      });
      return migrated ? [migrated] : [];
    } catch {
      return [];
    }
  });
}
