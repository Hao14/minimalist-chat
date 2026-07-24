#!/usr/bin/env node

/**
 * Add deterministic, evidence-backed structural relationships to Graphify.
 *
 * This pass deliberately avoids semantic inference. It derives relationships
 * only from Graphify source_file membership, resolvable Obsidian wikilinks,
 * backticked repository paths that exist on disk, dated durable decisions,
 * test/source co-listing, and unambiguous repository path prefixes.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MANAGED_BY = 'minimalist-chat-relationship-enrichment';
export const ARTIFACT_SCHEMA_VERSION = 1;

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
const DEFAULT_VAULT = path.join(DEFAULT_REPO, 'Minimalist-chat-vault');
const INCLUDED_TOP_LEVEL = new Set([
  '00 Home',
  '10 Product',
  '11 Product',
  '20 Research',
  '30 Audits',
  '40 Operations',
  '50 Skills',
  '90 Memory',
]);
const EXCLUDED_VAULT_PARTS = new Set([
  '.codex',
  '.gbrain',
  '.obsidian',
  'graphify-out',
  'skills',
]);
const CODE_ROOTS = new Set([
  '.github',
  'android',
  'functions',
  'ios',
  'public',
  'src',
  'tools',
]);
const CODE_ROOT_FILES = new Set([
  'capacitor.config.js',
  'capacitor.config.json',
  'capacitor.config.ts',
  'database.rules.json',
  'firebase.json',
  'index.html',
  'package.json',
  'storage.rules',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.ts',
]);
const CODE_EXTENSIONS = new Set([
  '.cjs',
  '.cs',
  '.csproj',
  '.css',
  '.gradle',
  '.h',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.kts',
  '.md',
  '.mjs',
  '.ps1',
  '.py',
  '.scss',
  '.sh',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.xml',
  '.yaml',
  '.yml',
]);
const MEDIA_EXTENSIONS = new Set([
  '.avif', '.gif', '.jpeg', '.jpg', '.mov', '.mp3', '.mp4', '.pdf',
  '.png', '.svg', '.wav', '.webm', '.webp',
]);
const QUERY_MEMORY_SOURCE_PATTERN = /^graphify-out\/memory\/query_[a-z0-9][a-z0-9_-]*\.md$/i;
const PROJECT_TIMELINE_SOURCE_FILE = '90 Memory/Project Timeline.md';
const SENSITIVE_PATH_PATTERN = /(?:^|\/)(?:\.env(?:\.|$)|credentials?(?:\.|\/|$)|secrets?(?:\.|\/|$)|private[-_]?keys?(?:\.|\/|$))/i;
const OUTPUT_FILES = [
  'graph.json',
  'GRAPH_REPORT.md',
  'graph.html',
  'manifest.json',
  'cost.json',
  '.vocab.txt',
  '.graphify_root',
  '.graphify_analysis.json',
  '.graphify_labels.json',
  '.graphify_labels.json.sig',
];

function normalizeSlashes(value) {
  return value.replaceAll('\\', '/');
}

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeLabel(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'item';
}

function shortHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function sourceLine(location) {
  const match = /^L(\d+)/i.exec(String(location ?? ''));
  return match ? Number.parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
}

function lineAt(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function stripCodeFences(text) {
  return text.replace(/```[\s\S]*?```/g, (match) => match.replace(/[^\r\n]/g, ''));
}

function graphPairKey(source, target, directed) {
  if (directed || source < target) return `${source}\u0000${target}`;
  return `${target}\u0000${source}`;
}

function edgeIdentity(edge, directed) {
  return graphPairKey(String(edge.source), String(edge.target), directed);
}

function assertGraph(graph, label = 'graph') {
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    throw new Error(`${label} must be a Graphify node-link JSON object`);
  }
  if (graph.multigraph) {
    throw new Error(`${label} is a multigraph; this deterministic pass only supports simple Graphify graphs`);
  }
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string' || node.id.length === 0) {
      throw new Error(`${label} contains a node without a stable string id`);
    }
    if (ids.has(node.id)) throw new Error(`${label} contains duplicate node id ${node.id}`);
    ids.add(node.id);
  }
  const pairs = new Set();
  for (const edge of graph.links) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error(`${label} contains a dangling edge ${edge.source} -> ${edge.target}`);
    }
    if (edge.source === edge.target) throw new Error(`${label} contains self-loop ${edge.source}`);
    const key = edgeIdentity(edge, Boolean(graph.directed));
    if (pairs.has(key)) throw new Error(`${label} contains duplicate simple edge ${key}`);
    pairs.add(key);
  }
}

export function stripManagedContent(graph) {
  const managedNodeIds = new Set(
    graph.nodes.filter((node) => node.managed_by === MANAGED_BY).map((node) => node.id),
  );
  for (const edge of graph.links) {
    const touchesManaged = managedNodeIds.has(edge.source) || managedNodeIds.has(edge.target);
    if (touchesManaged && edge.managed_by !== MANAGED_BY) {
      throw new Error(`Refusing to remove managed node used by an unmanaged edge: ${edge.source} -> ${edge.target}`);
    }
  }
  const hyperedges = [
    ...(Array.isArray(graph.hyperedges) ? graph.hyperedges : []),
    ...(Array.isArray(graph.graph?.hyperedges) ? graph.graph.hyperedges : []),
  ];
  for (const hyperedge of hyperedges) {
    if ((hyperedge.nodes ?? []).some((id) => managedNodeIds.has(id))) {
      throw new Error(`Refusing to remove managed node used by hyperedge ${hyperedge.id ?? '(unknown)'}`);
    }
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.managed_by !== MANAGED_BY),
    links: graph.links.filter((edge) => edge.managed_by !== MANAGED_BY),
  };
}

export function graphStats(graph) {
  const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.links) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const zeroDegreeNodes = [...degree.values()].filter((value) => value === 0).length;
  const oneDegreeNodes = [...degree.values()].filter((value) => value === 1).length;
  return {
    nodes: graph.nodes.length,
    edges: graph.links.length,
    low_degree_nodes: zeroDegreeNodes + oneDegreeNodes,
    zero_degree_nodes: zeroDegreeNodes,
    one_degree_nodes: oneDegreeNodes,
  };
}

export function assertRelationshipQualityNotRegressed(originalGraph, candidateGraph) {
  const before = graphStats(originalGraph);
  const after = graphStats(candidateGraph);
  if (after.zero_degree_nodes > before.zero_degree_nodes) {
    throw new Error(
      `Relationship quality guard: isolated nodes would increase from ${before.zero_degree_nodes} to ${after.zero_degree_nodes}`,
    );
  }
  if (after.low_degree_nodes > before.low_degree_nodes) {
    throw new Error(
      `Relationship quality guard: nodes with degree <= 1 would increase from ${before.low_degree_nodes} to ${after.low_degree_nodes}`,
    );
  }
}

function parseMarkdownTitle(text, fallbackName) {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/m.exec(text)?.[1] ?? '';
  const titleLine = /^title:\s*(.*?)\s*$/im.exec(frontmatter)?.[1];
  if (titleLine) return titleLine.replace(/^['"]|['"]$/g, '').trim();
  const heading = /^#\s+(.+?)\s*$/m.exec(text)?.[1];
  return heading?.trim() || fallbackName;
}

function normalizeVaultSourcePath(value, vaultRoot = null) {
  let normalized = normalizeSlashes(String(value ?? '')).replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) return null;
  if (vaultRoot) {
    const vaultName = path.basename(path.resolve(vaultRoot));
    const parts = normalized.split('/');
    if (parts[0]?.localeCompare(vaultName, 'en-US', { sensitivity: 'accent' }) === 0) {
      parts.shift();
      normalized = parts.join('/');
    }
  }
  if (SENSITIVE_PATH_PATTERN.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  return normalized;
}

function resolveExistingVaultFile(vaultRoot, sourceFile) {
  const normalized = normalizeVaultSourcePath(sourceFile, vaultRoot);
  if (!normalized) return null;
  const absolutePath = path.resolve(vaultRoot, ...normalized.split('/'));
  if (!isWithin(vaultRoot, absolutePath) || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    return null;
  }
  const realVault = realpathSync(vaultRoot);
  const realFile = realpathSync(absolutePath);
  if (!isWithin(realVault, realFile)) return null;
  return { absolutePath, sourceFile: normalized };
}

function canonicalizeVaultSourceAttribute(record, vaultRoot) {
  if (!record || typeof record.source_file !== 'string') return record;
  const resolved = resolveExistingVaultFile(vaultRoot, record.source_file);
  if (!resolved || resolved.sourceFile === normalizeSlashes(record.source_file)) return record;
  return { ...record, source_file: resolved.sourceFile };
}

export function canonicalizeGraphVaultSourcePaths(graph, vaultRoot) {
  const normalizeHyperedges = (items) => (
    Array.isArray(items) ? items.map((item) => canonicalizeVaultSourceAttribute(item, vaultRoot)) : items
  );
  return {
    ...graph,
    graph: graph.graph && typeof graph.graph === 'object'
      ? { ...graph.graph, hyperedges: normalizeHyperedges(graph.graph.hyperedges) }
      : graph.graph,
    nodes: graph.nodes.map((node) => canonicalizeVaultSourceAttribute(node, vaultRoot)),
    links: graph.links.map((edge) => canonicalizeVaultSourceAttribute(edge, vaultRoot)),
    hyperedges: normalizeHyperedges(graph.hyperedges),
  };
}

function isQueryMemoryMarkdown(sourceFile) {
  return QUERY_MEMORY_SOURCE_PATTERN.test(sourceFile);
}

function isIncludedMarkdown(sourceFile) {
  if (path.posix.extname(sourceFile).toLowerCase() !== '.md') return false;
  if (isQueryMemoryMarkdown(sourceFile)) return true;
  const relativeParts = sourceFile.split('/');
  if (relativeParts.some((part) => EXCLUDED_VAULT_PARTS.has(part))) return false;
  return relativeParts.length === 1 || INCLUDED_TOP_LEVEL.has(relativeParts[0]);
}

function isIncludedMedia(sourceFile) {
  if (!MEDIA_EXTENSIONS.has(path.posix.extname(sourceFile).toLowerCase())) return false;
  const relativeParts = sourceFile.split('/');
  if (relativeParts.some((part) => EXCLUDED_VAULT_PARTS.has(part))) return false;
  return relativeParts.length === 1 || INCLUDED_TOP_LEVEL.has(relativeParts[0]);
}

function buildDocumentIndex(baseGraph, vaultRoot) {
  const groups = new Map();
  for (const node of baseGraph.nodes) {
    if (typeof node.source_file !== 'string') continue;
    const resolved = resolveExistingVaultFile(vaultRoot, node.source_file);
    if (!resolved || !isIncludedMarkdown(resolved.sourceFile)) continue;
    if (!groups.has(resolved.sourceFile)) groups.set(resolved.sourceFile, {
      absolutePath: resolved.absolutePath,
      nodes: [],
      sourceFile: resolved.sourceFile,
    });
    groups.get(resolved.sourceFile).nodes.push(node);
  }

  const documents = new Map();
  for (const group of groups.values()) {
    const { absolutePath, nodes, sourceFile } = group;
    const text = readFileSync(absolutePath, 'utf8');
    const title = parseMarkdownTitle(text, path.basename(sourceFile));
    const wanted = new Set([
      normalizeLabel(title),
      normalizeLabel(path.basename(sourceFile)),
      normalizeLabel(path.basename(sourceFile, '.md')),
    ]);
    let candidates = nodes.filter((node) => wanted.has(normalizeLabel(node.label)));
    if (candidates.length === 0) {
      candidates = nodes.filter((node) => sourceLine(node.source_location) === 1);
    }
    if (candidates.length === 0) continue;
    candidates.sort((left, right) => {
      const lineDiff = sourceLine(left.source_location) - sourceLine(right.source_location);
      if (lineDiff !== 0) return lineDiff;
      const lengthDiff = left.id.length - right.id.length;
      return lengthDiff || left.id.localeCompare(right.id);
    });
    documents.set(sourceFile, {
      absolutePath,
      nodes,
      root: candidates[0],
      sourceFile,
      text,
      title,
    });
  }
  return documents;
}

function buildMediaIndex(baseGraph, vaultRoot) {
  const groups = new Map();
  for (const node of baseGraph.nodes) {
    if (typeof node.source_file !== 'string') continue;
    const resolved = resolveExistingVaultFile(vaultRoot, node.source_file);
    if (!resolved || !isIncludedMedia(resolved.sourceFile)) continue;
    if (!groups.has(resolved.sourceFile)) groups.set(resolved.sourceFile, {
      absolutePath: resolved.absolutePath,
      nodes: [],
      sourceFile: resolved.sourceFile,
    });
    groups.get(resolved.sourceFile).nodes.push(node);
  }

  const media = new Map();
  for (const group of groups.values()) {
    media.set(group.sourceFile, {
      absolutePath: group.absolutePath,
      nodes: group.nodes,
      sourceFile: group.sourceFile,
    });
  }
  return media;
}

function mediaEmbeds(text) {
  const searchable = stripCodeFences(text);
  const embeds = [];
  for (const match of searchable.matchAll(/!\[\[([^\]\r\n]+)\]\]/g)) {
    embeds.push({
      index: match.index,
      raw: match[0],
      target: match[1].split('|', 1)[0].trim(),
    });
  }
  for (const match of searchable.matchAll(/!\[[^\]\r\n]*\]\(\s*(?:<([^>\r\n]+)>|([^\s)\r\n]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
    embeds.push({
      index: match.index,
      raw: match[0],
      target: (match[1] ?? match[2] ?? '').trim(),
    });
  }
  return embeds.sort((left, right) => left.index - right.index || left.raw.localeCompare(right.raw));
}

function buildMediaResolver(media) {
  const byPath = new Map();
  for (const item of media.values()) {
    const key = item.sourceFile.toLocaleLowerCase('en-US');
    if (!byPath.has(key)) byPath.set(key, item);
    else byPath.set(key, null);
  }
  return (sourceDocument, rawTarget) => {
    let target = String(rawTarget ?? '').trim().replaceAll('\\', '/');
    target = target.split('#', 1)[0].trim();
    if (!target || /^[a-z]+:/i.test(target) || /^[a-z]:\//i.test(target)) return null;
    const sourceDirectory = path.posix.dirname(sourceDocument.sourceFile);
    const vaultRelativeTarget = target.replace(/^\/+/, '');
    const candidates = target.startsWith('/')
      ? [vaultRelativeTarget]
      : [path.posix.normalize(path.posix.join(sourceDirectory, target)), path.posix.normalize(target)];
    for (const candidate of candidates) {
      const normalized = normalizeVaultSourcePath(candidate);
      if (!normalized) continue;
      const hit = byPath.get(normalized.toLocaleLowerCase('en-US'));
      if (hit) return hit;
    }
    return null;
  };
}

function markdownPathKey(value) {
  return normalizeSlashes(value).replace(/^\.\//, '').replace(/\.md$/i, '').toLocaleLowerCase('en-US');
}

function buildWikiResolver(documents, vaultRoot) {
  const byPath = new Map();
  const byName = new Map();
  for (const document of documents.values()) {
    const relative = normalizeSlashes(path.relative(vaultRoot, document.absolutePath));
    byPath.set(markdownPathKey(relative), document);
    const name = path.basename(relative, '.md').toLocaleLowerCase('en-US');
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(document);
  }
  return (sourceDocument, rawTarget) => {
    const target = rawTarget.split('|', 1)[0].split('#', 1)[0].trim().replaceAll('\\', '/');
    if (!target || MEDIA_EXTENSIONS.has(path.extname(target).toLowerCase())) return null;
    const sourceDirectory = path.posix.dirname(sourceDocument.sourceFile);
    const keys = [
      markdownPathKey(path.posix.normalize(path.posix.join(sourceDirectory, target))),
      markdownPathKey(target),
    ];
    for (const key of keys) {
      if (byPath.has(key)) return byPath.get(key);
    }
    const basenameHits = byName.get(path.posix.basename(target).replace(/\.md$/i, '').toLocaleLowerCase('en-US')) ?? [];
    return basenameHits.length === 1 ? basenameHits[0] : null;
  };
}

function normalizeRepositoryPath(rawValue, repoRoot) {
  let value = String(rawValue).trim().replace(/^['"]|['"]$/g, '').replaceAll('\\', '/');
  value = value.replace(/^\.\//, '').replace(/[),.;:]+$/g, '');
  if (!value || /[\r\n\t*?<>|]/.test(value) || /^[a-z]+:\/\//i.test(value)) return null;
  if (/^[a-z]:\//i.test(value) || value.startsWith('/') || value.includes('..')) return null;
  if (SENSITIVE_PATH_PATTERN.test(value)) return null;
  const firstPart = value.split('/', 1)[0];
  if (!CODE_ROOTS.has(firstPart) && !CODE_ROOT_FILES.has(value)) return null;
  if (!CODE_EXTENSIONS.has(path.posix.extname(value).toLowerCase())) return null;

  const candidate = path.resolve(repoRoot, ...value.split('/'));
  if (!isWithin(repoRoot, candidate) || !existsSync(candidate) || !lstatSync(candidate).isFile()) return null;
  const realRepo = realpathSync(repoRoot);
  const realCandidate = realpathSync(candidate);
  if (!isWithin(realRepo, realCandidate)) return null;
  return normalizeSlashes(path.relative(repoRoot, realCandidate));
}

function isTestPath(repoPath) {
  const normalized = repoPath.toLocaleLowerCase('en-US');
  const basename = path.posix.basename(normalized);
  return normalized.split('/').includes('tests')
    || /(?:^|[._-])tests?(?:[._-]|$)/.test(basename)
    || /(?:\.test\.|\.spec\.|-test\.)/.test(basename);
}

function featureFromPath(repoPath) {
  const match = /^src\/features\/([^/]+)\//i.exec(repoPath);
  return match?.[1].toLocaleLowerCase('en-US') ?? null;
}

function platformFromPath(repoPath) {
  const normalized = repoPath.toLocaleLowerCase('en-US');
  if (normalized.startsWith('tools/ai-analysis-app/')) return 'Windows';
  if (normalized.startsWith('android/')) return 'Android';
  if (normalized.startsWith('ios/')) return 'iPhone & iPad';
  if (normalized.startsWith('macos/')) return 'macOS';
  if (normalized.startsWith('src/') || normalized.startsWith('public/')) return 'Web App';
  return null;
}

function decisionLabel(date, body) {
  const plain = body
    .replace(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const firstClause = plain.split(/(?<=[.!?])\s|;|Canonical sources:/i, 1)[0]
    .replace(/^(?:Keep|The|Treat|Use)\s+/i, '')
    .trim();
  const summary = firstClause.length > 82 ? `${firstClause.slice(0, 79).trimEnd()}...` : firstClause;
  return `Decision ${date}: ${summary || 'Recorded project decision'}`;
}

function createManagedNode(id, attributes) {
  return {
    ...attributes,
    id,
    _origin: 'deterministic',
    managed_by: MANAGED_BY,
    confidence: 'EXTRACTED',
    confidence_score: 1,
  };
}

function createManagedEdge(source, target, relation, evidence) {
  return {
    relation,
    confidence: 'EXTRACTED',
    confidence_score: 1,
    weight: 1,
    managed_by: MANAGED_BY,
    evidence_type: evidence.type,
    evidence: evidence.text,
    source_file: evidence.sourceFile,
    source_location: `L${evidence.line}`,
    source,
    target,
  };
}

function existingPlatformNodes(baseGraph) {
  const wanted = ['Web App', 'Windows', 'macOS', 'Android', 'iPhone & iPad'];
  const result = new Map();
  for (const label of wanted) {
    const matches = baseGraph.nodes.filter((node) => normalizeLabel(node.label) === normalizeLabel(label));
    matches.sort((left, right) => {
      const leftDownload = String(left.source_file).includes('Legacy - Download.md') ? 0 : 1;
      const rightDownload = String(right.source_file).includes('Legacy - Download.md') ? 0 : 1;
      return leftDownload - rightDownload || left.id.localeCompare(right.id);
    });
    if (matches[0]) result.set(label, matches[0]);
  }
  return result;
}

function validatePreserved(baseGraph, candidateGraph) {
  const candidateIds = new Set(candidateGraph.nodes.map((node) => node.id));
  for (const node of baseGraph.nodes) {
    if (!candidateIds.has(node.id)) throw new Error(`Shrink guard: unmanaged node disappeared: ${node.id}`);
  }
  const candidateEdges = new Set(candidateGraph.links.map((edge) => edgeIdentity(edge, Boolean(candidateGraph.directed))));
  for (const edge of baseGraph.links) {
    const identity = edgeIdentity(edge, Boolean(baseGraph.directed));
    if (!candidateEdges.has(identity)) throw new Error(`Shrink guard: unmanaged edge disappeared: ${identity}`);
  }
}

export function buildEnrichedGraph({ graph, repoRoot, vaultRoot }) {
  assertGraph(graph, 'input graph');
  const baseGraph = canonicalizeGraphVaultSourcePaths(stripManagedContent(graph), vaultRoot);
  assertGraph(baseGraph, 'unmanaged base graph');
  const documents = buildDocumentIndex(baseGraph, vaultRoot);
  const media = buildMediaIndex(baseGraph, vaultRoot);
  const resolveWiki = buildWikiResolver(documents, vaultRoot);
  const resolveMedia = buildMediaResolver(media);
  const directed = Boolean(baseGraph.directed);
  const nodeIds = new Set(baseGraph.nodes.map((node) => node.id));
  const pairKeys = new Set(baseGraph.links.map((edge) => edgeIdentity(edge, directed)));
  const managedNodes = new Map();
  const managedEdges = [];
  const categories = {
    document_membership: 0,
    query_memory_membership: 0,
    media_source_membership: 0,
    timeline_media_embeds: 0,
    document_wikilinks: 0,
    code_path_references: 0,
    dated_decisions: 0,
    decision_sources: 0,
    test_source_colistings: 0,
    feature_structure: 0,
    platform_structure: 0,
  };

  const ensureNode = (node) => {
    if (nodeIds.has(node.id)) return node.id;
    const prior = managedNodes.get(node.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(node)) {
      throw new Error(`Managed node id collision: ${node.id}`);
    }
    managedNodes.set(node.id, node);
    nodeIds.add(node.id);
    return node.id;
  };
  const addEdge = (source, target, relation, evidence, category) => {
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      throw new Error(`Cannot add edge with missing endpoint: ${source} -> ${target}`);
    }
    if (source === target) return false;
    const key = graphPairKey(source, target, directed);
    if (pairKeys.has(key)) return false;
    pairKeys.add(key);
    managedEdges.push(createManagedEdge(source, target, relation, evidence));
    categories[category] += 1;
    return true;
  };

  // Every extracted concept is structurally a member of its source document.
  // Direct root membership complements Graphify's heading tree without making a
  // semantic assertion and removes leaves caused only by nested heading depth.
  for (const document of [...documents.values()].sort((a, b) => a.sourceFile.localeCompare(b.sourceFile))) {
    const queryMemory = isQueryMemoryMarkdown(document.sourceFile);
    for (const node of [...document.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
      if (node.id === document.root.id) continue;
      addEdge(document.root.id, node.id, 'member_of_source_document', {
        type: queryMemory ? 'query_memory_source_file_group' : 'source_file_group',
        text: `Both nodes were extracted from ${document.sourceFile}`,
        sourceFile: document.sourceFile,
        line: Number.isFinite(sourceLine(node.source_location)) ? sourceLine(node.source_location) : 1,
      }, queryMemory ? 'query_memory_membership' : 'document_membership');
    }
  }

  // A media source root represents only exact Graphify source_file membership.
  // It does not infer meaning from the image, audio, or document contents.
  const timelineDocument = documents.get(PROJECT_TIMELINE_SOURCE_FILE);
  const timelineEmbeds = new Map();
  if (timelineDocument) {
    for (const embed of mediaEmbeds(timelineDocument.text)) {
      const target = resolveMedia(timelineDocument, embed.target);
      if (!target || timelineEmbeds.has(target.sourceFile)) continue;
      timelineEmbeds.set(target.sourceFile, {
        line: lineAt(timelineDocument.text, embed.index),
        raw: embed.raw,
      });
    }
  }

  const mediaRootIds = new Map();
  for (const item of [...media.values()].sort((a, b) => a.sourceFile.localeCompare(b.sourceFile))) {
    if (item.nodes.length < 2 && !timelineEmbeds.has(item.sourceFile)) continue;
    const id = `structural_media_source_${slugify(item.sourceFile).slice(0, 80)}_${shortHash(item.sourceFile)}`;
    ensureNode(createManagedNode(id, {
      label: `Media source: ${path.posix.basename(item.sourceFile)}`,
      node_type: 'media_source_file',
      file_type: 'media',
      source_file: item.sourceFile,
      source_location: 'source file group',
      evidence_type: 'exact_existing_media_source_file',
      norm_label: normalizeLabel(`Media source: ${path.posix.basename(item.sourceFile)}`),
    }));
    mediaRootIds.set(item.sourceFile, id);
    for (const node of [...item.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
      addEdge(id, node.id, 'member_of_media_source_file', {
        type: 'media_source_file_group',
        text: `Node source_file exactly matches existing local media file ${item.sourceFile}`,
        sourceFile: item.sourceFile,
        line: 1,
      }, 'media_source_membership');
    }
  }

  if (timelineDocument) {
    for (const [sourceFile, evidence] of [...timelineEmbeds.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const mediaRootId = mediaRootIds.get(sourceFile);
      if (!mediaRootId) continue;
      addEdge(timelineDocument.root.id, mediaRootId, 'embeds_timeline_media', {
        type: 'explicit_project_timeline_media_embed',
        text: `Project Timeline contains exact media embed ${evidence.raw}`,
        sourceFile: timelineDocument.sourceFile,
        line: evidence.line,
      }, 'timeline_media_embeds');
    }
  }

  // Explicit Obsidian links connect document roots. Existing Graphify edges win;
  // this pass only fills a missing pair.
  for (const document of [...documents.values()].sort((a, b) => a.sourceFile.localeCompare(b.sourceFile))) {
    const text = stripCodeFences(document.text);
    for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const target = resolveWiki(document, match[1]);
      if (!target || target.root.id === document.root.id) continue;
      addEdge(document.root.id, target.root.id, 'references_document', {
        type: 'explicit_wikilink',
        text: `Explicit wikilink [[${match[1]}]]`,
        sourceFile: document.sourceFile,
        line: lineAt(text, match.index),
      }, 'document_wikilinks');
    }
  }

  const occurrences = [];
  const decisionRecords = [];
  for (const document of [...documents.values()].sort((a, b) => a.sourceFile.localeCompare(b.sourceFile))) {
    const lines = document.text.split(/\r?\n/);
    let inDurableDecisions = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^##\s+Durable decisions\s*$/i.test(line.trim())) {
        inDurableDecisions = true;
        continue;
      }
      if (inDurableDecisions && /^##\s+/.test(line)) inDurableDecisions = false;
      const linePaths = [];
      for (const match of line.matchAll(/`([^`\r\n]+)`/g)) {
        const repoPath = normalizeRepositoryPath(match[1], repoRoot);
        if (!repoPath) continue;
        const occurrence = {
          document,
          line: index + 1,
          lineText: line,
          repoPath,
        };
        occurrences.push(occurrence);
        linePaths.push(repoPath);
      }
      const decisionMatch = inDurableDecisions
        ? /^\s*-\s*(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(.+)$/.exec(line)
        : null;
      if (decisionMatch) {
        const linkedDocuments = [];
        for (const wikiMatch of line.matchAll(/\[\[([^\]]+)\]\]/g)) {
          const target = resolveWiki(document, wikiMatch[1]);
          if (target && target.root.id !== document.root.id) linkedDocuments.push(target);
        }
        decisionRecords.push({
          body: decisionMatch[2],
          date: decisionMatch[1],
          document,
          line: index + 1,
          linkedDocuments,
          paths: [...new Set(linePaths)],
        });
      }
    }
  }

  const pathRecords = new Map();
  for (const occurrence of occurrences) {
    if (!pathRecords.has(occurrence.repoPath)) {
      pathRecords.set(occurrence.repoPath, {
        documents: new Set(),
        feature: featureFromPath(occurrence.repoPath),
        occurrences: [],
        platform: platformFromPath(occurrence.repoPath),
        repoPath: occurrence.repoPath,
      });
    }
    const record = pathRecords.get(occurrence.repoPath);
    record.documents.add(occurrence.document.sourceFile);
    record.occurrences.push(occurrence);
  }
  const multiPathLines = new Set();
  const lineGroups = new Map();
  for (const occurrence of occurrences) {
    const key = `${occurrence.document.sourceFile}\u0000${occurrence.line}`;
    if (!lineGroups.has(key)) lineGroups.set(key, []);
    lineGroups.get(key).push(occurrence);
  }
  for (const [key, group] of lineGroups) {
    if (new Set(group.map((item) => item.repoPath)).size > 1) multiPathLines.add(key);
  }
  const decisionPaths = new Set(decisionRecords.flatMap((decision) => decision.paths));
  const eligiblePaths = new Set();
  for (const record of pathRecords.values()) {
    const hasMultiPathLine = record.occurrences.some((occurrence) => (
      multiPathLines.has(`${occurrence.document.sourceFile}\u0000${occurrence.line}`)
    ));
    if (record.documents.size > 1 || hasMultiPathLine || decisionPaths.has(record.repoPath)
      || record.feature || record.platform) {
      eligiblePaths.add(record.repoPath);
    }
  }

  const pathNodeIds = new Map();
  for (const repoPath of [...eligiblePaths].sort()) {
    const record = pathRecords.get(repoPath);
    const id = `structural_code_path_${slugify(repoPath).slice(0, 80)}_${shortHash(repoPath)}`;
    ensureNode(createManagedNode(id, {
      label: repoPath,
      node_type: isTestPath(repoPath) ? 'test_path' : 'code_path',
      file_type: 'code',
      source_file: repoPath,
      source_location: 'repository path',
      evidence_type: 'backticked_existing_repository_path',
      norm_label: normalizeLabel(repoPath),
    }));
    pathNodeIds.set(repoPath, id);
    const firstByDocument = new Map();
    for (const occurrence of record.occurrences) {
      if (!firstByDocument.has(occurrence.document.sourceFile)) {
        firstByDocument.set(occurrence.document.sourceFile, occurrence);
      }
    }
    for (const occurrence of [...firstByDocument.values()].sort((a, b) => (
      a.document.sourceFile.localeCompare(b.document.sourceFile) || a.line - b.line
    ))) {
      addEdge(occurrence.document.root.id, id, 'references_code_path', {
        type: 'backticked_existing_repository_path',
        text: `Backticked path \`${repoPath}\` exists in the repository`,
        sourceFile: occurrence.document.sourceFile,
        line: occurrence.line,
      }, 'code_path_references');
    }
  }

  // Dated durable decisions become explicit records connected only to their
  // verified paths and resolvable wikilink sources.
  for (const decision of decisionRecords) {
    const verifiedPaths = decision.paths.filter((repoPath) => pathNodeIds.has(repoPath));
    const linkedRoots = [...new Map(
      decision.linkedDocuments.map((document) => [document.root.id, document.root]),
    ).values()];
    if (verifiedPaths.length === 0 && linkedRoots.length === 0) continue;
    const decisionKey = `${decision.document.sourceFile}:${decision.line}:${decision.date}`;
    const id = `structural_decision_${decision.date.replaceAll('-', '_')}_${shortHash(decisionKey)}`;
    ensureNode(createManagedNode(id, {
      label: decisionLabel(decision.date, decision.body),
      node_type: 'dated_durable_decision',
      file_type: 'document',
      source_file: decision.document.sourceFile,
      source_location: `L${decision.line}`,
      evidence_type: 'dated_durable_decision_bullet',
      norm_label: normalizeLabel(decisionLabel(decision.date, decision.body)),
      status: 'active',
    }));
    addEdge(decision.document.root.id, id, 'records_durable_decision', {
      type: 'dated_durable_decision_bullet',
      text: `Dated durable decision recorded on ${decision.date}`,
      sourceFile: decision.document.sourceFile,
      line: decision.line,
    }, 'dated_decisions');
    for (const repoPath of verifiedPaths.sort()) {
      addEdge(id, pathNodeIds.get(repoPath), 'cites_canonical_path', {
        type: 'canonical_path_in_decision',
        text: `Decision explicitly lists existing path \`${repoPath}\``,
        sourceFile: decision.document.sourceFile,
        line: decision.line,
      }, 'decision_sources');
    }
    for (const targetRoot of linkedRoots.sort((a, b) => a.id.localeCompare(b.id))) {
      addEdge(id, targetRoot.id, 'cites_document', {
        type: 'wikilink_in_decision',
        text: `Decision explicitly links to ${targetRoot.label}`,
        sourceFile: decision.document.sourceFile,
        line: decision.line,
      }, 'decision_sources');
    }
  }

  // A test/source edge says only that the paths were co-listed in the same
  // verification statement; it does not invent execution or coverage claims.
  for (const group of [...lineGroups.values()].sort((a, b) => {
    const left = `${a[0].document.sourceFile}:${a[0].line}`;
    const right = `${b[0].document.sourceFile}:${b[0].line}`;
    return left.localeCompare(right);
  })) {
    const paths = [...new Set(group.map((item) => item.repoPath))].filter((repoPath) => pathNodeIds.has(repoPath));
    const tests = paths.filter(isTestPath);
    const sources = paths.filter((repoPath) => !isTestPath(repoPath));
    for (const testPath of tests.sort()) {
      for (const sourcePath of sources.sort()) {
        addEdge(pathNodeIds.get(testPath), pathNodeIds.get(sourcePath), 'verification_co_listed_with', {
          type: 'test_source_same_statement',
          text: `Test and source paths are explicitly co-listed in the same statement`,
          sourceFile: group[0].document.sourceFile,
          line: group[0].line,
        }, 'test_source_colistings');
      }
    }
  }

  const featureMembers = new Map();
  for (const repoPath of eligiblePaths) {
    const feature = featureFromPath(repoPath);
    if (!feature) continue;
    if (!featureMembers.has(feature)) featureMembers.set(feature, new Set());
    featureMembers.get(feature).add(repoPath);
  }
  for (const testPath of [...eligiblePaths].filter(isTestPath)) {
    const normalizedTestName = slugify(path.posix.basename(testPath));
    for (const feature of featureMembers.keys()) {
      if (normalizedTestName.startsWith(slugify(feature))) featureMembers.get(feature).add(testPath);
    }
  }
  for (const [feature, members] of [...featureMembers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const linkedMembers = [...members].filter((repoPath) => pathNodeIds.has(repoPath)).sort();
    if (linkedMembers.length < 2) continue;
    const id = `structural_feature_directory_${slugify(feature)}_${shortHash(feature)}`;
    ensureNode(createManagedNode(id, {
      label: `Feature directory: ${feature}`,
      node_type: 'feature_directory',
      file_type: 'directory',
      source_file: `src/features/${feature}/`,
      source_location: 'repository path prefix',
      evidence_type: 'feature_path_prefix',
      norm_label: normalizeLabel(`Feature directory: ${feature}`),
    }));
    for (const repoPath of linkedMembers) {
      addEdge(id, pathNodeIds.get(repoPath), isTestPath(repoPath) ? 'test_name_matches_feature_directory' : 'contains_code_path', {
        type: isTestPath(repoPath) ? 'test_filename_matches_feature_directory' : 'feature_path_prefix',
        text: isTestPath(repoPath)
          ? `Test filename structurally matches feature directory ${feature}`
          : `Path is located under src/features/${feature}/`,
        sourceFile: pathRecords.get(repoPath).occurrences[0].document.sourceFile,
        line: pathRecords.get(repoPath).occurrences[0].line,
      }, 'feature_structure');
    }
  }

  const platformNodes = existingPlatformNodes(baseGraph);
  for (const repoPath of [...eligiblePaths].sort()) {
    const platform = platformFromPath(repoPath);
    const platformNode = platform ? platformNodes.get(platform) : null;
    if (!platformNode) continue;
    addEdge(pathNodeIds.get(repoPath), platformNode.id, 'located_in_platform_tree', {
      type: 'unambiguous_repository_path_prefix',
      text: `Repository path prefix maps \`${repoPath}\` to ${platform}`,
      sourceFile: pathRecords.get(repoPath).occurrences[0].document.sourceFile,
      line: pathRecords.get(repoPath).occurrences[0].line,
    }, 'platform_structure');
  }

  const sortedManagedNodes = [...managedNodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  managedEdges.sort((left, right) => (
    left.source.localeCompare(right.source)
    || left.target.localeCompare(right.target)
    || left.relation.localeCompare(right.relation)
  ));
  const candidateGraph = {
    ...baseGraph,
    nodes: [...baseGraph.nodes, ...sortedManagedNodes],
    links: [...baseGraph.links, ...managedEdges],
  };
  assertGraph(candidateGraph, 'enriched graph');
  validatePreserved(baseGraph, candidateGraph);
  assertRelationshipQualityNotRegressed(graph, candidateGraph);

  const artifact = {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    generator: 'tools/gbrain/Enrich-ProjectRelationships.mjs',
    managed_by: MANAGED_BY,
    evidence_policy: 'deterministic-structural-only',
    nodes: sortedManagedNodes,
    links: managedEdges,
    category_counts: categories,
  };
  return { artifact, baseGraph, candidateGraph, categories };
}

function backupOutputs(graphPath, artifactPath) {
  const outputDirectory = path.dirname(graphPath);
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
  const backupDirectory = path.join(outputDirectory, 'backups', 'relationship-enrichment', stamp);
  mkdirSync(backupDirectory, { recursive: true });
  const records = [];
  const paths = [
    ...OUTPUT_FILES.map((name) => path.join(outputDirectory, name)),
    artifactPath,
  ];
  for (const sourcePath of paths) {
    const existed = existsSync(sourcePath);
    const backupName = `${records.length.toString().padStart(2, '0')}-${path.basename(sourcePath)}`;
    const backupPath = path.join(backupDirectory, backupName);
    if (existed) copyFileSync(sourcePath, backupPath);
    records.push({ backupPath, existed, sourcePath });
  }
  writeFileSync(
    path.join(backupDirectory, 'manifest.json'),
    `${JSON.stringify({ schema_version: 1, files: records }, null, 2)}\n`,
    'utf8',
  );
  return { backupDirectory, records };
}

function restoreOutputs(backup) {
  for (const record of backup.records) {
    if (record.existed) {
      copyFileSync(record.backupPath, record.sourcePath);
    } else if (existsSync(record.sourcePath)) {
      rmSync(record.sourcePath, { force: true });
    }
  }
}

function replaceFileSafely(targetPath, content) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const temporaryPath = `${targetPath}.${nonce}.tmp`;
  const swapPath = `${targetPath}.${nonce}.swap`;
  writeFileSync(temporaryPath, content, 'utf8');
  try {
    if (existsSync(targetPath)) renameSync(targetPath, swapPath);
    renameSync(temporaryPath, targetPath);
    if (existsSync(swapPath)) rmSync(swapPath, { force: true });
  } catch (error) {
    if (!existsSync(targetPath) && existsSync(swapPath)) renameSync(swapPath, targetPath);
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function validatePostRegeneration(baseGraph, artifact, regeneratedGraph) {
  assertGraph(regeneratedGraph, 'regenerated graph');
  validatePreserved(baseGraph, regeneratedGraph);
  const nodeIds = new Set(regeneratedGraph.nodes.map((node) => node.id));
  const edgePairs = new Set(regeneratedGraph.links.map((edge) => edgeIdentity(edge, Boolean(regeneratedGraph.directed))));
  for (const node of artifact.nodes) {
    if (!nodeIds.has(node.id)) throw new Error(`Regeneration dropped managed node ${node.id}`);
  }
  for (const edge of artifact.links) {
    if (!edgePairs.has(edgeIdentity(edge, Boolean(regeneratedGraph.directed)))) {
      throw new Error(`Regeneration dropped managed edge ${edge.source} -> ${edge.target}`);
    }
  }
}

function parseArgs(argv) {
  const options = {
    apply: false,
    artifactPath: null,
    dryRun: false,
    graphPath: null,
    graphify: 'graphify',
    json: false,
    repoRoot: DEFAULT_REPO,
    vaultRoot: DEFAULT_VAULT,
  };
  const valueFlags = new Set(['--artifact', '--graph', '--graphify', '--repo', '--vault']);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') options.apply = true;
    else if (value === '--dry-run') options.dryRun = true;
    else if (value === '--json') options.json = true;
    else if (valueFlags.has(value)) {
      if (!argv[index + 1]) throw new Error(`${value} requires a value`);
      const next = argv[index + 1];
      index += 1;
      if (value === '--artifact') options.artifactPath = path.resolve(next);
      if (value === '--graph') options.graphPath = path.resolve(next);
      if (value === '--graphify') options.graphify = next;
      if (value === '--repo') options.repoRoot = path.resolve(next);
      if (value === '--vault') options.vaultRoot = path.resolve(next);
    } else if (value === '--help' || value === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!options.help && options.apply === options.dryRun) {
    throw new Error('Choose exactly one mode: --dry-run or --apply');
  }
  options.graphPath ??= path.join(options.vaultRoot, 'graphify-out', 'graph.json');
  options.artifactPath ??= path.join(options.vaultRoot, 'graphify-out', 'deterministic-relationships.json');
  return options;
}

function usage() {
  return [
    'Usage: node tools/gbrain/Enrich-ProjectRelationships.mjs (--dry-run|--apply) [--json]',
    '',
    '  --dry-run       Preview deterministic graph changes without writing files',
    '  --apply         Back up the graph, apply relationships, and regenerate Graphify outputs',
    '  --json          Emit exactly one machine-readable JSON summary',
    '  --repo PATH     Override repository root',
    '  --vault PATH    Override vault root',
    '  --graph PATH    Override graph.json path (must remain under vault/graphify-out)',
    '  --artifact PATH Override deterministic artifact path (same boundary)',
    '  --graphify CMD  Override the graphify executable used by --apply',
  ].join('\n');
}

function verifyPaths(options) {
  if (!existsSync(options.repoRoot) || !statSync(options.repoRoot).isDirectory()) {
    throw new Error(`Repository root does not exist: ${options.repoRoot}`);
  }
  if (!existsSync(options.vaultRoot) || !statSync(options.vaultRoot).isDirectory()) {
    throw new Error(`Vault root does not exist: ${options.vaultRoot}`);
  }
  const outputRoot = path.join(options.vaultRoot, 'graphify-out');
  if (!isWithin(outputRoot, options.graphPath) || !isWithin(outputRoot, options.artifactPath)) {
    throw new Error('Graph and artifact paths must remain beneath the selected vault/graphify-out directory');
  }
  if (!existsSync(options.graphPath) || !statSync(options.graphPath).isFile()) {
    throw new Error(`Graph does not exist: ${options.graphPath}`);
  }
}

export function makeSummary({ mode, originalGraph, candidateGraph, artifact, categories, backupPath = null, outputsRegenerated = false }) {
  const nextManaged = { nodes: artifact.nodes.length, edges: artifact.links.length };
  const directed = Boolean(originalGraph.directed);
  const priorManagedEdges = new Set(
    originalGraph.links
      .filter((edge) => edge.managed_by === MANAGED_BY)
      .map((edge) => edgeIdentity(edge, directed)),
  );
  const nextManagedEdges = new Set(artifact.links.map((edge) => edgeIdentity(edge, directed)));
  const addedEdges = [...nextManagedEdges].filter((edge) => !priorManagedEdges.has(edge)).length;
  const removedEdges = [...priorManagedEdges].filter((edge) => !nextManagedEdges.has(edge)).length;
  return {
    schema_version: 1,
    ok: true,
    mode,
    before: graphStats(originalGraph),
    after: graphStats(candidateGraph),
    edges_added: addedEdges,
    edges_removed: removedEdges,
    managed_nodes: nextManaged.nodes,
    managed_edges: nextManaged.edges,
    low_degree_reduction: graphStats(originalGraph).low_degree_nodes - graphStats(candidateGraph).low_degree_nodes,
    category_counts: categories,
    backup_path: backupPath,
    outputs_regenerated: outputsRegenerated,
  };
}

function printHumanSummary(summary, artifactPath) {
  const lines = [
    `Relationship enrichment ${summary.mode}: ${summary.before.nodes} -> ${summary.after.nodes} nodes; ${summary.before.edges} -> ${summary.after.edges} edges.`,
    `Nodes with degree <= 1: ${summary.before.low_degree_nodes} -> ${summary.after.low_degree_nodes} (${summary.low_degree_reduction} fewer).`,
    `Managed relationships: ${summary.managed_edges}; newly added this run: ${summary.edges_added}.`,
  ];
  if (summary.mode === 'apply') {
    lines.push(`Artifact: ${artifactPath}`);
    lines.push(`Backup: ${summary.backup_path}`);
    lines.push('Graphify community data, GRAPH_REPORT.md, and graph.html were regenerated.');
  } else {
    lines.push('Dry run only; no files were written.');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  verifyPaths(options);
  const lockPath = path.join(path.dirname(options.graphPath), '.relationship-enrichment.lock');
  let ownsLock = false;
  if (options.apply) {
    try {
      writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      ownsLock = true;
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Another relationship-enrichment apply appears active: ${lockPath}`);
      throw error;
    }
  }

  try {
    const originalGraph = JSON.parse(readFileSync(options.graphPath, 'utf8'));
    let result;
    let finalGraph;
    let backup = null;
    let outputsRegenerated = false;
    if (options.apply) {
      backup = backupOutputs(options.graphPath, options.artifactPath);
      try {
        const sourceGraph = JSON.parse(readFileSync(options.graphPath, 'utf8'));
        result = buildEnrichedGraph({
          graph: sourceGraph,
          repoRoot: options.repoRoot,
          vaultRoot: options.vaultRoot,
        });
        assertRelationshipQualityNotRegressed(originalGraph, result.candidateGraph);
        replaceFileSafely(options.graphPath, `${JSON.stringify(result.candidateGraph, null, 2)}\n`);
        replaceFileSafely(options.artifactPath, `${JSON.stringify(result.artifact, null, 2)}\n`);
        const regeneration = spawnSync(options.graphify, ['cluster-only', options.vaultRoot], {
          cwd: options.repoRoot,
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          shell: false,
          windowsHide: true,
        });
        if (regeneration.error || regeneration.status !== 0) {
          const detail = regeneration.error?.message || regeneration.stderr?.trim() || regeneration.stdout?.trim() || `exit ${regeneration.status}`;
          throw new Error(`Graphify output regeneration failed: ${detail}`);
        }
        finalGraph = JSON.parse(readFileSync(options.graphPath, 'utf8'));
        validatePostRegeneration(result.baseGraph, result.artifact, finalGraph);
        assertRelationshipQualityNotRegressed(originalGraph, finalGraph);
        outputsRegenerated = true;
      } catch (error) {
        restoreOutputs(backup);
        throw new Error(`${error.message}. Original visible Graphify outputs were restored from ${backup.backupDirectory}`);
      }
    } else {
      result = buildEnrichedGraph({
        graph: originalGraph,
        repoRoot: options.repoRoot,
        vaultRoot: options.vaultRoot,
      });
      finalGraph = result.candidateGraph;
    }

    const summary = makeSummary({
      mode: options.apply ? 'apply' : 'dry-run',
      originalGraph,
      candidateGraph: finalGraph,
      artifact: result.artifact,
      categories: result.categories,
      backupPath: backup?.backupDirectory ?? null,
      outputsRegenerated,
    });
    summary.artifact_path = options.artifactPath;
    summary.graph_path = options.graphPath;
    if (options.json) process.stdout.write(`${JSON.stringify(summary)}\n`);
    else printHumanSummary(summary, options.artifactPath);
    return 0;
  } finally {
    if (ownsLock && existsSync(lockPath)) rmSync(lockPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = run();
  } catch (error) {
    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify({ schema_version: 1, ok: false, error: error.message })}\n`);
    } else {
      process.stderr.write(`Relationship enrichment failed: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}
