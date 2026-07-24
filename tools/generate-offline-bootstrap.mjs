import { readFileSync, writeFileSync } from 'node:fs';

const DIST_URL = new URL('../dist/', import.meta.url);
const MANIFEST_URL = new URL('./.vite/manifest.json', DIST_URL);
const INDEX_URL = new URL('./index.html', DIST_URL);
const OUTPUT_URL = new URL('./offline-bootstrap.json', DIST_URL);

const manifest = JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));
const indexHtml = readFileSync(INDEX_URL, 'utf8');

function manifestKey({ source, name }) {
  const normalizedSource = source?.replaceAll('\\', '/');
  const matches = Object.entries(manifest)
    .filter(([key, entry]) => (
      (normalizedSource && (
        key.replaceAll('\\', '/').endsWith(normalizedSource)
        || entry.src?.replaceAll('\\', '/').endsWith(normalizedSource)
      ))
      || (name && entry.name === name)
    ))
    .map(([key]) => key);

  if (matches.length !== 1) {
    throw new Error(
      `Expected one offline bootstrap entry for ${source || name}, found ${matches.length}.`,
    );
  }
  return matches[0];
}

const routeEntries = [
  { id: 'document', key: manifestKey({ source: 'index.html' }) },
  { id: 'main', key: manifestKey({ source: 'src/main.jsx', name: 'main' }) },
  {
    id: 'service-worker-runtime',
    key: manifestKey({
      source: 'src/serviceWorkerRuntime.js',
      name: 'serviceWorkerRuntime',
    }),
  },
  { id: 'chat-page', key: manifestKey({ source: 'src/pages/ChatPage.jsx', name: 'ChatPage' }) },
  { id: 'chat-shell', key: manifestKey({ source: 'src/features/shell/chatApp.js', name: 'chatApp' }) },
  { id: 'chat-core', key: manifestKey({ source: 'src/features/chat-core/ChatCore.jsx', name: 'ChatCore' }) },
  {
    id: 'message-timeline',
    key: manifestKey({
      source: 'src/features/chat-core/MessageTimeline.jsx',
      name: 'MessageTimeline',
    }),
  },
  {
    id: 'room-header',
    key: manifestKey({
      source: 'src/features/chat-core/RoomHeaderContext.jsx',
      name: 'RoomHeaderContext',
    }),
  },
  {
    id: 'quick-replies',
    key: manifestKey({
      source: 'src/features/chat-core/QuickReplies.jsx',
      name: 'QuickReplies',
    }),
  },
];

function assertDynamicImport(parentId, childId) {
  const parent = routeEntries.find((entry) => entry.id === parentId);
  const child = routeEntries.find((entry) => entry.id === childId);
  if (!parent || !child || !manifest[parent.key]?.dynamicImports?.includes(child.key)) {
    throw new Error(`Offline Chat bootstrap edge is missing: ${parentId} -> ${childId}.`);
  }
}

[
  ['document', 'main'],
  ['main', 'service-worker-runtime'],
  ['main', 'chat-page'],
  ['chat-page', 'chat-shell'],
  ['chat-shell', 'chat-core'],
  ['chat-core', 'message-timeline'],
  ['chat-core', 'room-header'],
  ['chat-core', 'quick-replies'],
].forEach(([parentId, childId]) => assertDynamicImport(parentId, childId));

const assets = new Set();
const visited = new Set();

function addAsset(path) {
  if (!path) return;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  assets.add(normalized);
}

function visitManifestEntry(key) {
  if (!key || visited.has(key)) return;
  const entry = manifest[key];
  if (!entry) throw new Error(`Missing Vite manifest entry for ${key}.`);
  visited.add(key);
  addAsset(entry.file);
  (entry.css || []).forEach(addAsset);
  (entry.assets || []).forEach(addAsset);
  (entry.imports || []).forEach(visitManifestEntry);
}

routeEntries.forEach(({ key }) => visitManifestEntry(key));

const staticBootstrapPattern = /^\/(?:base\.css|desktop\.css|mobile\.css|mobile-app-dock\.css|load-css\.js|config\.js|manifest\.json|icon\.svg|phosphor-bold-subset\.css|themes\/(?:light|dark|gray|modern|codex)\.css)(?:[?#][^"'<>]*)?$/;
const attributePattern = /\b(?:href|src|data-href)=["']([^"'<>]+)["']/gi;
let attributeMatch = attributePattern.exec(indexHtml);
while (attributeMatch) {
  if (staticBootstrapPattern.test(attributeMatch[1])) addAsset(attributeMatch[1]);
  attributeMatch = attributePattern.exec(indexHtml);
}
addAsset('/phosphor-bold-subset.woff2');

const entrypoints = Object.fromEntries(routeEntries.map(({ id, key }) => {
  const file = manifest[key]?.file;
  if (!/^assets\/.+-[A-Za-z0-9_-]{8,}\.(?:css|js|mjs)$/i.test(file || '')) {
    throw new Error(`Offline Chat entrypoint is not content-hashed: ${id}.`);
  }
  return [id, `/${file}`];
}));

writeFileSync(OUTPUT_URL, `${JSON.stringify({
  schemaVersion: 2,
  route: 'chat',
  entrypoints,
  assets: [...assets].sort(),
}, null, 2)}\n`);

process.stdout.write(`Generated offline Chat bootstrap with ${assets.size} assets.\n`);
