CREATE TYPE "public"."audit_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."audit_eligibility" AS ENUM('eligible', 'ineligible', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."audit_evaluation_status" AS ENUM('running', 'completed', 'partially_completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."audit_finding_disposition" AS ENUM('open', 'ignored', 'accepted_risk');--> statement-breakpoint
CREATE TYPE "public"."audit_finding_lifecycle" AS ENUM('new', 'existing', 'returned', 'fixed', 'not_evaluated');--> statement-breakpoint
CREATE TYPE "public"."audit_result_status" AS ENUM('passed', 'failed', 'warning', 'opportunity', 'manual_review', 'not_checked');--> statement-breakpoint
CREATE TYPE "public"."audit_rule_scope" AS ENUM('page', 'site');--> statement-breakpoint
CREATE TYPE "public"."audit_severity" AS ENUM('critical', 'high', 'medium', 'low', 'opportunity', 'manual_review');--> statement-breakpoint
CREATE TABLE "audit_evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"engine_version" integer NOT NULL,
	"catalog_hash" text NOT NULL,
	"report_hash" text NOT NULL,
	"rule_manifest" jsonb NOT NULL,
	"status" "audit_evaluation_status" DEFAULT 'running' NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"evaluated_count" integer DEFAULT 0 NOT NULL,
	"passed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"opportunity_count" integer DEFAULT 0 NOT NULL,
	"manual_review_count" integer DEFAULT 0 NOT NULL,
	"not_checked_count" integer DEFAULT 0 NOT NULL,
	"rule_error_count" integer DEFAULT 0 NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_type" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_eval_runs_tenant_crawl_unique" UNIQUE("organization_id","project_id","crawl_id"),
	CONSTRAINT "audit_eval_runs_tenant_crawl_id_unique" UNIQUE("organization_id","project_id","crawl_id","id"),
	CONSTRAINT "audit_eval_runs_engine_version_check" CHECK ("audit_evaluation_runs"."engine_version" >= 1),
	CONSTRAINT "audit_eval_runs_hash_check" CHECK (length("audit_evaluation_runs"."catalog_hash") = 64 and length("audit_evaluation_runs"."report_hash") = 64),
	CONSTRAINT "audit_eval_runs_manifest_check" CHECK (jsonb_typeof("audit_evaluation_runs"."rule_manifest") = 'array' and jsonb_array_length("audit_evaluation_runs"."rule_manifest") between 1 and 500 and octet_length("audit_evaluation_runs"."rule_manifest"::text) <= 131072),
	CONSTRAINT "audit_eval_runs_counts_check" CHECK ("audit_evaluation_runs"."result_count" >= 0 and "audit_evaluation_runs"."eligible_count" >= 0 and "audit_evaluation_runs"."evaluated_count" >= 0 and "audit_evaluation_runs"."passed_count" >= 0 and "audit_evaluation_runs"."failed_count" >= 0 and "audit_evaluation_runs"."warning_count" >= 0 and "audit_evaluation_runs"."opportunity_count" >= 0 and "audit_evaluation_runs"."manual_review_count" >= 0 and "audit_evaluation_runs"."not_checked_count" >= 0 and "audit_evaluation_runs"."rule_error_count" >= 0 and "audit_evaluation_runs"."result_count" = "audit_evaluation_runs"."evaluated_count" + "audit_evaluation_runs"."not_checked_count" and "audit_evaluation_runs"."evaluated_count" = "audit_evaluation_runs"."passed_count" + "audit_evaluation_runs"."failed_count" + "audit_evaluation_runs"."warning_count" + "audit_evaluation_runs"."opportunity_count" + "audit_evaluation_runs"."manual_review_count" and "audit_evaluation_runs"."eligible_count" >= "audit_evaluation_runs"."evaluated_count" and "audit_evaluation_runs"."rule_error_count" <= "audit_evaluation_runs"."not_checked_count"),
	CONSTRAINT "audit_eval_runs_lifecycle_check" CHECK (("audit_evaluation_runs"."status" = 'running' and "audit_evaluation_runs"."finished_at" is null and "audit_evaluation_runs"."error_type" is null and "audit_evaluation_runs"."error_message" is null) or ("audit_evaluation_runs"."status" in ('completed', 'partially_completed') and "audit_evaluation_runs"."finished_at" is not null and "audit_evaluation_runs"."error_type" is null and "audit_evaluation_runs"."error_message" is null) or ("audit_evaluation_runs"."status" = 'failed' and "audit_evaluation_runs"."finished_at" is not null and "audit_evaluation_runs"."error_type" is not null and "audit_evaluation_runs"."error_message" is not null)),
	CONSTRAINT "audit_eval_runs_error_check" CHECK (("audit_evaluation_runs"."error_type" is null or length("audit_evaluation_runs"."error_type") between 1 and 120) and ("audit_evaluation_runs"."error_message" is null or length("audit_evaluation_runs"."error_message") between 1 and 2000))
);
--> statement-breakpoint
CREATE TABLE "audit_finding_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"finding_id" uuid,
	"rule_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"scope" "audit_rule_scope" NOT NULL,
	"scope_key" text NOT NULL,
	"scope_key_hash" text NOT NULL,
	"page_id" uuid,
	"normalized_url" text,
	"eligibility" "audit_eligibility" NOT NULL,
	"result_status" "audit_result_status" NOT NULL,
	"lifecycle" "audit_finding_lifecycle",
	"severity" "audit_severity" NOT NULL,
	"confidence" "audit_confidence",
	"not_evaluated_reason_code" text,
	"not_evaluated_reason" text,
	"evidence_version" integer DEFAULT 1 NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detected_value" jsonb,
	"expected_value" jsonb,
	"explanation" text NOT NULL,
	"recommended_fix" text NOT NULL,
	"impact_areas" text[] NOT NULL,
	"responsible_owner" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_occurrences_run_rule_scope_unique" UNIQUE("organization_id","project_id","evaluation_run_id","rule_id","scope_key_hash"),
	CONSTRAINT "audit_occurrences_scope_check" CHECK (("audit_finding_occurrences"."scope" = 'page' and "audit_finding_occurrences"."page_id" is not null and "audit_finding_occurrences"."normalized_url" is not null and "audit_finding_occurrences"."scope_key" = "audit_finding_occurrences"."normalized_url") or ("audit_finding_occurrences"."scope" = 'site' and "audit_finding_occurrences"."page_id" is null and "audit_finding_occurrences"."normalized_url" is null)),
	CONSTRAINT "audit_occurrences_key_check" CHECK (length("audit_finding_occurrences"."scope_key") between 1 and 4096 and length("audit_finding_occurrences"."scope_key_hash") = 64),
	CONSTRAINT "audit_occurrences_result_check" CHECK (("audit_finding_occurrences"."result_status" in ('failed', 'warning', 'opportunity', 'manual_review') and "audit_finding_occurrences"."eligibility" = 'eligible' and "audit_finding_occurrences"."lifecycle" in ('new', 'existing', 'returned') and "audit_finding_occurrences"."finding_id" is not null and "audit_finding_occurrences"."confidence" is not null and "audit_finding_occurrences"."not_evaluated_reason_code" is null and "audit_finding_occurrences"."not_evaluated_reason" is null) or ("audit_finding_occurrences"."result_status" = 'passed' and "audit_finding_occurrences"."eligibility" = 'eligible' and (("audit_finding_occurrences"."lifecycle" is null and "audit_finding_occurrences"."finding_id" is null) or ("audit_finding_occurrences"."lifecycle" = 'fixed' and "audit_finding_occurrences"."finding_id" is not null)) and "audit_finding_occurrences"."confidence" is not null and "audit_finding_occurrences"."not_evaluated_reason_code" is null and "audit_finding_occurrences"."not_evaluated_reason" is null) or ("audit_finding_occurrences"."result_status" = 'not_checked' and "audit_finding_occurrences"."lifecycle" = 'not_evaluated' and "audit_finding_occurrences"."confidence" is null and length(btrim("audit_finding_occurrences"."not_evaluated_reason_code")) between 1 and 120 and length(btrim("audit_finding_occurrences"."not_evaluated_reason")) between 1 and 2000)),
	CONSTRAINT "audit_occurrences_evidence_version_check" CHECK ("audit_finding_occurrences"."evidence_version" >= 1),
	CONSTRAINT "audit_occurrences_evidence_check" CHECK (jsonb_typeof("audit_finding_occurrences"."evidence") = 'array' and jsonb_array_length("audit_finding_occurrences"."evidence") <= 100 and octet_length("audit_finding_occurrences"."evidence"::text) <= 131072 and ("audit_finding_occurrences"."detected_value" is null or octet_length("audit_finding_occurrences"."detected_value"::text) <= 32768) and ("audit_finding_occurrences"."expected_value" is null or octet_length("audit_finding_occurrences"."expected_value"::text) <= 32768)),
	CONSTRAINT "audit_occurrences_text_check" CHECK (length(btrim("audit_finding_occurrences"."explanation")) between 1 and 8000 and length(btrim("audit_finding_occurrences"."recommended_fix")) between 1 and 8000 and cardinality("audit_finding_occurrences"."impact_areas") between 1 and 16 and array_position("audit_finding_occurrences"."impact_areas", null) is null and octet_length(array_to_string("audit_finding_occurrences"."impact_areas", E'
')) <= 4096 and length(btrim("audit_finding_occurrences"."responsible_owner")) between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "audit_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"scope" "audit_rule_scope" NOT NULL,
	"scope_key" text NOT NULL,
	"scope_key_hash" text NOT NULL,
	"normalized_url" text,
	"current_lifecycle" "audit_finding_lifecycle" NOT NULL,
	"disposition" "audit_finding_disposition" DEFAULT 'open' NOT NULL,
	"severity" "audit_severity" NOT NULL,
	"last_eligible_result_status" "audit_result_status" NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_evaluated_at" timestamp with time zone NOT NULL,
	"last_fixed_at" timestamp with time zone,
	"disposition_reason" text,
	"disposition_by_membership_id" uuid,
	"disposition_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_findings_tenant_id_unique" UNIQUE("organization_id","project_id","id"),
	CONSTRAINT "audit_findings_identity_unique" UNIQUE("organization_id","project_id","rule_id","scope_key_hash"),
	CONSTRAINT "audit_findings_occurrence_fk_unique" UNIQUE("organization_id","project_id","rule_id","scope_key_hash","id"),
	CONSTRAINT "audit_findings_scope_check" CHECK (("audit_findings"."scope" = 'page' and "audit_findings"."normalized_url" is not null and "audit_findings"."scope_key" = "audit_findings"."normalized_url") or ("audit_findings"."scope" = 'site' and "audit_findings"."normalized_url" is null)),
	CONSTRAINT "audit_findings_key_check" CHECK (length("audit_findings"."scope_key") between 1 and 4096 and length("audit_findings"."scope_key_hash") = 64),
	CONSTRAINT "audit_findings_result_check" CHECK ("audit_findings"."last_eligible_result_status" in ('passed', 'failed', 'warning', 'opportunity', 'manual_review')),
	CONSTRAINT "audit_findings_seen_check" CHECK ("audit_findings"."first_seen_at" <= "audit_findings"."last_seen_at" and "audit_findings"."last_seen_at" <= "audit_findings"."last_evaluated_at" and ("audit_findings"."last_fixed_at" is null or "audit_findings"."first_seen_at" <= "audit_findings"."last_fixed_at") and ("audit_findings"."current_lifecycle" <> 'fixed' or "audit_findings"."last_fixed_at" is not null)),
	CONSTRAINT "audit_findings_disposition_check" CHECK (("audit_findings"."disposition" = 'open' and "audit_findings"."disposition_reason" is null and "audit_findings"."disposition_by_membership_id" is null and "audit_findings"."disposition_at" is null) or ("audit_findings"."disposition" in ('ignored', 'accepted_risk') and length(btrim("audit_findings"."disposition_reason")) between 1 and 2000 and "audit_findings"."disposition_by_membership_id" is not null and "audit_findings"."disposition_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "audit_rule_versions" (
	"rule_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"default_severity" "audit_severity" NOT NULL,
	"scope" "audit_rule_scope" NOT NULL,
	"deterministic" boolean DEFAULT true NOT NULL,
	"eligibility_description" text NOT NULL,
	"required_data" text[] DEFAULT array[]::text[] NOT NULL,
	"explanation" text NOT NULL,
	"recommended_fix" text NOT NULL,
	"verification_method" text NOT NULL,
	"impact_areas" text[] DEFAULT array[]::text[] NOT NULL,
	"responsible_owner" text NOT NULL,
	"definition_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_rule_versions_pk" PRIMARY KEY("rule_id","version"),
	CONSTRAINT "audit_rule_versions_version_check" CHECK ("audit_rule_versions"."version" >= 1),
	CONSTRAINT "audit_rule_versions_text_check" CHECK (length(btrim("audit_rule_versions"."title")) between 1 and 240 and length(btrim("audit_rule_versions"."category")) between 1 and 80 and length(btrim("audit_rule_versions"."eligibility_description")) between 1 and 4000 and length(btrim("audit_rule_versions"."explanation")) between 1 and 8000 and length(btrim("audit_rule_versions"."recommended_fix")) between 1 and 8000 and length(btrim("audit_rule_versions"."verification_method")) between 1 and 4000 and length(btrim("audit_rule_versions"."responsible_owner")) between 1 and 120),
	CONSTRAINT "audit_rule_versions_collections_check" CHECK (cardinality("audit_rule_versions"."required_data") between 1 and 64 and array_position("audit_rule_versions"."required_data", null) is null and cardinality("audit_rule_versions"."impact_areas") between 1 and 16 and array_position("audit_rule_versions"."impact_areas", null) is null and octet_length(array_to_string("audit_rule_versions"."required_data", E'
')) <= 16384 and octet_length(array_to_string("audit_rule_versions"."impact_areas", E'
')) <= 4096),
	CONSTRAINT "audit_rule_versions_hash_check" CHECK (length("audit_rule_versions"."definition_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "audit_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_rules_id_check" CHECK ("audit_rules"."id" ~ '^[A-Z]{3,4}-[0-9]{3}$')
);
--> statement-breakpoint
ALTER TABLE "audit_evaluation_runs" ADD CONSTRAINT "audit_eval_runs_crawl_fk" FOREIGN KEY ("organization_id","project_id","crawl_id") REFERENCES "public"."crawls"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_finding_occurrences" ADD CONSTRAINT "audit_occurrences_run_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","evaluation_run_id") REFERENCES "public"."audit_evaluation_runs"("organization_id","project_id","crawl_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_finding_occurrences" ADD CONSTRAINT "audit_occurrences_rule_version_fk" FOREIGN KEY ("rule_id","rule_version") REFERENCES "public"."audit_rule_versions"("rule_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_finding_occurrences" ADD CONSTRAINT "audit_occurrences_finding_fk" FOREIGN KEY ("organization_id","project_id","rule_id","scope_key_hash","finding_id") REFERENCES "public"."audit_findings"("organization_id","project_id","rule_id","scope_key_hash","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_finding_occurrences" ADD CONSTRAINT "audit_occurrences_page_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","page_id") REFERENCES "public"."crawl_pages"("organization_id","project_id","crawl_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_rule_id_audit_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."audit_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_disposition_membership_fk" FOREIGN KEY ("organization_id","disposition_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_rule_versions" ADD CONSTRAINT "audit_rule_versions_rule_id_audit_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."audit_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_eval_runs_tenant_project_status_idx" ON "audit_evaluation_runs" USING btree ("organization_id","project_id","status","snapshot_at","id");--> statement-breakpoint
CREATE INDEX "audit_eval_runs_tenant_crawl_idx" ON "audit_evaluation_runs" USING btree ("organization_id","crawl_id","id");--> statement-breakpoint
CREATE INDEX "audit_occurrences_tenant_run_status_idx" ON "audit_finding_occurrences" USING btree ("organization_id","project_id","evaluation_run_id","result_status","rule_id","id");--> statement-breakpoint
CREATE INDEX "audit_occurrences_tenant_finding_history_idx" ON "audit_finding_occurrences" USING btree ("organization_id","project_id","finding_id","evaluated_at","id");--> statement-breakpoint
CREATE INDEX "audit_occurrences_tenant_page_idx" ON "audit_finding_occurrences" USING btree ("organization_id","project_id","crawl_id","page_id","result_status");--> statement-breakpoint
CREATE INDEX "audit_findings_tenant_project_state_idx" ON "audit_findings" USING btree ("organization_id","project_id","current_lifecycle","disposition","severity","last_seen_at","id");--> statement-breakpoint
CREATE INDEX "audit_findings_tenant_rule_idx" ON "audit_findings" USING btree ("organization_id","project_id","rule_id","last_evaluated_at");--> statement-breakpoint
CREATE INDEX "audit_rule_versions_category_idx" ON "audit_rule_versions" USING btree ("category","default_severity","rule_id","version");
--> statement-breakpoint
CREATE FUNCTION "prevent_audit_rule_version_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit rule versions are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_rule_versions_prevent_update_delete"
BEFORE UPDATE OR DELETE ON "audit_rule_versions"
FOR EACH ROW EXECUTE FUNCTION "prevent_audit_rule_version_mutation"();
--> statement-breakpoint
CREATE TRIGGER "audit_rule_versions_prevent_truncate"
BEFORE TRUNCATE ON "audit_rule_versions"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_audit_rule_version_mutation"();
