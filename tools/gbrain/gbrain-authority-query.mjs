#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadMarkdownAuthorityCatalog,
  rankByAuthority,
} from './gbrain-authority-ranker.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..', '..');

export function resolveGBrainInvocation({
  command = null,
  argumentsPrefix = null,
  platform = process.platform,
  userProfile = process.env.USERPROFILE,
  pathExists = existsSync,
} = {}) {
  if (command) {
    return { command, argumentsPrefix: argumentsPrefix ?? [] };
  }
  if (platform === 'win32' && userProfile) {
    const bunExecutable = join(userProfile, '.bun', 'bin', 'bun.exe');
    const cliSource = join(userProfile, '.bun', 'install', 'global', 'node_modules', 'gbrain', 'src', 'cli.ts');
    if (pathExists(bunExecutable) && pathExists(cliSource)) {
      return { command: bunExecutable, argumentsPrefix: [cliSource] };
    }
  }
  return { command: 'gbrain', argumentsPrefix: [] };
}

export function parseGBrainResults(stdout, sourceId, limit) {
  const rows = [];
  const pattern = /^\[([+-]?(?:\d+(?:\.\d+)?|\.\d+))\]\s+(\S+)\s+--\s*(.*)$/gm;
  let match;
  while ((match = pattern.exec(String(stdout ?? ''))) !== null && rows.length < limit) {
    rows.push({
      source_id: sourceId,
      slug: match[2],
      score: Number.parseFloat(match[1]),
      snippet: match[3].trim(),
    });
  }
  return rows;
}

export function defaultAuthorityRoot(sourceId) {
  if (sourceId !== 'default') return null;
  const vault = resolve(REPOSITORY_ROOT, 'Minimalist-chat-vault');
  return existsSync(vault) ? vault : null;
}

export function executeAuthorityQuery({
  query,
  sourceId = 'default',
  limit = 10,
  timeoutMs = 60_000,
  authorityRanking = true,
  authorityRoot = defaultAuthorityRoot(sourceId),
  authorityCatalog = null,
  gbrainCommand = null,
  gbrainArgumentsPrefix = null,
} = {}) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('query is required.');
  if (typeof sourceId !== 'string' || !sourceId.trim()) throw new Error('sourceId is required.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('limit must be an integer from 1 to 50.');
  }

  const startedAt = performance.now();
  const retrievalStartedAt = performance.now();
  const invocation = resolveGBrainInvocation({
    command: gbrainCommand,
    argumentsPrefix: gbrainArgumentsPrefix,
  });
  const processResult = spawnSync(
    invocation.command,
    [
      ...invocation.argumentsPrefix,
      'query', query,
      '--source', sourceId,
      '--no-expand',
      '--limit', String(limit),
      '--autocut', 'false',
    ],
    { encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
  );
  const retrievalMs = Math.round(performance.now() - retrievalStartedAt);
  if (processResult.error) throw processResult.error;
  if (processResult.status !== 0) {
    throw new Error(`gbrain exited ${processResult.status}: ${processResult.stderr || processResult.stdout}`);
  }

  const parsed = parseGBrainResults(processResult.stdout, sourceId, limit);
  const rankingStartedAt = performance.now();
  let catalog = authorityCatalog;
  if (authorityRanking && !catalog && authorityRoot) {
    catalog = loadMarkdownAuthorityCatalog({ sourceId, root: authorityRoot });
  }
  const results = authorityRanking ? rankByAuthority(query, parsed, { catalog: catalog ?? new Map() }) : parsed;
  const rankingMs = Math.round(performance.now() - rankingStartedAt);

  return {
    schema_version: 1,
    query,
    source_id: sourceId,
    limit,
    ranking: {
      mode: authorityRanking ? 'deterministic-authority-v1' : 'none',
      authority_root: authorityRoot ? resolve(authorityRoot) : null,
    },
    latency_ms: {
      retrieval: retrievalMs,
      ranking: rankingMs,
      total: Math.round(performance.now() - startedAt),
    },
    results,
  };
}

function parseArgs(argv) {
  const options = {
    query: null,
    sourceId: 'default',
    limit: 10,
    timeoutMs: 60_000,
    authorityRanking: true,
    authorityRoot: null,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--query') options.query = argv[++index];
    else if (argument === '--source') options.sourceId = argv[++index];
    else if (argument === '--limit') options.limit = Number.parseInt(argv[++index], 10);
    else if (argument === '--timeout-ms') options.timeoutMs = Number.parseInt(argv[++index], 10);
    else if (argument === '--authority-root') options.authorityRoot = argv[++index];
    else if (argument === '--no-authority-ranking') options.authorityRanking = false;
    else if (argument === '--authority-ranking') options.authorityRanking = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node tools/gbrain/gbrain-authority-query.mjs --query <text> [--source default] [--limit 10] [--authority-root <dir>] [--no-authority-ranking] [--timeout-ms 60000] [--json]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.query) throw new Error('--query is required.');
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 300_000) {
    throw new Error('--timeout-ms must be an integer from 1 to 300000.');
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = executeAuthorityQuery({
    query: options.query,
    sourceId: options.sourceId,
    limit: options.limit,
    timeoutMs: options.timeoutMs,
    authorityRanking: options.authorityRanking,
    authorityRoot: options.authorityRoot || defaultAuthorityRoot(options.sourceId),
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  for (const result of report.results) {
    const score = result.authority_score ?? result.score;
    process.stdout.write(`[${score.toFixed(6)}] ${result.slug} -- ${result.snippet}\n`);
  }
}

const isDirect = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirect) main();
