import assert from 'node:assert/strict';
import test from 'node:test';

const DEPLOYED_ORIGIN = String(
  process.env.MINIMALIST_DEPLOYED_ORIGIN || 'https://minimalist.chat',
).replace(/\/+$/, '');
const MUTABLE_BOOTSTRAP_PATHS = [
  { pathname: '/sw.js', statuses: [200] },
  { pathname: '/service-worker.js', statuses: [200, 404] },
  { pathname: '/offline-bootstrap.json', statuses: [200] },
  { pathname: '/build-info.json', statuses: [200] },
  { pathname: '/config.js', statuses: [200] },
  { pathname: '/load-css.js', statuses: [200] },
];

function cacheHeaderEvidence(response) {
  return {
    age: response.headers.get('age') || '',
    cacheControl: response.headers.get('cache-control') || '',
    cfCacheStatus: response.headers.get('cf-cache-status') || '',
    xCache: response.headers.get('x-cache') || '',
  };
}

for (const [index, { pathname, statuses }] of MUTABLE_BOOTSTRAP_PATHS.entries()) {
  test(`deployed ${pathname} cannot be reused across releases`, async () => {
    const url = new URL(pathname, `${DEPLOYED_ORIGIN}/`);
    url.searchParams.set('minimalist-header-probe', `${Date.now()}-${index}`);
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      redirect: 'manual',
    });
    await response.arrayBuffer();

    assert.equal(
      statuses.includes(response.status),
      true,
      `${url} returned ${response.status}: ${JSON.stringify(cacheHeaderEvidence(response))}`,
    );
    const evidence = cacheHeaderEvidence(response);
    assert.match(evidence.cacheControl, /(?:^|,)\s*no-cache(?:\s*(?:,|$))/i, JSON.stringify(evidence));
    assert.match(evidence.cacheControl, /(?:^|,)\s*no-store(?:\s*(?:,|$))/i, JSON.stringify(evidence));
    assert.match(evidence.cacheControl, /(?:^|,)\s*must-revalidate(?:\s*(?:,|$))/i, JSON.stringify(evidence));
    assert.doesNotMatch(
      evidence.cacheControl,
      /(?:^|,)\s*(?:s-maxage|max-age)\s*=\s*[1-9]\d*/i,
      JSON.stringify(evidence),
    );
  });
}
