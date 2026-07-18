import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
const DIST_DIR = join(ROOT_DIR, 'dist');
const PRODUCTION_ORIGIN = 'https://minimalist.chat';

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

const GENERATED_ROUTES = [...INDEXABLE_ROUTES, '/login', '/chat'];

const FAQ_EXPECTATIONS = [
  {
    question: 'What is Minimalist Chat?',
    answerFragment: 'Minimalist Chat is a real-time messaging app built around rooms.',
  },
  {
    question: 'How do I create or join a room?',
    answerFragment: 'use Create to start a room, or Join to enter with an invite link or code.',
  },
  {
    question: 'What are Docs and the Whiteboard?',
    answerFragment: 'Collaborative Docs update live for everyone',
  },
  {
    question: 'What do the Advanced and Pro tiers include?',
    answerFragment: 'Optional room subscriptions are separate from these account plans.',
  },
  {
    question: 'How do I add friends and send private messages?',
    answerFragment: 'Open Contacts to search people, send requests, and start private conversations.',
  },
  {
    question: 'Is my data private?',
    answerFragment: 'You can delete your account from Settings.',
  },
];

function productionUrl(route) {
  return route === '/' ? `${PRODUCTION_ORIGIN}/` : `${PRODUCTION_ORIGIN}${route}`;
}

function routeDocuments(route) {
  if (route === '/') return ['index.html'];

  const slug = route.slice(1);
  return [`${slug}.html`, `${slug}/index.html`];
}

function readDist(relativePath) {
  const absolutePath = join(DIST_DIR, relativePath);
  assert.ok(
    existsSync(absolutePath),
    `${relativePath}: expected generated file at ${absolutePath}. Run the production build before this smoke test.`,
  );
  return readFileSync(absolutePath, 'utf8');
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

function decodeEntities(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    ndash: '–',
    mdash: '—',
  };

  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, token) => {
    if (token[0] === '#') {
      const isHex = token[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(token.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    return namedEntities[token.toLowerCase()] ?? entity;
  });
}

function normalizeText(value) {
  return decodeEntities(String(value)).replace(/\s+/g, ' ').trim();
}

function crawlerVisibleText(html) {
  return normalizeText(
    html
      .replace(/<!--[^]*?-->/g, ' ')
      .replace(/<script(?=[\s>])[^>]*>[^]*?<\/script\s*>/gi, ' ')
      .replace(/<style(?=[\s>])[^>]*>[^]*?<\/style\s*>/gi, ' ')
      .replace(/<template(?=[\s>])[^>]*>[^]*?<\/template\s*>/gi, ' ')
      .replace(/<svg(?=[\s>])[^>]*>[^]*?<\/svg\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

function assertSinglePageShell(html, label) {
  assert.equal(
    findTags(html, 'main').length,
    1,
    `${label}: expected exactly one opening <main> element in the generated HTML.`,
  );
  assert.equal(
    findTags(html, 'h1').length,
    1,
    `${label}: expected exactly one opening <h1> element in the generated HTML.`,
  );
}

function assertRouteMetadata(html, label, expectedUrl) {
  const canonicalTags = findTags(html, 'link').filter((tag) =>
    hasToken(getAttribute(tag, 'rel'), 'canonical'),
  );
  assert.equal(
    canonicalTags.length,
    1,
    `${label}: expected exactly one <link rel="canonical"> tag.`,
  );
  assert.equal(
    getAttribute(canonicalTags[0], 'href'),
    expectedUrl,
    `${label}: canonical URL must match the route URL.`,
  );

  const openGraphUrlTags = findTags(html, 'meta').filter(
    (tag) => getAttribute(tag, 'property')?.toLowerCase() === 'og:url',
  );
  assert.equal(
    openGraphUrlTags.length,
    1,
    `${label}: expected exactly one <meta property="og:url"> tag.`,
  );
  assert.equal(
    getAttribute(openGraphUrlTags[0], 'content'),
    expectedUrl,
    `${label}: og:url must match the route URL.`,
  );
}

function extractJsonLd(html, label) {
  const documents = [];
  const expression = /<script(?=[\s>])([^>]*)>([^]*?)<\/script\s*>/gi;
  let match;

  while ((match = expression.exec(html)) !== null) {
    const openingTag = `<script${match[1]}>`;
    if (getAttribute(openingTag, 'type')?.toLowerCase() !== 'application/ld+json') continue;

    const source = match[2].trim();
    assert.notEqual(source, '', `${label}: JSON-LD script must not be empty.`);

    try {
      documents.push(JSON.parse(source));
    } catch (error) {
      assert.fail(`${label}: JSON-LD script ${documents.length + 1} is not valid JSON: ${error.message}`);
    }
  }

  assert.ok(documents.length > 0, `${label}: expected at least one JSON-LD script.`);
  return documents;
}

function flattenJsonLd(documents) {
  const nodes = [];

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (!value || typeof value !== 'object') return;
    nodes.push(value);
    if ('@graph' in value) visit(value['@graph']);
  }

  visit(documents);
  return nodes;
}

function hasSchemaType(node, expectedType) {
  const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
  return types.includes(expectedType);
}

for (const route of GENERATED_ROUTES) {
  for (const relativePath of routeDocuments(route)) {
    test(`${relativePath} has one page shell and route-specific metadata`, () => {
      const html = readDist(relativePath);
      assertSinglePageShell(html, relativePath);
      assertRouteMetadata(html, relativePath, productionUrl(route));
    });
  }
}

test('sitemap lists exactly the public indexable routes', () => {
  const relativePath = 'sitemap.xml';
  const sitemap = readDist(relativePath);
  assert.match(sitemap, /^\s*<\?xml\b/i, `${relativePath}: expected an XML declaration.`);
  assert.match(sitemap, /<urlset\b[^>]*>/i, `${relativePath}: expected a <urlset> root element.`);

  const locations = [...sitemap.matchAll(/<loc\b[^>]*>([^<]+)<\/loc\s*>/gi)].map((match) =>
    decodeEntities(match[1].trim()),
  );
  assert.equal(
    locations.length,
    new Set(locations).size,
    `${relativePath}: duplicate <loc> entries are not allowed.`,
  );

  const expectedLocations = INDEXABLE_ROUTES.map(productionUrl);
  const missing = expectedLocations.filter((location) => !locations.includes(location));
  const unexpected = locations.filter((location) => !expectedLocations.includes(location));
  assert.deepEqual(
    { missing, unexpected },
    { missing: [], unexpected: [] },
    `${relativePath}: <loc> entries must exactly match the indexable route contract.`,
  );
});

test('robots.txt allows crawling and advertises the canonical sitemap once', () => {
  const relativePath = 'robots.txt';
  const robots = readDist(relativePath);
  const directives = robots
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':');
      return separator === -1
        ? { name: line.toLowerCase(), value: '' }
        : {
            name: line.slice(0, separator).trim().toLowerCase(),
            value: line.slice(separator + 1).trim(),
          };
    });

  assert.ok(
    directives.some(({ name, value }) => name === 'user-agent' && value === '*'),
    `${relativePath}: expected "User-agent: *".`,
  );
  assert.ok(
    directives.some(({ name, value }) => name === 'allow' && value === '/'),
    `${relativePath}: expected "Allow: /".`,
  );

  const sitemapDirectives = directives.filter(({ name }) => name === 'sitemap');
  assert.equal(sitemapDirectives.length, 1, `${relativePath}: expected exactly one Sitemap directive.`);
  assert.equal(
    sitemapDirectives[0].value,
    `${PRODUCTION_ORIGIN}/sitemap.xml`,
    `${relativePath}: Sitemap directive must use the production sitemap URL.`,
  );
});

for (const route of ['/', '/pricing']) {
  test(`${route} exposes plan names and prices without JavaScript`, () => {
    const relativePath = routeDocuments(route).at(-1);
    const visibleText = crawlerVisibleText(readDist(relativePath));
    const pricingText = visibleText.replace(/\s*\/\s*/g, '/');

    for (const planName of ['Base', 'Advanced', 'Pro']) {
      assert.ok(
        visibleText.includes(planName),
        `${relativePath}: crawler-visible HTML is missing the ${planName} plan name.`,
      );
    }

    const expectedPrices = [
      { label: '$0', pattern: /(?:^|\s)\$0(?:\s|$)/ },
      { label: '$1.99 monthly', pattern: /\$1\.99\/(?:mo|month)\b/i },
      { label: '$7.99 monthly', pattern: /\$7\.99\/(?:mo|month)\b/i },
    ];
    for (const { label, pattern } of expectedPrices) {
      assert.ok(
        pattern.test(pricingText),
        `${relativePath}: crawler-visible HTML is missing the ${label} price.`,
      );
    }
  });
}

test('faq page exposes every answer without JavaScript', () => {
  const relativePath = 'faq/index.html';
  const visibleText = crawlerVisibleText(readDist(relativePath));

  for (const { question, answerFragment } of FAQ_EXPECTATIONS) {
    assert.ok(
      visibleText.includes(normalizeText(question)),
      `${relativePath}: crawler-visible HTML is missing FAQ question "${question}".`,
    );
    assert.ok(
      visibleText.includes(normalizeText(answerFragment)),
      `${relativePath}: crawler-visible HTML is missing the answer for "${question}".`,
    );
  }
});

test('home page has parseable WebSite and Organization JSON-LD', () => {
  const relativePath = 'index.html';
  const nodes = flattenJsonLd(extractJsonLd(readDist(relativePath), relativePath));

  for (const requiredType of ['WebSite', 'Organization']) {
    assert.ok(
      nodes.some((node) => hasSchemaType(node, requiredType)),
      `${relativePath}: JSON-LD is missing a ${requiredType} node.`,
    );
  }
});

test('faq page has parseable FAQPage JSON-LD matching its visible answers', () => {
  const relativePath = 'faq/index.html';
  const html = readDist(relativePath);
  const visibleText = crawlerVisibleText(html);
  const nodes = flattenJsonLd(extractJsonLd(html, relativePath));
  const faqPages = nodes.filter((node) => hasSchemaType(node, 'FAQPage'));

  assert.equal(faqPages.length, 1, `${relativePath}: expected exactly one FAQPage JSON-LD node.`);
  const entities = faqPages[0].mainEntity;
  assert.ok(Array.isArray(entities), `${relativePath}: FAQPage.mainEntity must be an array.`);
  assert.equal(
    entities.length,
    FAQ_EXPECTATIONS.length,
    `${relativePath}: FAQPage.mainEntity must contain every visible FAQ item exactly once.`,
  );

  const entitiesByQuestion = new Map();
  for (const [index, entity] of entities.entries()) {
    assert.ok(
      entity && typeof entity === 'object' && hasSchemaType(entity, 'Question'),
      `${relativePath}: mainEntity[${index}] must be a Question object.`,
    );
    assert.ok(
      typeof entity.name === 'string' && normalizeText(entity.name),
      `${relativePath}: mainEntity[${index}] must have a non-empty name.`,
    );
    assert.ok(
      entity.acceptedAnswer &&
        typeof entity.acceptedAnswer === 'object' &&
        hasSchemaType(entity.acceptedAnswer, 'Answer'),
      `${relativePath}: answer for "${entity.name}" must be an Answer object.`,
    );
    assert.ok(
      typeof entity.acceptedAnswer.text === 'string' && normalizeText(entity.acceptedAnswer.text),
      `${relativePath}: answer for "${entity.name}" must have non-empty text.`,
    );
    assert.ok(
      visibleText.includes(normalizeText(entity.name)),
      `${relativePath}: JSON-LD question "${entity.name}" is not present in visible HTML.`,
    );
    assert.ok(
      visibleText.includes(normalizeText(entity.acceptedAnswer.text)),
      `${relativePath}: JSON-LD answer for "${entity.name}" is not present in visible HTML.`,
    );
    assert.ok(
      !entitiesByQuestion.has(normalizeText(entity.name)),
      `${relativePath}: duplicate JSON-LD question "${entity.name}".`,
    );
    entitiesByQuestion.set(normalizeText(entity.name), entity);
  }

  for (const { question } of FAQ_EXPECTATIONS) {
    assert.ok(
      entitiesByQuestion.has(normalizeText(question)),
      `${relativePath}: FAQPage JSON-LD is missing question "${question}".`,
    );
  }
});

test('404 document is semantic and explicitly noindex', () => {
  const relativePath = '404.html';
  const html = readDist(relativePath);
  assertSinglePageShell(html, relativePath);

  const robotsTags = findTags(html, 'meta').filter(
    (tag) => getAttribute(tag, 'name')?.toLowerCase() === 'robots',
  );
  assert.equal(robotsTags.length, 1, `${relativePath}: expected exactly one robots meta tag.`);
  assert.match(
    getAttribute(robotsTags[0], 'content') ?? '',
    /(?:^|[\s,])noindex(?:$|[\s,])/i,
    `${relativePath}: robots meta tag must include noindex.`,
  );
});
