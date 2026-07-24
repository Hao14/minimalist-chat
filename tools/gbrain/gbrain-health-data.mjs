import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_MIRROR_FILES = 5_000;
const MAX_MIRROR_FILE_BYTES = 64 * 1024 * 1024;
const MAX_VISION_ASSET_BYTES = 16 * 1024 * 1024;
const V3_EVALUATION_THRESHOLDS = Object.freeze({
  hit_at_3_rate: 0.8,
  mean_recall_at_k: 0.85,
  mean_reciprocal_rank: 0.72,
  mean_ndcg_at_10: 0.75,
  expected_top1_hit_rate: 0.6,
  source_scope_pass_rate: 1,
  negative_check_pass_rate: 0.85,
});
const REQUIRED_MAINTENANCE_STEPS = Object.freeze([
  'backup',
  'restore_drill',
  'note_refresh',
  'code_refresh',
  'evaluation',
  'relationships',
  'vision',
]);
const VISION_EVIDENCE_CLASSES = new Set([
  'actual_qa_capture',
  'design_concept',
  'implementation_design_render',
  'final_render',
  'unknown',
]);
const execFileAsync = promisify(execFile);

async function readJsonIfPresent(filePath) {
  try {
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return null;
    }
    if (stat.size > MAX_JSON_BYTES) {
      throw new Error(`Health input is too large: ${filePath}`);
    }
    const text = await readFile(filePath, 'utf8');
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function decodeBase64JsonComment(text, pattern) {
  const match = pattern.exec(text ?? '');
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function validVisionAnalysis(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.schema_version === 1
    && typeof value.title === 'string'
    && value.title.trim()
    && typeof value.summary === 'string'
    && value.summary.trim()
    && Array.isArray(value.visible_text)
    && value.visible_text.every((item) => typeof item === 'string')
    && Array.isArray(value.ui_elements)
    && value.ui_elements.length > 0
    && value.ui_elements.every((item) => typeof item === 'string' && item.trim())
    && Array.isArray(value.notable_details)
    && value.notable_details.length > 0
    && value.notable_details.every((item) => typeof item === 'string' && item.trim())
    && Array.isArray(value.uncertainty)
    && value.uncertainty.every((item) => typeof item === 'string')
    && VISION_EVIDENCE_CLASSES.has(value.evidence_class)
  );
}

async function readVisionInventory(indexPath, repoRoot) {
  try {
    const text = await readTextIfPresent(indexPath, 512 * 1024);
    const metadata = decodeBase64JsonComment(
      text,
      /<!-- gbrain-timeline-vision-meta ([A-Za-z0-9_-]+) -->/,
    );
    if (
      metadata?.schema_version !== 1
      || metadata?.image_count !== 6
      || !Array.isArray(metadata.entries)
      || metadata.entries.length !== metadata.image_count
      || typeof metadata.model !== 'string'
      || !metadata.model.trim()
      || !/^[0-9a-f]{64}$/i.test(String(metadata.model_digest ?? ''))
    ) return { ready: false, count: 0, model: null };
    const seen = new Set();
    for (const entry of metadata.entries) {
      const note = safeRelativeManifestPath(entry?.note);
      const sourceImage = safeRelativeManifestPath(entry?.source_image);
      if (
        !note
        || !note.startsWith('90 Memory/Timeline Vision/')
        || !note.endsWith('.vision.md')
        || seen.has(note)
        || !sourceImage
        || !sourceImage.startsWith('90 Memory/assets/project-timeline/')
        || !/\.(?:jpe?g|png|webp)$/i.test(sourceImage)
        || !/^[0-9a-f]{64}$/i.test(String(entry?.asset_sha256 ?? ''))
      ) {
        return { ready: false, count: 0, model: null };
      }
      seen.add(note);
      const target = path.resolve(repoRoot, 'Minimalist-chat-vault', ...note.split('/'));
      const boundary = path.resolve(repoRoot, 'Minimalist-chat-vault', '90 Memory', 'Timeline Vision');
      const containment = path.relative(boundary, target);
      if (containment.startsWith('..') || path.isAbsolute(containment)) return { ready: false, count: 0, model: null };
      const sidecar = await readTextIfPresent(target, 512 * 1024);
      const sidecarMetadata = decodeBase64JsonComment(
        sidecar,
        /<!-- gbrain-timeline-vision-meta ([A-Za-z0-9_-]+) -->/,
      );
      const analysis = decodeBase64JsonComment(
        sidecar,
        /<!-- gbrain-timeline-vision-analysis ([A-Za-z0-9_-]+) -->/,
      );
      if (
        sidecarMetadata?.schema_version !== 1
        || sidecarMetadata?.prompt_version !== 1
        || sidecarMetadata?.vision_capability_verified !== true
        || sidecarMetadata?.model !== metadata.model
        || sidecarMetadata?.model_digest !== metadata.model_digest
        || sidecarMetadata?.source_image !== sourceImage
        || sidecarMetadata?.asset_sha256 !== entry.asset_sha256
        || !validVisionAnalysis(analysis)
        || entry?.title !== analysis.title
        || entry?.evidence_class !== analysis.evidence_class
      ) {
        return { ready: false, count: 0, model: null };
      }
      const assetTarget = path.resolve(repoRoot, 'Minimalist-chat-vault', ...sourceImage.split('/'));
      const assetBoundary = path.resolve(repoRoot, 'Minimalist-chat-vault', '90 Memory', 'assets', 'project-timeline');
      const assetContainment = path.relative(assetBoundary, assetTarget);
      if (assetContainment.startsWith('..') || path.isAbsolute(assetContainment)) {
        return { ready: false, count: 0, model: null };
      }
      const assetStat = await lstat(assetTarget);
      if (!assetStat.isFile() || assetStat.isSymbolicLink() || assetStat.size > MAX_VISION_ASSET_BYTES) {
        return { ready: false, count: 0, model: null };
      }
      const assetDigest = createHash('sha256').update(await readFile(assetTarget)).digest('hex');
      if (assetDigest !== entry.asset_sha256) return { ready: false, count: 0, model: null };
    }
    return { ready: true, count: metadata.image_count, model: metadata.model };
  } catch {
    return { ready: false, count: 0, model: null };
  }
}

async function readTextIfPresent(filePath, maxBytes = MAX_CONFIG_BYTES) {
  try {
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return null;
    }
    if (stat.size > maxBytes) {
      throw new Error(`Health input is too large: ${filePath}`);
    }
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function parseTomlString(token) {
  const value = token.trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

function parseTomlStringArray(token) {
  const values = [];
  const body = token.trim();
  if (!body.startsWith('[') || !body.endsWith(']')) {
    return null;
  }
  const inner = body.slice(1, -1);
  const stringTokens = inner.match(/"(?:\\.|[^"\\])*"|'[^']*'/g) ?? [];
  const remainder = inner.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '').replace(/,/g, '').trim();
  if (remainder) {
    return null;
  }
  for (const stringToken of stringTokens) {
    const value = parseTomlString(stringToken);
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

function getMcpRegistration(configText, proxyPath) {
  if (!configText) {
    return { mode: 'missing', ready: false };
  }
  const lines = configText.replace(/^\uFEFF/, '').split(/\r?\n/);
  let inSection = false;
  let command = null;
  let args = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      if (inSection) break;
      inSection = trimmed === '[mcp_servers.gbrain]';
      continue;
    }
    if (!inSection || !trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(command|args)\s*=\s*(.+)$/);
    if (!match) continue;
    if (match[1] === 'command') command = parseTomlString(match[2]);
    if (match[1] === 'args') args = parseTomlStringArray(match[2]);
  }
  if (!inSection || !command || !Array.isArray(args)) {
    return { mode: inSection ? 'unexpected' : 'missing', ready: false };
  }

  const executable = path.win32.basename(command).toLowerCase();
  const expectedProxy = path.resolve(proxyPath).toLowerCase();
  if (
    (executable === 'node' || executable === 'node.exe')
    && args.length === 1
    && path.resolve(args[0]).toLowerCase() === expectedProxy
  ) {
    return { mode: 'authority-proxy', ready: true };
  }
  if (
    (executable === 'gbrain' || executable === 'gbrain.exe')
    && args.length === 1
    && args[0] === 'serve'
  ) {
    return { mode: 'legacy', ready: false };
  }
  return { mode: 'unexpected', ready: false };
}

function safeRelativeManifestPath(value) {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value)) return null;
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return normalized;
}

function normalizedAbsolutePath(value) {
  const normalized = path.resolve(String(value ?? '')).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function readOwnedMirrorInventory(rootPath, { expectedKind, expectedSourceRoot }) {
  try {
    const manifest = await readJsonIfPresent(path.join(rootPath, '.gbrain-meta', 'manifest.json'));
    if (
      manifest?.schema_version !== 1
      || !Array.isArray(manifest.files)
      || !manifest.file_sha256
      || typeof manifest.file_sha256 !== 'object'
      || Array.isArray(manifest.file_sha256)
      || manifest.files.length > MAX_MIRROR_FILES
      || Number(manifest.file_count) !== manifest.files.length
      || manifest.mirror_kind !== expectedKind
      || normalizedAbsolutePath(manifest.source_root) !== normalizedAbsolutePath(expectedSourceRoot)
    ) return { count: null, verified: false, generated_at: null };
    const hashKeys = Object.keys(manifest.file_sha256);
    if (hashKeys.length !== manifest.files.length) {
      return { count: null, verified: false, generated_at: null };
    }
    const declared = new Set();
    const sourceBoundary = path.resolve(expectedSourceRoot);
    for (const value of manifest.files) {
      const relativePath = safeRelativeManifestPath(value);
      if (!relativePath || declared.has(relativePath)) return { count: null, verified: false, generated_at: null };
      declared.add(relativePath);
      if (!Object.prototype.hasOwnProperty.call(manifest.file_sha256, relativePath)) {
        return { count: null, verified: false, generated_at: null };
      }
      const expectedHash = manifest.file_sha256[relativePath];
      if (!/^[0-9a-f]{64}$/.test(String(expectedHash ?? ''))) {
        return { count: null, verified: false, generated_at: null };
      }
      const candidate = path.resolve(rootPath, ...relativePath.split('/'));
      const containment = path.relative(path.resolve(rootPath), candidate);
      if (containment.startsWith('..') || path.isAbsolute(containment)) {
        return { count: null, verified: false, generated_at: null };
      }
      const info = await lstat(candidate);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MIRROR_FILE_BYTES) {
        return { count: null, verified: false, generated_at: null };
      }
      const mirrorHash = createHash('sha256').update(await readFile(candidate)).digest('hex');
      if (mirrorHash !== expectedHash) return { count: null, verified: false, generated_at: null };

      const sourceCandidate = path.resolve(sourceBoundary, ...relativePath.split('/'));
      const sourceContainment = path.relative(sourceBoundary, sourceCandidate);
      if (sourceContainment.startsWith('..') || path.isAbsolute(sourceContainment)) {
        return { count: null, verified: false, generated_at: null };
      }
      const sourceInfo = await lstat(sourceCandidate);
      if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size > MAX_MIRROR_FILE_BYTES) {
        return { count: null, verified: false, generated_at: null };
      }
      const sourceHash = createHash('sha256').update(await readFile(sourceCandidate)).digest('hex');
      if (sourceHash !== expectedHash) return { count: null, verified: false, generated_at: null };
    }
    if (hashKeys.some((value) => !declared.has(value))) {
      return { count: null, verified: false, generated_at: null };
    }
    const discovered = new Set();
    const queue = [path.resolve(rootPath)];
    while (queue.length > 0) {
      const directory = queue.shift();
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === '.gbrain-meta' || entry.name === '.gitignore') continue;
        if (entry.isSymbolicLink()) return { count: null, verified: false, generated_at: null };
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) queue.push(target);
        else if (entry.isFile()) {
          discovered.add(path.relative(rootPath, target).replaceAll('\\', '/'));
          if (discovered.size > MAX_MIRROR_FILES) return { count: null, verified: false, generated_at: null };
        }
      }
    }
    if (declared.size !== discovered.size || [...declared].some((item) => !discovered.has(item))) {
      return { count: null, verified: false, generated_at: null };
    }
    return {
      count: manifest.files.length,
      verified: true,
      generated_at: manifest.generated_at ?? null,
      mirror_kind: manifest.mirror_kind ?? null,
    };
  } catch {
    return { count: null, verified: false, generated_at: null };
  }
}

export async function probeLiveSchedule({ repoRoot }) {
  if (process.platform !== 'win32') {
    return { installed: false, live_verified: false, reason: 'unsupported_platform' };
  }
  const installer = path.join(repoRoot, 'tools', 'gbrain', 'Install-GBrainMaintenanceTask.ps1');
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', installer,
      '-Verify',
    ], {
      encoding: 'utf8',
      timeout: 8_000,
      windowsHide: true,
      maxBuffer: 128 * 1024,
    });
    return JSON.parse(stdout.replace(/^\uFEFF/, ''));
  } catch {
    return { installed: false, live_verified: false, reason: 'probe_failed' };
  }
}

function summarizeGraph(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const links = Array.isArray(graph?.links)
    ? graph.links
    : Array.isArray(graph?.edges)
      ? graph.edges
      : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const degrees = new Map(nodes.map((node) => [node.id, 0]));
  let missingEndpoints = 0;
  let selfLoops = 0;
  let duplicateEdges = 0;
  const edgeKeys = new Set();

  for (const link of links) {
    const source = typeof link.source === 'object' ? link.source?.id : link.source;
    const target = typeof link.target === 'object' ? link.target?.id : link.target;
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      missingEndpoints += 1;
      continue;
    }
    if (source === target) {
      selfLoops += 1;
    }
    degrees.set(source, (degrees.get(source) ?? 0) + 1);
    degrees.set(target, (degrees.get(target) ?? 0) + 1);
    const pair = source < target ? `${source}\u0000${target}` : `${target}\u0000${source}`;
    if (edgeKeys.has(pair)) {
      duplicateEdges += 1;
    }
    edgeKeys.add(pair);
  }

  let weakNodes = 0;
  let isolatedNodes = 0;
  for (const degree of degrees.values()) {
    if (degree <= 1) weakNodes += 1;
    if (degree === 0) isolatedNodes += 1;
  }

  const valid = nodes.length > 0
    && missingEndpoints === 0
    && selfLoops === 0
    && duplicateEdges === 0;
  const weakNodeLimit = Math.max(2, Math.ceil(nodes.length * 0.1));
  return {
    nodes: nodes.length,
    relationships: links.length,
    weak_nodes: weakNodes,
    isolated_nodes: isolatedNodes,
    missing_endpoint_edges: missingEndpoints,
    self_loops: selfLoops,
    duplicate_endpoint_pairs: duplicateEdges,
    valid,
    weak_node_limit: weakNodeLimit,
    quality_passed: valid && isolatedNodes === 0 && weakNodes <= weakNodeLimit,
  };
}

function getEvaluationSummary(evaluation, expectedQrelsPath) {
  const summary = evaluation?.summary ?? evaluation ?? {};
  const metricValues = Object.fromEntries(
    Object.keys(V3_EVALUATION_THRESHOLDS).map((name) => [name, Number(summary[name])]),
  );
  const unitMetricsValid = Object.values(metricValues).every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );
  const thresholdKeys = Object.keys(evaluation?.gate?.thresholds ?? {}).sort();
  const expectedThresholdKeys = Object.keys(V3_EVALUATION_THRESHOLDS).sort();
  const exactThresholds = thresholdKeys.length === expectedThresholdKeys.length
    && thresholdKeys.every((key, index) => (
      key === expectedThresholdKeys[index]
      && evaluation.gate.thresholds[key] === V3_EVALUATION_THRESHOLDS[key]
    ));
  const metricsPass = unitMetricsValid && Object.entries(V3_EVALUATION_THRESHOLDS)
    .every(([name, minimum]) => metricValues[name] >= minimum);
  const exactQrelsPath = typeof evaluation?.qrels_path === 'string'
    && normalizedAbsolutePath(evaluation.qrels_path) === normalizedAbsolutePath(expectedQrelsPath);
  const contractValid = evaluation?.schema_version === 2
    && evaluation?.qrels_schema_version === 2
    && exactQrelsPath
    && Number(summary.cases) === 100
    && evaluation?.gate?.requested === true
    && evaluation?.gate?.passed === true
    && Array.isArray(evaluation?.gate?.failures)
    && evaluation.gate.failures.length === 0
    && exactThresholds
    && metricsPass;

  return {
    cases: Number(summary.cases ?? 0),
    hit_at_3: Number(summary.hit_at_3_rate ?? 0),
    recall_at_10: Number(summary.mean_recall_at_k ?? 0),
    mrr: Number(summary.mean_reciprocal_rank ?? 0),
    ndcg_at_10: Number(summary.mean_ndcg_at_10 ?? 0),
    expected_top1_hit_rate: Number(summary.expected_top1_hit_rate ?? 0),
    p95_latency_ms: Number(summary.p95_latency_ms ?? 0),
    source_scope_pass_rate: Number(summary.source_scope_pass_rate ?? 0),
    negative_check_pass_rate: Number(summary.negative_check_pass_rate ?? 0),
    gate_passed: contractValid,
    contract_valid: contractValid,
    generated_at: evaluation?.generated_at ?? evaluation?.finished_at ?? null,
    qrels_path: evaluation?.qrels_path ?? null,
    qrels_schema_version: Number(evaluation?.qrels_schema_version ?? 0),
  };
}

function maintenanceSteps({
  maintenance,
  evaluation,
  graph,
  mirrorsReady,
  mcpReady,
  schedule,
}) {
  const finishedAt = maintenance?.finished_at ?? null;
  const backup = maintenance?.backup ?? {};
  const performed = maintenance?.steps_performed ?? {};
  return [
    {
      id: 'backup',
      label: 'Backup verified',
      passed: performed.backup === true && Boolean(backup.verified),
      detail: performed.backup === true && backup.verified ? 'Local snapshot inventory matched' : 'No verified snapshot in latest run',
      performed_at: finishedAt,
    },
    {
      id: 'restore',
      label: 'Restore drill passed',
      passed: performed.restore_drill === true && Boolean(backup.restore_drill_passed),
      detail: performed.restore_drill !== true
        ? 'Skipped in latest run'
        : backup.restore_drill_passed ? 'Disposable database opened and answered a probe' : 'Restore drill has not passed',
      performed_at: finishedAt,
    },
    {
      id: 'sources',
      label: 'Sources refreshed',
      passed: Boolean(maintenance?.success)
        && performed.note_refresh === true
        && performed.code_refresh === true
        && mirrorsReady,
      detail: performed.note_refresh !== true || performed.code_refresh !== true
        ? 'Code refresh was skipped in latest run'
        : mirrorsReady ? 'Owned note and code manifests match local mirror inventories' : 'Source mirror ownership could not be verified',
      performed_at: finishedAt,
    },
    {
      id: 'evaluation',
      label: 'Evaluation passed',
      passed: evaluation.ready,
      detail: performed.evaluation === false
        ? 'Evaluation was skipped in latest run'
        : evaluation.ready ? `${evaluation.cases} source-aware checks stayed above gate` : 'V3 evaluation is stale, incomplete, or below gate',
      performed_at: evaluation.generated_at ?? finishedAt,
    },
    {
      id: 'graph',
      label: 'Graph validated',
      passed: performed.relationships === true && graph.quality_passed && graph.relationship_aligned,
      detail: performed.relationships === true && graph.quality_passed && graph.relationship_aligned
        ? 'Integrity, weak-node quality, and latest relationship evidence agree'
        : 'Graph integrity, relationship alignment, or weak-node quality needs review',
      performed_at: finishedAt,
    },
    {
      id: 'mcp',
      label: 'MCP restored',
      passed: Boolean(maintenance?.mcp_restored) && mcpReady,
      detail: maintenance?.mcp_restored && mcpReady ? 'Authority-aware local stdio proxy is registered' : 'Authority-aware MCP restoration is not verified',
      performed_at: finishedAt,
    },
    {
      id: 'schedule',
      label: 'Schedule verified',
      passed: Boolean(schedule?.installed && schedule?.live_verified),
      detail: schedule?.installed && schedule?.live_verified
        ? `${schedule.day_of_week} at ${schedule.at}; owned task contract verified live`
        : 'Owned weekly maintenance task is not live-verified',
      performed_at: schedule?.checked_at ?? null,
    },
  ];
}

export async function buildHealthSnapshot({
  repoRoot,
  userProfile,
  now = new Date(),
  scheduleProbe = probeLiveSchedule,
} = {}) {
  if (!repoRoot || !userProfile) {
    throw new Error('repoRoot and userProfile are required');
  }

  const gbrainHome = path.join(userProfile, '.gbrain');
  const maintenancePath = path.join(gbrainHome, 'maintenance', 'minimalist-chat-latest.json');
  const evaluationPath = path.join(gbrainHome, 'evals', 'minimalist-chat-latest.json');
  const packTrialPath = path.join(gbrainHome, 'evals', 'minimalist-chat-pack-v2-trial.json');
  const schedulePath = path.join(gbrainHome, 'maintenance', 'minimalist-chat-schedule.json');
  const graphPath = path.join(repoRoot, 'Minimalist-chat-vault', 'graphify-out', 'graph.json');
  const visionIndexPath = path.join(repoRoot, 'Minimalist-chat-vault', '90 Memory', 'Timeline Vision', 'Index.md');
  const gbrainConfigPath = path.join(gbrainHome, 'config.json');
  const nativeMcpPath = path.join(repoRoot, 'tools', 'gbrain', 'gbrain-authority-mcp-proxy.mjs');
  const codexConfigPath = path.join(userProfile, '.codex', 'config.toml');
  const noteMirror = path.join(gbrainHome, 'sources', 'minimalist-chat-vault');
  const codeMirror = path.join(gbrainHome, 'sources', 'minimalist-chat-code');

  const [
    maintenance,
    evaluationRaw,
    graphRaw,
    packTrial,
    scheduleRecord,
    scheduleLive,
    visionInventory,
    gbrainConfig,
    nativeMcpFileReady,
    codexConfig,
    noteInventory,
    codeInventory,
  ] = await Promise.all([
    readJsonIfPresent(maintenancePath),
    readJsonIfPresent(evaluationPath),
    readJsonIfPresent(graphPath),
    readJsonIfPresent(packTrialPath),
    readJsonIfPresent(schedulePath),
    scheduleProbe({ repoRoot, userProfile }),
    readVisionInventory(visionIndexPath, repoRoot),
    readJsonIfPresent(gbrainConfigPath),
    pathExists(nativeMcpPath),
    readTextIfPresent(codexConfigPath),
    readOwnedMirrorInventory(noteMirror, {
      expectedKind: 'minimalist-chat-vault',
      expectedSourceRoot: path.join(repoRoot, 'Minimalist-chat-vault'),
    }),
    readOwnedMirrorInventory(codeMirror, {
      expectedKind: 'minimalist-chat-code',
      expectedSourceRoot: repoRoot,
    }),
  ]);

  const expectedQrelsPath = path.join(repoRoot, 'gbrain-evals', 'qrels', 'minimalist-chat-v3.qrels.json');
  const evaluation = getEvaluationSummary(evaluationRaw, expectedQrelsPath);
  const graph = summarizeGraph(graphRaw);
  const mcpRegistration = nativeMcpFileReady
    ? getMcpRegistration(codexConfig, nativeMcpPath)
    : { mode: 'implementation-missing', ready: false };
  const staleAfterMs = 14 * 24 * 60 * 60 * 1000;
  const finishedAtMs = Date.parse(maintenance?.finished_at ?? '');
  const stale = !Number.isFinite(finishedAtMs) || now.getTime() - finishedAtMs > staleAfterMs;
  const maintenanceStartedAtMs = Date.parse(maintenance?.started_at ?? '');
  const evaluationGeneratedAtMs = Date.parse(evaluation.generated_at ?? '');
  const evaluationFresh = Number.isFinite(maintenanceStartedAtMs)
    && Number.isFinite(evaluationGeneratedAtMs)
    && evaluationGeneratedAtMs >= maintenanceStartedAtMs;
  const isV3Evaluation = evaluation.contract_valid;
  evaluation.fresh_for_latest_maintenance = evaluationFresh;
  evaluation.v3_complete = isV3Evaluation;
  evaluation.ready = evaluation.gate_passed
    && evaluationFresh
    && isV3Evaluation
    && maintenance?.steps_performed?.evaluation === true;

  const relationships = maintenance?.relationships;
  graph.relationship_aligned = Boolean(
    relationships?.ok
    && relationships?.outputs_regenerated
    && Number(relationships?.after?.nodes) === graph.nodes
    && Number(relationships?.after?.edges) === graph.relationships
    && Number(relationships?.after?.zero_degree_nodes) === graph.isolated_nodes
    && Number(relationships?.low_degree_reduction) >= 0,
  );
  const mirrorsReady = noteInventory.verified && codeInventory.verified;
  const schedule = {
    ...(scheduleRecord ?? {}),
    ...scheduleLive,
    recorded: Boolean(scheduleRecord?.installed),
  };
  const packAccepted = packTrial?.success === true
    && packTrial?.status === 'accepted'
    && packTrial?.decision?.accepted === true
    && packTrial?.pack?.verification?.active === true
    && packTrial?.safety?.active_config_unchanged === true
    && packTrial?.safety?.endpoint_contract_verified === true
    && packTrial?.safety?.protected_ollama_port_absent_from_configuration === true
    && packTrial?.safety?.ollama_endpoint === 'http://127.0.0.1:11434/v1'
    && gbrainConfig?.schema_pack === 'gbrain-base-v2';
  const endpointPinned = gbrainConfig?.provider_base_urls?.ollama === 'http://127.0.0.1:11434/v1';
  const backupReady = Boolean(maintenance?.backup?.verified && maintenance?.backup?.restore_drill_passed);
  const fullMaintenance = REQUIRED_MAINTENANCE_STEPS.every(
    (step) => maintenance?.steps_performed?.[step] === true,
  );
  const steps = maintenanceSteps({
    maintenance,
    evaluation,
    graph,
    mirrorsReady,
    mcpReady: mcpRegistration.ready,
    schedule,
  });
  const healthy = Boolean(maintenance?.success)
    && Boolean(maintenance?.mcp_restored)
    && backupReady
    && fullMaintenance
    && evaluation.ready
    && graph.quality_passed
    && graph.relationship_aligned
    && mcpRegistration.ready
    && mirrorsReady
    && visionInventory.ready
    && packAccepted
    && endpointPinned
    && schedule.installed
    && schedule.live_verified
    && !stale;

  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    status: healthy ? 'healthy' : stale ? 'stale' : 'attention',
    local_only: true,
    metrics: {
      pages: Number(maintenance?.refresh_metrics?.pages ?? maintenance?.backup?.page_count ?? 0),
      embedded_chunks: Number(maintenance?.refresh_metrics?.embedded ?? maintenance?.backup?.embedded_count ?? 0),
      hit_at_3: evaluation.hit_at_3,
      p95_latency_ms: evaluation.p95_latency_ms,
      graph_nodes: graph.nodes,
      graph_relationships: graph.relationships,
    },
    evaluation,
    sources: [
      { id: 'notes', label: 'Curated notes', count: noteInventory.count, scope: 'federated', verified: noteInventory.verified },
      { id: 'code', label: 'Authored code', count: codeInventory.count, scope: 'explicit only', verified: codeInventory.verified },
    ],
    graph,
    maintenance: {
      success: Boolean(maintenance?.success),
      started_at: maintenance?.started_at ?? null,
      finished_at: maintenance?.finished_at ?? null,
      stale,
      steps,
    },
    attention: [
      {
        id: 'native-authority',
        label: 'Native authority path',
        status: mcpRegistration.ready ? 'ready' : 'pending',
        detail: mcpRegistration.mode,
      },
      {
        id: 'timeline-vision',
        label: 'Timeline vision',
        status: visionInventory.ready ? 'ready' : 'pending',
        detail: visionInventory.ready ? `${visionInventory.count} owned local vision notes` : 'Vision inventory is incomplete or unverified',
      },
      {
        id: 'pack-v2',
        label: 'Pack v2 trial',
        status: packAccepted ? 'passed' : packTrial ? 'review' : 'pending',
      },
      {
        id: 'ollama-pin',
        label: 'Ollama endpoint pin',
        status: endpointPinned ? 'ready' : 'pending',
        detail: endpointPinned ? 'Tray endpoint 127.0.0.1:11434 only' : 'GBrain endpoint is not pinned safely',
      },
    ],
    schedule,
  };
}

export const __test = {
  getEvaluationSummary,
  getMcpRegistration,
  readOwnedMirrorInventory,
  summarizeGraph,
};
