import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import {
  normalizeReleaseValue,
  resolveRumReleaseId,
  resolveSourceBuildNumber,
} from './tools/source-release-id.mjs';

const { version: packageVersion } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

function resolveBuildNumber(environment) {
  const suppliedBuildNumber = [
    environment.MINIMALIST_BUILD_NUMBER,
    environment.VITE_APP_BUILD_NUMBER,
    environment.GITHUB_RUN_NUMBER,
    environment.CI_PIPELINE_IID,
    environment.BUILD_BUILDID,
  ].map(normalizeReleaseValue).find(Boolean);

  return suppliedBuildNumber
    || resolveSourceBuildNumber({ environment, cwd: process.cwd() })
    || packageVersion;
}

function versionMutableBootstrapUrls(appBuildNumber) {
  const bootstrapBuild = String(appBuildNumber)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 80);
  const buildQuery = `&build=${encodeURIComponent(bootstrapBuild)}`;
  const mutableBootstrapUrls = [
    '/load-css.js?v=8',
    '/config.js?v=localai7',
  ];

  return {
    name: 'version-mutable-bootstrap-urls',
    apply: 'build',
    transformIndexHtml(html) {
      return mutableBootstrapUrls.reduce(
        (document, url) => document.replaceAll(url, `${url}${buildQuery}`),
        html,
      );
    },
  };
}

function emitHostingBuildInfo({
  appVersion,
  buildNumber,
  sourceRelease,
  publishedAt,
}) {
  return {
    name: 'emit-hosting-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.json',
        source: `${JSON.stringify({
          schemaVersion: 1,
          version: appVersion,
          buildNumber,
          sourceRelease,
          publishedAt,
        }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = {
    ...loadEnv(mode, process.cwd(), ''),
    ...process.env,
  };
  const appVersion = [
    environment.MINIMALIST_APP_VERSION,
    environment.VITE_APP_VERSION,
  ].map(normalizeReleaseValue).find(Boolean) || packageVersion;
  const appBuildNumber = resolveBuildNumber(environment);
  const sourceBuildNumber = resolveSourceBuildNumber({
    environment,
    cwd: process.cwd(),
  }) || packageVersion;
  const appRumReleaseId = resolveRumReleaseId({
    environment,
    appVersion,
    sourceBuildNumber,
    cwd: process.cwd(),
  });
  const configuredPublishTime = new Date(environment.MINIMALIST_PUBLISH_STARTED_AT || '');
  const publishedAt = Number.isNaN(configuredPublishTime.getTime())
    ? new Date().toISOString()
    : configuredPublishTime.toISOString();

  return {
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
      'import.meta.env.VITE_APP_BUILD_NUMBER': JSON.stringify(appBuildNumber),
      'import.meta.env.VITE_APP_RUM_RELEASE_ID': JSON.stringify(appRumReleaseId),
    },
    plugins: [
      react(),
      versionMutableBootstrapUrls(appBuildNumber),
      emitHostingBuildInfo({
        appVersion,
        buildNumber: appBuildNumber,
        sourceRelease: appRumReleaseId,
        publishedAt,
      }),
      (environment.ANALYZE === 'true' || mode === 'analyze')
        ? visualizer({
          filename: 'reports/bundle-stats.html',
          gzipSize: true,
          brotliSize: true,
          template: 'treemap',
        })
        : null,
    ].filter(Boolean),
    esbuild: {
      drop: ['debugger'],
      pure: ['console.log', 'console.debug', 'console.info'],
    },
    server: {
      host: true,
      watch: {
        // Generated .NET app hosts can be locked by Windows and crash Vite's watcher.
        ignored: [
          '**/tools/ai-analysis-app/bin/**',
          '**/tools/ai-analysis-app/obj/**',
        ],
      },
    },
    preview: {
      host: true,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      manifest: true,
      sourcemap: environment.BUILD_SOURCEMAP === 'true',
      // Keep the JavaScript and processed CSS floors aligned with the modern
      // selectors and color functions used by the public stylesheets.
      target: ['chrome111', 'edge111', 'firefox121', 'safari16.4'],
      cssTarget: ['chrome111', 'edge111', 'firefox121', 'safari16.4'],
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/');
            if (!normalized.includes('/node_modules/')) return undefined;
            if (/\/node_modules\/(react|react-dom|react-router|react-router-dom)\//.test(normalized)) return 'vendor-react';
            if (/\/node_modules\/(?:firebase\/(?:app|auth|database)|@firebase\/(?:app|auth|database|component|logger|util|webchannel-wrapper))\//.test(normalized)) {
              return 'vendor-firebase-startup';
            }
            if (/\/node_modules\/(?:firebase\/storage|@firebase\/storage)\//.test(normalized)) return 'vendor-firebase-storage';
            if (/\/node_modules\/(?:firebase\/messaging|@firebase\/messaging)\//.test(normalized)) return 'vendor-firebase-messaging';
            if (normalized.includes('/node_modules/firebase/') || normalized.includes('/node_modules/@firebase/')) return 'vendor-firebase-functions-other';
            if (normalized.includes('/node_modules/@phosphor-icons/')) return 'vendor-icons';
            return undefined;
          },
        },
      },
    },
  };
});
