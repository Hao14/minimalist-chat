import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';
import {
  slugFromCodePath,
  slugFromRelativePath,
} from './gbrain-authority-ranker.mjs';

export const SOURCE_PROVENANCE_METHOD = 'trusted-local-source-catalog-v1';
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_FILES = 50_000;
const MAX_SOURCE_FILE_BYTES = 64 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MIRROR_KIND_BY_SOURCE_KIND = Object.freeze({
  markdown: 'minimalist-chat-vault',
  code: 'minimalist-chat-code',
});

function normalizedPath(value) {
  const normalized = resolve(String(value ?? '')).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function safeManifestPath(value) {
  if (typeof value !== 'string' || !value.trim() || isAbsolute(value)) return null;
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.split('/').some((part) => !part || part === '..')) return null;
  return normalized;
}

function defaultDefinitions() {
  return {
    default: {
      kind: 'markdown',
      root: '../../Minimalist-chat-vault',
    },
  };
}

export function defaultGBrainSourcesRoot(environment = process.env) {
  const gbrainDataDirectory = environment.GBRAIN_HOME
    ? resolve(environment.GBRAIN_HOME, '.gbrain')
    : resolve(homedir(), '.gbrain');
  return resolve(gbrainDataDirectory, 'sources');
}

function discoverSourceManifests(sourcesRoot) {
  if (!existsSync(sourcesRoot)) return [];
  const manifests = [];
  for (const entry of readdirSync(sourcesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const manifestPath = resolve(sourcesRoot, entry.name, '.gbrain-meta', 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifestInfo = lstatSync(manifestPath);
      if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > MAX_MANIFEST_BYTES) continue;
      const manifestBytes = readFileSync(manifestPath);
      const manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''));
      if (
        manifest?.schema_version !== 1
        || typeof manifest.mirror_kind !== 'string'
        || typeof manifest.source_root !== 'string'
        || !Array.isArray(manifest.files)
      ) continue;
      manifests.push({
        manifest,
        manifestPath,
        manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
        mirrorRoot: resolve(dirname(manifestPath), '..'),
      });
    } catch {
      // An unreadable manifest cannot be used as trusted provenance.
    }
  }
  return manifests;
}

function unavailableCatalog(sourceId, kind, reason) {
  return {
    source_id: sourceId,
    kind,
    status: 'unavailable',
    method: SOURCE_PROVENANCE_METHOD,
    manifest_path: null,
    mirror_kind: null,
    slugs: new Set(),
    verify_slug: () => false,
    reason,
  };
}

function normalContainedFile(root, relativePath) {
  const candidate = resolve(root, relativePath);
  const containment = relative(resolve(root), candidate);
  if (containment.startsWith('..') || isAbsolute(containment)) return null;
  const info = lstatSync(candidate);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SOURCE_FILE_BYTES) return null;
  return { path: candidate, size: info.size };
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function discoverMirrorContentFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.gbrain-meta' || entry.name === '.gitignore') continue;
      if (entry.isSymbolicLink()) throw new Error('source mirror contains a symlink');
      const target = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(relative(root, target).replaceAll('\\', '/'));
      else throw new Error('source mirror contains an unsupported entry');
      if (files.length > MAX_SOURCE_FILES) throw new Error('source mirror exceeds its file limit');
    }
  };
  visit(resolve(root));
  return files.sort((left, right) => left.localeCompare(right));
}

function sameStringSet(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function catalogBaseIsCurrent(catalog) {
  try {
    const manifestInfo = lstatSync(catalog.manifest_path);
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > MAX_MANIFEST_BYTES) return false;
    if (sha256File(catalog.manifest_path) !== catalog.manifest_sha256) return false;
    const discovered = discoverMirrorContentFiles(catalog.mirror_root);
    return sameStringSet(discovered, catalog.declared_files);
  } catch {
    return false;
  }
}

function sourceRecordIsCurrent(record) {
  try {
    const mirror = normalContainedFile(record.mirror_root, record.relative_path);
    if (!mirror || mirror.size !== record.size || sha256File(mirror.path) !== record.sha256) return false;
    if (!record.verify_current_sources) return true;
    const source = normalContainedFile(record.source_root, record.relative_path);
    return Boolean(source && sha256File(source.path) === record.sha256);
  } catch {
    return false;
  }
}

function catalogFromManifest(sourceId, definition, record, { verifyCurrentSources }) {
  try {
    const { manifest } = record;
    const expectedMirrorKind = MIRROR_KIND_BY_SOURCE_KIND[definition.kind];
    if (
      manifest.schema_version !== 1
      || manifest.mirror_kind !== expectedMirrorKind
      || !isAbsolute(manifest.source_root)
      || manifest.files.length > MAX_SOURCE_FILES
      || Number(manifest.file_count) !== manifest.files.length
      || !Number.isSafeInteger(Number(manifest.total_bytes))
      || Number(manifest.total_bytes) < 0
      || !manifest.file_sha256
      || typeof manifest.file_sha256 !== 'object'
      || Array.isArray(manifest.file_sha256)
    ) return unavailableCatalog(sourceId, definition.kind, 'The matched manifest is not an ownership-verified hash inventory.');

    const sourceRoot = resolve(manifest.source_root);
    const mirrorRootInfo = lstatSync(record.mirrorRoot);
    if (
      !mirrorRootInfo.isDirectory()
      || mirrorRootInfo.isSymbolicLink()
    ) return unavailableCatalog(sourceId, definition.kind, 'The matched source roots are not normal directories.');
    if (verifyCurrentSources) {
      const sourceRootInfo = lstatSync(sourceRoot);
      if (!sourceRootInfo.isDirectory() || sourceRootInfo.isSymbolicLink()) {
        return unavailableCatalog(sourceId, definition.kind, 'The current source root is not a normal directory.');
      }
    }

    const slugForPath = definition.kind === 'code' ? slugFromCodePath : slugFromRelativePath;
    const declared = new Set();
    const recordsBySlug = new Map();
    let totalBytes = 0;
    for (const value of manifest.files) {
      const filePath = safeManifestPath(value);
      if (!filePath || declared.has(filePath)) {
        return unavailableCatalog(sourceId, definition.kind, 'The matched manifest contains an unsafe or duplicate file path.');
      }
      declared.add(filePath);
      if (!Object.prototype.hasOwnProperty.call(manifest.file_sha256, filePath)) {
        return unavailableCatalog(sourceId, definition.kind, 'The matched manifest is missing a declared file hash.');
      }
      const expectedHash = String(manifest.file_sha256[filePath] ?? '');
      if (!SHA256_PATTERN.test(expectedHash)) {
        return unavailableCatalog(sourceId, definition.kind, 'The matched manifest contains an invalid file hash.');
      }
      const mirrorFile = normalContainedFile(record.mirrorRoot, filePath);
      const sourceFile = verifyCurrentSources ? normalContainedFile(sourceRoot, filePath) : null;
      if (
        !mirrorFile
        || sha256File(mirrorFile.path) !== expectedHash
        || (verifyCurrentSources && (!sourceFile || sha256File(sourceFile.path) !== expectedHash))
      ) return unavailableCatalog(sourceId, definition.kind, 'source provenance hash mismatch in the mirror or current source.');
      totalBytes += mirrorFile.size;
      const slug = slugForPath(filePath);
      if (!slug) continue;
      const bucket = recordsBySlug.get(slug) ?? [];
      bucket.push({
        relative_path: filePath,
        sha256: expectedHash,
        size: mirrorFile.size,
        mirror_root: record.mirrorRoot,
        source_root: sourceRoot,
        verify_current_sources: verifyCurrentSources,
      });
      recordsBySlug.set(slug, bucket);
    }
    const hashKeys = Object.keys(manifest.file_sha256);
    if (hashKeys.length !== declared.size || hashKeys.some((key) => !declared.has(key))) {
      return unavailableCatalog(sourceId, definition.kind, 'The manifest hash keys do not match its file inventory.');
    }
    if (totalBytes !== Number(manifest.total_bytes)) {
      return unavailableCatalog(sourceId, definition.kind, 'The manifest byte count does not match its verified files.');
    }
    const declaredFiles = [...declared].sort((left, right) => left.localeCompare(right));
    if (!sameStringSet(discoverMirrorContentFiles(record.mirrorRoot), declaredFiles)) {
      return unavailableCatalog(sourceId, definition.kind, 'The local mirror inventory contains undeclared or missing files.');
    }
    const slugs = new Set(
      [...recordsBySlug.entries()].filter(([, records]) => records.length === 1).map(([slug]) => slug),
    );
    const catalog = {
      source_id: sourceId,
      kind: definition.kind,
      status: 'ready',
      method: SOURCE_PROVENANCE_METHOD,
      manifest_path: record.manifestPath,
      manifest_sha256: record.manifestSha256,
      mirror_kind: manifest.mirror_kind,
      mirror_root: record.mirrorRoot,
      source_root: sourceRoot,
      verify_current_sources: verifyCurrentSources,
      declared_files: declaredFiles,
      slugs,
      reason: null,
    };
    catalog.verify_slug = (slug, cache = new Map()) => {
      const baseKey = `${catalog.manifest_path}::base`;
      if (!cache.has(baseKey)) cache.set(baseKey, catalogBaseIsCurrent(catalog));
      if (!cache.get(baseKey)) return false;
      const slugKey = `${catalog.manifest_path}::slug::${slug}`;
      if (!cache.has(slugKey)) {
        const records = recordsBySlug.get(slug) ?? [];
        cache.set(slugKey, records.length === 1 && sourceRecordIsCurrent(records[0]));
      }
      return cache.get(slugKey) === true;
    };
    return catalog;
  } catch {
    return unavailableCatalog(sourceId, definition.kind, 'The matched source manifest could not be verified safely.');
  }
}

export function loadSourceProvenanceCatalogs(qrels, qrelsPath, {
  sourcesRoot = defaultGBrainSourcesRoot(),
  verifyCurrentSources = true,
} = {}) {
  const definitions = qrels.sources ?? defaultDefinitions();
  const qrelsDirectory = dirname(resolve(qrelsPath));
  const manifests = discoverSourceManifests(resolve(sourcesRoot));
  const catalogs = new Map();

  for (const [sourceId, definition] of Object.entries(definitions)) {
    if (
      !definition
      || !['markdown', 'code'].includes(definition.kind)
      || typeof definition.root !== 'string'
      || !definition.root.trim()
    ) {
      catalogs.set(sourceId, unavailableCatalog(sourceId, definition?.kind ?? null, 'The qrels source definition is unsupported.'));
      continue;
    }

    const expectedRoot = normalizedPath(resolve(qrelsDirectory, definition.root));
    const matches = manifests.filter(({ manifest }) => normalizedPath(manifest.source_root) === expectedRoot);
    if (matches.length !== 1) {
      const reason = matches.length
        ? 'More than one local source manifest matches the declared source root.'
        : 'No local source manifest matches the declared source root.';
      catalogs.set(sourceId, unavailableCatalog(sourceId, definition.kind, reason));
      continue;
    }
    catalogs.set(sourceId, catalogFromManifest(sourceId, definition, matches[0], { verifyCurrentSources }));
  }
  return catalogs;
}

export function describeSourceProvenanceCatalogs(catalogs) {
  return Object.fromEntries([...catalogs.entries()].map(([sourceId, catalog]) => [sourceId, {
    status: catalog.status,
    kind: catalog.kind,
    method: catalog.method,
    mirror_kind: catalog.mirror_kind,
    manifest_path: catalog.manifest_path,
    slug_count: catalog.slugs.size,
    reason: catalog.reason,
  }]));
}

export function resolveResultSourceProvenance(results, catalogs, { requestedSourceId = null } = {}) {
  const verificationCache = new Map();
  return results.map((result) => {
    const slug = typeof result.slug === 'string' ? result.slug : '';
    const sourceIds = [...catalogs.entries()]
      .filter(([, catalog]) => (
        catalog.status === 'ready'
        && catalog.slugs.has(slug)
        && typeof catalog.verify_slug === 'function'
        && catalog.verify_slug(slug, verificationCache) === true
      ))
      .map(([sourceId]) => sourceId)
      .sort();
    const status = sourceIds.length === 1
      ? 'verified'
      : sourceIds.length > 1 ? 'ambiguous' : 'unresolved';
    return {
      ...result,
      requested_source_id: requestedSourceId ?? result.source_id ?? null,
      source_id: status === 'verified' ? sourceIds[0] : null,
      source_provenance: {
        method: SOURCE_PROVENANCE_METHOD,
        status,
        source_ids: sourceIds,
      },
    };
  });
}
