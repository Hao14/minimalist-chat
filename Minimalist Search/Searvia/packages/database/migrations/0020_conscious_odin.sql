WITH "corrected_occurrences" AS (
	UPDATE "audit_finding_occurrences"
	SET "eligibility" = 'unavailable'
	WHERE "result_status" = 'not_checked'
	  AND "eligibility" = 'eligible'
	RETURNING "organization_id", "project_id", "crawl_id", "evaluation_run_id"
), "correction_counts" AS (
	SELECT "organization_id", "project_id", "crawl_id", "evaluation_run_id", count(*)::integer AS "corrected_count"
	FROM "corrected_occurrences"
	GROUP BY "organization_id", "project_id", "crawl_id", "evaluation_run_id"
)
UPDATE "audit_evaluation_runs" AS "runs"
SET "eligible_count" = "runs"."eligible_count" - "correction_counts"."corrected_count",
	"updated_at" = now()
FROM "correction_counts"
WHERE "runs"."organization_id" = "correction_counts"."organization_id"
	AND "runs"."project_id" = "correction_counts"."project_id"
	AND "runs"."crawl_id" = "correction_counts"."crawl_id"
	AND "runs"."id" = "correction_counts"."evaluation_run_id";--> statement-breakpoint
ALTER TABLE "audit_finding_occurrences" DROP CONSTRAINT "audit_occurrences_result_check";--> statement-breakpoint
ALTER TABLE "audit_finding_occurrences" ADD CONSTRAINT "audit_occurrences_result_check" CHECK (("audit_finding_occurrences"."result_status" in ('failed', 'warning', 'opportunity', 'manual_review') and "audit_finding_occurrences"."eligibility" = 'eligible' and "audit_finding_occurrences"."lifecycle" in ('new', 'existing', 'returned') and "audit_finding_occurrences"."finding_id" is not null and "audit_finding_occurrences"."confidence" is not null and cardinality("audit_finding_occurrences"."missing_data") = 0 and "audit_finding_occurrences"."not_evaluated_reason_code" is null and "audit_finding_occurrences"."not_evaluated_reason" is null) or ("audit_finding_occurrences"."result_status" = 'passed' and "audit_finding_occurrences"."eligibility" = 'eligible' and (("audit_finding_occurrences"."lifecycle" is null and "audit_finding_occurrences"."finding_id" is null) or ("audit_finding_occurrences"."lifecycle" = 'fixed' and "audit_finding_occurrences"."finding_id" is not null)) and "audit_finding_occurrences"."confidence" is not null and cardinality("audit_finding_occurrences"."missing_data") = 0 and "audit_finding_occurrences"."not_evaluated_reason_code" is null and "audit_finding_occurrences"."not_evaluated_reason" is null) or ("audit_finding_occurrences"."result_status" = 'not_checked' and "audit_finding_occurrences"."eligibility" in ('ineligible', 'unavailable') and "audit_finding_occurrences"."lifecycle" = 'not_evaluated' and "audit_finding_occurrences"."confidence" is null and length(btrim("audit_finding_occurrences"."not_evaluated_reason_code")) between 1 and 120 and length(btrim("audit_finding_occurrences"."not_evaluated_reason")) between 1 and 2000));
