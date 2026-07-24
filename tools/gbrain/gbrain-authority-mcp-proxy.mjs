#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadMarkdownAuthorityCatalog,
  loadCodeAuthorityCatalog,
  mergeAuthorityCatalogs,
  rankByAuthority,
} from './gbrain-authority-ranker.mjs';
import {
  buildCitationAnswer,
  maybeSynthesizeWithOllama,
} from './gbrain-citation-answer.mjs';
import {
  SOURCE_PROVENANCE_METHOD,
  defaultGBrainSourcesRoot,
  loadSourceProvenanceCatalogs,
  resolveResultSourceProvenance,
} from './gbrain-source-provenance.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..', '..');
const SUPPORTED_SEARCH_TOOLS = new Set(['query', 'search']);
export const APPROVED_GBRAIN_OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';

export const CITED_TOOL_NAME = 'gbrain_cited_answer';

export function defaultGBrainChildCommand(environment = process.env) {
  const userHome = environment.USERPROFILE || environment.HOME || homedir();
  const executableName = process.platform === 'win32' ? 'gbrain.exe' : 'gbrain';
  const installedCommand = join(userHome, '.bun', 'bin', executableName);
  return existsSync(installedCommand) ? installedCommand : 'gbrain';
}

export const CITED_TOOL_DEFINITION = {
  name: CITED_TOOL_NAME,
  description: 'Answer from authority-ranked local GBrain evidence with file citations, evidence strength, conflict detection, and explicit abstention. Deterministic by default; optional synthesis uses only the local Ollama tray endpoint.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Question to answer from local GBrain evidence.' },
      source_id: { type: 'string', description: 'Optional GBrain source scope; forwarded unchanged to the native query tool.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      max_citations: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
      synthesize: { type: 'boolean', default: false, description: 'When true, synthesize from accepted evidence through http://127.0.0.1:11434 only.' },
      ollama_model: { type: 'string', description: 'Optional installed Ollama chat model used only when synthesize=true.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

export class JsonLineBuffer {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  append(chunk) {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = this.buffer.length === 0 ? next : Buffer.concat([this.buffer, next]);
    const lines = [];
    let newlineIndex = this.buffer.indexOf(0x0a);
    while (newlineIndex >= 0) {
      let line = this.buffer.subarray(0, newlineIndex);
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      lines.push(line.toString('utf8'));
      this.buffer = this.buffer.subarray(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf(0x0a);
    }
    return lines;
  }

  flush() {
    if (this.buffer.length === 0) return null;
    const line = this.buffer.toString('utf8');
    this.buffer = Buffer.alloc(0);
    return line;
  }
}

function hasId(message) {
  return message && Object.prototype.hasOwnProperty.call(message, 'id');
}

function requestKey(id) {
  return `${typeof id}:${JSON.stringify(id)}`;
}

function safeJsonParse(value) {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false, value: null };
  }
}

function isCandidate(value) {
  return value
    && typeof value === 'object'
    && typeof value.slug === 'string'
    && value.slug.length > 0
    && (
      Object.prototype.hasOwnProperty.call(value, 'score')
      || Object.prototype.hasOwnProperty.call(value, 'chunk_text')
      || Object.prototype.hasOwnProperty.call(value, 'snippet')
      || Object.prototype.hasOwnProperty.call(value, 'title')
    );
}

export function candidateContainer(payload) {
  if (Array.isArray(payload) && payload.every(isCandidate)) {
    return {
      candidates: payload,
      replace: (next) => next,
    };
  }
  if (!payload || typeof payload !== 'object') return null;
  for (const key of ['results', 'items', 'matches']) {
    if (Array.isArray(payload[key]) && payload[key].every(isCandidate)) {
      return {
        candidates: payload[key],
        replace: (next) => ({ ...payload, [key]: next }),
      };
    }
  }
  return null;
}

function rootMapFromEnvironment(environment = process.env) {
  const roots = new Map();
  const defaultVault = resolve(REPOSITORY_ROOT, 'Minimalist-chat-vault');
  if (existsSync(defaultVault)) roots.set('default', defaultVault);
  if (environment.GBRAIN_AUTHORITY_ROOT) roots.set('default', resolve(environment.GBRAIN_AUTHORITY_ROOT));
  if (environment.GBRAIN_AUTHORITY_ROOTS_JSON) {
    const parsed = safeJsonParse(environment.GBRAIN_AUTHORITY_ROOTS_JSON);
    if (parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)) {
      for (const [sourceId, root] of Object.entries(parsed.value)) {
        if (typeof root === 'string' && root.trim()) roots.set(sourceId, resolve(root));
      }
    }
  }
  return roots;
}

export function pinnedGBrainEnvironment(environment = process.env) {
  return {
    ...environment,
    OLLAMA_BASE_URL: APPROVED_GBRAIN_OLLAMA_BASE_URL,
  };
}

export function assertPinnedGBrainConfig(environment = process.env) {
  // Match GBrain's own configDir() semantics exactly: GBRAIN_HOME overrides the
  // parent directory, while the application data always lives in `.gbrain`.
  // GBrain does not honor a separate config-path override, so neither may this
  // guard; validating a different file would leave the child process unpinned.
  const configPath = environment.GBRAIN_HOME
    ? join(resolve(environment.GBRAIN_HOME), '.gbrain', 'config.json')
    : join(homedir(), '.gbrain', 'config.json');
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(`GBrain config is missing or unreadable: ${configPath}`);
  }
  if (config?.provider_base_urls?.ollama !== APPROVED_GBRAIN_OLLAMA_BASE_URL) {
    throw new Error(`GBrain Ollama base URL must be pinned to ${APPROVED_GBRAIN_OLLAMA_BASE_URL}.`);
  }
  return configPath;
}

export function loadAuthorityCatalogs(roots, sourceIds = null) {
  const wanted = sourceIds ? new Set(sourceIds) : null;
  const catalogs = [];
  for (const [sourceId, root] of roots) {
    if (wanted && !wanted.has(sourceId)) continue;
    try {
      catalogs.push(loadMarkdownAuthorityCatalog({ sourceId, root }));
    } catch {
      // Catalogs are advisory. A missing/unreadable catalog must never corrupt MCP traffic.
    }
  }
  if (!wanted || wanted.has('minimalist-chat-code')) {
    const manifestPath = process.env.GBRAIN_CODE_AUTHORITY_MANIFEST
      || join(homedir(), '.gbrain', 'sources', 'minimalist-chat-code', '.gbrain-meta', 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        catalogs.push(loadCodeAuthorityCatalog({
          sourceId: 'minimalist-chat-code',
          manifestPath,
        }));
      } catch {
        // The code mirror is optional; malformed metadata must leave native results untouched.
      }
    }
  }
  return mergeAuthorityCatalogs(...catalogs);
}

export function loadRuntimeSourceProvenanceCatalogs(
  roots,
  environment = process.env,
) {
  const sources = Object.fromEntries([...roots].map(([sourceId, root]) => [sourceId, {
    kind: 'markdown',
    root,
  }]));
  sources['minimalist-chat-code'] = {
    kind: 'code',
    root: REPOSITORY_ROOT,
  };
  return loadSourceProvenanceCatalogs(
    { sources },
    join(SCRIPT_DIRECTORY, 'runtime-source-provenance.json'),
    {
      sourcesRoot: environment.GBRAIN_SOURCES_ROOT
        ? resolve(environment.GBRAIN_SOURCES_ROOT)
        : defaultGBrainSourcesRoot(environment),
    },
  );
}

export function transformSearchResponse(message, request, {
  roots = rootMapFromEnvironment(),
  provenanceCatalogs = loadRuntimeSourceProvenanceCatalogs(roots),
} = {}) {
  if (!message?.result || message.result.isError || !SUPPORTED_SEARCH_TOOLS.has(request?.toolName)) {
    return { message, transformed: false, candidates: [], catalog: new Map() };
  }
  if (!Array.isArray(message.result.content) || typeof request?.query !== 'string' || !request.query.trim()) {
    return { message, transformed: false, candidates: [], catalog: new Map() };
  }

  const fallbackSourceId = request.sourceId || 'default';
  let transformed = false;
  let firstCandidates = [];
  let firstCatalog = new Map();
  let failClosedReason = null;
  const closedRecognizedBlocks = new Map();
  let content = message.result.content.map((block, index) => {
    if (block?.type !== 'text' || typeof block.text !== 'string') return block;
    const parsed = safeJsonParse(block.text);
    if (!parsed.ok) return block;
    const container = candidateContainer(parsed.value);
    if (!container) return block;
    const closedBlock = {
      ...block,
      text: JSON.stringify(container.replace([]), null, 2),
    };
    closedRecognizedBlocks.set(index, closedBlock);

    let verified;
    let catalog;
    let ranked;
    try {
      verified = resolveResultSourceProvenance(container.candidates, provenanceCatalogs, {
        requestedSourceId: fallbackSourceId,
      }).filter((candidate) => (
        candidate.source_provenance.status === 'verified'
        && candidate.source_id === fallbackSourceId
      ));
      const sourceIds = verified.map((candidate) => candidate.source_id);
      catalog = loadAuthorityCatalogs(roots, sourceIds);
      ranked = rankByAuthority(request.query, verified, { catalog });
    } catch {
      transformed = true;
      failClosedReason = 'candidate_validation_failed';
      return closedBlock;
    }
    if (firstCandidates.length === 0) {
      firstCandidates = ranked;
      firstCatalog = catalog;
    }
    transformed = true;
    return {
      ...block,
      text: JSON.stringify(container.replace(ranked), null, 2),
    };
  });

  if (!transformed) return { message, transformed: false, candidates: [], catalog: new Map() };
  if (failClosedReason) {
    // A response is one evidence unit. Never let an earlier valid block survive
    // beside a malformed recognized block, and never retain partial candidates
    // for the citation-aware call path.
    content = content.map((block, index) => closedRecognizedBlocks.get(index) ?? block);
    firstCandidates = [];
    firstCatalog = new Map();
  }
  return {
    message: {
      ...message,
      result: {
        ...message.result,
        content,
        _meta: {
          ...(message.result._meta ?? {}),
          project_authority_ranking: {
            mode: 'deterministic-authority-v1',
            tools: [...SUPPORTED_SEARCH_TOOLS],
            source_provenance: SOURCE_PROVENANCE_METHOD,
            requested_source_id: fallbackSourceId,
            fail_closed_reason: failClosedReason,
          },
        },
      },
    },
    transformed: true,
    candidates: firstCandidates,
    catalog: firstCatalog,
  };
}

export function augmentToolsList(message) {
  const tools = message?.result?.tools;
  if (!Array.isArray(tools) || tools.some((tool) => tool?.name === CITED_TOOL_NAME)) return message;
  return {
    ...message,
    result: { ...message.result, tools: [...tools, CITED_TOOL_DEFINITION] },
  };
}

function toolErrorResponse(id, code, message) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: code, message }, null, 2) }],
    },
  };
}

function validateCitedArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object.';
  if (typeof args.query !== 'string' || !args.query.trim()) return 'query is required.';
  const limit = args.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return 'limit must be an integer from 1 to 50.';
  const maxCitations = args.max_citations ?? 5;
  if (!Number.isInteger(maxCitations) || maxCitations < 1 || maxCitations > 20) {
    return 'max_citations must be an integer from 1 to 20.';
  }
  if (args.source_id !== undefined && (typeof args.source_id !== 'string' || !args.source_id.trim())) {
    return 'source_id must be a non-empty string.';
  }
  if (args.synthesize !== undefined && typeof args.synthesize !== 'boolean') return 'synthesize must be a boolean.';
  if (args.ollama_model !== undefined && (typeof args.ollama_model !== 'string' || !args.ollama_model.trim())) {
    return 'ollama_model must be a non-empty string.';
  }
  return null;
}

function writeLine(stream, value) {
  if (!stream || stream.destroyed || !stream.writable) return false;
  return stream.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
}

export class GBrainAuthorityProxy {
  constructor({
    childCommand,
    childArgs = ['serve'],
    roots = rootMapFromEnvironment(),
    environment = process.env,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    spawnImpl = spawn,
    provenanceCatalogs = null,
  } = {}) {
    this.childCommand = childCommand || defaultGBrainChildCommand(environment);
    this.childArgs = childArgs;
    this.roots = roots;
    this.environment = pinnedGBrainEnvironment(environment);
    this.stdin = stdin;
    this.stdout = stdout;
    this.stderr = stderr;
    this.spawnImpl = spawnImpl;
    this.provenanceCatalogs = provenanceCatalogs
      ?? loadRuntimeSourceProvenanceCatalogs(roots, environment);
    this.pending = new Map();
    this.internalPending = new Map();
    this.internalSequence = 0;
    this.internalPrefix = `__project_authority_proxy_${randomUUID()}`;
    this.clientBuffer = new JsonLineBuffer();
    this.childBuffer = new JsonLineBuffer();
    this.child = null;
  }

  start() {
    assertPinnedGBrainConfig(this.environment);
    this.child = this.spawnImpl(this.childCommand, this.childArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: this.environment,
    });

    this.stdin.on('data', (chunk) => {
      for (const line of this.clientBuffer.append(chunk)) this.handleClientLine(line);
    });
    this.stdin.on('end', () => {
      const remainder = this.clientBuffer.flush();
      if (remainder) this.handleClientLine(remainder);
      this.child?.stdin?.end();
    });
    this.child.stdout.on('data', (chunk) => {
      for (const line of this.childBuffer.append(chunk)) void this.handleChildLine(line);
    });
    this.child.stdout.on('end', () => {
      const remainder = this.childBuffer.flush();
      if (remainder) void this.handleChildLine(remainder);
    });
    this.child.stderr.on('data', (chunk) => {
      if (this.stderr?.writable) this.stderr.write(chunk);
    });
    this.child.on('error', (error) => {
      if (this.stderr?.writable) this.stderr.write(`[gbrain-authority-proxy] child error: ${error.message}\n`);
      process.exitCode = 1;
      if (this.stdin === process.stdin) this.stdin.pause();
    });
    this.child.on('exit', (code, signal) => {
      if (signal && this.stderr?.writable) {
        this.stderr.write(`[gbrain-authority-proxy] child exited on ${signal}\n`);
      }
      if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = code ?? (signal ? 1 : 0);
      if (this.stdin === process.stdin) this.stdin.pause();
    });
    return this.child;
  }

  handleClientLine(line) {
    const parsed = safeJsonParse(line);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
      writeLine(this.child?.stdin, line);
      return;
    }
    const message = parsed.value;
    if (message.method === 'tools/call' && message.params?.name === CITED_TOOL_NAME && hasId(message)) {
      this.startCitedCall(message);
      return;
    }
    if (hasId(message) && typeof message.method === 'string') {
      const args = message.params?.arguments ?? {};
      this.pending.set(requestKey(message.id), {
        method: message.method,
        toolName: message.method === 'tools/call' ? message.params?.name : null,
        arguments: args,
        query: typeof args?.query === 'string' ? args.query : null,
        sourceId: typeof args?.source_id === 'string' ? args.source_id : (this.environment.GBRAIN_SOURCE || 'default'),
      });
    }
    writeLine(this.child?.stdin, message);
  }

  startCitedCall(message) {
    const args = message.params?.arguments ?? {};
    const validationError = validateCitedArguments(args);
    if (validationError) {
      writeLine(this.stdout, toolErrorResponse(message.id, 'invalid_params', validationError));
      return;
    }
    const internalId = `${this.internalPrefix}_${++this.internalSequence}`;
    this.internalPending.set(requestKey(internalId), {
      clientId: message.id,
      arguments: args,
      query: args.query,
      sourceId: args.source_id || this.environment.GBRAIN_SOURCE || 'default',
    });
    const queryArguments = {
      query: args.query,
      limit: args.limit ?? 10,
      expand: false,
      autocut: false,
      detail: 'medium',
      ...(args.source_id ? { source_id: args.source_id } : {}),
    };
    writeLine(this.child?.stdin, {
      jsonrpc: '2.0',
      id: internalId,
      method: 'tools/call',
      params: { name: 'query', arguments: queryArguments },
    });
  }

  async handleChildLine(line) {
    const parsed = safeJsonParse(line);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
      writeLine(this.stdout, line);
      return;
    }
    const message = parsed.value;
    if (!hasId(message)) {
      writeLine(this.stdout, message);
      return;
    }

    const key = requestKey(message.id);
    const citedRequest = this.internalPending.get(key);
    if (citedRequest) {
      this.internalPending.delete(key);
      await this.finishCitedCall(message, citedRequest);
      return;
    }

    const request = this.pending.get(key);
    if (!request) {
      writeLine(this.stdout, message);
      return;
    }
    this.pending.delete(key);
    if (request.method === 'tools/list') {
      writeLine(this.stdout, augmentToolsList(message));
      return;
    }
    if (request.method === 'tools/call' && SUPPORTED_SEARCH_TOOLS.has(request.toolName)) {
      const transformed = transformSearchResponse(message, request, {
        roots: this.roots,
        provenanceCatalogs: this.provenanceCatalogs,
      });
      writeLine(this.stdout, transformed.message);
      return;
    }
    writeLine(this.stdout, message);
  }

  async finishCitedCall(message, request) {
    if (message.error || message.result?.isError) {
      writeLine(this.stdout, { ...message, id: request.clientId });
      return;
    }
    const transformed = transformSearchResponse(message, {
      method: 'tools/call',
      toolName: 'query',
      query: request.query,
      sourceId: request.sourceId,
      arguments: request.arguments,
    }, {
      roots: this.roots,
      provenanceCatalogs: this.provenanceCatalogs,
    });
    if (!transformed.transformed) {
      writeLine(this.stdout, toolErrorResponse(
        request.clientId,
        'unparseable_search_response',
        'The native GBrain response did not contain a supported candidate list; no answer was synthesized.',
      ));
      return;
    }

    let report;
    try {
      report = buildCitationAnswer({
        query: request.query,
        results: transformed.candidates,
        catalog: transformed.catalog,
        sourceId: request.sourceId,
        maxCitations: request.arguments.max_citations ?? 5,
      });
      report = await maybeSynthesizeWithOllama(report, {
        enabled: request.arguments.synthesize === true,
        ...(request.arguments.ollama_model ? { model: request.arguments.ollama_model } : {}),
      });
    } catch (error) {
      writeLine(this.stdout, toolErrorResponse(
        request.clientId,
        'citation_processing_failed',
        `Citation processing failed safely: ${String(error?.message ?? error)}`,
      ));
      return;
    }
    writeLine(this.stdout, {
      jsonrpc: '2.0',
      id: request.clientId,
      result: {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
        _meta: {
          ...(message.result?._meta ?? {}),
          project_authority_ranking: { mode: 'deterministic-authority-v1' },
        },
      },
    });
  }

  stop(signal = 'SIGTERM') {
    if (this.child && !this.child.killed) this.child.kill(signal);
  }
}

export function parseProxyArgs(argv, environment = process.env) {
  const childArgsFromEnvironment = environment.GBRAIN_PROXY_CHILD_ARGS_JSON
    ? safeJsonParse(environment.GBRAIN_PROXY_CHILD_ARGS_JSON)
    : null;
  const options = {
    childCommand: environment.GBRAIN_PROXY_CHILD_COMMAND || defaultGBrainChildCommand(environment),
    childArgs: childArgsFromEnvironment?.ok && Array.isArray(childArgsFromEnvironment.value)
      ? childArgsFromEnvironment.value.map(String)
      : ['serve'],
    roots: rootMapFromEnvironment(environment),
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--child-command') options.childCommand = argv[++index];
    else if (argument === '--child-args-json') {
      const parsed = safeJsonParse(argv[++index]);
      if (!parsed.ok || !Array.isArray(parsed.value)) throw new Error('--child-args-json must be a JSON array.');
      options.childArgs = parsed.value.map(String);
    } else if (argument === '--authority-root') {
      const mapping = argv[++index] ?? '';
      const equals = mapping.indexOf('=');
      if (equals <= 0 || equals === mapping.length - 1) {
        throw new Error('--authority-root must use SOURCE_ID=PATH.');
      }
      options.roots.set(mapping.slice(0, equals), resolve(mapping.slice(equals + 1)));
    } else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.childCommand) throw new Error('child command is required.');
  return options;
}

function main() {
  const options = parseProxyArgs(process.argv.slice(2));
  if (options.help) {
    process.stderr.write('Usage: node tools/gbrain/gbrain-authority-mcp-proxy.mjs [--child-command gbrain] [--child-args-json "[\\"serve\\"]"] [--authority-root SOURCE_ID=PATH]\n');
    return;
  }
  const proxy = new GBrainAuthorityProxy(options);
  proxy.start();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => proxy.stop(signal));
  }
}

const isDirect = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirect) main();
