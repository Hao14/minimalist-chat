CREATE TYPE "public"."audit_actor_kind" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."crawl_query_policy" AS ENUM('keep', 'ignore_tracking', 'ignore_all');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."organization_role" AS ENUM('owner', 'admin', 'analyst', 'viewer', 'client');--> statement-breakpoint
CREATE TYPE "public"."project_verification_method" AS ENUM('dns_txt', 'html_file', 'meta_tag');--> statement-breakpoint
CREATE TYPE "public"."project_verification_status" AS ENUM('unverified', 'pending', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."verification_attempt_status" AS ENUM('pending', 'verified', 'expired', 'revoked');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_provider_account_unique" UNIQUE("provider_id","account_id"),
	CONSTRAINT "accounts_credential_password_check" CHECK ("accounts"."provider_id" <> 'credential' or "accounts"."password" is not null)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_kind" "audit_actor_kind" DEFAULT 'user' NOT NULL,
	"actor_user_id" uuid,
	"actor_membership_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"trace_id" text NOT NULL,
	"metadata_version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_actor_check" CHECK (("audit_logs"."actor_kind" = 'user' and "audit_logs"."actor_user_id" is not null and "audit_logs"."actor_membership_id" is not null) or ("audit_logs"."actor_kind" = 'system' and "audit_logs"."actor_user_id" is null and "audit_logs"."actor_membership_id" is null)),
	CONSTRAINT "audit_logs_action_check" CHECK (length("audit_logs"."action") between 3 and 120),
	CONSTRAINT "audit_logs_target_type_check" CHECK (length("audit_logs"."target_type") between 2 and 80),
	CONSTRAINT "audit_logs_trace_id_check" CHECK (length("audit_logs"."trace_id") between 8 and 128),
	CONSTRAINT "audit_logs_metadata_version_check" CHECK ("audit_logs"."metadata_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key"),
	CONSTRAINT "auth_rate_limits_count_check" CHECK ("auth_rate_limits"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "crawl_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"page_limit" integer DEFAULT 100 NOT NULL,
	"max_depth" integer DEFAULT 5 NOT NULL,
	"include_subdomains" boolean DEFAULT false NOT NULL,
	"respect_robots" boolean DEFAULT true NOT NULL,
	"request_delay_ms" integer DEFAULT 250 NOT NULL,
	"concurrency" integer DEFAULT 2 NOT NULL,
	"include_patterns" text[] DEFAULT array[]::text[] NOT NULL,
	"exclude_patterns" text[] DEFAULT array[]::text[] NOT NULL,
	"query_policy" "crawl_query_policy" DEFAULT 'ignore_tracking' NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"updated_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_configs_organization_project_unique" UNIQUE("organization_id","project_id"),
	CONSTRAINT "crawl_configs_version_check" CHECK ("crawl_configs"."version" >= 1),
	CONSTRAINT "crawl_configs_page_limit_check" CHECK ("crawl_configs"."page_limit" between 1 and 100),
	CONSTRAINT "crawl_configs_max_depth_check" CHECK ("crawl_configs"."max_depth" between 0 and 10),
	CONSTRAINT "crawl_configs_respect_robots_check" CHECK ("crawl_configs"."respect_robots" = true),
	CONSTRAINT "crawl_configs_request_delay_check" CHECK ("crawl_configs"."request_delay_ms" between 250 and 60000),
	CONSTRAINT "crawl_configs_concurrency_check" CHECK ("crawl_configs"."concurrency" between 1 and 4),
	CONSTRAINT "crawl_configs_pattern_count_check" CHECK (cardinality("crawl_configs"."include_patterns") <= 50 and cardinality("crawl_configs"."exclude_patterns") <= 50)
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "organization_role" NOT NULL,
	"project_id" uuid,
	"token_hash" text NOT NULL,
	"invited_by_membership_id" uuid NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_email_normalized_check" CHECK ("invitations"."email" = lower(btrim("invitations"."email"))),
	CONSTRAINT "invitations_owner_role_check" CHECK ("invitations"."role" <> 'owner'),
	CONSTRAINT "invitations_client_project_check" CHECK (("invitations"."role" = 'client' and "invitations"."project_id" is not null) or ("invitations"."role" <> 'client' and "invitations"."project_id" is null)),
	CONSTRAINT "invitations_lifecycle_check" CHECK (("invitations"."status" = 'accepted' and "invitations"."accepted_at" is not null and "invitations"."accepted_by_user_id" is not null and "invitations"."revoked_at" is null) or ("invitations"."status" = 'revoked' and "invitations"."revoked_at" is not null and "invitations"."accepted_at" is null) or ("invitations"."status" in ('pending', 'expired') and "invitations"."accepted_at" is null and "invitations"."accepted_by_user_id" is null and "invitations"."revoked_at" is null))
);
--> statement-breakpoint
CREATE TABLE "membership_project_scopes" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"granted_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_project_scopes_pk" PRIMARY KEY("organization_id","membership_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "organization_role" NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"invited_by_membership_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_organization_user_unique" UNIQUE("organization_id","user_id"),
	CONSTRAINT "memberships_organization_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_name_not_blank_check" CHECK (length(btrim("organizations"."name")) between 1 and 160),
	CONSTRAINT "organizations_slug_format_check" CHECK ("organizations"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length("organizations"."slug") between 2 and 80)
);
--> statement-breakpoint
CREATE TABLE "project_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"method" "project_verification_method" NOT NULL,
	"status" "verification_attempt_status" DEFAULT 'pending' NOT NULL,
	"challenge_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_verifications_challenge_hash_unique" UNIQUE("challenge_hash"),
	CONSTRAINT "project_verifications_attempt_count_check" CHECK ("project_verifications"."attempt_count" >= 0),
	CONSTRAINT "project_verifications_verified_at_check" CHECK (("project_verifications"."status" = 'verified' and "project_verifications"."verified_at" is not null) or ("project_verifications"."status" <> 'verified' and "project_verifications"."verified_at" is null))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_origin" text NOT NULL,
	"normalized_hostname" text NOT NULL,
	"protocol" text NOT NULL,
	"port" text,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"verification_status" "project_verification_status" DEFAULT 'unverified' NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "projects_protocol_check" CHECK ("projects"."protocol" in ('http:', 'https:')),
	CONSTRAINT "projects_name_not_blank_check" CHECK (length(btrim("projects"."name")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_normalized_check" CHECK ("users"."email" = lower(btrim("users"."email"))),
	CONSTRAINT "users_name_not_blank_check" CHECK (length(btrim("users"."name")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_membership_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD CONSTRAINT "crawl_configs_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD CONSTRAINT "crawl_configs_creator_fk" FOREIGN KEY ("organization_id","created_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD CONSTRAINT "crawl_configs_updater_fk" FOREIGN KEY ("organization_id","updated_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_fk" FOREIGN KEY ("organization_id","invited_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_project_scopes" ADD CONSTRAINT "membership_project_scopes_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_project_scopes" ADD CONSTRAINT "membership_project_scopes_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_project_scopes" ADD CONSTRAINT "membership_project_scopes_grantor_fk" FOREIGN KEY ("organization_id","granted_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_inviter_fk" FOREIGN KEY ("organization_id","invited_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_verifications" ADD CONSTRAINT "project_verifications_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_verifications" ADD CONSTRAINT "project_verifications_creator_fk" FOREIGN KEY ("organization_id","created_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_creator_membership_fk" FOREIGN KEY ("organization_id","created_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_organization_created_idx" ON "audit_logs" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_logs_organization_target_idx" ON "audit_logs" USING btree ("organization_id","target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_membership_idx" ON "audit_logs" USING btree ("actor_membership_id");--> statement-breakpoint
CREATE INDEX "auth_rate_limits_last_request_idx" ON "auth_rate_limits" USING btree ("last_request");--> statement-breakpoint
CREATE INDEX "crawl_configs_project_idx" ON "crawl_configs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "crawl_configs_creator_idx" ON "crawl_configs" USING btree ("created_by_membership_id");--> statement-breakpoint
CREATE INDEX "crawl_configs_updater_idx" ON "crawl_configs" USING btree ("updated_by_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_organization_email_unique" ON "invitations" USING btree ("organization_id","email") WHERE "invitations"."status" = 'pending' and "invitations"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_client_project_unique" ON "invitations" USING btree ("organization_id","email","project_id") WHERE "invitations"."status" = 'pending' and "invitations"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "invitations_organization_status_expiry_idx" ON "invitations" USING btree ("organization_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "invitations_project_idx" ON "invitations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "invitations_inviter_idx" ON "invitations" USING btree ("invited_by_membership_id");--> statement-breakpoint
CREATE INDEX "invitations_accepted_user_idx" ON "invitations" USING btree ("accepted_by_user_id");--> statement-breakpoint
CREATE INDEX "membership_project_scopes_project_idx" ON "membership_project_scopes" USING btree ("organization_id","project_id","membership_id");--> statement-breakpoint
CREATE INDEX "membership_project_scopes_grantor_idx" ON "membership_project_scopes" USING btree ("granted_by_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_active_owner_unique" ON "memberships" USING btree ("organization_id") WHERE "memberships"."role" = 'owner' and "memberships"."status" = 'active';--> statement-breakpoint
CREATE INDEX "memberships_user_status_organization_idx" ON "memberships" USING btree ("user_id","status","organization_id");--> statement-breakpoint
CREATE INDEX "memberships_organization_status_role_idx" ON "memberships" USING btree ("organization_id","status","role","user_id");--> statement-breakpoint
CREATE INDEX "memberships_inviter_idx" ON "memberships" USING btree ("invited_by_membership_id");--> statement-breakpoint
CREATE INDEX "organizations_created_by_user_idx" ON "organizations" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "organizations_active_created_idx" ON "organizations" USING btree ("created_at","id") WHERE "organizations"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "project_verifications_one_pending_method_unique" ON "project_verifications" USING btree ("organization_id","project_id","method") WHERE "project_verifications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "project_verifications_project_status_idx" ON "project_verifications" USING btree ("organization_id","project_id","status");--> statement-breakpoint
CREATE INDEX "project_verifications_creator_idx" ON "project_verifications" USING btree ("created_by_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_active_origin_unique" ON "projects" USING btree ("organization_id","normalized_origin") WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "projects_active_created_idx" ON "projects" USING btree ("organization_id","created_at","id") WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "projects_organization_hostname_idx" ON "projects" USING btree ("organization_id","normalized_hostname");--> statement-breakpoint
CREATE INDEX "projects_creator_membership_idx" ON "projects" USING btree ("created_by_membership_id");--> statement-breakpoint
CREATE INDEX "sessions_user_expiry_idx" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_active_organization_idx" ON "sessions" USING btree ("active_organization_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_expiry_idx" ON "verifications" USING btree ("identifier","expires_at");--> statement-breakpoint
CREATE FUNCTION "prevent_audit_log_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_logs_prevent_update_delete"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "prevent_audit_log_mutation"();--> statement-breakpoint
CREATE TRIGGER "audit_logs_prevent_truncate"
BEFORE TRUNCATE ON "audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_audit_log_mutation"();
