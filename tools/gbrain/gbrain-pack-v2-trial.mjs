#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOURCE_PROVENANCE_METHOD } from './gbrain-source-provenance.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..', '..');
const SNAPSHOT_NAME = /^gbrain-pglite-\d{8}T\d{9}Z-[0-9a-f]{8}$/;
const WORKSPACE_NAME = /^gbrain-pack-v2-trial-[A-Za-z0-9._-]+$/;
const BASELINE_PACK = 'gbrain-base';
const TARGET_PACK = 'gbrain-base-v2';
const SAFE_OLLAMA_URL = 'http://127.0.0.1:11434/v1';
const PROTECTED_OLLAMA_PORT = '11435';
const MAX_SOURCE_CATALOG_FILES = 50_000;
const MAX_SOURCE_FILE_BYTES = 64 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MIRROR_KIND_BY_SOURCE_KIND = {
  markdown: 'minimalist-chat-vault',
  code: 'minimalist-chat-code',
};
const ACTIVE_DATABASE_RUNTIME_PATHS = Object.freeze([
  '.gbrain-lock',
  '.gbrain-resolve.sock',
  'postmaster.pid',
]);

const QUALITY_METRICS = [
  ['hit_at_3_rate', 0],
  ['mean_recall_at_k', 0],
  ['mean_reciprocal_rank', 0.01],
  ['mean_ndcg_at_10', 0.01],
  ['expected_top1_hit_rate', 0],
  ['source_scope_pass_rate', 0],
  ['negative_check_pass_rate', 0],
];

function normalizedPath(value) {
  const full = resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

export function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

export function isDirectChild(parent, child) {
  return samePath(dirname(resolve(child)), resolve(parent));
}

export function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep);
}

function assertNormalDirectory(directory, label) {
  if (!existsSync(directory)) throw new Error(`${label} is missing: ${directory}`);
  const item = lstatSync(directory);
  if (!item.isDirectory() || item.isSymbolicLink()) {
    throw new Error(`${label} must be a normal directory, not a file or symlink: ${directory}`);
  }
}

function assertNormalFile(file, label) {
  if (!existsSync(file)) throw new Error(`${label} is missing: ${file}`);
  const item = lstatSync(file);
  if (!item.isFile() || item.isSymbolicLink()) {
    throw new Error(`${label} must be a normal file, not a directory or symlink: ${file}`);
  }
}

function readJson(file, label) {
  assertNormalFile(file, label);
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${file} (${error.message})`);
  }
}

export function sha256File(file) {
  const hash = createHash('sha256');
  hash.update(readFileSync(file));
  return hash.digest('hex');
}

function listSafeFiles(root, excludedRelativePaths = new Set()) {
  assertNormalDirectory(root, 'Tree root');
  const rootReal = realpathSync(root);
  const output = [];
  const pending = [rootReal];
  while (pending.length) {
    const directory = pending.pop();
    for (const name of readdirSync(directory)) {
      const itemPath = join(directory, name);
      const itemRelativePath = relative(rootReal, itemPath).split(sep).join('/');
      if (excludedRelativePaths.has(itemRelativePath)) continue;
      const item = lstatSync(itemPath);
      if (item.isSymbolicLink()) throw new Error(`Refusing a symlink in database tree: ${itemPath}`);
      if (item.isDirectory()) pending.push(itemPath);
      else if (item.isFile()) output.push(itemPath);
      else throw new Error(`Refusing a non-file entry in database tree: ${itemPath}`);
    }
  }
  return output.sort((left, right) => left.localeCompare(right));
}

export function inventoryTree(root, { excludeRelativePaths = [] } = {}) {
  const rootFull = resolve(root);
  const excluded = new Set(excludeRelativePaths.map((value) => {
    const normalized = String(value).replaceAll('\\', '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '..')) {
      throw new Error(`Unsafe database inventory exclusion: ${value}`);
    }
    return normalized;
  }));
  const files = listSafeFiles(rootFull, excluded).map((file) => {
    const relativePath = relative(rootFull, file).split(sep).join('/');
    if (!relativePath || relativePath.includes('\0') || relativePath.split('/').includes('..')) {
      throw new Error(`Unsafe relative path in database tree: ${relativePath}`);
    }
    return {
      relative_path: relativePath,
      length_bytes: statSync(file).size,
      sha256: sha256File(file),
    };
  });
  let totalBytes = 0;
  const aggregate = createHash('sha256');
  for (const entry of files) {
    totalBytes += entry.length_bytes;
    aggregate.update(`${entry.sha256}\t${entry.length_bytes}\t${entry.relative_path}\n`, 'utf8');
  }
  return {
    files,
    file_count: files.length,
    total_bytes: totalBytes,
    inventory_sha256: aggregate.digest('hex'),
  };
}

function compareInventory(actual, expected, label) {
  if (
    actual.file_count !== Number(expected.file_count)
    || actual.total_bytes !== Number(expected.total_bytes)
    || actual.inventory_sha256 !== String(expected.inventory_sha256).toLowerCase()
  ) {
    throw new Error(`${label} aggregate inventory does not match its verified manifest.`);
  }
  if (!Array.isArray(expected.files) || expected.files.length !== actual.files.length) {
    throw new Error(`${label} manifest has an incomplete file inventory.`);
  }
  for (let index = 0; index < actual.files.length; index += 1) {
    const left = actual.files[index];
    const right = expected.files[index];
    if (
      left.relative_path !== right.relative_path
      || left.length_bytes !== Number(right.length_bytes)
      || left.sha256 !== String(right.sha256).toLowerCase()
    ) {
      throw new Error(`${label} file inventory mismatch at ${left.relative_path}.`);
    }
  }
}

function copySafeTree(source, destination, allowedRoot) {
  const sourceFull = resolve(source);
  const destinationFull = resolve(destination);
  assertNormalDirectory(sourceFull, 'Snapshot database');
  if (existsSync(destinationFull)) throw new Error(`Isolated database destination already exists: ${destinationFull}`);
  if (!isWithin(allowedRoot, destinationFull)) throw new Error('Isolated database destination escaped its workspace.');
  mkdirSync(destinationFull, { recursive: false });
  const pending = [[sourceFull, destinationFull]];
  while (pending.length) {
    const [fromDirectory, toDirectory] = pending.pop();
    for (const name of readdirSync(fromDirectory)) {
      const from = join(fromDirectory, name);
      const to = join(toDirectory, name);
      const item = lstatSync(from);
      if (item.isSymbolicLink()) throw new Error(`Refusing a symlink while cloning snapshot: ${from}`);
      if (item.isDirectory()) {
        mkdirSync(to);
        pending.push([from, to]);
      } else if (item.isFile()) {
        copyFileSync(from, to, 0);
      } else {
        throw new Error(`Refusing a non-file while cloning snapshot: ${from}`);
      }
    }
  }
}

function safeManifestPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) return null;
  return normalized;
}

function assertContainedNormalFile(root, relativePath, label) {
  const rootFull = resolve(root);
  const parts = relativePath.split('/');
  let candidate = rootFull;
  for (let index = 0; index < parts.length; index += 1) {
    candidate = join(candidate, parts[index]);
    if (!isWithin(rootFull, candidate)) throw new Error(`${label} escaped its owned root: ${relativePath}`);
    if (!existsSync(candidate)) throw new Error(`${label} is missing: ${candidate}`);
    const item = lstatSync(candidate);
    if (item.isSymbolicLink()) throw new Error(`${label} contains a symlink: ${candidate}`);
    if (index === parts.length - 1) {
      if (!item.isFile()) throw new Error(`${label} must be a normal file: ${candidate}`);
      if (item.size > MAX_SOURCE_FILE_BYTES) throw new Error(`${label} exceeds the source-catalog size limit: ${candidate}`);
    } else if (!item.isDirectory()) {
      throw new Error(`${label} has a non-directory parent: ${candidate}`);
    }
  }
  return candidate;
}

function discoverMirrorContentFiles(root) {
  const rootFull = resolve(root);
  assertNormalDirectory(rootFull, 'Source mirror');
  const output = [];
  const pending = [[rootFull, '']];
  while (pending.length) {
    const [directory, prefix] = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const candidate = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing a symlink in source mirror: ${candidate}`);
      if (!prefix && entry.name === '.git') {
        if (!entry.isDirectory()) throw new Error(`Source mirror .git entry must be a normal directory: ${candidate}`);
        continue;
      }
      if (!prefix && entry.name === '.gbrain-meta') {
        if (!entry.isDirectory()) throw new Error(`Source mirror metadata must be a normal directory: ${candidate}`);
        const metadataEntries = readdirSync(candidate, { withFileTypes: true });
        if (
          metadataEntries.length !== 1
          || metadataEntries[0].name !== 'manifest.json'
          || !metadataEntries[0].isFile()
          || metadataEntries[0].isSymbolicLink()
        ) throw new Error(`Source mirror metadata must contain only a normal manifest.json: ${candidate}`);
        continue;
      }
      if (!prefix && entry.name === '.gitignore') {
        if (!entry.isFile()) throw new Error(`Source mirror .gitignore must be a normal file: ${candidate}`);
        continue;
      }
      if (entry.isDirectory()) pending.push([candidate, relativePath]);
      else if (entry.isFile()) {
        output.push(relativePath);
        if (output.length > MAX_SOURCE_CATALOG_FILES) {
          throw new Error(`Source mirror exceeds the ${MAX_SOURCE_CATALOG_FILES}-file safety limit: ${rootFull}`);
        }
      } else {
        throw new Error(`Refusing a non-file entry in source mirror: ${candidate}`);
      }
    }
  }
  return output.sort((left, right) => left.localeCompare(right));
}

function readQrelsSourceDefinitions(qrelsPath, { verifySourceRoots = true } = {}) {
  const qrels = readJson(qrelsPath, 'V3 qrels');
  if (!qrels.sources || typeof qrels.sources !== 'object' || Array.isArray(qrels.sources)) {
    throw new Error('V3 qrels must declare an owned sources object for the isolated pack trial.');
  }
  const entries = Object.entries(qrels.sources);
  if (!entries.length) throw new Error('V3 qrels must declare at least one owned source.');
  const qrelsDirectory = dirname(resolve(qrelsPath));
  return entries.map(([sourceId, definition]) => {
    if (
      !sourceId
      || !definition
      || !['markdown', 'code'].includes(definition.kind)
      || typeof definition.root !== 'string'
      || !definition.root.trim()
    ) throw new Error(`V3 qrels source ${sourceId || '<empty>'} has an unsupported ownership definition.`);
    const sourceRoot = resolve(qrelsDirectory, definition.root);
    if (verifySourceRoots) assertNormalDirectory(sourceRoot, `V3 qrels source root (${sourceId})`);
    return { sourceId, kind: definition.kind, sourceRoot };
  });
}

function sourceCatalogFingerprint(records) {
  const aggregate = createHash('sha256');
  for (const record of [...records].sort((left, right) => left.sourceId.localeCompare(right.sourceId))) {
    aggregate.update(`${record.sourceId}\t${record.kind}\t${record.mirrorKind}\t${record.manifestSha256}\n`, 'utf8');
    for (const file of record.files) {
      aggregate.update(`${file.sha256}\t${file.lengthBytes}\t${file.relativePath}\n`, 'utf8');
    }
  }
  return aggregate.digest('hex');
}

export function inspectTrustedSourceCatalogs(sourcesRoot, qrelsPath, {
  verifyCurrentSources = true,
} = {}) {
  const sourcesRootFull = resolve(sourcesRoot);
  assertNormalDirectory(sourcesRootFull, 'GBrain source-catalog root');
  const definitions = readQrelsSourceDefinitions(qrelsPath, {
    verifySourceRoots: verifyCurrentSources,
  });
  const candidates = [];
  for (const entry of readdirSync(sourcesRootFull, { withFileTypes: true })) {
    const mirrorRoot = join(sourcesRootFull, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing a symlink in GBrain source-catalog root: ${mirrorRoot}`);
    if (!entry.isDirectory()) throw new Error(`GBrain source-catalog root contains a non-directory entry: ${mirrorRoot}`);
    const manifestPath = join(mirrorRoot, '.gbrain-meta', 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath, `GBrain source manifest (${entry.name})`);
    candidates.push({ mirrorRoot, manifestPath, manifest });
  }

  const records = [];
  const usedMirrorRoots = new Set();
  for (const definition of definitions) {
    const matches = candidates.filter(({ manifest }) => (
      typeof manifest.source_root === 'string' && samePath(manifest.source_root, definition.sourceRoot)
    ));
    if (matches.length !== 1) {
      throw new Error(matches.length
        ? `More than one GBrain source manifest owns qrels source ${definition.sourceId}.`
        : `No GBrain source manifest owns qrels source ${definition.sourceId}.`);
    }
    const candidate = matches[0];
    const mirrorKey = normalizedPath(candidate.mirrorRoot);
    if (usedMirrorRoots.has(mirrorKey)) {
      throw new Error(`A GBrain source mirror was reused by multiple qrels sources: ${candidate.mirrorRoot}`);
    }
    usedMirrorRoots.add(mirrorKey);
    const { manifest } = candidate;
    if (
      manifest.schema_version !== 1
      || manifest.mirror_kind !== MIRROR_KIND_BY_SOURCE_KIND[definition.kind]
      || typeof manifest.source_root !== 'string'
      || !isAbsolute(manifest.source_root)
      || !Array.isArray(manifest.files)
      || manifest.files.length > MAX_SOURCE_CATALOG_FILES
      || Number(manifest.file_count) !== manifest.files.length
      || !manifest.file_sha256
      || typeof manifest.file_sha256 !== 'object'
      || Array.isArray(manifest.file_sha256)
    ) throw new Error(`GBrain source manifest is not an ownership-verified hash inventory: ${candidate.manifestPath}`);

    const declaredPaths = [];
    const declaredSet = new Set();
    const files = [];
    let totalBytes = 0;
    for (const value of manifest.files) {
      const relativePath = safeManifestPath(value);
      if (!relativePath || declaredSet.has(relativePath)) {
        throw new Error(`GBrain source manifest contains an unsafe or duplicate path: ${candidate.manifestPath}`);
      }
      declaredSet.add(relativePath);
      declaredPaths.push(relativePath);
      if (!Object.prototype.hasOwnProperty.call(manifest.file_sha256, relativePath)) {
        throw new Error(`GBrain source manifest is missing a file hash for ${relativePath}.`);
      }
      const expectedHash = String(manifest.file_sha256[relativePath] ?? '');
      if (!SHA256_PATTERN.test(expectedHash)) {
        throw new Error(`GBrain source manifest has an invalid SHA-256 for ${relativePath}.`);
      }
      const mirrorFile = assertContainedNormalFile(candidate.mirrorRoot, relativePath, 'GBrain source mirror file');
      const mirrorHash = sha256File(mirrorFile);
      if (mirrorHash !== expectedHash) {
        throw new Error(`GBrain source provenance hash mismatch for ${relativePath}.`);
      }
      if (verifyCurrentSources) {
        const sourceFile = assertContainedNormalFile(definition.sourceRoot, relativePath, 'Current source file');
        if (sha256File(sourceFile) !== expectedHash) {
          throw new Error(`GBrain source provenance hash mismatch for ${relativePath}.`);
        }
      }
      const lengthBytes = statSync(mirrorFile).size;
      totalBytes += lengthBytes;
      files.push({ relativePath, lengthBytes, sha256: expectedHash, mirrorFile });
    }
    const hashKeys = Object.keys(manifest.file_sha256);
    if (hashKeys.length !== declaredSet.size || hashKeys.some((key) => !declaredSet.has(key))) {
      throw new Error(`GBrain source manifest hash keys do not exactly match its file inventory: ${candidate.manifestPath}`);
    }
    if (!Number.isSafeInteger(Number(manifest.total_bytes)) || Number(manifest.total_bytes) !== totalBytes) {
      throw new Error(`GBrain source manifest total_bytes does not match its verified files: ${candidate.manifestPath}`);
    }
    const discoveredPaths = discoverMirrorContentFiles(candidate.mirrorRoot);
    const sortedDeclaredPaths = [...declaredPaths].sort((left, right) => left.localeCompare(right));
    if (
      discoveredPaths.length !== sortedDeclaredPaths.length
      || discoveredPaths.some((value, index) => value !== sortedDeclaredPaths[index])
    ) throw new Error(`GBrain source mirror inventory does not exactly match its manifest: ${candidate.mirrorRoot}`);

    records.push({
      sourceId: definition.sourceId,
      kind: definition.kind,
      sourceRoot: definition.sourceRoot,
      mirrorRoot: candidate.mirrorRoot,
      mirrorName: basename(candidate.mirrorRoot),
      mirrorKind: manifest.mirror_kind,
      manifestPath: candidate.manifestPath,
      manifestSha256: sha256File(candidate.manifestPath),
      files,
    });
  }
  return {
    root: sourcesRootFull,
    records,
    catalogCount: records.length,
    fileCount: records.reduce((sum, record) => sum + record.files.length, 0),
    fingerprint: sourceCatalogFingerprint(records),
  };
}

function auditCurrentSourceRoots(catalogs) {
  const drift = [];
  for (const record of catalogs.records) {
    for (const file of record.files) {
      try {
        const sourceFile = assertContainedNormalFile(record.sourceRoot, file.relativePath, 'Current source file');
        if (sha256File(sourceFile) !== file.sha256) {
          drift.push({
            source_id: record.sourceId,
            relative_path: file.relativePath,
            reason: 'sha256_mismatch',
          });
        }
      } catch (error) {
        drift.push({
          source_id: record.sourceId,
          relative_path: file.relativePath,
          reason: 'missing_or_unsafe',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { matches: drift.length === 0, drift };
}

function visitNormalTree(root) {
  const rootFull = resolve(root);
  assertNormalDirectory(rootFull, 'Isolated source-catalog tree');
  const directories = [rootFull];
  const files = [];
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing a symlink in isolated source catalogs: ${candidate}`);
      if (entry.isDirectory()) directories.push(candidate);
      else if (entry.isFile()) files.push(candidate);
      else throw new Error(`Refusing a non-file in isolated source catalogs: ${candidate}`);
    }
  }
  return { directories, files };
}

function makeTreeReadOnly(root) {
  const tree = visitNormalTree(root);
  for (const file of tree.files) chmodSync(file, 0o444);
  for (const directory of [...tree.directories].reverse()) chmodSync(directory, 0o555);
}

function assertTreeReadOnly(root) {
  const tree = visitNormalTree(root);
  for (const candidate of [...tree.files, ...tree.directories]) {
    if ((statSync(candidate).mode & 0o222) !== 0) {
      throw new Error(`Isolated source-catalog copy is writable: ${candidate}`);
    }
  }
}

function makeTreeWritable(root) {
  const tree = visitNormalTree(root);
  for (const directory of tree.directories) chmodSync(directory, 0o700);
  for (const file of tree.files) chmodSync(file, 0o600);
}

function cloneTrustedSourceCatalogs(liveCatalogs, destination, qrelsPath, allowedRoot) {
  const destinationFull = resolve(destination);
  if (existsSync(destinationFull)) throw new Error(`Isolated source-catalog destination already exists: ${destinationFull}`);
  if (!isWithin(allowedRoot, destinationFull)) throw new Error('Isolated source-catalog destination escaped its workspace.');
  mkdirSync(destinationFull);
  for (const record of liveCatalogs.records) {
    const destinationMirror = join(destinationFull, record.mirrorName);
    if (!isDirectChild(destinationFull, destinationMirror) || existsSync(destinationMirror)) {
      throw new Error(`Unsafe or duplicate isolated source-mirror destination: ${destinationMirror}`);
    }
    mkdirSync(destinationMirror);
    for (const file of record.files) {
      const destinationFile = join(destinationMirror, ...file.relativePath.split('/'));
      if (!isWithin(destinationMirror, destinationFile)) {
        throw new Error(`Isolated source file escaped its mirror: ${file.relativePath}`);
      }
      mkdirSync(dirname(destinationFile), { recursive: true });
      copyFileSync(file.mirrorFile, destinationFile, fsConstants.COPYFILE_EXCL);
      if (sha256File(destinationFile) !== file.sha256) {
        throw new Error(`Isolated source-copy hash mismatch for ${file.relativePath}.`);
      }
    }
    const metadataDirectory = join(destinationMirror, '.gbrain-meta');
    mkdirSync(metadataDirectory);
    const destinationManifest = join(metadataDirectory, 'manifest.json');
    copyFileSync(record.manifestPath, destinationManifest, fsConstants.COPYFILE_EXCL);
    if (sha256File(destinationManifest) !== record.manifestSha256) {
      throw new Error(`Isolated source-manifest copy hash mismatch: ${record.mirrorName}`);
    }
  }
  const clonedCatalogs = inspectTrustedSourceCatalogs(destinationFull, qrelsPath, {
    verifyCurrentSources: false,
  });
  if (clonedCatalogs.fingerprint !== liveCatalogs.fingerprint) {
    throw new Error('Isolated source catalogs do not exactly match the verified live catalog snapshot.');
  }
  makeTreeReadOnly(destinationFull);
  assertTreeReadOnly(destinationFull);
  return clonedCatalogs;
}

function activeProfile(activeHome) {
  const home = resolve(activeHome);
  assertNormalDirectory(home, 'Active GBrain profile');
  const configPath = join(home, 'config.json');
  const config = readJson(configPath, 'Active GBrain config');
  if (config.engine !== 'pglite') throw new Error(`Pack trial supports PGLite only; configured engine is ${config.engine}.`);
  const databasePath = resolve(String(config.database_path ?? ''));
  const expectedDatabasePath = join(home, 'brain.pglite');
  if (!samePath(databasePath, expectedDatabasePath)) {
    throw new Error(`Refusing unexpected active database path: ${databasePath}`);
  }
  assertNormalDirectory(databasePath, 'Active GBrain database');
  return {
    home,
    config,
    configPath,
    configSha256: sha256File(configPath),
    databasePath,
  };
}

function selectSnapshot(profile, requestedSnapshot) {
  const backupRoot = join(profile.home, 'backups');
  assertNormalDirectory(backupRoot, 'GBrain backup root');
  const rootMarkerPath = join(backupRoot, '.gbrain-backup-root.json');
  const rootMarker = readJson(rootMarkerPath, 'GBrain backup root marker');
  if (
    rootMarker.schema_version !== 1
    || rootMarker.kind !== 'gbrain-pglite-backup-root'
    || !rootMarker.root_id
    || !samePath(rootMarker.gbrain_home, profile.home)
    || !samePath(rootMarker.active_database, profile.databasePath)
  ) {
    throw new Error('GBrain backup root ownership marker does not match the active profile.');
  }

  let snapshotPath;
  if (requestedSnapshot) {
    snapshotPath = resolve(requestedSnapshot);
  } else {
    const candidates = readdirSync(backupRoot)
      .filter((name) => SNAPSHOT_NAME.test(name))
      .map((name) => join(backupRoot, name))
      .filter((candidate) => lstatSync(candidate).isDirectory() && !lstatSync(candidate).isSymbolicLink())
      .map((candidate) => ({ candidate, manifest: readJson(join(candidate, 'manifest.json'), 'Snapshot manifest') }))
      .sort((left, right) => Date.parse(right.manifest.created_at) - Date.parse(left.manifest.created_at));
    if (!candidates.length) throw new Error('No ownership-verified GBrain snapshot candidates were found.');
    snapshotPath = candidates[0].candidate;
  }

  if (!isDirectChild(backupRoot, snapshotPath) || !SNAPSHOT_NAME.test(basename(snapshotPath))) {
    throw new Error(`Snapshot must be a named direct child of the owned backup root: ${snapshotPath}`);
  }
  assertNormalDirectory(snapshotPath, 'GBrain snapshot');
  const manifestPath = join(snapshotPath, 'manifest.json');
  const manifest = readJson(manifestPath, 'GBrain snapshot manifest');
  if (
    manifest.schema_version !== 1
    || manifest.kind !== 'gbrain-pglite-snapshot'
    || manifest.backup_root_id !== rootMarker.root_id
    || !samePath(manifest.source_database, profile.databasePath)
    || manifest.verified !== true
    || manifest.restore_drill_passed !== true
    || String(manifest.source_config_sha256).toLowerCase() !== profile.configSha256
  ) {
    throw new Error('Snapshot manifest is not verified for the current active config/profile with a passed restore drill.');
  }
  const databasePath = join(snapshotPath, String(manifest.database?.relative_path ?? ''));
  if (!isDirectChild(snapshotPath, databasePath) || basename(databasePath) !== 'brain.pglite') {
    throw new Error('Snapshot database path is outside the owned snapshot contract.');
  }
  assertNormalDirectory(databasePath, 'Snapshot database');
  for (const runtimePath of ['.gbrain-lock', 'postmaster.pid', '.gbrain-resolve.sock']) {
    if (existsSync(join(databasePath, runtimePath))) {
      throw new Error(`Snapshot contains forbidden runtime state: ${runtimePath}`);
    }
  }
  const inventory = inventoryTree(databasePath);
  compareInventory(inventory, manifest.database, 'Snapshot');
  return {
    backupRoot,
    rootMarker,
    path: snapshotPath,
    manifestPath,
    manifest,
    manifestSha256: sha256File(manifestPath),
    databasePath,
    inventory,
  };
}

function isolatedConfig(activeConfig, isolatedDatabase) {
  const config = {
    engine: 'pglite',
    database_path: resolve(isolatedDatabase),
    schema_pack: BASELINE_PACK,
  };
  for (const key of ['embedding_model', 'embedding_dimensions']) {
    if (activeConfig[key] !== undefined) config[key] = activeConfig[key];
  }
  config.provider_base_urls = {
    ...(activeConfig.provider_base_urls && typeof activeConfig.provider_base_urls === 'object'
      ? activeConfig.provider_base_urls
      : {}),
    ollama: SAFE_OLLAMA_URL,
  };
  const serialized = JSON.stringify(config);
  if (serialized.includes(PROTECTED_OLLAMA_PORT)) {
    throw new Error(`Protected Ollama port ${PROTECTED_OLLAMA_PORT} appeared in isolated config.`);
  }
  return config;
}

export function buildIsolatedEnvironment(baseEnvironment, workspace) {
  const environment = { ...baseEnvironment };
  for (const name of [
    'DATABASE_URL',
    'GBRAIN_DATABASE_URL',
    'GBRAIN_DIRECT_DATABASE_URL',
    'GBRAIN_BRAIN_ID',
    'GBRAIN_SCHEMA_PACK',
    'OLLAMA_HOST',
    'OLLAMA_API_KEY',
  ]) delete environment[name];
  Object.assign(environment, {
    GBRAIN_HOME: resolve(workspace),
    GBRAIN_SOURCE: 'default',
    GBRAIN_SKIP_STARTUP_HOOKS: '1',
    GBRAIN_NO_BANNER: '1',
    GBRAIN_NO_GITIGNORE: '1',
    OLLAMA_BASE_URL: SAFE_OLLAMA_URL,
  });
  if (Object.entries(environment).some(([name, value]) => (
    name.toUpperCase().includes('OLLAMA') && String(value).includes(`:${PROTECTED_OLLAMA_PORT}`)
  ))) {
    throw new Error(`Protected Ollama port ${PROTECTED_OLLAMA_PORT} leaked into isolated environment.`);
  }
  return environment;
}

function defaultCommandRunner(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(-5000);
    throw new Error(`${options.label} failed with exit code ${result.status}: ${detail}`);
  }
  return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), status: result.status };
}

function runIsolatedCommand(context, command, args, label, timeoutMs) {
  if (!samePath(context.environment.GBRAIN_HOME, context.workspace)) {
    throw new Error(`${label} refused: GBRAIN_HOME is not the disposable workspace.`);
  }
  if (!samePath(context.cwd, context.workspace)) {
    throw new Error(`${label} refused: working directory is not the disposable workspace.`);
  }
  if (args.some((argument) => String(argument).includes(context.profile.databasePath))) {
    throw new Error(`${label} refused: active database path appeared in child arguments.`);
  }
  return context.commandRunner(command, args, {
    cwd: context.cwd,
    env: context.environment,
    timeoutMs,
    label,
  });
}

export function parseFollowResult(output, label = 'unify-types job') {
  const line = String(output).split(/\r?\n/).find((candidate) => candidate.startsWith('Result: '));
  if (!line) throw new Error(`${label} did not return a structured Result line.`);
  try {
    return JSON.parse(line.slice('Result: '.length));
  } catch (error) {
    throw new Error(`${label} returned invalid result JSON: ${error.message}`);
  }
}

function expectedEvaluationCatalogs(clonedCatalogs) {
  return Object.fromEntries(clonedCatalogs.records.map((record) => [record.sourceId, {
    kind: record.kind,
    mirror_kind: record.mirrorKind,
    manifest_path: join(clonedCatalogs.root, record.mirrorName, '.gbrain-meta', 'manifest.json'),
  }]));
}

function readEvaluation(file, label, expectedCatalogs) {
  const report = readJson(file, label);
  if (!report.summary || !report.gate || !Array.isArray(report.cases)) {
    throw new Error(`${label} is missing summary, gate, or cases.`);
  }
  if (
    report.source_provenance?.mode !== SOURCE_PROVENANCE_METHOD
    || !report.source_provenance.catalogs
    || typeof report.source_provenance.catalogs !== 'object'
    || Array.isArray(report.source_provenance.catalogs)
  ) throw new Error(`${label} is missing the trusted source-provenance catalog contract.`);
  const actualCatalogIds = Object.keys(report.source_provenance.catalogs).sort();
  const expectedCatalogIds = Object.keys(expectedCatalogs).sort();
  if (
    actualCatalogIds.length !== expectedCatalogIds.length
    || actualCatalogIds.some((value, index) => value !== expectedCatalogIds[index])
  ) throw new Error(`${label} did not use the exact isolated source-provenance catalog set.`);
  for (const sourceId of expectedCatalogIds) {
    const actual = report.source_provenance.catalogs[sourceId];
    const expected = expectedCatalogs[sourceId];
    if (
      actual?.status !== 'ready'
      || actual.kind !== expected.kind
      || actual.method !== SOURCE_PROVENANCE_METHOD
      || actual.mirror_kind !== expected.mirror_kind
      || !samePath(actual.manifest_path, expected.manifest_path)
      || !Number.isInteger(actual.slug_count)
      || actual.slug_count < 1
      || actual.reason !== null
    ) throw new Error(`${label} source-provenance catalog ${sourceId} was not ready from the trusted isolated mirror.`);
  }
  for (const entry of report.cases) {
    if (!Array.isArray(entry.results)) throw new Error(`${label} case ${entry.query_id ?? '<unknown>'} is missing results.`);
    if (entry.results.some((result) => result.source_provenance?.method !== SOURCE_PROVENANCE_METHOD)) {
      throw new Error(`${label} case ${entry.query_id ?? '<unknown>'} contains a result without trusted source provenance.`);
    }
  }
  return report;
}

export function compareEvaluations(baseline, trial) {
  const regressions = [];
  const deltas = {};
  for (const [metric, tolerance] of QUALITY_METRICS) {
    const before = baseline.summary[metric];
    const after = trial.summary[metric];
    if (typeof before !== 'number' || typeof after !== 'number') {
      regressions.push({ metric, reason: 'missing_metric', before: before ?? null, after: after ?? null });
      continue;
    }
    const delta = Number((after - before).toFixed(6));
    deltas[metric] = delta;
    if (delta < -tolerance) regressions.push({ metric, before, after, delta, tolerance });
  }
  const baselineCases = new Map(baseline.cases.map((entry) => [entry.query_id, entry]));
  const caseRegressions = [];
  for (const after of trial.cases) {
    const before = baselineCases.get(after.query_id);
    if (!before) continue;
    const beforeRank = before.metrics?.first_relevant_rank;
    const afterRank = after.metrics?.first_relevant_rank;
    if (typeof beforeRank === 'number' && (afterRank === null || afterRank > beforeRank)) {
      caseRegressions.push({ query_id: after.query_id, before_rank: beforeRank, after_rank: afterRank });
    }
  }
  return {
    passed: trial.gate.passed === true && regressions.length === 0 && caseRegressions.length === 0,
    trial_gate_passed: trial.gate.passed === true,
    baseline_gate_passed: baseline.gate.passed === true,
    tolerances: Object.fromEntries(QUALITY_METRICS),
    deltas,
    regressions,
    case_rank_regressions: caseRegressions,
    latency_observation: {
      baseline_p95_ms: baseline.summary.p95_latency_ms ?? null,
      trial_p95_ms: trial.summary.p95_latency_ms ?? null,
      hard_gate: false,
    },
  };
}

function atomicWriteJson(file, value) {
  const parent = dirname(resolve(file));
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  assertNormalDirectory(parent, 'Report directory');
  const temporary = join(parent, `.tmp-pack-v2-${randomUUID().replaceAll('-', '')}.json`);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, resolve(file));
}

function createWorkspace(root) {
  assertNormalDirectory(root, 'Temporary root');
  const workspace = mkdtempSync(join(resolve(root), 'gbrain-pack-v2-trial-'));
  if (!isDirectChild(root, workspace) || !WORKSPACE_NAME.test(basename(workspace))) {
    throw new Error(`Disposable workspace escaped its temporary root: ${workspace}`);
  }
  const workspaceId = randomUUID();
  writeFileSync(join(workspace, '.gbrain-pack-v2-trial.json'), JSON.stringify({
    schema_version: 1,
    kind: 'gbrain-pack-v2-trial-workspace',
    workspace_id: workspaceId,
  }), { encoding: 'utf8', flag: 'wx' });
  return { workspace, workspaceId };
}

function cleanupWorkspace(root, workspace, workspaceId) {
  if (!workspace || !existsSync(workspace)) return true;
  const workspaceFull = resolve(workspace);
  if (!isDirectChild(root, workspaceFull) || !WORKSPACE_NAME.test(basename(workspaceFull))) {
    throw new Error(`Refusing unsafe trial workspace cleanup target: ${workspaceFull}`);
  }
  assertNormalDirectory(workspaceFull, 'Trial workspace');
  const marker = readJson(join(workspaceFull, '.gbrain-pack-v2-trial.json'), 'Trial workspace marker');
  if (marker.kind !== 'gbrain-pack-v2-trial-workspace' || marker.workspace_id !== workspaceId) {
    throw new Error(`Refusing trial workspace cleanup with mismatched marker: ${workspaceFull}`);
  }
  rmSync(workspaceFull, { recursive: true, force: false });
  return !existsSync(workspaceFull);
}

function compactEvaluation(report) {
  return {
    generated_at: report.generated_at ?? null,
    qrels_path: report.qrels_path,
    k: report.k,
    ranking: report.ranking,
    source_provenance: report.source_provenance,
    summary: report.summary,
    per_category: report.per_category,
    gate: report.gate,
  };
}

function baseReport({
  dryRun,
  profile,
  snapshot,
  qrelsPath,
  activeSourcesRoot,
  activeDatabaseInventory,
}) {
  return {
    schema_version: 1,
    kind: 'gbrain-base-v2-isolated-trial',
    generated_at: new Date().toISOString(),
    success: false,
    dry_run: dryRun,
    status: 'failed',
    safety: {
      active_profile: profile.home,
      active_database: profile.databasePath,
      active_database_excluded_runtime_paths: ACTIVE_DATABASE_RUNTIME_PATHS,
      active_database_inventory_sha256_before: activeDatabaseInventory.inventory_sha256,
      active_database_inventory_sha256_after: null,
      active_database_unchanged: null,
      active_config_sha256_before: profile.configSha256,
      active_config_sha256_after: null,
      active_config_unchanged: null,
      active_sources_root: activeSourcesRoot,
      source_catalog_count: null,
      source_file_count: null,
      source_catalog_fingerprint: null,
      live_source_catalogs_verified_before: false,
      live_source_catalogs_verified_after: null,
      live_source_catalogs_unchanged: null,
      current_source_roots_match_frozen_catalog_before: false,
      current_source_roots_match_frozen_catalog_after: null,
      current_source_root_drift: [],
      isolated_source_catalogs_root: null,
      isolated_source_catalogs_verified_before: null,
      isolated_source_catalogs_verified_after: null,
      isolated_source_catalogs_read_only: null,
      snapshot_path: snapshot.path,
      snapshot_created_at: snapshot.manifest.created_at,
      snapshot_restore_drill_passed: snapshot.manifest.restore_drill_passed,
      snapshot_inventory_sha256: snapshot.inventory.inventory_sha256,
      snapshot_inventory_verified_before: true,
      snapshot_inventory_verified_after: null,
      disposable_workspace_deleted: null,
      ollama_endpoint: SAFE_OLLAMA_URL,
      endpoint_contract_verified: null,
      protected_ollama_port_absent_from_configuration: null,
    },
    pack: {
      baseline: BASELINE_PACK,
      target: TARGET_PACK,
      active_file_config_before: profile.config.schema_pack ?? null,
      baseline_reconstructed_in_clone: profile.config.schema_pack !== BASELINE_PACK,
      baseline_resolution: 'GBRAIN_SCHEMA_PACK environment override in disposable clone',
      preview: null,
      apply: null,
      verification: null,
    },
    evaluations: {
      qrels_path: qrelsPath,
      baseline: null,
      trial: null,
      comparison: null,
    },
    decision: {
      accepted: false,
      reasons: [],
    },
    error: null,
  };
}

export function parseArgs(argv) {
  const options = { dryRun: false, snapshotPath: null, timeoutMs: 20 * 60_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--snapshot') options.snapshotPath = argv[++index];
    else if (argument === '--timeout-ms') options.timeoutMs = Number.parseInt(argv[++index], 10);
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.snapshotPath !== null && (!options.snapshotPath || options.snapshotPath.startsWith('--'))) {
    throw new Error('--snapshot requires a path.');
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 10_000 || options.timeoutMs > 3_600_000) {
    throw new Error('--timeout-ms must be an integer from 10000 to 3600000.');
  }
  return options;
}

export function runPackTrial(options = {}) {
  const dryRun = options.dryRun === true;
  const activeHome = options.activeHome ?? join(homedir(), '.gbrain');
  const activeSourcesRoot = resolve(options.activeSourcesRoot ?? join(activeHome, 'sources'));
  const temporaryRoot = options.temporaryRoot ?? tmpdir();
  const qrelsPath = resolve(options.qrelsPath ?? join(REPOSITORY_ROOT, 'gbrain-evals', 'qrels', 'minimalist-chat-v3.qrels.json'));
  const evaluatorPath = resolve(options.evaluatorPath ?? join(SCRIPT_DIRECTORY, 'gbrain-retrieval-eval.mjs'));
  const reportPath = resolve(options.reportPath ?? join(activeHome, 'evals', 'minimalist-chat-pack-v2-trial.json'));
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const gbrainCommand = options.gbrainCommand ?? 'gbrain';
  const nodeCommand = options.nodeCommand ?? process.execPath;
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;

  const profile = activeProfile(activeHome);
  const activeDatabaseInventory = inventoryTree(profile.databasePath, {
    excludeRelativePaths: ACTIVE_DATABASE_RUNTIME_PATHS,
  });
  assertNormalFile(qrelsPath, 'V3 qrels');
  assertNormalFile(evaluatorPath, 'GBrain retrieval evaluator');
  const snapshot = selectSnapshot(profile, options.snapshotPath);
  const report = baseReport({
    dryRun,
    profile,
    snapshot,
    qrelsPath,
    activeSourcesRoot,
    activeDatabaseInventory,
  });
  let workspace = null;
  let workspaceId = null;
  let liveCatalogsBefore = null;
  let clonedCatalogs = null;
  let isolatedSourcesRoot = null;
  let isolatedConfigPath = null;
  let isolatedEnvironment = null;

  try {
    liveCatalogsBefore = inspectTrustedSourceCatalogs(activeSourcesRoot, qrelsPath);
    report.safety.source_catalog_count = liveCatalogsBefore.catalogCount;
    report.safety.source_file_count = liveCatalogsBefore.fileCount;
    report.safety.source_catalog_fingerprint = liveCatalogsBefore.fingerprint;
    report.safety.live_source_catalogs_verified_before = true;
    report.safety.current_source_roots_match_frozen_catalog_before = true;
    if (dryRun) {
      report.success = true;
      report.status = 'validated';
      report.decision.reasons.push('Verified snapshot, restore drill, full database inventory, owned source hashes, active config pairing, and isolation plan.');
      return report;
    }

    ({ workspace, workspaceId } = createWorkspace(temporaryRoot));
    const isolatedHome = join(workspace, '.gbrain');
    const isolatedDatabase = join(isolatedHome, 'brain.pglite');
    mkdirSync(isolatedHome);
    copySafeTree(snapshot.databasePath, isolatedDatabase, workspace);
    const cloneInventory = inventoryTree(isolatedDatabase);
    compareInventory(cloneInventory, snapshot.manifest.database, 'Isolated clone');

    isolatedSourcesRoot = join(isolatedHome, 'sources');
    clonedCatalogs = cloneTrustedSourceCatalogs(liveCatalogsBefore, isolatedSourcesRoot, qrelsPath, workspace);
    report.safety.isolated_source_catalogs_root = isolatedSourcesRoot;
    report.safety.isolated_source_catalogs_verified_before = true;
    report.safety.isolated_source_catalogs_read_only = true;
    const evaluationCatalogs = expectedEvaluationCatalogs(clonedCatalogs);

    const config = isolatedConfig(profile.config, isolatedDatabase);
    isolatedConfigPath = join(isolatedHome, 'config.json');
    writeFileSync(isolatedConfigPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    const environment = buildIsolatedEnvironment(options.environment ?? process.env, workspace);
    isolatedEnvironment = environment;
    const context = {
      profile,
      workspace,
      cwd: workspace,
      environment,
      commandRunner,
    };
    const baselineContext = {
      ...context,
      environment: { ...environment, GBRAIN_SCHEMA_PACK: BASELINE_PACK },
    };

    runIsolatedCommand(context, gbrainCommand, ['config', 'set', 'provider_base_urls.ollama', SAFE_OLLAMA_URL], 'isolated Ollama pin', 90_000);
    const baselineActive = runIsolatedCommand(baselineContext, gbrainCommand, ['schema', 'active'], 'isolated baseline verification', 90_000);
    if (!baselineActive.stdout.includes(`Active pack: ${BASELINE_PACK} `)) {
      throw new Error(`Isolated baseline pack verification failed: ${baselineActive.stdout.trim()}`);
    }

    const baselinePath = join(workspace, 'baseline-eval.json');
    runIsolatedCommand(baselineContext, nodeCommand, [
      evaluatorPath,
      '--qrels', qrelsPath,
      '--output', baselinePath,
      '--k', '10',
      '--frozen-provenance',
      '--quiet',
    ], 'V3 baseline evaluation', timeoutMs);
    const baseline = readEvaluation(baselinePath, 'V3 baseline evaluation report', evaluationCatalogs);
    report.evaluations.baseline = compactEvaluation(baseline);

    const previewRun = runIsolatedCommand(baselineContext, gbrainCommand, [
      'jobs', 'submit', 'unify-types', '--follow', '--max-attempts', '1',
      '--timeout-ms', String(timeoutMs),
      '--params', JSON.stringify({ target_pack: TARGET_PACK, apply: false }),
    ], 'gbrain-base-v2 preview', timeoutMs);
    const preview = parseFollowResult(previewRun.stdout, 'gbrain-base-v2 preview');
    if (preview.apply !== false || preview.target_pack !== TARGET_PACK || preview.active_pack_flipped !== false) {
      throw new Error('gbrain-base-v2 preview violated the non-mutating preview contract.');
    }
    report.pack.preview = preview;

    const applyRun = runIsolatedCommand(context, gbrainCommand, [
      'jobs', 'submit', 'unify-types', '--follow', '--max-attempts', '1',
      '--timeout-ms', String(timeoutMs),
      '--params', JSON.stringify({ target_pack: TARGET_PACK, apply: true }),
    ], 'gbrain-base-v2 isolated apply', timeoutMs);
    const apply = parseFollowResult(applyRun.stdout, 'gbrain-base-v2 isolated apply');
    if (apply.apply !== true || apply.target_pack !== TARGET_PACK || apply.active_pack_flipped !== true) {
      throw new Error('gbrain-base-v2 apply did not report an isolated active-pack flip.');
    }
    report.pack.apply = apply;

    const targetActive = runIsolatedCommand(context, gbrainCommand, ['schema', 'active'], 'isolated target verification', 90_000);
    const targetVerified = targetActive.stdout.includes(`Active pack: ${TARGET_PACK} `);
    report.pack.verification = { active: targetVerified, output: targetActive.stdout.trim() };
    if (!targetVerified) throw new Error(`Isolated target pack verification failed: ${targetActive.stdout.trim()}`);

    const trialPath = join(workspace, 'trial-eval.json');
    runIsolatedCommand(context, nodeCommand, [
      evaluatorPath,
      '--qrels', qrelsPath,
      '--output', trialPath,
      '--k', '10',
      '--frozen-provenance',
      '--quiet',
    ], 'V3 trial evaluation', timeoutMs);
    const trial = readEvaluation(trialPath, 'V3 trial evaluation report', evaluationCatalogs);
    if (JSON.stringify(trial.source_provenance) !== JSON.stringify(baseline.source_provenance)) {
      throw new Error('Baseline and trial evaluations did not use identical trusted source-provenance catalogs.');
    }
    const comparison = compareEvaluations(baseline, trial);
    report.evaluations.trial = compactEvaluation(trial);
    report.evaluations.comparison = comparison;
    report.decision.accepted = comparison.passed;
    if (!trial.gate.passed) report.decision.reasons.push('Trial retrieval did not pass every V3 correctness gate.');
    if (comparison.regressions.length) report.decision.reasons.push('Trial retrieval had quality regressions beyond explicit tolerances.');
    if (comparison.passed) report.decision.reasons.push('Trial passed V3 gates and the no-material-regression comparison.');
    report.success = true;
    report.status = comparison.passed ? 'accepted' : 'rejected';
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.decision.accepted = false;
    report.decision.reasons.push('The isolated trial failed closed before it could be accepted.');
  } finally {
    if (isolatedConfigPath && isolatedEnvironment) {
      try {
        const finalIsolatedConfig = readJson(isolatedConfigPath, 'Isolated GBrain config after trial');
        const ollamaEnvironment = Object.entries(isolatedEnvironment)
          .filter(([name]) => name.toUpperCase().includes('OLLAMA'));
        const endpointContractVerified = finalIsolatedConfig?.provider_base_urls?.ollama === SAFE_OLLAMA_URL
          && isolatedEnvironment.OLLAMA_BASE_URL === SAFE_OLLAMA_URL
          && !JSON.stringify(finalIsolatedConfig).includes(`:${PROTECTED_OLLAMA_PORT}`)
          && !ollamaEnvironment.some(([, value]) => String(value).includes(`:${PROTECTED_OLLAMA_PORT}`));
        report.safety.endpoint_contract_verified = endpointContractVerified;
        report.safety.protected_ollama_port_absent_from_configuration = endpointContractVerified;
        if (!endpointContractVerified) throw new Error('The isolated Ollama endpoint contract changed during the trial.');
      } catch (error) {
        report.safety.endpoint_contract_verified = false;
        report.safety.protected_ollama_port_absent_from_configuration = false;
        report.error ??= error instanceof Error ? error.message : String(error);
        report.success = false;
        report.status = 'failed';
        report.decision.accepted = false;
      }
    }
    if (isolatedSourcesRoot && existsSync(isolatedSourcesRoot)) {
      try {
        const isolatedCatalogsAfter = inspectTrustedSourceCatalogs(isolatedSourcesRoot, qrelsPath, {
          verifyCurrentSources: false,
        });
        assertTreeReadOnly(isolatedSourcesRoot);
        if (!clonedCatalogs || isolatedCatalogsAfter.fingerprint !== clonedCatalogs.fingerprint) {
          throw new Error('Isolated source catalogs changed during the pack trial.');
        }
        report.safety.isolated_source_catalogs_verified_after = true;
      } catch (error) {
        report.safety.isolated_source_catalogs_verified_after = false;
        report.safety.isolated_source_catalogs_read_only = false;
        report.error ??= error instanceof Error ? error.message : String(error);
        report.success = false;
        report.status = 'failed';
        report.decision.accepted = false;
      }
    }
    if (liveCatalogsBefore) {
      try {
        const liveCatalogsAfter = inspectTrustedSourceCatalogs(activeSourcesRoot, qrelsPath, {
          verifyCurrentSources: false,
        });
        report.safety.live_source_catalogs_verified_after = true;
        report.safety.live_source_catalogs_unchanged = liveCatalogsAfter.fingerprint === liveCatalogsBefore.fingerprint;
        if (!report.safety.live_source_catalogs_unchanged) {
          throw new Error('Live source catalogs changed during the isolated pack trial.');
        }
      } catch (error) {
        report.safety.live_source_catalogs_verified_after = false;
        report.safety.live_source_catalogs_unchanged = false;
        report.error ??= error instanceof Error ? error.message : String(error);
        report.success = false;
        report.status = 'failed';
        report.decision.accepted = false;
      }
      const sourceAudit = auditCurrentSourceRoots(liveCatalogsBefore);
      report.safety.current_source_roots_match_frozen_catalog_after = sourceAudit.matches;
      report.safety.current_source_root_drift = sourceAudit.drift;
    }
    try {
      const activeDatabaseInventoryAfter = inventoryTree(profile.databasePath, {
        excludeRelativePaths: ACTIVE_DATABASE_RUNTIME_PATHS,
      });
      report.safety.active_database_inventory_sha256_after = activeDatabaseInventoryAfter.inventory_sha256;
      report.safety.active_database_unchanged = (
        activeDatabaseInventoryAfter.inventory_sha256 === activeDatabaseInventory.inventory_sha256
      );
      if (!report.safety.active_database_unchanged) {
        throw new Error('Active GBrain database changed during the isolated pack trial.');
      }
    } catch (error) {
      report.safety.active_database_unchanged = false;
      report.error ??= error instanceof Error ? error.message : String(error);
      report.success = false;
      report.status = 'failed';
      report.decision.accepted = false;
    }
    try {
      const inventoryAfter = inventoryTree(snapshot.databasePath);
      compareInventory(inventoryAfter, snapshot.manifest.database, 'Snapshot after trial');
      report.safety.snapshot_inventory_verified_after = true;
      if (sha256File(snapshot.manifestPath) !== snapshot.manifestSha256) {
        throw new Error('Snapshot manifest changed during the isolated trial.');
      }
    } catch (error) {
      report.safety.snapshot_inventory_verified_after = false;
      report.error ??= error instanceof Error ? error.message : String(error);
      report.success = false;
      report.status = 'failed';
      report.decision.accepted = false;
    }
    try {
      report.safety.active_config_sha256_after = sha256File(profile.configPath);
      report.safety.active_config_unchanged = report.safety.active_config_sha256_after === profile.configSha256;
      if (!report.safety.active_config_unchanged) {
        report.error ??= 'Active GBrain config changed during the isolated trial; acceptance was refused.';
        report.success = false;
        report.status = 'failed';
        report.decision.accepted = false;
      }
    } catch (error) {
      report.safety.active_config_unchanged = false;
      report.error ??= error instanceof Error ? error.message : String(error);
      report.success = false;
      report.status = 'failed';
      report.decision.accepted = false;
    }
    if (isolatedSourcesRoot && existsSync(isolatedSourcesRoot)) {
      try {
        makeTreeWritable(isolatedSourcesRoot);
      } catch (error) {
        report.error ??= error instanceof Error ? error.message : String(error);
        report.success = false;
        report.status = 'failed';
        report.decision.accepted = false;
      }
    }
    try {
      report.safety.disposable_workspace_deleted = cleanupWorkspace(temporaryRoot, workspace, workspaceId);
    } catch (error) {
      report.safety.disposable_workspace_deleted = false;
      report.error ??= error instanceof Error ? error.message : String(error);
      report.success = false;
      report.status = 'failed';
      report.decision.accepted = false;
    }
  }

  atomicWriteJson(reportPath, report);
  return report;
}

function printHelp() {
  process.stdout.write(`Usage: node tools/gbrain/gbrain-pack-v2-trial.mjs [--dry-run] [--snapshot <verified-backup>] [--timeout-ms 1200000]\n\n`);
  process.stdout.write('Runs gbrain-base-v2 only against a disposable clone of an ownership-verified PGLite snapshot.\n');
  process.stdout.write('The real trial writes ~/.gbrain/evals/minimalist-chat-pack-v2-trial.json and always removes the clone.\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = runPackTrial(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.success || (!report.dry_run && !report.decision.accepted)) process.exitCode = 1;
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirect) main();
