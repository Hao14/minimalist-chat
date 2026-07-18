CREATE TYPE "public"."audit_report_hash_integrity" AS ENUM('verified', 'legacy_unverifiable');--> statement-breakpoint
ALTER TABLE "audit_evaluation_runs" ADD COLUMN "report_hash_integrity" "audit_report_hash_integrity" DEFAULT 'verified' NOT NULL;--> statement-breakpoint
UPDATE "audit_evaluation_runs" SET "report_hash_integrity" = 'legacy_unverifiable';--> statement-breakpoint
CREATE INDEX "audit_eval_runs_tenant_project_snapshot_idx" ON "audit_evaluation_runs" USING btree ("organization_id","project_id","snapshot_at","crawl_id");
