import {
  evaluateRenderingNeed,
  extractPage,
  parseSitemapDocument,
  similarityFingerprintDistance,
  SitemapTraversal,
  type HtmlDocumentInput,
  type PageExtractionResult,
  type ResponseHeaderInput,
} from "@searvia/crawler-core";
import { describe, expect, it } from "vitest";

import { HTML_PARSING_FIXTURES, SITEMAP_PARSING_FIXTURES } from "../src/index.js";

interface HtmlFixture {
  readonly body: string | Uint8Array;
  readonly finalUrl: string;
}

function byteLength(body: string | Uint8Array): number {
  return typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
}

function extractFixture(
  fixture: HtmlFixture,
  options: {
    readonly headers?: ResponseHeaderInput;
    readonly rendered?: HtmlDocumentInput;
  } = {},
): PageExtractionResult {
  const bytes = byteLength(fixture.body);
  return extractPage({
    contentType: "text/html",
    depth: 2,
    finalUrl: fixture.finalUrl,
    headers: options.headers ?? { "content-type": "text/html; charset=utf-8" },
    includeSubdomains: false,
    normalizedUrl: fixture.finalUrl,
    raw: { body: fixture.body, kind: "raw" },
    redirectChain: [],
    ...(options.rendered === undefined ? {} : { rendered: options.rendered }),
    requestedUrl: fixture.finalUrl,
    responseBytes: bytes,
    scopeHostname: "example.com",
    statusCode: 200,
    transferSize: bytes,
  });
}

function sitemapFixture(
  fixture: { readonly body: string | Uint8Array; readonly finalUrl: string },
  depth = 0,
) {
  return parseSitemapDocument({
    body: fixture.body,
    contentType: fixture.finalUrl.endsWith(".gz") ? "application/gzip" : "application/xml",
    depth,
    discoverySource: "submitted",
    finalUrl: fixture.finalUrl,
    redirectChain: [],
    requestedUrl: fixture.finalUrl,
    statusCode: 200,
  });
}

describe("deterministic page extraction fixtures", () => {
  it("extracts transport, metadata, graph links, resources, structured data, and hashes", () => {
    const fixture = HTML_PARSING_FIXTURES.complete;
    const bodyBytes = byteLength(fixture.body);
    const result = extractPage({
      contentType: "text/html",
      depth: 1,
      finalUrl: fixture.finalUrl,
      headers: {
        "cache-control": "public, max-age=300",
        "content-encoding": "br",
        "content-length": String(bodyBytes),
        "content-security-policy": "default-src 'self'",
        "content-type": "text/html; charset=utf-8",
        "set-cookie": "session=secret; HttpOnly",
        "set-cookie2": "legacy-session=secret; HttpOnly",
        "strict-transport-security": "max-age=31536000",
      },
      includeSubdomains: false,
      normalizedUrl: "https://example.com/start",
      raw: { body: fixture.body, kind: "raw" },
      redirectChain: [
        {
          fromUrl: "https://example.com/start",
          statusCode: 301,
          toUrl: fixture.finalUrl,
        },
      ],
      requestedUrl: "https://example.com/start",
      responseBytes: bodyBytes,
      scopeHostname: "example.com",
      statusCode: 200,
      transferSize: Math.floor(bodyBytes / 2),
    });

    expect(result).toMatchObject({
      finalUrl: fixture.finalUrl,
      normalizedUrl: "https://example.com/start",
      requestedUrl: "https://example.com/start",
      statusCode: 200,
    });
    expect(result.redirectChain).toHaveLength(1);
    expect(result.response).toMatchObject({
      compression: "br",
      contentLength: bodyBytes,
      responseBytes: bodyBytes,
      transferSize: Math.floor(bodyBytes / 2),
    });
    expect(result.response.cacheHeaders.map((header) => header.name)).toContain("cache-control");
    expect(result.response.securityHeaders.map((header) => header.name)).toEqual(
      expect.arrayContaining(["content-security-policy", "strict-transport-security"]),
    );
    expect(result.response.excludedSensitiveHeaderNames).toContain("set-cookie");
    expect(result.response.excludedSensitiveHeaderNames).toContain("set-cookie2");
    expect(result.response.headers.find((header) => header.name === "set-cookie")).toMatchObject({
      redacted: true,
      values: [],
    });
    expect(result.response.headers.find((header) => header.name === "set-cookie2")).toMatchObject({
      redacted: true,
      values: [],
    });

    expect(result.raw).toMatchObject({
      baseUrl: fixture.finalUrl,
      documentMetadataComplete: true,
      headingsComplete: true,
      htmlDoctypePresent: true,
      htmlLanguage: "en-US",
      iconDeclarationCount: 1,
      metaDescriptionTagCount: 1,
      sourceKind: "raw",
      title: "Complete page",
      viewportDeclarations: ["width=device-width, initial-scale=1"],
    });
    expect(result.raw.metaDescriptions).toEqual(["A complete deterministic page fixture."]);
    expect(result.raw.canonical?.normalizedUrl).toBe(fixture.finalUrl);
    expect(result.raw.hreflang).toContainEqual(
      expect.objectContaining({
        language: "es",
        normalizedUrl: "https://example.com/es/complete",
      }),
    );
    expect(result.raw.headings).toEqual([
      { level: 1, text: "Complete fixture" },
      { level: 2, text: "Details" },
    ]);
    expect(result.raw.wordCount).toBeGreaterThan(10);
    expect(result.raw.openGraph).toContainEqual({ key: "og:title", values: ["Complete OG title"] });
    expect(result.raw.socialCards).toContainEqual({
      key: "twitter:card",
      values: ["summary_large_image"],
    });
    expect(result.raw.jsonLd[0]).toMatchObject({ error: null });
    expect(result.raw.microdata[0]).toMatchObject({
      identifier: "https://example.com/complete#article",
      types: ["https://schema.org/Article"],
    });
    expect(result.raw.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchorText: "Internal destination",
          discoveredPage: true,
          discoveryDepth: 2,
          internal: true,
          normalizedTargetUrl: "https://example.com/internal",
        }),
        expect.objectContaining({
          discoveredPage: false,
          internal: false,
          normalizedTargetUrl: "https://outside.example/path",
          rel: ["nofollow", "sponsored"],
        }),
      ]),
    );
    expect(result.raw.images[0]).toMatchObject({
      alt: "Hero",
      height: 630,
      width: 1200,
    });
    expect(result.raw.images[0]?.sourceSet[0]).toMatchObject({
      descriptor: "2x",
      normalizedUrl: "https://example.com/hero-2x.jpg",
    });
    expect(
      result.raw.scripts.some(
        (script) => script.source?.normalizedUrl?.endsWith("/app.js") === true,
      ),
    ).toBe(true);
    expect(result.raw.stylesheets).toHaveLength(2);
    expect(result.raw.iframes[0]).toMatchObject({ title: "Example embed" });
    expect(result.raw.forms[0]).toMatchObject({
      enctype: "multipart/form-data",
      hasFileInput: true,
      hasPasswordInput: true,
      inputCount: 2,
      method: "post",
    });
    expect(result.raw.contentHash).toMatch(/^[\da-f]{64}$/u);
    expect(result.raw.domHash).toMatch(/^[\da-f]{64}$/u);
    expect(result.raw.similarityFingerprint).toMatch(/^[\da-f]{16}$/u);
  });

  it("preserves missing metadata and gates optional rendering", () => {
    const result = extractFixture(HTML_PARSING_FIXTURES.missingMetadata);
    expect(result.raw).toMatchObject({
      canonical: null,
      documentMetadataComplete: true,
      iconDeclarationCount: 0,
      metaDescriptionTagCount: 0,
      metaDescriptions: [],
      title: null,
      titles: [],
      viewportDeclarations: [],
    });
    expect(evaluateRenderingNeed(result.raw, false)).toEqual({ reasons: [], render: false });
    expect(evaluateRenderingNeed(result.raw, true)).toMatchObject({
      reasons: expect.arrayContaining(["critical_metadata_absent"]),
      render: true,
    });
  });

  it("preserves multiple canonical tags and multiple H1 headings", () => {
    const result = extractFixture(HTML_PARSING_FIXTURES.multipleCanonicalsAndH1s);
    expect(result.raw.canonicals.map((canonical) => canonical.normalizedUrl)).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);
    expect(result.raw.headings.filter((heading) => heading.level === 1)).toHaveLength(2);
  });

  it("records conflicting meta and X-Robots-Tag directives", () => {
    const result = extractFixture(HTML_PARSING_FIXTURES.conflictingRobots, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-robots-tag": ["noarchive", "googlebot: archive"],
      },
    });
    expect(result.raw.robots.effective).toEqual(
      expect.arrayContaining(["archive", "follow", "index", "noarchive", "nofollow", "noindex"]),
    );
    expect(result.raw.robots.conflicts).toEqual(
      expect.arrayContaining(["index/noindex", "follow/nofollow", "archive/noarchive"]),
    );
  });

  it("keeps invalid JSON-LD as bounded parse evidence", () => {
    const result = extractFixture(HTML_PARSING_FIXTURES.invalidJsonLd);
    expect(result.raw.jsonLd).toHaveLength(1);
    expect(result.raw.jsonLd[0]).toMatchObject({ value: null });
    expect(result.raw.jsonLd[0]?.error).toEqual(expect.any(String));
  });

  it("recovers useful data and parse issues from broken HTML", () => {
    const result = extractFixture(HTML_PARSING_FIXTURES.brokenHtml);
    expect(result.raw.title).toContain("Broken");
    expect(result.raw.links[0]?.normalizedTargetUrl).toBe("https://example.com/next");
    expect(result.raw.parseIssues.length).toBeGreaterThan(0);
  });

  it("detects and decodes a declared legacy character encoding", () => {
    const result = extractFixture(HTML_PARSING_FIXTURES.windows1252, {
      headers: { "content-type": "text/html" },
    });
    expect(result.raw.characterEncoding).toMatchObject({
      declared: "windows-1252",
      declarationOffsetBytes: expect.any(Number),
      source: "meta",
      used: "windows-1252",
    });
    expect(result.raw.title).toBe("Café");
    expect(result.raw.visibleText).toContain("Résumé");
  });

  it("records the ending byte of a meta charset declaration at the 1024-byte boundary", () => {
    const declaration = '<meta charset="utf-8';
    const atBoundary = `${" ".repeat(1_024 - Buffer.byteLength(declaration, "utf8"))}${declaration}"><title>Boundary</title>`;
    const afterBoundary = ` ${atBoundary}`;
    const boundary = extractFixture(
      { body: atBoundary, finalUrl: "https://example.com/encoding-boundary" },
      { headers: { "content-type": "text/html" } },
    );
    const late = extractFixture(
      { body: afterBoundary, finalUrl: "https://example.com/encoding-late" },
      { headers: { "content-type": "text/html" } },
    );

    expect(boundary.raw.characterEncoding.declarationOffsetBytes).toBe(1_024);
    expect(late.raw.characterEncoding.declarationOffsetBytes).toBe(1_025);
  });

  it("resolves relative references against the first valid base tag", () => {
    const result = extractFixture(HTML_PARSING_FIXTURES.relativeAndBase);
    expect(result.raw.baseUrl).toBe("https://example.com/docs/");
    expect(result.raw.canonical?.normalizedUrl).toBe("https://example.com/docs/guide");
    expect(result.raw.links[0]?.normalizedTargetUrl).toBe("https://example.com/docs/next?x=1");
    expect(result.raw.images[0]?.source.normalizedUrl).toBe(
      "https://example.com/docs/images/guide.png",
    );
    expect(result.raw.forms[0]?.action.normalizedUrl).toBe("https://example.com/docs/submit");
  });

  it("identifies client-rendered source and stores raw/rendered values separately", () => {
    const raw = HTML_PARSING_FIXTURES.clientRendered;
    const renderedBody =
      "<!doctype html><title>Rendered application</title><meta name=description content='Rendered metadata'><main><h1>Rendered content</h1><p>The browser produced meaningful application content after scripts completed successfully.</p></main>";
    const result = extractFixture(raw, {
      rendered: {
        body: renderedBody,
        kind: "rendered",
        renderingErrors: [
          { code: "resource_blocked", message: "An analytics script was blocked." },
        ],
      },
    });

    expect(result.raw.clientRenderedSignals).toEqual(
      expect.arrayContaining(["empty_application_root", "framework_bootstrap_payload"]),
    );
    expect(evaluateRenderingNeed(result.raw, true)).toMatchObject({
      reasons: expect.arrayContaining(["client_rendered"]),
      render: true,
    });
    expect(result.raw.title).toBeNull();
    expect(result.rendered).toMatchObject({
      sourceKind: "rendered",
      title: "Rendered application",
    });
    expect(result.rendered?.renderingErrors).toEqual([
      { code: "resource_blocked", message: "An analytics script was blocked." },
    ]);
  });

  it("produces exact and near-duplicate fingerprints deterministically", () => {
    const duplicateA = extractFixture(HTML_PARSING_FIXTURES.duplicateA).raw;
    const duplicateB = extractFixture(HTML_PARSING_FIXTURES.duplicateB).raw;
    const nearDuplicate = extractFixture(HTML_PARSING_FIXTURES.nearDuplicate).raw;
    expect(duplicateA.contentHash).toBe(duplicateB.contentHash);
    expect(duplicateA.similarityFingerprint).toBe(duplicateB.similarityFingerprint);
    expect(nearDuplicate.contentHash).not.toBe(duplicateA.contentHash);
    expect(
      similarityFingerprintDistance(
        duplicateA.similarityFingerprint,
        nearDuplicate.similarityFingerprint,
      ),
    ).toBeLessThanOrEqual(12);
  });
});

describe("deterministic sitemap parsing fixtures", () => {
  it("parses sitemap indexes and enforces recursive depth, file, and deduplication bounds", () => {
    const index = sitemapFixture(SITEMAP_PARSING_FIXTURES.index);
    expect(index).toMatchObject({ kind: "sitemap_index", state: "parsed" });
    expect(index.locations).toHaveLength(2);
    expect(index.locations[0]).toMatchObject({
      lastModified: "2026-07-01T12:30:00Z",
      lastModifiedValid: true,
      normalizedUrl: "https://example.com/section-a.xml",
    });

    const traversal = new SitemapTraversal({ maxDepth: 1, maxFiles: 3 });
    expect(
      traversal.add({
        depth: 0,
        discoverySource: "submitted",
        parentSitemapUrl: null,
        requestedUrl: index.finalUrl,
      }),
    ).toMatchObject({ accepted: true });
    expect(traversal.addIndex(index).map((result) => result.accepted)).toEqual([true, true]);
    expect(
      traversal.add({
        depth: 0,
        discoverySource: "robots",
        parentSitemapUrl: null,
        requestedUrl: index.finalUrl,
      }),
    ).toMatchObject({ accepted: false, reason: "duplicate" });
    expect(
      traversal.add({
        depth: 2,
        discoverySource: "index",
        parentSitemapUrl: index.finalUrl,
        requestedUrl: "https://example.com/too-deep.xml",
      }),
    ).toMatchObject({ accepted: false, reason: "depth" });
  });

  it("decompresses gzip urlsets, normalizes relative URLs, and preserves lastmod validity", () => {
    const parsed = sitemapFixture(SITEMAP_PARSING_FIXTURES.gzipUrlSet);
    expect(parsed).toMatchObject({ compression: "gzip", kind: "url_set", state: "parsed" });
    expect(parsed.decodedBytes).toBeGreaterThan(parsed.compressedBytes);
    expect(parsed.locations).toEqual([
      expect.objectContaining({
        lastModified: "2026-07-10",
        lastModifiedValid: true,
        normalizedUrl: "https://example.com/one",
      }),
      expect.objectContaining({
        lastModified: "not-a-date",
        lastModifiedValid: false,
        normalizedUrl: "https://example.com/relative",
      }),
    ]);
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: "invalid_lastmod" }));

    const decodedByHttp = parseSitemapDocument({
      body: SITEMAP_PARSING_FIXTURES.urlSet.body,
      contentEncoding: "gzip",
      contentType: "application/xml",
      depth: 0,
      discoverySource: "robots",
      finalUrl: SITEMAP_PARSING_FIXTURES.urlSet.finalUrl,
      redirectChain: [],
      requestedUrl: SITEMAP_PARSING_FIXTURES.urlSet.finalUrl,
      statusCode: 200,
      transferBytes: 120,
    });
    expect(decodedByHttp).toMatchObject({
      compressedBytes: 120,
      compression: "gzip",
      kind: "url_set",
      state: "parsed",
    });
    expect(decodedByHttp.decodedBytes).toBe(byteLength(SITEMAP_PARSING_FIXTURES.urlSet.body));
  });

  it("persists invalid XML and forbidden declaration parse errors", () => {
    const invalid = sitemapFixture(SITEMAP_PARSING_FIXTURES.invalid);
    expect(invalid.state).toBe("invalid");
    expect(invalid.issues).toContainEqual(expect.objectContaining({ code: "xml_error" }));

    const forbidden = sitemapFixture({
      body: '<!DOCTYPE urlset [<!ENTITY secret "unsafe">]><urlset><url><loc>&secret;</loc></url></urlset>',
      finalUrl: "https://example.com/forbidden.xml",
    });
    expect(forbidden).toMatchObject({ kind: "unknown", state: "invalid" });
    expect(forbidden.issues).toContainEqual(
      expect.objectContaining({ code: "forbidden_declaration" }),
    );
  });

  it("preserves redirect and HTTP status evidence for unavailable sitemaps", () => {
    const unavailable = parseSitemapDocument({
      body: "Service unavailable",
      contentType: "text/plain",
      depth: 0,
      discoverySource: "robots",
      finalUrl: "https://example.com/maps/current.xml",
      redirectChain: [
        {
          fromUrl: "https://example.com/sitemap.xml",
          statusCode: 301,
          toUrl: "https://example.com/maps/current.xml",
        },
      ],
      requestedUrl: "https://example.com/sitemap.xml",
      statusCode: 503,
      transferBytes: 19,
    });

    expect(unavailable).toMatchObject({
      finalUrl: "https://example.com/maps/current.xml",
      requestedUrl: "https://example.com/sitemap.xml",
      state: "unavailable",
      statusCode: 503,
    });
    expect(unavailable.redirectChain).toHaveLength(1);
  });
});
