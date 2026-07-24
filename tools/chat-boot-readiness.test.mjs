import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHAT_BOOT_READY_TIMEOUT_MS,
  FIRST_CHAT_BOOT_MIN_MS,
  WARM_CHAT_BOOT_MIN_MS,
  isChatBootReadyStatus,
  waitForChatBootReadiness,
} from '../src/features/shell/chatBootReadiness.js';

function createScheduler() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();

  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  return {
    setTimer(callback, delay) {
      const id = nextId;
      nextId += 1;
      tasks.set(id, { callback, dueAt: now + delay });
      return id;
    },
    clearTimer(id) {
      tasks.delete(id);
    },
    async advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const nextTask = [...tasks.entries()]
          .filter(([, task]) => task.dueAt <= target)
          .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
        if (!nextTask) break;
        const [id, task] = nextTask;
        tasks.delete(id);
        now = task.dueAt;
        task.callback();
        await flushMicrotasks();
      }
      now = target;
      await flushMicrotasks();
    },
    pendingCount() {
      return tasks.size;
    },
    flushMicrotasks,
  };
}

function createReadinessCheck(scheduler, readiness, minimumMs = FIRST_CHAT_BOOT_MIN_MS) {
  return waitForChatBootReadiness({
    readiness,
    minimumMs,
    maximumMs: CHAT_BOOT_READY_TIMEOUT_MS,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
  });
}

test('only a ready runtime can be marked warm or trigger interactive prefetches', () => {
  assert.equal(isChatBootReadyStatus('ready'), true);
  assert.equal(isChatBootReadyStatus('degraded'), false);
  assert.equal(isChatBootReadyStatus('timeout'), false);
});

test('holds an already-ready cold boot until the 900 ms visual floor', async () => {
  const scheduler = createScheduler();
  const result = createReadinessCheck(scheduler, Promise.resolve(true));
  let settled = false;
  result.then(() => { settled = true; });

  await scheduler.advance(FIRST_CHAT_BOOT_MIN_MS - 1);
  assert.equal(settled, false);
  await scheduler.advance(1);
  assert.equal(await result, 'ready');
  assert.equal(scheduler.pendingCount(), 0);
});

test('keeps waiting after the floor until the chat controls report ready', async () => {
  const scheduler = createScheduler();
  let resolveReadiness;
  const readiness = new Promise((resolve) => { resolveReadiness = resolve; });
  const result = createReadinessCheck(scheduler, readiness);
  let settled = false;
  result.then(() => { settled = true; });

  await scheduler.advance(FIRST_CHAT_BOOT_MIN_MS);
  assert.equal(settled, false);
  resolveReadiness(true);
  await scheduler.flushMicrotasks();
  assert.equal(await result, 'ready');
  assert.equal(scheduler.pendingCount(), 0);
});

test('falls through at the hard readiness deadline if React never signals', async () => {
  const scheduler = createScheduler();
  const result = createReadinessCheck(scheduler, new Promise(() => {}));

  await scheduler.advance(CHAT_BOOT_READY_TIMEOUT_MS);
  assert.equal(await result, 'timeout');
  assert.equal(scheduler.pendingCount(), 0);
});

test('degrades safely on a rejected or missing chat surface without stranding the loader', async () => {
  const rejectedScheduler = createScheduler();
  const rejected = createReadinessCheck(rejectedScheduler, Promise.reject(new Error('mount failed')));
  await rejectedScheduler.advance(FIRST_CHAT_BOOT_MIN_MS);
  assert.equal(await rejected, 'degraded');
  assert.equal(rejectedScheduler.pendingCount(), 0);

  const missingScheduler = createScheduler();
  const missing = createReadinessCheck(missingScheduler, Promise.resolve(false), WARM_CHAT_BOOT_MIN_MS);
  await missingScheduler.advance(WARM_CHAT_BOOT_MIN_MS);
  assert.equal(await missing, 'degraded');
  assert.equal(missingScheduler.pendingCount(), 0);
});

test('a late readiness signal cannot change a completed timeout', async () => {
  const scheduler = createScheduler();
  let resolveReadiness;
  const readiness = new Promise((resolve) => { resolveReadiness = resolve; });
  const result = createReadinessCheck(scheduler, readiness);

  await scheduler.advance(CHAT_BOOT_READY_TIMEOUT_MS);
  assert.equal(await result, 'timeout');
  resolveReadiness(true);
  await scheduler.flushMicrotasks();
  assert.equal(await result, 'timeout');
  assert.equal(scheduler.pendingCount(), 0);
});
