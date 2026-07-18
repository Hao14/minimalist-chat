import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { normalizeProjectOrigin } from "@searvia/shared-types";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";

import type { SearviaDatabase } from "./client.js";
import {
  createSearviaCrawlRepository,
  type CrawlExecutionContext,
  type PageArtifactInput,
  type PageExtractionInput,
  type PageObservationInput,
  type SitemapObservationInput,
} from "./crawl-repository.js";
import { createSearviaRepository, type CrawlConfigInput } from "./repository.js";
import { crawlPageArtifacts, crawls, searviaSchema, sessions, users } from "./schema.js";

const migrationsFolder = fileURLToPath(new URL("../migrations/", import.meta.url));
const clients: PGlite[] = [];

interface TestContext {
  readonly database: PgliteDatabase<typeof searviaSchema>;
  readonly tenant: ReturnType<typeof createSearviaRepository>;
  readonly crawl: ReturnType<typeof createSearviaCrawlRepository>;
}

interface Identity {
  readonly userId: string;
  readonly sessionId: string;
}

async function createContext(): Promise<TestContext> {
  const client = new PGlite();
  clients.push(client);
  const database = drizzle(client, { schema: searviaSchema });
  await migrate(database, { migrationsFolder });
  const typed = database as unknown as SearviaDatabase;
  return {
    database,
    tenant: createSearviaRepository(typed),
    crawl: createSearviaCrawlRepository(typed),
  };
}

async function createIdentity(database: TestContext["database"], email: string): Promise<Identity> {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await database.insert(users).values({ id: userId, name: email, email });
  await database.insert(sessions).values({
    id: sessionId,
    token: crypto.randomUUID(),
    userId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return { userId, sessionId };
}

async function onboard(
  context: TestContext,
  identity: Identity,
  hostname: string,
  crawlConfig: CrawlConfigInput = {
    pageLimit: 10,
    maxDepth: 3,
    includeSubdomains: false,
    queryPolicy: "ignore_tracking",
  },
) {
  const result = await context.tenant.createOnboarding({
    userId: identity.userId,
    sessionId: identity.sessionId,
    organizationName: `${hostname} team`,
    name: hostname,
    target: normalizeProjectOrigin(hostname),
    crawlConfig,
    traceId: crypto.randomUUID(),
  });
  const scope = await context.tenant.loadActiveOrganizationScope(
    identity.userId,
    identity.sessionId,
  );
  if (scope === null) throw new Error("Expected an active organization scope.");
  return { ...result, scope };
}

async function startExecution(
  context: TestContext,
  hostname: string,
  crawlConfig?: CrawlConfigInput,
) {
  const owner = await createIdentity(context.database, `owner@${hostname}`);
  const setup = await onboard(context, owner, hostname, crawlConfig);
  const created = await context.crawl.createCrawl(setup.scope, setup.projectId, {
    idempotencyKey: crypto.randomUUID(),
    traceId: crypto.randomUUID(),
  });
  const claim = await context.crawl.claimExecution({
    organizationId: setup.organizationId,
    projectId: setup.projectId,
    crawlId: created.crawl.id,
    leaseMs: 120_000,
  });
  if (claim.kind !== "claimed") throw new Error("Expected the crawl to be claimed.");
  const execution: CrawlExecutionContext = {
    organizationId: setup.organizationId,
    projectId: setup.projectId,
    crawlId: created.crawl.id,
    executionToken: claim.executionToken,
  };
  return { ...setup, claim, created, execution };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function persistHtmlPage(
  context: TestContext,
  execution: CrawlExecutionContext,
  url: string,
  input: Readonly<{ depth?: number; statusCode?: number }> = {},
) {
  const urlHash = sha256(url);
  const frontier = await context.crawl.persistDiscoveredUrl(execution, {
    requestedUrl: url,
    discoveredUrl: url,
    normalizedUrl: url,
    urlHash,
    origin: new URL(url).origin,
    hostname: new URL(url).hostname,
    depth: input.depth ?? 0,
    discoverySource: input.depth === undefined || input.depth === 0 ? "seed" : "link",
    discoveredFromFrontierId: null,
  });
  await context.crawl.markFrontierFetching(execution, frontier.id);
  const observation: PageObservationInput = {
    frontierId: frontier.id,
    requestedUrl: url,
    normalizedUrl: url,
    finalUrl: url,
    urlHash,
    statusCode: input.statusCode ?? 200,
    contentType: "text/html; charset=utf-8",
    responseHeaders: { "content-type": ["text/html; charset=utf-8"] },
    omittedResponseHeaders: ["set-cookie"],
    contentLength: 512,
    responseBytes: 512,
    transferSize: 220,
    compression: "gzip",
    cacheHeaders: { "cache-control": ["public, max-age=60"] },
    securityHeaders: { "content-security-policy": ["default-src 'self'"] },
    depth: input.depth ?? 0,
    redirectChain: [],
    robotsDecision: "not_checked",
    robotsObservationId: null,
    timing: {
      startedAt: new Date().toISOString(),
      dnsMs: 1,
      ttfbMs: 2,
      downloadMs: 3,
      totalMs: 6,
    },
    errorType: null,
    errorMessage: null,
    discoverySource: input.depth === undefined || input.depth === 0 ? "seed" : "link",
    outcome: (input.statusCode ?? 200) >= 400 ? "failed" : "succeeded",
  };
  const page = await context.crawl.persistPageObservation(execution, observation);
  return { frontier, observation, page };
}

function artifactInput(execution: CrawlExecutionContext, pageId: string): PageArtifactInput {
  const contentSha256 = sha256("<html>source</html>");
  return {
    pageId,
    kind: "raw-html",
    bucket: "searvia-artifacts",
    key: `organizations/${execution.organizationId}/projects/${execution.projectId}/crawls/${execution.crawlId}/pages/${pageId}/raw-html.html.gz`,
    objectVersion: "version-1",
    etag: "etag-1",
    contentType: "text/html; charset=utf-8",
    contentEncoding: "gzip",
    originalBytes: 20,
    storedBytes: 16,
    contentSha256,
    storageSha256: sha256("compressed-source"),
    storedAt: new Date(),
  };
}

function extractionInput(
  pageId: string,
  target?: Readonly<{ frontierId: string; url: string }>,
): PageExtractionInput {
  const links =
    target === undefined
      ? []
      : [
          {
            targetFrontierId: target.frontierId,
            targetPageId: null,
            targetUrl: target.url,
            normalizedTargetUrl: target.url,
            targetUrlHash: sha256(target.url),
            scope: "internal" as const,
            anchorText: "Read more",
            relValues: ["nofollow"],
            linkType: "anchor" as const,
            hreflang: null,
            discovered: true,
            crawlDepth: 1,
            discoverySource: "link" as const,
            ordinal: 0,
          },
        ];
  return {
    pageId,
    source: "raw",
    status: "succeeded",
    title: "A real page",
    metaDescription: "Observed description",
    metaRobots: ["index", "follow"],
    xRobotsTag: ["max-snippet:-1"],
    directiveScopePreserved: true,
    canonicalUrl: "https://persist.example.com/",
    canonicalTagCount: 2,
    canonicalNormalizationFailure: null,
    visibleText: "A real page with visible words.",
    wordCount: 6,
    htmlLanguage: "en",
    characterEncoding: "utf-8",
    openGraph: { "og:title": ["A real page"] },
    socialCards: { "twitter:card": ["summary"] },
    contentHash: sha256("visible-content"),
    domHash: sha256("normalized-dom"),
    similarityFingerprint: "00112233445566778899aabbccddeeff",
    meaningfulContent: true,
    clientRendered: false,
    renderingErrorType: null,
    renderingErrorMessage: null,
    headings: [
      { level: 1, ordinal: 0, text: "Primary heading" },
      { level: 2, ordinal: 1, text: "Secondary heading" },
    ],
    links,
    images: [
      {
        sourceUrl: "/hero.png",
        normalizedUrl: "https://persist.example.com/hero.png",
        urlHash: sha256("https://persist.example.com/hero.png"),
        scope: "internal",
        altText: "Product hero",
        title: null,
        width: 1200,
        height: 630,
        loading: "eager",
        srcset: null,
        ordinal: 0,
      },
    ],
    resources: [
      {
        resourceType: "script",
        sourceUrl: "/app.js",
        normalizedUrl: "https://persist.example.com/app.js",
        urlHash: sha256("https://persist.example.com/app.js"),
        scope: "internal",
        robotsDecision: "not_checked",
        robotsObservationId: null,
        attributes: { type: "module" },
        ordinal: 0,
      },
      {
        resourceType: "form",
        sourceUrl: "/contact",
        normalizedUrl: "https://persist.example.com/contact",
        urlHash: sha256("https://persist.example.com/contact"),
        scope: "internal",
        robotsDecision: "not_checked",
        robotsObservationId: null,
        attributes: { method: "post" },
        ordinal: 1,
      },
    ],
    structuredData: [
      {
        kind: "json_ld",
        parseStatus: "parsed",
        schemaTypes: ["Organization"],
        rawValue: '{"@type":"Organization"}',
        parsedValue: { "@type": "Organization" },
        errorMessage: null,
        ordinal: 0,
      },
      {
        kind: "json_ld",
        parseStatus: "invalid",
        schemaTypes: [],
        rawValue: "{invalid",
        parsedValue: null,
        errorMessage: "Invalid JSON-LD.",
        ordinal: 1,
      },
      {
        kind: "microdata",
        parseStatus: "parsed",
        schemaTypes: ["Product"],
        rawValue: '{"itemtype":"Product"}',
        parsedValue: { itemtype: "Product" },
        errorMessage: null,
        ordinal: 2,
      },
    ],
    extractedAt: new Date(),
  };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("M3 crawl persistence", () => {
  it("persists complete page evidence, graph records, artifacts, and sitemaps idempotently", async () => {
    const context = await createContext();
    const setup = await startExecution(context, "persist.example.com", {
      pageLimit: 10,
      maxDepth: 3,
      includeSubdomains: false,
      queryPolicy: "ignore_tracking",
      renderingEnabled: true,
      submittedSitemapUrls: ["https://persist.example.com/submitted.xml"],
    });
    expect(setup.claim.crawl.config).toMatchObject({
      renderingEnabled: true,
      submittedSitemapUrls: ["https://persist.example.com/submitted.xml"],
    });
    const robotsInput = {
      origin: "https://persist.example.com",
      hostname: "persist.example.com",
      requestedUrl: "https://persist.example.com/robots.txt",
      finalUrl: "https://persist.example.com/robots.txt",
      statusCode: 200,
      contentType: "text/plain",
      result: "fetched" as const,
      userAgent: setup.claim.crawl.config.userAgent,
      contentSha256: sha256("User-agent: *\nAllow: /"),
      content: "User-agent: *\nAllow: /",
      crawlDelayMs: null,
      sitemapUrls: [],
      fetchedAt: new Date(),
    };
    const robotsObservation = await context.crawl.persistRobotsObservation(
      setup.execution,
      robotsInput,
    );
    expect(robotsObservation).toMatchObject({ created: true, result: "fetched" });
    expect(await context.crawl.persistRobotsObservation(setup.execution, robotsInput)).toEqual({
      ...robotsObservation,
      created: false,
    });
    await expect(
      context.crawl.persistRobotsObservation(setup.execution, {
        ...robotsInput,
        finalUrl: null,
        statusCode: null,
        contentType: null,
        result: "unavailable",
        contentSha256: null,
        content: null,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const source = await persistHtmlPage(context, setup.execution, "https://persist.example.com/");
    const targetUrl = "https://persist.example.com/about";
    const target = await context.crawl.persistDiscoveredUrl(setup.execution, {
      requestedUrl: targetUrl,
      discoveredUrl: targetUrl,
      normalizedUrl: targetUrl,
      urlHash: sha256(targetUrl),
      origin: "https://persist.example.com",
      hostname: "persist.example.com",
      depth: 1,
      discoverySource: "link",
      discoveredFromFrontierId: source.frontier.id,
    });

    const baseExtraction = extractionInput(source.page.pageId, {
      frontierId: target.id,
      url: targetUrl,
    });
    const extraction = {
      ...baseExtraction,
      resources: baseExtraction.resources.map((resource) =>
        resource.resourceType === "script"
          ? {
              ...resource,
              robotsDecision: "allowed" as const,
              robotsObservationId: robotsObservation.id,
            }
          : resource,
      ),
      visibleText: "x".repeat(10_001),
      structuredData: [
        ...baseExtraction.structuredData,
        ...Array.from({ length: 8 }, (_, index) => ({
          kind: "microdata" as const,
          parseStatus: "parsed" as const,
          schemaTypes: ["Thing"],
          rawValue: `{"item":"${index}"}`,
          parsedValue: { item: index },
          errorMessage: null,
          ordinal: index + 3,
        })),
      ],
    } satisfies PageExtractionInput;
    const storedExtraction = await context.crawl.persistPageExtraction(setup.execution, extraction);
    expect(storedExtraction.created).toBe(true);
    expect(await context.crawl.persistPageExtraction(setup.execution, extraction)).toEqual({
      extractionId: storedExtraction.extractionId,
      created: false,
    });
    await expect(
      context.crawl.persistPageExtraction(setup.execution, {
        ...extraction,
        xRobotsTag: ["noindex"],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      context.crawl.persistPageExtraction(setup.execution, {
        ...extraction,
        directiveScopePreserved: false,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      context.crawl.persistPageExtraction(setup.execution, {
        ...extraction,
        resources: extraction.resources.map((resource) =>
          resource.resourceType === "script"
            ? { ...resource, robotsDecision: "disallowed" as const }
            : resource,
        ),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const artifact = artifactInput(setup.execution, source.page.pageId);
    const storedArtifact = await context.crawl.persistPageArtifact(setup.execution, artifact);
    expect(storedArtifact.created).toBe(true);
    expect(await context.crawl.persistPageArtifact(setup.execution, artifact)).toEqual({
      artifactId: storedArtifact.artifactId,
      created: false,
    });

    const sitemapUrl = "https://persist.example.com/sitemap.xml.gz";
    const sitemapObservation = {
      parentSitemapId: null,
      requestedUrl: sitemapUrl,
      normalizedUrl: sitemapUrl,
      finalUrl: sitemapUrl,
      urlHash: sha256(sitemapUrl),
      source: "submitted",
      status: "parsed",
      format: "index",
      compression: "gzip",
      statusCode: 200,
      contentType: "application/xml",
      contentLength: 250,
      transferSize: 180,
      contentDigest: sha256("<sitemapindex />"),
      depth: 0,
      redirectChain: [],
      parseIssues: [
        {
          code: "invalid_lastmod",
          entryIndex: 0,
          message: "A malformed lastmod was retained as parse evidence.",
        },
      ],
      errorType: null,
      errorMessage: null,
      fetchedAt: new Date(),
      parsedAt: new Date(),
      entries: [
        {
          entryType: "url",
          loc: targetUrl,
          normalizedLoc: targetUrl,
          urlHash: sha256(targetUrl),
          lastmodRaw: "2026-07-14",
          lastmodAt: new Date("2026-07-14T00:00:00.000Z"),
          targetFrontierId: target.id,
          targetPageId: null,
          targetSitemapId: null,
          ordinal: 0,
        },
        {
          entryType: "sitemap",
          loc: "https://persist.example.com/articles.xml",
          normalizedLoc: "https://persist.example.com/articles.xml",
          urlHash: sha256("https://persist.example.com/articles.xml"),
          lastmodRaw: null,
          lastmodAt: null,
          targetFrontierId: null,
          targetPageId: null,
          targetSitemapId: null,
          ordinal: 1,
        },
      ],
    } satisfies SitemapObservationInput;
    const sitemap = await context.crawl.persistSitemapObservation(
      setup.execution,
      sitemapObservation,
    );
    expect(sitemap).toMatchObject({ created: true, insertedEntryCount: 2 });
    expect(
      await context.crawl.persistSitemapObservation(setup.execution, sitemapObservation),
    ).toEqual({ sitemapId: sitemap.sitemapId, created: false, insertedEntryCount: 0 });
    await expect(
      context.crawl.persistSitemapObservation(setup.execution, {
        ...sitemapObservation,
        contentDigest: sha256("<sitemapindex><sitemap /></sitemapindex>"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const pageConnection = await context.crawl.listCrawlPages(
      setup.scope,
      setup.projectId,
      setup.created.crawl.id,
    );
    expect(pageConnection.items).toHaveLength(1);
    expect(pageConnection.items[0]).toMatchObject({
      id: source.page.pageId,
      statusCode: 200,
      responseHeaders: { "content-type": ["text/html; charset=utf-8"] },
      omittedResponseHeaders: ["set-cookie"],
      transferSize: 220,
      compression: "gzip",
    });
    const detail = await context.crawl.getCrawlPage(
      setup.scope,
      setup.projectId,
      setup.created.crawl.id,
      source.page.pageId,
    );
    expect(detail.extractions).toHaveLength(1);
    expect(detail.extractions[0]).toMatchObject({
      visibleText: "x".repeat(10_000),
      visibleTextTruncated: true,
    });
    expect(detail.artifacts).toMatchObject([
      {
        kind: "raw_html",
        contentSha256: artifact.contentSha256,
        storageSha256: artifact.storageSha256,
      },
    ]);
    expect(detail.headings).toHaveLength(2);
    expect(detail.links).toMatchObject([{ anchorText: "Read more", discovered: true }]);
    expect(detail.images).toHaveLength(1);
    expect(detail.resources).toHaveLength(2);
    expect(detail.structuredData).toHaveLength(10);
    expect(detail.collectionTruncated).toEqual({
      headings: false,
      links: false,
      images: false,
      resources: false,
      structuredData: true,
    });

    const sitemapDetail = await context.crawl.getCrawlSitemap(
      setup.scope,
      setup.projectId,
      setup.created.crawl.id,
      sitemap.sitemapId,
    );
    expect(sitemapDetail.sitemap).toMatchObject({
      compression: "gzip",
      contentDigest: sitemapObservation.contentDigest,
      parseIssues: sitemapObservation.parseIssues,
      urlCount: 1,
    });
    expect(sitemapDetail.entries[0]).toMatchObject({
      lastmodRaw: "2026-07-14",
      lastmodAt: new Date("2026-07-14T00:00:00.000Z"),
    });
    expect(
      await context.crawl.getCrawl(setup.scope, setup.projectId, setup.created.crawl.id),
    ).toMatchObject({
      extractedPageCount: 1,
      extractionFailedCount: 0,
      artifactCount: 1,
      sitemapCount: 1,
      sitemapUrlCount: 1,
    });
  });

  it("uses stable page cursors and denies cross-tenant page and artifact references", async () => {
    const context = await createContext();
    const first = await startExecution(context, "first-tenant.example.com");
    const pages = [];
    for (const path of ["/a", "/b", "/c"]) {
      pages.push(
        await persistHtmlPage(context, first.execution, `https://first-tenant.example.com${path}`),
      );
    }
    const pageOne = await context.crawl.listCrawlPages(
      first.scope,
      first.projectId,
      first.created.crawl.id,
      { limit: 2 },
    );
    expect(pageOne.items.map((page) => page.normalizedUrl)).toEqual([
      "https://first-tenant.example.com/a",
      "https://first-tenant.example.com/b",
    ]);
    expect(pageOne.nextCursor).not.toBeNull();
    const pageTwo = await context.crawl.listCrawlPages(
      first.scope,
      first.projectId,
      first.created.crawl.id,
      { limit: 2, cursor: pageOne.nextCursor },
    );
    expect(pageTwo.items.map((page) => page.normalizedUrl)).toEqual([
      "https://first-tenant.example.com/c",
    ]);
    expect(pageTwo.nextCursor).toBeNull();

    const secondOwner = await createIdentity(context.database, "owner@second-tenant.example.com");
    const second = await onboard(context, secondOwner, "second-tenant.example.com");
    await expect(
      context.crawl.getCrawlPage(
        second.scope,
        second.projectId,
        first.created.crawl.id,
        pages[0]!.page.pageId,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      context.database.insert(crawlPageArtifacts).values({
        organizationId: second.organizationId,
        projectId: second.projectId,
        crawlId: first.created.crawl.id,
        pageId: pages[0]!.page.pageId,
        kind: "raw_html",
        bucket: "searvia-artifacts",
        objectKey: `organizations/${second.organizationId}/projects/${second.projectId}/crawls/${first.created.crawl.id}/pages/${pages[0]!.page.pageId}/raw-html.html.gz`,
        objectVersion: null,
        etag: null,
        contentType: "text/html; charset=utf-8",
        contentEncoding: "gzip",
        uncompressedBytes: 20,
        storedBytes: 16,
        contentSha256: sha256("content"),
        storageSha256: sha256("storage"),
      }),
    ).rejects.toThrow();
  });

  it("rehydrates fetched HTML observations until raw extraction and artifact metadata both persist", async () => {
    const context = await createContext();
    const setup = await startExecution(context, "resume-m3.example.com");
    const stored = await persistHtmlPage(
      context,
      setup.execution,
      "https://resume-m3.example.com/error",
      { statusCode: 503 },
    );

    expect(await context.crawl.listResumableFrontier(setup.execution, 10)).toMatchObject([
      { countsTowardPageLimit: false, urlHash: stored.observation.urlHash },
    ]);
    await context.crawl.markFrontierFetching(setup.execution, stored.frontier.id);
    const updatedIncompleteObservation = {
      ...stored.observation,
      statusCode: 502,
      responseBytes: 600,
      transferSize: 250,
      errorMessage: "The retry received a different incomplete response.",
    } as const;
    expect(
      await context.crawl.persistPageObservation(setup.execution, updatedIncompleteObservation),
    ).toEqual({
      pageId: stored.page.pageId,
      created: false,
      rawArtifactExists: false,
      storedObservation: expect.objectContaining({
        statusCode: 503,
        responseBytes: 512,
      }),
    });
    expect(
      await context.crawl.getCrawlPage(
        setup.scope,
        setup.projectId,
        setup.created.crawl.id,
        stored.page.pageId,
      ),
    ).toMatchObject({ page: { statusCode: 503, responseBytes: 512 } });
    await context.crawl.replaceIncompletePageObservation(
      setup.execution,
      stored.page.pageId,
      updatedIncompleteObservation,
    );
    expect(
      await context.crawl.getCrawlPage(
        setup.scope,
        setup.projectId,
        setup.created.crawl.id,
        stored.page.pageId,
      ),
    ).toMatchObject({ page: { statusCode: 502, responseBytes: 600 } });
    await context.crawl.persistPageArtifact(
      setup.execution,
      artifactInput(setup.execution, stored.page.pageId),
    );

    expect(await context.crawl.listResumableFrontier(setup.execution, 10)).toMatchObject([
      { countsTowardPageLimit: false, urlHash: stored.observation.urlHash },
    ]);
    await context.crawl.markFrontierFetching(setup.execution, stored.frontier.id);
    expect(
      await context.crawl.persistPageObservation(setup.execution, {
        ...updatedIncompleteObservation,
        statusCode: 500,
      }),
    ).toEqual({
      pageId: stored.page.pageId,
      created: false,
      rawArtifactExists: true,
      storedObservation: expect.objectContaining({
        statusCode: 502,
        responseBytes: 600,
      }),
    });
    expect(
      await context.crawl.getCrawlPage(
        setup.scope,
        setup.projectId,
        setup.created.crawl.id,
        stored.page.pageId,
      ),
    ).toMatchObject({ page: { statusCode: 502, responseBytes: 600 } });
    await context.crawl.persistPageExtraction(setup.execution, extractionInput(stored.page.pageId));

    expect(await context.crawl.listResumableFrontier(setup.execution, 10)).toEqual([]);
    const [storedCrawl] = await context.database
      .select()
      .from(crawls)
      .where(eq(crawls.id, setup.created.crawl.id));
    expect(storedCrawl).toMatchObject({
      processedCount: 1,
      succeededCount: 0,
      failedCount: 1,
      extractedPageCount: 1,
      artifactCount: 1,
    });
  });
});
