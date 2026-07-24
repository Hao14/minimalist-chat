import { readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';

const DEFAULT_EXCLUDES = new Set([
  '.git',
  '.gbrain',
  '.obsidian',
  'graphify-out',
  'node_modules',
  'skills',
]);

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from',
  'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my',
  'of', 'on', 'or', 'our', 'should', 'that', 'the', 'their', 'them', 'this', 'to', 'was',
  'were', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'without', 'would', 'you',
]);

function unquote(value) {
  const trimmed = String(value ?? '').trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function normalizeAuthorityText(value) {
  return String(value ?? '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function meaningfulTokens(value) {
  return normalizeAuthorityText(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function parseInlineList(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return trimmed ? [unquote(trimmed)] : [];
  }
  return trimmed
    .slice(1, -1)
    .split(',')
    .map((item) => unquote(item))
    .filter(Boolean);
}

export function parseAuthorityFrontmatter(markdown) {
  const normalized = String(markdown ?? '').replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) {
    return {};
  }
  const end = normalized.indexOf('\n---', 3);
  if (end < 0) {
    return {};
  }

  const metadata = {};
  for (const line of normalized.slice(3, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2];
    if (key === 'aliases') {
      metadata.aliases = parseInlineList(value);
    } else if (key === 'canonical') {
      metadata.canonical = /^(?:true|yes|1)$/i.test(unquote(value));
    } else if (['title', 'status', 'authority', 'source_kind'].includes(key)) {
      metadata[key] = unquote(value);
    }
  }
  return metadata;
}

export function slugFromRelativePath(filePath) {
  const withoutExtension = filePath.slice(0, filePath.length - extname(filePath).length);
  return withoutExtension
    .split(/[\\/]+/)
    .map((part) => String(part)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      // Match GBrain's Markdown importer: dots, underscores, and existing
      // hyphens remain meaningful after the final .md suffix is removed.
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, ''))
    .filter(Boolean)
    .join('/');
}

export function slugFromCodePath(filePath) {
  return String(filePath)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // GBrain's code strategy flattens directories/extensions to hyphens but
    // preserves underscores inside authored path segments.
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildCodeAuthorityCatalog({ sourceId, sourceRoot, files } = {}) {
  if (typeof sourceId !== 'string' || !sourceId.trim()) {
    throw new Error('sourceId is required to build a code authority catalog.');
  }
  if (typeof sourceRoot !== 'string' || !sourceRoot.trim()) {
    throw new Error('sourceRoot is required to build a code authority catalog.');
  }
  if (!Array.isArray(files)) throw new Error('files must be an array.');

  const absoluteRoot = resolve(sourceRoot);
  const catalog = new Map();
  for (const value of [...files].map(String).sort()) {
    const relativePath = value.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!relativePath || relativePath.startsWith('/') || relativePath.split('/').includes('..')) continue;
    const absolutePath = resolve(absoluteRoot, relativePath);
    const containment = relative(absoluteRoot, absolutePath);
    if (containment.startsWith('..') || resolve(absolutePath) === absoluteRoot) continue;
    const slug = slugFromCodePath(relativePath);
    if (!slug || catalog.has(`${sourceId}::${slug}`)) continue;
    catalog.set(`${sourceId}::${slug}`, {
      source_id: sourceId,
      slug,
      path: relativePath,
      absolute_path: absolutePath,
      authority_root: absoluteRoot,
      title: relativePath.split('/').at(-1),
      status: 'current',
      canonical: true,
      authority: 'canonical',
      source_kind: 'code',
    });
  }
  return catalog;
}

export function loadCodeAuthorityCatalog({ sourceId, manifestPath } = {}) {
  if (typeof manifestPath !== 'string' || !manifestPath.trim()) {
    throw new Error('manifestPath is required to load a code authority catalog.');
  }
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8').replace(/^\uFEFF/, ''));
  if (manifest?.schema_version !== 1 || manifest?.mirror_kind !== 'minimalist-chat-code') {
    throw new Error('Unsupported Minimalist Chat code mirror manifest.');
  }
  return buildCodeAuthorityCatalog({
    sourceId,
    sourceRoot: manifest.source_root,
    files: manifest.files,
  });
}

function walkMarkdownFiles(root, include, excludes) {
  const roots = include?.length ? include.map((entry) => resolve(root, entry)) : [root];
  const files = [];
  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || excludes.has(entry.name)) continue;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        files.push(absolutePath);
      }
    }
  };
  roots.forEach(visit);
  return files;
}

export function loadMarkdownAuthorityCatalog({
  sourceId,
  root,
  include = null,
  exclude = [],
} = {}) {
  if (typeof sourceId !== 'string' || !sourceId.trim()) {
    throw new Error('sourceId is required to load an authority catalog.');
  }
  if (typeof root !== 'string' || !root.trim()) {
    throw new Error('root is required to load an authority catalog.');
  }

  const absoluteRoot = resolve(root);
  const excludes = new Set([...DEFAULT_EXCLUDES, ...exclude]);
  const catalog = new Map();
  for (const absolutePath of walkMarkdownFiles(absoluteRoot, include, excludes)) {
    const relativePath = relative(absoluteRoot, absolutePath).split(sep).join('/');
    const slug = slugFromRelativePath(relativePath);
    const frontmatter = parseAuthorityFrontmatter(readFileSync(absolutePath, 'utf8'));
    catalog.set(`${sourceId}::${slug}`, {
      ...frontmatter,
      source_id: sourceId,
      slug,
      path: relativePath,
      absolute_path: absolutePath,
      authority_root: absoluteRoot,
      title: frontmatter.title || relativePath.slice(0, -extname(relativePath).length).split('/').at(-1),
    });
  }
  return catalog;
}

export function mergeAuthorityCatalogs(...catalogs) {
  const merged = new Map();
  for (const catalog of catalogs) {
    for (const [key, value] of catalog ?? []) merged.set(key, value);
  }
  return merged;
}

export function authorityMetadataForResult(result, catalog = new Map()) {
  const key = `${result.source_id}::${result.slug}`;
  const catalogMetadata = catalog?.get(key) ?? {};
  const lastSegment = String(result.slug ?? '').split('/').at(-1) ?? '';
  return {
    source_id: result.source_id,
    slug: result.slug,
    path: catalogMetadata.path || result.path || result.slug,
    absolute_path: catalogMetadata.absolute_path || result.absolute_path || result.source_path || null,
    authority_root: catalogMetadata.authority_root || null,
    title: catalogMetadata.title || result.title || lastSegment,
    status: catalogMetadata.status || result.status || '',
    aliases: catalogMetadata.aliases || result.aliases || [],
    canonical: catalogMetadata.canonical ?? result.canonical ?? false,
    authority: catalogMetadata.authority || result.authority || '',
    source_kind: catalogMetadata.source_kind || result.source_kind || '',
  };
}

function overlapRatio(queryTokens, candidateTokens) {
  if (candidateTokens.length === 0) return 0;
  const querySet = new Set(queryTokens);
  return new Set(candidateTokens.filter((token) => querySet.has(token))).size / new Set(candidateTokens).size;
}

function authoritySignals(query, result, metadata) {
  const queryNormalized = normalizeAuthorityText(query);
  const queryTokens = meaningfulTokens(query);
  const titleNormalized = normalizeAuthorityText(metadata.title);
  const titleTokens = meaningfulTokens(metadata.title);
  const pathTokens = meaningfulTokens(metadata.path);
  const aliasNormalized = metadata.aliases.map(normalizeAuthorityText).filter(Boolean);
  const status = normalizeAuthorityText(metadata.status);
  const authority = normalizeAuthorityText(metadata.authority);
  const pathNormalized = normalizeAuthorityText(metadata.path);
  const sourceKind = normalizeAuthorityText(metadata.source_kind);

  const exactTitle = Boolean(titleNormalized) && queryNormalized === titleNormalized;
  const titlePhrase = Boolean(titleNormalized) && queryNormalized.includes(titleNormalized);
  const aliasPhrase = aliasNormalized.some((alias) => queryNormalized === alias || queryNormalized.includes(alias));
  const titleOverlap = overlapRatio(queryTokens, titleTokens);
  const pathOverlap = overlapRatio(queryTokens, pathTokens);
  const current = status === 'active' || status === 'current';
  const verified = status.startsWith('verified');
  const archived = status === 'archived' || /(?:^|\s)legacy(?:\s|$)/.test(pathNormalized);
  const currentPath = /(?:^|\s)current(?:\s|$)/.test(pathNormalized);
  const canonical = Boolean(metadata.canonical)
    || authority === 'canonical'
    || sourceKind === 'canonical';

  const boost = (exactTitle ? 4 : 0)
    + (!exactTitle && titlePhrase ? 2.5 : 0)
    + (aliasPhrase ? 2.25 : 0)
    + (titleOverlap * 2)
    + (pathOverlap * 0.75)
    + (current ? 0.5 : 0)
    + (verified ? 0.35 : 0)
    + (currentPath ? 0.35 : 0)
    + (canonical ? 0.75 : 0)
    - (archived ? 5 : 0);

  return {
    exact_title: exactTitle,
    title_phrase: titlePhrase,
    alias_phrase: aliasPhrase,
    title_overlap: Number(titleOverlap.toFixed(4)),
    path_overlap: Number(pathOverlap.toFixed(4)),
    current,
    verified,
    canonical,
    archived,
    boost: Number(boost.toFixed(4)),
  };
}

export function rankByAuthority(query, results, { catalog = new Map() } = {}) {
  if (!Array.isArray(results)) throw new TypeError('results must be an array.');
  if (results.length < 2) {
    return results.map((result, index) => ({
      ...result,
      authority_rank: index + 1,
      original_rank: index + 1,
      authority_score: 1,
      authority_signals: authoritySignals(query, result, authorityMetadataForResult(result, catalog)),
    }));
  }

  const finiteScores = results.map((result) => Number(result.score)).filter(Number.isFinite);
  const minimum = finiteScores.length ? Math.min(...finiteScores) : 0;
  const maximum = finiteScores.length ? Math.max(...finiteScores) : 0;
  const range = maximum - minimum;

  const scored = results
    .map((result, index) => {
      const metadata = authorityMetadataForResult(result, catalog);
      const signals = authoritySignals(query, result, metadata);
      const rawScore = Number(result.score);
      const normalizedRetrievalScore = Number.isFinite(rawScore) && range > 0
        ? (rawScore - minimum) / range
        : 0;
      const rankPreservation = 1 - (index / results.length);
      return {
        ...result,
        original_rank: index + 1,
        authority_score: Number((normalizedRetrievalScore * 3 + rankPreservation + signals.boost).toFixed(6)),
        authority_signals: signals,
      };
    })
    .sort((left, right) => (
      right.authority_score - left.authority_score
      || left.original_rank - right.original_rank
      || String(left.slug).localeCompare(String(right.slug))
    ));

  // Native GBrain retrieval may return multiple chunks for one document. Keep
  // the highest-ranked occurrence so callers receive unique document evidence
  // and citation numbering cannot repeat the same source/slug identity.
  const seen = new Set();
  return scored
    .filter((result) => {
      const key = `${result.source_id}::${result.slug}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((result, index) => ({ ...result, authority_rank: index + 1 }));
}
