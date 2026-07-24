#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildHealthSnapshot } from './gbrain-health-data.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..', '..');
const dashboardRoot = path.join(scriptDirectory, 'dashboard', 'dist');
const userProfile = process.env.USERPROFILE;
const args = process.argv.slice(2);

function getArgument(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

const host = getArgument('--host', '127.0.0.1');
const port = Number(getArgument('--port', '4317'));
if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
  throw new Error('The GBrain health dashboard may bind only to loopback.');
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Dashboard port must be an integer from 1024 through 65535.');
}
if (!userProfile) {
  throw new Error('USERPROFILE is required.');
}

const MIME = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

const DEFAULT_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const GRAPH_REPORT_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const GRAPH_VENDOR_URL = 'https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js';
const LOCAL_GRAPH_VENDOR_URL = '/vendor/vis-network.min.js';
const localGraphVendorPath = path.join(repoRoot, 'node_modules', 'vis-network', 'standalone', 'umd', 'vis-network.min.js');

export function isAllowedHostHeader(value, listenHost = host, listenPort = port) {
  if (typeof value !== 'string') return false;
  const expected = listenHost === '::1'
    ? `[::1]:${listenPort}`
    : `${listenHost}:${listenPort}`;
  return value === expected;
}

export function stripSourceMapDirective(source) {
  return source.replace(/(?:\r?\n)?\/\/[#@]\s*sourceMappingURL=[^\r\n]*(?:\r?\n)?$/u, '\n');
}

export function rewriteGraphVendorReferences(report, vendorSource) {
  const integrity = `sha384-${createHash('sha384').update(vendorSource).digest('base64')}`;
  return report
    .replaceAll(GRAPH_VENDOR_URL, LOCAL_GRAPH_VENDOR_URL)
    .replace(
      /(<script\s+src="\/vendor\/vis-network\.min\.js"\s+integrity=")[^"]+("\s+crossorigin="anonymous"><\/script>)/u,
      (_match, prefix, suffix) => `${prefix}${integrity}${suffix}`,
    );
}

async function readLocalGraphVendor() {
  const stat = await lstat(localGraphVendorPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) {
    throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
  }
  return stripSourceMapDirective(await readFile(localGraphVendorPath, 'utf8'));
}

function applySecurityHeaders(response, contentType, contentSecurityPolicy = DEFAULT_CSP) {
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', contentSecurityPolicy);
}

async function sendFile(response, filePath, contentType, contentSecurityPolicy = DEFAULT_CSP) {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
  }
  response.statusCode = 200;
  applySecurityHeaders(response, contentType, contentSecurityPolicy);
  createReadStream(filePath).pipe(response);
}

async function handleRequest(request, response) {
  if (!isAllowedHostHeader(request.headers.host)) {
    response.statusCode = 421;
    applySecurityHeaders(response, 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: 'misdirected_request' }));
    return;
  }
  if (request.method !== 'GET') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET');
    response.end('Method not allowed');
    return;
  }
  const url = new URL(request.url, 'http://127.0.0.1');

  if (url.pathname === '/api/health') {
    const snapshot = await buildHealthSnapshot({ repoRoot, userProfile });
    response.statusCode = 200;
    applySecurityHeaders(response, 'application/json; charset=utf-8');
    response.end(JSON.stringify(snapshot));
    return;
  }
  if (url.pathname === '/reports/evaluation.json') {
    await sendFile(response, path.join(userProfile, '.gbrain', 'evals', 'minimalist-chat-latest.json'), 'application/json; charset=utf-8');
    return;
  }
  if (url.pathname === '/reports/graph.html') {
    const graphReportPath = path.join(repoRoot, 'Minimalist-chat-vault', 'graphify-out', 'graph.html');
    const stat = await lstat(graphReportPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) {
      throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
    }
    const vendor = await readLocalGraphVendor();
    const report = rewriteGraphVendorReferences(await readFile(graphReportPath, 'utf8'), vendor);
    response.statusCode = 200;
    applySecurityHeaders(response, 'text/html; charset=utf-8', GRAPH_REPORT_CSP);
    response.end(report);
    return;
  }
  if (url.pathname === LOCAL_GRAPH_VENDOR_URL) {
    const vendor = await readLocalGraphVendor();
    response.statusCode = 200;
    applySecurityHeaders(response, 'text/javascript; charset=utf-8');
    response.end(vendor);
    return;
  }

  const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const candidate = path.resolve(dashboardRoot, requested);
  if (candidate !== path.join(dashboardRoot, 'index.html') && !candidate.startsWith(`${dashboardRoot}${path.sep}`)) {
    response.statusCode = 404;
    response.end('Not found');
    return;
  }
  await sendFile(response, candidate, MIME.get(path.extname(candidate)) ?? 'application/octet-stream');
}

export function createGBrainHealthServer() {
  return createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const missing = error?.code === 'ENOENT';
    response.statusCode = missing ? 404 : 500;
    applySecurityHeaders(response, 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: missing ? 'not_found' : 'health_snapshot_failed' }));
    if (!missing) {
      process.stderr.write(`[gbrain-health] ${error.message}\n`);
    }
  });
  });
}

const isDirect = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect) {
  const server = createGBrainHealthServer();
  server.listen(port, host, () => {
    process.stderr.write(`[gbrain-health] http://${host}:${port}\n`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
