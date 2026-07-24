import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  APPROVED_GBRAIN_OLLAMA_BASE_URL,
  CITED_TOOL_NAME,
  JsonLineBuffer,
  assertPinnedGBrainConfig,
  defaultGBrainChildCommand,
  pinnedGBrainEnvironment,
  transformSearchResponse,
} from './gbrain-authority-mcp-proxy.mjs';
import { defaultGBrainSourcesRoot } from './gbrain-source-provenance.mjs';

const PROXY_PATH = fileURLToPath(new URL('./gbrain-authority-mcp-proxy.mjs', import.meta.url));
const FAKE_CHILD_PATH = fileURLToPath(new URL('./gbrain-authority-mcp-proxy.fake-child.mjs', import.meta.url));

function verifiedTestCatalog(slugs, status = 'ready') {
  const values = new Set(slugs);
  return {
    status,
    slugs: values,
    verify_slug: (slug) => status === 'ready' && values.has(slug),
  };
}

test('proxy pins the installed GBrain child executable when available', () => {
  const root = mkdtempSync(join(tmpdir(), 'gbrain-child-command-'));
  try {
    const executableName = process.platform === 'win32' ? 'gbrain.exe' : 'gbrain';
    const executable = join(root, '.bun', 'bin', executableName);
    mkdirSync(join(root, '.bun', 'bin'), { recursive: true });
    writeFileSync(executable, 'test');
    assert.equal(defaultGBrainChildCommand({ USERPROFILE: root }), executable);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

class ProtocolClient {
  constructor(processHandle) {
    this.process = processHandle;
    this.buffer = new JsonLineBuffer();
    this.pending = new Map();
    this.stderr = '';
    processHandle.stdout.on('data', (chunk) => {
      for (const line of this.buffer.append(chunk)) {
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          for (const entry of this.pending.values()) entry.reject(new Error(`non-JSON stdout: ${line}`, { cause: error }));
          this.pending.clear();
          continue;
        }
        const entry = this.pending.get(String(message.id));
        if (!entry) continue;
        clearTimeout(entry.timeout);
        this.pending.delete(String(message.id));
        entry.resolve(message);
      }
    });
    processHandle.stderr.on('data', (chunk) => { this.stderr += chunk.toString('utf8'); });
  }

  request(message, timeoutMs = 5000) {
    return new Promise((resolvePromise, reject) => {
      const key = String(message.id);
      const timeout = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`protocol request ${key} timed out; stderr=${this.stderr}`));
      }, timeoutMs);
      this.pending.set(key, { resolve: resolvePromise, reject, timeout });
      this.process.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async close() {
    if (this.process.exitCode !== null) return;
    this.process.stdin.end();
    await new Promise((resolvePromise) => {
      const timeout = setTimeout(() => {
        this.process.kill();
        resolvePromise();
      }, 2000);
      this.process.once('exit', () => {
        clearTimeout(timeout);
        resolvePromise();
      });
    });
  }
}

function startProxy() {
  const root = mkdtempSync(join(tmpdir(), 'gbrain-authority-proxy-'));
  const authorityRoot = join(root, 'authority');
  const sourcesRoot = join(root, 'sources');
  const gbrainHome = join(root, 'gbrain-home-parent');
  const gbrainDataDirectory = join(gbrainHome, '.gbrain');
  const mirrorRoot = join(sourcesRoot, 'default');
  mkdirSync(authorityRoot, { recursive: true });
  mkdirSync(join(mirrorRoot, '.gbrain-meta'), { recursive: true });
  mkdirSync(gbrainDataDirectory, { recursive: true });
  writeFileSync(join(gbrainDataDirectory, 'config.json'), JSON.stringify({
    provider_base_urls: { ollama: APPROVED_GBRAIN_OLLAMA_BASE_URL },
  }));
  const documents = {
    'Legacy Plan.md': `---\ntitle: Legacy Plan\nstatus: archived\n---\n# Old\n`,
    'Current Plan.md': `---\ntitle: Current Project Plan\nstatus: current\ncanonical: true\n---\n# Current\n`,
    'Alternate Plan.md': '# Alternate Plan\n',
    'Unrelated.md': '# Cooking Notes\n',
  };
  for (const [name, content] of Object.entries(documents)) {
    writeFileSync(join(authorityRoot, name), content);
    writeFileSync(join(mirrorRoot, name), content);
  }
  const fileHashes = Object.fromEntries(Object.entries(documents).map(([name, content]) => [
    name,
    createHash('sha256').update(content).digest('hex'),
  ]));
  writeFileSync(join(mirrorRoot, '.gbrain-meta', 'manifest.json'), JSON.stringify({
    schema_version: 1,
    mirror_kind: 'minimalist-chat-vault',
    source_root: authorityRoot,
    files: Object.keys(documents),
    file_count: Object.keys(documents).length,
    total_bytes: Object.values(documents).reduce((sum, content) => sum + Buffer.byteLength(content), 0),
    file_sha256: fileHashes,
  }));
  const child = spawn(process.execPath, [
    PROXY_PATH,
    '--child-command', process.execPath,
    '--child-args-json', JSON.stringify([FAKE_CHILD_PATH]),
    '--authority-root', `default=${authorityRoot}`,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      GBRAIN_AUTHORITY_ROOT: '',
      GBRAIN_HOME: gbrainHome,
      GBRAIN_SOURCES_ROOT: sourcesRoot,
    },
  });
  return { authorityRoot, root, client: new ProtocolClient(child) };
}

async function withProxy(callback) {
  const fixture = startProxy();
  try {
    await callback(fixture.client, fixture.authorityRoot);
  } finally {
    await fixture.client.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

test('line buffer handles fragmented and batched JSON-RPC frames', () => {
  const buffer = new JsonLineBuffer();
  assert.deepEqual(buffer.append('{"one":'), []);
  assert.deepEqual(buffer.append('1}\r\n{"two":2}\npartial'), ['{"one":1}', '{"two":2}']);
  assert.equal(buffer.flush(), 'partial');
});

test('proxy pins inherited Ollama overrides to the tray endpoint', () => {
  const environment = pinnedGBrainEnvironment({
    OLLAMA_BASE_URL: 'http://127.0.0.1:11435/v1',
    SENTINEL: 'kept',
  });
  assert.equal(environment.OLLAMA_BASE_URL, APPROVED_GBRAIN_OLLAMA_BASE_URL);
  assert.equal(environment.SENTINEL, 'kept');
});

test('proxy config and provenance paths match GBrain GBRAIN_HOME semantics', () => {
  const root = mkdtempSync(join(tmpdir(), 'gbrain-home-semantics-'));
  try {
    const dataDirectory = join(root, '.gbrain');
    mkdirSync(dataDirectory, { recursive: true });
    writeFileSync(join(dataDirectory, 'config.json'), JSON.stringify({
      provider_base_urls: { ollama: APPROVED_GBRAIN_OLLAMA_BASE_URL },
    }));
    writeFileSync(join(root, 'decoy.json'), JSON.stringify({
      provider_base_urls: { ollama: 'http://127.0.0.1:11435/v1' },
    }));
    const environment = { GBRAIN_HOME: root, GBRAIN_CONFIG_PATH: join(root, 'decoy.json') };
    assert.equal(assertPinnedGBrainConfig(environment), join(dataDirectory, 'config.json'));
    assert.equal(defaultGBrainSourcesRoot(environment), join(dataDirectory, 'sources'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('malformed candidate metadata fails closed once a native candidate list is recognized', () => {
  const message = {
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [{
        type: 'text',
        text: JSON.stringify([{ slug: 'bad', title: 'Bad', score: 0.5, aliases: 'not-an-array' }]),
      }],
    },
  };
  const transformed = transformSearchResponse(message, {
    toolName: 'query', query: 'bad', sourceId: 'default',
  }, {
    roots: new Map(),
    provenanceCatalogs: new Map([['default', verifiedTestCatalog(['bad'])]]),
  });
  assert.equal(transformed.transformed, true);
  assert.deepEqual(transformed.candidates, []);
  assert.deepEqual(JSON.parse(transformed.message.result.content[0].text), []);
  assert.equal(
    transformed.message.result._meta.project_authority_ranking.fail_closed_reason,
    'candidate_validation_failed',
  );
});

test('one malformed recognized block clears every candidate block and cited-call state', async () => {
  await withProxy(async (client) => {
    const queryResponse = await client.request({
      jsonrpc: '2.0', id: 'mixed-query', method: 'tools/call',
      params: { name: 'query', arguments: { query: 'mixed candidate blocks', source_id: 'default' } },
    });
    assert.equal(queryResponse.result.content.length, 2);
    assert.deepEqual(queryResponse.result.content.map((block) => JSON.parse(block.text)), [[], []]);
    assert.equal(
      queryResponse.result._meta.project_authority_ranking.fail_closed_reason,
      'candidate_validation_failed',
    );

    const citedResponse = await client.request({
      jsonrpc: '2.0', id: 'mixed-cited', method: 'tools/call',
      params: { name: CITED_TOOL_NAME, arguments: { query: 'mixed candidate blocks' } },
    });
    const cited = JSON.parse(citedResponse.result.content[0].text);
    assert.deepEqual(cited.citations, []);
    assert.equal(cited.answer.abstained, true);
    assert.equal(cited.evidence_strength, 'insufficient');
  });
});

test('trusted provenance drops native cross-source leakage instead of relabeling it', () => {
  const message = {
    jsonrpc: '2.0',
    id: 2,
    result: {
      content: [{
        type: 'text',
        text: JSON.stringify([
          { slug: 'current-plan', title: 'Current Plan', score: 0.8 },
          { slug: 'leaked-code', title: 'Leaked Code', score: 0.99, source_id: 'default' },
        ]),
      }],
    },
  };
  const transformed = transformSearchResponse(message, {
    toolName: 'query', query: 'current plan', sourceId: 'default',
  }, {
    roots: new Map(),
    provenanceCatalogs: new Map([
      ['default', verifiedTestCatalog(['current-plan'])],
      ['minimalist-chat-code', verifiedTestCatalog(['leaked-code'])],
    ]),
  });
  assert.equal(transformed.transformed, true);
  assert.deepEqual(transformed.candidates.map((candidate) => candidate.slug), ['current-plan']);
  assert.equal(transformed.candidates[0].source_id, 'default');
  assert.equal(transformed.candidates[0].source_provenance.status, 'verified');
});

test('unresolved, ambiguous, and unavailable provenance all fail closed', () => {
  const makeMessage = (slug) => ({
    result: { content: [{ type: 'text', text: JSON.stringify([{ slug, title: slug, score: 1 }]) }] },
  });
  for (const [slug, catalogs] of [
    ['missing', new Map([['default', verifiedTestCatalog([])]])],
    ['shared', new Map([
      ['default', verifiedTestCatalog(['shared'])],
      ['minimalist-chat-code', verifiedTestCatalog(['shared'])],
    ])],
    ['unavailable', new Map([['default', verifiedTestCatalog([], 'unavailable')]])],
  ]) {
    const transformed = transformSearchResponse(makeMessage(slug), {
      toolName: 'query', query: slug, sourceId: 'default',
    }, { roots: new Map(), provenanceCatalogs: catalogs });
    assert.equal(transformed.transformed, true);
    assert.deepEqual(transformed.candidates, [], slug);
    assert.deepEqual(JSON.parse(transformed.message.result.content[0].text), [], slug);
  }
});

test('proxy augments tools/list and preserves unsupported tool responses', async () => {
  await withProxy(async (client) => {
    const listed = await client.request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['query', 'ping', CITED_TOOL_NAME]);

    const ping = await client.request({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'ping', arguments: { marker: 'unchanged' } },
    });
    assert.deepEqual(JSON.parse(ping.result.content[0].text), {
      untouched: true,
      args: { marker: 'unchanged' },
    });
    assert.equal(ping.result._meta, undefined);
  });
});

test('proxy authority-reranks native query results without changing source scope', async () => {
  await withProxy(async (client) => {
    const response = await client.request({
      jsonrpc: '2.0', id: 'rank', method: 'tools/call',
      params: {
        name: 'query',
        arguments: { query: 'What is the current project plan?', source_id: 'default', limit: 10 },
      },
    });
    const results = JSON.parse(response.result.content[0].text);
    assert.equal(results[0].slug, 'current-plan');
    assert.equal(results[0].original_rank, 2);
    assert.equal(results[0].source_id, 'default');
    assert.ok(results.every((result) => result.source_id === 'default'));
    assert.equal(results.length, 2);
    assert.equal(new Set(results.map((result) => `${result.source_id}::${result.slug}`)).size, results.length);
    assert.deepEqual(results.map((result) => result.authority_rank), [1, 2]);
    assert.equal(response.result._meta.project_authority_ranking.mode, 'deterministic-authority-v1');
  });
});

test('proxy passes an unparseable native search response through byte-for-byte', async () => {
  await withProxy(async (client) => {
    const response = await client.request({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'query', arguments: { query: 'malformed response please' } },
    });
    assert.equal(response.result.content[0].text, 'not-json-from-child');
    assert.equal(response.result._meta, undefined);
  });
});

test('citation-aware MCP tool returns deterministic paths and never invokes synthesis by default', async () => {
  await withProxy(async (client, authorityRoot) => {
    const response = await client.request({
      jsonrpc: '2.0', id: 'cited', method: 'tools/call',
      params: {
        name: CITED_TOOL_NAME,
        arguments: { query: 'What is the current project plan?', limit: 10, max_citations: 2 },
      },
    });
    const report = JSON.parse(response.result.content[0].text);
    assert.equal(report.citations[0].slug, 'current-plan');
    assert.equal(report.citations[0].path, join(authorityRoot, 'Current Plan.md'));
    assert.equal(new Set(report.citations.map((citation) => `${citation.source_id}::${citation.slug}`)).size, report.citations.length);
    assert.equal(report.answer.abstained, false);
    assert.equal(report.answer.mode, 'deterministic-evidence');
    assert.equal(report.synthesis.status, 'not_requested');
  });
});

test('citation-aware MCP tool exposes conflicts and explicit weak-evidence abstention', async () => {
  await withProxy(async (client) => {
    const conflictResponse = await client.request({
      jsonrpc: '2.0', id: 'conflict', method: 'tools/call',
      params: { name: CITED_TOOL_NAME, arguments: { query: 'conflict: what is the launch date?' } },
    });
    const conflict = JSON.parse(conflictResponse.result.content[0].text);
    assert.equal(conflict.conflicts[0].reason, 'different_dates');
    assert.equal(conflict.answer.abstained, true);

    const weakResponse = await client.request({
      jsonrpc: '2.0', id: 'weak', method: 'tools/call',
      params: { name: CITED_TOOL_NAME, arguments: { query: 'weak database engine evidence' } },
    });
    const weak = JSON.parse(weakResponse.result.content[0].text);
    assert.equal(weak.evidence_strength, 'low');
    assert.equal(weak.answer.abstained, true);
  });
});
