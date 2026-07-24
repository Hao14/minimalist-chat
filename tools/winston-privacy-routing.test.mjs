import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import {
  buildWinstonRouteReceipt,
  classifyWinstonSensitivity,
  prepareWinstonPromptForRoute,
  redactWinstonSensitiveText,
} from '../src/features/ai/winstonPrivacy.js';
import {
  decideWinstonAdaptiveRoute,
  scoreWinstonPromptComplexity,
} from '../src/features/ai/winstonAdaptiveRouting.js';
import {
  WINSTON_VAULT_SCHEMA_VERSION,
  createWinstonEncryptedVault,
  deserializeWinstonVaultExport,
  migrateWinstonVaultRecord,
} from '../src/features/ai/winstonEncryptedVault.js';

class FakeIdbTransaction {
  #stores;

  #pending = 0;

  #generation = 0;

  constructor(stores) {
    this.#stores = stores;
    this.error = null;
    this.onabort = null;
    this.oncomplete = null;
    this.onerror = null;
  }

  objectStore(name) {
    const values = this.#stores.get(name);
    const execute = (operation) => {
      const request = {
        error: null,
        result: undefined,
        onsuccess: null,
        onerror: null,
      };
      this.#pending += 1;
      this.#generation += 1;
      const generation = this.#generation;
      queueMicrotask(() => {
        try {
          request.result = operation();
          request.onsuccess?.();
        } catch (error) {
          request.error = error;
          request.onerror?.();
          this.error = error;
          this.onerror?.();
        } finally {
          this.#pending -= 1;
          setTimeout(() => {
            if (this.#pending === 0 && generation === this.#generation) this.oncomplete?.();
          }, 0);
        }
      });
      return request;
    };
    return {
      get: (key) => execute(() => values.get(key)),
      getAll: () => execute(() => [...values.values()]),
      put: (value, key) => execute(() => {
        values.set(key, value);
        return key;
      }),
      delete: (key) => execute(() => values.delete(key)),
      clear: () => execute(() => values.clear()),
    };
  }
}

class FakeIndexedDb {
  constructor() {
    this.stores = new Map();
  }

  open() {
    const request = {
      error: null,
      result: null,
      onblocked: null,
      onerror: null,
      onsuccess: null,
      onupgradeneeded: null,
    };
    queueMicrotask(() => {
      const database = {
        objectStoreNames: {
          contains: (name) => this.stores.has(name),
        },
        createObjectStore: (name) => {
          this.stores.set(name, new Map());
        },
        transaction: (names) => new FakeIdbTransaction(
          new Map(
            (Array.isArray(names) ? names : [names])
              .map((name) => [name, this.stores.get(name)]),
          ),
        ),
      };
      request.result = database;
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
}

test('sensitivity classification is deterministic, structured, and does not return secret values', () => {
  const prompt = [
    'My password is Correct-Horse-42.',
    'Card: 4242 4242 4242 4242.',
    'Email me at person@example.com.',
  ].join(' ');
  const first = classifyWinstonSensitivity(prompt);
  const second = classifyWinstonSensitivity(prompt);

  assert.deepEqual(first, second);
  assert.equal(first.severity, 'critical');
  assert.equal(first.localOnly, true);
  assert.deepEqual(first.categories.map(({ id }) => id), [
    'credentials',
    'payment_card',
    'contact',
  ]);
  assert.doesNotMatch(JSON.stringify(first), /Correct-Horse|4242|person@example/i);
});

test('cloud preparation blocks local-only data and redacts low-risk contact data', () => {
  const blocked = prepareWinstonPromptForRoute(
    'My SSN is 123-45-6789 and my email is private@example.com.',
    { provider: 'groq' },
  );
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.text, '');
  assert.equal(blocked.policy, 'blocked_local_only');

  const redacted = prepareWinstonPromptForRoute(
    'Send the agenda to private@example.com.',
    { provider: 'cloudflare' },
  );
  assert.equal(redacted.allowed, true);
  assert.equal(redacted.text, 'Send the agenda to [REDACTED CONTACT].');
  assert.equal(redacted.redacted, true);

  const local = prepareWinstonPromptForRoute(
    'My SSN is 123-45-6789.',
    { provider: 'local' },
  );
  assert.equal(local.allowed, true);
  assert.match(local.text, /123-45-6789/);
});

test('redaction merges overlapping findings and validates payment cards with Luhn', () => {
  const redacted = redactWinstonSensitiveText(
    'password: hunter22, fake card 1234 5678 9012 3456, valid 4242-4242-4242-4242',
  );
  assert.equal(redacted.changed, true);
  assert.match(redacted.text, /\[REDACTED CREDENTIAL\]/);
  assert.match(redacted.text, /1234 5678 9012 3456/);
  assert.match(redacted.text, /\[REDACTED PAYMENT CARD\]/);
  assert.doesNotMatch(redacted.text, /hunter22|4242-4242/);
});

test('route receipts expose policy decisions without prompt or matched values', () => {
  const classification = classifyWinstonSensitivity('password: secret-value');
  const routePreparation = prepareWinstonPromptForRoute('password: secret-value', {
    provider: 'cloudflare',
  });
  const receipt = buildWinstonRouteReceipt({
    requestId: 'request_12345678',
    classification,
    routePreparation,
    routeDecision: {
      provider: null,
      modelProfile: 'smart',
      routeBlocked: true,
      reasons: ['local_only', 'no_healthy_capable_provider'],
    },
    createdAt: 123,
  });

  assert.equal(receipt.provider, 'blocked');
  assert.equal(receipt.promptIncluded, false);
  assert.equal(receipt.localOnly, true);
  assert.deepEqual(receipt.categories, ['credentials']);
  assert.doesNotMatch(JSON.stringify(receipt), /secret-value|password:/i);
});

test('complexity scoring remains bounded and selects Smart for multi-part document work', () => {
  const complexity = scoreWinstonPromptComplexity(
    'Analyze these trade-offs.\n1. Compare cost\n2. Propose a detailed strategy?',
    { attachments: [{ mimeType: 'application/pdf' }] },
  );
  assert.ok(complexity.score >= 4 && complexity.score <= 10);
  assert.equal(complexity.band === 'medium' || complexity.band === 'high', true);
  assert.deepEqual(complexity.attachmentKinds, ['document']);

  const decision = decideWinstonAdaptiveRoute({
    prompt: 'Analyze these trade-offs and propose a comprehensive strategy.',
    attachments: ['document'],
  });
  assert.equal(decision.modelProfile, 'smart');
  assert.equal(decision.automaticProfile, true);
});

test('adaptive routing honors local-only sensitivity even when cloud is faster', () => {
  const decision = decideWinstonAdaptiveRoute({
    prompt: 'My medical record diagnosis: migraine.',
    providerHealth: {
      local: { latencyMs: 9_000 },
      cloudflare: { latencyMs: 100 },
      groq: { latencyMs: 50 },
    },
    localMetrics: { ttftMs: 8_000, tokensPerSecond: 2 },
  });

  assert.equal(decision.localOnly, true);
  assert.equal(decision.provider, 'local');
  assert.deepEqual(decision.fallbackProviders, []);
  assert.ok(decision.excludedProviders.every(({ reason }) => reason === 'local_only'));
});

test('adaptive routing accounts for queues, provider health, attachments, and feedback', () => {
  const overloaded = decideWinstonAdaptiveRoute({
    prompt: 'Transcribe this recording.',
    attachments: [{ mimeType: 'audio/webm' }],
    providerHealth: {
      local: { supports: ['text', 'audio'] },
      cloudflare: { supports: ['text', 'audio'], healthy: false },
      groq: { supports: ['text', 'audio'], latencyMs: 300 },
    },
    queue: {
      local: { depth: 19, capacity: 10 },
      groq: { depth: 2, capacity: 40 },
    },
    feedback: {
      providers: {
        local: { helpful: 4, total: 10 },
        groq: { helpful: 9, total: 10 },
      },
    },
  });
  assert.equal(overloaded.provider, 'groq');
  assert.ok(overloaded.reasons.includes('audio_specialist'));
  assert.equal(overloaded.providerScores.cloudflare, undefined);
  assert.deepEqual(
    overloaded.excludedProviders.find(({ provider }) => provider === 'cloudflare'),
    { provider: 'cloudflare', reason: 'unhealthy' },
  );
});

test('adaptive routing fails closed when local-only data has no capable local provider', () => {
  const decision = decideWinstonAdaptiveRoute({
    prompt: 'password: local-secret',
    attachments: ['audio'],
    providerHealth: {
      local: { supports: ['text'], available: true },
    },
  });
  assert.equal(decision.routeBlocked, true);
  assert.equal(decision.provider, null);
  assert.ok(decision.reasons.includes('no_healthy_capable_provider'));
});

test('unsupported encrypted vault never falls back to plaintext browser storage', async () => {
  const writes = [];
  const storage = {
    getItem: () => JSON.stringify({ secret: 'password: hunter22' }),
    setItem: (...args) => writes.push(args),
    removeItem: (...args) => writes.push(args),
  };
  const vault = createWinstonEncryptedVault({
    indexedDB: undefined,
    crypto: undefined,
  });

  assert.equal(vault.supported, false);
  assert.deepEqual(
    await vault.set('conversation', { secret: 'password: hunter22' }),
    { ok: false, reason: 'secure_storage_unavailable' },
  );
  assert.equal(await vault.get('conversation'), null);
  assert.deepEqual(await vault.list(), []);
  assert.deepEqual(
    await vault.migrateFromStorage({ storage, storageKey: 'legacy' }),
    { ok: false, reason: 'secure_storage_unavailable', migrated: false },
  );
  assert.deepEqual(writes, []);
});

test('vault degrades safely when IndexedDB exists but cannot be opened', async () => {
  const indexedDB = {
    open() {
      const request = {
        error: new Error('storage denied'),
        onblocked: null,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => request.onerror?.());
      return request;
    },
  };
  const removed = [];
  const vault = createWinstonEncryptedVault({ indexedDB, crypto: webcrypto });
  assert.equal(vault.supported, true, 'capabilities exist even though opening storage fails');
  assert.deepEqual(
    await vault.set('private', { secret: 'password: no-write' }),
    { ok: false, reason: 'secure_storage_unavailable' },
  );
  assert.equal(await vault.get('private'), null);
  assert.deepEqual(await vault.list(), []);
  assert.deepEqual(
    await vault.migrateFromStorage({
      storage: {
        getItem: () => JSON.stringify({ secret: 'password: no-write' }),
        removeItem: (key) => removed.push(key),
      },
      storageKey: 'legacy-private',
    }),
    { ok: false, reason: 'secure_storage_unavailable', migrated: false },
  );
  assert.deepEqual(removed, []);
});

test('vault encrypts at rest with a non-extractable key and supports retention, export, and erasure', async () => {
  const indexedDB = new FakeIndexedDb();
  let timestamp = 1_000_000;
  const vault = createWinstonEncryptedVault({
    indexedDB,
    crypto: webcrypto,
    now: () => timestamp,
  });
  assert.equal(vault.supported, true);

  const saved = await vault.set('conversation:private', {
    note: 'password: correct-horse-battery',
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.encrypted, true);
  assert.equal(saved.sensitivity, 'critical');

  const storedKey = indexedDB.stores.get('keys').get('winston-vault-aes-gcm-v1');
  assert.equal(storedKey.extractable, false);
  assert.deepEqual(new Set(storedKey.usages), new Set(['decrypt', 'encrypt']));
  const [storedRecord] = indexedDB.stores.get('records').values();
  assert.equal(storedRecord.algorithm, 'AES-GCM');
  assert.doesNotMatch(JSON.stringify(storedRecord), /correct-horse|conversation:private/);
  assert.deepEqual(await vault.get('conversation:private'), {
    note: 'password: correct-horse-battery',
  });

  const metadata = await vault.list();
  assert.equal(metadata.length, 1);
  assert.equal('value' in metadata[0], false);
  const encryptedExport = await vault.exportData();
  assert.equal(encryptedExport.encrypted, true);
  assert.doesNotMatch(JSON.stringify(encryptedExport), /correct-horse|conversation:private/);
  const decryptedExport = await vault.exportData({ decrypted: true });
  assert.equal(decryptedExport.encrypted, false);
  assert.equal(decryptedExport.records[0].key, 'conversation:private');

  timestamp += 91 * 24 * 60 * 60 * 1_000;
  assert.equal(await vault.get('conversation:private'), null);
  assert.equal((await vault.purgeExpired()).deleted, 0, 'get already removes the expired record');

  await vault.set('temporary', { value: 1 });
  assert.equal(indexedDB.stores.get('records').size, 1);
  assert.deepEqual(await vault.deleteAll(), { ok: true });
  assert.equal(indexedDB.stores.get('records').size, 0);
  assert.equal(indexedDB.stores.get('keys').size, 0);
});

test('legacy plaintext is removed only after a successful encrypted migration', async () => {
  const indexedDB = new FakeIndexedDb();
  const values = new Map([['legacy-winston', JSON.stringify({ note: 'private data' })]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
  };
  const vault = createWinstonEncryptedVault({ indexedDB, crypto: webcrypto });
  const result = await vault.migrateFromStorage({
    storage,
    storageKey: 'legacy-winston',
  });
  assert.deepEqual(result, {
    ok: true,
    migrated: true,
    sourceRemoved: true,
  });
  assert.equal(values.has('legacy-winston'), false);
  assert.deepEqual(await vault.get('legacy:legacy-winston'), { note: 'private data' });
});

test('versioned vault migration validates envelopes without exposing plaintext', () => {
  const record = migrateWinstonVaultRecord({
    version: 1,
    id: 'a'.repeat(64),
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array([1, 2, 3]),
    createdAt: 10,
    updatedAt: 20,
    expiresAt: 30,
    metadata: { severity: 'high', categories: ['health'] },
  });
  assert.equal(record.schemaVersion, WINSTON_VAULT_SCHEMA_VERSION);
  assert.equal(record.cryptoVersion, 1);
  assert.equal(record.algorithm, 'AES-GCM');
  assert.equal(migrateWinstonVaultRecord({ version: 999 }), null);

  const exported = {
    version: WINSTON_VAULT_SCHEMA_VERSION,
    encrypted: true,
    records: [{
      ...record,
      iv: btoa(String.fromCharCode(...record.iv)),
      ciphertext: btoa(String.fromCharCode(...record.ciphertext)),
    }],
  };
  const [decoded] = deserializeWinstonVaultExport(exported);
  assert.equal(decoded.id, record.id);
  assert.deepEqual([...decoded.ciphertext], [1, 2, 3]);
});

test('vault source requires AES-GCM, a non-extractable key, and IndexedDB', async () => {
  const source = await import('node:fs/promises')
    .then((fs) => fs.readFile(
      new URL('../src/features/ai/winstonEncryptedVault.js', import.meta.url),
      'utf8',
    ));
  assert.match(source, /indexedDB\.open/);
  assert.match(source, /\{ name: 'AES-GCM', length: 256 \},\s*false,\s*\['encrypt', 'decrypt'\]/);
  assert.match(source, /additionalData:/);
  assert.doesNotMatch(source, /localStorage\?\.setItem|storage\.setItem/);
});
