ALTER TABLE "audit_rule_versions" DROP CONSTRAINT "audit_rule_versions_text_check";--> statement-breakpoint
ALTER TABLE "audit_rule_versions" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "audit_rule_versions" ADD COLUMN "default_confidence" "audit_confidence";--> statement-breakpoint
ALTER TABLE "audit_rule_versions" ADD COLUMN "expected_value" text;--> statement-breakpoint
ALTER TABLE "audit_rule_versions" ADD COLUMN "first_supported_version" text;--> statement-breakpoint
-- 0007 made rule versions immutable before these definition fields existed. The
-- migration holds an ACCESS EXCLUSIVE table lock while this trigger is disabled,
-- backfills only the newly added columns, and leaves every historical field and
-- pre-0010 definition hash unchanged. A low confidence is deliberately
-- conservative; the expected-value marker records that no separate value was
-- available instead of fabricating one.
ALTER TABLE "audit_rule_versions" DISABLE TRIGGER "audit_rule_versions_prevent_update_delete";--> statement-breakpoint
UPDATE "audit_rule_versions"
SET
	"description" = "explanation",
	"default_confidence" = 'low',
	"expected_value" = 'Legacy rule version did not persist a separate expected value before migration 0010. Verification method: ' || "verification_method",
	"first_supported_version" = 'M4A';--> statement-breakpoint
ALTER TABLE "audit_rule_versions" ENABLE TRIGGER "audit_rule_versions_prevent_update_delete";--> statement-breakpoint
ALTER TABLE "audit_rule_versions" ALTER COLUMN "description" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_rule_versions" ALTER COLUMN "default_confidence" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_rule_versions" ALTER COLUMN "expected_value" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_rule_versions" ALTER COLUMN "first_supported_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_rule_versions" ADD CONSTRAINT "audit_rule_versions_text_check" CHECK (length(btrim("audit_rule_versions"."title")) between 1 and 240 and length(btrim("audit_rule_versions"."description")) between 1 and 8000 and length(btrim("audit_rule_versions"."category")) between 1 and 80 and length(btrim("audit_rule_versions"."eligibility_description")) between 1 and 4000 and length(btrim("audit_rule_versions"."explanation")) between 1 and 8000 and length(btrim("audit_rule_versions"."expected_value")) between 1 and 8000 and length(btrim("audit_rule_versions"."recommended_fix")) between 1 and 8000 and length(btrim("audit_rule_versions"."verification_method")) between 1 and 4000 and length(btrim("audit_rule_versions"."responsible_owner")) between 1 and 120 and length(btrim("audit_rule_versions"."first_supported_version")) between 1 and 120);
