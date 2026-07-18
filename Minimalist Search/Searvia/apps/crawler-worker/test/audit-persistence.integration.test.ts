import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { hashNormalizedUrl, normalizeCrawlUrl } from "@searvia/crawler-core";
import {
  auditEvaluationRuns,
  auditFindingOccurrences,
  auditRules,
  auditRuleVersions,
  crawlPageExtractions,
  crawlPageLinks,
  crawlPages,
  crawlSitemapEntries,
  createSearviaAuditRepository,
  createSearviaCrawlRepository,
  createSearviaRepository,
  searviaSchema,
  sessions,
  users,
  type SearviaDatabase,
} from "@searvia/database";
import { normalizeProjectOrigin, type AuditEvaluateJob } from "@searvia/shared-types";
import { createM4AAuditEngine } from "@searvia/audit-engine";
import { and, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createActiveRuleRegistrations,
  createAuditJobProcessor,
  createM4ARuleRegistrations,
  type AuditEvaluationPersistencePort,
} from "../src/audit-processor.js";

const migrationsRoot = new URL("../../../packages/database/migrations/", import.meta.url);
const migrationsFolder = fileURLToPath(migrationsRoot);
const clients: PGlite[] = [];

function collectErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current = error;

  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    messages.push(current.message);
    current = current.cause;
  }

  return messages;
}

interface TestContext {
  readonly database: PgliteDatabase<typeof searviaSchema>;
  readonly tenant: ReturnType<typeof createSearviaRepository>;
  readonly crawl: ReturnType<typeof createSearviaCrawlRepository>;
  readonly audit: ReturnType<typeof createSearviaAuditRepository>;
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
    audit: createSearviaAuditRepository(typed),
  };
}

async function applyMigrationScript(client: PGlite, filename: string): Promise<void> {
  const source = await readFile(new URL(filename, migrationsRoot), "utf8");
  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim() !== "") await client.exec(statement);
  }
}

async function createUpgradedLegacyCatalogContext(): Promise<TestContext> {
  const client = new PGlite();
  clients.push(client);
  const migrationFiles = (await readdir(migrationsFolder))
    .filter((filename) => /^\d{4}_.+\.sql$/u.test(filename))
    .sort();
  const legacyCatalogMigration = "0007_dashing_madripoor.sql";
  const legacyIndex = migrationFiles.indexOf(legacyCatalogMigration);
  if (legacyIndex < 0) throw new Error("Expected the M4A legacy catalog migration.");

  for (const filename of migrationFiles.slice(0, legacyIndex + 1)) {
    await applyMigrationScript(client, filename);
  }
  const legacyDefinitionHash = "c".repeat(64);
  await client.query(`insert into audit_rules (id) values ('CRW-001')`);
  await client.query(
    `insert into audit_rule_versions (rule_id, version, title, category, default_severity, scope, deterministic, eligibility_description, required_data, explanation, recommended_fix, verification_method, impact_areas, responsible_owner, definition_hash) values ('CRW-001', 1, 'Legacy crawl reachability', 'crawlability', 'high', 'site', true, 'A completed crawl is available.', array['transport'], 'Legacy explanation.', 'Legacy fix.', 'Legacy verification.', array['crawlability'], 'engineering', $1)`,
    [legacyDefinitionHash],
  );
  for (const filename of migrationFiles.slice(legacyIndex + 1)) {
    await applyMigrationScript(client, filename);
  }

  const database = drizzle(client, { schema: searviaSchema });
  const typed = database as unknown as SearviaDatabase;
  return {
    database,
    tenant: createSearviaRepository(typed),
    crawl: createSearviaCrawlRepository(typed),
    audit: createSearviaAuditRepository(typed),
  };
}

async function onboard(
  context: TestContext,
  hostname: string,
  queryPolicy: "keep" | "ignore_tracking" | "ignore_all" = "ignore_tracking",
) {
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
      maxDepth: 3,
      includeSubdomains: false,
      queryPolicy,
    },
    traceId: crypto.randomUUID(),
  });
  const scope = await context.tenant.loadActiveOrganizationScope(userId, sessionId);
  if (scope === null) throw new Error("Expected an active organization scope.");
  return { ...setup, scope };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("completed crawl audit persistence integration", () => {
  it("builds the active 130-rule registration manifest without duplicate versions", () => {
    const registrations = createActiveRuleRegistrations();

    expect(registrations).toHaveLength(130);
    expect(new Set(registrations.map((rule) => `${rule.id}@${String(rule.version)}`)).size).toBe(
      130,
    );
    expect(
      registrations.filter((definition) => definition.firstSupportedVersion === "M5"),
    ).toHaveLength(65);
    expect(registrations.filter((definition) => definition.version === 1)).toHaveLength(36);
    expect(registrations.filter((definition) => definition.version === 2)).toHaveLength(41);
    expect(registrations.filter((definition) => definition.version === 3)).toHaveLength(35);
    expect(registrations.filter((definition) => definition.version === 4)).toHaveLength(13);
    expect(registrations.filter((definition) => definition.version === 5)).toHaveLength(5);
  });

  it("registers the historical M4A subset after upgrading an immutable populated version-1 catalog", async () => {
    const context = await createUpgradedLegacyCatalogContext();
    const registrations = createM4ARuleRegistrations();

    expect(registrations).toHaveLength(65);
    expect(registrations.filter((definition) => definition.version === 2)).toHaveLength(20);
    expect(registrations.filter((definition) => definition.version === 3)).toHaveLength(27);
    expect(registrations.filter((definition) => definition.version === 4)).toHaveLength(13);
    expect(registrations.filter((definition) => definition.version === 5)).toHaveLength(5);
    expect(registrations.find((definition) => definition.id === "URL-003")).toMatchObject({
      version: 3,
    });
    const firstManifest = await context.audit.registerRuleVersions(registrations);
    const retryManifest = await context.audit.registerRuleVersions(registrations);
    expect(retryManifest).toEqual(firstManifest);

    const stored = await context.database.select().from(auditRuleVersions);
    expect(stored).toHaveLength(66);
    expect(stored.filter((definition) => definition.version === 2)).toHaveLength(20);
    expect(stored.filter((definition) => definition.version === 3)).toHaveLength(27);
    expect(stored.filter((definition) => definition.version === 4)).toHaveLength(13);
    expect(stored.filter((definition) => definition.version === 5)).toHaveLength(5);
    expect(
      stored.find((definition) => definition.ruleId === "URL-003" && definition.version === 3),
    ).toBeDefined();
    expect(
      stored.find((definition) => definition.ruleId === "CRW-001" && definition.version === 1),
    ).toMatchObject({
      title: "Legacy crawl reachability",
      description: "Legacy explanation.",
      definitionHash: "c".repeat(64),
    });
  }, 30_000);

  it("keeps historical M5 definitions immutable beside their active revisions", async () => {
    const context = await createContext();
    const activeExpansion = createActiveRuleRegistrations().filter(
      (definition) => definition.firstSupportedVersion === "M5",
    );
    const historicalVersionOne = activeExpansion.map((definition) =>
      definition.version === 1
        ? definition
        : {
            ...definition,
            version: 1,
            description: `Historical version-1 test fixture for ${definition.id}. ${definition.description}`,
          },
    );

    await context.audit.registerRuleVersions(historicalVersionOne);
    const historicalVersionTwo = activeExpansion
      .filter((definition) => definition.version === 3)
      .map((definition) => ({
        ...definition,
        version: 2,
        description: `Historical version-2 test fixture for ${definition.id}. ${definition.description}`,
      }));
    await context.audit.registerRuleVersions(historicalVersionTwo);
    const beforeUpgrade = await context.database.select().from(auditRuleVersions);
    const historicalHashes = new Map(
      beforeUpgrade.map((definition) => [
        `${definition.ruleId}@${definition.version}`,
        definition.definitionHash,
      ]),
    );

    await context.audit.registerRuleVersions(activeExpansion);
    const stored = await context.database.select().from(auditRuleVersions);
    const storedExpansion = stored.filter(
      (definition) =>
        definition.ruleId.startsWith("ONS-") ||
        definition.ruleId.startsWith("CNT-") ||
        definition.ruleId.startsWith("LNK-"),
    );

    expect(storedExpansion).toHaveLength(102);
    expect(storedExpansion.filter((definition) => definition.version === 1)).toHaveLength(65);
    expect(storedExpansion.filter((definition) => definition.version === 2)).toHaveLength(29);
    expect(storedExpansion.filter((definition) => definition.version === 3)).toHaveLength(8);
    expect(
      storedExpansion.every(
        (definition) =>
          definition.version !== 1 ||
          historicalHashes.get(`${definition.ruleId}@${definition.version}`) ===
            definition.definitionHash,
      ),
    ).toBe(true);
    for (const active of activeExpansion.filter((definition) => definition.version > 1)) {
      const previousVersion = active.version - 1;
      const historical = storedExpansion.find(
        (definition) => definition.ruleId === active.id && definition.version === previousVersion,
      );
      const current = storedExpansion.find(
        (definition) => definition.ruleId === active.id && definition.version === active.version,
      );
      expect(historical?.definitionHash).not.toBe(current?.definitionHash);
    }
  }, 30_000);

  it("keeps link and sitemap target identity aligned with ignore-tracking and keep crawls", async () => {
    const context = await createContext();
    const cases = [
      { label: "ignore", queryPolicy: "ignore_tracking" as const },
      { label: "keep", queryPolicy: "keep" as const },
    ];

    for (const testCase of cases) {
      const hostname = `query-identity-${testCase.label}.example`;
      const setup = await onboard(context, hostname, testCase.queryPolicy);
      const created = await context.crawl.createCrawl(setup.scope, setup.projectId, {
        idempotencyKey: crypto.randomUUID(),
        traceId: crypto.randomUUID(),
      });
      const claimStartedAt = new Date();
      const claim = await context.crawl.claimExecution({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: created.crawl.id,
        executionToken: crypto.randomUUID(),
        leaseMs: 120_000,
        now: claimStartedAt,
      });
      if (claim.kind !== "claimed") throw new Error("Expected a claimed crawl execution.");
      const execution = { ...claim.crawl, executionToken: claim.executionToken };
      await context.crawl.transitionStage(execution, "discovering");
      await context.crawl.transitionStage(execution, "crawling");

      const origin = `https://${hostname}`;
      const robotsContent = "User-agent: *\nAllow: /";
      const robotsObservation = await context.crawl.persistRobotsObservation(execution, {
        origin,
        hostname,
        requestedUrl: `${origin}/robots.txt`,
        finalUrl: `${origin}/robots.txt`,
        statusCode: 200,
        contentType: "text/plain",
        result: "fetched",
        userAgent: claim.crawl.config.userAgent,
        contentSha256: createHash("sha256").update(robotsContent).digest("hex"),
        content: robotsContent,
        crawlDelayMs: null,
        sitemapUrls: [],
        fetchedAt: new Date(),
      });
      const homepageUrl = `${origin}/`;
      const rawTargets = {
        missing: `${origin}/missing?utm_source=mail&item=4`,
        server: `${origin}/server?utm_medium=email&item=5`,
        redirected: `${origin}/redirected?utm_campaign=launch&item=12`,
      } as const;
      const targetIdentity = (rawUrl: string) => {
        const normalizedUrl = normalizeCrawlUrl(rawUrl, {
          queryPolicy: testCase.queryPolicy,
        });
        return Object.freeze({
          rawUrl,
          normalizedUrl,
          urlHash: hashNormalizedUrl(normalizedUrl),
        });
      };
      const targets = {
        missing: targetIdentity(rawTargets.missing),
        server: targetIdentity(rawTargets.server),
        redirected: targetIdentity(rawTargets.redirected),
      } as const;

      const homepageHash = hashNormalizedUrl(homepageUrl);
      const homepageFrontier = await context.crawl.persistDiscoveredUrl(execution, {
        requestedUrl: homepageUrl,
        discoveredUrl: homepageUrl,
        normalizedUrl: homepageUrl,
        urlHash: homepageHash,
        origin,
        hostname,
        depth: 0,
        discoverySource: "seed",
        discoveredFromFrontierId: null,
      });
      const homepage = await context.crawl.persistPageObservation(execution, {
        frontierId: homepageFrontier.id,
        requestedUrl: homepageUrl,
        normalizedUrl: homepageUrl,
        finalUrl: homepageUrl,
        urlHash: homepageHash,
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
      const homepageText = "Query identity integration source page with deterministic links.";
      await context.crawl.persistPageExtraction(execution, {
        pageId: homepage.pageId,
        source: "raw",
        status: "succeeded",
        title: "Query identity source",
        metaDescription: null,
        metaRobots: ["index", "follow"],
        xRobotsTag: [],
        directiveScopePreserved: false,
        linksComplete: false,
        canonicalUrl: homepageUrl,
        canonicalTagCount: 1,
        canonicalNormalizationFailure: null,
        visibleText: homepageText,
        wordCount: homepageText.split(/\s+/u).length,
        htmlLanguage: "en",
        characterEncoding: "utf-8",
        openGraph: {},
        socialCards: {},
        contentHash: createHash("sha256").update(homepageText).digest("hex"),
        domHash: createHash("sha256").update(`<main>${homepageText}</main>`).digest("hex"),
        similarityFingerprint: "00112233445566778899aabbccddeeff",
        meaningfulContent: true,
        clientRendered: false,
        renderingErrorType: null,
        renderingErrorMessage: null,
        headings: [{ level: 1, ordinal: 0, text: "Query identity source" }],
        links: Object.values(targets).map((target, ordinal) => ({
          targetFrontierId: null,
          targetPageId: null,
          targetUrl: target.rawUrl,
          normalizedTargetUrl: target.normalizedUrl,
          targetUrlHash: target.urlHash,
          scope: "internal" as const,
          anchorText: `Target ${ordinal + 1}`,
          relValues: [],
          linkType: "anchor" as const,
          hreflang: null,
          discovered: false,
          crawlDepth: 1,
          discoverySource: "link" as const,
          ordinal,
        })),
        images: [],
        resources: [],
        structuredData: [],
        extractedAt: new Date(),
      });

      const sitemapUrl = `${origin}/sitemap.xml`;
      const sitemap = await context.crawl.persistSitemapObservation(execution, {
        parentSitemapId: null,
        requestedUrl: sitemapUrl,
        normalizedUrl: sitemapUrl,
        finalUrl: sitemapUrl,
        urlHash: hashNormalizedUrl(sitemapUrl),
        source: "submitted",
        status: "parsed",
        format: "urlset",
        compression: "identity",
        statusCode: 200,
        contentType: "application/xml",
        contentLength: 256,
        transferSize: 192,
        contentDigest: createHash("sha256").update("<urlset />").digest("hex"),
        depth: 0,
        redirectChain: [],
        parseIssues: [],
        errorType: null,
        errorMessage: null,
        fetchedAt: new Date(),
        parsedAt: new Date(),
        entries: [
          {
            entryType: "url",
            loc: targets.missing.rawUrl,
            normalizedLoc: targets.missing.normalizedUrl,
            urlHash: targets.missing.urlHash,
            lastmodRaw: null,
            lastmodAt: null,
            targetFrontierId: null,
            targetPageId: null,
            targetSitemapId: null,
            ordinal: 0,
          },
          {
            entryType: "url",
            loc: homepageUrl,
            normalizedLoc: homepageUrl,
            urlHash: homepageHash,
            lastmodRaw: null,
            lastmodAt: null,
            targetFrontierId: homepageFrontier.id,
            targetPageId: homepage.pageId,
            targetSitemapId: null,
            ordinal: 1,
          },
        ],
      });

      const persistTargetPage = async (
        target: (typeof targets)[keyof typeof targets],
        input: Readonly<{
          statusCode: number;
          outcome: "succeeded" | "failed";
          finalUrl?: string;
          redirectChain?: readonly Readonly<{
            sequence: number;
            requestedUrl: string;
            statusCode: number;
            location: string;
            resolvedUrl: string;
          }>[];
        }>,
      ) => {
        const frontier = await context.crawl.persistDiscoveredUrl(execution, {
          requestedUrl: target.normalizedUrl,
          discoveredUrl: target.normalizedUrl,
          normalizedUrl: target.normalizedUrl,
          urlHash: target.urlHash,
          origin,
          hostname,
          depth: 1,
          discoverySource: "link",
          discoveredFromFrontierId: homepageFrontier.id,
        });
        const page = await context.crawl.persistPageObservation(execution, {
          frontierId: frontier.id,
          requestedUrl: target.normalizedUrl,
          normalizedUrl: target.normalizedUrl,
          finalUrl: input.finalUrl ?? target.normalizedUrl,
          urlHash: target.urlHash,
          statusCode: input.statusCode,
          contentType: "text/html; charset=utf-8",
          responseHeaders: { "content-type": ["text/html; charset=utf-8"] },
          contentLength: 128,
          responseBytes: 128,
          transferSize: 96,
          compression: "gzip",
          cacheHeaders: {},
          securityHeaders: {},
          depth: 1,
          redirectChain: input.redirectChain ?? [],
          robotsDecision: "allowed",
          robotsObservationId: robotsObservation.id,
          timing: null,
          errorType: null,
          errorMessage: null,
          discoverySource: "link",
          outcome: input.outcome,
        });
        return { ...target, frontierId: frontier.id, pageId: page.pageId };
      };

      const missing = await persistTargetPage(targets.missing, {
        statusCode: 404,
        outcome: "failed",
      });
      const server = await persistTargetPage(targets.server, {
        statusCode: 503,
        outcome: "failed",
      });
      const redirectedFinalUrl = `${origin}/redirected-final`;
      const redirected = await persistTargetPage(targets.redirected, {
        statusCode: 200,
        outcome: "succeeded",
        finalUrl: redirectedFinalUrl,
        redirectChain: [
          {
            sequence: 0,
            requestedUrl: targets.redirected.normalizedUrl,
            statusCode: 301,
            location: "/redirected-final",
            resolvedUrl: redirectedFinalUrl,
          },
        ],
      });
      const redirectedText = "Indexable internally linked query identity target page.";
      await context.crawl.persistPageExtraction(execution, {
        pageId: redirected.pageId,
        source: "raw",
        status: "succeeded",
        title: "Redirected target",
        metaDescription: null,
        metaRobots: ["index", "follow"],
        xRobotsTag: [],
        directiveScopePreserved: true,
        linksComplete: true,
        canonicalUrl: redirected.normalizedUrl,
        canonicalTagCount: 1,
        canonicalNormalizationFailure: null,
        visibleText: redirectedText,
        wordCount: redirectedText.split(/\s+/u).length,
        htmlLanguage: "en",
        characterEncoding: "utf-8",
        openGraph: {},
        socialCards: {},
        contentHash: createHash("sha256").update(redirectedText).digest("hex"),
        domHash: createHash("sha256").update(`<main>${redirectedText}</main>`).digest("hex"),
        similarityFingerprint: "ffeeddccbbaa99887766554433221100",
        meaningfulContent: true,
        clientRendered: false,
        renderingErrorType: null,
        renderingErrorMessage: null,
        headings: [{ level: 1, ordinal: 0, text: "Redirected target" }],
        links: [],
        images: [],
        resources: [],
        structuredData: [],
        extractedAt: new Date(),
      });

      const incompleteSourceIdentity = targetIdentity(`${origin}/incomplete-link-source`);
      const incompleteSource = await persistTargetPage(incompleteSourceIdentity, {
        statusCode: 200,
        outcome: "succeeded",
      });
      const incompleteSourceText = "Indexable page with a bounded and incomplete link inventory.";
      await context.crawl.persistPageExtraction(execution, {
        pageId: incompleteSource.pageId,
        source: "raw",
        status: "succeeded",
        title: "Incomplete link source",
        metaDescription: null,
        metaRobots: ["index", "follow"],
        xRobotsTag: [],
        directiveScopePreserved: true,
        linksComplete: false,
        canonicalUrl: incompleteSource.normalizedUrl,
        canonicalTagCount: 1,
        canonicalNormalizationFailure: null,
        visibleText: incompleteSourceText,
        wordCount: incompleteSourceText.split(/\s+/u).length,
        htmlLanguage: "en",
        characterEncoding: "utf-8",
        openGraph: {},
        socialCards: {},
        contentHash: createHash("sha256").update(incompleteSourceText).digest("hex"),
        domHash: createHash("sha256").update(`<main>${incompleteSourceText}</main>`).digest("hex"),
        similarityFingerprint: "0123456789abcdeffedcba9876543210",
        meaningfulContent: true,
        clientRendered: false,
        renderingErrorType: null,
        renderingErrorMessage: null,
        headings: [{ level: 1, ordinal: 0, text: "Incomplete link source" }],
        links: [],
        images: [],
        resources: [],
        structuredData: [],
        extractedAt: new Date(),
      });

      const completed = await context.crawl.completeExecution(execution, {
        status: "completed",
        completionReason: "frontier_exhausted",
        now: new Date(claimStartedAt.getTime() + 10_000),
      });
      expect(completed.status).toBe("completed");

      const storedLinks = await context.database
        .select({
          targetUrl: crawlPageLinks.targetUrl,
          normalizedTargetUrl: crawlPageLinks.normalizedTargetUrl,
          targetUrlHash: crawlPageLinks.targetUrlHash,
          targetPageId: crawlPageLinks.targetPageId,
        })
        .from(crawlPageLinks)
        .where(eq(crawlPageLinks.crawlId, created.crawl.id));
      expect(storedLinks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetUrl: missing.rawUrl,
            normalizedTargetUrl: missing.normalizedUrl,
            targetUrlHash: missing.urlHash,
            targetPageId: missing.pageId,
          }),
          expect.objectContaining({ targetUrlHash: server.urlHash, targetPageId: server.pageId }),
          expect.objectContaining({
            targetUrlHash: redirected.urlHash,
            targetPageId: redirected.pageId,
          }),
        ]),
      );
      const storedSitemapEntries = await context.database
        .select({
          loc: crawlSitemapEntries.loc,
          normalizedLoc: crawlSitemapEntries.normalizedLoc,
          urlHash: crawlSitemapEntries.urlHash,
          targetPageId: crawlSitemapEntries.targetPageId,
        })
        .from(crawlSitemapEntries)
        .where(eq(crawlSitemapEntries.sitemapId, sitemap.sitemapId));
      const storedSitemapEntry = storedSitemapEntries.find((entry) => entry.loc === missing.rawUrl);
      expect(storedSitemapEntry).toEqual({
        loc: missing.rawUrl,
        normalizedLoc: missing.normalizedUrl,
        urlHash: missing.urlHash,
        targetPageId: missing.pageId,
      });

      const snapshot = await context.crawl.loadAuditCrawlSnapshot({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: created.crawl.id,
      });
      const source = snapshot.pages.find((page) => page.id === homepage.pageId);
      const incompleteSnapshotSource = snapshot.pages.find(
        (page) => page.id === incompleteSource.pageId,
      );
      expect(source?.extraction).toMatchObject({
        directiveScopePreserved: false,
        linksComplete: false,
      });
      expect(incompleteSnapshotSource?.extraction).toMatchObject({
        directiveScopePreserved: true,
        linksComplete: false,
      });
      expect(source?.links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetUrl: missing.rawUrl,
            normalizedTargetUrl: missing.normalizedUrl,
            targetPageId: missing.pageId,
          }),
        ]),
      );
      expect(snapshot.sitemaps[0]?.entries[0]).toMatchObject({
        loc: missing.rawUrl,
        normalizedLoc: missing.normalizedUrl,
        targetPageId: missing.pageId,
      });

      const report = createM4AAuditEngine().evaluate(snapshot);
      expect(report.failures).toEqual([]);
      expect(report.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: "CRW-004",
            status: "failed",
            target: expect.objectContaining({ pageId: missing.pageId }),
          }),
          expect.objectContaining({
            ruleId: "CRW-005",
            status: "failed",
            target: expect.objectContaining({ pageId: server.pageId }),
          }),
          expect.objectContaining({
            ruleId: "CRW-012",
            status: "passed",
            target: expect.objectContaining({ pageId: redirected.pageId }),
          }),
          expect.objectContaining({
            ruleId: "HTTP-005",
            status: "failed",
            target: expect.objectContaining({ pageId: homepage.pageId }),
          }),
          expect.objectContaining({
            ruleId: "CRW-012",
            status: "not-checked",
            target: expect.objectContaining({ pageId: incompleteSource.pageId }),
          }),
          expect.objectContaining({
            ruleId: "HTTP-005",
            status: "not-checked",
            target: expect.objectContaining({ pageId: incompleteSource.pageId }),
          }),
          ...["CRW-007", "CRW-008", "CRW-009", "URL-001", "URL-007"].map((ruleId) =>
            expect.objectContaining({
              ruleId,
              status: "not-checked",
              target: expect.objectContaining({ pageId: homepage.pageId }),
            }),
          ),
          expect.objectContaining({ ruleId: "RSM-014", status: "not-checked" }),
          expect.objectContaining({ ruleId: "RSM-015", status: "not-checked" }),
          expect.objectContaining({ ruleId: "RSM-013", status: "failed" }),
        ]),
      );
    }
  }, 60_000);

  it("migrates an empty database and persists one tenant-scoped 130-rule evaluation", async () => {
    const context = await createContext();
    const setup = await onboard(context, "audit-integration.example");
    const otherTenant = await onboard(context, "other-audit-tenant.example");
    const created = await context.crawl.createCrawl(setup.scope, setup.projectId, {
      idempotencyKey: crypto.randomUUID(),
      traceId: crypto.randomUUID(),
    });
    const claimStartedAt = new Date();
    const claim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      executionToken: crypto.randomUUID(),
      leaseMs: 120_000,
      now: claimStartedAt,
    });
    if (claim.kind !== "claimed") throw new Error("Expected a claimed crawl execution.");
    const execution = { ...claim.crawl, executionToken: claim.executionToken };
    await context.crawl.transitionStage(execution, "discovering");
    await context.crawl.transitionStage(execution, "crawling");

    const origin = "https://audit-integration.example";
    const url = `${origin}/`;
    const urlHash = createHash("sha256").update(url).digest("hex");
    const frontier = await context.crawl.persistDiscoveredUrl(execution, {
      requestedUrl: url,
      discoveredUrl: url,
      normalizedUrl: url,
      urlHash,
      origin,
      hostname: "audit-integration.example",
      depth: 0,
      discoverySource: "seed",
      discoveredFromFrontierId: null,
    });
    const page = await context.crawl.persistPageObservation(execution, {
      frontierId: frontier.id,
      requestedUrl: url,
      normalizedUrl: url,
      finalUrl: url,
      urlHash,
      statusCode: 200,
      contentType: "text/html; charset=utf-8",
      htmlDetected: true,
      htmlDetectionSource: "bounded_response_prefix",
      htmlDetectionBytes: 256,
      responseHeaders: { "content-type": ["text/html; charset=utf-8"] },
      contentLength: 256,
      responseBytes: 256,
      transferSize: 192,
      compression: "gzip",
      cacheHeaders: { "cache-control": ["max-age=60"] },
      securityHeaders: { "strict-transport-security": ["max-age=31536000"] },
      depth: 0,
      redirectChain: [],
      robotsDecision: "not_checked",
      timing: null,
      errorType: null,
      errorMessage: null,
      discoverySource: "seed",
      outcome: "succeeded",
    });
    const visibleText =
      "A complete public homepage with stable technical evidence for the audit integration test.";
    await context.crawl.persistPageExtraction(execution, {
      pageId: page.pageId,
      source: "raw",
      status: "succeeded",
      title: "Audit integration homepage",
      documentMetadataComplete: true,
      titleTagCount: 1,
      metaDescription: "A deterministic completed-crawl integration fixture.",
      metaDescriptionTagCount: 1,
      metaRobots: ["index", "follow"],
      xRobotsTag: [],
      directiveScopePreserved: true,
      linksComplete: true,
      canonicalUrl: null,
      canonicalTagCount: 1,
      canonicalNormalizationFailure: { code: "userinfo_not_allowed" },
      metaRefreshUrl: `${origin}/meta-destination`,
      javascriptRedirectUrl: `${origin}/script-destination`,
      visibleText,
      visibleTextComplete: true,
      wordCount: visibleText.split(/\s+/u).length,
      headingsComplete: true,
      htmlLanguage: "en",
      characterEncoding: "utf-8",
      characterEncodingDeclared: "utf-8",
      characterEncodingSource: "http_header",
      characterEncodingDeclarationOffset: null,
      viewportDeclarations: ["width=device-width, initial-scale=1"],
      htmlDoctypePresent: true,
      iconDeclarationCount: 1,
      openGraph: {
        "og:title": ["Audit integration homepage"],
        "og:type": ["website"],
        "og:url": [url],
        "og:image": [`${origin}/share.png`],
      },
      socialCards: {},
      contentHash: createHash("sha256").update(visibleText).digest("hex"),
      domHash: createHash("sha256").update(`<main>${visibleText}</main>`).digest("hex"),
      similarityFingerprint: "00112233445566778899aabbccddeeff",
      meaningfulContent: true,
      clientRendered: false,
      renderingErrorType: null,
      renderingErrorMessage: null,
      headings: [{ level: 1, ordinal: 0, text: "Audit integration homepage" }],
      links: [],
      images: [],
      resources: [],
      structuredData: [],
      extractedAt: new Date(),
    });

    const completed = await context.crawl.completeExecution(execution, {
      status: "completed",
      completionReason: "frontier_exhausted",
      now: new Date(claimStartedAt.getTime() + 10_000),
    });
    expect(completed).toMatchObject({
      status: "completed",
      processedCount: 1,
      succeededCount: 1,
      extractedPageCount: 1,
    });
    if (completed.finishedAt === null) throw new Error("Expected a completed crawl timestamp.");

    const persistence: AuditEvaluationPersistencePort = {
      loadAuditSnapshot: (scope) => context.crawl.loadAuditCrawlSnapshot(scope),
      hasTerminalEvaluationRun: (scope) => context.audit.hasTerminalEvaluationRun(scope),
      persistEvaluationReport: (input) => context.audit.persistEvaluationReport(input),
    };
    const processor = createAuditJobProcessor({ persistence });
    const contract: AuditEvaluateJob = {
      contractVersion: 1,
      jobType: "audit.evaluate",
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      traceId: completed.traceId,
      idempotencyKey: `audit-${created.crawl.id}`,
      crawlStatus: "completed",
      crawlFinishedAt: completed.finishedAt.toISOString(),
    };
    const delivery = {
      queueJobId: contract.idempotencyKey,
      attemptsMade: 0,
      attemptsStarted: 1,
      maxAttempts: 4,
      signal: undefined,
      defer: async (): Promise<never> => {
        throw new Error("The integration audit should not defer.");
      },
    };

    await processor(contract, delivery);

    expect(
      await context.audit.hasTerminalEvaluationRun({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: created.crawl.id,
      }),
    ).toBe(true);
    expect(
      await context.audit.hasTerminalEvaluationRun({
        organizationId: otherTenant.organizationId,
        projectId: setup.projectId,
        crawlId: created.crawl.id,
      }),
    ).toBe(false);
    expect(
      await context.audit.hasTerminalEvaluationRun({
        organizationId: setup.organizationId,
        projectId: otherTenant.projectId,
        crawlId: created.crawl.id,
      }),
    ).toBe(false);

    const replayLoadSnapshot = vi.fn((scope) => context.crawl.loadAuditCrawlSnapshot(scope));
    const replayEvaluate = vi.fn(() => {
      throw new Error("A catalog-deployment retry must not evaluate the active catalog.");
    });
    const replayPersist = vi.fn((input) => context.audit.persistEvaluationReport(input));
    const replayProcessor = createAuditJobProcessor({
      persistence: {
        loadAuditSnapshot: replayLoadSnapshot,
        hasTerminalEvaluationRun: (scope) => context.audit.hasTerminalEvaluationRun(scope),
        persistEvaluationReport: replayPersist,
      },
      evaluate: replayEvaluate,
    });

    await expect(
      replayProcessor(contract, { ...delivery, attemptsMade: 1, attemptsStarted: 2 }),
    ).resolves.toBeUndefined();
    expect(replayLoadSnapshot).toHaveBeenCalledOnce();
    expect(replayEvaluate).not.toHaveBeenCalled();
    expect(replayPersist).not.toHaveBeenCalled();

    const storedPages = await context.database.select().from(crawlPages);
    const storedExtractions = await context.database.select().from(crawlPageExtractions);
    const runs = await context.database.select().from(auditEvaluationRuns);
    const rules = await context.database.select().from(auditRules);
    const ruleVersions = await context.database.select().from(auditRuleVersions);
    const occurrences = await context.database.select().from(auditFindingOccurrences);

    expect(storedPages).toHaveLength(1);
    expect(storedPages[0]).toMatchObject({
      htmlDetected: true,
      htmlDetectionSource: "bounded_response_prefix",
      htmlDetectionBytes: 256,
    });
    expect(storedExtractions).toHaveLength(1);
    expect(storedExtractions[0]?.directiveScopePreserved).toBe(true);
    expect(storedExtractions[0]).toMatchObject({
      canonicalUrl: null,
      canonicalTagCount: 1,
      canonicalNormalizationFailureCode: "userinfo_not_allowed",
      metaRefreshUrl: `${origin}/meta-destination`,
      javascriptRedirectUrl: `${origin}/script-destination`,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      engineVersion: 1,
      status: "completed",
      resultCount: 130,
    });
    expect(runs[0]?.ruleManifest).toHaveLength(130);
    expect(rules).toHaveLength(130);
    expect(ruleVersions).toHaveLength(130);
    expect(new Set(ruleVersions.map((rule) => `${rule.ruleId}@${rule.version}`)).size).toBe(130);
    expect(ruleVersions.filter((rule) => rule.version === 1)).toHaveLength(36);
    expect(ruleVersions.filter((rule) => rule.version === 2)).toHaveLength(41);
    expect(ruleVersions.filter((rule) => rule.version === 3)).toHaveLength(35);
    expect(ruleVersions.filter((rule) => rule.version === 4)).toHaveLength(13);
    expect(ruleVersions.filter((rule) => rule.version === 5)).toHaveLength(5);
    expect(ruleVersions.find((rule) => rule.ruleId === "URL-003")).toMatchObject({ version: 3 });
    expect(occurrences).toHaveLength(130);
    expect(
      occurrences.every(
        (occurrence) =>
          occurrence.organizationId === setup.organizationId &&
          occurrence.projectId === setup.projectId &&
          occurrence.crawlId === created.crawl.id,
      ),
    ).toBe(true);
    expect(occurrences.find((occurrence) => occurrence.ruleId === "ONS-001")).toMatchObject({
      pageId: page.pageId,
      resultStatus: "passed",
    });
    const thinContent = occurrences.find((occurrence) => occurrence.ruleId === "CNT-001");
    expect(thinContent).toMatchObject({
      pageId: page.pageId,
      resultStatus: "failed",
      normalizedUrl: url,
    });
    expect(thinContent?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          observationId: expect.any(String),
          url,
        }),
      ]),
    );
    expect(occurrences.find((occurrence) => occurrence.ruleId === "CNT-007")).toMatchObject({
      pageId: page.pageId,
      resultStatus: "manual_review",
    });
    expect(occurrences.find((occurrence) => occurrence.ruleId === "LNK-014")).toMatchObject({
      pageId: page.pageId,
      resultStatus: "passed",
    });
    expect(occurrences.find((occurrence) => occurrence.ruleId === "ONS-023")).toMatchObject({
      pageId: page.pageId,
      resultStatus: "not_checked",
    });
    const malformedCanonical = occurrences.find((occurrence) => occurrence.ruleId === "URL-003");
    expect(malformedCanonical).toMatchObject({
      ruleVersion: 3,
      eligibility: "eligible",
      resultStatus: "failed",
    });
    expect(malformedCanonical?.evidence).toEqual([
      expect.objectContaining({ field: "canonical_tag_count", value: 1, source: "raw" }),
      expect.objectContaining({
        field: "canonical_normalization_failure_code",
        value: "userinfo_not_allowed",
        source: "raw",
      }),
    ]);
    expect(occurrences.find((occurrence) => occurrence.ruleId === "HTTP-009")).toMatchObject({
      ruleVersion: 3,
      eligibility: "eligible",
      resultStatus: "failed",
    });
    expect(occurrences.find((occurrence) => occurrence.ruleId === "HTTP-010")).toMatchObject({
      ruleVersion: 3,
      eligibility: "eligible",
      resultStatus: "failed",
    });
    expect(occurrences.find((occurrence) => occurrence.ruleId === "HTTP-012")).toMatchObject({
      ruleVersion: 3,
      eligibility: "eligible",
      resultStatus: "passed",
    });

    const firstVersion = ruleVersions[0];
    if (firstVersion === undefined) throw new Error("Expected a registered rule version.");
    let immutableVersionError: unknown;
    try {
      await context.database
        .update(auditRuleVersions)
        .set({ title: "Mutated historical rule" })
        .where(eq(auditRuleVersions.ruleId, firstVersion.ruleId));
    } catch (error) {
      immutableVersionError = error;
    }
    expect(collectErrorMessages(immutableVersionError).join("\n")).toMatch(/immutable/iu);
    expect(
      await context.database
        .select({ title: auditRuleVersions.title })
        .from(auditRuleVersions)
        .where(
          and(
            eq(auditRuleVersions.ruleId, firstVersion.ruleId),
            eq(auditRuleVersions.version, firstVersion.version),
          ),
        ),
    ).toEqual([{ title: firstVersion.title }]);

    await expect(
      processor({ ...contract, organizationId: otherTenant.organizationId }, delivery),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      context.crawl.loadAuditCrawlSnapshot({
        organizationId: setup.organizationId,
        projectId: otherTenant.projectId,
        crawlId: created.crawl.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await context.database
        .select()
        .from(auditEvaluationRuns)
        .where(eq(auditEvaluationRuns.organizationId, otherTenant.organizationId)),
    ).toEqual([]);
    expect(await context.database.select().from(auditEvaluationRuns)).toHaveLength(1);
  }, 30_000);

  it("keeps every raw-extraction-dependent rule not-checked after a failed extraction", async () => {
    const context = await createContext();
    const setup = await onboard(context, "failed-extraction-audit.example");
    const created = await context.crawl.createCrawl(setup.scope, setup.projectId, {
      idempotencyKey: crypto.randomUUID(),
      traceId: crypto.randomUUID(),
    });
    const claimStartedAt = new Date();
    const claim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      executionToken: crypto.randomUUID(),
      leaseMs: 120_000,
      now: claimStartedAt,
    });
    if (claim.kind !== "claimed") throw new Error("Expected a claimed crawl execution.");
    const execution = { ...claim.crawl, executionToken: claim.executionToken };
    await context.crawl.transitionStage(execution, "discovering");
    await context.crawl.transitionStage(execution, "crawling");

    const origin = "https://failed-extraction-audit.example";
    const url = `${origin}/`;
    const urlHash = createHash("sha256").update(url).digest("hex");
    const frontier = await context.crawl.persistDiscoveredUrl(execution, {
      requestedUrl: url,
      discoveredUrl: url,
      normalizedUrl: url,
      urlHash,
      origin,
      hostname: "failed-extraction-audit.example",
      depth: 0,
      discoverySource: "seed",
      discoveredFromFrontierId: null,
    });
    const page = await context.crawl.persistPageObservation(execution, {
      frontierId: frontier.id,
      requestedUrl: url,
      normalizedUrl: url,
      finalUrl: url,
      urlHash,
      statusCode: 200,
      contentType: "text/html; charset=utf-8",
      responseHeaders: { "content-type": ["text/html; charset=utf-8"] },
      contentLength: 128,
      responseBytes: 128,
      transferSize: 96,
      compression: "gzip",
      cacheHeaders: {},
      securityHeaders: {},
      depth: 0,
      redirectChain: [],
      robotsDecision: "not_checked",
      timing: null,
      errorType: null,
      errorMessage: null,
      discoverySource: "seed",
      outcome: "succeeded",
    });
    await context.crawl.persistPageExtraction(execution, {
      pageId: page.pageId,
      source: "raw",
      status: "failed",
      title: null,
      metaDescription: null,
      metaRobots: [],
      xRobotsTag: [],
      directiveScopePreserved: false,
      canonicalUrl: null,
      canonicalTagCount: 0,
      canonicalNormalizationFailure: null,
      visibleText: null,
      wordCount: 0,
      htmlLanguage: null,
      characterEncoding: null,
      openGraph: {},
      socialCards: {},
      contentHash: null,
      domHash: null,
      similarityFingerprint: null,
      meaningfulContent: false,
      clientRendered: false,
      renderingErrorType: "extraction_error",
      renderingErrorMessage: "The deterministic parser rejected the hostile document.",
      headings: [],
      links: [],
      images: [],
      resources: [],
      structuredData: [],
      extractedAt: new Date(),
    });
    const completed = await context.crawl.completeExecution(execution, {
      status: "completed",
      completionReason: "frontier_exhausted_with_failures",
      now: new Date(claimStartedAt.getTime() + 10_000),
    });
    if (completed.finishedAt === null) throw new Error("Expected a completed crawl timestamp.");
    expect(completed).toMatchObject({
      extractedPageCount: 0,
      extractionFailedCount: 1,
    });

    const snapshot = await context.crawl.loadAuditCrawlSnapshot({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
    });
    expect(snapshot.pages).toHaveLength(1);
    expect(snapshot.pages[0]).toMatchObject({
      id: page.pageId,
      extraction: null,
      links: [],
      resources: [],
    });

    const report = createM4AAuditEngine().evaluate(snapshot);
    const extractionDependent = report.results.filter((result) =>
      result.requiredData.includes("raw-extraction"),
    );
    expect(extractionDependent.length).toBeGreaterThan(0);
    expect(new Set(extractionDependent.map((result) => result.status))).toEqual(
      new Set(["not-checked"]),
    );
    const regressionRuleIds = ["CRW-006", "HTTP-012", "RSM-005", "RSM-011", "URL-002"];
    for (const ruleId of regressionRuleIds) {
      const results = report.results.filter((result) => result.ruleId === ruleId);
      expect(results.length, `${ruleId} must retain a coverage result`).toBeGreaterThan(0);
      expect(
        results.every((result) => result.status === "not-checked"),
        ruleId,
      ).toBe(true);
    }

    const persistence: AuditEvaluationPersistencePort = {
      loadAuditSnapshot: (scope) => context.crawl.loadAuditCrawlSnapshot(scope),
      hasTerminalEvaluationRun: (scope) => context.audit.hasTerminalEvaluationRun(scope),
      persistEvaluationReport: (input) => context.audit.persistEvaluationReport(input),
    };
    const processor = createAuditJobProcessor({ persistence });
    const contract: AuditEvaluateJob = {
      contractVersion: 1,
      jobType: "audit.evaluate",
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      traceId: completed.traceId,
      idempotencyKey: `audit-${created.crawl.id}`,
      crawlStatus: "completed",
      crawlFinishedAt: completed.finishedAt.toISOString(),
    };
    await processor(contract, {
      queueJobId: contract.idempotencyKey,
      attemptsMade: 0,
      attemptsStarted: 1,
      maxAttempts: 4,
      signal: undefined,
      defer: async (): Promise<never> => {
        throw new Error("The failed-extraction audit should not defer.");
      },
    });
    const persistedRegressions = await context.database
      .select({
        ruleId: auditFindingOccurrences.ruleId,
        resultStatus: auditFindingOccurrences.resultStatus,
        eligibility: auditFindingOccurrences.eligibility,
        missingData: auditFindingOccurrences.missingData,
      })
      .from(auditFindingOccurrences)
      .where(eq(auditFindingOccurrences.crawlId, created.crawl.id));
    for (const ruleId of regressionRuleIds) {
      const occurrences = persistedRegressions.filter((row) => row.ruleId === ruleId);
      expect(occurrences.length, `${ruleId} occurrence must persist`).toBeGreaterThan(0);
      expect(
        occurrences.every(
          (row) =>
            row.resultStatus === "not_checked" &&
            row.eligibility === "unavailable" &&
            row.missingData.length > 0,
        ),
        ruleId,
      ).toBe(true);
    }
  }, 30_000);
});
