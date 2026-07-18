import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { normalizeProjectOrigin } from "@searvia/shared-types";
import { count, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";

import type { SearviaDatabase } from "./client.js";
import { DatabaseDomainError } from "./domain-errors.js";
import { createSearviaRepository, type CrawlConfigInput } from "./repository.js";
import {
  auditLogs,
  crawlConfigs,
  invitations,
  memberships,
  searviaSchema,
  sessions,
  users,
} from "./schema.js";
import { generateInvitationToken } from "./security-tokens.js";

const migrationsFolder = fileURLToPath(new URL("../migrations/", import.meta.url));
const clients: PGlite[] = [];

interface Identity {
  readonly userId: string;
  readonly sessionId: string;
  readonly email: string;
}

interface TestContext {
  readonly client: PGlite;
  readonly database: PgliteDatabase<typeof searviaSchema>;
  readonly repository: ReturnType<typeof createSearviaRepository>;
}

const DEFAULT_CRAWL_CONFIG: CrawlConfigInput = {
  pageLimit: 50,
  maxDepth: 4,
  includeSubdomains: false,
  queryPolicy: "ignore_tracking",
};

async function createContext(): Promise<TestContext> {
  const client = new PGlite();
  clients.push(client);
  const database = drizzle(client, { schema: searviaSchema });
  await migrate(database, { migrationsFolder });

  return {
    client,
    database,
    repository: createSearviaRepository(database as unknown as SearviaDatabase),
  };
}

async function createIdentity(
  database: PgliteDatabase<typeof searviaSchema>,
  email: string,
  name = "Test user",
): Promise<Identity> {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await database.insert(users).values({ id: userId, name, email });
  await database.insert(sessions).values({
    id: sessionId,
    userId,
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return { userId, sessionId, email };
}

async function onboard(
  context: TestContext,
  identity: Identity,
  website: string,
  organizationName = "Test organization",
) {
  return context.repository.createOnboarding({
    userId: identity.userId,
    sessionId: identity.sessionId,
    organizationName,
    name: new URL(normalizeProjectOrigin(website).origin).hostname,
    target: normalizeProjectOrigin(website),
    crawlConfig: DEFAULT_CRAWL_CONFIG,
    traceId: crypto.randomUUID(),
  });
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("Searvia tenant repository", () => {
  it("persists onboarding as one organization, owner, project, crawl config, and audits", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner@example.com", "Owner");
    const result = await onboard(context, owner, "https://www.example.com/path", "Example team");
    const scope = await context.repository.loadActiveOrganizationScope(
      owner.userId,
      owner.sessionId,
    );

    expect(scope).not.toBeNull();
    expect(scope?.membership.role).toBe("owner");
    expect(scope?.organization.id).toBe(result.organizationId);

    const storedProjects = await context.repository.listProjects(scope!);
    expect(storedProjects).toHaveLength(1);
    expect(storedProjects[0]).toMatchObject({
      id: result.projectId,
      normalizedOrigin: "https://www.example.com",
      verificationStatus: "unverified",
      crawlConfig: {
        pageLimit: 50,
        maxDepth: 4,
        includeSubdomains: false,
        respectRobots: true,
      },
    });

    const [auditCount] = await context.database
      .select({ value: count() })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, result.organizationId));
    expect(auditCount?.value).toBe(2);
  });

  it("returns not found for cross-tenant project IDs", async () => {
    const context = await createContext();
    const first = await createIdentity(context.database, "first@example.com");
    const second = await createIdentity(context.database, "second@example.com");
    await onboard(context, first, "first.example.com", "First org");
    const secondResult = await onboard(context, second, "second.example.com", "Second org");
    const firstScope = await context.repository.loadActiveOrganizationScope(
      first.userId,
      first.sessionId,
    );

    expect(await context.repository.getProject(firstScope!, secondResult.projectId)).toBeNull();
  });

  it("allows the same normalized origin in different organizations but rejects a duplicate tenant project", async () => {
    const context = await createContext();
    const first = await createIdentity(context.database, "first@example.com");
    const second = await createIdentity(context.database, "second@example.com");
    await onboard(context, first, "shared.example.com", "First org");
    await onboard(context, second, "shared.example.com", "Second org");
    const firstScope = await context.repository.loadActiveOrganizationScope(
      first.userId,
      first.sessionId,
    );

    await expect(
      context.repository.createProject(firstScope!, {
        name: "Duplicate",
        target: normalizeProjectOrigin("https://shared.example.com/path"),
        crawlConfig: DEFAULT_CRAWL_CONFIG,
        traceId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("limits Client members to explicitly assigned projects", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner@example.com");
    const client = await createIdentity(context.database, "client@example.com");
    const onboarding = await onboard(context, owner, "assigned.example.com");
    const ownerScope = await context.repository.loadActiveOrganizationScope(
      owner.userId,
      owner.sessionId,
    );
    const unassigned = await context.repository.createProject(ownerScope!, {
      name: "Unassigned",
      target: normalizeProjectOrigin("unassigned.example.com"),
      crawlConfig: DEFAULT_CRAWL_CONFIG,
      traceId: crypto.randomUUID(),
    });
    const token = generateInvitationToken();

    await context.repository.createInvitation(ownerScope!, {
      email: client.email,
      role: "client",
      projectId: onboarding.projectId,
      tokenHash: token.tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
      traceId: crypto.randomUUID(),
    });
    await context.repository.acceptInvitation({
      userId: client.userId,
      sessionId: client.sessionId,
      tokenHash: token.tokenHash,
      traceId: crypto.randomUUID(),
    });

    const clientScope = await context.repository.loadActiveOrganizationScope(
      client.userId,
      client.sessionId,
    );
    const visibleProjects = await context.repository.listProjects(clientScope!);

    expect(clientScope?.membership.role).toBe("client");
    expect(visibleProjects.map((project) => project.id)).toEqual([onboarding.projectId]);
    expect(await context.repository.getProject(clientScope!, unassigned.id)).toBeNull();
    await expect(
      context.repository.createProject(clientScope!, {
        name: "Denied",
        target: normalizeProjectOrigin("denied.example.com"),
        crawlConfig: DEFAULT_CRAWL_CONFIG,
        traceId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows Analysts to create projects but denies team access", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner@example.com");
    const analyst = await createIdentity(context.database, "analyst@example.com");
    await onboard(context, owner, "owner.example.com");
    const ownerScope = await context.repository.loadActiveOrganizationScope(
      owner.userId,
      owner.sessionId,
    );
    const token = generateInvitationToken();
    await context.repository.createInvitation(ownerScope!, {
      email: analyst.email,
      role: "analyst",
      projectId: null,
      tokenHash: token.tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
      traceId: crypto.randomUUID(),
    });
    await context.repository.acceptInvitation({
      userId: analyst.userId,
      sessionId: analyst.sessionId,
      tokenHash: token.tokenHash,
      traceId: crypto.randomUUID(),
    });
    const analystScope = await context.repository.loadActiveOrganizationScope(
      analyst.userId,
      analyst.sessionId,
    );

    const created = await context.repository.createProject(analystScope!, {
      name: "Analyst project",
      target: normalizeProjectOrigin("analyst.example.com"),
      crawlConfig: DEFAULT_CRAWL_CONFIG,
      traceId: crypto.randomUUID(),
    });

    expect(created.name).toBe("Analyst project");
    await expect(context.repository.listTeam(analystScope!)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("stores invitation hashes, rejects wrong recipients, and prevents reuse", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner@example.com");
    const invitee = await createIdentity(context.database, "invitee@example.com");
    const unrelated = await createIdentity(context.database, "unrelated@example.com");
    await onboard(context, owner, "owner.example.com");
    const ownerScope = await context.repository.loadActiveOrganizationScope(
      owner.userId,
      owner.sessionId,
    );
    const token = generateInvitationToken();
    const invitationId = await context.repository.createInvitation(ownerScope!, {
      email: invitee.email,
      role: "viewer",
      projectId: null,
      tokenHash: token.tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
      traceId: crypto.randomUUID(),
    });
    const [stored] = await context.database
      .select({ tokenHash: invitations.tokenHash })
      .from(invitations)
      .where(eq(invitations.id, invitationId));

    expect(stored?.tokenHash).toBe(token.tokenHash);
    expect(stored?.tokenHash).not.toBe(token.rawToken);
    await expect(
      context.repository.acceptInvitation({
        userId: unrelated.userId,
        sessionId: unrelated.sessionId,
        tokenHash: token.tokenHash,
        traceId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "INVITATION_INVALID" });

    await context.repository.acceptInvitation({
      userId: invitee.userId,
      sessionId: invitee.sessionId,
      tokenHash: token.tokenHash,
      traceId: crypto.randomUUID(),
    });
    await expect(
      context.repository.acceptInvitation({
        userId: invitee.userId,
        sessionId: invitee.sessionId,
        tokenHash: token.tokenHash,
        traceId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejects expired and revoked invitations with the same stable code", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner@example.com");
    const invitee = await createIdentity(context.database, "invitee@example.com");
    await onboard(context, owner, "owner.example.com");
    const ownerScope = await context.repository.loadActiveOrganizationScope(
      owner.userId,
      owner.sessionId,
    );
    const expired = generateInvitationToken();
    await context.repository.createInvitation(ownerScope!, {
      email: invitee.email,
      role: "viewer",
      projectId: null,
      tokenHash: expired.tokenHash,
      expiresAt: new Date(Date.now() - 1_000),
      traceId: crypto.randomUUID(),
    });
    await expect(
      context.repository.acceptInvitation({
        userId: invitee.userId,
        sessionId: invitee.sessionId,
        tokenHash: expired.tokenHash,
        traceId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "INVITATION_INVALID" });

    const active = generateInvitationToken();
    const invitationId = await context.repository.createInvitation(ownerScope!, {
      email: invitee.email,
      role: "viewer",
      projectId: null,
      tokenHash: active.tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
      traceId: crypto.randomUUID(),
    });
    await context.repository.revokeInvitation(ownerScope!, invitationId, crypto.randomUUID());
    await expect(
      context.repository.acceptInvitation({
        userId: invitee.userId,
        sessionId: invitee.sessionId,
        tokenHash: active.tokenHash,
        traceId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("transfers the single owner role atomically and audits the change", async () => {
    const context = await createContext();
    const owner = await createIdentity(context.database, "owner@example.com");
    const admin = await createIdentity(context.database, "admin@example.com");
    const onboarding = await onboard(context, owner, "owner.example.com");
    const ownerScope = await context.repository.loadActiveOrganizationScope(
      owner.userId,
      owner.sessionId,
    );
    const token = generateInvitationToken();
    await context.repository.createInvitation(ownerScope!, {
      email: admin.email,
      role: "admin",
      projectId: null,
      tokenHash: token.tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
      traceId: crypto.randomUUID(),
    });
    await context.repository.acceptInvitation({
      userId: admin.userId,
      sessionId: admin.sessionId,
      tokenHash: token.tokenHash,
      traceId: crypto.randomUUID(),
    });
    const adminScope = await context.repository.loadActiveOrganizationScope(
      admin.userId,
      admin.sessionId,
    );

    await context.repository.transferOwnership(
      ownerScope!,
      adminScope!.membership.id,
      crypto.randomUUID(),
    );

    const roles = await context.database
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.organizationId, onboarding.organizationId));
    expect(roles).toEqual(
      expect.arrayContaining([
        { userId: owner.userId, role: "admin" },
        { userId: admin.userId, role: "owner" },
      ]),
    );
    expect(roles.filter((row) => row.role === "owner")).toHaveLength(1);
  });

  it("uses a durable fixed-window limiter for sensitive custom actions", async () => {
    const context = await createContext();
    const key = "repository-test-rate-limit";
    const startedAt = new Date("2026-07-15T00:00:00.000Z");

    expect(
      await context.repository.consumeRateLimit({ key, max: 2, windowMs: 60_000, now: startedAt }),
    ).toMatchObject({ allowed: true, remaining: 1 });
    expect(
      await context.repository.consumeRateLimit({
        key,
        max: 2,
        windowMs: 60_000,
        now: new Date(startedAt.getTime() + 1_000),
      }),
    ).toMatchObject({ allowed: true, remaining: 0 });
    expect(
      await context.repository.consumeRateLimit({
        key,
        max: 2,
        windowMs: 60_000,
        now: new Date(startedAt.getTime() + 2_000),
      }),
    ).toMatchObject({ allowed: false, retryAfterSeconds: 58 });
    expect(
      await context.repository.consumeRateLimit({
        key,
        max: 2,
        windowMs: 60_000,
        now: new Date(startedAt.getTime() + 61_000),
      }),
    ).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("rejects stale sessions before resolving a protected organization scope", async () => {
    const context = await createContext();
    const identity = await createIdentity(context.database, "owner@example.com");
    await onboard(context, identity, "owner.example.com");
    await context.database
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(sessions.id, identity.sessionId));

    await expect(
      context.repository.loadActiveOrganizationScope(identity.userId, identity.sessionId),
    ).rejects.toBeInstanceOf(DatabaseDomainError);
  });

  it("updates crawl settings with optimistic concurrency", async () => {
    const context = await createContext();
    const identity = await createIdentity(context.database, "owner@example.com");
    const onboarding = await onboard(context, identity, "owner.example.com");
    const scope = await context.repository.loadActiveOrganizationScope(
      identity.userId,
      identity.sessionId,
    );

    await context.repository.updateCrawlConfig(scope!, onboarding.projectId, 1, {
      pageLimit: 25,
      maxDepth: 2,
      includeSubdomains: true,
      queryPolicy: "keep",
      traceId: crypto.randomUUID(),
    });
    await expect(
      context.repository.updateCrawlConfig(scope!, onboarding.projectId, 1, {
        pageLimit: 20,
        maxDepth: 1,
        includeSubdomains: false,
        queryPolicy: "ignore_all",
        traceId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const [stored] = await context.database
      .select({ version: crawlConfigs.version, pageLimit: crawlConfigs.pageLimit })
      .from(crawlConfigs)
      .where(eq(crawlConfigs.projectId, onboarding.projectId));
    expect(stored).toEqual({ version: 2, pageLimit: 25 });
  });
});
