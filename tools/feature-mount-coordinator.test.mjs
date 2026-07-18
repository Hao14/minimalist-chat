import assert from 'node:assert/strict';
import test from 'node:test';

import { createFeatureMountCoordinator } from '../src/features/shell/featureMountCoordinator.js';
import { createHostAwareRoot } from '../src/features/shell/hostAwareRoot.js';

test('reuses an already mounted context without preparing or committing again', async () => {
  const coordinator = createFeatureMountCoordinator();
  let prepares = 0;
  let commits = 0;
  const mount = () => coordinator.schedule(
    'docs',
    'user-1:room-1',
    async () => { prepares += 1; return 'module'; },
    () => { commits += 1; },
  );

  assert.equal((await mount().promise).status, 'mounted');
  const cached = mount();
  assert.equal(cached.status, 'cached');
  assert.equal((await cached.promise).status, 'cached');
  assert.equal(prepares, 1);
  assert.equal(commits, 1);
});

test('coalesces concurrent work for the same context', async () => {
  const coordinator = createFeatureMountCoordinator();
  let release;
  let prepares = 0;
  let commits = 0;
  const prepare = () => {
    prepares += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = coordinator.schedule('ai', 'room-1:general', prepare, () => { commits += 1; });
  const second = coordinator.schedule('ai', 'room-1:general', prepare, () => { commits += 1; });

  assert.equal(second.status, 'pending');
  assert.equal(first.promise, second.promise);
  await Promise.resolve();
  release('module');
  assert.equal((await first.promise).status, 'mounted');
  assert.equal(prepares, 1);
  assert.equal(commits, 1);
});

test('suppresses a stale completion after a newer context wins', async () => {
  const coordinator = createFeatureMountCoordinator();
  let releaseOld;
  const commits = [];
  const oldTask = coordinator.schedule(
    'calendar',
    'room-old',
    () => new Promise((resolve) => { releaseOld = resolve; }),
    () => commits.push('old'),
  );
  const newTask = coordinator.schedule(
    'calendar',
    'room-new',
    async () => 'new-module',
    () => commits.push('new'),
  );

  await Promise.resolve();
  await Promise.resolve();
  assert.equal((await newTask.promise).status, 'mounted');
  releaseOld('old-module');
  assert.equal((await oldTask.promise).status, 'stale');
  assert.deepEqual(commits, ['new']);
  assert.deepEqual(coordinator.inspect('calendar'), { mountedKey: 'room-new', pendingKey: null });
});

test('remounts the same context when its cached host is no longer valid', async () => {
  const coordinator = createFeatureMountCoordinator();
  let commits = 0;
  const mount = (cacheIsValid = true) => coordinator.schedule(
    'vault',
    'user-1',
    async () => 'module',
    () => { commits += 1; },
    { cacheIsValid: () => cacheIsValid },
  );

  await mount().promise;
  const replacement = mount(false);
  assert.equal(replacement.status, 'started');
  assert.equal((await replacement.promise).status, 'mounted');
  assert.equal(commits, 2);
});

test('does not commit work that stopped being relevant while loading', async () => {
  const coordinator = createFeatureMountCoordinator();
  let commits = 0;
  const task = coordinator.schedule(
    'personal-agent',
    'user-1:room-1',
    async () => 'module',
    () => { commits += 1; },
    { isRelevant: () => false },
  );

  assert.equal((await task.promise).status, 'stale');
  assert.equal(commits, 0);
  assert.deepEqual(coordinator.inspect('personal-agent'), { mountedKey: null, pendingKey: null });
});

test('reuses a React root for one host and replaces it when the DOM host changes', () => {
  const calls = [];
  const roots = [];
  const makeHost = (name) => ({
    name,
    replaceChildren: () => calls.push(`clear:${name}`),
  });
  const rootFactory = (host) => {
    const root = {
      render: (node) => calls.push(`render:${host.name}:${node}`),
      unmount: () => calls.push(`unmount:${host.name}`),
    };
    roots.push(root);
    return root;
  };
  const managedRoot = createHostAwareRoot({
    rootFactory,
    onAttach: (host) => calls.push(`attach:${host.name}`),
    onDetach: (host) => calls.push(`detach:${host.name}`),
  });
  const firstHost = makeHost('first');
  const replacementHost = makeHost('replacement');

  assert.equal(managedRoot.render(firstHost, 'one'), true);
  assert.equal(managedRoot.render(firstHost, 'two'), true);
  assert.equal(managedRoot.render(replacementHost, 'three'), true);
  assert.equal(roots.length, 2);
  assert.deepEqual(calls, [
    'clear:first',
    'attach:first',
    'render:first:one',
    'render:first:two',
    'unmount:first',
    'detach:first',
    'clear:replacement',
    'attach:replacement',
    'render:replacement:three',
  ]);
});

test('host-aware roots detach listeners and mounted work when explicitly unmounted', () => {
  const calls = [];
  const host = { replaceChildren: () => calls.push('clear') };
  const managedRoot = createHostAwareRoot({
    rootFactory: () => ({
      render: () => calls.push('render'),
      unmount: () => calls.push('unmount'),
    }),
    onAttach: () => calls.push('attach'),
    onDetach: () => calls.push('detach'),
  });

  assert.equal(managedRoot.render(null, 'ignored'), false);
  managedRoot.render(host, 'content');
  managedRoot.unmount();
  managedRoot.unmount();
  assert.deepEqual(calls, ['clear', 'attach', 'render', 'unmount', 'detach']);
});
