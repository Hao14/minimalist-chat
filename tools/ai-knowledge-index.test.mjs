import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const knowledge = require('../functions/ai-knowledge-index.js');

function rawItem(sourceId, text, overrides = {}) {
  return {
    sourceType: 'message',
    sourceId,
    title: `Message ${sourceId}`,
    text,
    timestamp: 100,
    acl: { scope: 'room', roomId: 'room_allowed' },
    ...overrides,
  };
}

const authorization = {
  actorUid: 'user_123',
  authorizedRoomIds: ['room_allowed', 'room_second'],
};

test('authorized normalization is fail-closed, bounded, and ignores caller-owned hashes', () => {
  const [item] = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('message_123', 'Launch review is Friday.', {
      contentHash: 'attacker-value',
      aclHash: 'attacker-value',
      recordHash: 'attacker-value',
      vectorNamespace: 'attacker-value',
      privateStoragePath: '/users/other/private',
    }),
  ], authorization);

  assert.match(item.id, /^ki_[a-f0-9]{40}$/);
  assert.match(item.contentHash, /^[a-f0-9]{64}$/);
  assert.match(item.aclHash, /^[a-f0-9]{64}$/);
  assert.match(item.recordHash, /^[a-f0-9]{64}$/);
  assert.match(item.vectorNamespace, /^kiv1_[a-f0-9]{40}$/);
  assert.notEqual(item.contentHash, 'attacker-value');
  assert.equal('privateStoragePath' in item, false);
  assert.deepEqual(Object.keys(item), [
    'id',
    'sourceKey',
    'sourceType',
    'sourceId',
    'title',
    'text',
    'timestamp',
    'updatedAt',
    'acl',
    'contentHash',
    'aclHash',
    'recordHash',
    'vectorNamespace',
  ]);

  assert.throws(() => knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('forbidden_123', 'Private room text.', {
      acl: { scope: 'room', roomId: 'room_forbidden' },
      authorized: true,
    }),
  ], authorization), (error) => error.code === 'KNOWLEDGE_INDEX_FORBIDDEN');

  assert.throws(() => knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('private_123', 'Another owner text.', {
      acl: { scope: 'personal', ownerUid: 'other_user' },
    }),
  ], authorization), (error) => error.code === 'KNOWLEDGE_INDEX_FORBIDDEN');
});

test('content, ACL, record, and vector hashes have separate deterministic responsibilities', () => {
  const roomOne = knowledge.normalizeKnowledgeIndexItem(rawItem(
    'stable_123',
    'The launch review starts at 09:00.',
  ));
  const roomOneAgain = knowledge.normalizeKnowledgeIndexItem({
    ...rawItem('stable_123', 'The launch review starts at 09:00.'),
    contentHash: 'ignored',
  });
  const roomTwo = knowledge.normalizeKnowledgeIndexItem(rawItem(
    'stable_123',
    'The launch review starts at 09:00.',
    { acl: { scope: 'room', roomId: 'room_second' } },
  ));
  const changedText = knowledge.normalizeKnowledgeIndexItem(rawItem(
    'stable_123',
    'The launch review starts at 10:00.',
  ));

  assert.equal(roomOne.id, roomOneAgain.id);
  assert.notEqual(roomOne.id, roomTwo.id);
  assert.equal(roomOne.contentHash, roomOneAgain.contentHash);
  assert.equal(roomOne.contentHash, roomTwo.contentHash);
  assert.notEqual(roomOne.aclHash, roomTwo.aclHash);
  assert.notEqual(roomOne.recordHash, roomTwo.recordHash);
  assert.notEqual(roomOne.vectorNamespace, roomTwo.vectorNamespace);
  assert.notEqual(roomOne.contentHash, changedText.contentHash);
  assert.equal(
    knowledge.knowledgeIndexVectorCacheKey(roomOne, 'nomic-embed-text'),
    knowledge.knowledgeIndexVectorCacheKey(roomOneAgain, 'nomic-embed-text'),
  );
  assert.notEqual(
    knowledge.knowledgeIndexVectorCacheKey(roomOne, 'model-a'),
    knowledge.knowledgeIndexVectorCacheKey(roomOne, 'model-b'),
  );
});

test('snapshot diffs upsert only changes and propagate deletes only for full snapshots', () => {
  const original = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('keep_123', 'Keep this text.'),
    rawItem('delete_123', 'Delete this text.'),
  ], authorization);
  const previousManifest = knowledge.buildKnowledgeIndexManifest(original);
  const changed = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('keep_123', 'Changed text.'),
  ], authorization);

  const partial = knowledge.diffKnowledgeIndexSnapshot({
    previousManifest,
    currentItems: changed,
    fullSnapshot: false,
  });
  assert.equal(partial.upserts.length, 1);
  assert.equal(partial.deletes.length, 0);
  assert.equal(Object.keys(partial.manifest).length, 2);
  assert.deepEqual(partial.upserts[0].retiredVectorNamespaces, [
    original[0].vectorNamespace,
  ]);

  const complete = knowledge.diffKnowledgeIndexSnapshot({
    previousManifest,
    currentItems: changed,
    fullSnapshot: true,
  });
  assert.equal(complete.upserts.length, 1);
  assert.deepEqual(complete.deletes, [{
    id: original[1].id,
    vectorNamespaces: [original[1].vectorNamespace],
    reason: 'source_deleted',
  }]);
  assert.deepEqual(Object.keys(complete.manifest), [changed[0].id]);
  assert.match(complete.snapshotHash, /^[a-f0-9]{64}$/);
});

test('incremental ACL moves delete the old partition record without requiring a full snapshot', () => {
  const [original] = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('moved_123', 'Scope-sensitive evidence.'),
  ], authorization);
  const [moved] = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('moved_123', 'Scope-sensitive evidence.', {
      acl: { scope: 'room', roomId: 'room_second' },
    }),
  ], authorization);
  const diff = knowledge.diffKnowledgeIndexSnapshot({
    previousManifest: knowledge.buildKnowledgeIndexManifest([original]),
    currentItems: [moved],
    fullSnapshot: false,
  });

  assert.notEqual(original.id, moved.id);
  assert.equal(original.sourceKey, moved.sourceKey);
  assert.equal(diff.upserts.length, 1);
  assert.deepEqual(diff.deletes, [{
    id: original.id,
    vectorNamespaces: [original.vectorNamespace],
    reason: 'acl_scope_changed',
  }]);
  assert.deepEqual(Object.keys(diff.manifest), [moved.id]);
});

test('mutation plans are cursor-ordered, independently capped, and remove retired vectors', () => {
  const previous = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('change_123', 'Old text.'),
    rawItem('delete_123', 'Delete text.'),
  ], authorization);
  const current = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('change_123', 'New text.'),
    ...Array.from({ length: 4 }, (_unused, index) => rawItem(
      `new_${index}`,
      `Launch evidence ${index}.`,
    )),
  ], authorization);
  const diff = knowledge.diffKnowledgeIndexSnapshot({
    previousManifest: knowledge.buildKnowledgeIndexManifest(previous),
    currentItems: current,
    fullSnapshot: true,
  });
  const batches = knowledge.planKnowledgeIndexMutationBatches(diff, {
    maxUpserts: 2,
    maxDeletes: 1,
    maxBatchChars: 24_000,
  });

  assert.ok(batches.length >= 3);
  assert.ok(batches.every((batch) => batch.upserts.length <= 2));
  assert.ok(batches.every((batch) => batch.deletes.length <= 1));
  assert.equal(batches.at(-1).complete, true);
  assert.ok(batches.slice(1).every((batch, index) => (
    batch.cursor.position === batches[index].nextCursor.position
  )));

  const oldVectorKey = knowledge.knowledgeIndexVectorCacheKey(previous[0], 'model-a');
  const deletedVectorKey = knowledge.knowledgeIndexVectorCacheKey(previous[1], 'model-a');
  let state = {
    records: Object.fromEntries(previous.map((item) => [item.id, item])),
    vectorCache: {
      [oldVectorKey]: [1, 0],
      [deletedVectorKey]: [0, 1],
      unrelated_cache_key: [1, 1],
    },
  };
  for (const batch of batches) {
    state = knowledge.applyKnowledgeIndexMutationBatch(state, batch);
  }
  assert.equal(Object.keys(state.records).length, current.length);
  assert.equal(oldVectorKey in state.vectorCache, false);
  assert.equal(deletedVectorKey in state.vectorCache, false);
  assert.deepEqual(state.vectorCache.unrelated_cache_key, [1, 1]);
  assert.throws(
    () => knowledge.applyKnowledgeIndexMutationBatch(state, batches[0]),
    (error) => error.code === 'KNOWLEDGE_INDEX_CURSOR_CONFLICT',
  );
  assert.throws(
    () => knowledge.applyKnowledgeIndexMutationBatch({}, batches[1]),
    (error) => error.code === 'KNOWLEDGE_INDEX_CURSOR_CONFLICT',
  );
});

test('empty mutation plans still advance a validated snapshot cursor', () => {
  const snapshotHash = 'a'.repeat(64);
  const [batch] = knowledge.planKnowledgeIndexMutationBatches({
    upserts: [],
    deletes: [],
    snapshotHash,
  });
  assert.deepEqual(batch.cursor, batch.nextCursor);
  assert.equal(batch.complete, true);
  assert.equal(batch.cursor.totalMutations, 0);
  assert.deepEqual(knowledge.normalizeKnowledgeIndexCursor(batch.cursor), batch.cursor);
  assert.throws(
    () => knowledge.normalizeKnowledgeIndexCursor({ ...batch.cursor, position: -1 }),
    (error) => error.code === 'KNOWLEDGE_INDEX_CURSOR_INVALID',
  );
});

test('a completed generation can transition once to a new position-zero snapshot', () => {
  const [first] = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('generation_123', 'First generation.'),
  ], authorization);
  const firstDiff = knowledge.diffKnowledgeIndexSnapshot({
    previousManifest: {},
    currentItems: [first],
    fullSnapshot: true,
  });
  const [firstBatch] = knowledge.planKnowledgeIndexMutationBatches(firstDiff);
  const completed = knowledge.applyKnowledgeIndexMutationBatch({}, firstBatch);
  const noOpDiff = knowledge.diffKnowledgeIndexSnapshot({
    previousManifest: firstDiff.manifest,
    currentItems: [first],
    fullSnapshot: true,
  });
  const [noOpBatch] = knowledge.planKnowledgeIndexMutationBatches(noOpDiff);
  const confirmed = knowledge.applyKnowledgeIndexMutationBatch(completed, noOpBatch);
  assert.equal(noOpBatch.cursor.totalMutations, 0);
  assert.deepEqual(confirmed.records, completed.records);

  const [second] = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('generation_123', 'Second generation.'),
  ], authorization);
  const secondDiff = knowledge.diffKnowledgeIndexSnapshot({
    previousManifest: firstDiff.manifest,
    currentItems: [second],
    fullSnapshot: true,
  });
  const [secondBatch] = knowledge.planKnowledgeIndexMutationBatches(secondDiff);
  const advanced = knowledge.applyKnowledgeIndexMutationBatch(confirmed, secondBatch);

  assert.notEqual(firstBatch.cursor.generation, secondBatch.cursor.generation);
  assert.equal(secondBatch.cursor.position, 0);
  assert.equal(advanced.cursor.position, advanced.cursor.totalMutations);
  assert.equal(advanced.records[second.id].text, 'Second generation.');

  assert.throws(() => knowledge.applyKnowledgeIndexMutationBatch({}, {
    ...firstBatch,
    complete: true,
    nextCursor: {
      ...firstBatch.nextCursor,
      totalMutations: firstBatch.nextCursor.totalMutations + 1,
    },
  }), (error) => error.code === 'KNOWLEDGE_INDEX_CURSOR_PROGRESSION_INVALID');
});

test('cached-vector retrieval embeds only cache misses and rechecks current ACLs', async () => {
  const accessible = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('cached_123', 'Apollo launch review is Friday.'),
    rawItem('missing_123', 'Apollo launch meeting is in the hangar.', {
      sourceType: 'event',
    }),
  ], authorization);
  const forbidden = knowledge.normalizeKnowledgeIndexItem(rawItem(
    'forbidden_123',
    'Secret Apollo launch code.',
    { acl: { scope: 'room', roomId: 'room_forbidden' } },
  ));
  const cachedKey = knowledge.knowledgeIndexVectorCacheKey(
    accessible[0],
    'nomic-embed-text',
  );
  const reads = [];
  const writes = [];
  const embeddedBatches = [];
  const result = await knowledge.rankKnowledgeIndexItems({
    query: 'Where is the Apollo launch meeting?',
    items: [...accessible, forbidden],
    ...authorization,
    embeddingModel: 'nomic-embed-text',
    getCachedVector: async ({ key }) => {
      reads.push(key);
      return key === cachedKey ? [0.7, 0.2, 0.1] : null;
    },
    setCachedVector: async (entry) => writes.push(entry),
    embedder: async (texts) => {
      embeddedBatches.push(texts);
      return texts.map((_text, index) => (
        index === 0 ? [1, 0, 0] : [0.98, 0.02, 0]
      ));
    },
  });

  assert.equal(result.mode, 'semantic');
  assert.equal(result.metrics.authorizedCandidates, 2);
  assert.equal(result.metrics.cacheHits, 1);
  assert.equal(result.metrics.cacheMisses, 1);
  assert.equal(result.metrics.embeddedItems, 1);
  assert.equal(reads.length, 2);
  assert.equal(writes.length, 1);
  assert.equal(embeddedBatches.length, 1);
  assert.equal(embeddedBatches[0].length, 2, 'query plus one cache miss');
  assert.equal(result.results.some((row) => row.item.sourceId === 'forbidden_123'), false);
});

test('embedding and cache failures remain a deterministic lexical fallback', async () => {
  const result = await knowledge.rankKnowledgeIndexItems({
    query: 'vendor renewal August',
    items: [
      rawItem('relevant_123', 'The vendor renewal deadline is August 4.'),
      rawItem('noise_123', 'Lunch arrives at noon.'),
    ],
    ...authorization,
    getCachedVector: async () => {
      throw new Error('cache unavailable with sensitive detail');
    },
    embedder: async () => {
      throw new Error('model unavailable with sensitive detail');
    },
  });

  assert.equal(result.mode, 'lexical');
  assert.equal(result.results[0].item.sourceId, 'relevant_123');
  assert.doesNotMatch(JSON.stringify(result.metrics), /sensitive detail/);
});

test('cached vectors with stale dimensions are re-embedded instead of downgrading retrieval', async () => {
  const [item] = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('stale_vector_123', 'Apollo launch review is Friday.'),
  ], authorization);
  const batches = [];
  const writes = [];
  const result = await knowledge.rankKnowledgeIndexItems({
    query: 'Apollo launch review',
    items: [item],
    ...authorization,
    getCachedVector: async () => [1, 0],
    setCachedVector: async (entry) => writes.push(entry),
    embedder: async (texts) => {
      batches.push(texts);
      return texts.map(() => [1, 0, 0]);
    },
  });

  assert.equal(result.mode, 'semantic');
  assert.equal(result.metrics.cacheHits, 0);
  assert.equal(result.metrics.cacheMisses, 1);
  assert.equal(result.metrics.embeddedItems, 1);
  assert.deepEqual(batches.map((batch) => batch.length), [1, 1]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].vector.length, 3);
});

test('snapshot and item hard limits reject ambiguous partial indexing', () => {
  assert.throws(() => knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('one_123', 'One'),
    rawItem('two_123', 'Two'),
  ], {
    ...authorization,
    maxItems: 1,
  }), (error) => error.code === 'KNOWLEDGE_INDEX_ITEM_LIMIT');

  assert.throws(() => knowledge.normalizeKnowledgeIndexItem(rawItem(
    'large_123',
    'x'.repeat(knowledge.KNOWLEDGE_INDEX_LIMITS.maxItemChars + 1),
  )), (error) => error.code === 'KNOWLEDGE_INDEX_TEXT_LIMIT');

  assert.throws(() => knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('duplicate_123', 'One'),
    rawItem('duplicate_123', 'Two'),
  ], authorization), (error) => error.code === 'KNOWLEDGE_INDEX_DUPLICATE');

  assert.throws(() => knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('cross_scope_duplicate_123', 'One'),
    rawItem('cross_scope_duplicate_123', 'Two', {
      acl: { scope: 'room', roomId: 'room_second' },
    }),
  ], authorization), (error) => error.code === 'KNOWLEDGE_INDEX_DUPLICATE');

  const [validItem] = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('manifest_duplicate_123', 'One'),
  ], authorization);
  assert.throws(
    () => knowledge.buildKnowledgeIndexManifest([validItem, validItem]),
    (error) => error.code === 'KNOWLEDGE_INDEX_DUPLICATE',
  );
});

test('forged normalized records and cursor jumps cannot bypass mutation integrity', () => {
  const [item] = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('integrity_123', 'Original evidence.'),
  ], authorization);
  const forged = {
    ...item,
    text: 'Replaced evidence.',
  };
  assert.throws(
    () => knowledge.validateKnowledgeIndexItem(forged),
    (error) => error.code === 'KNOWLEDGE_INDEX_ITEM_INTEGRITY',
  );
  assert.throws(
    () => knowledge.diffKnowledgeIndexSnapshot({
      previousManifest: {},
      currentItems: [forged],
      fullSnapshot: true,
    }),
    (error) => error.code === 'KNOWLEDGE_INDEX_ITEM_INTEGRITY',
  );
  assert.throws(
    () => knowledge.diffKnowledgeIndexSnapshot({
      previousManifest: {
        invalid_record: {
          recordHash: 'a'.repeat(64),
        },
      },
      currentItems: [],
      fullSnapshot: true,
    }),
    (error) => error.code === 'KNOWLEDGE_INDEX_MANIFEST_INVALID',
  );

  const diff = knowledge.diffKnowledgeIndexSnapshot({
    previousManifest: {},
    currentItems: [item],
    fullSnapshot: true,
  });
  const [batch] = knowledge.planKnowledgeIndexMutationBatches(diff);
  assert.throws(
    () => knowledge.applyKnowledgeIndexMutationBatch({}, {
      ...batch,
      nextCursor: {
        ...batch.nextCursor,
        position: batch.nextCursor.position + 1,
        totalMutations: batch.nextCursor.totalMutations + 1,
      },
    }),
    (error) => error.code === 'KNOWLEDGE_INDEX_CURSOR_PROGRESSION_INVALID',
  );
});

test('vector purge scope is derived from stored records and rejects omitted or unrelated namespaces', () => {
  const [original, unrelated] = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('purge_123', 'Sensitive cached evidence.'),
    rawItem('unrelated_purge_123', 'Unrelated evidence.'),
  ], authorization);
  const originalKey = knowledge.knowledgeIndexVectorCacheKey(original, 'model-a');
  const unrelatedKey = knowledge.knowledgeIndexVectorCacheKey(unrelated, 'model-a');
  const state = {
    records: {
      [original.id]: original,
      [unrelated.id]: unrelated,
    },
    vectorCache: {
      [originalKey]: [1, 0],
      [unrelatedKey]: [0, 1],
    },
  };
  const deletionDiff = knowledge.diffKnowledgeIndexSnapshot({
    previousManifest: knowledge.buildKnowledgeIndexManifest([original, unrelated]),
    currentItems: [unrelated],
    fullSnapshot: true,
  });
  const [deletionBatch] = knowledge.planKnowledgeIndexMutationBatches(deletionDiff);

  for (const vectorNamespaces of [[], [unrelated.vectorNamespace]]) {
    assert.throws(() => knowledge.applyKnowledgeIndexMutationBatch(state, {
      ...deletionBatch,
      deletes: [{
        ...deletionBatch.deletes[0],
        vectorNamespaces,
      }],
    }), (error) => error.code === 'KNOWLEDGE_INDEX_DELETE_CONFLICT');
  }
  const deleted = knowledge.applyKnowledgeIndexMutationBatch(state, deletionBatch);
  assert.equal(original.id in deleted.records, false);
  assert.equal(originalKey in deleted.vectorCache, false);
  assert.deepEqual(deleted.vectorCache[unrelatedKey], [0, 1]);

  const changed = knowledge.normalizeAuthorizedKnowledgeIndexItems([
    rawItem('unrelated_purge_123', 'Updated unrelated evidence.'),
  ], authorization)[0];
  const updateDiff = knowledge.diffKnowledgeIndexSnapshot({
    previousManifest: knowledge.buildKnowledgeIndexManifest([unrelated]),
    currentItems: [changed],
    fullSnapshot: true,
  });
  const [updateBatch] = knowledge.planKnowledgeIndexMutationBatches(updateDiff);
  assert.throws(() => knowledge.applyKnowledgeIndexMutationBatch({
    records: { [unrelated.id]: unrelated },
    vectorCache: { [unrelatedKey]: [0, 1] },
  }, {
    ...updateBatch,
    upserts: [{
      ...updateBatch.upserts[0],
      retiredVectorNamespaces: [],
    }],
  }), (error) => error.code === 'KNOWLEDGE_INDEX_UPSERT_CONFLICT');
});
