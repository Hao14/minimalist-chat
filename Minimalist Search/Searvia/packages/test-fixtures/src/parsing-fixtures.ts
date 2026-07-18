import { gzipSync } from "node:zlib";

export const HTML_PARSING_FIXTURES = Object.freeze({
  brokenHtml: Object.freeze({
    body: "<!doctype html><title>Broken</title><main id=first id=duplicate><h1>Still parsed</h1><p>Unclosed paragraph<a href=/next>Next</main></section>",
    finalUrl: "https://example.com/broken",
  }),
  clientRendered: Object.freeze({
    body: '<!doctype html><html><head><script id="__NEXT_DATA__" type="application/json">{}</script></head><body><div id="__next"></div><script src="/_next/app.js"></script><noscript>This site requires JavaScript.</noscript></body></html>',
    finalUrl: "https://example.com/app",
  }),
  complete: Object.freeze({
    body: `<!doctype html>
      <html lang="en-US"><head>
        <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Complete page</title>
        <meta name="description" content="A complete deterministic page fixture.">
        <link rel="canonical" href="/complete">
        <link rel="icon" href="/favicon.svg">
        <link rel="alternate" hreflang="es" href="/es/complete">
        <meta property="og:title" content="Complete OG title">
        <meta property="og:type" content="article">
        <meta property="og:url" content="https://example.com/complete">
        <meta property="og:image" content="https://example.com/share.png">
        <meta name="twitter:card" content="summary_large_image">
        <link rel="stylesheet" href="/styles.css"><style>main{display:block}</style>
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Complete"}</script>
      </head><body>
        <main itemscope itemtype="https://schema.org/Article" itemid="/complete#article">
          <h1 itemprop="headline">Complete fixture</h1><h2>Details</h2>
          <p itemprop="description">This complete page contains enough meaningful visible words for deterministic extraction and similarity testing.</p>
          <a href="/internal" rel="next">Internal destination</a>
          <a href="https://outside.example/path" rel="nofollow sponsored">External destination</a>
          <img src="/hero.jpg" srcset="/hero-2x.jpg 2x" alt="Hero" width="1200" height="630" loading="lazy">
          <script src="/app.js" defer></script><iframe src="/embed" title="Example embed" sandbox="allow-scripts"></iframe>
          <form action="/submit" method="post" enctype="multipart/form-data"><input type="password"><input type="file"></form>
        </main>
      </body></html>`,
    finalUrl: "https://example.com/complete",
  }),
  conflictingRobots: Object.freeze({
    body: '<!doctype html><meta name="robots" content="index, nofollow"><meta name="googlebot" content="noindex, follow"><title>Robots conflict</title><p>Robots directives conflict.</p>',
    finalUrl: "https://example.com/robots-conflict",
  }),
  duplicateA: Object.freeze({
    body: "<!doctype html><title>Duplicate</title><main><h1>Same article</h1><p>The exact same article body appears at two separate URLs for duplicate detection.</p></main>",
    finalUrl: "https://example.com/duplicate-a",
  }),
  duplicateB: Object.freeze({
    body: "<!doctype html><title>Duplicate</title><main><h1>Same article</h1><p>The exact same article body appears at two separate URLs for duplicate detection.</p></main>",
    finalUrl: "https://example.com/duplicate-b",
  }),
  invalidJsonLd: Object.freeze({
    body: '<!doctype html><title>Schema</title><script type="application/ld+json">{"@type":"Thing", invalid}</script><p>Invalid structured data remains visible.</p>',
    finalUrl: "https://example.com/schema",
  }),
  missingMetadata: Object.freeze({
    body: "<!doctype html><html><body><main><p>This page deliberately has no title, description, canonical, or social metadata.</p></main></body></html>",
    finalUrl: "https://example.com/missing",
  }),
  multipleCanonicalsAndH1s: Object.freeze({
    body: '<!doctype html><title>Multiple</title><link rel="canonical" href="/one"><link rel="canonical" href="/two"><h1>Primary</h1><h1>Secondary</h1><p>Multiple declarations are preserved as evidence.</p>',
    finalUrl: "https://example.com/multiple",
  }),
  nearDuplicate: Object.freeze({
    body: "<!doctype html><title>Duplicate revised</title><main><h1>Same article</h1><p>The exact same article body appears at two separate URLs for reliable near duplicate detection today.</p></main>",
    finalUrl: "https://example.com/near-duplicate",
  }),
  relativeAndBase: Object.freeze({
    body: '<!doctype html><base href="/docs/"><title>Base URLs</title><link rel="canonical" href="guide"><a href="next?x=1">Next guide</a><img src="images/guide.png"><form action="submit"></form>',
    finalUrl: "https://example.com/root/page",
  }),
  windows1252: Object.freeze({
    body: new Uint8Array([
      ...Buffer.from(
        '<!doctype html><html lang="fr"><head><meta charset="windows-1252"><title>Caf',
        "ascii",
      ),
      0xe9,
      ...Buffer.from("</title></head><body><p>R", "ascii"),
      0xe9,
      ...Buffer.from("sum", "ascii"),
      0xe9,
      ...Buffer.from(" de la page avec plusieurs mots visibles.</p></body></html>", "ascii"),
    ]),
    finalUrl: "https://example.com/encoding",
  }),
});

const sitemapUrlSet = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://example.com/one</loc><lastmod>2026-07-10</lastmod></url>
    <url><loc>/relative</loc><lastmod>not-a-date</lastmod></url>
  </urlset>`;

export const SITEMAP_PARSING_FIXTURES = Object.freeze({
  gzipUrlSet: Object.freeze({
    body: new Uint8Array(gzipSync(sitemapUrlSet)),
    finalUrl: "https://example.com/sitemap.xml.gz",
  }),
  index: Object.freeze({
    body: `<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/section-a.xml</loc><lastmod>2026-07-01T12:30:00Z</lastmod></sitemap>
        <sitemap><loc>https://example.com/section-b.xml</loc></sitemap>
      </sitemapindex>`,
    finalUrl: "https://example.com/sitemap-index.xml",
  }),
  invalid: Object.freeze({
    body: "<urlset><url><loc>https://example.com/unclosed</loc></urlset>",
    finalUrl: "https://example.com/invalid-sitemap.xml",
  }),
  urlSet: Object.freeze({ body: sitemapUrlSet, finalUrl: "https://example.com/sitemap.xml" }),
});
