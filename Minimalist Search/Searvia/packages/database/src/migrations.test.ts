import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";

const migrationsRoot = new URL("../migrations/", import.meta.url);
const migrationsFolder = fileURLToPath(migrationsRoot);
const clients: PGlite[] = [];

async function createMigratedDatabase(): Promise<PGlite> {
  const client = new PGlite();
  clients.push(client);
  await migrate(drizzle(client), { migrationsFolder });
  return client;
}

async function applyMigrationScript(client: PGlite, filename: string): Promise<void> {
  const source = await readFile(new URL(filename, migrationsRoot), "utf8");
  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim() !== "") await client.exec(statement);
  }
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("repository database migrations", () => {
  it("preserves earlier migrations and commits the reviewed migration journal", async () => {
    const [
      journal,
      foundation,
      milestone,
      crawlerMilestone,
      extractionMilestone,
      integrityMilestone,
      m2ReviewHardening,
      m2QueueInvariants,
      m4AuditEngine,
      m4AuditOutbox,
      m4UnavailablePageCoverage,
      m4RuleDefinitionCompleteness,
      m4MissingData,
      m4DirectiveScope,
      m4ExtractionProvenance,
      m4CanonicalProvenance,
      m4ResourceRobotsProvenance,
      m4CollectionProvenance,
      m5DocumentProvenance,
      m5EncodingBoundary,
      m5VisibleTextProvenance,
      auditEligibilityHardening,
      auditHashProvenance,
    ] = await Promise.all([
      readFile(new URL("meta/_journal.json", migrationsRoot), "utf8"),
      readFile(new URL("0000_m0-foundation.sql", migrationsRoot), "utf8"),
      readFile(new URL("0001_m1-auth-organizations-projects.sql", migrationsRoot), "utf8"),
      readFile(new URL("0002_m2-safe-crawler-queue.sql", migrationsRoot), "utf8"),
      readFile(new URL("0003_m3-page-extraction-persistence.sql", migrationsRoot), "utf8"),
      readFile(new URL("0004_equal_ultimates.sql", migrationsRoot), "utf8"),
      readFile(new URL("0005_m2_review_hardening.sql", migrationsRoot), "utf8"),
      readFile(new URL("0006_m2_queue_invariants.sql", migrationsRoot), "utf8"),
      readFile(new URL("0007_dashing_madripoor.sql", migrationsRoot), "utf8"),
      readFile(new URL("0008_sparkling_quasimodo.sql", migrationsRoot), "utf8"),
      readFile(new URL("0009_last_archangel.sql", migrationsRoot), "utf8"),
      readFile(new URL("0010_dear_magus.sql", migrationsRoot), "utf8"),
      readFile(new URL("0011_lonely_master_chief.sql", migrationsRoot), "utf8"),
      readFile(new URL("0012_married_korvac.sql", migrationsRoot), "utf8"),
      readFile(new URL("0013_m4a_extraction_provenance.sql", migrationsRoot), "utf8"),
      readFile(new URL("0014_classy_tombstone.sql", migrationsRoot), "utf8"),
      readFile(new URL("0015_petite_gabe_jones.sql", migrationsRoot), "utf8"),
      readFile(new URL("0016_flowery_lady_mastermind.sql", migrationsRoot), "utf8"),
      readFile(new URL("0017_unknown_goblin_queen.sql", migrationsRoot), "utf8"),
      readFile(new URL("0018_puzzling_phil_sheldon.sql", migrationsRoot), "utf8"),
      readFile(new URL("0019_productive_daimon_hellstrom.sql", migrationsRoot), "utf8"),
      readFile(new URL("0020_conscious_odin.sql", migrationsRoot), "utf8"),
      readFile(new URL("0021_living_the_hunter.sql", migrationsRoot), "utf8"),
    ]);

    expect(journal).toContain('"tag": "0000_m0-foundation"');
    expect(journal).toContain('"tag": "0001_m1-auth-organizations-projects"');
    expect(journal).toContain('"tag": "0002_m2-safe-crawler-queue"');
    expect(journal).toContain('"tag": "0003_m3-page-extraction-persistence"');
    expect(journal).toContain('"tag": "0004_equal_ultimates"');
    expect(journal).toContain('"tag": "0005_m2_review_hardening"');
    expect(journal).toContain('"tag": "0006_m2_queue_invariants"');
    expect(journal).toContain('"tag": "0007_dashing_madripoor"');
    expect(journal).toContain('"tag": "0008_sparkling_quasimodo"');
    expect(journal).toContain('"tag": "0009_last_archangel"');
    expect(journal).toContain('"tag": "0010_dear_magus"');
    expect(journal).toContain('"tag": "0011_lonely_master_chief"');
    expect(journal).toContain('"tag": "0012_married_korvac"');
    expect(journal).toContain('"tag": "0013_m4a_extraction_provenance"');
    expect(journal).toContain('"tag": "0014_classy_tombstone"');
    expect(journal).toContain('"tag": "0015_petite_gabe_jones"');
    expect(journal).toContain('"tag": "0016_flowery_lady_mastermind"');
    expect(journal).toContain('"tag": "0017_unknown_goblin_queen"');
    expect(journal).toContain('"tag": "0018_puzzling_phil_sheldon"');
    expect(journal).toContain('"tag": "0019_productive_daimon_hellstrom"');
    expect(journal).toContain('"tag": "0020_conscious_odin"');
    expect(journal).toContain('"tag": "0021_living_the_hunter"');
    expect(foundation).toContain("select 1;");
    expect(foundation.toLowerCase()).not.toContain("create table");
    expect(milestone).toContain('CREATE TABLE "users"');
    expect(milestone).toContain('CREATE TABLE "organizations"');
    expect(milestone).toContain('CREATE TABLE "membership_project_scopes"');
    expect(milestone).toContain('CREATE TABLE "crawl_configs"');
    expect(milestone).toContain('CREATE TABLE "audit_logs"');
    expect(milestone).toContain('CREATE TRIGGER "audit_logs_prevent_update_delete"');
    expect(crawlerMilestone).toContain('CREATE TABLE "crawls"');
    expect(crawlerMilestone).toContain('CREATE TABLE "crawl_frontier"');
    expect(crawlerMilestone).toContain('CREATE TABLE "job_outbox"');
    expect(crawlerMilestone).toContain('CONSTRAINT "crawls_execution_lease_check"');
    expect(crawlerMilestone).toContain('CONSTRAINT "job_outbox_lease_check"');
    expect(extractionMilestone).toContain('CREATE TABLE "crawl_page_extractions"');
    expect(extractionMilestone).toContain('CREATE TABLE "crawl_page_artifacts"');
    expect(extractionMilestone).toContain('CREATE TABLE "crawl_page_links"');
    expect(extractionMilestone).toContain('CREATE TABLE "crawl_sitemaps"');
    expect(extractionMilestone).toContain('CREATE TABLE "crawl_sitemap_entries"');
    expect(extractionMilestone).toContain('CONSTRAINT "page_artifacts_object_key_check"');
    expect(integrityMilestone).toContain('ADD COLUMN "content_digest"');
    expect(integrityMilestone).toContain('ADD COLUMN "parse_issues"');
    expect(integrityMilestone).toContain('CONSTRAINT "crawl_sitemaps_digest_check"');
    expect(m2ReviewHardening).toContain('CREATE INDEX "crawls_tenant_config_idx"');
    expect(m2ReviewHardening).toContain('CREATE INDEX "job_outbox_expired_lease_idx"');
    expect(m2QueueInvariants).toContain('CONSTRAINT "crawls_queue_job_id_deterministic_check"');
    expect(m4AuditEngine).toContain('CREATE TABLE "audit_rule_versions"');
    expect(m4AuditEngine).toContain('CREATE TABLE "audit_evaluation_runs"');
    expect(m4AuditEngine).toContain('CREATE TABLE "audit_findings"');
    expect(m4AuditEngine).toContain('CREATE TABLE "audit_finding_occurrences"');
    expect(m4AuditEngine).toContain('CONSTRAINT "audit_occurrences_run_fk"');
    expect(m4AuditEngine).toContain('CREATE TRIGGER "audit_rule_versions_prevent_update_delete"');
    expect(m4AuditOutbox).toContain(
      'ALTER TABLE "job_outbox" DROP CONSTRAINT "job_outbox_job_type_check"',
    );
    expect(m5DocumentProvenance).toContain('ADD COLUMN "document_metadata_complete"');
    expect(m5DocumentProvenance).toContain('ADD COLUMN "headings_complete"');
    expect(m5DocumentProvenance).toContain('ADD COLUMN "title_tag_count"');
    expect(m5EncodingBoundary).toContain(
      '"character_encoding_declaration_offset" between 0 and 2048',
    );
    expect(m5VisibleTextProvenance).toContain('ADD COLUMN "visible_text_complete"');
    expect(m5VisibleTextProvenance).toContain(
      'CONSTRAINT "page_extract_visible_text_provenance_check"',
    );
    expect(auditEligibilityHardening).toContain("\"eligibility\" in ('ineligible', 'unavailable')");
    expect(m4AuditOutbox).toContain("('crawl.execute', 'crawl.dead-letter', 'audit.evaluate')");
    expect(m4UnavailablePageCoverage).toContain(
      'ALTER TABLE "audit_finding_occurrences" DROP CONSTRAINT "audit_occurrences_scope_check"',
    );
    expect(m4UnavailablePageCoverage).toContain("'not_checked'");
    expect(m4UnavailablePageCoverage).toContain("'ineligible', 'unavailable'");
    expect(m4RuleDefinitionCompleteness).toContain('ADD COLUMN "expected_value"');
    expect(m4RuleDefinitionCompleteness).toContain('ADD COLUMN "default_confidence"');
    expect(m4MissingData).toContain('ADD COLUMN "missing_data"');
    expect(m4MissingData).toContain('CONSTRAINT "audit_occurrences_missing_data_check"');
    expect(m4DirectiveScope).toContain(
      'ADD COLUMN "directive_scope_preserved" boolean DEFAULT false NOT NULL',
    );
    expect(m4ExtractionProvenance).toContain(
      "CREATE TYPE \"public\".\"page_extraction_status\" AS ENUM('succeeded', 'failed')",
    );
    expect(m4ExtractionProvenance).toContain(
      'ADD COLUMN "status" "page_extraction_status" DEFAULT \'failed\' NOT NULL',
    );
    expect(m4CanonicalProvenance).toContain('ADD COLUMN "canonical_normalization_failure_code"');
    expect(m4ResourceRobotsProvenance).toContain(
      'CONSTRAINT "page_resources_robots_provenance_check"',
    );
    expect(m4CollectionProvenance).toContain('ADD COLUMN "links_complete"');
    expect(m4CollectionProvenance).toContain('ADD COLUMN "html_detected"');
    expect(m4CollectionProvenance).toContain('ADD COLUMN "robots_observation_id" uuid');
    expect(m4CollectionProvenance).toContain('CONSTRAINT "crawl_pages_robots_provenance_check"');
    expect(m4CollectionProvenance).toContain('CONSTRAINT "crawl_sitemaps_robots_provenance_check"');
    expect(
      m4CollectionProvenance.indexOf('UPDATE "crawl_pages" SET "robots_decision"'),
    ).toBeGreaterThan(-1);
    expect(
      m4CollectionProvenance.indexOf('UPDATE "crawl_pages" SET "robots_decision"'),
    ).toBeLessThan(
      m4CollectionProvenance.indexOf('ADD CONSTRAINT "crawl_pages_robots_provenance_check"'),
    );
    expect(auditEligibilityHardening).toContain("SET \"eligibility\" = 'unavailable'");
    expect(auditEligibilityHardening.indexOf("SET \"eligibility\" = 'unavailable'")).toBeLessThan(
      auditEligibilityHardening.indexOf('ADD CONSTRAINT "audit_occurrences_result_check"'),
    );
    expect(auditHashProvenance).toContain('ADD COLUMN "report_hash_integrity"');
    expect(auditHashProvenance).toContain("SET \"report_hash_integrity\" = 'legacy_unverifiable'");
    expect(auditHashProvenance).toContain(
      'CREATE INDEX "audit_eval_runs_tenant_project_snapshot_idx"',
    );
  });

  it("applies cleanly to an empty embedded PostgreSQL database and is idempotent", async () => {
    const client = await createMigratedDatabase();
    const database = drizzle(client);

    await migrate(database, { migrationsFolder });

    const tables = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );

    expect(tables.rows.map((row) => row.tablename)).toEqual(
      expect.arrayContaining([
        "accounts",
        "audit_evaluation_runs",
        "audit_finding_occurrences",
        "audit_findings",
        "audit_logs",
        "audit_rule_versions",
        "audit_rules",
        "auth_rate_limits",
        "crawl_configs",
        "crawl_checkpoints",
        "crawl_frontier",
        "crawl_pages",
        "crawl_page_artifacts",
        "crawl_page_extractions",
        "crawl_page_headings",
        "crawl_page_images",
        "crawl_page_links",
        "crawl_page_resources",
        "crawl_page_structured_data",
        "crawl_robots",
        "crawl_sitemap_entries",
        "crawl_sitemaps",
        "crawl_usage_reservations",
        "crawls",
        "invitations",
        "job_outbox",
        "membership_project_scopes",
        "memberships",
        "organizations",
        "project_verifications",
        "projects",
        "sessions",
        "users",
        "verifications",
      ]),
    );

    const migrationRows = await client.query<{ count: number }>(
      'select count(*)::int as count from "drizzle"."__drizzle_migrations"',
    );
    expect(migrationRows.rows[0]?.count).toBe(22);
  });

  it("rejects eligible not-checked occurrences at the database constraint boundary", async () => {
    const client = await createMigratedDatabase();
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const configId = crypto.randomUUID();
    const crawlId = crypto.randomUUID();
    const evaluationRunId = crypto.randomUUID();

    await client.query(
      `insert into users (id, name, email) values ($1, 'Owner', 'audit-eligibility@example.com')`,
      [userId],
    );
    await client.query(
      `insert into organizations (id, name, slug, created_by_user_id) values ($1, 'Audit Eligibility', 'audit-eligibility-test', $2)`,
      [organizationId, userId],
    );
    await client.query(
      `insert into memberships (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')`,
      [membershipId, organizationId, userId],
    );
    await client.query(
      `insert into projects (id, organization_id, name, normalized_origin, normalized_hostname, protocol, created_by_membership_id) values ($1, $2, 'Audit Eligibility', 'https://audit-eligibility.example', 'audit-eligibility.example', 'https:', $3)`,
      [projectId, organizationId, membershipId],
    );
    await client.query(
      `insert into crawl_configs (id, organization_id, project_id, created_by_membership_id, updated_by_membership_id) values ($1, $2, $3, $4, $4)`,
      [configId, organizationId, projectId, membershipId],
    );
    await client.query(
      `insert into crawls (id, organization_id, project_id, requested_by_membership_id, crawl_config_id, config_snapshot, idempotency_key_hash, trace_id) values ($1, $2, $3, $4, $5, '{}'::jsonb, $6, 'audit-eligibility-trace')`,
      [crawlId, organizationId, projectId, membershipId, configId, "a".repeat(64)],
    );
    await client.query(`insert into audit_rules (id) values ('CRW-001')`);
    await client.query(
      `insert into audit_rule_versions (rule_id, version, title, description, category, default_severity, default_confidence, scope, deterministic, eligibility_description, required_data, explanation, expected_value, recommended_fix, verification_method, impact_areas, responsible_owner, first_supported_version, definition_hash) values ('CRW-001', 1, 'Eligibility fixture', 'Eligibility fixture description.', 'crawlability', 'high', 'high', 'site', true, 'A crawl observation is available.', array['crawl'], 'Eligibility fixture explanation.', 'An explicit eligibility state.', 'Collect the required crawl observation.', 'Run the rule again.', array['search-visibility'], 'developer', 'M4A', $1)`,
      ["b".repeat(64)],
    );
    await client.query(
      `insert into audit_evaluation_runs (id, organization_id, project_id, crawl_id, engine_version, catalog_hash, report_hash, rule_manifest, snapshot_at) values ($1, $2, $3, $4, 1, $5, $6, $7::jsonb, now())`,
      [
        evaluationRunId,
        organizationId,
        projectId,
        crawlId,
        "c".repeat(64),
        "d".repeat(64),
        JSON.stringify([{ ruleId: "CRW-001", ruleVersion: 1, definitionHash: "b".repeat(64) }]),
      ],
    );

    const occurrenceSql = `insert into audit_finding_occurrences (organization_id, project_id, crawl_id, evaluation_run_id, rule_id, rule_version, scope, scope_key, scope_key_hash, eligibility, result_status, lifecycle, severity, not_evaluated_reason_code, not_evaluated_reason, explanation, recommended_fix, impact_areas, responsible_owner, evaluated_at) values ($1, $2, $3, $4, 'CRW-001', 1, 'site', $5, $6, $7, 'not_checked', 'not_evaluated', 'high', 'required_data_unavailable', 'The required crawl observation is unavailable.', 'Eligibility fixture explanation.', 'Collect the required crawl observation.', array['search-visibility'], 'developer', now())`;
    await expect(
      client.query(occurrenceSql, [
        organizationId,
        projectId,
        crawlId,
        evaluationRunId,
        "https://audit-eligibility.example#unavailable",
        "e".repeat(64),
        "unavailable",
      ]),
    ).resolves.toBeDefined();
    await expect(
      client.query(occurrenceSql, [
        organizationId,
        projectId,
        crawlId,
        evaluationRunId,
        "https://audit-eligibility.example#eligible",
        "f".repeat(64),
        "eligible",
      ]),
    ).rejects.toThrow(/audit_occurrences_result_check/iu);
  });

  it("upgrades a populated M3 database without invalidating legacy sitemap evidence", async () => {
    const client = new PGlite();
    clients.push(client);
    for (const migration of [
      "0000_m0-foundation.sql",
      "0001_m1-auth-organizations-projects.sql",
      "0002_m2-safe-crawler-queue.sql",
      "0003_m3-page-extraction-persistence.sql",
    ]) {
      await applyMigrationScript(client, migration);
    }

    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const configId = crypto.randomUUID();
    const crawlId = crypto.randomUUID();
    const frontierId = crypto.randomUUID();
    const pageId = crypto.randomUUID();
    const unavailableRobotsId = crypto.randomUUID();
    const fetchedWithoutDigestRobotsId = crypto.randomUUID();
    const fetchedWithDigestRobotsId = crypto.randomUUID();
    const provenRobotsContent = "User-agent: *\nAllow: /";
    const provenRobotsDigest = createHash("sha256").update(provenRobotsContent).digest("hex");
    await client.query(
      `insert into users (id, name, email) values ($1, 'Owner', 'upgrade@example.com')`,
      [userId],
    );
    await client.query(
      `insert into organizations (id, name, slug, created_by_user_id) values ($1, 'Upgrade', 'upgrade-test', $2)`,
      [organizationId, userId],
    );
    await client.query(
      `insert into memberships (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')`,
      [membershipId, organizationId, userId],
    );
    await client.query(
      `insert into projects (id, organization_id, name, normalized_origin, normalized_hostname, protocol, created_by_membership_id) values ($1, $2, 'Upgrade', 'https://upgrade.example', 'upgrade.example', 'https:', $3)`,
      [projectId, organizationId, membershipId],
    );
    await client.query(
      `insert into crawl_configs (id, organization_id, project_id, created_by_membership_id, updated_by_membership_id) values ($1, $2, $3, $4, $4)`,
      [configId, organizationId, projectId, membershipId],
    );
    await client.query(
      `insert into crawls (id, organization_id, project_id, requested_by_membership_id, crawl_config_id, config_snapshot, idempotency_key_hash, trace_id) values ($1, $2, $3, $4, $5, '{}'::jsonb, $6, 'upgrade-trace')`,
      [crawlId, organizationId, projectId, membershipId, configId, "a".repeat(64)],
    );
    await client.query(
      `insert into crawl_frontier (id, organization_id, project_id, crawl_id, origin, hostname, requested_url, discovered_url, normalized_url, url_hash, depth, discovery_source, state, robots_decision) values ($1, $2, $3, $4, 'https://upgrade.example', 'upgrade.example', 'https://upgrade.example/', 'https://upgrade.example/', 'https://upgrade.example/', $5, 0, 'seed', 'fetched', 'allowed')`,
      [frontierId, organizationId, projectId, crawlId, "c".repeat(64)],
    );
    await client.query(
      `insert into crawl_pages (id, organization_id, project_id, crawl_id, frontier_id, requested_url, normalized_url, final_url, url_hash, status_code, content_type, response_bytes, depth, robots_decision, discovery_source) values ($1, $2, $3, $4, $5, 'https://upgrade.example/', 'https://upgrade.example/', 'https://upgrade.example/', $6, 200, 'text/html', 128, 0, 'allowed', 'seed')`,
      [pageId, organizationId, projectId, crawlId, frontierId, "c".repeat(64)],
    );
    await client.query(
      `insert into crawl_page_extractions (organization_id, project_id, crawl_id, page_id, source, meta_robots, x_robots_tag) values ($1, $2, $3, $4, 'raw', array['index'], array['noindex'])`,
      [organizationId, projectId, crawlId, pageId],
    );
    await client.query(
      `insert into crawl_robots (id, organization_id, project_id, crawl_id, origin, hostname, requested_url, result, user_agent, content_sha256, content) values ($1, $2, $3, $4, 'https://upgrade.example', 'upgrade.example', 'https://upgrade.example/robots.txt', 'unavailable', 'SearviaBot/1.0', $5, 'Legacy unavailable content')`,
      [unavailableRobotsId, organizationId, projectId, crawlId, "d".repeat(64)],
    );
    await client.query(
      `insert into crawl_robots (id, organization_id, project_id, crawl_id, origin, hostname, requested_url, result, user_agent, content) values ($1, $2, $3, $4, 'https://www.upgrade.example', 'www.upgrade.example', 'https://www.upgrade.example/robots.txt', 'fetched', 'SearviaBot/1.0', 'Legacy fetched content without a digest')`,
      [fetchedWithoutDigestRobotsId, organizationId, projectId, crawlId],
    );
    await client.query(
      `insert into crawl_robots (id, organization_id, project_id, crawl_id, origin, hostname, requested_url, result, user_agent, content_sha256, content) values ($1, $2, $3, $4, 'https://valid.upgrade.example', 'valid.upgrade.example', 'https://valid.upgrade.example/robots.txt', 'fetched', 'SearviaBot/1.0', $5, $6)`,
      [
        fetchedWithDigestRobotsId,
        organizationId,
        projectId,
        crawlId,
        provenRobotsDigest,
        provenRobotsContent,
      ],
    );
    await client.query(
      `insert into crawl_sitemaps (organization_id, project_id, crawl_id, requested_url, normalized_url, final_url, url_hash, source, status, format, status_code, content_type, transfer_size, depth, parsed_at) values ($1, $2, $3, 'https://upgrade.example/sitemap.xml', 'https://upgrade.example/sitemap.xml', 'https://upgrade.example/sitemap.xml', $4, 'default', 'parsed', 'urlset', 200, 'application/xml', 128, 0, now())`,
      [organizationId, projectId, crawlId, "b".repeat(64)],
    );

    await applyMigrationScript(client, "0004_equal_ultimates.sql");
    await applyMigrationScript(client, "0012_married_korvac.sql");
    await applyMigrationScript(client, "0013_m4a_extraction_provenance.sql");
    await applyMigrationScript(client, "0014_classy_tombstone.sql");
    await applyMigrationScript(client, "0015_petite_gabe_jones.sql");
    await applyMigrationScript(client, "0016_flowery_lady_mastermind.sql");
    await applyMigrationScript(client, "0017_unknown_goblin_queen.sql");
    await applyMigrationScript(client, "0018_puzzling_phil_sheldon.sql");
    await applyMigrationScript(client, "0019_productive_daimon_hellstrom.sql");

    const upgraded = await client.query<{ content_digest: string | null; parse_issues: unknown }>(
      `select content_digest, parse_issues from crawl_sitemaps where crawl_id = $1`,
      [crawlId],
    );
    expect(upgraded.rows).toEqual([{ content_digest: null, parse_issues: [] }]);
    const legacyExtraction = await client.query<{
      canonical_normalization_failure_code: string | null;
      document_metadata_complete: boolean;
      directive_scope_preserved: boolean;
      headings_complete: boolean;
      links_complete: boolean;
      status: string;
      visible_text_complete: boolean;
    }>(
      `select canonical_normalization_failure_code, document_metadata_complete, directive_scope_preserved, headings_complete, links_complete, status, visible_text_complete from crawl_page_extractions where page_id = $1`,
      [pageId],
    );
    expect(legacyExtraction.rows).toEqual([
      {
        canonical_normalization_failure_code: null,
        document_metadata_complete: false,
        directive_scope_preserved: false,
        headings_complete: false,
        links_complete: false,
        status: "failed",
        visible_text_complete: false,
      },
    ]);
    const legacyPage = await client.query<{
      html_detected: boolean | null;
      robots_decision: string;
      robots_observation_id: string | null;
    }>(
      `select html_detected, robots_decision, robots_observation_id from crawl_pages where id = $1`,
      [pageId],
    );
    expect(legacyPage.rows).toEqual([
      { html_detected: null, robots_decision: "not_checked", robots_observation_id: null },
    ]);
    const legacySitemap = await client.query<{
      robots_decision: string;
      robots_observation_id: string | null;
    }>(`select robots_decision, robots_observation_id from crawl_sitemaps where crawl_id = $1`, [
      crawlId,
    ]);
    expect(legacySitemap.rows).toEqual([
      { robots_decision: "not_checked", robots_observation_id: null },
    ]);
    const legacyRobots = await client.query<{
      id: string;
      content: string | null;
      content_sha256: string | null;
    }>(`select id, content, content_sha256 from crawl_robots where crawl_id = $1 order by id`, [
      crawlId,
    ]);
    expect(legacyRobots.rows).toEqual(
      [
        { id: unavailableRobotsId, content: null, content_sha256: null },
        { id: fetchedWithoutDigestRobotsId, content: null, content_sha256: null },
        {
          id: fetchedWithDigestRobotsId,
          content: provenRobotsContent,
          content_sha256: provenRobotsDigest,
        },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
  });

  it("upgrades populated 0007 audit definitions without rewriting historical semantics", async () => {
    const client = new PGlite();
    clients.push(client);
    for (const migration of [
      "0000_m0-foundation.sql",
      "0001_m1-auth-organizations-projects.sql",
      "0002_m2-safe-crawler-queue.sql",
      "0003_m3-page-extraction-persistence.sql",
      "0004_equal_ultimates.sql",
      "0005_m2_review_hardening.sql",
      "0006_m2_queue_invariants.sql",
      "0007_dashing_madripoor.sql",
    ]) {
      await applyMigrationScript(client, migration);
    }

    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const configId = crypto.randomUUID();
    const crawlId = crypto.randomUUID();
    const evaluationRunId = crypto.randomUUID();
    const occurrenceId = crypto.randomUUID();
    const legacyNotCheckedId = crypto.randomUUID();
    const definitionHash = "c".repeat(64);
    const scopeKeyHash = "d".repeat(64);

    await client.query(
      `insert into users (id, name, email) values ($1, 'Owner', 'audit-upgrade@example.com')`,
      [userId],
    );
    await client.query(
      `insert into organizations (id, name, slug, created_by_user_id) values ($1, 'Audit Upgrade', 'audit-upgrade-test', $2)`,
      [organizationId, userId],
    );
    await client.query(
      `insert into memberships (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')`,
      [membershipId, organizationId, userId],
    );
    await client.query(
      `insert into projects (id, organization_id, name, normalized_origin, normalized_hostname, protocol, created_by_membership_id) values ($1, $2, 'Audit Upgrade', 'https://audit-upgrade.example', 'audit-upgrade.example', 'https:', $3)`,
      [projectId, organizationId, membershipId],
    );
    await client.query(
      `insert into crawl_configs (id, organization_id, project_id, created_by_membership_id, updated_by_membership_id) values ($1, $2, $3, $4, $4)`,
      [configId, organizationId, projectId, membershipId],
    );
    await client.query(
      `insert into crawls (id, organization_id, project_id, requested_by_membership_id, crawl_config_id, config_snapshot, idempotency_key_hash, trace_id) values ($1, $2, $3, $4, $5, '{}'::jsonb, $6, 'audit-upgrade-trace')`,
      [crawlId, organizationId, projectId, membershipId, configId, "a".repeat(64)],
    );
    await client.query(`insert into audit_rules (id) values ('CRW-001')`);
    await client.query(
      `insert into audit_rule_versions (rule_id, version, title, category, default_severity, scope, deterministic, eligibility_description, required_data, explanation, recommended_fix, verification_method, impact_areas, responsible_owner, definition_hash) values ('CRW-001', 1, 'Legacy crawl reachability', 'crawlability', 'high', 'site', true, 'A completed crawl is available.', array['transport'], 'Legacy explanation.', 'Legacy fix.', 'Legacy verification.', array['crawlability'], 'engineering', $1)`,
      [definitionHash],
    );
    await client.query(
      `insert into audit_evaluation_runs (id, organization_id, project_id, crawl_id, engine_version, catalog_hash, report_hash, rule_manifest, status, result_count, eligible_count, evaluated_count, passed_count, not_checked_count, snapshot_at, finished_at) values ($1, $2, $3, $4, 1, $5, $6, $7::jsonb, 'completed', 2, 2, 1, 1, 1, now(), now())`,
      [
        evaluationRunId,
        organizationId,
        projectId,
        crawlId,
        "e".repeat(64),
        "f".repeat(64),
        JSON.stringify([{ ruleId: "CRW-001", ruleVersion: 1, definitionHash }]),
      ],
    );
    await client.query(
      `insert into audit_finding_occurrences (id, organization_id, project_id, crawl_id, evaluation_run_id, rule_id, rule_version, scope, scope_key, scope_key_hash, eligibility, result_status, severity, confidence, evidence, explanation, recommended_fix, impact_areas, responsible_owner, evaluated_at) values ($1, $2, $3, $4, $5, 'CRW-001', 1, 'site', 'https://audit-upgrade.example#site', $6, 'eligible', 'passed', 'high', 'high', '[]'::jsonb, 'Legacy result explanation.', 'Legacy result fix.', array['crawlability'], 'engineering', now())`,
      [occurrenceId, organizationId, projectId, crawlId, evaluationRunId, scopeKeyHash],
    );

    for (const migration of [
      "0008_sparkling_quasimodo.sql",
      "0009_last_archangel.sql",
      "0010_dear_magus.sql",
      "0011_lonely_master_chief.sql",
    ]) {
      await applyMigrationScript(client, migration);
    }

    await client.query(
      `insert into audit_finding_occurrences (id, organization_id, project_id, crawl_id, evaluation_run_id, rule_id, rule_version, scope, scope_key, scope_key_hash, eligibility, result_status, lifecycle, severity, missing_data, not_evaluated_reason_code, not_evaluated_reason, evidence, explanation, recommended_fix, impact_areas, responsible_owner, evaluated_at) values ($1, $2, $3, $4, $5, 'CRW-001', 1, 'site', 'https://audit-upgrade.example#legacy-not-checked', $6, 'eligible', 'not_checked', 'not_evaluated', 'high', array['transport'], 'required_data_unavailable', 'The legacy detector did not check the required transport evidence.', '[]'::jsonb, 'Legacy not-checked explanation.', 'Collect the missing transport evidence.', array['crawlability'], 'engineering', now())`,
      [legacyNotCheckedId, organizationId, projectId, crawlId, evaluationRunId, "9".repeat(64)],
    );

    for (const migration of [
      "0012_married_korvac.sql",
      "0013_m4a_extraction_provenance.sql",
      "0014_classy_tombstone.sql",
      "0015_petite_gabe_jones.sql",
      "0016_flowery_lady_mastermind.sql",
      "0017_unknown_goblin_queen.sql",
      "0018_puzzling_phil_sheldon.sql",
      "0019_productive_daimon_hellstrom.sql",
      "0020_conscious_odin.sql",
      "0021_living_the_hunter.sql",
    ]) {
      await applyMigrationScript(client, migration);
    }

    const upgraded = await client.query<{
      title: string;
      description: string;
      default_confidence: string;
      expected_value: string;
      first_supported_version: string;
      definition_hash: string;
    }>(
      `select title, description, default_confidence, expected_value, first_supported_version, definition_hash from audit_rule_versions where rule_id = 'CRW-001' and version = 1`,
    );
    expect(upgraded.rows).toEqual([
      {
        title: "Legacy crawl reachability",
        description: "Legacy explanation.",
        default_confidence: "low",
        expected_value:
          "Legacy rule version did not persist a separate expected value before migration 0010. Verification method: Legacy verification.",
        first_supported_version: "M4A",
        definition_hash: definitionHash,
      },
    ]);

    const occurrence = await client.query<{ rule_id: string; missing_data: string[] }>(
      `select rule_id, missing_data from audit_finding_occurrences where id = $1`,
      [occurrenceId],
    );
    expect(occurrence.rows).toEqual([{ rule_id: "CRW-001", missing_data: [] }]);

    const legacyNotChecked = await client.query<{
      eligibility: string;
      not_evaluated_reason: string;
    }>(`select eligibility, not_evaluated_reason from audit_finding_occurrences where id = $1`, [
      legacyNotCheckedId,
    ]);
    expect(legacyNotChecked.rows).toEqual([
      {
        eligibility: "unavailable",
        not_evaluated_reason: "The legacy detector did not check the required transport evidence.",
      },
    ]);
    const correctedRun = await client.query<{
      eligible_count: number;
      evaluated_count: number;
      not_checked_count: number;
      report_hash: string;
      report_hash_integrity: string;
      result_count: number;
    }>(
      `select eligible_count, evaluated_count, not_checked_count, report_hash, report_hash_integrity, result_count from audit_evaluation_runs where id = $1`,
      [evaluationRunId],
    );
    expect(correctedRun.rows).toEqual([
      {
        eligible_count: 1,
        evaluated_count: 1,
        not_checked_count: 1,
        report_hash: "f".repeat(64),
        report_hash_integrity: "legacy_unverifiable",
        result_count: 2,
      },
    ]);

    const requiredColumns = await client.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'audit_rule_versions' and column_name in ('description', 'default_confidence', 'expected_value', 'first_supported_version') order by column_name`,
    );
    expect(requiredColumns.rows).toEqual([
      { column_name: "default_confidence", is_nullable: "NO" },
      { column_name: "description", is_nullable: "NO" },
      { column_name: "expected_value", is_nullable: "NO" },
      { column_name: "first_supported_version", is_nullable: "NO" },
    ]);

    await expect(
      client.query(
        `update audit_rule_versions set title = 'Rewritten' where rule_id = 'CRW-001' and version = 1`,
      ),
    ).rejects.toThrow(/immutable/iu);
  });

  it("enforces owner, tenant, project, and crawl constraints", async () => {
    const client = await createMigratedDatabase();
    const ownerOne = crypto.randomUUID();
    const ownerTwo = crypto.randomUUID();
    const organizationOne = crypto.randomUUID();
    const organizationTwo = crypto.randomUUID();
    const membershipOne = crypto.randomUUID();
    const membershipTwo = crypto.randomUUID();
    const projectOne = crypto.randomUUID();
    const projectTwo = crypto.randomUUID();
    const configOne = crypto.randomUUID();
    const configTwo = crypto.randomUUID();
    const crawlOne = crypto.randomUUID();

    await client.query(
      `insert into users (id, name, email) values ($1, 'Owner one', 'owner-one@example.com'), ($2, 'Owner two', 'owner-two@example.com')`,
      [ownerOne, ownerTwo],
    );
    await client.query(
      `insert into organizations (id, name, slug, created_by_user_id) values ($1, 'One', 'one-workspace', $3), ($2, 'Two', 'two-workspace', $4)`,
      [organizationOne, organizationTwo, ownerOne, ownerTwo],
    );
    await client.query(
      `insert into memberships (id, organization_id, user_id, role) values ($1, $2, $3, 'owner'), ($4, $5, $6, 'owner')`,
      [membershipOne, organizationOne, ownerOne, membershipTwo, organizationTwo, ownerTwo],
    );
    await client.query(
      `insert into projects (id, organization_id, name, normalized_origin, normalized_hostname, protocol, created_by_membership_id) values ($1, $2, 'One', 'https://example.com', 'example.com', 'https:', $3), ($4, $5, 'Two', 'https://example.com', 'example.com', 'https:', $6)`,
      [projectOne, organizationOne, membershipOne, projectTwo, organizationTwo, membershipTwo],
    );
    await client.query(
      `insert into crawl_configs (id, organization_id, project_id, created_by_membership_id, updated_by_membership_id) values ($1, $2, $3, $4, $4), ($5, $6, $7, $8, $8)`,
      [
        configOne,
        organizationOne,
        projectOne,
        membershipOne,
        configTwo,
        organizationTwo,
        projectTwo,
        membershipTwo,
      ],
    );
    await client.query(
      `insert into crawls (id, organization_id, project_id, requested_by_membership_id, crawl_config_id, config_snapshot, idempotency_key_hash, trace_id) values ($1, $2, $3, $4, $5, '{}'::jsonb, $6, 'trace-crawl-one')`,
      [crawlOne, organizationOne, projectOne, membershipOne, configOne, "a".repeat(64)],
    );

    await expect(
      client.query(
        `insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`,
        [organizationOne, ownerTwo],
      ),
    ).rejects.toThrow();

    await expect(
      client.query(
        `insert into crawl_configs (organization_id, project_id, page_limit, created_by_membership_id, updated_by_membership_id) values ($1, $2, 100, $3, $3)`,
        [organizationOne, projectTwo, membershipOne],
      ),
    ).rejects.toThrow();

    await expect(
      client.query(
        `insert into crawl_configs (organization_id, project_id, page_limit, created_by_membership_id, updated_by_membership_id) values ($1, $2, 101, $3, $3)`,
        [organizationOne, projectOne, membershipOne],
      ),
    ).rejects.toThrow();

    await expect(
      client.query(
        `insert into crawls (organization_id, project_id, requested_by_membership_id, crawl_config_id, config_snapshot, idempotency_key_hash, trace_id) values ($1, $2, $3, $4, '{}'::jsonb, $5, 'trace-cross-tenant')`,
        [organizationOne, projectTwo, membershipOne, configTwo, "b".repeat(64)],
      ),
    ).rejects.toThrow();

    await expect(
      client.query(
        `insert into job_outbox (organization_id, project_id, crawl_id, job_type, contract_version, payload, idempotency_key, trace_id) values ($1, $2, $3, 'crawl.execute', 1, '{}'::jsonb, 'cross-tenant-job', 'trace-cross-tenant')`,
        [organizationTwo, projectTwo, crawlOne],
      ),
    ).rejects.toThrow();

    await expect(
      client.query(`update crawls set queue_job_id = $1 where id = $2`, [
        `crawl-${crawlOne}`,
        crawlOne,
      ]),
    ).rejects.toThrow();
  });

  it("keeps audit records append-only", async () => {
    const client = await createMigratedDatabase();
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const auditId = crypto.randomUUID();

    await client.query(
      `insert into users (id, name, email) values ($1, 'Owner', 'owner@example.com')`,
      [userId],
    );
    await client.query(
      `insert into organizations (id, name, slug, created_by_user_id) values ($1, 'Workspace', 'workspace-test', $2)`,
      [organizationId, userId],
    );
    await client.query(
      `insert into memberships (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')`,
      [membershipId, organizationId, userId],
    );
    await client.query(
      `insert into audit_logs (id, organization_id, actor_user_id, actor_membership_id, action, target_type, target_id, trace_id) values ($1, $2, $3, $4, 'organization.created', 'organization', $2, 'trace-12345678')`,
      [auditId, organizationId, userId, membershipId],
    );

    await expect(
      client.query(`update audit_logs set action = 'tampered' where id = $1`, [auditId]),
    ).rejects.toThrow(/append-only/iu);
    await expect(client.query(`delete from audit_logs where id = $1`, [auditId])).rejects.toThrow(
      /append-only/iu,
    );
  });
});
