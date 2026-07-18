import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { normalizeProjectOrigin, privacySafeAuditPageUrl } from "@searvia/shared-types";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSearviaAuditRepository,
  type AuditEvaluationResultInput,
  type AuditRuleVersionRegistration,
} from "./audit-repository.js";
import type { SearviaDatabase } from "./client.js";
import {
  createSearviaCrawlRepository,
  type CrawlExecutionContext,
  type PageObservationInput,
} from "./crawl-repository.js";
import { createSearviaRepository } from "./repository.js";
import {
  auditEvaluationRuns,
  auditFindingOccurrences,
  auditFindings,
  auditLogs,
  auditRuleVersions,
  memberships,
  searviaSchema,
  sessions,
  users,
} from "./schema.js";

const migrationsFolder = fileURLToPath(new URL("../migrations/", import.meta.url));
const clients: PGlite[] = [];

interface TestContext {
  readonly database: PgliteDatabase<typeof searviaSchema>;
  readonly audit: ReturnType<typeof createSearviaAuditRepository>;
  readonly crawl: ReturnType<typeof createSearviaCrawlRepository>;
  readonly tenant: ReturnType<typeof createSearviaRepository>;
}

async function createContext(): Promise<TestContext> {
  const client = new PGlite();
  clients.push(client);
  const database = drizzle(client, { schema: searviaSchema });
  await migrate(database, { migrationsFolder });
  const typed = database as unknown as SearviaDatabase;
  return {
    database,
    audit: createSearviaAuditRepository(typed),
    crawl: createSearviaCrawlRepository(typed),
    tenant: createSearviaRepository(typed),
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
      maxDepth: 3,
      includeSubdomains: false,
      queryPolicy: "ignore_tracking",
    },
    traceId: crypto.randomUUID(),
  });
  const scope = await context.tenant.loadActiveOrganizationScope(userId, sessionId);
  if (scope === null) throw new Error("Expected an active organization scope.");
  return { ...setup, scope };
}

async function addMemberScope(
  context: TestContext,
  setup: Awaited<ReturnType<typeof onboard>>,
  role: "admin" | "analyst" | "viewer" | "client",
) {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const [membership] = await context.database
    .insert(users)
    .values({ id: userId, name: `${role} member`, email: `${role}-${userId}@example.com` })
    .returning({ id: users.id });
  if (membership === undefined) throw new Error("Expected a member user.");
  await context.database.insert(sessions).values({
    id: sessionId,
    token: crypto.randomUUID(),
    userId,
    activeOrganizationId: setup.organizationId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const [organizationMembership] = await context.database
    .insert(memberships)
    .values({ organizationId: setup.organizationId, userId, role, status: "active" })
    .returning({ id: memberships.id });
  if (organizationMembership === undefined) throw new Error("Expected an organization member.");
  const scope = await context.tenant.loadActiveOrganizationScope(userId, sessionId);
  if (scope === null) throw new Error("Expected an active member scope.");
  return Object.freeze({ membershipId: organizationMembership.id, scope });
}

async function createCompletedCrawl(
  context: TestContext,
  setup: Awaited<ReturnType<typeof onboard>>,
  finishedAt: Date,
) {
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
    now: new Date(finishedAt.getTime() - 1_000),
  });
  if (claim.kind !== "claimed") throw new Error("Expected a claimed crawl.");
  const execution: CrawlExecutionContext = {
    organizationId: setup.organizationId,
    projectId: setup.projectId,
    crawlId: created.crawl.id,
    executionToken: claim.executionToken,
  };
  await context.crawl.completeExecution(execution, {
    status: "completed",
    completionReason: "frontier_exhausted",
    now: finishedAt,
  });
  return created.crawl.id;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createCompletedCrawlWithPages(
  context: TestContext,
  setup: Awaited<ReturnType<typeof onboard>>,
  finishedAt: Date,
  urls: readonly string[],
) {
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
    now: new Date(finishedAt.getTime() - 2_000),
  });
  if (claim.kind !== "claimed") throw new Error("Expected a claimed crawl.");
  const execution: CrawlExecutionContext = {
    organizationId: setup.organizationId,
    projectId: setup.projectId,
    crawlId: created.crawl.id,
    executionToken: claim.executionToken,
  };
  const pages: Array<Readonly<{ pageId: string; normalizedUrl: string; urlHash: string }>> = [];
  for (const [index, normalizedUrl] of urls.entries()) {
    const parsed = new URL(normalizedUrl);
    const urlHash = sha256(normalizedUrl);
    const frontier = await context.crawl.persistDiscoveredUrl(execution, {
      requestedUrl: normalizedUrl,
      discoveredUrl: normalizedUrl,
      normalizedUrl,
      urlHash,
      origin: parsed.origin,
      hostname: parsed.hostname,
      depth: index === 0 ? 0 : 1,
      discoverySource: index === 0 ? "seed" : "link",
      discoveredFromFrontierId: null,
    });
    await context.crawl.markFrontierFetching(execution, frontier.id);
    const observedAt = new Date(finishedAt.getTime() - 1_000 + index).toISOString();
    const observation: PageObservationInput = {
      frontierId: frontier.id,
      requestedUrl: normalizedUrl,
      normalizedUrl,
      finalUrl: normalizedUrl,
      urlHash,
      statusCode: 200,
      contentType: "text/html; charset=utf-8",
      responseHeaders: { "content-type": ["text/html; charset=utf-8"] },
      omittedResponseHeaders: ["set-cookie"],
      contentLength: 256,
      responseBytes: 256,
      transferSize: 128,
      compression: "gzip",
      cacheHeaders: {},
      securityHeaders: {},
      depth: index === 0 ? 0 : 1,
      redirectChain: [],
      // This helper exercises finding identity, not robots evaluation. Keep the
      // unrelated decision explicitly unavailable instead of fabricating a receipt.
      robotsDecision: "not_checked",
      timing: {
        startedAt: observedAt,
        dnsMs: 1,
        ttfbMs: 2,
        downloadMs: 3,
        totalMs: 6,
      },
      errorType: null,
      errorMessage: null,
      discoverySource: index === 0 ? "seed" : "link",
      outcome: "succeeded",
    };
    const persisted = await context.crawl.persistPageObservation(execution, observation);
    pages.push(Object.freeze({ pageId: persisted.pageId, normalizedUrl, urlHash }));
  }
  await context.crawl.completeExecution(execution, {
    status: "completed",
    completionReason: "frontier_exhausted",
    now: finishedAt,
  });
  return Object.freeze({ crawlId: created.crawl.id, pages: Object.freeze(pages) });
}

const definition: AuditRuleVersionRegistration = Object.freeze({
  id: "CRW-001",
  version: 1,
  title: "Domain DNS resolution failed",
  description: "Checks whether the configured public hostname resolved during the crawl.",
  category: "crawlability",
  defaultSeverity: "critical",
  defaultConfidence: "high",
  scope: "site",
  deterministic: true,
  eligibilityDescription: "The crawl attempted to resolve the configured public site hostname.",
  requiredData: ["crawl.status", "crawl.pages", "crawl.dns_resolution"],
  explanation: "The configured hostname could not be resolved to a public address.",
  expectedValue: "The configured hostname resolves to at least one allowed public address.",
  recommendedFix: "Correct the authoritative DNS records and verify public resolution.",
  verificationMethod: "Resolve the hostname again from a public recursive resolver.",
  impactAreas: ["seo", "ai-search"],
  responsibleOwner: "infrastructure",
  firstSupportedVersion: "M4A",
});

const pageDefinition: AuditRuleVersionRegistration = Object.freeze({
  ...definition,
  id: "HTTP-001",
  title: "Homepage HTTP status",
  scope: "page",
  defaultSeverity: "high",
});

function unavailablePageCoverage(origin: string): AuditEvaluationResultInput {
  return Object.freeze({
    ruleId: pageDefinition.id,
    ruleVersion: pageDefinition.version,
    scope: "page",
    scopeKey: `${origin}#homepage-unavailable`,
    pageId: null,
    normalizedUrl: null,
    eligibility: "unavailable",
    status: "not-checked",
    severity: "high",
    confidence: null,
    missingData: ["crawl.pages"],
    notEvaluatedReasonCode: "no_page_coverage",
    notEvaluatedReason: "No persisted page can provide homepage status evidence.",
    evidence: [
      {
        kind: "crawl",
        source: "crawl",
        observationId: "page-coverage-fixture",
        observedAt: "2026-07-16T12:00:00.000Z",
        field: "page_coverage",
        value: "unavailable",
      },
    ],
    detectedValue: null,
    expectedValue: "A persisted homepage response.",
    explanation: pageDefinition.explanation,
    recommendedFix: pageDefinition.recommendedFix,
  });
}

function failedPageResult(
  page: Readonly<{ pageId: string; normalizedUrl: string; urlHash: string }>,
): AuditEvaluationResultInput {
  const auditUrl = privacySafeAuditPageUrl(page.normalizedUrl, page.urlHash);
  return Object.freeze({
    ruleId: pageDefinition.id,
    ruleVersion: pageDefinition.version,
    scope: "page",
    scopeKey: auditUrl,
    pageId: page.pageId,
    normalizedUrl: auditUrl,
    eligibility: "eligible",
    status: "failed",
    severity: "high",
    confidence: "high",
    missingData: [],
    evidence: [
      {
        kind: "page",
        source: "transport",
        observationId: page.pageId,
        observedAt: "2026-07-16T12:00:00.000Z",
        field: "status_code",
        value: 200,
      },
    ],
    detectedValue: "The deterministic page fixture failed.",
    expectedValue: "The deterministic page fixture passes.",
    explanation: pageDefinition.explanation,
    recommendedFix: pageDefinition.recommendedFix,
  });
}

function result(status: AuditEvaluationResultInput["status"]): AuditEvaluationResultInput {
  if (status === "not-checked") {
    return Object.freeze({
      ruleId: definition.id,
      ruleVersion: definition.version,
      scope: "site",
      scopeKey: "site",
      eligibility: "unavailable",
      status,
      severity: "critical",
      confidence: null,
      missingData: ["crawl.dns_resolution"],
      notEvaluatedReasonCode: "dns_observation_unavailable",
      notEvaluatedReason: "The crawl snapshot contains no DNS resolution observation.",
      evidence: [
        {
          kind: "crawl",
          source: "crawl",
          observationId: "dns-coverage-fixture",
          observedAt: "2026-07-16T12:00:00.000Z",
          field: "dns_resolution",
          value: "unavailable",
        },
      ],
      detectedValue: null,
      expectedValue: "A recorded public DNS result.",
      explanation: definition.explanation,
      recommendedFix: definition.recommendedFix,
    });
  }
  const passed = status === "passed";
  return Object.freeze({
    ruleId: definition.id,
    ruleVersion: definition.version,
    scope: "site",
    scopeKey: "site",
    eligibility: "eligible",
    status,
    severity: "critical",
    confidence: "high",
    missingData: [],
    evidence: [
      {
        kind: "crawl",
        source: "crawl",
        observationId: "dns-result-fixture",
        observedAt: "2026-07-16T12:00:00.000Z",
        field: "dns_resolution",
        value: passed ? "public-address" : "resolution-failed",
      },
    ],
    detectedValue: passed ? "public-address" : "resolution-failed",
    expectedValue: "public-address",
    explanation: definition.explanation,
    recommendedFix: definition.recommendedFix,
  });
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("M4A audit persistence", () => {
  it("registers immutable rule versions idempotently and rejects metadata drift", async () => {
    const context = await createContext();

    const first = await context.audit.registerRuleVersions([definition]);
    const second = await context.audit.registerRuleVersions([definition]);
    expect(second).toEqual(first);
    expect(await context.database.select().from(auditRuleVersions)).toHaveLength(1);

    await expect(
      context.audit.registerRuleVersions([{ ...definition, title: "Silently changed title" }]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      context.database
        .update(auditRuleVersions)
        .set({ title: "Direct mutation" })
        .where(
          and(
            eq(auditRuleVersions.ruleId, definition.id),
            eq(auditRuleVersions.version, definition.version),
          ),
        ),
    ).rejects.toThrow();
    await expect(context.database.select().from(auditRuleVersions)).resolves.toMatchObject([
      { title: definition.title },
    ]);

    await expect(
      context.audit.registerRuleVersions([{ ...definition, version: 2, title: "Version two" }]),
    ).resolves.toEqual([expect.objectContaining({ ruleId: definition.id, ruleVersion: 2 })]);
  });

  it("rejects partial reports and result metadata outside the immutable catalog contract", async () => {
    const context = await createContext();
    const secondDefinition: AuditRuleVersionRegistration = Object.freeze({
      ...definition,
      id: "CRW-002",
      title: "Second completeness fixture",
    });
    const base = {
      organizationId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      crawlId: crypto.randomUUID(),
      engineVersion: 1,
      definitions: [definition],
      results: [result("failed")],
    } as const;

    await expect(
      context.audit.persistEvaluationReport({
        ...base,
        definitions: [definition, secondDefinition],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    for (const invalidResult of [
      { ...result("failed"), severity: "low" as const },
      { ...result("failed"), explanation: "A different explanation." },
      { ...result("failed"), recommendedFix: "A different recommended fix." },
      {
        ...result("not-checked"),
        missingData: ["crawl.dns_resolution", "undeclared.observation"],
      },
    ]) {
      await expect(
        context.audit.persistEvaluationReport({ ...base, results: [invalidResult] }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }

    for (const invalidEvidence of [[], [null], [{ source: "crawl", field: "missing-shape" }]]) {
      await expect(
        context.audit.persistEvaluationReport({
          ...base,
          results: [{ ...result("failed"), evidence: invalidEvidence }],
        }),
      ).rejects.toThrow(/evidence/u);
    }

    await expect(
      context.audit.persistEvaluationReport({
        ...base,
        results: [
          {
            ...result("not-checked"),
            eligibility: "eligible",
            missingData: [],
          },
        ],
      }),
    ).rejects.toThrow(/not-checked results require ineligible or unavailable eligibility/iu);

    expect(await context.database.select().from(auditEvaluationRuns)).toEqual([]);
  });

  it("validates and masks evidence again at the immutable persistence boundary", async () => {
    const context = await createContext();
    const setup = await onboard(context, "evidence-mask.example.com");
    const finishedAt = new Date(Date.now() + 10_000);
    const crawlId = await createCompletedCrawl(context, setup, finishedAt);
    const credential = "persistence-user-secret:persistence-password-secret";
    const querySecret = "persistence-query-secret";
    const fragmentSecret = "persistence-fragment-secret";
    const sensitiveUrl = `https://${credential}@evidence-mask.example.com/path?token=${querySecret}#${fragmentSecret}`;
    const baseResult = result("failed");

    await context.audit.persistEvaluationReport({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId,
      engineVersion: 1,
      definitions: [definition],
      results: [
        {
          ...baseResult,
          evidence: [
            {
              kind: "crawl",
              source: "crawl",
              observationId: "persistence-redaction-fixture",
              observedAt: finishedAt.toISOString(),
              field: "sensitive_url",
              value: sensitiveUrl,
              url: sensitiveUrl,
              excerpt: `Observed ${sensitiveUrl}`,
            },
          ],
          detectedValue: { [sensitiveUrl]: sensitiveUrl },
          expectedValue: { expected: sensitiveUrl },
        },
      ],
      now: new Date(finishedAt.getTime() + 1_000),
    });

    const occurrences = await context.database.select().from(auditFindingOccurrences);
    const serialized = JSON.stringify(occurrences);
    expect(serialized).not.toContain("persistence-user-secret");
    expect(serialized).not.toContain("persistence-password-secret");
    expect(serialized).not.toContain(querySecret);
    expect(serialized).not.toContain(fragmentSecret);
    expect(serialized).toContain("[redacted]");
  });

  it("masks sensitive URL details in finding dispositions and their audit events", async () => {
    const context = await createContext();
    const setup = await onboard(context, "disposition-mask.example.com");
    const finishedAt = new Date(Date.now() + 10_000);
    const crawlId = await createCompletedCrawl(context, setup, finishedAt);
    await context.audit.persistEvaluationReport({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId,
      engineVersion: 1,
      definitions: [definition],
      results: [result("failed")],
      now: new Date(finishedAt.getTime() + 1_000),
    });
    const [finding] = await context.database.select().from(auditFindings);
    if (finding === undefined) throw new Error("Expected a finding.");

    const credential = "disposition-user-secret:disposition-password-secret";
    const querySecret = "disposition-query-secret";
    const fragmentSecret = "disposition-fragment-secret";
    const sensitiveUrl = `https://${credential}@disposition-mask.example.com/path?token=${querySecret}#${fragmentSecret}`;
    await expect(
      context.audit.setFindingDisposition(setup.scope, setup.projectId, finding.id, {
        disposition: "accepted-risk",
        reason: `Temporary exception documented at ${sensitiveUrl}`,
        traceId: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({
      disposition: "accepted-risk",
      dispositionReason: expect.stringContaining("[redacted]"),
    });

    // Defensively sanitize a value written before this boundary was hardened
    // when it is returned or copied into a later audit-log event.
    await context.database
      .update(auditFindings)
      .set({ dispositionReason: `Legacy exception documented at ${sensitiveUrl}` })
      .where(eq(auditFindings.id, finding.id));
    await expect(
      context.audit.setFindingDisposition(setup.scope, setup.projectId, finding.id, {
        disposition: "open",
        traceId: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ disposition: "open", dispositionReason: null });

    const persisted = JSON.stringify({
      findings: await context.database.select().from(auditFindings),
      logs: await context.database
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.targetId, finding.id)),
    });
    expect(persisted).not.toContain("disposition-user-secret");
    expect(persisted).not.toContain("disposition-password-secret");
    expect(persisted).not.toContain(querySecret);
    expect(persisted).not.toContain(fragmentSecret);
    expect(persisted).toContain("[redacted]");
  });

  it("revalidates disposition roles and active membership on the server", async () => {
    const context = await createContext();
    const setup = await onboard(context, "disposition-auth.example.com");
    const finishedAt = new Date(Date.now() + 10_000);
    const crawlId = await createCompletedCrawl(context, setup, finishedAt);
    await context.audit.persistEvaluationReport({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId,
      engineVersion: 1,
      definitions: [definition],
      results: [result("failed")],
    });
    const [finding] = await context.database.select().from(auditFindings);
    if (finding === undefined) throw new Error("Expected a finding.");

    const analyst = await addMemberScope(context, setup, "analyst");
    const viewer = await addMemberScope(context, setup, "viewer");
    const client = await addMemberScope(context, setup, "client");

    await expect(
      context.audit.setFindingDisposition(analyst.scope, setup.projectId, finding.id, {
        disposition: "ignored",
        reason: "Analyst-reviewed temporary issue.",
        traceId: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ disposition: "ignored" });
    for (const scope of [viewer.scope, client.scope]) {
      await expect(
        context.audit.setFindingDisposition(scope, setup.projectId, finding.id, {
          disposition: "open",
          traceId: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }

    await context.database
      .update(memberships)
      .set({ status: "suspended" })
      .where(eq(memberships.id, analyst.membershipId));
    await expect(
      context.audit.setFindingDisposition(analyst.scope, setup.projectId, finding.id, {
        disposition: "open",
        traceId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("persists one evidence-complete report per completed crawl and makes retries idempotent", async () => {
    const context = await createContext();
    const setup = await onboard(context, "report.example.com");
    const finishedAt = new Date(Date.now() + 10_000);
    const crawlId = await createCompletedCrawl(context, setup, finishedAt);
    const report = {
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId,
      engineVersion: 1,
      definitions: [definition],
      results: [result("failed")],
      now: new Date(finishedAt.getTime() + 1_000),
    } as const;

    await expect(
      context.audit.hasTerminalEvaluationRun({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId,
      }),
    ).resolves.toBe(false);

    const first = await context.audit.persistEvaluationReport(report);
    const [findingBeforeRetry] = await context.database.select().from(auditFindings);
    expect(findingBeforeRetry).toBeDefined();
    const retry = await context.audit.persistEvaluationReport({
      ...report,
      now: new Date(finishedAt.getTime() + 5_000),
    });
    const [findingAfterRetry] = await context.database.select().from(auditFindings);
    expect(retry).toEqual(first);
    expect(findingAfterRetry?.updatedAt).toEqual(findingBeforeRetry?.updatedAt);
    expect(first).toMatchObject({
      status: "completed",
      reportHashIntegrity: "verified",
      resultCount: 1,
      eligibleCount: 1,
      evaluatedCount: 1,
      failedCount: 1,
      notCheckedCount: 0,
    });
    expect(await context.database.select().from(auditEvaluationRuns)).toHaveLength(1);
    await expect(
      context.audit.hasTerminalEvaluationRun({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId,
      }),
    ).resolves.toBe(true);
    await expect(
      context.audit.hasTerminalEvaluationRun({
        organizationId: crypto.randomUUID(),
        projectId: setup.projectId,
        crawlId,
      }),
    ).resolves.toBe(false);
    await expect(
      context.audit.hasTerminalEvaluationRun({
        organizationId: setup.organizationId,
        projectId: crypto.randomUUID(),
        crawlId,
      }),
    ).resolves.toBe(false);
    await expect(
      context.audit.hasTerminalEvaluationRun({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: crypto.randomUUID(),
      }),
    ).resolves.toBe(false);
    const [occurrence] = await context.database.select().from(auditFindingOccurrences);
    expect(occurrence).toMatchObject({
      resultStatus: "failed",
      lifecycle: "new",
      confidence: "high",
      missingData: [],
      evidence: [expect.objectContaining({ value: "resolution-failed" })],
      detectedValue: "resolution-failed",
      expectedValue: "public-address",
      explanation: definition.explanation,
      recommendedFix: definition.recommendedFix,
      impactAreas: ["ai-search", "seo"],
      responsibleOwner: "infrastructure",
    });

    await expect(
      context.audit.persistEvaluationReport({
        ...report,
        results: [{ ...result("failed"), detectedValue: "different-result" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await context.database
      .update(auditEvaluationRuns)
      .set({ reportHashIntegrity: "legacy_unverifiable" })
      .where(eq(auditEvaluationRuns.id, first.id));
    await expect(context.audit.persistEvaluationReport(report)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("predates verifiable report-hash provenance"),
    });

    const active = await context.crawl.createCrawl(setup.scope, setup.projectId, {
      idempotencyKey: crypto.randomUUID(),
      traceId: crypto.randomUUID(),
    });
    await expect(
      context.audit.persistEvaluationReport({ ...report, crawlId: active.crawl.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("persists distinct privacy-safe query page identities across crawl history", async () => {
    const context = await createContext();
    const setup = await onboard(context, "query-identities.example.com");
    const firstSecret = "first-private-access-token";
    const secondSecret = "second-private-access-token";
    const urls = [
      `https://query-identities.example.com/items?access_token=${firstSecret}`,
      `https://query-identities.example.com/items?access_token=${secondSecret}`,
    ] as const;
    const base = Date.now() + 25_000;
    const first = await createCompletedCrawlWithPages(context, setup, new Date(base), urls);
    const firstResults = first.pages.map(failedPageResult);
    const mismatchedAuditUrl = privacySafeAuditPageUrl(
      first.pages[0]?.normalizedUrl ?? "",
      "c".repeat(64),
    );
    await expect(
      context.audit.persistEvaluationReport({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: first.crawlId,
        engineVersion: 1,
        definitions: [pageDefinition],
        results: [
          {
            ...firstResults[0]!,
            scopeKey: mismatchedAuditUrl,
            normalizedUrl: mismatchedAuditUrl,
          },
          firstResults[1]!,
        ],
        now: new Date(base + 1_000),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      context.audit.persistEvaluationReport({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: first.crawlId,
        engineVersion: 1,
        definitions: [pageDefinition],
        results: firstResults,
        now: new Date(base + 1_000),
      }),
    ).resolves.toMatchObject({ status: "completed", resultCount: 2, failedCount: 2 });

    const firstFindings = await context.database
      .select()
      .from(auditFindings)
      .orderBy(asc(auditFindings.scopeKey));
    expect(firstFindings).toHaveLength(2);
    expect(firstFindings.map((finding) => finding.currentLifecycle)).toEqual(["new", "new"]);
    expect(new Set(firstFindings.map((finding) => finding.scopeKey)).size).toBe(2);
    const firstFindingIds = new Map(
      firstFindings.map((finding) => [finding.scopeKey, finding.id] as const),
    );

    const second = await createCompletedCrawlWithPages(
      context,
      setup,
      new Date(base + 10_000),
      urls,
    );
    await expect(
      context.audit.persistEvaluationReport({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: second.crawlId,
        engineVersion: 1,
        definitions: [pageDefinition],
        results: second.pages.map(failedPageResult),
        now: new Date(base + 11_000),
      }),
    ).resolves.toMatchObject({ status: "completed", resultCount: 2, failedCount: 2 });

    const findings = await context.database
      .select()
      .from(auditFindings)
      .orderBy(asc(auditFindings.scopeKey));
    const occurrences = await context.database
      .select()
      .from(auditFindingOccurrences)
      .orderBy(asc(auditFindingOccurrences.evaluatedAt), asc(auditFindingOccurrences.scopeKey));
    expect(findings).toHaveLength(2);
    expect(occurrences).toHaveLength(4);
    expect(findings.map((finding) => finding.currentLifecycle)).toEqual(["existing", "existing"]);
    expect(findings.every((finding) => firstFindingIds.get(finding.scopeKey) === finding.id)).toBe(
      true,
    );
    expect(occurrences.map((occurrence) => occurrence.lifecycle)).toEqual([
      "new",
      "new",
      "existing",
      "existing",
    ]);
    expect(new Set(occurrences.map((occurrence) => occurrence.normalizedUrl)).size).toBe(2);
    expect(
      occurrences.every(
        (occurrence) =>
          occurrence.scopeKey === occurrence.normalizedUrl &&
          /^https:\/\/query-identities\.example\.com\/items\?__searvia_detail_sha256=[a-f0-9]{64}$/u.test(
            occurrence.normalizedUrl ?? "",
          ),
      ),
    ).toBe(true);
    const serializedAuditState = JSON.stringify({ findings, occurrences });
    expect(serializedAuditState).not.toContain(firstSecret);
    expect(serializedAuditState).not.toContain(secondSecret);
    expect(serializedAuditState).not.toContain("access_token");
  });

  it("reconciles new, existing, fixed, not-evaluated, and returned without false fixes", async () => {
    const context = await createContext();
    const setup = await onboard(context, "lifecycle.example.com");
    const base = Date.now() + 30_000;
    const statuses = ["failed", "failed", "passed", "not-checked", "failed"] as const;

    for (const [index, status] of statuses.entries()) {
      const finishedAt = new Date(base + index * 10_000);
      const crawlId = await createCompletedCrawl(context, setup, finishedAt);
      await context.audit.persistEvaluationReport({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId,
        engineVersion: 1,
        definitions: [definition],
        results: [result(status)],
        now: new Date(finishedAt.getTime() + 1_000),
      });
    }

    const occurrences = await context.database
      .select({
        lifecycle: auditFindingOccurrences.lifecycle,
        resultStatus: auditFindingOccurrences.resultStatus,
      })
      .from(auditFindingOccurrences)
      .innerJoin(
        auditEvaluationRuns,
        eq(auditEvaluationRuns.id, auditFindingOccurrences.evaluationRunId),
      )
      .orderBy(asc(auditEvaluationRuns.snapshotAt));
    expect(occurrences).toEqual([
      { lifecycle: "new", resultStatus: "failed" },
      { lifecycle: "existing", resultStatus: "failed" },
      { lifecycle: "fixed", resultStatus: "passed" },
      { lifecycle: "not_evaluated", resultStatus: "not_checked" },
      { lifecycle: "returned", resultStatus: "failed" },
    ]);

    const [finding] = await context.database.select().from(auditFindings);
    expect(finding).toMatchObject({
      currentLifecycle: "returned",
      lastEligibleResultStatus: "failed",
      firstSeenAt: new Date(base),
      lastSeenAt: new Date(base + 40_000),
      lastEvaluatedAt: new Date(base + 40_000),
      lastFixedAt: new Date(base + 20_000),
    });
    if (finding === undefined) throw new Error("Expected a finding.");

    await expect(
      context.audit.setFindingDisposition(setup.scope, setup.projectId, finding.id, {
        disposition: "ignored",
        reason: "Known temporary DNS migration.",
        traceId: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ disposition: "ignored", effectiveState: "ignored" });
    await expect(
      context.audit.setFindingDisposition(setup.scope, setup.projectId, finding.id, {
        disposition: "accepted-risk",
        reason: "The owner accepts the documented temporary impact.",
        traceId: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({
      disposition: "accepted-risk",
      effectiveState: "accepted-risk",
    });
    await expect(
      context.audit.setFindingDisposition(setup.scope, setup.projectId, finding.id, {
        disposition: "open",
        traceId: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ disposition: "open", effectiveState: "returned" });

    const dispositionLogs = await context.database
      .select({
        action: auditLogs.action,
        metadataVersion: auditLogs.metadataVersion,
        metadata: auditLogs.metadata,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, setup.organizationId),
          eq(auditLogs.targetId, finding.id),
          inArray(auditLogs.action, [
            "finding.ignored",
            "finding.accepted_risk",
            "finding.reopened",
          ]),
        ),
      )
      .orderBy(asc(auditLogs.createdAt));
    expect(dispositionLogs.map(({ action }) => action)).toEqual([
      "finding.ignored",
      "finding.accepted_risk",
      "finding.reopened",
    ]);
    expect(dispositionLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "finding.ignored",
          metadataVersion: 2,
          metadata: expect.objectContaining({
            previousDisposition: "open",
            previousDispositionReason: null,
            disposition: "ignored",
            dispositionReason: "Known temporary DNS migration.",
          }),
        }),
        expect.objectContaining({
          action: "finding.accepted_risk",
          metadataVersion: 2,
          metadata: expect.objectContaining({
            previousDisposition: "ignored",
            previousDispositionReason: "Known temporary DNS migration.",
            disposition: "accepted_risk",
            dispositionReason: "The owner accepts the documented temporary impact.",
          }),
        }),
        expect.objectContaining({
          action: "finding.reopened",
          metadataVersion: 2,
          metadata: expect.objectContaining({
            previousDisposition: "accepted_risk",
            previousDispositionReason: "The owner accepts the documented temporary impact.",
            disposition: "open",
            dispositionReason: null,
          }),
        }),
      ]),
    );
  });

  it("accepts delayed older reports without regressing the newest finding projection", async () => {
    const context = await createContext();
    const setup = await onboard(context, "out-of-order.example.com");
    const olderFinishedAt = new Date(Date.now() + 30_000);
    const newerFinishedAt = new Date(olderFinishedAt.getTime() + 10_000);
    const olderCrawlId = await createCompletedCrawl(context, setup, olderFinishedAt);
    const newerCrawlId = await createCompletedCrawl(context, setup, newerFinishedAt);

    const newerRun = await context.audit.persistEvaluationReport({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: newerCrawlId,
      engineVersion: 1,
      definitions: [definition],
      results: [result("passed")],
      now: new Date(newerFinishedAt.getTime() + 1_000),
    });
    await expect(
      context.audit.persistEvaluationReport({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: olderCrawlId,
        engineVersion: 1,
        definitions: [definition],
        results: [result("failed")],
        now: new Date(newerFinishedAt.getTime() + 2_000),
      }),
    ).resolves.toMatchObject({ crawlId: olderCrawlId, status: "completed" });

    const runs = await context.database
      .select({ crawlId: auditEvaluationRuns.crawlId, reportHash: auditEvaluationRuns.reportHash })
      .from(auditEvaluationRuns);
    expect(runs).toHaveLength(2);
    expect(runs.find((run) => run.crawlId === newerCrawlId)?.reportHash).toBe(newerRun.reportHash);
    const occurrences = await context.database
      .select({
        lifecycle: auditFindingOccurrences.lifecycle,
        resultStatus: auditFindingOccurrences.resultStatus,
        snapshotAt: auditEvaluationRuns.snapshotAt,
      })
      .from(auditFindingOccurrences)
      .innerJoin(
        auditEvaluationRuns,
        eq(auditEvaluationRuns.id, auditFindingOccurrences.evaluationRunId),
      )
      .orderBy(asc(auditEvaluationRuns.snapshotAt));
    expect(occurrences).toEqual([
      { lifecycle: "new", resultStatus: "failed", snapshotAt: olderFinishedAt },
      { lifecycle: "fixed", resultStatus: "passed", snapshotAt: newerFinishedAt },
    ]);
    expect(await context.database.select().from(auditFindings)).toMatchObject([
      {
        currentLifecycle: "fixed",
        lastEligibleResultStatus: "passed",
        firstSeenAt: olderFinishedAt,
        lastSeenAt: olderFinishedAt,
        lastEvaluatedAt: newerFinishedAt,
        lastFixedAt: newerFinishedAt,
      },
    ]);
  });

  it("marks an active finding not-evaluated when a newer report omits its target", async () => {
    const context = await createContext();
    const setup = await onboard(context, "missing-target.example.com");
    const firstFinishedAt = new Date(Date.now() + 30_000);
    const secondFinishedAt = new Date(firstFinishedAt.getTime() + 10_000);
    const firstCrawlId = await createCompletedCrawl(context, setup, firstFinishedAt);
    const secondCrawlId = await createCompletedCrawl(context, setup, secondFinishedAt);
    await context.audit.persistEvaluationReport({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: firstCrawlId,
      engineVersion: 1,
      definitions: [definition],
      results: [result("failed")],
    });
    await context.audit.persistEvaluationReport({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: secondCrawlId,
      engineVersion: 1,
      definitions: [definition],
      results: [
        {
          ...result("not-checked"),
          scopeKey: "site#coverage-unavailable",
        },
      ],
    });

    expect(await context.database.select().from(auditFindings)).toMatchObject([
      {
        scopeKey: "site",
        currentLifecycle: "not_evaluated",
        lastEligibleResultStatus: "failed",
        firstSeenAt: firstFinishedAt,
        lastSeenAt: firstFinishedAt,
        lastEvaluatedAt: secondFinishedAt,
        lastFixedAt: null,
      },
    ]);
    const coverageOccurrence = await context.database
      .select({ missingData: auditFindingOccurrences.missingData })
      .from(auditFindingOccurrences)
      .where(eq(auditFindingOccurrences.crawlId, secondCrawlId));
    expect(coverageOccurrence).toEqual([{ missingData: ["crawl.dns_resolution"] }]);
  });

  it("persists synthetic page coverage only as unavailable and never creates a finding", async () => {
    const context = await createContext();
    const setup = await onboard(context, "coverage.example.com");
    const finishedAt = new Date(Date.now() + 20_000);
    const crawlId = await createCompletedCrawl(context, setup, finishedAt);
    const coverage = unavailablePageCoverage("https://coverage.example.com");

    await expect(
      context.audit.persistEvaluationReport({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId,
        engineVersion: 1,
        definitions: [pageDefinition],
        results: [coverage],
        now: new Date(finishedAt.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({
      status: "completed",
      resultCount: 1,
      eligibleCount: 0,
      evaluatedCount: 0,
      notCheckedCount: 1,
    });

    const [occurrence] = await context.database.select().from(auditFindingOccurrences);
    expect(occurrence).toMatchObject({
      scope: "page",
      scopeKey: "https://coverage.example.com#homepage-unavailable",
      pageId: null,
      normalizedUrl: null,
      eligibility: "unavailable",
      resultStatus: "not_checked",
      lifecycle: "not_evaluated",
      findingId: null,
    });
    expect(await context.database.select().from(auditFindings)).toHaveLength(0);

    await expect(
      context.database
        .update(auditFindingOccurrences)
        .set({
          eligibility: "eligible",
          resultStatus: "passed",
          lifecycle: null,
          confidence: "high",
          notEvaluatedReasonCode: null,
          notEvaluatedReason: null,
        })
        .where(eq(auditFindingOccurrences.id, occurrence!.id)),
    ).rejects.toThrow();

    const invalidCrawlAt = new Date(finishedAt.getTime() + 10_000);
    const invalidCrawlId = await createCompletedCrawl(context, setup, invalidCrawlAt);
    await expect(
      context.audit.persistEvaluationReport({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: invalidCrawlId,
        engineVersion: 1,
        definitions: [pageDefinition],
        results: [
          {
            ...coverage,
            eligibility: "eligible",
            status: "passed",
            confidence: "high",
            notEvaluatedReasonCode: null,
            notEvaluatedReason: null,
          },
        ],
      }),
    ).rejects.toThrow(/invalid page result target/iu);
    expect(await context.database.select().from(auditFindingOccurrences)).toHaveLength(1);
    expect(await context.database.select().from(auditFindings)).toHaveLength(0);

    await expect(
      context.audit.persistEvaluationReport({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: invalidCrawlId,
        engineVersion: 1,
        definitions: [pageDefinition],
        results: [
          {
            ...coverage,
            notEvaluatedReasonCode: "detector_error",
            notEvaluatedReason: "The deterministic detector raised an evaluation error.",
          },
        ],
      }),
    ).resolves.toMatchObject({
      status: "partially-completed",
      eligibleCount: 0,
      notCheckedCount: 1,
      ruleErrorCount: 1,
    });
    expect(await context.database.select().from(auditFindingOccurrences)).toHaveLength(2);
    expect(await context.database.select().from(auditFindings)).toHaveLength(0);
  });

  it("enforces tenant tuples and rejects scope-hash collisions", async () => {
    const context = await createContext();
    const first = await onboard(context, "first-audit.example.com");
    const firstFinishedAt = new Date(Date.now() + 20_000);
    const firstCrawlId = await createCompletedCrawl(context, first, firstFinishedAt);
    await context.audit.persistEvaluationReport({
      organizationId: first.organizationId,
      projectId: first.projectId,
      crawlId: firstCrawlId,
      engineVersion: 1,
      definitions: [definition],
      results: [result("failed")],
      now: new Date(firstFinishedAt.getTime() + 1_000),
    });
    const [finding] = await context.database.select().from(auditFindings);
    if (finding === undefined) throw new Error("Expected a finding.");

    const second = await onboard(context, "second-audit.example.com");
    await expect(
      context.audit.setFindingDisposition(second.scope, second.projectId, finding.id, {
        disposition: "ignored",
        reason: "Cross-tenant attempt.",
        traceId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      context.audit.persistEvaluationReport({
        organizationId: second.organizationId,
        projectId: second.projectId,
        crawlId: firstCrawlId,
        engineVersion: 1,
        definitions: [definition],
        results: [result("failed")],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await context.database
      .update(auditFindings)
      .set({ scopeKey: "different-site-key" })
      .where(eq(auditFindings.id, finding.id));
    const nextFinishedAt = new Date(firstFinishedAt.getTime() + 10_000);
    const nextCrawlId = await createCompletedCrawl(context, first, nextFinishedAt);
    await expect(
      context.audit.persistEvaluationReport({
        organizationId: first.organizationId,
        projectId: first.projectId,
        crawlId: nextCrawlId,
        engineVersion: 1,
        definitions: [definition],
        results: [result("failed")],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await context.database.select().from(auditEvaluationRuns)).toHaveLength(1);
  });
});
