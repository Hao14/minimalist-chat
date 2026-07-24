import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  isAllowedHostHeader,
  rewriteGraphVendorReferences,
  stripSourceMapDirective,
} from './gbrain-health-server.mjs';

test('dashboard accepts only the exact loopback Host header', () => {
  assert.equal(isAllowedHostHeader('127.0.0.1:4317', '127.0.0.1', 4317), true);
  assert.equal(isAllowedHostHeader('[::1]:4317', '::1', 4317), true);
  for (const rejected of [
    undefined,
    'localhost:4317',
    '127.0.0.1',
    '127.0.0.1:4318',
    'evil.example:4317',
    '127.0.0.1:4317.evil.example',
  ]) {
    assert.equal(isAllowedHostHeader(rejected, '127.0.0.1', 4317), false, String(rejected));
  }
});

test('retrieval panel uses fresh evaluation readiness instead of the raw gate bit', () => {
  const dashboardSource = readFileSync(
    new URL('./dashboard/src/GBrainHealthDashboard.jsx', import.meta.url),
    'utf8',
  );
  assert.match(dashboardSource, /passed=\{evaluation\.ready\}/);
  assert.doesNotMatch(dashboardSource, /passed=\{evaluation\.gate_passed\}/);
});

test('vendored graph script drops stale source-map discovery directives', () => {
  assert.equal(
    stripSourceMapDirective('console.log("graph");\n//# sourceMappingURL=vis-network.min.js.map\n'),
    'console.log("graph");\n',
  );
  assert.equal(
    stripSourceMapDirective('console.log("graph");\n//@ sourceMappingURL=legacy.map'),
    'console.log("graph");\n',
  );
});

test('graph report pins SRI to the exact locally served vendor bytes', () => {
  const vendor = 'window.vis = {};\n';
  const expectedIntegrity = `sha384-${createHash('sha384').update(vendor).digest('base64')}`;
  const report = [
    '<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"',
    '        integrity="sha384-old" crossorigin="anonymous"></script>',
  ].join('\n');
  const rewritten = rewriteGraphVendorReferences(report, vendor);

  assert.match(rewritten, /src="\/vendor\/vis-network\.min\.js"/u);
  assert.match(rewritten, new RegExp(`integrity="${expectedIntegrity}"`, 'u'));
  assert.doesNotMatch(rewritten, /unpkg\.com|sha384-old/u);
});
