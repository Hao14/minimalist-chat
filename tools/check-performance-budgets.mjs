import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const DIST_URL = new URL('../dist/', import.meta.url);
const ASSETS_URL = new URL('./assets/', DIST_URL);
const assetNames = readdirSync(ASSETS_URL);

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

const files = {
  main: assetMatching(/^main-[\w-]+\.js$/),
  react: assetMatching(/^vendor-react-[\w-]+\.js$/),
  firebaseStartup: assetMatching(/^vendor-firebase-startup-[\w-]+\.js$/),
  marketing: assetMatching(/^MarketingPages-[\w-]+\.js$/),
  login: assetMatching(/^LoginPage-[\w-]+\.js$/),
  // Rollup names this shared login helper after either source module depending
  // on which one owns the first cross-route import in the current build.
  authHelpers: assetMatching(/^(?:authSessionRecovery|promiseTimeout)-[\w-]+\.js$/),
  chatPage: assetMatching(/^ChatPage-[\w-]+\.js$/),
  chatApp: assetMatching(/^chatApp-[\w-]+\.js$/),
  chatPageCss: assetMatching(/^ChatPage-[\w-]+\.css$/),
  chatAppCss: assetMatching(/^chatApp-[\w-]+\.css$/),
  baseCss: new URL('./base.css', DIST_URL),
  featuresCss: new URL('./features.css', DIST_URL),
  indexHtml: new URL('./index.html', DIST_URL),
};

const checks = [
  {
    name: 'largest JavaScript chunk',
    value: Math.max(...assetNames.filter((name) => name.endsWith('.js')).map((name) => gzipKib(new URL(`./assets/${name}`, DIST_URL)))),
    budget: 125,
  },
  {
    name: 'marketing route JavaScript',
    value: sumGzipKib([files.main, files.react, files.marketing]),
    budget: 110,
  },
  {
    name: 'login route JavaScript',
    value: sumGzipKib([files.main, files.react, files.firebaseStartup, files.login, files.authHelpers]),
    budget: 195,
  },
  {
    name: 'signed-in chat core JavaScript',
    value: sumGzipKib([files.main, files.react, files.firebaseStartup, files.chatPage, files.chatApp]),
    budget: 330,
  },
  {
    name: 'signed-in chat core CSS',
    value: sumGzipKib([files.baseCss, files.featuresCss, files.chatPageCss, files.chatAppCss]),
    budget: 225,
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
  console.log(`${ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.value.toFixed(1)} KiB gzip / ${check.budget} KiB`);
}

if (failed) {
  console.error('Performance budget exceeded. Split or defer the regression before raising a budget.');
  process.exitCode = 1;
}
