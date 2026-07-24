import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { faqItems, termsPageMeta, termsSections } from '../src/content/marketingContent.js';
import {
  downloadPageContent,
  featureStatusLabels,
  featuresPageContent,
  homePageContent,
  privacyPageContent,
  publicMarketingPages,
  storyPageContent,
} from '../src/content/publicMarketingContent.js';

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

const FAQ_EXPECTATIONS = faqItems.map(({ question, answer }) => ({
  question,
  answerFragment: answer,
}));

const SHARED_PAGE_DOCUMENTS = [
  ['index.html', homePageContent],
  ['features/index.html', featuresPageContent],
  ['download/index.html', downloadPageContent],
  ['story/index.html', storyPageContent],
  ['privacy/index.html', privacyPageContent],
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

function assertVisibleTextIncludes(visibleText, value, label) {
  assert.ok(
    visibleText.includes(normalizeText(value)),
    `${label}: crawler-visible HTML is missing ${JSON.stringify(normalizeText(value))}.`,
  );
}

function documentTitle(html, label) {
  const matches = [...html.matchAll(/<title>([^]*?)<\/title\s*>/gi)];
  assert.equal(matches.length, 1, `${label}: expected exactly one <title> element.`);
  return normalizeText(matches[0][1]);
}

function metaContent(html, label, attributeName, attributeValue) {
  const tags = findTags(html, 'meta').filter(
    (tag) => getAttribute(tag, attributeName)?.toLowerCase() === attributeValue.toLowerCase(),
  );
  assert.equal(
    tags.length,
    1,
    `${label}: expected exactly one meta tag with ${attributeName}="${attributeValue}".`,
  );
  return normalizeText(getAttribute(tags[0], 'content') ?? '');
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

for (const route of GENERATED_ROUTES.filter((value) => value !== '/')) {
  for (const relativePath of routeDocuments(route)) {
    test(`${relativePath} keeps navigation available when hydration fails`, () => {
      const html = readDist(relativePath);
      assert.equal(findTags(html, 'header').length, 1);
      assert.ok(findTags(html, 'nav').length >= 2);
      assert.equal(findTags(html, 'footer').length, 1);
      for (const href of ['/', '/features', '/pricing', '/login', '/privacy', '/terms']) {
        assert.match(
          html,
          new RegExp(`<a(?=[^>]*\\bhref=["']${href === '/' ? '\\/' : href}["'])`, 'i'),
          `${relativePath}: hydration fallback is missing ${href}.`,
        );
      }
    });
  }
}

test('shared public marketing content remains plain serializable data', () => {
  const roundTripped = JSON.parse(JSON.stringify(publicMarketingPages));
  assert.deepEqual(roundTripped, publicMarketingPages);
});

for (const [relativePath, page] of SHARED_PAGE_DOCUMENTS) {
  test(`${relativePath} metadata matches the shared page content`, () => {
    const html = readDist(relativePath);
    assert.equal(documentTitle(html, relativePath), page.meta.title);
    assert.equal(
      metaContent(html, relativePath, 'name', 'description'),
      page.meta.description,
      `${relativePath}: meta description drifted from shared content.`,
    );
    assert.equal(
      metaContent(html, relativePath, 'property', 'og:title'),
      page.meta.title,
      `${relativePath}: Open Graph title drifted from shared content.`,
    );
    assert.equal(
      metaContent(html, relativePath, 'property', 'og:description'),
      page.meta.description,
      `${relativePath}: Open Graph description drifted from shared content.`,
    );
  });
}

test('home page exposes the shared current product story without JavaScript', () => {
  const relativePath = 'index.html';
  const visibleText = crawlerVisibleText(readDist(relativePath));

  for (const value of [
    homePageContent.hero.title,
    homePageContent.hero.copy,
    homePageContent.workflow.title,
    homePageContent.workflow.copy,
    homePageContent.signal.title,
    homePageContent.signal.copy,
    homePageContent.plans.title,
    homePageContent.plans.copy,
    homePageContent.close.title,
    homePageContent.close.copy,
  ]) assertVisibleTextIncludes(visibleText, value, relativePath);

  for (const step of homePageContent.workflow.steps) {
    assertVisibleTextIncludes(visibleText, step.title, relativePath);
    assertVisibleTextIncludes(visibleText, step.copy, relativePath);
  }

  for (const featureId of homePageContent.signal.featureIds) {
    const feature = featuresPageContent.catalog.find((item) => item.id === featureId);
    assert.ok(feature, `${relativePath}: unknown shared feature id ${featureId}.`);
    assertVisibleTextIncludes(visibleText, feature.title, relativePath);
    assertVisibleTextIncludes(visibleText, feature.summary, relativePath);
  }
});

test('features page exposes every shared capability and honest status without JavaScript', () => {
  const relativePath = 'features/index.html';
  const visibleText = crawlerVisibleText(readDist(relativePath));

  for (const value of [
    featuresPageContent.hero.title,
    featuresPageContent.hero.copy,
    featuresPageContent.statusIntro,
    featuresPageContent.workflow.title,
    featuresPageContent.close.title,
    featuresPageContent.close.copy,
  ]) assertVisibleTextIncludes(visibleText, value, relativePath);

  for (const group of featuresPageContent.groups) {
    assertVisibleTextIncludes(visibleText, group.title, relativePath);
    assertVisibleTextIncludes(visibleText, group.summary, relativePath);
  }

  for (const feature of featuresPageContent.catalog) {
    assertVisibleTextIncludes(visibleText, feature.title, relativePath);
    assertVisibleTextIncludes(visibleText, feature.summary, relativePath);
    assertVisibleTextIncludes(visibleText, featureStatusLabels[feature.status], relativePath);
  }

  for (const step of featuresPageContent.workflow.steps) {
    assertVisibleTextIncludes(visibleText, step.title, relativePath);
    assertVisibleTextIncludes(visibleText, step.copy, relativePath);
  }
});

test('download page exposes verified platform status and install limits without JavaScript', () => {
  const relativePath = 'download/index.html';
  const visibleText = crawlerVisibleText(readDist(relativePath));

  for (const value of [
    downloadPageContent.hero.title,
    downloadPageContent.hero.copy,
    downloadPageContent.close.title,
    downloadPageContent.close.copy,
    ...downloadPageContent.syncFacts,
  ]) assertVisibleTextIncludes(visibleText, value, relativePath);

  for (const platform of downloadPageContent.platforms) {
    assertVisibleTextIncludes(visibleText, platform.title, relativePath);
    assertVisibleTextIncludes(visibleText, platform.status, relativePath);
    assertVisibleTextIncludes(visibleText, platform.summary, relativePath);
  }

  for (const step of downloadPageContent.installSteps) {
    assertVisibleTextIncludes(visibleText, step.title, relativePath);
    assertVisibleTextIncludes(visibleText, step.copy, relativePath);
  }

  for (const item of downloadPageContent.faqs) {
    assertVisibleTextIncludes(visibleText, item.question, relativePath);
    assertVisibleTextIncludes(visibleText, item.answer, relativePath);
  }
});

test('story page exposes the complete shared philosophy without stale absolutes', () => {
  const relativePath = 'story/index.html';
  const visibleText = crawlerVisibleText(readDist(relativePath));

  for (const value of [
    storyPageContent.hero.title,
    storyPageContent.hero.copy,
    storyPageContent.manifesto.title,
    storyPageContent.manifesto.copy,
    storyPageContent.position.title,
    storyPageContent.position.copy,
    storyPageContent.quote,
    storyPageContent.close.title,
    storyPageContent.close.copy,
  ]) assertVisibleTextIncludes(visibleText, value, relativePath);

  for (const principle of storyPageContent.principles) {
    assertVisibleTextIncludes(visibleText, principle.title, relativePath);
    assertVisibleTextIncludes(visibleText, principle.copy, relativePath);
  }

  for (const stage of storyPageContent.timeline) {
    assertVisibleTextIncludes(visibleText, stage.title, relativePath);
    assertVisibleTextIncludes(visibleText, stage.copy, relativePath);
  }

  assert.ok(!visibleText.includes('No algorithms.'), `${relativePath}: stale algorithm absolute returned.`);
});

test('privacy page exposes the complete current data map without JavaScript', () => {
  const relativePath = 'privacy/index.html';
  const visibleText = crawlerVisibleText(readDist(relativePath));

  for (const value of [
    privacyPageContent.meta.lastUpdated,
    privacyPageContent.hero.title,
    privacyPageContent.hero.copy,
    ...privacyPageContent.summary,
  ]) assertVisibleTextIncludes(visibleText, value, relativePath);

  for (const provider of privacyPageContent.providers) {
    assertVisibleTextIncludes(visibleText, provider.name, relativePath);
    assertVisibleTextIncludes(visibleText, provider.purpose, relativePath);
    assertVisibleTextIncludes(visibleText, provider.data, relativePath);
  }

  for (const section of privacyPageContent.sections) {
    assertVisibleTextIncludes(visibleText, section.title, relativePath);
    assertVisibleTextIncludes(visibleText, section.copy, relativePath);
    for (const item of section.items) assertVisibleTextIncludes(visibleText, item, relativePath);
  }
});

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

test('terms page exposes the complete current document without JavaScript', () => {
  const relativePath = 'terms/index.html';
  const visibleText = crawlerVisibleText(readDist(relativePath));

  assert.ok(
    visibleText.includes(normalizeText(termsPageMeta.lastUpdated)),
    `${relativePath}: crawler-visible HTML is missing the current Terms date.`,
  );

  for (const section of termsSections) {
    assert.ok(
      visibleText.includes(normalizeText(section.title)),
      `${relativePath}: crawler-visible HTML is missing Terms section "${section.title}".`,
    );
    assert.ok(
      visibleText.includes(normalizeText(section.copy)),
      `${relativePath}: crawler-visible HTML is missing the copy for "${section.title}".`,
    );
    for (const item of section.items ?? []) {
      assert.ok(
        visibleText.includes(normalizeText(item)),
        `${relativePath}: crawler-visible HTML is missing a list item from "${section.title}".`,
      );
    }
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
