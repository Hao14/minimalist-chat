import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const DATABASE_ORGANIZATION_ROLES = [
  "owner",
  "admin",
  "analyst",
  "viewer",
  "client",
] as const;

export const organizationRoleEnum = pgEnum("organization_role", DATABASE_ORGANIZATION_ROLES);
export const membershipStatusEnum = pgEnum("membership_status", ["active", "suspended", "revoked"]);
export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);
export const projectVerificationStatusEnum = pgEnum("project_verification_status", [
  "unverified",
  "pending",
  "verified",
  "failed",
]);
export const projectVerificationMethodEnum = pgEnum("project_verification_method", [
  "dns_txt",
  "html_file",
  "meta_tag",
]);
export const verificationAttemptStatusEnum = pgEnum("verification_attempt_status", [
  "pending",
  "verified",
  "expired",
  "revoked",
]);
export const crawlQueryPolicyEnum = pgEnum("crawl_query_policy", [
  "keep",
  "ignore_tracking",
  "ignore_all",
]);
export const crawlStatusEnum = pgEnum("crawl_status", [
  "queued",
  "validating",
  "discovering",
  "crawling",
  "cancelled",
  "failed",
  "partially_completed",
  "completed",
]);
export const crawlFrontierStateEnum = pgEnum("crawl_frontier_state", [
  "discovered",
  "fetching",
  "fetched",
  "blocked",
  "failed",
  "skipped",
]);
export const crawlDiscoverySourceEnum = pgEnum("crawl_discovery_source", [
  "seed",
  "link",
  "sitemap",
  "robots_sitemap",
  "redirect",
]);
export const robotsDecisionEnum = pgEnum("robots_decision", [
  "not_checked",
  "allowed",
  "disallowed",
]);
export const robotsResultEnum = pgEnum("robots_result", [
  "fetched",
  "not_found",
  "unavailable",
  "invalid",
]);
export const pageExtractionSourceEnum = pgEnum("page_extraction_source", ["raw", "rendered"]);
export const pageExtractionStatusEnum = pgEnum("page_extraction_status", ["succeeded", "failed"]);
export const canonicalNormalizationFailureCodeEnum = pgEnum(
  "canonical_normalization_failure_code",
  ["empty_url", "invalid_url", "userinfo_not_allowed", "unsupported_protocol"],
);
export const pageArtifactKindEnum = pgEnum("page_artifact_kind", ["raw_html", "rendered_html"]);
export const pageLinkScopeEnum = pgEnum("page_link_scope", ["internal", "external"]);
export const pageLinkTypeEnum = pgEnum("page_link_type", [
  "anchor",
  "area",
  "canonical",
  "hreflang",
  "pagination",
  "form_action",
  "iframe",
  "other",
]);
export const pageResourceTypeEnum = pgEnum("page_resource_type", [
  "script",
  "stylesheet",
  "iframe",
  "form",
]);
export const structuredDataKindEnum = pgEnum("structured_data_kind", ["json_ld", "microdata"]);
export const structuredDataParseStatusEnum = pgEnum("structured_data_parse_status", [
  "parsed",
  "invalid",
]);
export const sitemapSourceEnum = pgEnum("sitemap_source", [
  "robots",
  "submitted",
  "default",
  "nested",
]);
export const sitemapStatusEnum = pgEnum("sitemap_status", ["parsed", "failed", "skipped"]);
export const sitemapFormatEnum = pgEnum("sitemap_format", ["urlset", "index", "unknown"]);
export const sitemapCompressionEnum = pgEnum("sitemap_compression", ["identity", "gzip"]);
export const sitemapEntryTypeEnum = pgEnum("sitemap_entry_type", ["url", "sitemap"]);
export const crawlUsageReservationStatusEnum = pgEnum("crawl_usage_reservation_status", [
  "reserved",
  "released",
  "consumed",
]);
export const jobOutboxStatusEnum = pgEnum("job_outbox_status", [
  "pending",
  "publishing",
  "published",
  "cancelled",
  "dead_lettered",
]);
export const auditActorKindEnum = pgEnum("audit_actor_kind", ["user", "system"]);
export const auditRuleScopeEnum = pgEnum("audit_rule_scope", ["page", "site"]);
export const auditSeverityEnum = pgEnum("audit_severity", [
  "critical",
  "high",
  "medium",
  "low",
  "opportunity",
  "manual_review",
]);
export const auditEvaluationStatusEnum = pgEnum("audit_evaluation_status", [
  "running",
  "completed",
  "partially_completed",
  "failed",
]);
export const auditReportHashIntegrityEnum = pgEnum("audit_report_hash_integrity", [
  "verified",
  "legacy_unverifiable",
]);
export const auditEligibilityEnum = pgEnum("audit_eligibility", [
  "eligible",
  "ineligible",
  "unavailable",
]);
export const auditResultStatusEnum = pgEnum("audit_result_status", [
  "passed",
  "failed",
  "warning",
  "opportunity",
  "manual_review",
  "not_checked",
]);
export const auditConfidenceEnum = pgEnum("audit_confidence", ["high", "medium", "low"]);
export const auditFindingLifecycleEnum = pgEnum("audit_finding_lifecycle", [
  "new",
  "existing",
  "returned",
  "fixed",
  "not_evaluated",
]);
export const auditFindingDispositionEnum = pgEnum("audit_finding_disposition", [
  "open",
  "ignored",
  "accepted_risk",
]);

const timestamps = () => ({
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    ...timestamps(),
  },
  (table) => [
    unique("users_email_unique").on(table.email),
    check("users_email_normalized_check", sql`${table.email} = lower(btrim(${table.email}))`),
    check("users_name_not_blank_check", sql`length(btrim(${table.name})) between 1 and 160`),
  ],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      mode: "date",
      withTimezone: true,
    }),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique("organizations_slug_unique").on(table.slug),
    check(
      "organizations_name_not_blank_check",
      sql`length(btrim(${table.name})) between 1 and 160`,
    ),
    check(
      "organizations_slug_format_check",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(${table.slug}) between 2 and 80`,
    ),
    index("organizations_created_by_user_idx").on(table.createdByUserId),
    index("organizations_active_created_idx")
      .on(table.createdAt, table.id)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps(),
  },
  (table) => [
    unique("accounts_provider_account_unique").on(table.providerId, table.accountId),
    index("accounts_user_id_idx").on(table.userId),
    check(
      "accounts_credential_password_check",
      sql`${table.providerId} <> 'credential' or ${table.password} is not null`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeOrganizationId: uuid("active_organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps(),
  },
  (table) => [
    unique("sessions_token_unique").on(table.token),
    index("sessions_user_expiry_idx").on(table.userId, table.expiresAt),
    index("sessions_expiry_idx").on(table.expiresAt),
    index("sessions_active_organization_idx").on(table.activeOrganizationId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (table) => [index("verifications_identifier_expiry_idx").on(table.identifier, table.expiresAt)],
);

export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: text("key").notNull(),
    count: integer("count").default(0).notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (table) => [
    unique("auth_rate_limits_key_unique").on(table.key),
    check("auth_rate_limits_count_check", sql`${table.count} >= 0`),
    index("auth_rate_limits_last_request_idx").on(table.lastRequest),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: organizationRoleEnum("role").notNull(),
    status: membershipStatusEnum("status").default("active").notNull(),
    invitedByMembershipId: uuid("invited_by_membership_id"),
    joinedAt: timestamp("joined_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    ...timestamps(),
  },
  (table) => [
    unique("memberships_organization_user_unique").on(table.organizationId, table.userId),
    unique("memberships_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      name: "memberships_inviter_fk",
      columns: [table.organizationId, table.invitedByMembershipId],
      foreignColumns: [table.organizationId, table.id],
    }).onDelete("restrict"),
    uniqueIndex("memberships_one_active_owner_unique")
      .on(table.organizationId)
      .where(sql`${table.role} = 'owner' and ${table.status} = 'active'`),
    index("memberships_user_status_organization_idx").on(
      table.userId,
      table.status,
      table.organizationId,
    ),
    index("memberships_organization_status_role_idx").on(
      table.organizationId,
      table.status,
      table.role,
      table.userId,
    ),
    index("memberships_inviter_idx").on(table.invitedByMembershipId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    normalizedOrigin: text("normalized_origin").notNull(),
    normalizedHostname: text("normalized_hostname").notNull(),
    protocol: text("protocol").notNull(),
    port: text("port"),
    locale: text("locale").default("en-US").notNull(),
    timeZone: text("time_zone").default("UTC").notNull(),
    verificationStatus: projectVerificationStatusEnum("verification_status")
      .default("unverified")
      .notNull(),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique("projects_organization_id_unique").on(table.organizationId, table.id),
    uniqueIndex("projects_active_origin_unique")
      .on(table.organizationId, table.normalizedOrigin)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      name: "projects_creator_membership_fk",
      columns: [table.organizationId, table.createdByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("restrict"),
    index("projects_active_created_idx")
      .on(table.organizationId, table.createdAt, table.id)
      .where(sql`${table.deletedAt} is null`),
    index("projects_organization_hostname_idx").on(table.organizationId, table.normalizedHostname),
    index("projects_creator_membership_idx").on(table.createdByMembershipId),
    check("projects_protocol_check", sql`${table.protocol} in ('http:', 'https:')`),
    check("projects_name_not_blank_check", sql`length(btrim(${table.name})) between 1 and 160`),
  ],
);

export const membershipProjectScopes = pgTable(
  "membership_project_scopes",
  {
    organizationId: uuid("organization_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    projectId: uuid("project_id").notNull(),
    grantedByMembershipId: uuid("granted_by_membership_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "membership_project_scopes_pk",
      columns: [table.organizationId, table.membershipId, table.projectId],
    }),
    foreignKey({
      name: "membership_project_scopes_membership_fk",
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "membership_project_scopes_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "membership_project_scopes_grantor_fk",
      columns: [table.organizationId, table.grantedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("restrict"),
    index("membership_project_scopes_project_idx").on(
      table.organizationId,
      table.projectId,
      table.membershipId,
    ),
    index("membership_project_scopes_grantor_idx").on(table.grantedByMembershipId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    email: text("email").notNull(),
    role: organizationRoleEnum("role").notNull(),
    projectId: uuid("project_id"),
    tokenHash: text("token_hash").notNull(),
    invitedByMembershipId: uuid("invited_by_membership_id").notNull(),
    status: invitationStatusEnum("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { mode: "date", withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique("invitations_token_hash_unique").on(table.tokenHash),
    foreignKey({
      name: "invitations_organization_fk",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "invitations_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "invitations_inviter_fk",
      columns: [table.organizationId, table.invitedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("restrict"),
    uniqueIndex("invitations_pending_organization_email_unique")
      .on(table.organizationId, table.email)
      .where(sql`${table.status} = 'pending' and ${table.projectId} is null`),
    uniqueIndex("invitations_pending_client_project_unique")
      .on(table.organizationId, table.email, table.projectId)
      .where(sql`${table.status} = 'pending' and ${table.projectId} is not null`),
    index("invitations_organization_status_expiry_idx").on(
      table.organizationId,
      table.status,
      table.expiresAt,
    ),
    index("invitations_project_idx").on(table.projectId),
    index("invitations_inviter_idx").on(table.invitedByMembershipId),
    index("invitations_accepted_user_idx").on(table.acceptedByUserId),
    check("invitations_email_normalized_check", sql`${table.email} = lower(btrim(${table.email}))`),
    check("invitations_owner_role_check", sql`${table.role} <> 'owner'`),
    check(
      "invitations_client_project_check",
      sql`(${table.role} = 'client' and ${table.projectId} is not null) or (${table.role} <> 'client' and ${table.projectId} is null)`,
    ),
    check(
      "invitations_lifecycle_check",
      sql`(${table.status} = 'accepted' and ${table.acceptedAt} is not null and ${table.acceptedByUserId} is not null and ${table.revokedAt} is null) or (${table.status} = 'revoked' and ${table.revokedAt} is not null and ${table.acceptedAt} is null) or (${table.status} in ('pending', 'expired') and ${table.acceptedAt} is null and ${table.acceptedByUserId} is null and ${table.revokedAt} is null)`,
    ),
  ],
);

export const projectVerifications = pgTable(
  "project_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    method: projectVerificationMethodEnum("method").notNull(),
    status: verificationAttemptStatusEnum("status").default("pending").notNull(),
    challengeHash: text("challenge_hash").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { mode: "date", withTimezone: true }),
    verifiedAt: timestamp("verified_at", { mode: "date", withTimezone: true }),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    ...timestamps(),
  },
  (table) => [
    unique("project_verifications_challenge_hash_unique").on(table.challengeHash),
    foreignKey({
      name: "project_verifications_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "project_verifications_creator_fk",
      columns: [table.organizationId, table.createdByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("restrict"),
    uniqueIndex("project_verifications_one_pending_method_unique")
      .on(table.organizationId, table.projectId, table.method)
      .where(sql`${table.status} = 'pending'`),
    index("project_verifications_project_status_idx").on(
      table.organizationId,
      table.projectId,
      table.status,
    ),
    index("project_verifications_creator_idx").on(table.createdByMembershipId),
    check("project_verifications_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check(
      "project_verifications_verified_at_check",
      sql`(${table.status} = 'verified' and ${table.verifiedAt} is not null) or (${table.status} <> 'verified' and ${table.verifiedAt} is null)`,
    ),
  ],
);

export const crawlConfigs = pgTable(
  "crawl_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    version: integer("version").default(1).notNull(),
    pageLimit: integer("page_limit").default(100).notNull(),
    maxDepth: integer("max_depth").default(5).notNull(),
    includeSubdomains: boolean("include_subdomains").default(false).notNull(),
    respectRobots: boolean("respect_robots").default(true).notNull(),
    requestDelayMs: integer("request_delay_ms").default(250).notNull(),
    concurrency: integer("concurrency").default(2).notNull(),
    userAgent: text("user_agent")
      .default("SearviaBot/1.0 (+https://searvia.online/crawler)")
      .notNull(),
    redirectLimit: integer("redirect_limit").default(5).notNull(),
    maxResponseBytes: integer("max_response_bytes").default(2_000_000).notNull(),
    requestTimeoutMs: integer("request_timeout_ms").default(10_000).notNull(),
    totalTimeoutMs: integer("total_timeout_ms").default(300_000).notNull(),
    supportedContentTypes: text("supported_content_types")
      .array()
      .default(sql`array['text/html', 'application/xhtml+xml']::text[]`)
      .notNull(),
    renderingEnabled: boolean("rendering_enabled").default(false).notNull(),
    submittedSitemapUrls: text("submitted_sitemap_urls")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    includePatterns: text("include_patterns")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    excludePatterns: text("exclude_patterns")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    queryPolicy: crawlQueryPolicyEnum("query_policy").default("ignore_tracking").notNull(),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    updatedByMembershipId: uuid("updated_by_membership_id").notNull(),
    ...timestamps(),
  },
  (table) => [
    unique("crawl_configs_organization_project_unique").on(table.organizationId, table.projectId),
    unique("crawl_configs_tenant_project_id_unique").on(
      table.organizationId,
      table.projectId,
      table.id,
    ),
    foreignKey({
      name: "crawl_configs_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "crawl_configs_creator_fk",
      columns: [table.organizationId, table.createdByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crawl_configs_updater_fk",
      columns: [table.organizationId, table.updatedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("restrict"),
    index("crawl_configs_project_idx").on(table.projectId),
    index("crawl_configs_creator_idx").on(table.createdByMembershipId),
    index("crawl_configs_updater_idx").on(table.updatedByMembershipId),
    check("crawl_configs_version_check", sql`${table.version} >= 1`),
    check("crawl_configs_page_limit_check", sql`${table.pageLimit} between 1 and 100`),
    check("crawl_configs_max_depth_check", sql`${table.maxDepth} between 0 and 10`),
    check("crawl_configs_respect_robots_check", sql`${table.respectRobots} = true`),
    check("crawl_configs_request_delay_check", sql`${table.requestDelayMs} between 250 and 60000`),
    check("crawl_configs_concurrency_check", sql`${table.concurrency} between 1 and 4`),
    check(
      "crawl_configs_user_agent_check",
      sql`length(btrim(${table.userAgent})) between 8 and 256`,
    ),
    check("crawl_configs_redirect_limit_check", sql`${table.redirectLimit} between 0 and 10`),
    check(
      "crawl_configs_max_response_bytes_check",
      sql`${table.maxResponseBytes} between 65536 and 5000000`,
    ),
    check(
      "crawl_configs_request_timeout_check",
      sql`${table.requestTimeoutMs} between 1000 and 30000`,
    ),
    check(
      "crawl_configs_total_timeout_check",
      sql`${table.totalTimeoutMs} between 10000 and 1800000`,
    ),
    check(
      "crawl_configs_content_types_check",
      sql`cardinality(${table.supportedContentTypes}) between 1 and 4 and ${table.supportedContentTypes} <@ array['text/html', 'application/xhtml+xml', 'application/xml', 'text/xml']::text[]`,
    ),
    check(
      "crawl_configs_sitemap_urls_check",
      sql`cardinality(${table.submittedSitemapUrls}) <= 20 and array_position(${table.submittedSitemapUrls}, null) is null and octet_length(array_to_string(${table.submittedSitemapUrls}, E'\n')) <= 81920`,
    ),
    check(
      "crawl_configs_pattern_count_check",
      sql`cardinality(${table.includePatterns}) <= 50 and cardinality(${table.excludePatterns}) <= 50`,
    ),
  ],
);

export interface StoredCrawlConfigSnapshot {
  readonly version: number;
  readonly startUrl: string;
  readonly pageLimit: number;
  readonly maxDepth: number;
  readonly includeSubdomains: boolean;
  readonly respectRobots: true;
  readonly requestDelayMs: number;
  readonly concurrency: number;
  readonly includePatterns: readonly string[];
  readonly excludePatterns: readonly string[];
  readonly queryPolicy: "keep" | "ignore_tracking" | "ignore_all";
  readonly userAgent: string;
  readonly redirectLimit: number;
  readonly maxResponseBytes: number;
  readonly requestTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly supportedContentTypes: readonly string[];
  readonly renderingEnabled: boolean;
  readonly submittedSitemapUrls: readonly string[];
}

export interface StoredRedirectHop {
  readonly sequence: number;
  readonly requestedUrl: string;
  readonly statusCode: number;
  readonly location: string;
  readonly resolvedUrl: string;
}

export interface StoredFetchTiming {
  readonly startedAt: string;
  readonly dnsMs: number;
  readonly ttfbMs: number;
  readonly downloadMs: number;
  readonly totalMs: number;
}

export type StoredHeaderMap = Readonly<Record<string, readonly string[]>>;
export type StoredSocialMetadata = Readonly<Record<string, readonly string[]>>;
export interface StoredSitemapParseIssue {
  readonly code: string;
  readonly entryIndex: number | null;
  readonly message: string;
}

export const crawls = pgTable(
  "crawls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    requestedByMembershipId: uuid("requested_by_membership_id").notNull(),
    crawlConfigId: uuid("crawl_config_id").notNull(),
    configSnapshot: jsonb("config_snapshot").$type<StoredCrawlConfigSnapshot>().notNull(),
    status: crawlStatusEnum("status").default("queued").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    queueJobId: text("queue_job_id"),
    traceId: text("trace_id").notNull(),
    executionToken: uuid("execution_token"),
    executionLeaseExpiresAt: timestamp("execution_lease_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    attemptCount: integer("attempt_count").default(0).notNull(),
    discoveredCount: integer("discovered_count").default(0).notNull(),
    processedCount: integer("processed_count").default(0).notNull(),
    succeededCount: integer("succeeded_count").default(0).notNull(),
    failedCount: integer("failed_count").default(0).notNull(),
    blockedCount: integer("blocked_count").default(0).notNull(),
    skippedCount: integer("skipped_count").default(0).notNull(),
    extractedPageCount: integer("extracted_page_count").default(0).notNull(),
    extractionFailedCount: integer("extraction_failed_count").default(0).notNull(),
    renderedPageCount: integer("rendered_page_count").default(0).notNull(),
    artifactCount: integer("artifact_count").default(0).notNull(),
    sitemapCount: integer("sitemap_count").default(0).notNull(),
    sitemapUrlCount: integer("sitemap_url_count").default(0).notNull(),
    bytesReceived: bigint("bytes_received", { mode: "number" }).default(0).notNull(),
    cancellationRequestedAt: timestamp("cancellation_requested_at", {
      mode: "date",
      withTimezone: true,
    }),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
    lastProgressAt: timestamp("last_progress_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    completionReason: text("completion_reason"),
    ...timestamps(),
  },
  (table) => [
    unique("crawls_organization_id_unique").on(table.organizationId, table.id),
    unique("crawls_tenant_project_id_unique").on(table.organizationId, table.projectId, table.id),
    unique("crawls_project_idempotency_unique").on(
      table.organizationId,
      table.projectId,
      table.idempotencyKeyHash,
    ),
    foreignKey({
      name: "crawls_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crawls_requester_fk",
      columns: [table.organizationId, table.requestedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crawls_config_fk",
      columns: [table.organizationId, table.projectId, table.crawlConfigId],
      foreignColumns: [crawlConfigs.organizationId, crawlConfigs.projectId, crawlConfigs.id],
    }).onDelete("restrict"),
    uniqueIndex("crawls_one_active_project_unique")
      .on(table.organizationId, table.projectId)
      .where(sql`${table.status} in ('queued', 'validating', 'discovering', 'crawling')`),
    index("crawls_tenant_project_created_idx").on(
      table.organizationId,
      table.projectId,
      table.createdAt,
      table.id,
    ),
    index("crawls_tenant_status_progress_idx").on(
      table.organizationId,
      table.status,
      table.lastProgressAt,
    ),
    index("crawls_queue_job_idx").on(table.queueJobId),
    index("crawls_tenant_requester_idx").on(table.organizationId, table.requestedByMembershipId),
    index("crawls_tenant_config_idx").on(
      table.organizationId,
      table.projectId,
      table.crawlConfigId,
    ),
    check("crawls_idempotency_key_hash_check", sql`length(${table.idempotencyKeyHash}) = 64`),
    check(
      "crawls_queue_job_id_deterministic_check",
      sql`${table.queueJobId} is null or ${table.queueJobId} = ${table.id}::text`,
    ),
    check("crawls_trace_id_check", sql`length(${table.traceId}) between 8 and 128`),
    check(
      "crawls_error_length_check",
      sql`(${table.errorType} is null or length(${table.errorType}) between 1 and 120) and (${table.errorMessage} is null or length(${table.errorMessage}) between 1 and 2000) and (${table.completionReason} is null or length(${table.completionReason}) between 1 and 2000)`,
    ),
    check(
      "crawls_counters_check",
      sql`${table.attemptCount} >= 0 and ${table.discoveredCount} >= 0 and ${table.processedCount} >= 0 and ${table.succeededCount} >= 0 and ${table.failedCount} >= 0 and ${table.blockedCount} >= 0 and ${table.skippedCount} >= 0 and ${table.bytesReceived} >= 0 and ${table.processedCount} = ${table.succeededCount} + ${table.failedCount} + ${table.blockedCount} + ${table.skippedCount} and ${table.processedCount} <= ${table.discoveredCount}`,
    ),
    check(
      "crawls_m3_counters_check",
      sql`${table.extractedPageCount} >= 0 and ${table.extractionFailedCount} >= 0 and ${table.renderedPageCount} >= 0 and ${table.artifactCount} >= 0 and ${table.sitemapCount} >= 0 and ${table.sitemapUrlCount} >= 0`,
    ),
    check(
      "crawls_finished_at_check",
      sql`(${table.status} in ('cancelled', 'failed', 'partially_completed', 'completed') and ${table.finishedAt} is not null) or (${table.status} not in ('cancelled', 'failed', 'partially_completed', 'completed') and ${table.finishedAt} is null)`,
    ),
    check(
      "crawls_execution_lease_check",
      sql`(${table.status} in ('validating', 'discovering', 'crawling') and ${table.executionToken} is not null and ${table.executionLeaseExpiresAt} is not null) or (${table.status} not in ('validating', 'discovering', 'crawling') and ${table.executionToken} is null and ${table.executionLeaseExpiresAt} is null)`,
    ),
  ],
);

export const crawlFrontier = pgTable(
  "crawl_frontier",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    origin: text("origin").notNull(),
    hostname: text("hostname").notNull(),
    requestedUrl: text("requested_url").notNull(),
    discoveredUrl: text("discovered_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    urlHash: text("url_hash").notNull(),
    depth: integer("depth").notNull(),
    discoverySource: crawlDiscoverySourceEnum("discovery_source").notNull(),
    discoveredFromFrontierId: uuid("discovered_from_frontier_id"),
    state: crawlFrontierStateEnum("state").default("discovered").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    robotsDecision: robotsDecisionEnum("robots_decision").default("not_checked").notNull(),
    discoveredAt: timestamp("discovered_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    ...timestamps(),
  },
  (table) => [
    unique("crawl_frontier_tenant_crawl_id_unique").on(
      table.organizationId,
      table.crawlId,
      table.id,
    ),
    unique("crawl_frontier_crawl_url_hash_unique").on(table.crawlId, table.urlHash),
    foreignKey({
      name: "crawl_frontier_crawl_fk",
      columns: [table.organizationId, table.projectId, table.crawlId],
      foreignColumns: [crawls.organizationId, crawls.projectId, crawls.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "crawl_frontier_parent_fk",
      columns: [table.organizationId, table.crawlId, table.discoveredFromFrontierId],
      foreignColumns: [table.organizationId, table.crawlId, table.id],
    }).onDelete("restrict"),
    index("crawl_frontier_next_idx").on(
      table.organizationId,
      table.crawlId,
      table.state,
      table.depth,
      table.discoveredAt,
      table.id,
    ),
    index("crawl_frontier_project_url_idx").on(
      table.organizationId,
      table.projectId,
      table.urlHash,
    ),
    check("crawl_frontier_depth_check", sql`${table.depth} between 0 and 10`),
    check("crawl_frontier_attempt_check", sql`${table.attemptCount} between 0 and 10`),
    check("crawl_frontier_url_hash_check", sql`length(${table.urlHash}) = 64`),
    check(
      "crawl_frontier_url_length_check",
      sql`length(${table.requestedUrl}) between 8 and 4096 and length(${table.discoveredUrl}) between 1 and 4096 and length(${table.normalizedUrl}) between 8 and 4096`,
    ),
    check(
      "crawl_frontier_origin_host_check",
      sql`length(${table.origin}) between 8 and 4096 and length(${table.hostname}) between 1 and 253`,
    ),
    check(
      "crawl_frontier_error_length_check",
      sql`(${table.errorType} is null or length(${table.errorType}) between 1 and 120) and (${table.errorMessage} is null or length(${table.errorMessage}) between 1 and 2000)`,
    ),
  ],
);

export const crawlCheckpoints = pgTable(
  "crawl_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    version: integer("version").default(1).notNull(),
    currentDepth: integer("current_depth").default(0).notNull(),
    persistedAt: timestamp("persisted_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps(),
  },
  (table) => [
    unique("crawl_checkpoints_crawl_unique").on(table.crawlId),
    foreignKey({
      name: "crawl_checkpoints_crawl_fk",
      columns: [table.organizationId, table.projectId, table.crawlId],
      foreignColumns: [crawls.organizationId, crawls.projectId, crawls.id],
    }).onDelete("cascade"),
    index("crawl_checkpoints_tenant_crawl_idx").on(table.organizationId, table.crawlId),
    check("crawl_checkpoints_version_check", sql`${table.version} >= 1`),
    check("crawl_checkpoints_depth_check", sql`${table.currentDepth} between 0 and 10`),
  ],
);

export const crawlRobots = pgTable(
  "crawl_robots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    origin: text("origin").notNull(),
    hostname: text("hostname").notNull(),
    requestedUrl: text("requested_url").notNull(),
    finalUrl: text("final_url"),
    statusCode: integer("status_code"),
    contentType: text("content_type"),
    result: robotsResultEnum("result").notNull(),
    userAgent: text("user_agent").notNull(),
    contentSha256: text("content_sha256"),
    content: text("content"),
    crawlDelayMs: integer("crawl_delay_ms"),
    sitemapUrls: text("sitemap_urls")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    fetchedAt: timestamp("fetched_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    ...timestamps(),
  },
  (table) => [
    unique("crawl_robots_crawl_origin_unique").on(table.crawlId, table.origin),
    unique("crawl_robots_tenant_crawl_id_unique").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.id,
    ),
    foreignKey({
      name: "crawl_robots_crawl_fk",
      columns: [table.organizationId, table.projectId, table.crawlId],
      foreignColumns: [crawls.organizationId, crawls.projectId, crawls.id],
    }).onDelete("cascade"),
    index("crawl_robots_tenant_project_idx").on(table.organizationId, table.projectId),
    index("crawl_robots_tenant_crawl_host_idx").on(
      table.organizationId,
      table.crawlId,
      table.hostname,
    ),
    check(
      "crawl_robots_origin_length_check",
      sql`length(${table.origin}) between 8 and 4096 and length(${table.hostname}) between 1 and 253`,
    ),
    check(
      "crawl_robots_content_length_check",
      sql`${table.content} is null or octet_length(${table.content}) <= 500000`,
    ),
    check(
      "crawl_robots_user_agent_check",
      sql`length(btrim(${table.userAgent})) between 8 and 256`,
    ),
    check(
      "crawl_robots_status_code_check",
      sql`${table.statusCode} is null or ${table.statusCode} between 100 and 599`,
    ),
    check(
      "crawl_robots_content_hash_check",
      sql`${table.contentSha256} is null or length(${table.contentSha256}) = 64`,
    ),
    check(
      "crawl_robots_content_provenance_check",
      sql`${table.content} is null or (${table.result} = 'fetched' and ${table.contentSha256} is not null)`,
    ),
    check(
      "crawl_robots_delay_check",
      sql`${table.crawlDelayMs} is null or ${table.crawlDelayMs} between 0 and 86400000`,
    ),
    check("crawl_robots_sitemap_count_check", sql`cardinality(${table.sitemapUrls}) <= 100`),
  ],
);

export const crawlPages = pgTable(
  "crawl_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    frontierId: uuid("frontier_id").notNull(),
    requestedUrl: text("requested_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    finalUrl: text("final_url"),
    urlHash: text("url_hash").notNull(),
    statusCode: integer("status_code"),
    contentType: text("content_type"),
    htmlDetected: boolean("html_detected"),
    htmlDetectionSource: text("html_detection_source").$type<"bounded_response_prefix">(),
    htmlDetectionBytes: integer("html_detection_bytes"),
    responseHeaders: jsonb("response_headers")
      .$type<StoredHeaderMap>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    omittedResponseHeaders: text("omitted_response_headers")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    contentLength: bigint("content_length", { mode: "number" }),
    responseBytes: integer("response_bytes").default(0).notNull(),
    transferSize: integer("transfer_size").default(0).notNull(),
    compression: text("compression"),
    cacheHeaders: jsonb("cache_headers")
      .$type<StoredHeaderMap>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    securityHeaders: jsonb("security_headers")
      .$type<StoredHeaderMap>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    depth: integer("depth").notNull(),
    redirectChain: jsonb("redirect_chain")
      .$type<readonly StoredRedirectHop[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    robotsDecision: robotsDecisionEnum("robots_decision").notNull(),
    robotsObservationId: uuid("robots_observation_id"),
    timing: jsonb("timing").$type<StoredFetchTiming>(),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    discoverySource: crawlDiscoverySourceEnum("discovery_source").notNull(),
    fetchedAt: timestamp("fetched_at", { mode: "date", withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique("crawl_pages_crawl_url_hash_unique").on(table.crawlId, table.urlHash),
    unique("crawl_pages_frontier_unique").on(table.frontierId),
    unique("crawl_pages_tenant_page_id_unique").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.id,
    ),
    foreignKey({
      name: "crawl_pages_crawl_fk",
      columns: [table.organizationId, table.projectId, table.crawlId],
      foreignColumns: [crawls.organizationId, crawls.projectId, crawls.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "crawl_pages_frontier_fk",
      columns: [table.organizationId, table.crawlId, table.frontierId],
      foreignColumns: [crawlFrontier.organizationId, crawlFrontier.crawlId, crawlFrontier.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "crawl_pages_robots_observation_fk",
      columns: [table.organizationId, table.projectId, table.crawlId, table.robotsObservationId],
      foreignColumns: [
        crawlRobots.organizationId,
        crawlRobots.projectId,
        crawlRobots.crawlId,
        crawlRobots.id,
      ],
    }).onDelete("no action"),
    index("crawl_pages_tenant_crawl_depth_idx").on(
      table.organizationId,
      table.crawlId,
      table.depth,
      table.id,
    ),
    index("crawl_pages_tenant_project_fetched_idx").on(
      table.organizationId,
      table.projectId,
      table.fetchedAt,
    ),
    index("crawl_pages_tenant_cursor_idx").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.depth,
      table.normalizedUrl,
      table.id,
    ),
    index("crawl_pages_tenant_robots_idx").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.robotsDecision,
      table.id,
    ),
    check("crawl_pages_url_hash_check", sql`length(${table.urlHash}) = 64`),
    check("crawl_pages_depth_check", sql`${table.depth} between 0 and 10`),
    check("crawl_pages_response_bytes_check", sql`${table.responseBytes} between 0 and 5000000`),
    check(
      "crawl_pages_transfer_size_check",
      sql`${table.transferSize} between 0 and 5000000 and (${table.contentLength} is null or ${table.contentLength} between 0 and 1000000000)`,
    ),
    check(
      "crawl_pages_header_size_check",
      sql`jsonb_typeof(${table.responseHeaders}) = 'object' and jsonb_typeof(${table.cacheHeaders}) = 'object' and jsonb_typeof(${table.securityHeaders}) = 'object' and octet_length(${table.responseHeaders}::text) <= 65536 and octet_length(${table.cacheHeaders}::text) <= 32768 and octet_length(${table.securityHeaders}::text) <= 32768 and cardinality(${table.omittedResponseHeaders}) <= 64 and array_position(${table.omittedResponseHeaders}, null) is null and octet_length(array_to_string(${table.omittedResponseHeaders}, E'\n')) <= 8192`,
    ),
    check(
      "crawl_pages_compression_check",
      sql`${table.compression} is null or length(${table.compression}) between 1 and 80`,
    ),
    check(
      "crawl_pages_status_code_check",
      sql`${table.statusCode} is null or ${table.statusCode} between 100 and 599`,
    ),
    check(
      "crawl_pages_html_detection_check",
      sql`(${table.htmlDetected} is null and ${table.htmlDetectionSource} is null and ${table.htmlDetectionBytes} is null) or (${table.htmlDetected} is not null and ${table.htmlDetectionSource} = 'bounded_response_prefix' and ${table.htmlDetectionBytes} between 0 and 4096)`,
    ),
    check(
      "crawl_pages_url_length_check",
      sql`length(${table.requestedUrl}) between 8 and 4096 and length(${table.normalizedUrl}) between 8 and 4096 and (${table.finalUrl} is null or length(${table.finalUrl}) between 8 and 4096)`,
    ),
    check(
      "crawl_pages_redirect_count_check",
      sql`jsonb_typeof(${table.redirectChain}) = 'array' and jsonb_array_length(${table.redirectChain}) <= 10`,
    ),
    check(
      "crawl_pages_error_length_check",
      sql`(${table.errorType} is null or length(${table.errorType}) between 1 and 120) and (${table.errorMessage} is null or length(${table.errorMessage}) between 1 and 2000)`,
    ),
    check(
      "crawl_pages_robots_provenance_check",
      sql`${table.robotsDecision} = 'not_checked' or ${table.robotsObservationId} is not null`,
    ),
  ],
);

export const crawlPageExtractions = pgTable(
  "crawl_page_extractions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    pageId: uuid("page_id").notNull(),
    source: pageExtractionSourceEnum("source").notNull(),
    status: pageExtractionStatusEnum("status").default("failed").notNull(),
    title: text("title"),
    documentMetadataComplete: boolean("document_metadata_complete").default(false).notNull(),
    titleTagCount: integer("title_tag_count").default(0).notNull(),
    metaDescription: text("meta_description"),
    metaDescriptionTagCount: integer("meta_description_tag_count").default(0).notNull(),
    metaRobots: text("meta_robots")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    xRobotsTag: text("x_robots_tag")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    directiveScopePreserved: boolean("directive_scope_preserved").default(false).notNull(),
    linksComplete: boolean("links_complete").default(false).notNull(),
    canonicalUrl: text("canonical_url"),
    canonicalTagCount: integer("canonical_tag_count").default(0).notNull(),
    canonicalNormalizationFailureCode: canonicalNormalizationFailureCodeEnum(
      "canonical_normalization_failure_code",
    ),
    metaRefreshUrl: text("meta_refresh_url"),
    javascriptRedirectUrl: text("javascript_redirect_url"),
    visibleText: text("visible_text"),
    visibleTextComplete: boolean("visible_text_complete").default(false).notNull(),
    wordCount: integer("word_count").default(0).notNull(),
    headingsComplete: boolean("headings_complete").default(false).notNull(),
    htmlLanguage: text("html_language"),
    characterEncoding: text("character_encoding"),
    characterEncodingDeclared: text("character_encoding_declared"),
    characterEncodingSource: text("character_encoding_source"),
    characterEncodingDeclarationOffset: integer("character_encoding_declaration_offset"),
    viewportDeclarations: text("viewport_declarations")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    htmlDoctypePresent: boolean("html_doctype_present").default(false).notNull(),
    iconDeclarationCount: integer("icon_declaration_count").default(0).notNull(),
    openGraph: jsonb("open_graph")
      .$type<StoredSocialMetadata>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    socialCards: jsonb("social_cards")
      .$type<StoredSocialMetadata>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    contentHash: text("content_hash"),
    domHash: text("dom_hash"),
    similarityFingerprint: text("similarity_fingerprint"),
    meaningfulContent: boolean("meaningful_content").default(false).notNull(),
    clientRendered: boolean("client_rendered").default(false).notNull(),
    renderingErrorType: text("rendering_error_type"),
    renderingErrorMessage: text("rendering_error_message"),
    extractedAt: timestamp("extracted_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps(),
  },
  (table) => [
    unique("page_extract_page_source_unique").on(table.pageId, table.source),
    unique("page_extract_tenant_id_unique").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.pageId,
      table.id,
    ),
    foreignKey({
      name: "page_extract_page_fk",
      columns: [table.organizationId, table.projectId, table.crawlId, table.pageId],
      foreignColumns: [
        crawlPages.organizationId,
        crawlPages.projectId,
        crawlPages.crawlId,
        crawlPages.id,
      ],
    }).onDelete("cascade"),
    index("page_extract_tenant_crawl_source_idx").on(
      table.organizationId,
      table.crawlId,
      table.source,
      table.pageId,
    ),
    index("page_extract_tenant_content_hash_idx").on(
      table.organizationId,
      table.projectId,
      table.contentHash,
    ),
    index("page_extract_tenant_similarity_idx").on(
      table.organizationId,
      table.projectId,
      table.similarityFingerprint,
    ),
    check(
      "page_extract_text_length_check",
      sql`(${table.title} is null or length(${table.title}) <= 2000) and (${table.metaDescription} is null or length(${table.metaDescription}) <= 8000) and (${table.visibleText} is null or octet_length(${table.visibleText}) <= 2000000)`,
    ),
    check(
      "page_extract_directive_count_check",
      sql`cardinality(${table.metaRobots}) <= 64 and cardinality(${table.xRobotsTag}) <= 64 and octet_length(array_to_string(${table.metaRobots}, E'\n')) <= 16384 and octet_length(array_to_string(${table.xRobotsTag}, E'\n')) <= 16384`,
    ),
    check(
      "page_extract_completeness_status_check",
      sql`(${table.directiveScopePreserved} = false and ${table.linksComplete} = false) or ${table.status} = 'succeeded'`,
    ),
    check(
      "page_extract_counts_check",
      sql`${table.wordCount} between 0 and 1000000 and ${table.canonicalTagCount} between 0 and 100 and ${table.titleTagCount} between 0 and 10000 and ${table.metaDescriptionTagCount} between 0 and 10000 and ${table.iconDeclarationCount} between 0 and 10000 and cardinality(${table.viewportDeclarations}) <= 10000`,
    ),
    check(
      "page_extract_document_provenance_check",
      sql`not ${table.documentMetadataComplete} or ${table.status} = 'succeeded'`,
    ),
    check(
      "page_extract_heading_provenance_check",
      sql`not ${table.headingsComplete} or ${table.status} = 'succeeded'`,
    ),
    check(
      "page_extract_visible_text_provenance_check",
      sql`not ${table.visibleTextComplete} or (${table.status} = 'succeeded' and ${table.visibleText} is not null)`,
    ),
    check(
      "page_extract_encoding_provenance_check",
      sql`(${table.characterEncodingSource} is null and ${table.characterEncodingDeclared} is null and ${table.characterEncodingDeclarationOffset} is null) or (${table.characterEncodingSource} in ('bom', 'http_header', 'meta', 'default') and ${table.characterEncoding} is not null and ((${table.characterEncodingSource} = 'meta' and ${table.characterEncodingDeclarationOffset} between 0 and 2048) or (${table.characterEncodingSource} <> 'meta' and ${table.characterEncodingDeclarationOffset} is null)))`,
    ),
    check(
      "page_extract_viewport_size_check",
      sql`octet_length(array_to_string(${table.viewportDeclarations}, E'\n')) <= 131072`,
    ),
    check(
      "page_extract_url_language_check",
      sql`(${table.canonicalUrl} is null or length(${table.canonicalUrl}) between 8 and 4096) and (${table.metaRefreshUrl} is null or length(${table.metaRefreshUrl}) between 8 and 4096) and (${table.javascriptRedirectUrl} is null or length(${table.javascriptRedirectUrl}) between 8 and 4096) and (${table.htmlLanguage} is null or length(${table.htmlLanguage}) between 1 and 80) and (${table.characterEncoding} is null or length(${table.characterEncoding}) between 1 and 80)`,
    ),
    check(
      "page_extract_canonical_provenance_check",
      sql`(${table.canonicalTagCount} <> 1 and ${table.canonicalNormalizationFailureCode} is null) or (${table.canonicalTagCount} = 1 and ((${table.canonicalUrl} is not null and ${table.canonicalNormalizationFailureCode} is null) or (${table.canonicalUrl} is null and ${table.canonicalNormalizationFailureCode} is not null))) or (${table.canonicalTagCount} = 1 and ${table.canonicalUrl} is null and ${table.canonicalNormalizationFailureCode} is null)`,
    ),
    check(
      "page_extract_social_size_check",
      sql`jsonb_typeof(${table.openGraph}) = 'object' and jsonb_typeof(${table.socialCards}) = 'object' and octet_length(${table.openGraph}::text) <= 131072 and octet_length(${table.socialCards}::text) <= 131072`,
    ),
    check(
      "page_extract_hash_check",
      sql`(${table.contentHash} is null or length(${table.contentHash}) = 64) and (${table.domHash} is null or length(${table.domHash}) = 64) and (${table.similarityFingerprint} is null or length(${table.similarityFingerprint}) between 16 and 256)`,
    ),
    check(
      "page_extract_render_error_check",
      sql`(${table.renderingErrorType} is null or length(${table.renderingErrorType}) between 1 and 120) and (${table.renderingErrorMessage} is null or length(${table.renderingErrorMessage}) between 1 and 2000)`,
    ),
  ],
);

export const crawlPageArtifacts = pgTable(
  "crawl_page_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    pageId: uuid("page_id").notNull(),
    kind: pageArtifactKindEnum("kind").notNull(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    objectVersion: text("object_version"),
    etag: text("etag"),
    contentType: text("content_type").notNull(),
    contentEncoding: text("content_encoding").default("gzip").notNull(),
    uncompressedBytes: bigint("uncompressed_bytes", { mode: "number" }).notNull(),
    storedBytes: bigint("stored_bytes", { mode: "number" }).notNull(),
    contentSha256: text("content_sha256").notNull(),
    storageSha256: text("storage_sha256").notNull(),
    storedAt: timestamp("stored_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("page_artifacts_page_kind_unique").on(table.pageId, table.kind),
    unique("page_artifacts_tenant_object_unique").on(
      table.organizationId,
      table.bucket,
      table.objectKey,
    ),
    foreignKey({
      name: "page_artifacts_page_fk",
      columns: [table.organizationId, table.projectId, table.crawlId, table.pageId],
      foreignColumns: [
        crawlPages.organizationId,
        crawlPages.projectId,
        crawlPages.crawlId,
        crawlPages.id,
      ],
    }).onDelete("cascade"),
    index("page_artifacts_tenant_crawl_page_idx").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.pageId,
      table.kind,
    ),
    check(
      "page_artifacts_object_key_check",
      sql`length(${table.bucket}) between 3 and 255 and length(${table.objectKey}) between 32 and 1024 and ${table.objectKey} like ('organizations/' || ${table.organizationId}::text || '/projects/' || ${table.projectId}::text || '/crawls/' || ${table.crawlId}::text || '/pages/' || ${table.pageId}::text || '/%')`,
    ),
    check(
      "page_artifacts_metadata_check",
      sql`length(${table.contentType}) between 3 and 255 and ${table.contentEncoding} = 'gzip' and ${table.uncompressedBytes} between 0 and 10485760 and ${table.storedBytes} between 0 and 11010048 and length(${table.contentSha256}) = 64 and length(${table.storageSha256}) = 64 and (${table.objectVersion} is null or length(${table.objectVersion}) between 1 and 1024) and (${table.etag} is null or length(${table.etag}) between 1 and 512)`,
    ),
  ],
);

export const crawlPageHeadings = pgTable(
  "crawl_page_headings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    pageId: uuid("page_id").notNull(),
    extractionId: uuid("extraction_id").notNull(),
    level: integer("level").notNull(),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("page_headings_extract_ordinal_unique").on(table.extractionId, table.ordinal),
    foreignKey({
      name: "page_headings_extract_fk",
      columns: [
        table.organizationId,
        table.projectId,
        table.crawlId,
        table.pageId,
        table.extractionId,
      ],
      foreignColumns: [
        crawlPageExtractions.organizationId,
        crawlPageExtractions.projectId,
        crawlPageExtractions.crawlId,
        crawlPageExtractions.pageId,
        crawlPageExtractions.id,
      ],
    }).onDelete("cascade"),
    index("page_headings_tenant_page_level_idx").on(
      table.organizationId,
      table.crawlId,
      table.pageId,
      table.level,
      table.ordinal,
    ),
    check("page_headings_level_check", sql`${table.level} between 1 and 6`),
    check("page_headings_ordinal_check", sql`${table.ordinal} between 0 and 9999`),
    check("page_headings_text_check", sql`length(${table.text}) between 0 and 2000`),
  ],
);

export const crawlPageLinks = pgTable(
  "crawl_page_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    sourcePageId: uuid("source_page_id").notNull(),
    extractionId: uuid("extraction_id").notNull(),
    targetFrontierId: uuid("target_frontier_id"),
    targetPageId: uuid("target_page_id"),
    targetUrl: text("target_url").notNull(),
    normalizedTargetUrl: text("normalized_target_url").notNull(),
    targetUrlHash: text("target_url_hash").notNull(),
    scope: pageLinkScopeEnum("scope").notNull(),
    anchorText: text("anchor_text"),
    relValues: text("rel_values")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    linkType: pageLinkTypeEnum("link_type").default("anchor").notNull(),
    hreflang: text("hreflang"),
    discovered: boolean("discovered").default(false).notNull(),
    crawlDepth: integer("crawl_depth").notNull(),
    discoverySource: crawlDiscoverySourceEnum("discovery_source").notNull(),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("page_links_extract_ordinal_unique").on(table.extractionId, table.ordinal),
    foreignKey({
      name: "page_links_extract_fk",
      columns: [
        table.organizationId,
        table.projectId,
        table.crawlId,
        table.sourcePageId,
        table.extractionId,
      ],
      foreignColumns: [
        crawlPageExtractions.organizationId,
        crawlPageExtractions.projectId,
        crawlPageExtractions.crawlId,
        crawlPageExtractions.pageId,
        crawlPageExtractions.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "page_links_target_frontier_fk",
      columns: [table.organizationId, table.crawlId, table.targetFrontierId],
      foreignColumns: [crawlFrontier.organizationId, crawlFrontier.crawlId, crawlFrontier.id],
    }).onDelete("no action"),
    foreignKey({
      name: "page_links_target_page_fk",
      columns: [table.organizationId, table.projectId, table.crawlId, table.targetPageId],
      foreignColumns: [
        crawlPages.organizationId,
        crawlPages.projectId,
        crawlPages.crawlId,
        crawlPages.id,
      ],
    }).onDelete("no action"),
    index("page_links_tenant_source_idx").on(
      table.organizationId,
      table.crawlId,
      table.sourcePageId,
      table.ordinal,
    ),
    index("page_links_tenant_target_hash_idx").on(
      table.organizationId,
      table.crawlId,
      table.targetUrlHash,
      table.sourcePageId,
    ),
    index("page_links_tenant_target_page_idx").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.targetPageId,
    ),
    index("page_links_tenant_target_frontier_idx").on(
      table.organizationId,
      table.crawlId,
      table.targetFrontierId,
    ),
    check(
      "page_links_url_check",
      sql`length(${table.targetUrl}) between 1 and 4096 and length(${table.normalizedTargetUrl}) between 8 and 4096 and length(${table.targetUrlHash}) = 64`,
    ),
    check(
      "page_links_text_check",
      sql`(${table.anchorText} is null or length(${table.anchorText}) <= 4000) and (${table.hreflang} is null or length(${table.hreflang}) between 1 and 80) and cardinality(${table.relValues}) <= 64 and octet_length(array_to_string(${table.relValues}, E'\n')) <= 8192`,
    ),
    check(
      "page_links_discovered_check",
      sql`not ${table.discovered} or ${table.targetFrontierId} is not null`,
    ),
    check("page_links_depth_check", sql`${table.crawlDepth} between 0 and 10`),
    check("page_links_ordinal_check", sql`${table.ordinal} between 0 and 100000`),
  ],
);

export const crawlPageImages = pgTable(
  "crawl_page_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    pageId: uuid("page_id").notNull(),
    extractionId: uuid("extraction_id").notNull(),
    sourceUrl: text("source_url"),
    normalizedUrl: text("normalized_url"),
    urlHash: text("url_hash"),
    scope: pageLinkScopeEnum("scope"),
    altText: text("alt_text"),
    title: text("title"),
    width: integer("width"),
    height: integer("height"),
    loading: text("loading"),
    srcset: text("srcset"),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("page_images_extract_ordinal_unique").on(table.extractionId, table.ordinal),
    foreignKey({
      name: "page_images_extract_fk",
      columns: [
        table.organizationId,
        table.projectId,
        table.crawlId,
        table.pageId,
        table.extractionId,
      ],
      foreignColumns: [
        crawlPageExtractions.organizationId,
        crawlPageExtractions.projectId,
        crawlPageExtractions.crawlId,
        crawlPageExtractions.pageId,
        crawlPageExtractions.id,
      ],
    }).onDelete("cascade"),
    index("page_images_tenant_page_idx").on(
      table.organizationId,
      table.crawlId,
      table.pageId,
      table.ordinal,
    ),
    check(
      "page_images_url_check",
      sql`(${table.sourceUrl} is null or length(${table.sourceUrl}) <= 4096) and (${table.normalizedUrl} is null or length(${table.normalizedUrl}) between 8 and 4096) and (${table.urlHash} is null or length(${table.urlHash}) = 64)`,
    ),
    check(
      "page_images_text_check",
      sql`(${table.altText} is null or length(${table.altText}) <= 4000) and (${table.title} is null or length(${table.title}) <= 2000) and (${table.loading} is null or length(${table.loading}) <= 80) and (${table.srcset} is null or length(${table.srcset}) <= 16000)`,
    ),
    check(
      "page_images_dimensions_check",
      sql`(${table.width} is null or ${table.width} between 0 and 100000) and (${table.height} is null or ${table.height} between 0 and 100000)`,
    ),
    check("page_images_ordinal_check", sql`${table.ordinal} between 0 and 100000`),
  ],
);

export const crawlPageResources = pgTable(
  "crawl_page_resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    pageId: uuid("page_id").notNull(),
    extractionId: uuid("extraction_id").notNull(),
    resourceType: pageResourceTypeEnum("resource_type").notNull(),
    sourceUrl: text("source_url"),
    normalizedUrl: text("normalized_url"),
    urlHash: text("url_hash"),
    scope: pageLinkScopeEnum("scope"),
    robotsDecision: robotsDecisionEnum("robots_decision").default("not_checked").notNull(),
    robotsObservationId: uuid("robots_observation_id"),
    attributes: jsonb("attributes")
      .$type<Readonly<Record<string, string>>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("page_resources_extract_ordinal_unique").on(table.extractionId, table.ordinal),
    foreignKey({
      name: "page_resources_extract_fk",
      columns: [
        table.organizationId,
        table.projectId,
        table.crawlId,
        table.pageId,
        table.extractionId,
      ],
      foreignColumns: [
        crawlPageExtractions.organizationId,
        crawlPageExtractions.projectId,
        crawlPageExtractions.crawlId,
        crawlPageExtractions.pageId,
        crawlPageExtractions.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "page_resources_robots_observation_fk",
      columns: [table.organizationId, table.projectId, table.crawlId, table.robotsObservationId],
      foreignColumns: [
        crawlRobots.organizationId,
        crawlRobots.projectId,
        crawlRobots.crawlId,
        crawlRobots.id,
      ],
    }).onDelete("no action"),
    index("page_resources_tenant_page_type_idx").on(
      table.organizationId,
      table.crawlId,
      table.pageId,
      table.resourceType,
      table.ordinal,
    ),
    index("page_resources_tenant_crawl_robots_idx").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.robotsDecision,
      table.resourceType,
      table.id,
    ),
    check(
      "page_resources_url_check",
      sql`(${table.sourceUrl} is null or length(${table.sourceUrl}) <= 4096) and (${table.normalizedUrl} is null or length(${table.normalizedUrl}) between 8 and 4096) and (${table.urlHash} is null or length(${table.urlHash}) = 64)`,
    ),
    check(
      "page_resources_attributes_check",
      sql`jsonb_typeof(${table.attributes}) = 'object' and octet_length(${table.attributes}::text) <= 65536`,
    ),
    check(
      "page_resources_robots_provenance_check",
      sql`${table.robotsDecision} = 'not_checked' or ${table.robotsObservationId} is not null`,
    ),
    check("page_resources_ordinal_check", sql`${table.ordinal} between 0 and 100000`),
  ],
);

export const crawlPageStructuredData = pgTable(
  "crawl_page_structured_data",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    pageId: uuid("page_id").notNull(),
    extractionId: uuid("extraction_id").notNull(),
    kind: structuredDataKindEnum("kind").notNull(),
    parseStatus: structuredDataParseStatusEnum("parse_status").notNull(),
    schemaTypes: text("schema_types")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    rawValue: text("raw_value").notNull(),
    parsedValue: jsonb("parsed_value").$type<unknown>(),
    errorMessage: text("error_message"),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("page_structured_extract_ordinal_unique").on(table.extractionId, table.ordinal),
    foreignKey({
      name: "page_structured_extract_fk",
      columns: [
        table.organizationId,
        table.projectId,
        table.crawlId,
        table.pageId,
        table.extractionId,
      ],
      foreignColumns: [
        crawlPageExtractions.organizationId,
        crawlPageExtractions.projectId,
        crawlPageExtractions.crawlId,
        crawlPageExtractions.pageId,
        crawlPageExtractions.id,
      ],
    }).onDelete("cascade"),
    index("page_structured_tenant_page_kind_idx").on(
      table.organizationId,
      table.crawlId,
      table.pageId,
      table.kind,
      table.ordinal,
    ),
    check(
      "page_structured_shape_check",
      sql`(${table.parseStatus} = 'parsed' and ${table.parsedValue} is not null and ${table.errorMessage} is null) or (${table.parseStatus} = 'invalid' and ${table.parsedValue} is null and ${table.errorMessage} is not null)`,
    ),
    check(
      "page_structured_size_check",
      sql`octet_length(${table.rawValue}) <= 262144 and (${table.parsedValue} is null or octet_length(${table.parsedValue}::text) <= 262144) and cardinality(${table.schemaTypes}) <= 64 and octet_length(array_to_string(${table.schemaTypes}, E'\n')) <= 8192 and (${table.errorMessage} is null or length(${table.errorMessage}) between 1 and 2000)`,
    ),
    check("page_structured_ordinal_check", sql`${table.ordinal} between 0 and 10000`),
  ],
);

export const crawlSitemaps = pgTable(
  "crawl_sitemaps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    parentSitemapId: uuid("parent_sitemap_id"),
    requestedUrl: text("requested_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    finalUrl: text("final_url"),
    urlHash: text("url_hash").notNull(),
    source: sitemapSourceEnum("source").notNull(),
    status: sitemapStatusEnum("status").notNull(),
    robotsDecision: robotsDecisionEnum("robots_decision").default("not_checked").notNull(),
    robotsObservationId: uuid("robots_observation_id"),
    format: sitemapFormatEnum("format").default("unknown").notNull(),
    compression: sitemapCompressionEnum("compression").default("identity").notNull(),
    statusCode: integer("status_code"),
    contentType: text("content_type"),
    contentLength: bigint("content_length", { mode: "number" }),
    transferSize: integer("transfer_size").default(0).notNull(),
    contentDigest: text("content_digest"),
    depth: integer("depth").notNull(),
    redirectChain: jsonb("redirect_chain")
      .$type<readonly StoredRedirectHop[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    parseIssues: jsonb("parse_issues")
      .$type<readonly StoredSitemapParseIssue[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    urlCount: integer("url_count").default(0).notNull(),
    childSitemapCount: integer("child_sitemap_count").default(0).notNull(),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    fetchedAt: timestamp("fetched_at", { mode: "date", withTimezone: true }),
    parsedAt: timestamp("parsed_at", { mode: "date", withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique("crawl_sitemaps_crawl_url_hash_unique").on(table.crawlId, table.urlHash),
    unique("crawl_sitemaps_tenant_id_unique").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.id,
    ),
    foreignKey({
      name: "crawl_sitemaps_crawl_fk",
      columns: [table.organizationId, table.projectId, table.crawlId],
      foreignColumns: [crawls.organizationId, crawls.projectId, crawls.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "crawl_sitemaps_parent_fk",
      columns: [table.organizationId, table.projectId, table.crawlId, table.parentSitemapId],
      foreignColumns: [table.organizationId, table.projectId, table.crawlId, table.id],
    }).onDelete("no action"),
    foreignKey({
      name: "crawl_sitemaps_robots_observation_fk",
      columns: [table.organizationId, table.projectId, table.crawlId, table.robotsObservationId],
      foreignColumns: [
        crawlRobots.organizationId,
        crawlRobots.projectId,
        crawlRobots.crawlId,
        crawlRobots.id,
      ],
    }).onDelete("no action"),
    index("crawl_sitemaps_tenant_crawl_status_idx").on(
      table.organizationId,
      table.crawlId,
      table.status,
      table.depth,
      table.id,
    ),
    index("crawl_sitemaps_tenant_project_url_idx").on(
      table.organizationId,
      table.projectId,
      table.urlHash,
    ),
    index("crawl_sitemaps_tenant_cursor_idx").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.depth,
      table.normalizedUrl,
      table.id,
    ),
    index("crawl_sitemaps_tenant_parent_idx").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.parentSitemapId,
    ),
    index("crawl_sitemaps_tenant_robots_idx").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.robotsDecision,
      table.id,
    ),
    check(
      "crawl_sitemaps_url_check",
      sql`length(${table.requestedUrl}) between 8 and 4096 and length(${table.normalizedUrl}) between 8 and 4096 and (${table.finalUrl} is null or length(${table.finalUrl}) between 8 and 4096) and length(${table.urlHash}) = 64`,
    ),
    check(
      "crawl_sitemaps_status_code_check",
      sql`${table.statusCode} is null or ${table.statusCode} between 100 and 599`,
    ),
    check(
      "crawl_sitemaps_size_check",
      sql`(${table.contentLength} is null or ${table.contentLength} between 0 and 1000000000) and ${table.transferSize} between 0 and 5000000`,
    ),
    check("crawl_sitemaps_depth_check", sql`${table.depth} between 0 and 5`),
    check(
      "crawl_sitemaps_redirect_check",
      sql`jsonb_typeof(${table.redirectChain}) = 'array' and jsonb_array_length(${table.redirectChain}) <= 10`,
    ),
    check(
      "crawl_sitemaps_parse_issues_check",
      sql`jsonb_typeof(${table.parseIssues}) = 'array' and jsonb_array_length(${table.parseIssues}) <= 1000 and octet_length(${table.parseIssues}::text) <= 131072`,
    ),
    check(
      "crawl_sitemaps_digest_check",
      sql`${table.contentDigest} is null or length(${table.contentDigest}) = 64`,
    ),
    check(
      "crawl_sitemaps_counts_check",
      sql`${table.urlCount} between 0 and 50000 and ${table.childSitemapCount} between 0 and 100`,
    ),
    check(
      "crawl_sitemaps_error_check",
      sql`(${table.errorType} is null or length(${table.errorType}) between 1 and 120) and (${table.errorMessage} is null or length(${table.errorMessage}) between 1 and 2000)`,
    ),
    check(
      "crawl_sitemaps_lifecycle_check",
      // content_digest remains nullable for parsed rows created before migration
      // 0004. The repository requires a digest for every new parsed record.
      sql`(${table.status} = 'parsed' and ${table.parsedAt} is not null and ${table.errorType} is null and ${table.errorMessage} is null) or (${table.status} = 'failed' and ${table.errorType} is not null and ${table.errorMessage} is not null) or (${table.status} = 'skipped' and ${table.parsedAt} is null)`,
    ),
    check(
      "crawl_sitemaps_robots_provenance_check",
      sql`${table.robotsDecision} = 'not_checked' or ${table.robotsObservationId} is not null`,
    ),
  ],
);

export const crawlSitemapEntries = pgTable(
  "crawl_sitemap_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    sitemapId: uuid("sitemap_id").notNull(),
    entryType: sitemapEntryTypeEnum("entry_type").notNull(),
    loc: text("loc").notNull(),
    normalizedLoc: text("normalized_loc").notNull(),
    urlHash: text("url_hash").notNull(),
    lastmodRaw: text("lastmod_raw"),
    lastmodAt: timestamp("lastmod_at", { mode: "date", withTimezone: true }),
    targetFrontierId: uuid("target_frontier_id"),
    targetPageId: uuid("target_page_id"),
    targetSitemapId: uuid("target_sitemap_id"),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("sitemap_entries_sitemap_type_hash_unique").on(
      table.sitemapId,
      table.entryType,
      table.urlHash,
    ),
    foreignKey({
      name: "sitemap_entries_sitemap_fk",
      columns: [table.organizationId, table.projectId, table.crawlId, table.sitemapId],
      foreignColumns: [
        crawlSitemaps.organizationId,
        crawlSitemaps.projectId,
        crawlSitemaps.crawlId,
        crawlSitemaps.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "sitemap_entries_frontier_fk",
      columns: [table.organizationId, table.crawlId, table.targetFrontierId],
      foreignColumns: [crawlFrontier.organizationId, crawlFrontier.crawlId, crawlFrontier.id],
    }).onDelete("no action"),
    foreignKey({
      name: "sitemap_entries_page_fk",
      columns: [table.organizationId, table.projectId, table.crawlId, table.targetPageId],
      foreignColumns: [
        crawlPages.organizationId,
        crawlPages.projectId,
        crawlPages.crawlId,
        crawlPages.id,
      ],
    }).onDelete("no action"),
    foreignKey({
      name: "sitemap_entries_target_sitemap_fk",
      columns: [table.organizationId, table.projectId, table.crawlId, table.targetSitemapId],
      foreignColumns: [
        crawlSitemaps.organizationId,
        crawlSitemaps.projectId,
        crawlSitemaps.crawlId,
        crawlSitemaps.id,
      ],
    }).onDelete("no action"),
    index("sitemap_entries_tenant_crawl_url_idx").on(
      table.organizationId,
      table.crawlId,
      table.entryType,
      table.urlHash,
    ),
    index("sitemap_entries_tenant_sitemap_ordinal_idx").on(
      table.organizationId,
      table.sitemapId,
      table.ordinal,
      table.id,
    ),
    index("sitemap_entries_target_frontier_idx").on(
      table.organizationId,
      table.crawlId,
      table.targetFrontierId,
    ),
    index("sitemap_entries_target_page_idx").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.targetPageId,
    ),
    index("sitemap_entries_target_sitemap_idx").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.targetSitemapId,
    ),
    check(
      "sitemap_entries_url_check",
      sql`length(${table.loc}) between 1 and 4096 and length(${table.normalizedLoc}) between 8 and 4096 and length(${table.urlHash}) = 64`,
    ),
    check(
      "sitemap_entries_lastmod_check",
      sql`${table.lastmodRaw} is null or length(${table.lastmodRaw}) between 1 and 128`,
    ),
    check("sitemap_entries_ordinal_check", sql`${table.ordinal} between 0 and 50000`),
    check(
      "sitemap_entries_target_check",
      sql`(${table.entryType} = 'url' and ${table.targetSitemapId} is null) or (${table.entryType} = 'sitemap' and ${table.targetFrontierId} is null and ${table.targetPageId} is null)`,
    ),
  ],
);

export const crawlUsageReservations = pgTable(
  "crawl_usage_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    reservedPages: integer("reserved_pages").notNull(),
    consumedPages: integer("consumed_pages").default(0).notNull(),
    status: crawlUsageReservationStatusEnum("status").default("reserved").notNull(),
    releasedAt: timestamp("released_at", { mode: "date", withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique("crawl_usage_reservations_crawl_unique").on(table.crawlId),
    foreignKey({
      name: "crawl_usage_reservations_crawl_fk",
      columns: [table.organizationId, table.projectId, table.crawlId],
      foreignColumns: [crawls.organizationId, crawls.projectId, crawls.id],
    }).onDelete("cascade"),
    index("crawl_usage_reservations_tenant_status_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    check(
      "crawl_usage_reservations_counts_check",
      sql`${table.reservedPages} between 1 and 100 and ${table.consumedPages} between 0 and ${table.reservedPages}`,
    ),
    check(
      "crawl_usage_reservations_release_check",
      sql`(${table.status} = 'reserved' and ${table.releasedAt} is null) or (${table.status} in ('released', 'consumed') and ${table.releasedAt} is not null)`,
    ),
  ],
);

export const jobOutbox = pgTable(
  "job_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    jobType: text("job_type").notNull(),
    contractVersion: integer("contract_version").default(1).notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    traceId: text("trace_id").notNull(),
    status: jobOutboxStatusEnum("status").default("pending").notNull(),
    publishAttemptCount: integer("publish_attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp("published_at", { mode: "date", withTimezone: true }),
    claimToken: uuid("claim_token"),
    lockedAt: timestamp("locked_at", { mode: "date", withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { mode: "date", withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps(),
  },
  (table) => [
    unique("job_outbox_tenant_idempotency_unique").on(
      table.organizationId,
      table.projectId,
      table.idempotencyKey,
    ),
    unique("job_outbox_crawl_job_type_unique").on(table.crawlId, table.jobType),
    foreignKey({
      name: "job_outbox_crawl_fk",
      columns: [table.organizationId, table.projectId, table.crawlId],
      foreignColumns: [crawls.organizationId, crawls.projectId, crawls.id],
    }).onDelete("cascade"),
    index("job_outbox_dispatch_idx").on(table.status, table.availableAt, table.createdAt, table.id),
    index("job_outbox_expired_lease_idx")
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} = 'publishing'`),
    index("job_outbox_tenant_crawl_idx").on(table.organizationId, table.crawlId),
    check(
      "job_outbox_job_type_check",
      sql`${table.jobType} in ('crawl.execute', 'crawl.dead-letter', 'audit.evaluate')`,
    ),
    check("job_outbox_contract_version_check", sql`${table.contractVersion} >= 1`),
    check("job_outbox_idempotency_check", sql`length(${table.idempotencyKey}) between 8 and 128`),
    check("job_outbox_trace_id_check", sql`length(${table.traceId}) between 8 and 128`),
    check("job_outbox_attempt_check", sql`${table.publishAttemptCount} between 0 and 100`),
    check(
      "job_outbox_lease_check",
      sql`(${table.status} = 'publishing' and ${table.claimToken} is not null and ${table.lockedAt} is not null and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'publishing' and ${table.claimToken} is null and ${table.lockedAt} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      "job_outbox_published_at_check",
      sql`(${table.status} = 'published' and ${table.publishedAt} is not null) or (${table.status} <> 'published' and ${table.publishedAt} is null)`,
    ),
    check(
      "job_outbox_error_length_check",
      sql`${table.lastError} is null or length(${table.lastError}) between 1 and 2000`,
    ),
  ],
);

export interface StoredAuditRuleManifestEntry {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly definitionHash: string;
}

export const auditRules = pgTable(
  "audit_rules",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("audit_rules_id_check", sql`${table.id} ~ '^[A-Z]{3,4}-[0-9]{3}$'`)],
);

export const auditRuleVersions = pgTable(
  "audit_rule_versions",
  {
    ruleId: text("rule_id")
      .notNull()
      .references(() => auditRules.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    defaultSeverity: auditSeverityEnum("default_severity").notNull(),
    defaultConfidence: auditConfidenceEnum("default_confidence").notNull(),
    scope: auditRuleScopeEnum("scope").notNull(),
    deterministic: boolean("deterministic").default(true).notNull(),
    eligibilityDescription: text("eligibility_description").notNull(),
    requiredData: text("required_data")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    explanation: text("explanation").notNull(),
    expectedValue: text("expected_value").notNull(),
    recommendedFix: text("recommended_fix").notNull(),
    verificationMethod: text("verification_method").notNull(),
    impactAreas: text("impact_areas")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    responsibleOwner: text("responsible_owner").notNull(),
    firstSupportedVersion: text("first_supported_version").notNull(),
    definitionHash: text("definition_hash").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "audit_rule_versions_pk",
      columns: [table.ruleId, table.version],
    }),
    index("audit_rule_versions_category_idx").on(
      table.category,
      table.defaultSeverity,
      table.ruleId,
      table.version,
    ),
    check("audit_rule_versions_version_check", sql`${table.version} >= 1`),
    check(
      "audit_rule_versions_text_check",
      sql`length(btrim(${table.title})) between 1 and 240 and length(btrim(${table.description})) between 1 and 8000 and length(btrim(${table.category})) between 1 and 80 and length(btrim(${table.eligibilityDescription})) between 1 and 4000 and length(btrim(${table.explanation})) between 1 and 8000 and length(btrim(${table.expectedValue})) between 1 and 8000 and length(btrim(${table.recommendedFix})) between 1 and 8000 and length(btrim(${table.verificationMethod})) between 1 and 4000 and length(btrim(${table.responsibleOwner})) between 1 and 120 and length(btrim(${table.firstSupportedVersion})) between 1 and 120`,
    ),
    check(
      "audit_rule_versions_collections_check",
      sql`cardinality(${table.requiredData}) between 1 and 64 and array_position(${table.requiredData}, null) is null and cardinality(${table.impactAreas}) between 1 and 16 and array_position(${table.impactAreas}, null) is null and octet_length(array_to_string(${table.requiredData}, E'\n')) <= 16384 and octet_length(array_to_string(${table.impactAreas}, E'\n')) <= 4096`,
    ),
    check("audit_rule_versions_hash_check", sql`length(${table.definitionHash}) = 64`),
  ],
);

export const auditEvaluationRuns = pgTable(
  "audit_evaluation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    engineVersion: integer("engine_version").notNull(),
    catalogHash: text("catalog_hash").notNull(),
    reportHash: text("report_hash").notNull(),
    reportHashIntegrity: auditReportHashIntegrityEnum("report_hash_integrity")
      .default("verified")
      .notNull(),
    ruleManifest: jsonb("rule_manifest").$type<readonly StoredAuditRuleManifestEntry[]>().notNull(),
    status: auditEvaluationStatusEnum("status").default("running").notNull(),
    resultCount: integer("result_count").default(0).notNull(),
    eligibleCount: integer("eligible_count").default(0).notNull(),
    evaluatedCount: integer("evaluated_count").default(0).notNull(),
    passedCount: integer("passed_count").default(0).notNull(),
    failedCount: integer("failed_count").default(0).notNull(),
    warningCount: integer("warning_count").default(0).notNull(),
    opportunityCount: integer("opportunity_count").default(0).notNull(),
    manualReviewCount: integer("manual_review_count").default(0).notNull(),
    notCheckedCount: integer("not_checked_count").default(0).notNull(),
    ruleErrorCount: integer("rule_error_count").default(0).notNull(),
    snapshotAt: timestamp("snapshot_at", { mode: "date", withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    ...timestamps(),
  },
  (table) => [
    unique("audit_eval_runs_tenant_crawl_unique").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
    ),
    unique("audit_eval_runs_tenant_crawl_id_unique").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.id,
    ),
    foreignKey({
      name: "audit_eval_runs_crawl_fk",
      columns: [table.organizationId, table.projectId, table.crawlId],
      foreignColumns: [crawls.organizationId, crawls.projectId, crawls.id],
    }).onDelete("cascade"),
    index("audit_eval_runs_tenant_project_status_idx").on(
      table.organizationId,
      table.projectId,
      table.status,
      table.snapshotAt,
      table.id,
    ),
    index("audit_eval_runs_tenant_crawl_idx").on(table.organizationId, table.crawlId, table.id),
    index("audit_eval_runs_tenant_project_snapshot_idx").on(
      table.organizationId,
      table.projectId,
      table.snapshotAt,
      table.crawlId,
    ),
    check("audit_eval_runs_engine_version_check", sql`${table.engineVersion} >= 1`),
    check(
      "audit_eval_runs_hash_check",
      sql`length(${table.catalogHash}) = 64 and length(${table.reportHash}) = 64`,
    ),
    check(
      "audit_eval_runs_manifest_check",
      sql`jsonb_typeof(${table.ruleManifest}) = 'array' and jsonb_array_length(${table.ruleManifest}) between 1 and 500 and octet_length(${table.ruleManifest}::text) <= 131072`,
    ),
    check(
      "audit_eval_runs_counts_check",
      sql`${table.resultCount} >= 0 and ${table.eligibleCount} >= 0 and ${table.evaluatedCount} >= 0 and ${table.passedCount} >= 0 and ${table.failedCount} >= 0 and ${table.warningCount} >= 0 and ${table.opportunityCount} >= 0 and ${table.manualReviewCount} >= 0 and ${table.notCheckedCount} >= 0 and ${table.ruleErrorCount} >= 0 and ${table.resultCount} = ${table.evaluatedCount} + ${table.notCheckedCount} and ${table.evaluatedCount} = ${table.passedCount} + ${table.failedCount} + ${table.warningCount} + ${table.opportunityCount} + ${table.manualReviewCount} and ${table.eligibleCount} >= ${table.evaluatedCount} and ${table.ruleErrorCount} <= ${table.notCheckedCount}`,
    ),
    check(
      "audit_eval_runs_lifecycle_check",
      sql`(${table.status} = 'running' and ${table.finishedAt} is null and ${table.errorType} is null and ${table.errorMessage} is null) or (${table.status} in ('completed', 'partially_completed') and ${table.finishedAt} is not null and ${table.errorType} is null and ${table.errorMessage} is null) or (${table.status} = 'failed' and ${table.finishedAt} is not null and ${table.errorType} is not null and ${table.errorMessage} is not null)`,
    ),
    check(
      "audit_eval_runs_error_check",
      sql`(${table.errorType} is null or length(${table.errorType}) between 1 and 120) and (${table.errorMessage} is null or length(${table.errorMessage}) between 1 and 2000)`,
    ),
  ],
);

export const auditFindings = pgTable(
  "audit_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => auditRules.id, { onDelete: "restrict" }),
    scope: auditRuleScopeEnum("scope").notNull(),
    scopeKey: text("scope_key").notNull(),
    scopeKeyHash: text("scope_key_hash").notNull(),
    normalizedUrl: text("normalized_url"),
    currentLifecycle: auditFindingLifecycleEnum("current_lifecycle").notNull(),
    disposition: auditFindingDispositionEnum("disposition").default("open").notNull(),
    severity: auditSeverityEnum("severity").notNull(),
    lastEligibleResultStatus: auditResultStatusEnum("last_eligible_result_status").notNull(),
    firstSeenAt: timestamp("first_seen_at", { mode: "date", withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date", withTimezone: true }).notNull(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { mode: "date", withTimezone: true }).notNull(),
    lastFixedAt: timestamp("last_fixed_at", { mode: "date", withTimezone: true }),
    dispositionReason: text("disposition_reason"),
    dispositionByMembershipId: uuid("disposition_by_membership_id"),
    dispositionAt: timestamp("disposition_at", { mode: "date", withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique("audit_findings_tenant_id_unique").on(table.organizationId, table.projectId, table.id),
    unique("audit_findings_identity_unique").on(
      table.organizationId,
      table.projectId,
      table.ruleId,
      table.scopeKeyHash,
    ),
    unique("audit_findings_occurrence_fk_unique").on(
      table.organizationId,
      table.projectId,
      table.ruleId,
      table.scopeKeyHash,
      table.id,
    ),
    foreignKey({
      name: "audit_findings_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "audit_findings_disposition_membership_fk",
      columns: [table.organizationId, table.dispositionByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("restrict"),
    index("audit_findings_tenant_project_state_idx").on(
      table.organizationId,
      table.projectId,
      table.currentLifecycle,
      table.disposition,
      table.severity,
      table.lastSeenAt,
      table.id,
    ),
    index("audit_findings_tenant_rule_idx").on(
      table.organizationId,
      table.projectId,
      table.ruleId,
      table.lastEvaluatedAt,
    ),
    check(
      "audit_findings_scope_check",
      sql`(${table.scope} = 'page' and ${table.normalizedUrl} is not null and ${table.scopeKey} = ${table.normalizedUrl}) or (${table.scope} = 'site' and ${table.normalizedUrl} is null)`,
    ),
    check(
      "audit_findings_key_check",
      sql`length(${table.scopeKey}) between 1 and 4096 and length(${table.scopeKeyHash}) = 64`,
    ),
    check(
      "audit_findings_result_check",
      sql`${table.lastEligibleResultStatus} in ('passed', 'failed', 'warning', 'opportunity', 'manual_review')`,
    ),
    check(
      "audit_findings_seen_check",
      sql`${table.firstSeenAt} <= ${table.lastSeenAt} and ${table.lastSeenAt} <= ${table.lastEvaluatedAt} and (${table.lastFixedAt} is null or ${table.firstSeenAt} <= ${table.lastFixedAt}) and (${table.currentLifecycle} <> 'fixed' or ${table.lastFixedAt} is not null)`,
    ),
    check(
      "audit_findings_disposition_check",
      sql`(${table.disposition} = 'open' and ${table.dispositionReason} is null and ${table.dispositionByMembershipId} is null and ${table.dispositionAt} is null) or (${table.disposition} in ('ignored', 'accepted_risk') and length(btrim(${table.dispositionReason})) between 1 and 2000 and ${table.dispositionByMembershipId} is not null and ${table.dispositionAt} is not null)`,
    ),
  ],
);

export const auditFindingOccurrences = pgTable(
  "audit_finding_occurrences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    crawlId: uuid("crawl_id").notNull(),
    evaluationRunId: uuid("evaluation_run_id").notNull(),
    findingId: uuid("finding_id"),
    ruleId: text("rule_id").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    scope: auditRuleScopeEnum("scope").notNull(),
    scopeKey: text("scope_key").notNull(),
    scopeKeyHash: text("scope_key_hash").notNull(),
    pageId: uuid("page_id"),
    normalizedUrl: text("normalized_url"),
    eligibility: auditEligibilityEnum("eligibility").notNull(),
    resultStatus: auditResultStatusEnum("result_status").notNull(),
    lifecycle: auditFindingLifecycleEnum("lifecycle"),
    severity: auditSeverityEnum("severity").notNull(),
    confidence: auditConfidenceEnum("confidence"),
    missingData: text("missing_data")
      .array()
      .default(sql`array[]::text[]`)
      .notNull(),
    notEvaluatedReasonCode: text("not_evaluated_reason_code"),
    notEvaluatedReason: text("not_evaluated_reason"),
    evidenceVersion: integer("evidence_version").default(1).notNull(),
    evidence: jsonb("evidence")
      .$type<readonly unknown[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    detectedValue: jsonb("detected_value").$type<unknown>(),
    expectedValue: jsonb("expected_value").$type<unknown>(),
    explanation: text("explanation").notNull(),
    recommendedFix: text("recommended_fix").notNull(),
    impactAreas: text("impact_areas").array().notNull(),
    responsibleOwner: text("responsible_owner").notNull(),
    evaluatedAt: timestamp("evaluated_at", { mode: "date", withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("audit_occurrences_run_rule_scope_unique").on(
      table.organizationId,
      table.projectId,
      table.evaluationRunId,
      table.ruleId,
      table.scopeKeyHash,
    ),
    foreignKey({
      name: "audit_occurrences_run_fk",
      columns: [table.organizationId, table.projectId, table.crawlId, table.evaluationRunId],
      foreignColumns: [
        auditEvaluationRuns.organizationId,
        auditEvaluationRuns.projectId,
        auditEvaluationRuns.crawlId,
        auditEvaluationRuns.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "audit_occurrences_rule_version_fk",
      columns: [table.ruleId, table.ruleVersion],
      foreignColumns: [auditRuleVersions.ruleId, auditRuleVersions.version],
    }).onDelete("restrict"),
    foreignKey({
      name: "audit_occurrences_finding_fk",
      columns: [
        table.organizationId,
        table.projectId,
        table.ruleId,
        table.scopeKeyHash,
        table.findingId,
      ],
      foreignColumns: [
        auditFindings.organizationId,
        auditFindings.projectId,
        auditFindings.ruleId,
        auditFindings.scopeKeyHash,
        auditFindings.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "audit_occurrences_page_fk",
      columns: [table.organizationId, table.projectId, table.crawlId, table.pageId],
      foreignColumns: [
        crawlPages.organizationId,
        crawlPages.projectId,
        crawlPages.crawlId,
        crawlPages.id,
      ],
    }).onDelete("cascade"),
    index("audit_occurrences_tenant_run_status_idx").on(
      table.organizationId,
      table.projectId,
      table.evaluationRunId,
      table.resultStatus,
      table.ruleId,
      table.id,
    ),
    index("audit_occurrences_tenant_finding_history_idx").on(
      table.organizationId,
      table.projectId,
      table.findingId,
      table.evaluatedAt,
      table.id,
    ),
    index("audit_occurrences_tenant_page_idx").on(
      table.organizationId,
      table.projectId,
      table.crawlId,
      table.pageId,
      table.resultStatus,
    ),
    check(
      "audit_occurrences_scope_check",
      sql`(${table.scope} = 'page' and ((${table.pageId} is not null and ${table.normalizedUrl} is not null and ${table.scopeKey} = ${table.normalizedUrl}) or (${table.pageId} is null and ${table.normalizedUrl} is null and ${table.resultStatus} = 'not_checked' and ${table.eligibility} in ('ineligible', 'unavailable') and ${table.lifecycle} = 'not_evaluated' and ${table.findingId} is null))) or (${table.scope} = 'site' and ${table.pageId} is null and ${table.normalizedUrl} is null)`,
    ),
    check(
      "audit_occurrences_key_check",
      sql`length(${table.scopeKey}) between 1 and 4096 and length(${table.scopeKeyHash}) = 64`,
    ),
    check(
      "audit_occurrences_result_check",
      sql`(${table.resultStatus} in ('failed', 'warning', 'opportunity', 'manual_review') and ${table.eligibility} = 'eligible' and ${table.lifecycle} in ('new', 'existing', 'returned') and ${table.findingId} is not null and ${table.confidence} is not null and cardinality(${table.missingData}) = 0 and ${table.notEvaluatedReasonCode} is null and ${table.notEvaluatedReason} is null) or (${table.resultStatus} = 'passed' and ${table.eligibility} = 'eligible' and ((${table.lifecycle} is null and ${table.findingId} is null) or (${table.lifecycle} = 'fixed' and ${table.findingId} is not null)) and ${table.confidence} is not null and cardinality(${table.missingData}) = 0 and ${table.notEvaluatedReasonCode} is null and ${table.notEvaluatedReason} is null) or (${table.resultStatus} = 'not_checked' and ${table.eligibility} in ('ineligible', 'unavailable') and ${table.lifecycle} = 'not_evaluated' and ${table.confidence} is null and length(btrim(${table.notEvaluatedReasonCode})) between 1 and 120 and length(btrim(${table.notEvaluatedReason})) between 1 and 2000)`,
    ),
    check(
      "audit_occurrences_missing_data_check",
      sql`cardinality(${table.missingData}) between 0 and 64 and array_position(${table.missingData}, null) is null and octet_length(array_to_string(${table.missingData}, E'\n')) <= 16384`,
    ),
    check("audit_occurrences_evidence_version_check", sql`${table.evidenceVersion} >= 1`),
    check(
      "audit_occurrences_evidence_check",
      sql`jsonb_typeof(${table.evidence}) = 'array' and jsonb_array_length(${table.evidence}) <= 100 and octet_length(${table.evidence}::text) <= 131072 and (${table.detectedValue} is null or octet_length(${table.detectedValue}::text) <= 32768) and (${table.expectedValue} is null or octet_length(${table.expectedValue}::text) <= 32768)`,
    ),
    check(
      "audit_occurrences_text_check",
      sql`length(btrim(${table.explanation})) between 1 and 8000 and length(btrim(${table.recommendedFix})) between 1 and 8000 and cardinality(${table.impactAreas}) between 1 and 16 and array_position(${table.impactAreas}, null) is null and octet_length(array_to_string(${table.impactAreas}, E'\n')) <= 4096 and length(btrim(${table.responsibleOwner})) between 1 and 120`,
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorKind: auditActorKindEnum("actor_kind").default("user").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
    actorMembershipId: uuid("actor_membership_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    traceId: text("trace_id").notNull(),
    metadataVersion: integer("metadata_version").default(1).notNull(),
    metadata: jsonb("metadata")
      .$type<Readonly<Record<string, unknown>>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "audit_logs_actor_membership_fk",
      columns: [table.organizationId, table.actorMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("restrict"),
    index("audit_logs_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    index("audit_logs_organization_target_idx").on(
      table.organizationId,
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    index("audit_logs_actor_user_idx").on(table.actorUserId),
    index("audit_logs_actor_membership_idx").on(table.actorMembershipId),
    check(
      "audit_logs_actor_check",
      sql`(${table.actorKind} = 'user' and ${table.actorUserId} is not null and ${table.actorMembershipId} is not null) or (${table.actorKind} = 'system' and ${table.actorUserId} is null and ${table.actorMembershipId} is null)`,
    ),
    check("audit_logs_action_check", sql`length(${table.action}) between 3 and 120`),
    check("audit_logs_target_type_check", sql`length(${table.targetType}) between 2 and 80`),
    check("audit_logs_trace_id_check", sql`length(${table.traceId}) between 8 and 128`),
    check("audit_logs_metadata_version_check", sql`${table.metadataVersion} >= 1`),
  ],
);

export const authenticationSchema = {
  user: users,
  account: accounts,
  session: sessions,
  verification: verifications,
  rateLimit: authRateLimits,
} as const;

export const searviaSchema = {
  users,
  organizations,
  accounts,
  sessions,
  verifications,
  authRateLimits,
  memberships,
  projects,
  membershipProjectScopes,
  invitations,
  projectVerifications,
  crawlConfigs,
  crawls,
  crawlFrontier,
  crawlCheckpoints,
  crawlRobots,
  crawlPages,
  crawlPageExtractions,
  crawlPageArtifacts,
  crawlPageHeadings,
  crawlPageLinks,
  crawlPageImages,
  crawlPageResources,
  crawlPageStructuredData,
  crawlSitemaps,
  crawlSitemapEntries,
  crawlUsageReservations,
  jobOutbox,
  auditRules,
  auditRuleVersions,
  auditEvaluationRuns,
  auditFindings,
  auditFindingOccurrences,
  auditLogs,
} as const;

/** @deprecated Use searviaSchema. Kept as an M0 import-compatibility bridge. */
export const foundationSchema = searviaSchema;
