import assert from 'node:assert/strict';

const DEFAULT_BASE_URL = 'http://127.0.0.1:5000';
const PRODUCTION_ORIGIN = 'https://minimalist.chat';
const REQUEST_TIMEOUT_MS = 10_000;

const INDEXABLE_ROUTES = [
  '/',
  '/features',
  '/pricing',
  '/download',
  '/story',
  '/faq',
  '/privacy',
  '/terms',
];

const KNOWN_HTML_ROUTES = [...INDEXABLE_ROUTES, '/login', '/chat'];
const DYNAMIC_HTML_ROUTES = ['/join/SEO-SMOKE-ROOM', '/vault/share/seo-smoke-share'];
const MISSING_ROUTES = [
  '/seo-smoke-definitely-missing-7d93a8',
  '/nested/seo-smoke-definitely-missing-7d93a8',
  '/join',
  '/join/seo-smoke-room/extra',
  '/vault/share',
  '/vault/share/seo-smoke-share/extra',
  '/assets/seo-smoke-definitely-missing-7d93a8.js',
];

function resolveBaseUrl() {
  const input = process.env.SEO_BASE_URL?.trim() || DEFAULT_BASE_URL;
  let baseUrl;

  try {
    baseUrl = new URL(input);
  } catch (error) {
    throw new Error(`SEO_BASE_URL must be an absolute HTTP(S) URL; received "${input}": ${error.message}`);
  }

  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    throw new Error(`SEO_BASE_URL must use http: or https:; received "${baseUrl.protocol}".`);
  }

  baseUrl.pathname = baseUrl.pathname.replace(/\/*$/, '/');
  baseUrl.search = '';
  baseUrl.hash = '';
  return baseUrl;
}

const BASE_URL = resolveBaseUrl();

function productionUrl(route) {
  return route === '/' ? `${PRODUCTION_ORIGIN}/` : `${PRODUCTION_ORIGIN}${route}`;
}

function findTags(html, tagName) {
  const expression = new RegExp(`<${tagName}(?=[\\s/>])[^>]*>`, 'gi');
  return html.match(expression) ?? [];
}

function getAttribute(tag, attributeName) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(
    `(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
    'i',
  );
  const match = tag.match(expression);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

function hasToken(value, expectedToken) {
  return String(value ?? '')
    .toLowerCase()
    .split(/\s+/)
    .includes(expectedToken.toLowerCase());
}

function canonicalUrl(html) {
  const canonicalTags = findTags(html, 'link').filter((tag) =>
    hasToken(getAttribute(tag, 'rel'), 'canonical'),
  );
  assert.equal(canonicalTags.length, 1, 'expected exactly one canonical link in the response HTML');
  return getAttribute(canonicalTags[0], 'href');
}

function decodeXml(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

async function request(method, path) {
  const url = new URL(path, BASE_URL);

  try {
    const response = await fetch(url, {
      method,
      redirect: 'manual',
      headers: {
        accept: method === 'HEAD' ? '*/*' : 'text/html,application/xhtml+xml,application/xml,text/plain,*/*',
        'user-agent': 'Minimalist-SEO-Hosting-Smoke/1.0',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = method === 'HEAD' ? '' : await response.text();
    return { body, response, url };
  } catch (error) {
    throw new Error(`${method} ${url.href} failed before a response was received: ${error.message}`);
  }
}

function assertStatus(result, expectedStatus, method, path) {
  assert.equal(
    result.response.status,
    expectedStatus,
    `${method} ${path}: expected HTTP ${expectedStatus}, received ${result.response.status}`,
  );
}

function assertContentType(result, expectedPattern, method, path, expectedDescription) {
  const contentType = result.response.headers.get('content-type') ?? '';
  assert.match(
    contentType,
    expectedPattern,
    `${method} ${path}: expected ${expectedDescription} Content-Type, received "${contentType || '(missing)'}"`,
  );
}

const failures = [];
let passed = 0;

async function check(label, callback) {
  try {
    await callback();
    passed += 1;
    console.log(`PASS ${label}`);
  } catch (error) {
    failures.push({ label, message: error?.message ?? String(error) });
    console.error(`FAIL ${label}: ${error?.message ?? error}`);
  }
}

async function checkKnownHtmlRoutes() {
  for (const route of KNOWN_HTML_ROUTES) {
    for (const method of ['GET', 'HEAD']) {
      await check(`${method} ${route} returns the intended HTML route`, async () => {
        const result = await request(method, route);
        assertStatus(result, 200, method, route);
        assertContentType(result, /\btext\/html\b/i, method, route, 'text/html');

        if (method === 'GET') {
          assert.equal(
            canonicalUrl(result.body),
            productionUrl(route),
            `${method} ${route}: response canonical must identify the requested route`,
          );
        }
      });
    }
  }
}

async function checkDynamicHtmlRoutes() {
  for (const route of DYNAMIC_HTML_ROUTES) {
    for (const method of ['GET', 'HEAD']) {
      await check(`${method} ${route} remains an app entry route`, async () => {
        const result = await request(method, route);
        assertStatus(result, 200, method, route);
        assertContentType(result, /\btext\/html\b/i, method, route, 'text/html');
      });
    }
  }
}

async function checkMissingRoutes() {
  for (const route of MISSING_ROUTES) {
    for (const method of ['GET', 'HEAD']) {
      await check(`${method} ${route} is a hard 404`, async () => {
        const result = await request(method, route);
        assertStatus(result, 404, method, route);
      });
    }
  }
}

async function checkRobots() {
  for (const method of ['GET', 'HEAD']) {
    await check(`${method} /robots.txt has the crawler contract`, async () => {
      const path = '/robots.txt';
      const result = await request(method, path);
      assertStatus(result, 200, method, path);
      assertContentType(result, /\btext\/plain\b/i, method, path, 'text/plain');

      if (method === 'GET') {
        assert.match(result.body, /^\s*User-agent:\s*\*\s*$/im, `${path}: missing "User-agent: *"`);
        assert.match(result.body, /^\s*Allow:\s*\/\s*$/im, `${path}: missing "Allow: /"`);
        const sitemapDirectives = [...result.body.matchAll(/^\s*Sitemap:\s*(\S+)\s*$/gim)].map(
          (match) => match[1],
        );
        assert.deepEqual(
          sitemapDirectives,
          [`${PRODUCTION_ORIGIN}/sitemap.xml`],
          `${path}: expected exactly one canonical Sitemap directive`,
        );
      }
    });
  }
}

async function checkSitemap() {
  for (const method of ['GET', 'HEAD']) {
    await check(`${method} /sitemap.xml has the indexable route contract`, async () => {
      const path = '/sitemap.xml';
      const result = await request(method, path);
      assertStatus(result, 200, method, path);
      assertContentType(
        result,
        /\b(?:application|text)\/(?:[\w.-]+\+)?xml\b/i,
        method,
        path,
        'XML',
      );

      if (method === 'GET') {
        assert.match(result.body, /^\s*<\?xml\b/i, `${path}: expected an XML declaration`);
        assert.match(result.body, /<urlset\b[^>]*>/i, `${path}: expected a <urlset> root element`);

        const locations = [...result.body.matchAll(/<loc\b[^>]*>([^<]+)<\/loc\s*>/gi)].map(
          (match) => decodeXml(match[1].trim()),
        );
        assert.equal(
          locations.length,
          new Set(locations).size,
          `${path}: duplicate <loc> entries are not allowed`,
        );

        const expectedLocations = INDEXABLE_ROUTES.map(productionUrl);
        const missing = expectedLocations.filter((location) => !locations.includes(location));
        const unexpected = locations.filter((location) => !expectedLocations.includes(location));
        assert.deepEqual(
          { missing, unexpected },
          { missing: [], unexpected: [] },
          `${path}: <loc> entries must exactly match the indexable route contract`,
        );
      }
    });
  }
}

async function main() {
  console.log(`SEO hosting smoke target: ${BASE_URL.href}`);
  await checkKnownHtmlRoutes();
  await checkDynamicHtmlRoutes();
  await checkMissingRoutes();
  await checkRobots();
  await checkSitemap();

  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${passed + failures.length} SEO hosting checks failed:`);
    failures.forEach(({ label, message }, index) => {
      console.error(`${index + 1}. ${label}\n   ${message}`);
    });
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${passed} SEO hosting checks passed.`);
}

await main();
