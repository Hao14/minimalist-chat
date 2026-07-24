import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const DIST_URL = new URL('../dist/', import.meta.url);
const ASSETS_URL = new URL('./assets/', DIST_URL);
const MANIFEST_URL = new URL('./.vite/manifest.json', DIST_URL);
const assetNames = readdirSync(ASSETS_URL);
const manifest = JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));
const DEFERRED_DOCUMENT_PARSER = /^(?:pdf-|pdf\.worker\.min-|mammoth\.browser\.min-)/;

function assetMatching(pattern) {
  const matches = assetNames.filter((name) => pattern.test(name));
  if (matches.length !== 1) {
    throw new Error(`Expected one build asset matching ${pattern}, found ${matches.length}.`);
  }
  return new URL(`./assets/${matches[0]}`, DIST_URL);
}

function gzipKib(url) {
  return gzipSync(readFileSync(url)).byteLength / 1024;
}

function sumGzipKib(urls) {
  return urls.reduce((total, url) => total + gzipKib(url), 0);
}

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
    const description = [
      normalizedSource ? `source ending in ${source}` : '',
      name ? `name ${name}` : '',
    ].filter(Boolean).join(' or ');
    throw new Error(`Expected one manifest entry with ${description}, found ${matches.length}.`);
  }
  return matches[0];
}

function staticImportClosure(entryKeys) {
  const visitedEntries = new Set();
  const files = new Set();

  const visit = (key) => {
    if (!key || visitedEntries.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`Missing Vite manifest entry for ${key}.`);
    visitedEntries.add(key);
    if (entry.file?.endsWith('.js')) files.add(entry.file);
    (entry.imports || []).forEach(visit);
  };

  entryKeys.forEach(visit);
  return files;
}

function staticImportGzipKib(entryKeys) {
  return [...staticImportClosure(entryKeys)]
    .reduce((total, file) => total + gzipKib(new URL(`./${file}`, DIST_URL)), 0);
}

const routeEntries = {
  loader: manifestKey({ source: 'index.html' }),
  main: manifestKey({ source: 'src/main.jsx', name: 'main' }),
  // Manual chunks do not retain `src` in Vite's manifest. Their configured
  // Rollup names are stable across hashed production builds.
  marketing: manifestKey({ source: 'src/pages/MarketingPages.jsx', name: 'MarketingPages' }),
  login: manifestKey({ source: 'src/pages/LoginPage.jsx', name: 'LoginPage' }),
  chatPage: manifestKey({ source: 'src/pages/ChatPage.jsx', name: 'ChatPage' }),
  chatApp: manifestKey({ source: 'src/features/shell/chatApp.js', name: 'chatApp' }),
  chatCore: manifestKey({ source: 'src/features/chat-core/ChatCore.jsx', name: 'ChatCore' }),
  // These lazy components render as part of the normal Chat viewport, so count
  // them as startup work even though Vite emits separate chunks for them.
  messageTimeline: manifestKey({
    source: 'src/features/chat-core/MessageTimeline.jsx',
    name: 'MessageTimeline',
  }),
  roomHeaderContext: manifestKey({
    source: 'src/features/chat-core/RoomHeaderContext.jsx',
    name: 'RoomHeaderContext',
  }),
  quickReplies: manifestKey({
    source: 'src/features/chat-core/QuickReplies.jsx',
    name: 'QuickReplies',
  }),
  // Inbox badges and notifications subscribe automatically after Chat becomes
  // visible, so include their delayed handoff in the always-running shell.
  notificationService: manifestKey({
    source: 'src/features/notifications/notificationService.js',
    name: 'notificationService',
  }),
  pmInboxService: manifestKey({
    source: 'src/features/private-messages/pmInboxService.js',
    name: 'pmInboxService',
  }),
};

const files = {
  mainCss: assetMatching(/^main-[\w-]+\.css$/),
  chatCoreCss: assetMatching(/^ChatCore-[\w-]+\.css$/),
  messageTimelineCss: assetMatching(/^MessageTimeline-[\w-]+\.css$/),
  roomHeaderContextCss: assetMatching(/^RoomHeaderContext-[\w-]+\.css$/),
  quickRepliesCss: assetMatching(/^QuickReplies-[\w-]+\.css$/),
  deferredChatSurfacesCss: assetMatching(/^ChatDeferredSurfaces-[\w-]+\.css$/),
  pdfParser: assetMatching(/^pdf-[\w-]+\.js$/),
  pdfWorker: assetMatching(/^pdf\.worker\.min-[\w-]+\.mjs$/),
  docxParser: assetMatching(/^mammoth\.browser\.min-[\w-]+\.js$/),
  baseCss: new URL('./base.css', DIST_URL),
  desktopCss: new URL('./desktop.css', DIST_URL),
  mobileCss: new URL('./mobile.css', DIST_URL),
  mobileDockCss: new URL('./mobile-app-dock.css', DIST_URL),
  defaultThemeCss: new URL('./themes/light.css', DIST_URL),
  featuresCss: new URL('./features.css', DIST_URL),
  iconFont: new URL('./phosphor-bold-subset.woff2', DIST_URL),
  indexHtml: new URL('./index.html', DIST_URL),
};

const initialChatJavaScript = staticImportGzipKib([
  routeEntries.loader,
  routeEntries.main,
  routeEntries.chatPage,
  routeEntries.chatApp,
  routeEntries.chatCore,
  routeEntries.messageTimeline,
  routeEntries.roomHeaderContext,
  routeEntries.quickReplies,
  routeEntries.notificationService,
  routeEntries.pmInboxService,
]);

const initialChatCss = sumGzipKib([
  files.baseCss,
  files.mainCss,
  files.chatCoreCss,
  files.messageTimelineCss,
  files.roomHeaderContextCss,
  files.quickRepliesCss,
  files.defaultThemeCss,
]) + Math.max(
  gzipKib(files.desktopCss),
  sumGzipKib([files.mobileCss, files.mobileDockCss]),
);

const checks = [
  {
    name: 'largest JavaScript chunk',
    // PDF.js and Mammoth are opt-in parsers fetched only after a matching file
    // is selected. Track them below without weakening the application budget.
    value: Math.max(...assetNames
      .filter((name) => name.endsWith('.js') && !DEFERRED_DOCUMENT_PARSER.test(name))
      .map((name) => gzipKib(new URL(`./assets/${name}`, DIST_URL)))),
    budget: 121,
  },
  {
    name: 'deferred PDF parser',
    value: sumGzipKib([files.pdfParser, files.pdfWorker]),
    budget: 550,
  },
  {
    name: 'deferred DOCX parser',
    value: gzipKib(files.docxParser),
    budget: 135,
  },
  {
    name: 'marketing route JavaScript',
    value: staticImportGzipKib([routeEntries.loader, routeEntries.main, routeEntries.marketing]),
    budget: 110,
  },
  {
    name: 'login route JavaScript',
    value: staticImportGzipKib([routeEntries.loader, routeEntries.main, routeEntries.login]),
    budget: 190,
  },
  {
    name: 'initial signed-in Chat JavaScript',
    value: initialChatJavaScript,
    target: 300,
    warning: 350,
    budget: 450,
  },
  {
    name: 'initial signed-in Chat CSS',
    value: initialChatCss,
    budget: 125,
  },
  {
    name: 'deferred feature CSS',
    value: gzipKib(files.featuresCss),
    budget: 120,
  },
  {
    name: 'deferred Chat surfaces CSS',
    value: gzipKib(files.deferredChatSurfacesCss),
    budget: 35,
  },
  {
    name: 'icon subset font',
    value: gzipKib(files.iconFont),
    // Complete referenced-glyph coverage is 24.85 KiB gzip. Keep a narrow
    // ceiling here so blank controls cannot be "fixed" by silently dropping
    // icons from the generated subset.
    budget: 26,
  },
  {
    name: 'entry HTML',
    value: gzipKib(files.indexHtml),
    budget: 14,
  },
];

let failed = false;
for (const check of checks) {
  const ok = check.value <= check.budget;
  failed ||= !ok;
  if (check.target && check.warning) {
    const status = !ok
      ? 'FAIL'
      : check.value > check.warning
        ? 'WARN'
        : check.value > check.target
          ? 'NOTICE'
          : 'PASS';
    console.log(
      `${status} ${check.name}: ${check.value.toFixed(1)} KiB gzip `
      + `(target ${check.target}, warning ${check.warning}, CI ceiling ${check.budget} KiB)`,
    );
    continue;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.value.toFixed(1)} KiB gzip / ${check.budget} KiB`);
}

if (failed) {
  console.error('Performance budget exceeded. Split or defer the regression before raising a budget.');
  process.exitCode = 1;
}
