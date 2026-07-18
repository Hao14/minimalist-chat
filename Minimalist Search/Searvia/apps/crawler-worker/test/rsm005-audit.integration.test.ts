import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { createM4AAuditEngine } from "@searvia/audit-engine";
import {
  crawlPageResources,
  crawlPages,
  crawlSitemaps,
  createSearviaCrawlRepository,
  createSearviaRepository,
  searviaSchema,
  sessions,
  users,
  type SearviaDatabase,
} from "@searvia/database";
import { normalizeProjectOrigin } from "@searvia/shared-types";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";

const migrationsFolder = fileURLToPath(
  new URL("../../../packages/database/migrations/", import.meta.url),
);
const clients: PGlite[] = [];

interface TestContext {
  readonly database: PgliteDatabase<typeof searviaSchema>;
  readonly tenant: ReturnType<typeof createSearviaRepository>;
  readonly crawl: ReturnType<typeof createSearviaCrawlRepository>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

async function onboard(context: TestContext, hostname: string) {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await context.database.insert(users).values({
    id: userId,
    name: hostname,
    email: `owner@${hostname}`,
  });
  await context.database.insert(sessions).values({
    id: sessionId,
    token: crypto.randomUUID(),
    userId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const setup = await context.tenant.createOnboarding({
    userId,
    sessionId,
    organizationName: `${hostname} team`,
    name: hostname,
    target: normalizeProjectOrigin(hostname),
    crawlConfig: {
      pageLimit: 10,
      maxDepth: 2,
      includeSubdomains: false,
      queryPolicy: "ignore_tracking",
    },
    traceId: crypto.randomUUID(),
  });
  const scope = await context.tenant.loadActiveOrganizationScope(userId, sessionId);
  if (scope === null) throw new Error("Expected an active organization scope.");
  return { ...setup, scope };
}

async function completedResourceSnapshot(
  context: TestContext,
  hostname: string,
  decision: "allowed" | "disallowed",
) {
  const setup = await onboard(context, hostname);
  const created = await context.crawl.createCrawl(setup.scope, setup.projectId, {
    idempotencyKey: crypto.randomUUID(),
    traceId: crypto.randomUUID(),
  });
  const startedAt = new Date();
  const claim = await context.crawl.claimExecution({
    organizationId: setup.organizationId,
    projectId: setup.projectId,
    crawlId: created.crawl.id,
    executionToken: crypto.randomUUID(),
    leaseMs: 120_000,
    now: startedAt,
  });
  if (claim.kind !== "claimed") throw new Error("Expected a claimed crawl execution.");
  const execution = { ...claim.crawl, executionToken: claim.executionToken };
  await context.crawl.transitionStage(execution, "discovering");
  await context.crawl.transitionStage(execution, "crawling");

  const origin = `https://${hostname}`;
  const pageUrl = `${origin}/`;
  const resourceUrl = `${origin}/assets/app.js`;
  const robotsContent =
    decision === "disallowed"
      ? "User-agent: SearviaBot\nDisallow: /assets/app.js"
      : "User-agent: SearviaBot\nAllow: /assets/app.js";
  const robotsObservation = await context.crawl.persistRobotsObservation(execution, {
    origin,
    hostname,
    requestedUrl: `${origin}/robots.txt`,
    finalUrl: `${origin}/robots.txt`,
    statusCode: 200,
    contentType: "text/plain",
    result: "fetched",
    userAgent: claim.crawl.config.userAgent,
    contentSha256: sha256(robotsContent),
    content: robotsContent,
    crawlDelayMs: null,
    sitemapUrls: [],
    fetchedAt: new Date(),
  });
  const frontier = await context.crawl.persistDiscoveredUrl(execution, {
    requestedUrl: pageUrl,
    discoveredUrl: pageUrl,
    normalizedUrl: pageUrl,
    urlHash: sha256(pageUrl),
    origin,
    hostname,
    depth: 0,
    discoverySource: "seed",
    discoveredFromFrontierId: null,
  });
  const page = await context.crawl.persistPageObservation(execution, {
    frontierId: frontier.id,
    requestedUrl: pageUrl,
    normalizedUrl: pageUrl,
    finalUrl: pageUrl,
    urlHash: sha256(pageUrl),
    statusCode: 200,
    contentType: "text/html; charset=utf-8",
    responseHeaders: { "content-type": ["text/html; charset=utf-8"] },
    contentLength: 256,
    responseBytes: 256,
    transferSize: 192,
    compression: "gzip",
    cacheHeaders: {},
    securityHeaders: {},
    depth: 0,
    redirectChain: [],
    robotsDecision: "allowed",
    robotsObservationId: robotsObservation.id,
    timing: null,
    errorType: null,
    errorMessage: null,
    discoverySource: "seed",
    outcome: "succeeded",
  });
  const visibleText = "A meaningful public page with a deterministic first-party script resource.";
  await context.crawl.persistPageExtraction(execution, {
    pageId: page.pageId,
    source: "raw",
    status: "succeeded",
    title: "Resource policy fixture",
    metaDescription: null,
    metaRobots: ["index", "follow"],
    xRobotsTag: [],
    directiveScopePreserved: true,
    linksComplete: true,
    canonicalUrl: pageUrl,
    canonicalTagCount: 1,
    canonicalNormalizationFailure: null,
    visibleText,
    wordCount: visibleText.split(/\s+/u).length,
    htmlLanguage: "en",
    characterEncoding: "utf-8",
    openGraph: {},
    socialCards: {},
    contentHash: sha256(visibleText),
    domHash: sha256(`<main>${visibleText}</main>`),
    similarityFingerprint: "00112233445566778899aabbccddeeff",
    meaningfulContent: true,
    clientRendered: false,
    renderingErrorType: null,
    renderingErrorMessage: null,
    headings: [{ level: 1, ordinal: 0, text: "Resource policy fixture" }],
    links: [],
    images: [],
    resources: [
      {
        resourceType: "script",
        sourceUrl: resourceUrl,
        normalizedUrl: resourceUrl,
        urlHash: sha256(resourceUrl),
        scope: "internal",
        robotsDecision: decision,
        robotsObservationId: robotsObservation.id,
        attributes: { defer: "" },
        ordinal: 0,
      },
    ],
    structuredData: [],
    extractedAt: new Date(),
  });
  await context.crawl.completeExecution(execution, {
    status: "completed",
    completionReason: "frontier_exhausted",
    now: new Date(startedAt.getTime() + 10_000),
  });

  return context.crawl.loadAuditCrawlSnapshot({
    organizationId: setup.organizationId,
    projectId: setup.projectId,
    crawlId: created.crawl.id,
  });
}

async function completedRobotsSnapshot(
  context: TestContext,
  hostname: string,
  scenario: "explicit-disallow" | "unavailable" | "malformed" | "whole-site-disallow",
) {
  const setup = await onboard(context, hostname);
  const created = await context.crawl.createCrawl(setup.scope, setup.projectId, {
    idempotencyKey: crypto.randomUUID(),
    traceId: crypto.randomUUID(),
  });
  const startedAt = new Date();
  const claim = await context.crawl.claimExecution({
    organizationId: setup.organizationId,
    projectId: setup.projectId,
    crawlId: created.crawl.id,
    executionToken: crypto.randomUUID(),
    leaseMs: 120_000,
    now: startedAt,
  });
  if (claim.kind !== "claimed") throw new Error("Expected a claimed crawl execution.");
  const execution = { ...claim.crawl, executionToken: claim.executionToken };
  await context.crawl.transitionStage(execution, "discovering");
  await context.crawl.transitionStage(execution, "crawling");

  const origin = `https://${hostname}`;
  const pageUrl = scenario === "explicit-disallow" ? `${origin}/private` : `${origin}/`;
  const robotsContent =
    scenario === "unavailable"
      ? null
      : scenario === "malformed"
        ? "User-agent: SearviaBot\nBogus-directive: /private\nAllow: /\n"
        : scenario === "explicit-disallow"
          ? "User-agent: SearviaBot\nDisallow: /private\n"
          : "User-agent: SearviaBot\nDisallow: /\n";
  const robotsObservation = await context.crawl.persistRobotsObservation(execution, {
    origin,
    hostname,
    requestedUrl: `${origin}/robots.txt`,
    finalUrl: `${origin}/robots.txt`,
    statusCode: scenario === "unavailable" ? 503 : 200,
    contentType: "text/plain",
    result: scenario === "unavailable" ? "unavailable" : "fetched",
    userAgent: claim.crawl.config.userAgent,
    contentSha256: robotsContent === null ? null : sha256(robotsContent),
    content: robotsContent,
    crawlDelayMs: null,
    sitemapUrls: [],
    fetchedAt: new Date(),
  });
  const frontier = await context.crawl.persistDiscoveredUrl(execution, {
    requestedUrl: pageUrl,
    discoveredUrl: pageUrl,
    normalizedUrl: pageUrl,
    urlHash: sha256(pageUrl),
    origin,
    hostname,
    depth: 0,
    discoverySource: "seed",
    discoveredFromFrontierId: null,
  });
  const requestAllowed = scenario === "malformed";
  const explicitlyDisallowed =
    scenario === "explicit-disallow" || scenario === "whole-site-disallow";
  await context.crawl.persistPageObservation(execution, {
    frontierId: frontier.id,
    requestedUrl: pageUrl,
    normalizedUrl: pageUrl,
    finalUrl: requestAllowed ? pageUrl : null,
    urlHash: sha256(pageUrl),
    statusCode: requestAllowed ? 200 : null,
    contentType: requestAllowed ? "text/html; charset=utf-8" : null,
    responseHeaders: requestAllowed ? { "content-type": ["text/html; charset=utf-8"] } : {},
    contentLength: requestAllowed ? 128 : null,
    responseBytes: requestAllowed ? 128 : 0,
    transferSize: requestAllowed ? 128 : 0,
    compression: null,
    cacheHeaders: {},
    securityHeaders: {},
    depth: 0,
    redirectChain: [],
    robotsDecision: explicitlyDisallowed
      ? "disallowed"
      : requestAllowed
        ? "allowed"
        : "not_checked",
    robotsObservationId: robotsObservation.id,
    timing: null,
    errorType: explicitlyDisallowed
      ? "robots_disallowed"
      : requestAllowed
        ? null
        : "robots_unreachable",
    errorMessage: explicitlyDisallowed
      ? "The URL is explicitly disallowed by robots.txt."
      : requestAllowed
        ? null
        : "The robots policy was unavailable, so the request was blocked fail-closed.",
    discoverySource: "seed",
    outcome: requestAllowed ? "succeeded" : "blocked",
  });
  await context.crawl.completeExecution(execution, {
    status: "completed",
    completionReason: "frontier_exhausted",
    now: new Date(startedAt.getTime() + 10_000),
  });
  return context.crawl.loadAuditCrawlSnapshot({
    organizationId: setup.organizationId,
    projectId: setup.projectId,
    crawlId: created.crawl.id,
  });
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("RSM-005 completed-crawl persistence", () => {
  it("fails for a persisted blocked resource and passes for a persisted allowed resource", async () => {
    const context = await createContext();
    const blockedSnapshot = await completedResourceSnapshot(
      context,
      "blocked-resource.example",
      "disallowed",
    );
    const allowedSnapshot = await completedResourceSnapshot(
      context,
      "allowed-resource.example",
      "allowed",
    );

    expect(blockedSnapshot.pages[0]?.resources[0]).toMatchObject({
      robotsDecision: "disallowed",
      robotsObservationId: expect.any(String),
      robotsResult: "fetched",
    });
    expect(allowedSnapshot.pages[0]?.resources[0]).toMatchObject({
      robotsDecision: "allowed",
      robotsObservationId: expect.any(String),
      robotsResult: "fetched",
    });
    const blockedFinding = createM4AAuditEngine()
      .evaluate(blockedSnapshot)
      .results.find((result) => result.ruleId === "RSM-005");
    const allowedFinding = createM4AAuditEngine()
      .evaluate(allowedSnapshot)
      .results.find((result) => result.ruleId === "RSM-005");

    expect(blockedFinding).toMatchObject({
      ruleVersion: 3,
      eligibility: { state: "eligible" },
      status: "failed",
    });
    expect(blockedFinding?.evidence[0]).toMatchObject({
      field: "resourceRobotsDecision",
      value: expect.stringContaining("robotsObservationId="),
    });
    expect(allowedFinding).toMatchObject({
      ruleVersion: 3,
      eligibility: { state: "eligible" },
      status: "passed",
    });
  }, 30_000);
});

describe("robots provenance completed-crawl integration", () => {
  it("persists bounded fetched robots text immutably", async () => {
    const context = await createContext();
    const setup = await onboard(context, "robots-content.example");
    const created = await context.crawl.createCrawl(setup.scope, setup.projectId, {
      idempotencyKey: crypto.randomUUID(),
      traceId: crypto.randomUUID(),
    });
    const claim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      executionToken: crypto.randomUUID(),
      leaseMs: 120_000,
    });
    if (claim.kind !== "claimed") throw new Error("Expected a claimed crawl execution.");
    const execution = { ...claim.crawl, executionToken: claim.executionToken };
    const content = "User-agent: SearviaBot\nAllow: /\n";
    const input = {
      origin: "https://robots-content.example",
      hostname: "robots-content.example",
      requestedUrl: "https://robots-content.example/robots.txt",
      finalUrl: "https://robots-content.example/robots.txt",
      statusCode: 200,
      contentType: "text/plain",
      result: "fetched" as const,
      userAgent: claim.crawl.config.userAgent,
      contentSha256: sha256(content),
      content,
      crawlDelayMs: null,
      sitemapUrls: [],
      fetchedAt: new Date(),
    };
    const createdObservation = await context.crawl.persistRobotsObservation(execution, input);
    const replay = await context.crawl.persistRobotsObservation(execution, input);

    expect(createdObservation).toMatchObject({ created: true, result: "fetched" });
    expect(replay).toMatchObject({
      id: createdObservation.id,
      created: false,
      result: "fetched",
    });
    await expect(
      context.crawl.persistRobotsObservation(execution, {
        ...input,
        content: `${content}Disallow: /private\n`,
        contentSha256: sha256(`${content}Disallow: /private\n`),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      context.crawl.persistRobotsObservation(execution, {
        ...input,
        origin: "https://invalid-content.example",
        hostname: "invalid-content.example",
        requestedUrl: "https://invalid-content.example/robots.txt",
        finalUrl: "https://invalid-content.example/robots.txt",
        result: "unavailable",
      }),
    ).rejects.toThrow("Only fetched robots observations may persist bounded content");
  }, 30_000);

  it("rejects mismatched same-crawl origins and defensively downgrades bypassed rows", async () => {
    const context = await createContext();
    const setup = await onboard(context, "origin-bound.example");
    const created = await context.crawl.createCrawl(setup.scope, setup.projectId, {
      idempotencyKey: crypto.randomUUID(),
      traceId: crypto.randomUUID(),
    });
    const startedAt = new Date();
    const claim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      executionToken: crypto.randomUUID(),
      leaseMs: 120_000,
      now: startedAt,
    });
    if (claim.kind !== "claimed") throw new Error("Expected a claimed crawl execution.");
    const execution = { ...claim.crawl, executionToken: claim.executionToken };
    await context.crawl.transitionStage(execution, "discovering");
    await context.crawl.transitionStage(execution, "crawling");
    const primaryOrigin = "https://origin-bound.example";
    const foreignOrigin = "https://redirect-target.example";
    const robotsContent = "User-agent: SearviaBot\nAllow: /\n";
    const persistRobots = (origin: string) =>
      context.crawl.persistRobotsObservation(execution, {
        origin,
        hostname: new URL(origin).hostname,
        requestedUrl: `${origin}/robots.txt`,
        finalUrl: `${origin}/robots.txt`,
        statusCode: 200,
        contentType: "text/plain",
        result: "fetched",
        userAgent: claim.crawl.config.userAgent,
        contentSha256: sha256(robotsContent),
        content: robotsContent,
        crawlDelayMs: null,
        sitemapUrls: [],
        fetchedAt: new Date(),
      });
    const [primaryRobots, foreignRobots] = await Promise.all([
      persistRobots(primaryOrigin),
      persistRobots(foreignOrigin),
    ]);
    const pageUrl = `${primaryOrigin}/`;
    const frontier = await context.crawl.persistDiscoveredUrl(execution, {
      requestedUrl: pageUrl,
      discoveredUrl: pageUrl,
      normalizedUrl: pageUrl,
      urlHash: sha256(pageUrl),
      origin: primaryOrigin,
      hostname: "origin-bound.example",
      depth: 0,
      discoverySource: "seed",
      discoveredFromFrontierId: null,
    });
    const pageInput = {
      frontierId: frontier.id,
      requestedUrl: pageUrl,
      normalizedUrl: pageUrl,
      finalUrl: pageUrl,
      urlHash: sha256(pageUrl),
      statusCode: 200,
      contentType: "text/html; charset=utf-8",
      responseHeaders: { "content-type": ["text/html; charset=utf-8"] },
      contentLength: 128,
      responseBytes: 128,
      transferSize: 128,
      compression: null,
      cacheHeaders: {},
      securityHeaders: {},
      depth: 0,
      redirectChain: [],
      robotsDecision: "allowed" as const,
      timing: null,
      errorType: null,
      errorMessage: null,
      discoverySource: "seed" as const,
      outcome: "succeeded" as const,
    };
    await expect(
      context.crawl.persistPageObservation(execution, {
        ...pageInput,
        robotsObservationId: foreignRobots.id,
      }),
    ).rejects.toThrow("origin does not match");
    const page = await context.crawl.persistPageObservation(execution, {
      ...pageInput,
      robotsObservationId: primaryRobots.id,
    });

    const sitemapUrl = `${primaryOrigin}/sitemap.xml`;
    const sitemapInput = {
      parentSitemapId: null,
      requestedUrl: sitemapUrl,
      normalizedUrl: sitemapUrl,
      finalUrl: sitemapUrl,
      urlHash: sha256(sitemapUrl),
      source: "submitted" as const,
      status: "parsed" as const,
      robotsDecision: "allowed" as const,
      format: "urlset" as const,
      compression: "identity" as const,
      statusCode: 200,
      contentType: "application/xml",
      contentLength: 32,
      transferSize: 32,
      contentDigest: sha256("<urlset></urlset>"),
      depth: 0,
      redirectChain: [],
      parseIssues: [],
      errorType: null,
      errorMessage: null,
      fetchedAt: new Date(),
      parsedAt: new Date(),
      entries: [],
    };
    await expect(
      context.crawl.persistSitemapObservation(execution, {
        ...sitemapInput,
        robotsObservationId: foreignRobots.id,
      }),
    ).rejects.toThrow("origin does not match");
    const sitemap = await context.crawl.persistSitemapObservation(execution, {
      ...sitemapInput,
      robotsObservationId: primaryRobots.id,
    });

    const visibleText = "A stable origin-bound page for robots provenance validation.";
    const extractionInput = {
      pageId: page.pageId,
      source: "raw" as const,
      status: "succeeded" as const,
      title: "Origin-bound robots policy",
      metaDescription: null,
      metaRobots: ["index"],
      xRobotsTag: [],
      directiveScopePreserved: true,
      linksComplete: true,
      canonicalUrl: pageUrl,
      canonicalTagCount: 1,
      canonicalNormalizationFailure: null,
      visibleText,
      wordCount: visibleText.split(/\s+/u).length,
      htmlLanguage: "en",
      characterEncoding: "utf-8",
      openGraph: {},
      socialCards: {},
      contentHash: sha256(visibleText),
      domHash: sha256(`<main>${visibleText}</main>`),
      similarityFingerprint: "00112233445566778899aabbccddeeff",
      meaningfulContent: true,
      clientRendered: false,
      renderingErrorType: null,
      renderingErrorMessage: null,
      headings: [],
      links: [],
      images: [],
      structuredData: [],
      extractedAt: new Date(),
    };
    const resourceUrl = `${primaryOrigin}/assets/app.js`;
    const resource = (robotsObservationId: string) => ({
      resourceType: "script" as const,
      sourceUrl: resourceUrl,
      normalizedUrl: resourceUrl,
      urlHash: sha256(resourceUrl),
      scope: "internal" as const,
      robotsDecision: "allowed" as const,
      robotsObservationId,
      attributes: {},
      ordinal: 0,
    });
    await expect(
      context.crawl.persistPageExtraction(execution, {
        ...extractionInput,
        resources: [resource(foreignRobots.id)],
      }),
    ).rejects.toThrow("origin does not match");
    await context.crawl.persistPageExtraction(execution, {
      ...extractionInput,
      resources: [resource(primaryRobots.id)],
    });

    // Simulate a privileged database bypass. The audit adapter must still fail
    // closed rather than exposing another origin's conclusive policy receipt.
    await context.database
      .update(crawlPages)
      .set({ robotsObservationId: foreignRobots.id })
      .where(eq(crawlPages.id, page.pageId));
    await context.database
      .update(crawlPageResources)
      .set({ robotsObservationId: foreignRobots.id })
      .where(eq(crawlPageResources.pageId, page.pageId));
    await context.database
      .update(crawlSitemaps)
      .set({ robotsObservationId: foreignRobots.id })
      .where(eq(crawlSitemaps.id, sitemap.sitemapId));
    await context.crawl.completeExecution(execution, {
      status: "completed",
      completionReason: "frontier_exhausted",
      now: new Date(startedAt.getTime() + 10_000),
    });
    const snapshot = await context.crawl.loadAuditCrawlSnapshot({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
    });

    expect(snapshot.pages[0]).toMatchObject({
      robotsDecision: "not-checked",
      robotsObservationId: null,
      robotsResult: null,
    });
    expect(snapshot.pages[0]?.resources[0]).toMatchObject({
      robotsDecision: "not-checked",
      robotsObservationId: null,
      robotsResult: null,
    });
    expect(snapshot.sitemaps[0]).toMatchObject({
      robotsDecision: "not-checked",
      robotsObservationId: null,
      robotsResult: null,
    });
  }, 30_000);

  it("keeps explicit Disallow conclusive without inventing homepage transport failures", async () => {
    const snapshot = await completedRobotsSnapshot(
      await createContext(),
      "explicit-disallow.example",
      "explicit-disallow",
    );
    const report = createM4AAuditEngine().evaluate(snapshot);

    expect(snapshot.pages[0]).toMatchObject({
      robotsDecision: "disallowed",
      robotsObservationId: expect.any(String),
      robotsResult: "fetched",
      errorType: "robots_disallowed",
    });
    expect(report.results.find((result) => result.ruleId === "CRW-010")).toMatchObject({
      ruleVersion: 4,
      status: "failed",
    });
    for (const ruleId of ["CRW-002", "CRW-003"] as const) {
      expect(report.results.find((result) => result.ruleId === ruleId)).toMatchObject({
        ruleVersion: 4,
        status: "not-checked",
      });
    }
  }, 30_000);

  it("keeps unavailable fail-closed robots outcomes not checked", async () => {
    const snapshot = await completedRobotsSnapshot(
      await createContext(),
      "unavailable-robots.example",
      "unavailable",
    );
    const report = createM4AAuditEngine().evaluate(snapshot);

    expect(snapshot.robots[0]).toMatchObject({ result: "unavailable", content: null });
    expect(snapshot.pages[0]).toMatchObject({
      robotsDecision: "not-checked",
      robotsObservationId: expect.any(String),
      robotsResult: "unavailable",
      errorType: "robots_unreachable",
    });
    for (const ruleId of ["CRW-002", "CRW-003", "CRW-010"] as const) {
      expect(report.results.find((result) => result.ruleId === ruleId)).toMatchObject({
        ruleVersion: 4,
        status: "not-checked",
      });
    }
  }, 30_000);

  it("reports malformed persisted robots syntax through RSM-003", async () => {
    const snapshot = await completedRobotsSnapshot(
      await createContext(),
      "malformed-robots.example",
      "malformed",
    );
    expect(
      createM4AAuditEngine()
        .evaluate(snapshot)
        .results.find((result) => result.ruleId === "RSM-003"),
    ).toMatchObject({ status: "failed", eligibility: { state: "eligible" } });
  }, 30_000);

  it("reports an explicit whole-site Disallow through RSM-004", async () => {
    const snapshot = await completedRobotsSnapshot(
      await createContext(),
      "whole-site-disallow.example",
      "whole-site-disallow",
    );
    expect(
      createM4AAuditEngine()
        .evaluate(snapshot)
        .results.find((result) => result.ruleId === "RSM-004"),
    ).toMatchObject({ ruleVersion: 3, status: "failed", eligibility: { state: "eligible" } });
  }, 30_000);
});
