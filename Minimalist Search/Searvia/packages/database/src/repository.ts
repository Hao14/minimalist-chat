import { randomUUID } from "node:crypto";

import {
  canManageRole,
  roleHasCapability,
  type NormalizedProjectOrigin,
  type OrganizationCapability,
  type OrganizationRole,
} from "@searvia/shared-types";
import { and, asc, desc, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";

import type { SearviaDatabase } from "./client.js";
import { DatabaseDomainError } from "./domain-errors.js";
import {
  auditLogs,
  authRateLimits,
  crawlConfigs,
  invitations,
  membershipProjectScopes,
  memberships,
  organizations,
  projects,
  sessions,
  users,
} from "./schema.js";

const organizationScopeBrand: unique symbol = Symbol("searvia.organization-scope");

export interface OrganizationScope {
  readonly [organizationScopeBrand]: true;
  readonly userId: string;
  readonly sessionId: string;
  readonly organization: Readonly<{
    id: string;
    name: string;
    slug: string;
  }>;
  readonly membership: Readonly<{
    id: string;
    role: OrganizationRole;
  }>;
}

export interface CrawlConfigInput {
  readonly pageLimit: number;
  readonly maxDepth: number;
  readonly includeSubdomains: boolean;
  readonly queryPolicy: "keep" | "ignore_tracking" | "ignore_all";
  readonly requestDelayMs?: number;
  readonly concurrency?: number;
  readonly includePatterns?: readonly string[];
  readonly excludePatterns?: readonly string[];
  readonly renderingEnabled?: boolean;
  readonly submittedSitemapUrls?: readonly string[];
}

export interface ProjectInput {
  readonly name: string;
  readonly target: NormalizedProjectOrigin;
  readonly crawlConfig: CrawlConfigInput;
}

export interface OnboardingInput extends ProjectInput {
  readonly organizationName: string;
  readonly traceId: string;
  readonly userId: string;
  readonly sessionId: string;
}

export interface OnboardingResult {
  readonly organizationId: string;
  readonly membershipId: string;
  readonly projectId: string;
}

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly normalizedOrigin: string;
  readonly normalizedHostname: string;
  readonly protocol: string;
  readonly port: string | null;
  readonly locale: string;
  readonly timeZone: string;
  readonly verificationStatus: "unverified" | "pending" | "verified" | "failed";
  readonly createdAt: Date;
  readonly crawlConfig: Readonly<{
    version: number;
    pageLimit: number;
    maxDepth: number;
    includeSubdomains: boolean;
    respectRobots: boolean;
    requestDelayMs: number;
    concurrency: number;
    includePatterns: readonly string[];
    excludePatterns: readonly string[];
    queryPolicy: "keep" | "ignore_tracking" | "ignore_all";
    userAgent: string;
    redirectLimit: number;
    maxResponseBytes: number;
    requestTimeoutMs: number;
    totalTimeoutMs: number;
    supportedContentTypes: readonly string[];
    renderingEnabled: boolean;
    submittedSitemapUrls: readonly string[];
  }>;
}

export interface OrganizationChoice {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: OrganizationRole;
}

export interface TeamMemberRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly status: "active" | "suspended" | "revoked";
  readonly joinedAt: Date;
  readonly projectIds: readonly string[];
}

export interface InvitationRecord {
  readonly id: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly projectId: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface InvitationPreview {
  readonly organizationName: string;
  readonly projectName: string | null;
  readonly role: OrganizationRole;
  readonly expiresAt: Date;
}

export interface CreateInvitationInput {
  readonly email: string;
  readonly role: Exclude<OrganizationRole, "owner">;
  readonly projectId: string | null;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly traceId: string;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

type Transaction = Parameters<Parameters<SearviaDatabase["transaction"]>[0]>[0];

function assertCapability(role: OrganizationRole, capability: OrganizationCapability): void {
  if (!roleHasCapability(role, capability)) {
    throw new DatabaseDomainError("FORBIDDEN", "You do not have permission for this action.");
  }
}

function normalizeName(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized === "" ? fallback : normalized;
}

function assertCrawlConfigInput(input: CrawlConfigInput): void {
  const patterns = [...(input.includePatterns ?? []), ...(input.excludePatterns ?? [])];
  const sitemapUrls = input.submittedSitemapUrls ?? [];
  const validSitemapUrls = sitemapUrls.every((value) => {
    if (value.length < 8 || value.length > 4096 || /\p{Cc}/u.test(value)) return false;
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.hostname.length > 0 &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.hash === ""
      );
    } catch {
      return false;
    }
  });
  const valid =
    Number.isInteger(input.pageLimit) &&
    input.pageLimit >= 1 &&
    input.pageLimit <= 100 &&
    Number.isInteger(input.maxDepth) &&
    input.maxDepth >= 0 &&
    input.maxDepth <= 10 &&
    (input.requestDelayMs === undefined ||
      (Number.isInteger(input.requestDelayMs) &&
        input.requestDelayMs >= 250 &&
        input.requestDelayMs <= 60_000)) &&
    (input.concurrency === undefined ||
      (Number.isInteger(input.concurrency) && input.concurrency >= 1 && input.concurrency <= 4)) &&
    (input.includePatterns?.length ?? 0) <= 50 &&
    (input.excludePatterns?.length ?? 0) <= 50 &&
    (input.renderingEnabled === undefined || typeof input.renderingEnabled === "boolean") &&
    sitemapUrls.length <= 20 &&
    validSitemapUrls &&
    patterns.every(
      (pattern) => pattern.length >= 1 && pattern.length <= 256 && !/\p{Cc}/u.test(pattern),
    );

  if (!valid) {
    throw new DatabaseDomainError("CONFLICT", "The crawl settings are outside allowed limits.");
  }
}

function slugify(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z\d]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60);

  return `${base.length >= 2 ? base : "workspace"}-${randomUUID().slice(0, 8)}`;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }

    if ("code" in current && (current as { readonly code?: unknown }).code === "23505") {
      return true;
    }

    current = "cause" in current ? (current as { readonly cause?: unknown }).cause : undefined;
  }

  return false;
}

async function requireFreshActor(
  transaction: Transaction,
  scope: OrganizationScope,
  capability: OrganizationCapability,
): Promise<OrganizationRole> {
  const [actor] = await transaction
    .select({ role: memberships.role })
    .from(memberships)
    .innerJoin(
      organizations,
      and(eq(organizations.id, memberships.organizationId), isNull(organizations.deletedAt)),
    )
    .where(
      and(
        eq(memberships.id, scope.membership.id),
        eq(memberships.organizationId, scope.organization.id),
        eq(memberships.userId, scope.userId),
        eq(memberships.status, "active"),
      ),
    )
    .limit(1);

  if (actor === undefined) {
    throw new DatabaseDomainError("FORBIDDEN", "Your organization access is no longer active.");
  }

  assertCapability(actor.role, capability);
  return actor.role;
}

async function writeAudit(
  transaction: Transaction,
  actor: Readonly<{
    organizationId: string;
    membershipId: string;
    userId: string;
  }>,
  event: Readonly<{
    action: string;
    targetType: string;
    targetId: string | null;
    traceId: string;
    metadata?: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
  await transaction.insert(auditLogs).values({
    organizationId: actor.organizationId,
    actorKind: "user",
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    traceId: event.traceId,
    metadata: event.metadata ?? {},
  });
}

function mapProjectRow(row: {
  project: typeof projects.$inferSelect;
  crawlConfig: typeof crawlConfigs.$inferSelect;
}): ProjectRecord {
  return Object.freeze({
    id: row.project.id,
    name: row.project.name,
    normalizedOrigin: row.project.normalizedOrigin,
    normalizedHostname: row.project.normalizedHostname,
    protocol: row.project.protocol,
    port: row.project.port,
    locale: row.project.locale,
    timeZone: row.project.timeZone,
    verificationStatus: row.project.verificationStatus,
    createdAt: row.project.createdAt,
    crawlConfig: Object.freeze({
      version: row.crawlConfig.version,
      pageLimit: row.crawlConfig.pageLimit,
      maxDepth: row.crawlConfig.maxDepth,
      includeSubdomains: row.crawlConfig.includeSubdomains,
      respectRobots: row.crawlConfig.respectRobots,
      requestDelayMs: row.crawlConfig.requestDelayMs,
      concurrency: row.crawlConfig.concurrency,
      includePatterns: Object.freeze([...row.crawlConfig.includePatterns]),
      excludePatterns: Object.freeze([...row.crawlConfig.excludePatterns]),
      queryPolicy: row.crawlConfig.queryPolicy,
      userAgent: row.crawlConfig.userAgent,
      redirectLimit: row.crawlConfig.redirectLimit,
      maxResponseBytes: row.crawlConfig.maxResponseBytes,
      requestTimeoutMs: row.crawlConfig.requestTimeoutMs,
      totalTimeoutMs: row.crawlConfig.totalTimeoutMs,
      supportedContentTypes: Object.freeze([...row.crawlConfig.supportedContentTypes]),
      renderingEnabled: row.crawlConfig.renderingEnabled,
      submittedSitemapUrls: Object.freeze([...row.crawlConfig.submittedSitemapUrls]),
    }),
  });
}

export class SearviaRepository {
  readonly #db: SearviaDatabase;

  constructor(database: SearviaDatabase) {
    this.#db = database;
  }

  async loadActiveOrganizationScope(
    userId: string,
    sessionId: string,
  ): Promise<OrganizationScope | null> {
    const now = new Date();
    const [session] = await this.#db
      .select({ activeOrganizationId: sessions.activeOrganizationId })
      .from(sessions)
      .where(
        and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, now)),
      )
      .limit(1);

    if (session === undefined) {
      throw new DatabaseDomainError("UNAUTHENTICATED", "Your session is no longer active.");
    }

    const membershipProjection = {
      membershipId: memberships.id,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      role: memberships.role,
    };

    const preferred =
      session.activeOrganizationId === null
        ? undefined
        : await this.#db
            .select(membershipProjection)
            .from(memberships)
            .innerJoin(
              organizations,
              and(
                eq(organizations.id, memberships.organizationId),
                isNull(organizations.deletedAt),
              ),
            )
            .where(
              and(
                eq(memberships.userId, userId),
                eq(memberships.organizationId, session.activeOrganizationId),
                eq(memberships.status, "active"),
              ),
            )
            .limit(1)
            .then((rows) => rows[0]);

    const selected =
      preferred ??
      (await this.#db
        .select(membershipProjection)
        .from(memberships)
        .innerJoin(
          organizations,
          and(eq(organizations.id, memberships.organizationId), isNull(organizations.deletedAt)),
        )
        .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
        .orderBy(asc(memberships.createdAt), asc(memberships.id))
        .limit(1)
        .then((rows) => rows[0]));

    if (selected === undefined) {
      return null;
    }

    if (session.activeOrganizationId !== selected.organizationId) {
      await this.#db
        .update(sessions)
        .set({ activeOrganizationId: selected.organizationId, updatedAt: now })
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
    }

    return Object.freeze({
      [organizationScopeBrand]: true as const,
      userId,
      sessionId,
      organization: Object.freeze({
        id: selected.organizationId,
        name: selected.organizationName,
        slug: selected.organizationSlug,
      }),
      membership: Object.freeze({ id: selected.membershipId, role: selected.role }),
    });
  }

  async listOrganizationsForUser(userId: string): Promise<readonly OrganizationChoice[]> {
    return this.#db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        and(eq(organizations.id, memberships.organizationId), isNull(organizations.deletedAt)),
      )
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(asc(organizations.name), asc(organizations.id));
  }

  async switchActiveOrganization(
    userId: string,
    sessionId: string,
    organizationId: string,
  ): Promise<void> {
    const now = new Date();
    const [membership] = await this.#db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(
        organizations,
        and(eq(organizations.id, memberships.organizationId), isNull(organizations.deletedAt)),
      )
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);

    if (membership === undefined) {
      throw new DatabaseDomainError("NOT_FOUND", "Organization not found.");
    }

    const updated = await this.#db
      .update(sessions)
      .set({ activeOrganizationId: organizationId, updatedAt: now })
      .where(
        and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, now)),
      )
      .returning({ id: sessions.id });

    if (updated.length === 0) {
      throw new DatabaseDomainError("UNAUTHENTICATED", "Your session is no longer active.");
    }
  }

  async createOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
    assertCrawlConfigInput(input.crawlConfig);
    const now = new Date();
    const organizationName = normalizeName(input.organizationName, "My organization");
    const projectName = normalizeName(input.name, input.target.hostname);

    try {
      return await this.#db.transaction(async (transaction) => {
        const [session] = await transaction
          .select({ id: sessions.id })
          .from(sessions)
          .where(
            and(
              eq(sessions.id, input.sessionId),
              eq(sessions.userId, input.userId),
              gt(sessions.expiresAt, now),
            ),
          )
          .limit(1)
          .for("update");

        if (session === undefined) {
          throw new DatabaseDomainError("UNAUTHENTICATED", "Your session is no longer active.");
        }

        const [existingMembership] = await transaction
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.userId, input.userId), eq(memberships.status, "active")))
          .limit(1);

        if (existingMembership !== undefined) {
          throw new DatabaseDomainError("CONFLICT", "Onboarding has already been completed.");
        }

        const [organization] = await transaction
          .insert(organizations)
          .values({
            name: organizationName,
            slug: slugify(organizationName),
            createdByUserId: input.userId,
            onboardingCompletedAt: now,
          })
          .returning({ id: organizations.id });

        if (organization === undefined) {
          throw new Error("Organization insert returned no row.");
        }

        const [membership] = await transaction
          .insert(memberships)
          .values({
            organizationId: organization.id,
            userId: input.userId,
            role: "owner",
            status: "active",
          })
          .returning({ id: memberships.id });

        if (membership === undefined) {
          throw new Error("Membership insert returned no row.");
        }

        const [project] = await transaction
          .insert(projects)
          .values({
            organizationId: organization.id,
            name: projectName,
            normalizedOrigin: input.target.origin,
            normalizedHostname: input.target.hostname,
            protocol: input.target.protocol,
            port: input.target.port,
            createdByMembershipId: membership.id,
          })
          .returning({ id: projects.id });

        if (project === undefined) {
          throw new Error("Project insert returned no row.");
        }

        await transaction.insert(crawlConfigs).values({
          organizationId: organization.id,
          projectId: project.id,
          pageLimit: input.crawlConfig.pageLimit,
          maxDepth: input.crawlConfig.maxDepth,
          includeSubdomains: input.crawlConfig.includeSubdomains,
          queryPolicy: input.crawlConfig.queryPolicy,
          ...(input.crawlConfig.requestDelayMs === undefined
            ? {}
            : { requestDelayMs: input.crawlConfig.requestDelayMs }),
          ...(input.crawlConfig.concurrency === undefined
            ? {}
            : { concurrency: input.crawlConfig.concurrency }),
          ...(input.crawlConfig.includePatterns === undefined
            ? {}
            : { includePatterns: [...input.crawlConfig.includePatterns] }),
          ...(input.crawlConfig.excludePatterns === undefined
            ? {}
            : { excludePatterns: [...input.crawlConfig.excludePatterns] }),
          ...(input.crawlConfig.renderingEnabled === undefined
            ? {}
            : { renderingEnabled: input.crawlConfig.renderingEnabled }),
          ...(input.crawlConfig.submittedSitemapUrls === undefined
            ? {}
            : { submittedSitemapUrls: [...input.crawlConfig.submittedSitemapUrls] }),
          createdByMembershipId: membership.id,
          updatedByMembershipId: membership.id,
        });

        await transaction
          .update(sessions)
          .set({ activeOrganizationId: organization.id, updatedAt: now })
          .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)));

        const auditActor = {
          organizationId: organization.id,
          membershipId: membership.id,
          userId: input.userId,
        };

        await writeAudit(transaction, auditActor, {
          action: "organization.created",
          targetType: "organization",
          targetId: organization.id,
          traceId: input.traceId,
        });
        await writeAudit(transaction, auditActor, {
          action: "project.created",
          targetType: "project",
          targetId: project.id,
          traceId: input.traceId,
          metadata: { onboarding: true },
        });

        return {
          organizationId: organization.id,
          membershipId: membership.id,
          projectId: project.id,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DatabaseDomainError("CONFLICT", "That organization or project already exists.");
      }
      throw error;
    }
  }

  async createProject(
    scope: OrganizationScope,
    input: ProjectInput & Readonly<{ traceId: string }>,
  ): Promise<ProjectRecord> {
    assertCrawlConfigInput(input.crawlConfig);
    const projectName = normalizeName(input.name, input.target.hostname);

    try {
      const projectId = await this.#db.transaction(async (transaction) => {
        await requireFreshActor(transaction, scope, "project:create");

        const [project] = await transaction
          .insert(projects)
          .values({
            organizationId: scope.organization.id,
            name: projectName,
            normalizedOrigin: input.target.origin,
            normalizedHostname: input.target.hostname,
            protocol: input.target.protocol,
            port: input.target.port,
            createdByMembershipId: scope.membership.id,
          })
          .returning({ id: projects.id });

        if (project === undefined) {
          throw new Error("Project insert returned no row.");
        }

        await transaction.insert(crawlConfigs).values({
          organizationId: scope.organization.id,
          projectId: project.id,
          pageLimit: input.crawlConfig.pageLimit,
          maxDepth: input.crawlConfig.maxDepth,
          includeSubdomains: input.crawlConfig.includeSubdomains,
          queryPolicy: input.crawlConfig.queryPolicy,
          ...(input.crawlConfig.requestDelayMs === undefined
            ? {}
            : { requestDelayMs: input.crawlConfig.requestDelayMs }),
          ...(input.crawlConfig.concurrency === undefined
            ? {}
            : { concurrency: input.crawlConfig.concurrency }),
          ...(input.crawlConfig.includePatterns === undefined
            ? {}
            : { includePatterns: [...input.crawlConfig.includePatterns] }),
          ...(input.crawlConfig.excludePatterns === undefined
            ? {}
            : { excludePatterns: [...input.crawlConfig.excludePatterns] }),
          ...(input.crawlConfig.renderingEnabled === undefined
            ? {}
            : { renderingEnabled: input.crawlConfig.renderingEnabled }),
          ...(input.crawlConfig.submittedSitemapUrls === undefined
            ? {}
            : { submittedSitemapUrls: [...input.crawlConfig.submittedSitemapUrls] }),
          createdByMembershipId: scope.membership.id,
          updatedByMembershipId: scope.membership.id,
        });

        await writeAudit(
          transaction,
          {
            organizationId: scope.organization.id,
            membershipId: scope.membership.id,
            userId: scope.userId,
          },
          {
            action: "project.created",
            targetType: "project",
            targetId: project.id,
            traceId: input.traceId,
          },
        );

        return project.id;
      });

      const created = await this.getProject(scope, projectId);
      if (created === null) {
        throw new Error("Created project could not be reloaded.");
      }
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DatabaseDomainError(
          "CONFLICT",
          "A project for this website already exists in the organization.",
        );
      }
      throw error;
    }
  }

  async listProjects(scope: OrganizationScope): Promise<readonly ProjectRecord[]> {
    assertCapability(scope.membership.role, "project:list");

    const projection = { project: projects, crawlConfig: crawlConfigs };
    const rows =
      scope.membership.role === "client"
        ? await this.#db
            .select(projection)
            .from(projects)
            .innerJoin(
              membershipProjectScopes,
              and(
                eq(membershipProjectScopes.organizationId, projects.organizationId),
                eq(membershipProjectScopes.projectId, projects.id),
                eq(membershipProjectScopes.membershipId, scope.membership.id),
              ),
            )
            .innerJoin(
              crawlConfigs,
              and(
                eq(crawlConfigs.organizationId, projects.organizationId),
                eq(crawlConfigs.projectId, projects.id),
              ),
            )
            .where(
              and(eq(projects.organizationId, scope.organization.id), isNull(projects.deletedAt)),
            )
            .orderBy(desc(projects.createdAt), desc(projects.id))
        : await this.#db
            .select(projection)
            .from(projects)
            .innerJoin(
              crawlConfigs,
              and(
                eq(crawlConfigs.organizationId, projects.organizationId),
                eq(crawlConfigs.projectId, projects.id),
              ),
            )
            .where(
              and(eq(projects.organizationId, scope.organization.id), isNull(projects.deletedAt)),
            )
            .orderBy(desc(projects.createdAt), desc(projects.id));

    return rows.map(mapProjectRow);
  }

  async getProject(scope: OrganizationScope, projectId: string): Promise<ProjectRecord | null> {
    assertCapability(scope.membership.role, "project:read");

    const projection = { project: projects, crawlConfig: crawlConfigs };
    const rows =
      scope.membership.role === "client"
        ? await this.#db
            .select(projection)
            .from(projects)
            .innerJoin(
              membershipProjectScopes,
              and(
                eq(membershipProjectScopes.organizationId, projects.organizationId),
                eq(membershipProjectScopes.projectId, projects.id),
                eq(membershipProjectScopes.membershipId, scope.membership.id),
              ),
            )
            .innerJoin(
              crawlConfigs,
              and(
                eq(crawlConfigs.organizationId, projects.organizationId),
                eq(crawlConfigs.projectId, projects.id),
              ),
            )
            .where(
              and(
                eq(projects.id, projectId),
                eq(projects.organizationId, scope.organization.id),
                isNull(projects.deletedAt),
              ),
            )
            .limit(1)
        : await this.#db
            .select(projection)
            .from(projects)
            .innerJoin(
              crawlConfigs,
              and(
                eq(crawlConfigs.organizationId, projects.organizationId),
                eq(crawlConfigs.projectId, projects.id),
              ),
            )
            .where(
              and(
                eq(projects.id, projectId),
                eq(projects.organizationId, scope.organization.id),
                isNull(projects.deletedAt),
              ),
            )
            .limit(1);

    return rows[0] === undefined ? null : mapProjectRow(rows[0]);
  }

  async listTeam(scope: OrganizationScope): Promise<readonly TeamMemberRecord[]> {
    assertCapability(scope.membership.role, "team:read");

    const [memberRows, scopeRows] = await Promise.all([
      this.#db
        .select({
          id: memberships.id,
          name: users.name,
          email: users.email,
          role: memberships.role,
          status: memberships.status,
          joinedAt: memberships.joinedAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.organizationId, scope.organization.id))
        .orderBy(asc(memberships.createdAt), asc(memberships.id)),
      this.#db
        .select({
          membershipId: membershipProjectScopes.membershipId,
          projectId: membershipProjectScopes.projectId,
        })
        .from(membershipProjectScopes)
        .where(eq(membershipProjectScopes.organizationId, scope.organization.id)),
    ]);

    const projectIdsByMembership = new Map<string, string[]>();
    for (const row of scopeRows) {
      const projectIds = projectIdsByMembership.get(row.membershipId) ?? [];
      projectIds.push(row.projectId);
      projectIdsByMembership.set(row.membershipId, projectIds);
    }

    return memberRows.map((row) => ({
      ...row,
      projectIds: Object.freeze(projectIdsByMembership.get(row.id) ?? []),
    }));
  }

  async listPendingInvitations(scope: OrganizationScope): Promise<readonly InvitationRecord[]> {
    assertCapability(scope.membership.role, "team:read");

    return this.#db
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        projectId: invitations.projectId,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.organizationId, scope.organization.id),
          eq(invitations.status, "pending"),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(invitations.createdAt), desc(invitations.id));
  }

  async createInvitation(scope: OrganizationScope, input: CreateInvitationInput): Promise<string> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const now = new Date();

    return this.#db.transaction(async (transaction) => {
      const actorRole = await requireFreshActor(transaction, scope, "team:invite");

      if (input.role === "admin" && actorRole !== "owner") {
        throw new DatabaseDomainError("FORBIDDEN", "Only the owner can invite an admin.");
      }

      if (input.role === "client") {
        if (input.projectId === null) {
          throw new DatabaseDomainError("CONFLICT", "A Client invitation needs a project.");
        }

        const [project] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, input.projectId),
              eq(projects.organizationId, scope.organization.id),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1);

        if (project === undefined) {
          throw new DatabaseDomainError("NOT_FOUND", "Project not found.");
        }
      } else if (input.projectId !== null) {
        throw new DatabaseDomainError("CONFLICT", "Only Client invitations may select a project.");
      }

      await transaction
        .update(invitations)
        .set({ status: "expired", updatedAt: now })
        .where(
          and(
            eq(invitations.organizationId, scope.organization.id),
            eq(invitations.status, "pending"),
            lt(invitations.expiresAt, now),
          ),
        );

      const sameScope =
        input.projectId === null
          ? isNull(invitations.projectId)
          : eq(invitations.projectId, input.projectId);

      await transaction
        .update(invitations)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(invitations.organizationId, scope.organization.id),
            eq(invitations.email, normalizedEmail),
            eq(invitations.status, "pending"),
            sameScope,
          ),
        );

      const [invitation] = await transaction
        .insert(invitations)
        .values({
          organizationId: scope.organization.id,
          email: normalizedEmail,
          role: input.role,
          projectId: input.projectId,
          tokenHash: input.tokenHash,
          invitedByMembershipId: scope.membership.id,
          expiresAt: input.expiresAt,
        })
        .returning({ id: invitations.id });

      if (invitation === undefined) {
        throw new Error("Invitation insert returned no row.");
      }

      await writeAudit(
        transaction,
        {
          organizationId: scope.organization.id,
          membershipId: scope.membership.id,
          userId: scope.userId,
        },
        {
          action: "invitation.created",
          targetType: "invitation",
          targetId: invitation.id,
          traceId: input.traceId,
          metadata: { role: input.role, projectScoped: input.projectId !== null },
        },
      );

      return invitation.id;
    });
  }

  async revokeInvitation(
    scope: OrganizationScope,
    invitationId: string,
    traceId: string,
  ): Promise<void> {
    const now = new Date();

    await this.#db.transaction(async (transaction) => {
      await requireFreshActor(transaction, scope, "team:invite");

      const [revoked] = await transaction
        .update(invitations)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(invitations.id, invitationId),
            eq(invitations.organizationId, scope.organization.id),
            eq(invitations.status, "pending"),
          ),
        )
        .returning({ id: invitations.id });

      if (revoked === undefined) {
        throw new DatabaseDomainError("NOT_FOUND", "Invitation not found.");
      }

      await writeAudit(
        transaction,
        {
          organizationId: scope.organization.id,
          membershipId: scope.membership.id,
          userId: scope.userId,
        },
        {
          action: "invitation.revoked",
          targetType: "invitation",
          targetId: invitationId,
          traceId,
        },
      );
    });
  }

  async getInvitationPreview(userId: string, tokenHash: string): Promise<InvitationPreview | null> {
    const [user] = await this.#db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user === undefined) {
      return null;
    }

    const [row] = await this.#db
      .select({
        organizationName: organizations.name,
        projectName: projects.name,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(
        organizations,
        and(eq(organizations.id, invitations.organizationId), isNull(organizations.deletedAt)),
      )
      .leftJoin(
        projects,
        and(
          eq(projects.organizationId, invitations.organizationId),
          eq(projects.id, invitations.projectId),
          isNull(projects.deletedAt),
        ),
      )
      .where(
        and(
          eq(invitations.tokenHash, tokenHash),
          eq(invitations.email, user.email),
          eq(invitations.status, "pending"),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async acceptInvitation(
    input: Readonly<{
      userId: string;
      sessionId: string;
      tokenHash: string;
      traceId: string;
    }>,
  ): Promise<string> {
    const now = new Date();

    return this.#db.transaction(async (transaction) => {
      const [identity] = await transaction
        .select({ email: users.email })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(
            eq(sessions.id, input.sessionId),
            eq(sessions.userId, input.userId),
            gt(sessions.expiresAt, now),
          ),
        )
        .limit(1);

      if (identity === undefined) {
        throw new DatabaseDomainError("UNAUTHENTICATED", "Your session is no longer active.");
      }

      const [invitation] = await transaction
        .select({
          id: invitations.id,
          organizationId: invitations.organizationId,
          email: invitations.email,
          role: invitations.role,
          projectId: invitations.projectId,
          invitedByMembershipId: invitations.invitedByMembershipId,
          status: invitations.status,
          expiresAt: invitations.expiresAt,
          organizationDeletedAt: organizations.deletedAt,
        })
        .from(invitations)
        .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
        .where(eq(invitations.tokenHash, input.tokenHash))
        .limit(1)
        .for("update");

      if (
        invitation === undefined ||
        invitation.status !== "pending" ||
        invitation.expiresAt <= now ||
        invitation.organizationDeletedAt !== null ||
        invitation.email !== identity.email
      ) {
        throw new DatabaseDomainError(
          "INVITATION_INVALID",
          "This invitation is invalid or no longer available.",
        );
      }

      await transaction
        .insert(memberships)
        .values({
          organizationId: invitation.organizationId,
          userId: input.userId,
          role: invitation.role,
          status: "active",
          invitedByMembershipId: invitation.invitedByMembershipId,
        })
        .onConflictDoNothing({ target: [memberships.organizationId, memberships.userId] });

      const [membership] = await transaction
        .select({ id: memberships.id, role: memberships.role, status: memberships.status })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, invitation.organizationId),
            eq(memberships.userId, input.userId),
          ),
        )
        .limit(1)
        .for("update");

      if (membership === undefined) {
        throw new Error("Invitation membership could not be created.");
      }

      let effectiveRole = membership.role;
      if (
        membership.status !== "active" ||
        (membership.role === "client" && invitation.role !== "client")
      ) {
        effectiveRole = invitation.role;
        await transaction
          .update(memberships)
          .set({
            role: effectiveRole,
            status: "active",
            invitedByMembershipId: invitation.invitedByMembershipId,
            updatedAt: now,
          })
          .where(eq(memberships.id, membership.id));
      }

      if (effectiveRole === "client" && invitation.projectId !== null) {
        await transaction
          .insert(membershipProjectScopes)
          .values({
            organizationId: invitation.organizationId,
            membershipId: membership.id,
            projectId: invitation.projectId,
            grantedByMembershipId: invitation.invitedByMembershipId,
          })
          .onConflictDoNothing();
      }

      const [accepted] = await transaction
        .update(invitations)
        .set({
          status: "accepted",
          acceptedAt: now,
          acceptedByUserId: input.userId,
          updatedAt: now,
        })
        .where(and(eq(invitations.id, invitation.id), eq(invitations.status, "pending")))
        .returning({ id: invitations.id });

      if (accepted === undefined) {
        throw new DatabaseDomainError(
          "INVITATION_INVALID",
          "This invitation is invalid or no longer available.",
        );
      }

      await transaction
        .update(sessions)
        .set({ activeOrganizationId: invitation.organizationId, updatedAt: now })
        .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)));

      await writeAudit(
        transaction,
        {
          organizationId: invitation.organizationId,
          membershipId: membership.id,
          userId: input.userId,
        },
        {
          action: "invitation.accepted",
          targetType: "invitation",
          targetId: invitation.id,
          traceId: input.traceId,
          metadata: { role: invitation.role, projectScoped: invitation.projectId !== null },
        },
      );

      return invitation.organizationId;
    });
  }

  async changeMembershipRole(
    scope: OrganizationScope,
    input: Readonly<{
      membershipId: string;
      nextRole: Exclude<OrganizationRole, "owner">;
      projectId: string | null;
      traceId: string;
    }>,
  ): Promise<void> {
    const now = new Date();

    await this.#db.transaction(async (transaction) => {
      const actorRole = await requireFreshActor(transaction, scope, "team:manage");
      const [target] = await transaction
        .select({ role: memberships.role, status: memberships.status })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, input.membershipId),
            eq(memberships.organizationId, scope.organization.id),
            ne(memberships.status, "revoked"),
          ),
        )
        .limit(1)
        .for("update");

      if (target === undefined) {
        throw new DatabaseDomainError("NOT_FOUND", "Member not found.");
      }

      if (!canManageRole(actorRole, target.role, input.nextRole)) {
        throw new DatabaseDomainError("FORBIDDEN", "You cannot assign that role.");
      }

      if (input.nextRole === "client") {
        if (input.projectId === null) {
          throw new DatabaseDomainError("CONFLICT", "A Client role needs a project.");
        }

        const [project] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, input.projectId),
              eq(projects.organizationId, scope.organization.id),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1);

        if (project === undefined) {
          throw new DatabaseDomainError("NOT_FOUND", "Project not found.");
        }
      }

      await transaction
        .update(memberships)
        .set({ role: input.nextRole, updatedAt: now })
        .where(
          and(
            eq(memberships.id, input.membershipId),
            eq(memberships.organizationId, scope.organization.id),
          ),
        );

      await transaction
        .delete(membershipProjectScopes)
        .where(
          and(
            eq(membershipProjectScopes.organizationId, scope.organization.id),
            eq(membershipProjectScopes.membershipId, input.membershipId),
          ),
        );

      if (input.nextRole === "client" && input.projectId !== null) {
        await transaction.insert(membershipProjectScopes).values({
          organizationId: scope.organization.id,
          membershipId: input.membershipId,
          projectId: input.projectId,
          grantedByMembershipId: scope.membership.id,
        });
      }

      await writeAudit(
        transaction,
        {
          organizationId: scope.organization.id,
          membershipId: scope.membership.id,
          userId: scope.userId,
        },
        {
          action: "membership.role_changed",
          targetType: "membership",
          targetId: input.membershipId,
          traceId: input.traceId,
          metadata: { previousRole: target.role, nextRole: input.nextRole },
        },
      );
    });
  }

  async changeMembershipStatus(
    scope: OrganizationScope,
    input: Readonly<{
      membershipId: string;
      nextStatus: "active" | "suspended" | "revoked";
      traceId: string;
    }>,
  ): Promise<void> {
    const now = new Date();

    await this.#db.transaction(async (transaction) => {
      const actorRole = await requireFreshActor(transaction, scope, "team:manage");
      const [target] = await transaction
        .select({ role: memberships.role, status: memberships.status })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, input.membershipId),
            eq(memberships.organizationId, scope.organization.id),
          ),
        )
        .limit(1)
        .for("update");

      if (target === undefined) {
        throw new DatabaseDomainError("NOT_FOUND", "Member not found.");
      }

      if (!canManageRole(actorRole, target.role, target.role)) {
        throw new DatabaseDomainError("FORBIDDEN", "You cannot change this member.");
      }

      if (input.nextStatus === "active" && target.role === "client") {
        const [projectScope] = await transaction
          .select({ projectId: membershipProjectScopes.projectId })
          .from(membershipProjectScopes)
          .where(
            and(
              eq(membershipProjectScopes.organizationId, scope.organization.id),
              eq(membershipProjectScopes.membershipId, input.membershipId),
            ),
          )
          .limit(1);

        if (projectScope === undefined) {
          throw new DatabaseDomainError("CONFLICT", "A Client role needs a project.");
        }
      }

      await transaction
        .update(memberships)
        .set({ status: input.nextStatus, updatedAt: now })
        .where(
          and(
            eq(memberships.id, input.membershipId),
            eq(memberships.organizationId, scope.organization.id),
          ),
        );

      await writeAudit(
        transaction,
        {
          organizationId: scope.organization.id,
          membershipId: scope.membership.id,
          userId: scope.userId,
        },
        {
          action: "membership.status_changed",
          targetType: "membership",
          targetId: input.membershipId,
          traceId: input.traceId,
          metadata: { previousStatus: target.status, nextStatus: input.nextStatus },
        },
      );
    });
  }

  async transferOwnership(
    scope: OrganizationScope,
    targetMembershipId: string,
    traceId: string,
  ): Promise<void> {
    const now = new Date();

    await this.#db.transaction(async (transaction) => {
      await requireFreshActor(transaction, scope, "ownership:transfer");
      await transaction.execute(
        sql`select ${organizations.id} from ${organizations} where ${organizations.id} = ${scope.organization.id} for update`,
      );

      const [target] = await transaction
        .select({ id: memberships.id, role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, targetMembershipId),
            eq(memberships.organizationId, scope.organization.id),
            eq(memberships.status, "active"),
          ),
        )
        .limit(1)
        .for("update");

      if (target === undefined || target.id === scope.membership.id) {
        throw new DatabaseDomainError("NOT_FOUND", "Eligible member not found.");
      }

      await transaction
        .update(memberships)
        .set({ role: "admin", updatedAt: now })
        .where(
          and(
            eq(memberships.id, scope.membership.id),
            eq(memberships.organizationId, scope.organization.id),
            eq(memberships.role, "owner"),
          ),
        );
      await transaction
        .update(memberships)
        .set({ role: "owner", updatedAt: now })
        .where(
          and(eq(memberships.id, target.id), eq(memberships.organizationId, scope.organization.id)),
        );
      await transaction
        .delete(membershipProjectScopes)
        .where(
          and(
            eq(membershipProjectScopes.organizationId, scope.organization.id),
            eq(membershipProjectScopes.membershipId, target.id),
          ),
        );

      await writeAudit(
        transaction,
        {
          organizationId: scope.organization.id,
          membershipId: scope.membership.id,
          userId: scope.userId,
        },
        {
          action: "organization.ownership_transferred",
          targetType: "membership",
          targetId: target.id,
          traceId,
          metadata: { previousTargetRole: target.role },
        },
      );
    });
  }

  async updateCrawlConfig(
    scope: OrganizationScope,
    projectId: string,
    expectedVersion: number,
    input: CrawlConfigInput & Readonly<{ traceId: string }>,
  ): Promise<void> {
    assertCrawlConfigInput(input);
    const now = new Date();

    await this.#db.transaction(async (transaction) => {
      await requireFreshActor(transaction, scope, "crawl-config:update");

      const [updated] = await transaction
        .update(crawlConfigs)
        .set({
          version: expectedVersion + 1,
          pageLimit: input.pageLimit,
          maxDepth: input.maxDepth,
          includeSubdomains: input.includeSubdomains,
          queryPolicy: input.queryPolicy,
          ...(input.requestDelayMs === undefined ? {} : { requestDelayMs: input.requestDelayMs }),
          ...(input.concurrency === undefined ? {} : { concurrency: input.concurrency }),
          ...(input.includePatterns === undefined
            ? {}
            : { includePatterns: [...input.includePatterns] }),
          ...(input.excludePatterns === undefined
            ? {}
            : { excludePatterns: [...input.excludePatterns] }),
          ...(input.renderingEnabled === undefined
            ? {}
            : { renderingEnabled: input.renderingEnabled }),
          ...(input.submittedSitemapUrls === undefined
            ? {}
            : { submittedSitemapUrls: [...input.submittedSitemapUrls] }),
          updatedByMembershipId: scope.membership.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(crawlConfigs.organizationId, scope.organization.id),
            eq(crawlConfigs.projectId, projectId),
            eq(crawlConfigs.version, expectedVersion),
          ),
        )
        .returning({ id: crawlConfigs.id });

      if (updated === undefined) {
        const [project] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, projectId),
              eq(projects.organizationId, scope.organization.id),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1);

        if (project === undefined) {
          throw new DatabaseDomainError("NOT_FOUND", "Project not found.");
        }
        throw new DatabaseDomainError("CONFLICT", "The crawl settings changed. Reload and retry.");
      }

      await writeAudit(
        transaction,
        {
          organizationId: scope.organization.id,
          membershipId: scope.membership.id,
          userId: scope.userId,
        },
        {
          action: "crawl_config.updated",
          targetType: "project",
          targetId: projectId,
          traceId: input.traceId,
          metadata: { previousVersion: expectedVersion, nextVersion: expectedVersion + 1 },
        },
      );
    });
  }

  async consumeRateLimit(
    input: Readonly<{
      key: string;
      max: number;
      windowMs: number;
      now?: Date;
    }>,
  ): Promise<RateLimitDecision> {
    const nowMs = (input.now ?? new Date()).getTime();

    return this.#db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({
          id: authRateLimits.id,
          count: authRateLimits.count,
          windowStartedAt: authRateLimits.lastRequest,
        })
        .from(authRateLimits)
        .where(eq(authRateLimits.key, input.key))
        .limit(1)
        .for("update");

      if (existing === undefined) {
        await transaction.insert(authRateLimits).values({
          key: input.key,
          count: 1,
          lastRequest: nowMs,
        });
        return { allowed: true, remaining: Math.max(0, input.max - 1), retryAfterSeconds: 0 };
      }

      const elapsed = nowMs - existing.windowStartedAt;
      if (elapsed >= input.windowMs || elapsed < 0) {
        await transaction
          .update(authRateLimits)
          .set({ count: 1, lastRequest: nowMs })
          .where(eq(authRateLimits.id, existing.id));
        return { allowed: true, remaining: Math.max(0, input.max - 1), retryAfterSeconds: 0 };
      }

      if (existing.count >= input.max) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((input.windowMs - elapsed) / 1_000)),
        };
      }

      const nextCount = existing.count + 1;
      await transaction
        .update(authRateLimits)
        .set({ count: nextCount })
        .where(eq(authRateLimits.id, existing.id));

      return {
        allowed: true,
        remaining: Math.max(0, input.max - nextCount),
        retryAfterSeconds: 0,
      };
    });
  }
}

export function createSearviaRepository(database: SearviaDatabase): SearviaRepository {
  return new SearviaRepository(database);
}
