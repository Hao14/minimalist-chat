import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import {
  auditEvaluateJobSchema,
  crawlDeadLetterJobSchema,
  crawlExecuteJobSchema,
  normalizeProjectOrigin,
  type OrganizationRole,
} from "@searvia/shared-types";
import { and, count, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";

import type { SearviaDatabase } from "./client.js";
import {
  createSearviaCrawlRepository,
  PHASE_ONE_PUBLIC_CRAWL_ENTITLEMENT,
  type AuditSnapshotCollectionLimits,
} from "./crawl-repository.js";
import { createSearviaRepository, type CrawlConfigInput } from "./repository.js";
import {
  auditLogs,
  crawlCheckpoints,
  crawlFrontier,
  crawlPageExtractions,
  crawlPages,
  crawlRobots,
  crawls,
  crawlUsageReservations,
  jobOutbox,
  memberships,
  searviaSchema,
  sessions,
  users,
} from "./schema.js";

const migrationsFolder = fileURLToPath(new URL("../migrations/", import.meta.url));
const clients: PGlite[] = [];
const CRAWL_CONFIG: CrawlConfigInput = {
  pageLimit: 10,
  maxDepth: 3,
  includeSubdomains: true,
  queryPolicy: "ignore_tracking",
};

interface Identity {
  readonly userId: string;
  readonly sessionId: string;
}

interface Context {
  readonly database: PgliteDatabase<typeof searviaSchema>;
  readonly tenant: ReturnType<typeof createSearviaRepository>;
  readonly crawl: ReturnType<typeof createSearviaCrawlRepository>;
}

async function createContext(limits?: AuditSnapshotCollectionLimits): Promise<Context> {
  const client = new PGlite();
  clients.push(client);
  const database = drizzle(client, { schema: searviaSchema });
  await migrate(database, { migrationsFolder });
  const typed = database as unknown as SearviaDatabase;
  return {
    database,
    tenant: createSearviaRepository(typed),
    crawl: createSearviaCrawlRepository(typed, limits),
  };
}

async function createIdentity(
  database: PgliteDatabase<typeof searviaSchema>,
  email: string,
): Promise<Identity> {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await database.insert(users).values({ id: userId, name: email.split("@")[0] ?? "User", email });
  await database.insert(sessions).values({
    id: sessionId,
    userId,
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return { userId, sessionId };
}

async function onboard(
  context: Context,
  identity: Identity,
  hostname: string,
  crawlConfig: CrawlConfigInput = CRAWL_CONFIG,
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

async function addMember(
  context: Context,
  organizationId: string,
  role: OrganizationRole,
  email: string,
) {
  const identity = await createIdentity(context.database, email);
  const [membership] = await context.database
    .insert(memberships)
    .values({ organizationId, userId: identity.userId, role, status: "active" })
    .returning({ id: memberships.id });
  if (membership === undefined) throw new Error("Expected a membership.");
  await context.database
    .update(sessions)
    .set({ activeOrganizationId: organizationId })
    .where(eq(sessions.id, identity.sessionId));
  const scope = await context.tenant.loadActiveOrganizationScope(
    identity.userId,
    identity.sessionId,
  );
  if (scope === null) throw new Error("Expected a member scope.");
  return { identity, membershipId: membership.id, scope };
}

async function createQueuedCrawl(
  context: Context,
  scope: Awaited<ReturnType<Context["tenant"]["loadActiveOrganizationScope"]>> & {},
  projectId: string,
  key: string = crypto.randomUUID(),
) {
  return context.crawl.createCrawl(scope, projectId, {
    idempotencyKey: key,
    traceId: crypto.randomUUID(),
  });
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("M2 crawl repository", () => {
  it("creates the crawl, immutable config snapshot, reservation, and outbox atomically", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-create@example.com");
    const setup = await onboard(context, owner, "create.example.com");
    const clientKey = "client-request-key-0001";
    const result = await createQueuedCrawl(context, setup.scope, setup.projectId, clientKey);

    expect(result.created).toBe(true);
    expect(result.crawl).toMatchObject({ status: "queued", discoveredCount: 0 });
    const [stored] = await context.database
      .select()
      .from(crawls)
      .where(eq(crawls.id, result.crawl.id));
    expect(stored?.idempotencyKeyHash).toBe(createHash("sha256").update(clientKey).digest("hex"));
    expect(stored?.idempotencyKeyHash).not.toContain(clientKey);
    expect(stored?.configSnapshot).toMatchObject({
      startUrl: "https://create.example.com/",
      pageLimit: 10,
      respectRobots: true,
      totalTimeoutMs: 300_000,
      renderingEnabled: false,
      submittedSitemapUrls: [],
    });
    expect(
      await context.database
        .select()
        .from(crawlUsageReservations)
        .where(eq(crawlUsageReservations.crawlId, result.crawl.id)),
    ).toHaveLength(1);
    expect(
      await context.database.select().from(jobOutbox).where(eq(jobOutbox.crawlId, result.crawl.id)),
    ).toHaveLength(1);
  });

  it("replays the same idempotency key and rejects a second active crawl", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-idempotency@example.com");
    const setup = await onboard(context, owner, "idempotency.example.com");
    const first = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "same-request-key",
    );
    const replay = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "same-request-key",
    );

    expect(replay).toMatchObject({ created: false, crawl: { id: first.crawl.id } });
    await expect(
      createQueuedCrawl(context, setup.scope, setup.projectId, "different-request-key"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [crawlCount] = await context.database.select({ value: count() }).from(crawls);
    expect(crawlCount?.value).toBe(1);
  });

  it("enforces the server-side public crawl entitlement before enqueue", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-entitlement@example.com");
    const setup = await onboard(context, owner, "entitlement.example.com");

    await expect(
      context.crawl.createCrawl(setup.scope, setup.projectId, {
        idempotencyKey: "entitlement-denied-key",
        traceId: crypto.randomUUID(),
        entitlement: { ...PHASE_ONE_PUBLIC_CRAWL_ENTITLEMENT, enabled: false },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await context.database.select().from(crawls)).toHaveLength(0);
    expect(await context.database.select().from(jobOutbox)).toHaveLength(0);
  });

  it("allows analysts to start, but viewer and Client roles can only read scoped crawls", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-roles@example.com");
    const setup = await onboard(context, owner, "roles.example.com");
    const analyst = await addMember(
      context,
      setup.organizationId,
      "analyst",
      "analyst@example.com",
    );
    const viewer = await addMember(context, setup.organizationId, "viewer", "viewer@example.com");
    const client = await addMember(context, setup.organizationId, "client", "client@example.com");
    await context.database.insert(searviaSchema.membershipProjectScopes).values({
      organizationId: setup.organizationId,
      membershipId: client.membershipId,
      projectId: setup.projectId,
      grantedByMembershipId: setup.membershipId,
    });

    const started = await createQueuedCrawl(context, analyst.scope, setup.projectId);
    expect(
      await context.crawl.getCrawl(viewer.scope, setup.projectId, started.crawl.id),
    ).toMatchObject({
      id: started.crawl.id,
    });
    expect(
      await context.crawl.getCrawl(client.scope, setup.projectId, started.crawl.id),
    ).toMatchObject({
      id: started.crawl.id,
    });
    await expect(createQueuedCrawl(context, viewer.scope, setup.projectId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      context.crawl.requestCancellation(
        viewer.scope,
        setup.projectId,
        started.crawl.id,
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns not found across tenants for crawl reads and cancellation", async () => {
    const context = await createContext();
    const first = await createIdentity(context.database, "first-crawl@example.com");
    const second = await createIdentity(context.database, "second-crawl@example.com");
    const firstSetup = await onboard(context, first, "first-crawl.example.com");
    const secondSetup = await onboard(context, second, "second-crawl.example.com");
    const target = await createQueuedCrawl(context, secondSetup.scope, secondSetup.projectId);

    await expect(
      context.crawl.getCrawl(firstSetup.scope, secondSetup.projectId, target.crawl.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      context.crawl.requestCancellation(
        firstSetup.scope,
        secondSetup.projectId,
        target.crawl.id,
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cancels a queued crawl idempotently and releases its durable reservation", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-cancel@example.com");
    const setup = await onboard(context, owner, "cancel.example.com");
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const traceId = crypto.randomUUID();
    const cancelled = await context.crawl.requestCancellation(
      setup.scope,
      setup.projectId,
      created.crawl.id,
      traceId,
    );
    const replay = await context.crawl.requestCancellation(
      setup.scope,
      setup.projectId,
      created.crawl.id,
      traceId,
    );

    expect(cancelled.status).toBe("cancelled");
    expect(replay.status).toBe("cancelled");
    expect(
      await context.database
        .select()
        .from(jobOutbox)
        .where(eq(jobOutbox.crawlId, created.crawl.id)),
    ).toMatchObject([{ status: "cancelled" }]);
    expect(
      await context.database
        .select()
        .from(crawlUsageReservations)
        .where(eq(crawlUsageReservations.crawlId, created.crawl.id)),
    ).toMatchObject([{ status: "released", consumedPages: 0 }]);
  });

  it("claims execution by the full tenant tuple and recovers only after lease expiry", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-claim@example.com");
    const setup = await onboard(context, owner, "claim.example.com");
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const now = new Date("2026-07-15T20:00:00.000Z");
    const first = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      executionToken: crypto.randomUUID(),
      leaseMs: 30_000,
      now,
    });
    expect(first.kind).toBe("claimed");
    const second = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      executionToken: crypto.randomUUID(),
      leaseMs: 30_000,
      now: new Date(now.getTime() + 5_000),
    });
    expect(second.kind).toBe("busy");
    const recovered = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      executionToken: crypto.randomUUID(),
      leaseMs: 30_000,
      now: new Date(now.getTime() + 31_000),
    });
    expect(recovered.kind).toBe("claimed");
    await expect(
      context.crawl.claimExecution({
        organizationId: crypto.randomUUID(),
        projectId: setup.projectId,
        crawlId: created.crawl.id,
        leaseMs: 30_000,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("renews only an unexpired execution lease owned by the full tenant token", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-heartbeat@example.com");
    const setup = await onboard(context, owner, "heartbeat.example.com");
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const now = new Date("2026-07-15T20:00:00.000Z");
    const claim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      leaseMs: 30_000,
      now,
    });
    if (claim.kind !== "claimed") throw new Error("Expected a worker claim.");
    const execution = { ...claim.crawl, executionToken: claim.executionToken };

    await expect(
      context.crawl.renewExecutionLease(execution, 30_000, new Date(now.getTime() + 10_000)),
    ).resolves.toBe(true);
    await expect(
      context.crawl.renewExecutionLease(
        { ...execution, executionToken: crypto.randomUUID() },
        30_000,
        new Date(now.getTime() + 11_000),
      ),
    ).resolves.toBe(false);
    await expect(
      context.crawl.renewExecutionLease(execution, 30_000, new Date(now.getTime() + 41_000)),
    ).resolves.toBe(false);
  });

  it("rejects every execution-state mutation after its lease expires", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-expired-lease@example.com");
    const setup = await onboard(context, owner, "expired-lease.example.com");
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const claimedAt = new Date("2026-07-15T20:00:00.000Z");
    const claim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      leaseMs: 5_000,
      now: claimedAt,
    });
    if (claim.kind !== "claimed") throw new Error("Expected a worker claim.");
    const execution = { ...claim.crawl, executionToken: claim.executionToken };
    const expiredAt = new Date(claimedAt.getTime() + 5_001);

    await expect(
      context.crawl.recordExecutionProgress(
        execution,
        {
          discovered: 0,
          processed: 0,
          succeeded: 0,
          failed: 0,
          blocked: 0,
          skipped: 0,
          bytesReceived: 0,
        },
        5_000,
        expiredAt,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      context.crawl.transitionStage(execution, "discovering", expiredAt),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      context.crawl.releaseExecutionForRetry(
        execution,
        "request_timeout",
        "The request timed out.",
        expiredAt,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      context.crawl.completeExecution(execution, {
        status: "completed",
        completionReason: "frontier_exhausted",
        now: expiredAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      context.crawl.finalizeExecutionFailure(execution, {
        attemptsMade: 4,
        errorType: "request_timeout",
        errorMessage: "The request timed out.",
        now: expiredAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reconciles pre-claim failures without crossing tenant, contract, or active-lease fences", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-preclaim@example.com");
    const setup = await onboard(context, owner, "preclaim.example.com");
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const [executeOutbox] = await context.database
      .select({ payload: jobOutbox.payload })
      .from(jobOutbox)
      .where(and(eq(jobOutbox.crawlId, created.crawl.id), eq(jobOutbox.jobType, "crawl.execute")));
    const job = crawlExecuteJobSchema.parse(executeOutbox?.payload);
    const now = new Date("2026-07-15T20:00:00.000Z");
    const failure = {
      organizationId: job.organizationId,
      projectId: job.projectId,
      crawlId: job.crawlId,
      queueJobId: job.crawlId,
      requestedByMembershipId: job.requestedByMembershipId,
      traceId: job.traceId,
      idempotencyKey: job.idempotencyKey,
      estimatedPages: job.estimatedPages,
      attemptsMade: 1,
      errorType: "crawl_worker_error",
      errorMessage: "The crawl worker could not complete this attempt.",
      terminal: false,
      now,
    } as const;

    await expect(context.crawl.reconcilePreClaimFailure(failure)).resolves.toEqual({
      kind: "retryable",
    });
    await expect(
      context.crawl.reconcilePreClaimFailure({
        ...failure,
        traceId: crypto.randomUUID(),
        terminal: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      context.crawl.reconcilePreClaimFailure({
        ...failure,
        organizationId: crypto.randomUUID(),
        terminal: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const claim = await context.crawl.claimExecution({
      organizationId: job.organizationId,
      projectId: job.projectId,
      crawlId: job.crawlId,
      queueJobId: job.crawlId,
      requestedByMembershipId: job.requestedByMembershipId,
      traceId: job.traceId,
      idempotencyKey: job.idempotencyKey,
      estimatedPages: job.estimatedPages,
      leaseMs: 30_000,
      now: new Date(now.getTime() + 1_000),
    });
    if (claim.kind !== "claimed") throw new Error("Expected a worker claim.");
    await expect(
      context.crawl.reconcilePreClaimFailure({
        ...failure,
        attemptsMade: 4,
        terminal: true,
        now: new Date(now.getTime() + 2_000),
      }),
    ).resolves.toEqual({ kind: "busy", retryAfterMs: 29_000 });

    await context.crawl.releaseExecutionForRetry(
      { ...claim.crawl, executionToken: claim.executionToken },
      "crawl_interrupted",
      "The worker stopped before processing began.",
      new Date(now.getTime() + 3_000),
    );
    const finalFailure = {
      ...failure,
      attemptsMade: 4,
      terminal: true,
      now: new Date(now.getTime() + 4_000),
    } as const;
    await expect(context.crawl.reconcilePreClaimFailure(finalFailure)).resolves.toEqual({
      kind: "failed",
      status: "failed",
    });
    await expect(context.crawl.reconcilePreClaimFailure(finalFailure)).resolves.toEqual({
      kind: "already_terminal",
    });

    expect(
      await context.database
        .select()
        .from(jobOutbox)
        .where(
          and(eq(jobOutbox.crawlId, created.crawl.id), eq(jobOutbox.jobType, "crawl.dead-letter")),
        ),
    ).toHaveLength(1);
    expect(
      await context.database
        .select()
        .from(crawlUsageReservations)
        .where(eq(crawlUsageReservations.crawlId, created.crawl.id)),
    ).toMatchObject([{ status: "released", consumedPages: 0 }]);
  });

  it("queues one audit evaluation when pre-claim exhaustion preserves partial crawl data", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-preclaim-partial@example.com");
    const setup = await onboard(context, owner, "preclaim-partial.example.com");
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const [executeOutbox] = await context.database
      .select({ payload: jobOutbox.payload })
      .from(jobOutbox)
      .where(and(eq(jobOutbox.crawlId, created.crawl.id), eq(jobOutbox.jobType, "crawl.execute")));
    const job = crawlExecuteJobSchema.parse(executeOutbox?.payload);
    await context.database
      .update(crawls)
      .set({ discoveredCount: 1, processedCount: 1, succeededCount: 1 })
      .where(eq(crawls.id, created.crawl.id));
    const finishedAt = new Date("2026-07-15T20:04:00.000Z");

    await expect(
      context.crawl.reconcilePreClaimFailure({
        organizationId: job.organizationId,
        projectId: job.projectId,
        crawlId: job.crawlId,
        queueJobId: job.crawlId,
        requestedByMembershipId: job.requestedByMembershipId,
        traceId: job.traceId,
        idempotencyKey: job.idempotencyKey,
        estimatedPages: job.estimatedPages,
        attemptsMade: 4,
        errorType: "crawl_worker_error",
        errorMessage: "The crawl worker could not claim the final attempt.",
        terminal: true,
        now: finishedAt,
      }),
    ).resolves.toEqual({ kind: "failed", status: "partially_completed" });

    const auditIntents = await context.database
      .select({ payload: jobOutbox.payload })
      .from(jobOutbox)
      .where(and(eq(jobOutbox.crawlId, created.crawl.id), eq(jobOutbox.jobType, "audit.evaluate")));
    expect(auditIntents).toHaveLength(1);
    expect(auditEvaluateJobSchema.parse(auditIntents[0]?.payload)).toMatchObject({
      crawlStatus: "partially_completed",
      crawlFinishedAt: finishedAt.toISOString(),
    });
  });

  it("deduplicates page and sitemap evidence without charging sitemap metadata as a page", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-frontier@example.com");
    const setup = await onboard(context, owner, "frontier.example.com", {
      ...CRAWL_CONFIG,
      pageLimit: 1,
    });
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const claim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      leaseMs: 60_000,
    });
    if (claim.kind !== "claimed") throw new Error("Expected a worker claim.");
    const executionContext = { ...claim.crawl, executionToken: claim.executionToken };
    await context.crawl.transitionStage(executionContext, "discovering");
    await context.crawl.transitionStage(executionContext, "crawling");
    const normalizedUrl = "https://frontier.example.com/";
    const urlHash = createHash("sha256").update(normalizedUrl).digest("hex");
    const discovery = {
      requestedUrl: normalizedUrl,
      discoveredUrl: "/",
      normalizedUrl,
      urlHash,
      origin: "https://frontier.example.com",
      hostname: "frontier.example.com",
      depth: 0,
      discoverySource: "seed" as const,
      discoveredFromFrontierId: null,
    };
    const first = await context.crawl.persistDiscoveredUrl(executionContext, discovery);
    expect((await context.crawl.persistDiscoveredUrl(executionContext, discovery)).created).toBe(
      false,
    );
    const observation = {
      frontierId: first.id,
      requestedUrl: normalizedUrl,
      normalizedUrl,
      finalUrl: normalizedUrl,
      urlHash,
      statusCode: 200,
      contentType: "text/html",
      responseBytes: 128,
      depth: 0,
      redirectChain: [],
      robotsDecision: "not_checked" as const,
      timing: {
        startedAt: new Date().toISOString(),
        dnsMs: 1,
        ttfbMs: 2,
        downloadMs: 2,
        totalMs: 5,
      },
      errorType: null,
      errorMessage: null,
      discoverySource: "seed" as const,
      outcome: "succeeded" as const,
    };
    const firstObservation = await context.crawl.persistPageObservation(
      executionContext,
      observation,
    );
    expect(firstObservation).toMatchObject({ created: true, pageId: expect.any(String) });
    expect(await context.crawl.persistPageObservation(executionContext, observation)).toEqual({
      created: false,
      pageId: firstObservation.pageId,
      rawArtifactExists: false,
      storedObservation: expect.objectContaining({
        statusCode: 200,
        responseBytes: 128,
      }),
    });
    const sitemapUrl = "https://frontier.example.com/sitemap.xml";
    const sitemapHash = createHash("sha256").update(sitemapUrl).digest("hex");
    const sitemap = await context.crawl.persistDiscoveredUrl(executionContext, {
      requestedUrl: sitemapUrl,
      discoveredUrl: sitemapUrl,
      normalizedUrl: sitemapUrl,
      urlHash: sitemapHash,
      origin: "https://frontier.example.com",
      hostname: "frontier.example.com",
      depth: 0,
      discoverySource: "robots_sitemap",
      discoveredFromFrontierId: null,
    });
    expect(
      await context.crawl.persistPageObservation(executionContext, {
        frontierId: sitemap.id,
        requestedUrl: sitemapUrl,
        normalizedUrl: sitemapUrl,
        finalUrl: sitemapUrl,
        urlHash: sitemapHash,
        statusCode: 200,
        contentType: "application/xml",
        responseBytes: 32,
        depth: 0,
        redirectChain: [],
        robotsDecision: "not_checked",
        timing: null,
        errorType: null,
        errorMessage: null,
        discoverySource: "robots_sitemap",
        outcome: "succeeded",
        countsTowardPageLimit: false,
      }),
    ).toMatchObject({ created: true, pageId: expect.any(String) });
    for (const hostname of ["frontier.example.com", "www.frontier.example.com"]) {
      await context.crawl.persistRobotsObservation(
        { ...claim.crawl, executionToken: claim.executionToken },
        {
          origin: `https://${hostname}`,
          hostname,
          requestedUrl: `https://${hostname}/robots.txt`,
          finalUrl: `https://${hostname}/robots.txt`,
          statusCode: 200,
          contentType: "text/plain",
          result: "fetched",
          userAgent: claim.crawl.config.userAgent,
          contentSha256: createHash("sha256").update("User-agent: *").digest("hex"),
          content: "User-agent: *",
          crawlDelayMs: null,
          sitemapUrls: [],
          fetchedAt: new Date(),
        },
      );
    }
    await context.crawl.saveCheckpoint(executionContext, 0);

    expect(await context.database.select().from(crawlFrontier)).toHaveLength(2);
    expect(await context.database.select().from(crawlPages)).toHaveLength(2);
    expect(await context.database.select().from(crawlRobots)).toHaveLength(2);
    expect(await context.database.select().from(crawlCheckpoints)).toHaveLength(1);
    expect(
      await context.crawl.getCrawl(setup.scope, setup.projectId, created.crawl.id),
    ).toMatchObject({
      discoveredCount: 2,
      processedCount: 1,
      succeededCount: 1,
      failedCount: 0,
      bytesReceived: 160,
    });
    await expect(
      context.crawl.recordExecutionProgress(
        executionContext,
        {
          discovered: 2,
          processed: 1,
          succeeded: 1,
          failed: 0,
          blocked: 0,
          skipped: 0,
          bytesReceived: 160,
        },
        60_000,
      ),
    ).resolves.toBeUndefined();
    await context.crawl.completeExecution(executionContext, {
      status: "completed",
      completionReason: "completed",
    });
    expect(
      await context.database
        .select({ consumedPages: crawlUsageReservations.consumedPages })
        .from(crawlUsageReservations)
        .where(eq(crawlUsageReservations.crawlId, created.crawl.id)),
    ).toEqual([{ consumedPages: 1 }]);
  });

  it("loads a tenant-scoped, conservative audit snapshot from persisted M3 evidence", async () => {
    const context = await createContext({ headings: 1, links: 1, resources: 1 });
    const owner = await createIdentity(context.database, "owner-snapshot@example.com");
    const setup = await onboard(context, owner, "snapshot.example.com");
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const claim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      leaseMs: 60_000,
    });
    if (claim.kind !== "claimed") throw new Error("Expected an audit snapshot crawl claim.");
    const execution = { ...claim.crawl, executionToken: claim.executionToken };
    await context.crawl.transitionStage(execution, "discovering");
    await context.crawl.transitionStage(execution, "crawling");

    const origin = "https://snapshot.example.com";
    const sitemapUrl = `${origin}/sitemap.xml`;
    const robotsFetchedAt = new Date();
    const robotsObservation = await context.crawl.persistRobotsObservation(execution, {
      origin,
      hostname: "snapshot.example.com",
      requestedUrl: `${origin}/robots.txt`,
      finalUrl: `${origin}/robots.txt`,
      statusCode: 200,
      contentType: "text/plain",
      result: "fetched",
      userAgent: claim.crawl.config.userAgent,
      contentSha256: createHash("sha256").update(`Sitemap: ${sitemapUrl}`).digest("hex"),
      content: `User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}`,
      crawlDelayMs: null,
      sitemapUrls: [sitemapUrl],
      fetchedAt: robotsFetchedAt,
    });
    const pageInputs = [
      { url: `${origin}/`, depth: 0, discoverySource: "seed" as const },
      { url: `${origin}/sitemap-target`, depth: 3, discoverySource: "link" as const },
      { url: `${origin}/near`, depth: 1, discoverySource: "link" as const },
      { url: `${origin}/deep`, depth: 2, discoverySource: "link" as const },
    ];
    const persisted: Array<{
      url: string;
      urlHash: string;
      frontierId: string;
      pageId: string;
    }> = [];
    for (const [index, input] of pageInputs.entries()) {
      const urlHash = createHash("sha256").update(input.url).digest("hex");
      const frontier = await context.crawl.persistDiscoveredUrl(execution, {
        requestedUrl: input.url,
        discoveredUrl: input.url,
        normalizedUrl: input.url,
        urlHash,
        origin,
        hostname: "snapshot.example.com",
        depth: input.depth,
        discoverySource: input.discoverySource,
        discoveredFromFrontierId: index === 0 ? null : persisted[0]!.frontierId,
      });
      const page = await context.crawl.persistPageObservation(execution, {
        frontierId: frontier.id,
        requestedUrl: input.url,
        normalizedUrl: input.url,
        finalUrl: input.url,
        urlHash,
        statusCode: 200,
        contentType: "text/html; charset=utf-8",
        htmlDetected: index === 0 ? true : null,
        htmlDetectionSource: index === 0 ? "bounded_response_prefix" : null,
        htmlDetectionBytes: index === 0 ? 128 : null,
        responseHeaders: { "content-type": ["text/html; charset=utf-8"] },
        contentLength: 128 + index,
        responseBytes: 128 + index,
        transferSize: 96 + index,
        compression: "gzip",
        cacheHeaders: { "cache-control": ["max-age=60"] },
        securityHeaders: { "strict-transport-security": ["max-age=31536000"] },
        depth: input.depth,
        redirectChain: [],
        robotsDecision: index === 3 ? "not_checked" : "allowed",
        robotsObservationId: index === 3 ? null : robotsObservation.id,
        timing: null,
        errorType: null,
        errorMessage: null,
        discoverySource: input.discoverySource,
        outcome: "succeeded",
      });
      persisted.push({ url: input.url, urlHash, frontierId: frontier.id, pageId: page.pageId });
    }

    const home = persisted[0]!;
    const sitemapTarget = persisted[1]!;
    const scriptUrl = "https://cdn.example.net/app.js";
    const rawExtractedAt = new Date();
    await context.crawl.persistPageExtraction(execution, {
      pageId: home.pageId,
      source: "raw",
      status: "succeeded",
      title: "Raw homepage title",
      documentMetadataComplete: true,
      titleTagCount: 1,
      metaDescription: "Persisted raw extraction",
      metaDescriptionTagCount: 1,
      metaRobots: ["index", "follow"],
      xRobotsTag: [],
      directiveScopePreserved: true,
      linksComplete: true,
      canonicalUrl: home.url,
      canonicalTagCount: 1,
      canonicalNormalizationFailure: null,
      metaRefreshUrl: "https://snapshot.example.com/meta-destination",
      javascriptRedirectUrl: "https://snapshot.example.com/script-destination",
      visibleText: "Audit snapshot homepage",
      visibleTextComplete: true,
      wordCount: 3,
      headingsComplete: true,
      htmlLanguage: "en",
      characterEncoding: "utf-8",
      characterEncodingDeclared: "utf-8",
      characterEncodingSource: "meta",
      characterEncodingDeclarationOffset: 64,
      viewportDeclarations: ["width=device-width, initial-scale=1"],
      htmlDoctypePresent: true,
      iconDeclarationCount: 1,
      openGraph: {},
      socialCards: {},
      contentHash: createHash("sha256").update("Audit snapshot homepage").digest("hex"),
      domHash: createHash("sha256").update("<html>Audit snapshot homepage</html>").digest("hex"),
      similarityFingerprint: "00112233445566778899aabbccddeeff",
      meaningfulContent: true,
      clientRendered: false,
      renderingErrorType: null,
      renderingErrorMessage: null,
      headings: [
        { level: 1, ordinal: 0, text: "Raw homepage title" },
        { level: 2, ordinal: 1, text: "Bounded secondary heading" },
      ],
      links: [
        {
          targetFrontierId: sitemapTarget.frontierId,
          targetPageId: sitemapTarget.pageId,
          targetUrl: sitemapTarget.url,
          normalizedTargetUrl: sitemapTarget.url,
          targetUrlHash: sitemapTarget.urlHash,
          scope: "internal",
          anchorText: "Sitemap target",
          relValues: ["follow"],
          linkType: "anchor",
          hreflang: null,
          discovered: true,
          crawlDepth: 3,
          discoverySource: "link",
          ordinal: 0,
        },
        {
          targetFrontierId: null,
          targetPageId: null,
          targetUrl: "https://external.example.net/",
          normalizedTargetUrl: "https://external.example.net/",
          targetUrlHash: createHash("sha256").update("https://external.example.net/").digest("hex"),
          scope: "external",
          anchorText: "External target",
          relValues: ["nofollow"],
          linkType: "anchor",
          hreflang: null,
          discovered: false,
          crawlDepth: 1,
          discoverySource: "link",
          ordinal: 1,
        },
      ],
      images: [],
      resources: [
        {
          resourceType: "script",
          sourceUrl: scriptUrl,
          normalizedUrl: scriptUrl,
          urlHash: createHash("sha256").update(scriptUrl).digest("hex"),
          scope: "external",
          robotsDecision: "not_checked",
          robotsObservationId: null,
          attributes: { defer: "" },
          ordinal: 0,
        },
        {
          resourceType: "stylesheet",
          sourceUrl: "https://cdn.example.net/app.css",
          normalizedUrl: "https://cdn.example.net/app.css",
          urlHash: createHash("sha256").update("https://cdn.example.net/app.css").digest("hex"),
          scope: "external",
          robotsDecision: "not_checked",
          robotsObservationId: null,
          attributes: {},
          ordinal: 1,
        },
      ],
      structuredData: [],
      extractedAt: rawExtractedAt,
    });
    const oversizedRenderedText = "r".repeat(100_001);
    await context.crawl.persistPageExtraction(execution, {
      pageId: home.pageId,
      source: "rendered",
      status: "succeeded",
      title: "Rendered title must not replace raw evidence",
      metaDescription: null,
      metaRobots: [],
      xRobotsTag: [],
      directiveScopePreserved: true,
      linksComplete: true,
      canonicalUrl: null,
      canonicalTagCount: 0,
      canonicalNormalizationFailure: null,
      visibleText: oversizedRenderedText,
      visibleTextComplete: true,
      wordCount: 1,
      htmlLanguage: null,
      characterEncoding: null,
      openGraph: {},
      socialCards: {},
      contentHash: createHash("sha256").update("Rendered").digest("hex"),
      domHash: createHash("sha256").update("<main>Rendered</main>").digest("hex"),
      similarityFingerprint: "ffeeddccbbaa99887766554433221100",
      meaningfulContent: true,
      clientRendered: true,
      renderingErrorType: null,
      renderingErrorMessage: null,
      headings: [],
      links: [],
      images: [],
      resources: [],
      structuredData: [],
      extractedAt: new Date(),
    });

    const failedPage = persisted[2]!;
    const failedExtractionInput = {
      pageId: failedPage.pageId,
      source: "raw" as const,
      status: "failed" as const,
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
      renderingErrorMessage: "The hostile HTML exceeded the deterministic node limit.",
      headings: [],
      links: [],
      images: [],
      resources: [],
      structuredData: [],
      extractedAt: new Date(),
    };
    const failedExtraction = await context.crawl.persistPageExtraction(
      execution,
      failedExtractionInput,
    );
    expect(failedExtraction.created).toBe(true);
    expect(
      await context.crawl.persistPageExtraction(execution, failedExtractionInput),
    ).toMatchObject({ extractionId: failedExtraction.extractionId, created: false });
    expect(
      await context.crawl.persistPageExtraction(execution, {
        ...failedExtractionInput,
        extractedAt: new Date(failedExtractionInput.extractedAt.getTime() + 1_000),
      }),
    ).toMatchObject({ extractionId: failedExtraction.extractionId, created: false });
    await expect(
      context.crawl.persistPageExtraction(execution, {
        ...failedExtractionInput,
        status: "succeeded",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const differentLinkUrl = `${origin}/different`;
    const materiallyDifferentRetries = [
      { ...failedExtractionInput, visibleText: "Different text", wordCount: 2 },
      { ...failedExtractionInput, openGraph: { "og:title": ["Different"] } },
      { ...failedExtractionInput, meaningfulContent: true },
      {
        ...failedExtractionInput,
        headings: [{ level: 1 as const, ordinal: 0, text: "Different heading" }],
      },
      {
        ...failedExtractionInput,
        links: [
          {
            targetFrontierId: null,
            targetPageId: null,
            targetUrl: differentLinkUrl,
            normalizedTargetUrl: differentLinkUrl,
            targetUrlHash: createHash("sha256").update(differentLinkUrl).digest("hex"),
            scope: "internal" as const,
            anchorText: "Different link",
            relValues: [],
            linkType: "anchor" as const,
            hreflang: null,
            discovered: false,
            crawlDepth: 1,
            discoverySource: "link" as const,
            ordinal: 0,
          },
        ],
      },
      {
        ...failedExtractionInput,
        images: [
          {
            sourceUrl: null,
            normalizedUrl: null,
            urlHash: null,
            scope: null,
            altText: "Different image",
            title: null,
            width: null,
            height: null,
            loading: null,
            srcset: null,
            ordinal: 0,
          },
        ],
      },
      {
        ...failedExtractionInput,
        resources: [
          {
            resourceType: "script" as const,
            sourceUrl: null,
            normalizedUrl: null,
            urlHash: null,
            scope: null,
            robotsDecision: "not_checked" as const,
            robotsObservationId: null,
            attributes: { defer: "" },
            ordinal: 0,
          },
        ],
      },
      {
        ...failedExtractionInput,
        structuredData: [
          {
            kind: "json_ld" as const,
            parseStatus: "parsed" as const,
            schemaTypes: ["Thing"],
            rawValue: '{"@type":"Thing"}',
            parsedValue: { "@type": "Thing" },
            errorMessage: null,
            ordinal: 0,
          },
        ],
      },
    ];
    for (const different of materiallyDifferentRetries) {
      await expect(context.crawl.persistPageExtraction(execution, different)).rejects.toMatchObject(
        { code: "CONFLICT" },
      );
    }
    expect(
      await context.database
        .select({
          status: crawlPageExtractions.status,
          errorType: crawlPageExtractions.renderingErrorType,
          errorMessage: crawlPageExtractions.renderingErrorMessage,
        })
        .from(crawlPageExtractions)
        .where(eq(crawlPageExtractions.id, failedExtraction.extractionId)),
    ).toEqual([
      {
        status: "failed",
        errorType: "extraction_error",
        errorMessage: "The hostile HTML exceeded the deterministic node limit.",
      },
    ]);

    const sitemapObservedAt = new Date();
    const sitemap = await context.crawl.persistSitemapObservation(execution, {
      parentSitemapId: null,
      requestedUrl: sitemapUrl,
      normalizedUrl: sitemapUrl,
      finalUrl: sitemapUrl,
      urlHash: createHash("sha256").update(sitemapUrl).digest("hex"),
      source: "robots",
      status: "parsed",
      format: "urlset",
      compression: "identity",
      statusCode: 200,
      contentType: "application/xml",
      contentLength: 256,
      transferSize: 200,
      contentDigest: createHash("sha256").update("<urlset />").digest("hex"),
      depth: 0,
      redirectChain: [],
      parseIssues: [],
      errorType: null,
      errorMessage: null,
      fetchedAt: sitemapObservedAt,
      parsedAt: sitemapObservedAt,
      entries: [
        {
          entryType: "url",
          loc: sitemapTarget.url,
          normalizedLoc: sitemapTarget.url,
          urlHash: sitemapTarget.urlHash,
          lastmodRaw: "2026-07-16",
          lastmodAt: new Date("2026-07-16T00:00:00.000Z"),
          targetFrontierId: sitemapTarget.frontierId,
          targetPageId: sitemapTarget.pageId,
          targetSitemapId: null,
          ordinal: 0,
        },
      ],
    });
    expect(sitemap.created).toBe(true);
    await context.crawl.completeExecution(execution, {
      status: "completed",
      completionReason: "frontier_exhausted",
    });

    const snapshot = await context.crawl.loadAuditCrawlSnapshot({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
    });
    expect(snapshot).toMatchObject({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      origin,
      status: "completed",
      configuration: {
        maxDepth: CRAWL_CONFIG.maxDepth,
        redirectLimit: 5,
        maxResponseBytes: 2_000_000,
        queryPolicy: CRAWL_CONFIG.queryPolicy,
      },
      historicalRedirects: [],
    });
    expect(snapshot.pages).toHaveLength(4);
    const homeSnapshot = snapshot.pages.find((page) => page.id === home.pageId);
    const sitemapSnapshot = snapshot.pages.find((page) => page.id === sitemapTarget.pageId);
    const nearSnapshot = snapshot.pages.find((page) => page.normalizedUrl === `${origin}/near`);
    const deepSnapshot = snapshot.pages.find((page) => page.normalizedUrl === `${origin}/deep`);
    expect(homeSnapshot).toMatchObject({
      importance: "homepage",
      indexabilityIntent: "intended",
      responseHeaders: { "content-type": ["text/html; charset=utf-8"] },
      securityHeaders: { "strict-transport-security": ["max-age=31536000"] },
      extraction: {
        source: "raw",
        status: "succeeded",
        title: "Raw homepage title",
        documentMetadataComplete: true,
        titleTagCount: 1,
        metaDescription: "Persisted raw extraction",
        metaDescriptionTagCount: 1,
        metaRobots: ["index", "follow"],
        directiveScopePreserved: true,
        linksComplete: false,
        canonicalUrl: home.url,
        canonicalTagCount: 1,
        metaRefreshUrl: "https://snapshot.example.com/meta-destination",
        javascriptRedirectUrl: "https://snapshot.example.com/script-destination",
        visibleText: "Audit snapshot homepage",
        visibleTextComplete: true,
        wordCount: 3,
        headings: [
          {
            id: expect.any(String),
            level: 1,
            ordinal: 0,
            text: "Raw homepage title",
          },
        ],
        headingsComplete: false,
        htmlLanguage: "en",
        characterEncoding: {
          used: "utf-8",
          declared: "utf-8",
          source: "meta",
          declarationOffsetBytes: 64,
        },
        viewportDeclarations: ["width=device-width, initial-scale=1"],
        htmlDoctypePresent: true,
        iconDeclarationCount: 1,
        meaningfulContent: true,
        clientRendered: false,
        extractedAt: rawExtractedAt.toISOString(),
      },
      renderedExtraction: {
        source: "rendered",
        status: "succeeded",
        title: "Rendered title must not replace raw evidence",
        visibleText: "r".repeat(100_000),
        visibleTextComplete: false,
        wordCount: 1,
        meaningfulContent: true,
        clientRendered: true,
      },
      links: [
        {
          targetPageId: sitemapTarget.pageId,
          normalizedTargetUrl: sitemapTarget.url,
          scope: "internal",
          anchorText: "Sitemap target",
          relValues: ["follow"],
          linkType: "anchor",
          discovered: true,
          crawlDepth: 3,
          discoverySource: "link",
          ordinal: 0,
        },
      ],
      resources: [
        {
          resourceType: "script",
          sourceUrl: scriptUrl,
          normalizedUrl: scriptUrl,
          scope: "external",
        },
      ],
    });
    expect(homeSnapshot).toMatchObject({
      htmlDetected: true,
      htmlDetectionSource: "bounded_response_prefix",
      htmlDetectionBytes: 128,
    });
    expect(homeSnapshot?.resources[0]).toMatchObject({
      robotsDecision: "not-checked",
      robotsObservationId: null,
      robotsResult: null,
    });
    expect(sitemapSnapshot).toMatchObject({
      importance: "important",
      indexabilityIntent: "intended",
    });
    expect(nearSnapshot).toMatchObject({
      importance: "standard",
      indexabilityIntent: "unknown",
      extraction: null,
      links: [],
      resources: [],
    });
    expect(deepSnapshot).toMatchObject({
      importance: "standard",
      indexabilityIntent: "unknown",
      robotsDecision: "not-checked",
    });
    expect(snapshot.robots).toEqual([
      expect.objectContaining({
        origin,
        result: "fetched",
        sitemapUrls: [sitemapUrl],
        fetchedAt: robotsFetchedAt.toISOString(),
      }),
    ]);
    expect(snapshot.sitemaps).toEqual([
      expect.objectContaining({
        id: sitemap.sitemapId,
        source: "robots",
        status: "parsed",
        format: "urlset",
        observedAt: sitemapObservedAt.toISOString(),
        entries: [
          expect.objectContaining({
            entryType: "url",
            normalizedLoc: sitemapTarget.url,
            targetPageId: sitemapTarget.pageId,
          }),
        ],
      }),
    ]);
  });

  it("loads prior same-tenant temporary redirects as bounded crawl-history evidence", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-redirect-history@example.com");
    const setup = await onboard(context, owner, "redirect-history.example.com");
    const prior = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "redirect-history-prior",
    );
    const priorClaim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: prior.crawl.id,
      leaseMs: 60_000,
    });
    if (priorClaim.kind !== "claimed") throw new Error("Expected a prior crawl claim.");
    const priorExecution = {
      ...priorClaim.crawl,
      executionToken: priorClaim.executionToken,
    };
    await context.crawl.transitionStage(priorExecution, "discovering");
    await context.crawl.transitionStage(priorExecution, "crawling");
    const requestedUrl = "https://redirect-history.example.com/old";
    const resolvedUrl = "https://redirect-history.example.com/new";
    const urlHash = createHash("sha256").update(requestedUrl).digest("hex");
    const frontier = await context.crawl.persistDiscoveredUrl(priorExecution, {
      requestedUrl,
      discoveredUrl: requestedUrl,
      normalizedUrl: requestedUrl,
      urlHash,
      origin: "https://redirect-history.example.com",
      hostname: "redirect-history.example.com",
      depth: 0,
      discoverySource: "seed",
      discoveredFromFrontierId: null,
    });
    await context.crawl.persistPageObservation(priorExecution, {
      frontierId: frontier.id,
      requestedUrl,
      normalizedUrl: requestedUrl,
      finalUrl: resolvedUrl,
      urlHash,
      statusCode: 200,
      contentType: "text/html",
      responseHeaders: { "content-type": ["text/html"] },
      contentLength: 10,
      responseBytes: 10,
      transferSize: 10,
      compression: null,
      cacheHeaders: {},
      securityHeaders: {},
      depth: 0,
      redirectChain: [
        {
          sequence: 0,
          requestedUrl,
          statusCode: 302,
          location: "/new",
          resolvedUrl,
        },
      ],
      robotsDecision: "not_checked",
      timing: null,
      errorType: null,
      errorMessage: null,
      discoverySource: "seed",
      outcome: "succeeded",
    });
    const firstFinishedAt = new Date();
    await context.crawl.completeExecution(priorExecution, {
      status: "completed",
      completionReason: "frontier_exhausted",
      now: firstFinishedAt,
    });

    const current = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "redirect-history-current",
    );
    const currentClaim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: current.crawl.id,
      leaseMs: 60_000,
    });
    if (currentClaim.kind !== "claimed") throw new Error("Expected a current crawl claim.");
    await context.crawl.completeExecution(
      { ...currentClaim.crawl, executionToken: currentClaim.executionToken },
      {
        status: "completed",
        completionReason: "frontier_exhausted",
        now: new Date(firstFinishedAt.getTime() + 1_000),
      },
    );

    const auditSnapshot = await context.crawl.loadAuditCrawlSnapshot({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: current.crawl.id,
    });
    expect(auditSnapshot.historicalRedirects).toEqual([
      {
        crawlId: prior.crawl.id,
        crawlFinishedAt: firstFinishedAt.toISOString(),
        requestedUrl,
        resolvedUrl,
        statusCode: 302,
        observedAt: expect.any(String),
      },
    ]);
    expect(auditSnapshot.historicalRedirectCoverage).toEqual({
      complete: true,
      truncated: false,
      pageObservationLimit: 10_000,
      loadedPageObservationCount: 1,
      loadedCrawlCount: 1,
    });
  });

  it("rejects non-auditable crawl states and cross-tenant snapshot tuples", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-snapshot-fences@example.com");
    const setup = await onboard(context, owner, "snapshot-fences.example.com");
    const active = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const activeScope = {
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: active.crawl.id,
    };
    await expect(context.crawl.loadAuditCrawlSnapshot(activeScope)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      context.crawl.loadAuditCrawlSnapshot({
        ...activeScope,
        organizationId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      context.crawl.loadAuditCrawlSnapshot({
        ...activeScope,
        projectId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const failedClaim = await context.crawl.claimExecution({
      ...activeScope,
      leaseMs: 60_000,
    });
    if (failedClaim.kind !== "claimed") throw new Error("Expected a failed snapshot claim.");
    await context.crawl.completeExecution(
      { ...failedClaim.crawl, executionToken: failedClaim.executionToken },
      { status: "failed", completionReason: "nothing_fetched" },
    );
    await expect(context.crawl.loadAuditCrawlSnapshot(activeScope)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const cancelled = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "snapshot-cancelled",
    );
    await context.crawl.requestCancellation(
      setup.scope,
      setup.projectId,
      cancelled.crawl.id,
      crypto.randomUUID(),
    );
    await expect(
      context.crawl.loadAuditCrawlSnapshot({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: cancelled.crawl.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const partial = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "snapshot-partial",
    );
    const partialClaim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: partial.crawl.id,
      leaseMs: 60_000,
    });
    if (partialClaim.kind !== "claimed") throw new Error("Expected a partial snapshot claim.");
    await context.database
      .update(crawls)
      .set({ discoveredCount: 1, processedCount: 1, succeededCount: 1 })
      .where(eq(crawls.id, partial.crawl.id));
    await context.crawl.completeExecution(
      { ...partialClaim.crawl, executionToken: partialClaim.executionToken },
      { status: "failed", completionReason: "some_pages_failed" },
    );
    await expect(
      context.crawl.loadAuditCrawlSnapshot({
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: partial.crawl.id,
      }),
    ).resolves.toMatchObject({ status: "partially_completed", pages: [] });
  });

  it("rehydrates pending frontier rows after a fenced retry without replaying completed pages", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-resume@example.com");
    const setup = await onboard(context, owner, "resume.example.com");
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const firstClaim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      leaseMs: 60_000,
    });
    if (firstClaim.kind !== "claimed") throw new Error("Expected the first worker claim.");
    const firstExecution = { ...firstClaim.crawl, executionToken: firstClaim.executionToken };
    await context.crawl.transitionStage(firstExecution, "discovering");
    await context.crawl.transitionStage(firstExecution, "crawling");

    const seedUrl = "https://resume.example.com/";
    const childUrl = "https://resume.example.com/child";
    const seedHash = createHash("sha256").update(seedUrl).digest("hex");
    const childHash = createHash("sha256").update(childUrl).digest("hex");
    const seed = await context.crawl.persistDiscoveredUrl(firstExecution, {
      requestedUrl: seedUrl,
      discoveredUrl: seedUrl,
      normalizedUrl: seedUrl,
      urlHash: seedHash,
      origin: "https://resume.example.com",
      hostname: "resume.example.com",
      depth: 0,
      discoverySource: "seed",
      discoveredFromFrontierId: null,
    });
    const child = await context.crawl.persistDiscoveredUrl(firstExecution, {
      requestedUrl: childUrl,
      discoveredUrl: childUrl,
      normalizedUrl: childUrl,
      urlHash: childHash,
      origin: "https://resume.example.com",
      hostname: "resume.example.com",
      depth: 1,
      discoverySource: "link",
      discoveredFromFrontierId: seed.id,
    });
    const completedPage = await context.crawl.persistPageObservation(firstExecution, {
      frontierId: seed.id,
      requestedUrl: seedUrl,
      normalizedUrl: seedUrl,
      finalUrl: seedUrl,
      urlHash: seedHash,
      statusCode: 200,
      contentType: "text/html",
      responseBytes: 64,
      depth: 0,
      redirectChain: [],
      robotsDecision: "not_checked",
      timing: null,
      errorType: null,
      errorMessage: null,
      discoverySource: "seed",
      outcome: "succeeded",
    });
    await context.crawl.persistPageExtraction(firstExecution, {
      pageId: completedPage.pageId,
      source: "raw",
      status: "succeeded",
      title: "Resume test",
      metaDescription: null,
      metaRobots: [],
      xRobotsTag: [],
      directiveScopePreserved: true,
      canonicalUrl: null,
      canonicalTagCount: 0,
      canonicalNormalizationFailure: null,
      visibleText: "Resume test",
      wordCount: 2,
      htmlLanguage: "en",
      characterEncoding: "utf-8",
      openGraph: {},
      socialCards: {},
      contentHash: createHash("sha256").update("Resume test").digest("hex"),
      domHash: createHash("sha256").update("<html>Resume test</html>").digest("hex"),
      similarityFingerprint: "00112233445566778899aabbccddeeff",
      meaningfulContent: true,
      clientRendered: false,
      renderingErrorType: null,
      renderingErrorMessage: null,
      headings: [],
      links: [],
      images: [],
      resources: [],
      structuredData: [],
      extractedAt: new Date(),
    });
    await context.crawl.persistPageArtifact(firstExecution, {
      pageId: completedPage.pageId,
      kind: "raw-html",
      bucket: "searvia-artifacts",
      key: `organizations/${setup.organizationId}/projects/${setup.projectId}/crawls/${created.crawl.id}/pages/${completedPage.pageId}/raw-html.html.gz`,
      objectVersion: null,
      etag: null,
      contentType: "text/html; charset=utf-8",
      contentEncoding: "gzip",
      originalBytes: 24,
      storedBytes: 20,
      contentSha256: createHash("sha256").update("<html>Resume test</html>").digest("hex"),
      storageSha256: createHash("sha256").update("compressed resume test").digest("hex"),
      storedAt: new Date(),
    });
    await context.crawl.markFrontierFetching(firstExecution, child.id);
    await context.crawl.releaseExecutionForRetry(
      firstExecution,
      "crawl_interrupted",
      "The worker stopped before the child was persisted.",
    );

    const secondClaim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      leaseMs: 60_000,
    });
    if (secondClaim.kind !== "claimed") throw new Error("Expected the retry worker claim.");
    const secondExecution = { ...secondClaim.crawl, executionToken: secondClaim.executionToken };
    const resumable = await context.crawl.listResumableFrontier(secondExecution, 100);

    expect(resumable).toEqual([
      {
        countsTowardPageLimit: true,
        depth: 1,
        discoverySource: "link",
        normalizedUrl: childUrl,
        requestedUrl: childUrl,
        urlHash: childHash,
      },
    ]);
    expect(
      await context.database
        .select({ state: crawlFrontier.state })
        .from(crawlFrontier)
        .where(eq(crawlFrontier.id, child.id)),
    ).toEqual([{ state: "discovered" }]);
  });

  it("recovers stale outbox leases and publishes only with the matching claim token", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-outbox@example.com");
    const setup = await onboard(context, owner, "outbox.example.com");
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const now = new Date(Date.now() + 1_000);
    const first = await context.crawl.claimOutboxBatch({
      limit: 10,
      leaseMs: 10_000,
      claimToken: crypto.randomUUID(),
      now,
    });
    expect(first).toHaveLength(1);
    expect(
      await context.crawl.markOutboxPublished(
        first[0]!.id,
        crypto.randomUUID(),
        created.crawl.id,
        now,
      ),
    ).toBe(false);
    expect(
      await context.crawl.claimOutboxBatch({
        limit: 10,
        leaseMs: 10_000,
        now: new Date(now.getTime() + 5_000),
      }),
    ).toHaveLength(0);
    const recovered = await context.crawl.claimOutboxBatch({
      limit: 10,
      leaseMs: 10_000,
      now: new Date(now.getTime() + 11_000),
    });
    expect(recovered).toHaveLength(1);
    await expect(
      context.crawl.markOutboxPublished(
        recovered[0]!.id,
        recovered[0]!.claimToken,
        `crawl-${created.crawl.id}`,
        new Date(now.getTime() + 11_000),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await context.crawl.markOutboxPublished(
        recovered[0]!.id,
        recovered[0]!.claimToken,
        created.crawl.id,
        new Date(now.getTime() + 11_000),
      ),
    ).toBe(true);
    expect(await context.database.select().from(jobOutbox)).toMatchObject([
      { status: "published" },
    ]);
  });

  it("creates and publishes one durable audit intent only for auditable completions", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-audit-outbox@example.com");
    const setup = await onboard(context, owner, "audit-outbox.example.com");
    const completedCrawl = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const publishAt = new Date(Date.now() + 1_000);
    const [executeIntent] = await context.crawl.claimOutboxBatch({
      limit: 10,
      leaseMs: 10_000,
      now: publishAt,
    });
    expect(executeIntent).toMatchObject({
      crawlId: completedCrawl.crawl.id,
      jobType: "crawl.execute",
    });
    await expect(
      context.crawl.markOutboxPublished(
        executeIntent!.id,
        executeIntent!.claimToken,
        completedCrawl.crawl.id,
        publishAt,
      ),
    ).resolves.toBe(true);

    const completedClaim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: completedCrawl.crawl.id,
      leaseMs: 60_000,
    });
    if (completedClaim.kind !== "claimed") throw new Error("Expected a completed crawl claim.");
    const completedExecution = {
      ...completedClaim.crawl,
      executionToken: completedClaim.executionToken,
    };
    const completedAt = new Date(publishAt.getTime() + 100);
    await context.crawl.completeExecution(completedExecution, {
      status: "completed",
      completionReason: "frontier_exhausted",
      now: completedAt,
    });
    await context.crawl.completeExecution(
      { ...completedExecution, executionToken: crypto.randomUUID() },
      {
        status: "failed",
        completionReason: "late_duplicate",
        now: new Date(completedAt.getTime() + 100),
      },
    );

    const completedAuditIntents = await context.database
      .select()
      .from(jobOutbox)
      .where(
        and(
          eq(jobOutbox.crawlId, completedCrawl.crawl.id),
          eq(jobOutbox.jobType, "audit.evaluate"),
        ),
      );
    expect(completedAuditIntents).toHaveLength(1);
    expect(completedAuditIntents[0]).toMatchObject({
      contractVersion: 1,
      idempotencyKey: `audit-${completedCrawl.crawl.id}`,
      payload: {
        contractVersion: 1,
        jobType: "audit.evaluate",
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: completedCrawl.crawl.id,
        traceId: completedCrawl.crawl.traceId,
        idempotencyKey: `audit-${completedCrawl.crawl.id}`,
        crawlStatus: "completed",
        crawlFinishedAt: completedAt.toISOString(),
      },
      status: "pending",
    });

    const [firstAuditClaim] = await context.crawl.claimOutboxBatch({
      limit: 10,
      leaseMs: 10_000,
      now: new Date(completedAt.getTime() + 1_000),
    });
    expect(firstAuditClaim).toMatchObject({
      crawlId: completedCrawl.crawl.id,
      jobType: "audit.evaluate",
    });
    await expect(
      context.crawl.releaseOutboxClaim({
        outboxId: firstAuditClaim!.id,
        claimToken: firstAuditClaim!.claimToken,
        errorMessage: "Audit queue is temporarily unavailable.",
        retryAt: new Date(completedAt.getTime() + 2_000),
        terminal: false,
        now: new Date(completedAt.getTime() + 1_100),
      }),
    ).resolves.toBe(true);
    const [secondAuditClaim] = await context.crawl.claimOutboxBatch({
      limit: 10,
      leaseMs: 10_000,
      now: new Date(completedAt.getTime() + 2_100),
    });
    expect(secondAuditClaim).toMatchObject({ jobType: "audit.evaluate" });
    await expect(
      context.crawl.markOutboxPublished(
        secondAuditClaim!.id,
        secondAuditClaim!.claimToken,
        completedCrawl.crawl.id,
        new Date(completedAt.getTime() + 2_200),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      context.crawl.markOutboxPublished(
        secondAuditClaim!.id,
        secondAuditClaim!.claimToken,
        `audit-${completedCrawl.crawl.id}`,
        new Date(completedAt.getTime() + 2_200),
      ),
    ).resolves.toBe(true);
    expect(
      await context.database
        .select({ queueJobId: crawls.queueJobId })
        .from(crawls)
        .where(eq(crawls.id, completedCrawl.crawl.id)),
    ).toEqual([{ queueJobId: completedCrawl.crawl.id }]);

    const partialCrawl = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "audit-partial-crawl",
    );
    const partialClaim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: partialCrawl.crawl.id,
      leaseMs: 60_000,
    });
    if (partialClaim.kind !== "claimed") throw new Error("Expected a partial crawl claim.");
    await context.database
      .update(crawls)
      .set({ discoveredCount: 1, processedCount: 1, succeededCount: 1 })
      .where(eq(crawls.id, partialCrawl.crawl.id));
    await expect(
      context.crawl.completeExecution(
        { ...partialClaim.crawl, executionToken: partialClaim.executionToken },
        { status: "failed", completionReason: "some_pages_failed" },
      ),
    ).resolves.toMatchObject({ status: "partially_completed" });

    const failedCrawl = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "audit-failed-crawl",
    );
    const failedClaim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: failedCrawl.crawl.id,
      leaseMs: 60_000,
    });
    if (failedClaim.kind !== "claimed") throw new Error("Expected a failed crawl claim.");
    await expect(
      context.crawl.completeExecution(
        { ...failedClaim.crawl, executionToken: failedClaim.executionToken },
        { status: "failed", completionReason: "nothing_fetched" },
      ),
    ).resolves.toMatchObject({ status: "failed" });

    const cancelledCrawl = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "audit-cancelled-crawl",
    );
    const cancelledClaim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: cancelledCrawl.crawl.id,
      leaseMs: 60_000,
    });
    if (cancelledClaim.kind !== "claimed") throw new Error("Expected a cancelled crawl claim.");
    await context.crawl.requestCancellation(
      setup.scope,
      setup.projectId,
      cancelledCrawl.crawl.id,
      crypto.randomUUID(),
    );
    await expect(
      context.crawl.completeExecution(
        { ...cancelledClaim.crawl, executionToken: cancelledClaim.executionToken },
        { status: "completed", completionReason: "frontier_exhausted" },
      ),
    ).resolves.toMatchObject({ status: "cancelled" });

    const auditableCrawlIds = (
      await context.database
        .select({ crawlId: jobOutbox.crawlId })
        .from(jobOutbox)
        .where(eq(jobOutbox.jobType, "audit.evaluate"))
    )
      .map((row) => row.crawlId)
      .sort();
    expect(auditableCrawlIds).toEqual([completedCrawl.crawl.id, partialCrawl.crawl.id].sort());
  });

  it("makes completion terminal and records one durable dead-letter request", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-terminal@example.com");
    const setup = await onboard(context, owner, "terminal.example.com");
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const claim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      leaseMs: 60_000,
    });
    if (claim.kind !== "claimed") throw new Error("Expected a worker claim.");
    const executionContext = { ...claim.crawl, executionToken: claim.executionToken };
    const completed = await context.crawl.completeExecution(executionContext, {
      status: "completed",
      completionReason: "frontier_exhausted",
    });
    expect(completed.status).toBe("completed");
    expect(
      await context.crawl.completeExecution(
        { ...executionContext, executionToken: crypto.randomUUID() },
        {
          status: "failed",
          completionReason: "late_duplicate",
        },
      ),
    ).toMatchObject({ status: "completed" });
    await context.crawl.recordDeadLetter(
      {
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: created.crawl.id,
      },
      { errorType: "late_delivery", errorMessage: "A late failed delivery was reported." },
    );
    expect(
      await context.database
        .select()
        .from(jobOutbox)
        .where(
          and(eq(jobOutbox.crawlId, created.crawl.id), eq(jobOutbox.jobType, "crawl.dead-letter")),
        ),
    ).toHaveLength(0);

    const second = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "terminal-second-key",
    );
    const deadLetterScope = {
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: second.crawl.id,
    };
    await context.crawl.recordDeadLetter(deadLetterScope, {
      errorType: "TRANSIENT_EXHAUSTED",
      errorMessage: "Connection reset",
    });
    await context.crawl.recordDeadLetter(deadLetterScope, {
      errorType: "TRANSIENT_EXHAUSTED",
      errorMessage: "Connection reset",
    });
    const deadLetters = await context.database
      .select()
      .from(jobOutbox)
      .where(
        and(eq(jobOutbox.crawlId, second.crawl.id), eq(jobOutbox.jobType, "crawl.dead-letter")),
      );
    expect(deadLetters).toHaveLength(1);
    expect(
      await context.database
        .select({ value: count() })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, setup.organizationId),
            eq(auditLogs.targetId, second.crawl.id),
            eq(auditLogs.action, "crawl.failed"),
          ),
        ),
    ).toEqual([{ value: 1 }]);
    expect(
      await context.crawl.getCrawl(setup.scope, setup.projectId, second.crawl.id),
    ).toMatchObject({
      status: "failed",
      completionReason: "queue_attempts_exhausted",
    });

    const interrupted = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "terminal-interrupted-key",
    );
    const interruptedClaim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: interrupted.crawl.id,
      leaseMs: 60_000,
    });
    if (interruptedClaim.kind !== "claimed") {
      throw new Error("Expected an interrupted worker claim.");
    }
    await context.database
      .update(crawls)
      .set({ discoveredCount: 1, processedCount: 1, succeededCount: 1 })
      .where(eq(crawls.id, interrupted.crawl.id));
    await expect(
      context.crawl.completeExecution(
        { ...interruptedClaim.crawl, executionToken: interruptedClaim.executionToken },
        {
          status: "failed",
          completionReason: "queue_attempts_exhausted",
          errorType: "crawl_interrupted",
          errorMessage: "Crawl processing was interrupted.",
        },
      ),
    ).resolves.toMatchObject({ status: "partially_completed", succeededCount: 1 });

    const deadLetterPartial = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "terminal-dead-letter-partial-key",
    );
    await context.database
      .update(crawls)
      .set({ discoveredCount: 1, processedCount: 1, succeededCount: 1 })
      .where(eq(crawls.id, deadLetterPartial.crawl.id));
    await context.crawl.recordDeadLetter(
      {
        organizationId: setup.organizationId,
        projectId: setup.projectId,
        crawlId: deadLetterPartial.crawl.id,
      },
      { errorType: "transient_exhausted", errorMessage: "Connection reset" },
    );
    expect(
      await context.database
        .select({ payload: jobOutbox.payload })
        .from(jobOutbox)
        .where(
          and(
            eq(jobOutbox.crawlId, deadLetterPartial.crawl.id),
            eq(jobOutbox.jobType, "audit.evaluate"),
          ),
        ),
    ).toHaveLength(1);
  });

  it("atomically finalizes a claimed failure and creates its typed DLQ intent under the lease fence", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-atomic-dlq@example.com");
    const setup = await onboard(context, owner, "atomic-dlq.example.com");
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const claim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      leaseMs: 60_000,
    });
    if (claim.kind !== "claimed") throw new Error("Expected a worker claim.");
    const execution = { ...claim.crawl, executionToken: claim.executionToken };
    await context.database
      .update(crawls)
      .set({ discoveredCount: 1, processedCount: 1, succeededCount: 1 })
      .where(eq(crawls.id, created.crawl.id));
    const failedAt = new Date("2026-07-15T20:05:00.000Z");

    await expect(
      context.crawl.finalizeExecutionFailure(execution, {
        attemptsMade: 4,
        errorType: "REQUEST_TIMEOUT",
        errorMessage: "The destination timed out.",
        now: failedAt,
      }),
    ).resolves.toBe("partially_completed");
    expect(
      await context.crawl.getCrawl(setup.scope, setup.projectId, created.crawl.id),
    ).toMatchObject({
      status: "partially_completed",
      succeededCount: 1,
      completionReason: "queue_attempts_exhausted",
      errorType: "request_timeout",
    });
    const deadLetters = await context.database
      .select({ payload: jobOutbox.payload })
      .from(jobOutbox)
      .where(
        and(eq(jobOutbox.crawlId, created.crawl.id), eq(jobOutbox.jobType, "crawl.dead-letter")),
      );
    expect(deadLetters).toHaveLength(1);
    expect(crawlDeadLetterJobSchema.parse(deadLetters[0]?.payload)).toMatchObject({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: created.crawl.id,
      finalStatus: "partially_completed",
      attemptsMade: 4,
      errorType: "request_timeout",
      failedAt: failedAt.toISOString(),
    });
    const auditIntents = await context.database
      .select({ payload: jobOutbox.payload })
      .from(jobOutbox)
      .where(and(eq(jobOutbox.crawlId, created.crawl.id), eq(jobOutbox.jobType, "audit.evaluate")));
    expect(auditIntents).toHaveLength(1);
    expect(auditEvaluateJobSchema.parse(auditIntents[0]?.payload)).toMatchObject({
      crawlStatus: "partially_completed",
      crawlFinishedAt: failedAt.toISOString(),
    });
    expect(
      await context.database
        .select({ consumedPages: crawlUsageReservations.consumedPages })
        .from(crawlUsageReservations)
        .where(eq(crawlUsageReservations.crawlId, created.crawl.id)),
    ).toEqual([{ consumedPages: 1 }]);

    const fenced = await createQueuedCrawl(
      context,
      setup.scope,
      setup.projectId,
      "atomic-dlq-fenced-key",
    );
    const fencedClaim = await context.crawl.claimExecution({
      organizationId: setup.organizationId,
      projectId: setup.projectId,
      crawlId: fenced.crawl.id,
      leaseMs: 60_000,
    });
    if (fencedClaim.kind !== "claimed") throw new Error("Expected a fenced worker claim.");
    const fencedExecution = {
      ...fencedClaim.crawl,
      executionToken: fencedClaim.executionToken,
    };
    await expect(
      context.crawl.finalizeExecutionFailure(
        { ...fencedExecution, executionToken: crypto.randomUUID() },
        {
          attemptsMade: 4,
          errorType: "request_timeout",
          errorMessage: "The destination timed out.",
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      context.crawl.finalizeExecutionFailure(
        { ...fencedExecution, organizationId: crypto.randomUUID() },
        {
          attemptsMade: 4,
          errorType: "request_timeout",
          errorMessage: "The destination timed out.",
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await context.database
        .select()
        .from(jobOutbox)
        .where(
          and(eq(jobOutbox.crawlId, fenced.crawl.id), eq(jobOutbox.jobType, "crawl.dead-letter")),
        ),
    ).toHaveLength(0);
    expect(
      await context.crawl.getCrawl(setup.scope, setup.projectId, fenced.crawl.id),
    ).toMatchObject({ status: "validating" });
  });

  it("fails a queued crawl when durable queue publication is exhausted", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner-publish-failure@example.com");
    const setup = await onboard(context, owner, "publish-failure.example.com");
    const created = await createQueuedCrawl(context, setup.scope, setup.projectId);
    const claimed = await context.crawl.claimOutboxBatch({
      limit: 1,
      leaseMs: 10_000,
      claimToken: crypto.randomUUID(),
    });
    expect(claimed).toHaveLength(1);

    expect(
      await context.crawl.releaseOutboxClaim({
        outboxId: claimed[0]!.id,
        claimToken: claimed[0]!.claimToken,
        errorMessage: "The queue was unavailable.",
        retryAt: new Date(),
        terminal: true,
      }),
    ).toBe(true);
    expect(
      await context.crawl.getCrawl(setup.scope, setup.projectId, created.crawl.id),
    ).toMatchObject({
      status: "failed",
      completionReason: "queue_publish_exhausted",
      errorType: "queue_publish_exhausted",
    });
    expect(
      await context.database
        .select()
        .from(crawlUsageReservations)
        .where(eq(crawlUsageReservations.crawlId, created.crawl.id)),
    ).toMatchObject([{ status: "released", consumedPages: 0 }]);
  });
});
