import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  extractLinkPreviewMetadata,
  fetchSafeLinkPreview,
  isPrivateLinkPreviewAddress,
  resolveLinkPreviewTarget,
} = require('../functions/link-preview.js');

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('preview address checks reject private and reserved targets', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.4', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPrivateLinkPreviewAddress(address), true, address);
  }
  assert.equal(isPrivateLinkPreviewAddress('93.184.216.34'), false);
  assert.equal(isPrivateLinkPreviewAddress('2606:2800:220:1:248:1893:25c8:1946'), false);
});

test('target resolution requires public HTTPS without credentials or custom ports', async () => {
  await assert.rejects(resolveLinkPreviewTarget('http://example.com', { lookup: publicLookup }), { code: 'unsafe_target' });
  await assert.rejects(resolveLinkPreviewTarget('https://user:pass@example.com', { lookup: publicLookup }), { code: 'unsafe_target' });
  await assert.rejects(resolveLinkPreviewTarget('https://example.com:8443', { lookup: publicLookup }), { code: 'unsafe_target' });
  await assert.rejects(resolveLinkPreviewTarget('https://localhost', { lookup: publicLookup }), { code: 'unsafe_target' });
  await assert.rejects(resolveLinkPreviewTarget('https://public.example', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }],
  }), { code: 'unsafe_target' });
});

test('every redirect is resolved and private redirect targets are blocked', async () => {
  await assert.rejects(fetchSafeLinkPreview('https://example.com/start-redirect-test', {
    lookup: publicLookup,
    request: async () => ({ status: 302, location: 'https://127.0.0.1/secret', html: '' }),
  }), { code: 'unsafe_target' });
});

test('metadata extraction returns compact escaped text fields', () => {
  const result = extractLinkPreviewMetadata(`
    <html><head>
      <title>Fallback</title>
      <meta property="og:title" content="Launch &amp; learn">
      <meta name="description" content="A compact &quot;safe&quot; description.">
    </head></html>
  `, 'https://www.example.com/article');
  assert.deepEqual(result, {
    url: 'https://www.example.com/article',
    domain: 'example.com',
    title: 'Launch & learn',
    description: 'A compact "safe" description.',
  });
});
