import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  APPROVED_OLLAMA_ENDPOINT,
  DEFAULT_MODEL,
  TimelineVisionError,
  assertAllowedEndpoint,
  runTimelineVision,
  validateAnalysis,
} from './Analyze-ProjectTimelineVision.mjs';

const temporaryRoots = [];
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MODEL_DIGEST = 'a'.repeat(64);

function writeFixtureFile(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'timeline-vision-test-'));
  temporaryRoots.push(root);
  const memory = path.join(root, 'Minimalist-chat-vault', '90 Memory');
  const assets = path.join(memory, 'assets', 'project-timeline');
  mkdirSync(assets, { recursive: true });
  writeFixtureFile(root, 'Minimalist-chat-vault/90 Memory/Project Timeline.md', [
    '---',
    'title: Project Timeline',
    '---',
    '# Project Timeline',
    '',
    '- **2026-07-11** | Mobile room QA.',
    '',
    '  ![[assets/project-timeline/2026-07-11-room.png|420]]',
    '',
    '  *Actual mobile QA capture.*',
    '',
    '- **2026-07-12** | Direct call QA.',
    '',
    '  ![[assets/project-timeline/2026-07-12-call.png|420]]',
    '',
    '  *Actual direct-call QA capture.*',
    '',
  ].join('\n'));
  writeFixtureFile(root, 'Minimalist-chat-vault/90 Memory/assets/project-timeline/2026-07-11-room.png', PNG_BYTES);
  writeFixtureFile(root, 'Minimalist-chat-vault/90 Memory/assets/project-timeline/2026-07-12-call.png', PNG_BYTES);
  return {
    root,
    output: path.join(memory, 'Timeline Vision'),
  };
}

function validAnalysis(index = 1) {
  return {
    schema_version: 1,
    title: `Fixture screen ${index}`,
    summary: `A bounded fixture summary for screen ${index}.`,
    visible_text: [`Visible label ${index}`],
    ui_elements: [`Primary panel ${index}`],
    notable_details: [`Verified visual detail ${index}`],
    uncertainty: [],
    evidence_class: 'actual_qa_capture',
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeMockFetch({ vision = true, invalidChatAt = null } = {}) {
  const calls = [];
  let chatCount = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === `${APPROVED_OLLAMA_ENDPOINT}/api/tags`) {
      return jsonResponse({
        models: [{
          name: DEFAULT_MODEL,
          model: DEFAULT_MODEL,
          digest: MODEL_DIGEST,
          capabilities: vision ? ['completion', 'vision'] : ['completion'],
          details: { family: 'fixture', parameter_size: '1B', quantization_level: 'Q4' },
        }],
      });
    }
    if (url === `${APPROVED_OLLAMA_ENDPOINT}/api/show`) {
      const request = JSON.parse(options.body);
      assert.equal(request.model, DEFAULT_MODEL);
      return jsonResponse({
        capabilities: vision ? ['completion', 'vision'] : ['completion'],
        details: { family: 'fixture', parameter_size: '1B', quantization_level: 'Q4' },
      });
    }
    if (url === `${APPROVED_OLLAMA_ENDPOINT}/api/chat`) {
      chatCount += 1;
      const request = JSON.parse(options.body);
      assert.equal(request.model, DEFAULT_MODEL);
      assert.equal(request.stream, false);
      assert.equal(request.think, false);
      assert.equal(request.messages.length, 1);
      assert.equal(request.messages[0].images.length, 1);
      assert.ok(request.messages[0].images[0].length > 0);
      if (chatCount === invalidChatAt) {
        return jsonResponse({
          model: DEFAULT_MODEL,
          done: true,
          message: { role: 'assistant', content: '{invalid-json' },
        });
      }
      return jsonResponse({
        model: DEFAULT_MODEL,
        done: true,
        message: { role: 'assistant', content: JSON.stringify(validAnalysis(chatCount)) },
      });
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
  return {
    calls,
    fetchImpl,
    get chatCount() { return chatCount; },
  };
}

test.afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    const resolved = path.resolve(root);
    const expectedPrefix = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolved.startsWith(expectedPrefix), `refusing unsafe cleanup: ${resolved}`);
    rmSync(resolved, { recursive: true, force: true });
  }
});

test('writes validated sidecars and an index after all analyses succeed', async () => {
  const fixture = makeFixture();
  const mock = makeMockFetch();
  const report = await runTimelineVision({
    repoRoot: fixture.root,
    fetchImpl: mock.fetchImpl,
    now: () => new Date('2026-07-21T12:00:00.000Z'),
  });

  assert.equal(report.ok, true);
  assert.equal(report.images_discovered, 2);
  assert.equal(report.analyzed_images, 2);
  assert.equal(report.written_files.length, 3);
  assert.equal(mock.chatCount, 2);
  const roomNote = path.join(fixture.output, '2026-07-11-room.vision.md');
  const callNote = path.join(fixture.output, '2026-07-12-call.vision.md');
  const index = path.join(fixture.output, 'Index.md');
  for (const target of [roomNote, callNote, index]) assert.equal(existsSync(target), true);
  const noteText = readFileSync(roomNote, 'utf8');
  assert.match(noteText, /asset_sha256:/);
  assert.match(noteText, /Model digest:/);
  assert.match(noteText, /Vision capability verified/);
  assert.match(noteText, /Generated visual description/);
  assert.match(readFileSync(index, 'utf8'), /Project Timeline Vision Index/);
});

test('reuses hash/model/context cache and is byte-idempotent', async () => {
  const fixture = makeFixture();
  const mock = makeMockFetch();
  await runTimelineVision({
    repoRoot: fixture.root,
    fetchImpl: mock.fetchImpl,
    now: () => new Date('2026-07-21T12:00:00.000Z'),
  });
  const targets = [
    path.join(fixture.output, '2026-07-11-room.vision.md'),
    path.join(fixture.output, '2026-07-12-call.vision.md'),
    path.join(fixture.output, 'Index.md'),
  ];
  const before = targets.map((target) => readFileSync(target, 'utf8'));
  const report = await runTimelineVision({
    repoRoot: fixture.root,
    fetchImpl: mock.fetchImpl,
    now: () => new Date('2026-07-22T12:00:00.000Z'),
  });
  const after = targets.map((target) => readFileSync(target, 'utf8'));

  assert.equal(report.cached_images, 2);
  assert.equal(report.pending_images, 0);
  assert.equal(report.analyzed_images, 0);
  assert.deepEqual(report.written_files, []);
  assert.equal(mock.chatCount, 2, 'second run must not call /api/chat');
  assert.deepEqual(after, before);
});

test('removes only owned stale sidecars when a timeline image is no longer embedded', async () => {
  const fixture = makeFixture();
  const mock = makeMockFetch();
  await runTimelineVision({
    repoRoot: fixture.root,
    fetchImpl: mock.fetchImpl,
    now: () => new Date('2026-07-21T12:00:00.000Z'),
  });
  const timelinePath = path.join(fixture.root, 'Minimalist-chat-vault', '90 Memory', 'Project Timeline.md');
  const timeline = readFileSync(timelinePath, 'utf8').replace(/\n- \*\*2026-07-12\*\*[\s\S]*$/, '\n');
  writeFileSync(timelinePath, timeline, 'utf8');

  const report = await runTimelineVision({
    repoRoot: fixture.root,
    fetchImpl: mock.fetchImpl,
    now: () => new Date('2026-07-22T12:00:00.000Z'),
  });
  assert.equal(report.images_discovered, 1);
  assert.equal(report.cached_images, 1);
  assert.equal(report.analyzed_images, 0);
  assert.equal(report.stale_sidecars, 1);
  assert.equal(report.deleted_files.length, 1);
  assert.equal(existsSync(path.join(fixture.output, '2026-07-12-call.vision.md')), false);
  assert.match(readFileSync(path.join(fixture.output, 'Index.md'), 'utf8'), /- Images: 1/);
  assert.equal(mock.chatCount, 2, 'stale reconciliation must not re-run cached vision inference');
});

test('refuses to delete an unowned stale vision-named note', async () => {
  const fixture = makeFixture();
  mkdirSync(fixture.output);
  const unowned = path.join(fixture.output, '2025-01-01-personal.vision.md');
  writeFileSync(unowned, '# Personal note\n', 'utf8');
  const mock = makeMockFetch();
  await assert.rejects(
    runTimelineVision({ repoRoot: fixture.root, fetchImpl: mock.fetchImpl }),
    (error) => error instanceof TimelineVisionError && error.code === 'unowned_stale_output',
  );
  assert.equal(readFileSync(unowned, 'utf8'), '# Personal note\n');
  assert.equal(mock.calls.length, 0);
});

test('fails closed when the installed model does not declare vision', async () => {
  const fixture = makeFixture();
  mkdirSync(fixture.output);
  const sentinel = path.join(fixture.output, 'Index.md');
  writeFileSync(sentinel, 'existing-index\n', 'utf8');
  const mock = makeMockFetch({ vision: false });

  await assert.rejects(
    runTimelineVision({ repoRoot: fixture.root, fetchImpl: mock.fetchImpl }),
    (error) => error instanceof TimelineVisionError && error.code === 'model_lacks_vision',
  );
  assert.equal(readFileSync(sentinel, 'utf8'), 'existing-index\n');
  assert.equal(mock.chatCount, 0);
  assert.deepEqual([...new Set(mock.calls.map((call) => new URL(call.url).pathname))], ['/api/tags', '/api/show']);
});

test('fails closed on one invalid response after an earlier valid response', async () => {
  const fixture = makeFixture();
  mkdirSync(fixture.output);
  const sentinel = path.join(fixture.output, 'Index.md');
  writeFileSync(sentinel, 'existing-index\n', 'utf8');
  const mock = makeMockFetch({ invalidChatAt: 2 });

  await assert.rejects(
    runTimelineVision({ repoRoot: fixture.root, fetchImpl: mock.fetchImpl }),
    (error) => error instanceof TimelineVisionError && error.code === 'invalid_analysis_json',
  );
  assert.equal(readFileSync(sentinel, 'utf8'), 'existing-index\n');
  assert.equal(existsSync(path.join(fixture.output, '2026-07-11-room.vision.md')), false);
  assert.equal(existsSync(path.join(fixture.output, '2026-07-12-call.vision.md')), false);
  assert.equal(mock.chatCount, 2);
});

test('dry-run verifies and previews without inference or filesystem writes', async () => {
  const fixture = makeFixture();
  const mock = makeMockFetch();
  const report = await runTimelineVision({
    repoRoot: fixture.root,
    fetchImpl: mock.fetchImpl,
    dryRun: true,
  });

  assert.equal(report.mode, 'dry-run');
  assert.equal(report.pending_images, 2);
  assert.equal(report.analyzed_images, 0);
  assert.deepEqual(report.written_files, []);
  assert.equal(mock.chatCount, 0);
  assert.equal(existsSync(fixture.output), false);
});

test('endpoint guard accepts only tray Ollama and rejects protected port 11435', async () => {
  assert.equal(assertAllowedEndpoint(APPROVED_OLLAMA_ENDPOINT), APPROVED_OLLAMA_ENDPOINT);
  for (const rejected of [
    'http://127.0.0.1:11435',
    'http://localhost:11434',
    'https://127.0.0.1:11434',
    'http://127.0.0.1:11434/api',
    'http://user:pass@127.0.0.1:11434',
  ]) {
    assert.throws(
      () => assertAllowedEndpoint(rejected),
      (error) => error instanceof TimelineVisionError && error.code === 'endpoint_rejected',
      rejected,
    );
  }

  let fetched = false;
  await assert.rejects(
    runTimelineVision({
      endpoint: 'http://127.0.0.1:11435',
      fetchImpl: async () => { fetched = true; },
    }),
    (error) => error instanceof TimelineVisionError && error.code === 'endpoint_rejected',
  );
  assert.equal(fetched, false);
});

test('normalizes duplicate model observations deterministically', () => {
  const input = validAnalysis(1);
  input.visible_text = ['Rooms', 'rooms', 'Settings'];
  input.notable_details = ['Yellow accent', 'Yellow accent'];
  const analysis = validateAnalysis(input);
  assert.deepEqual(analysis.visible_text, ['Rooms', 'Settings']);
  assert.deepEqual(analysis.notable_details, ['Yellow accent']);
});
