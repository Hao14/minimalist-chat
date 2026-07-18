CREATE TYPE "public"."crawl_discovery_source" AS ENUM('seed', 'link', 'sitemap', 'robots_sitemap', 'redirect');--> statement-breakpoint
CREATE TYPE "public"."crawl_frontier_state" AS ENUM('discovered', 'fetching', 'fetched', 'blocked', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."crawl_status" AS ENUM('queued', 'validating', 'discovering', 'crawling', 'cancelled', 'failed', 'partially_completed', 'completed');--> statement-breakpoint
CREATE TYPE "public"."crawl_usage_reservation_status" AS ENUM('reserved', 'released', 'consumed');--> statement-breakpoint
CREATE TYPE "public"."job_outbox_status" AS ENUM('pending', 'publishing', 'published', 'cancelled', 'dead_lettered');--> statement-breakpoint
CREATE TYPE "public"."robots_decision" AS ENUM('not_checked', 'allowed', 'disallowed');--> statement-breakpoint
CREATE TYPE "public"."robots_result" AS ENUM('fetched', 'not_found', 'unavailable', 'invalid');--> statement-breakpoint
CREATE TABLE "crawl_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"current_depth" integer DEFAULT 0 NOT NULL,
	"persisted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_checkpoints_crawl_unique" UNIQUE("crawl_id"),
	CONSTRAINT "crawl_checkpoints_version_check" CHECK ("crawl_checkpoints"."version" >= 1),
	CONSTRAINT "crawl_checkpoints_depth_check" CHECK ("crawl_checkpoints"."current_depth" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "crawl_frontier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"hostname" text NOT NULL,
	"requested_url" text NOT NULL,
	"discovered_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"url_hash" text NOT NULL,
	"depth" integer NOT NULL,
	"discovery_source" "crawl_discovery_source" NOT NULL,
	"discovered_from_frontier_id" uuid,
	"state" "crawl_frontier_state" DEFAULT 'discovered' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"robots_decision" "robots_decision" DEFAULT 'not_checked' NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_type" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_frontier_tenant_crawl_id_unique" UNIQUE("organization_id","crawl_id","id"),
	CONSTRAINT "crawl_frontier_crawl_url_hash_unique" UNIQUE("crawl_id","url_hash"),
	CONSTRAINT "crawl_frontier_depth_check" CHECK ("crawl_frontier"."depth" between 0 and 10),
	CONSTRAINT "crawl_frontier_attempt_check" CHECK ("crawl_frontier"."attempt_count" between 0 and 10),
	CONSTRAINT "crawl_frontier_url_hash_check" CHECK (length("crawl_frontier"."url_hash") = 64),
	CONSTRAINT "crawl_frontier_url_length_check" CHECK (length("crawl_frontier"."requested_url") between 8 and 4096 and length("crawl_frontier"."discovered_url") between 1 and 4096 and length("crawl_frontier"."normalized_url") between 8 and 4096),
	CONSTRAINT "crawl_frontier_origin_host_check" CHECK (length("crawl_frontier"."origin") between 8 and 4096 and length("crawl_frontier"."hostname") between 1 and 253),
	CONSTRAINT "crawl_frontier_error_length_check" CHECK (("crawl_frontier"."error_type" is null or length("crawl_frontier"."error_type") between 1 and 120) and ("crawl_frontier"."error_message" is null or length("crawl_frontier"."error_message") between 1 and 2000))
);
--> statement-breakpoint
CREATE TABLE "crawl_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"frontier_id" uuid NOT NULL,
	"requested_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"final_url" text,
	"url_hash" text NOT NULL,
	"status_code" integer,
	"content_type" text,
	"response_bytes" integer DEFAULT 0 NOT NULL,
	"depth" integer NOT NULL,
	"redirect_chain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"robots_decision" "robots_decision" NOT NULL,
	"timing" jsonb,
	"error_type" text,
	"error_message" text,
	"discovery_source" "crawl_discovery_source" NOT NULL,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_pages_crawl_url_hash_unique" UNIQUE("crawl_id","url_hash"),
	CONSTRAINT "crawl_pages_frontier_unique" UNIQUE("frontier_id"),
	CONSTRAINT "crawl_pages_url_hash_check" CHECK (length("crawl_pages"."url_hash") = 64),
	CONSTRAINT "crawl_pages_depth_check" CHECK ("crawl_pages"."depth" between 0 and 10),
	CONSTRAINT "crawl_pages_response_bytes_check" CHECK ("crawl_pages"."response_bytes" between 0 and 5000000),
	CONSTRAINT "crawl_pages_status_code_check" CHECK ("crawl_pages"."status_code" is null or "crawl_pages"."status_code" between 100 and 599),
	CONSTRAINT "crawl_pages_url_length_check" CHECK (length("crawl_pages"."requested_url") between 8 and 4096 and length("crawl_pages"."normalized_url") between 8 and 4096 and ("crawl_pages"."final_url" is null or length("crawl_pages"."final_url") between 8 and 4096)),
	CONSTRAINT "crawl_pages_redirect_count_check" CHECK (jsonb_typeof("crawl_pages"."redirect_chain") = 'array' and jsonb_array_length("crawl_pages"."redirect_chain") <= 10),
	CONSTRAINT "crawl_pages_error_length_check" CHECK (("crawl_pages"."error_type" is null or length("crawl_pages"."error_type") between 1 and 120) and ("crawl_pages"."error_message" is null or length("crawl_pages"."error_message") between 1 and 2000))
);
--> statement-breakpoint
CREATE TABLE "crawl_robots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"hostname" text NOT NULL,
	"requested_url" text NOT NULL,
	"final_url" text,
	"status_code" integer,
	"content_type" text,
	"result" "robots_result" NOT NULL,
	"user_agent" text NOT NULL,
	"content_sha256" text,
	"content" text,
	"crawl_delay_ms" integer,
	"sitemap_urls" text[] DEFAULT array[]::text[] NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_robots_crawl_origin_unique" UNIQUE("crawl_id","origin"),
	CONSTRAINT "crawl_robots_origin_length_check" CHECK (length("crawl_robots"."origin") between 8 and 4096 and length("crawl_robots"."hostname") between 1 and 253),
	CONSTRAINT "crawl_robots_content_length_check" CHECK ("crawl_robots"."content" is null or octet_length("crawl_robots"."content") <= 500000),
	CONSTRAINT "crawl_robots_user_agent_check" CHECK (length(btrim("crawl_robots"."user_agent")) between 8 and 256),
	CONSTRAINT "crawl_robots_status_code_check" CHECK ("crawl_robots"."status_code" is null or "crawl_robots"."status_code" between 100 and 599),
	CONSTRAINT "crawl_robots_content_hash_check" CHECK ("crawl_robots"."content_sha256" is null or length("crawl_robots"."content_sha256") = 64),
	CONSTRAINT "crawl_robots_delay_check" CHECK ("crawl_robots"."crawl_delay_ms" is null or "crawl_robots"."crawl_delay_ms" between 0 and 60000),
	CONSTRAINT "crawl_robots_sitemap_count_check" CHECK (cardinality("crawl_robots"."sitemap_urls") <= 100)
);
--> statement-breakpoint
CREATE TABLE "crawl_usage_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"reserved_pages" integer NOT NULL,
	"consumed_pages" integer DEFAULT 0 NOT NULL,
	"status" "crawl_usage_reservation_status" DEFAULT 'reserved' NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_usage_reservations_crawl_unique" UNIQUE("crawl_id"),
	CONSTRAINT "crawl_usage_reservations_counts_check" CHECK ("crawl_usage_reservations"."reserved_pages" between 1 and 100 and "crawl_usage_reservations"."consumed_pages" between 0 and "crawl_usage_reservations"."reserved_pages"),
	CONSTRAINT "crawl_usage_reservations_release_check" CHECK (("crawl_usage_reservations"."status" = 'reserved' and "crawl_usage_reservations"."released_at" is null) or ("crawl_usage_reservations"."status" in ('released', 'consumed') and "crawl_usage_reservations"."released_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "crawls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"requested_by_membership_id" uuid NOT NULL,
	"crawl_config_id" uuid NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"status" "crawl_status" DEFAULT 'queued' NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"queue_job_id" text,
	"trace_id" text NOT NULL,
	"execution_token" uuid,
	"execution_lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"succeeded_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"bytes_received" bigint DEFAULT 0 NOT NULL,
	"cancellation_requested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_progress_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_type" text,
	"error_message" text,
	"completion_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawls_organization_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "crawls_tenant_project_id_unique" UNIQUE("organization_id","project_id","id"),
	CONSTRAINT "crawls_project_idempotency_unique" UNIQUE("organization_id","project_id","idempotency_key_hash"),
	CONSTRAINT "crawls_idempotency_key_hash_check" CHECK (length("crawls"."idempotency_key_hash") = 64),
	CONSTRAINT "crawls_trace_id_check" CHECK (length("crawls"."trace_id") between 8 and 128),
	CONSTRAINT "crawls_error_length_check" CHECK (("crawls"."error_type" is null or length("crawls"."error_type") between 1 and 120) and ("crawls"."error_message" is null or length("crawls"."error_message") between 1 and 2000) and ("crawls"."completion_reason" is null or length("crawls"."completion_reason") between 1 and 2000)),
	CONSTRAINT "crawls_counters_check" CHECK ("crawls"."attempt_count" >= 0 and "crawls"."discovered_count" >= 0 and "crawls"."processed_count" >= 0 and "crawls"."succeeded_count" >= 0 and "crawls"."failed_count" >= 0 and "crawls"."blocked_count" >= 0 and "crawls"."skipped_count" >= 0 and "crawls"."bytes_received" >= 0 and "crawls"."processed_count" = "crawls"."succeeded_count" + "crawls"."failed_count" + "crawls"."blocked_count" + "crawls"."skipped_count" and "crawls"."processed_count" <= "crawls"."discovered_count"),
	CONSTRAINT "crawls_finished_at_check" CHECK (("crawls"."status" in ('cancelled', 'failed', 'partially_completed', 'completed') and "crawls"."finished_at" is not null) or ("crawls"."status" not in ('cancelled', 'failed', 'partially_completed', 'completed') and "crawls"."finished_at" is null)),
	CONSTRAINT "crawls_execution_lease_check" CHECK (("crawls"."status" in ('validating', 'discovering', 'crawling') and "crawls"."execution_token" is not null and "crawls"."execution_lease_expires_at" is not null) or ("crawls"."status" not in ('validating', 'discovering', 'crawling') and "crawls"."execution_token" is null and "crawls"."execution_lease_expires_at" is null))
);
--> statement-breakpoint
CREATE TABLE "job_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"job_type" text NOT NULL,
	"contract_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"trace_id" text NOT NULL,
	"status" "job_outbox_status" DEFAULT 'pending' NOT NULL,
	"publish_attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"claim_token" uuid,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_outbox_tenant_idempotency_unique" UNIQUE("organization_id","project_id","idempotency_key"),
	CONSTRAINT "job_outbox_crawl_job_type_unique" UNIQUE("crawl_id","job_type"),
	CONSTRAINT "job_outbox_job_type_check" CHECK ("job_outbox"."job_type" in ('crawl.execute', 'crawl.dead-letter')),
	CONSTRAINT "job_outbox_contract_version_check" CHECK ("job_outbox"."contract_version" >= 1),
	CONSTRAINT "job_outbox_idempotency_check" CHECK (length("job_outbox"."idempotency_key") between 8 and 128),
	CONSTRAINT "job_outbox_trace_id_check" CHECK (length("job_outbox"."trace_id") between 8 and 128),
	CONSTRAINT "job_outbox_attempt_check" CHECK ("job_outbox"."publish_attempt_count" between 0 and 100),
	CONSTRAINT "job_outbox_lease_check" CHECK (("job_outbox"."status" = 'publishing' and "job_outbox"."claim_token" is not null and "job_outbox"."locked_at" is not null and "job_outbox"."lease_expires_at" is not null) or ("job_outbox"."status" <> 'publishing' and "job_outbox"."claim_token" is null and "job_outbox"."locked_at" is null and "job_outbox"."lease_expires_at" is null)),
	CONSTRAINT "job_outbox_published_at_check" CHECK (("job_outbox"."status" = 'published' and "job_outbox"."published_at" is not null) or ("job_outbox"."status" <> 'published' and "job_outbox"."published_at" is null)),
	CONSTRAINT "job_outbox_error_length_check" CHECK ("job_outbox"."last_error" is null or length("job_outbox"."last_error") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD COLUMN "user_agent" text DEFAULT 'SearviaBot/1.0 (+https://searvia.online/crawler)' NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD COLUMN "redirect_limit" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD COLUMN "max_response_bytes" integer DEFAULT 2000000 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD COLUMN "request_timeout_ms" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD COLUMN "total_timeout_ms" integer DEFAULT 300000 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD COLUMN "supported_content_types" text[] DEFAULT array['text/html', 'application/xhtml+xml']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD CONSTRAINT "crawl_configs_tenant_project_id_unique" UNIQUE("organization_id","project_id","id");--> statement-breakpoint
ALTER TABLE "crawl_checkpoints" ADD CONSTRAINT "crawl_checkpoints_crawl_fk" FOREIGN KEY ("organization_id","project_id","crawl_id") REFERENCES "public"."crawls"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_frontier" ADD CONSTRAINT "crawl_frontier_crawl_fk" FOREIGN KEY ("organization_id","project_id","crawl_id") REFERENCES "public"."crawls"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_frontier" ADD CONSTRAINT "crawl_frontier_parent_fk" FOREIGN KEY ("organization_id","crawl_id","discovered_from_frontier_id") REFERENCES "public"."crawl_frontier"("organization_id","crawl_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_crawl_fk" FOREIGN KEY ("organization_id","project_id","crawl_id") REFERENCES "public"."crawls"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_frontier_fk" FOREIGN KEY ("organization_id","crawl_id","frontier_id") REFERENCES "public"."crawl_frontier"("organization_id","crawl_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_robots" ADD CONSTRAINT "crawl_robots_crawl_fk" FOREIGN KEY ("organization_id","project_id","crawl_id") REFERENCES "public"."crawls"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_usage_reservations" ADD CONSTRAINT "crawl_usage_reservations_crawl_fk" FOREIGN KEY ("organization_id","project_id","crawl_id") REFERENCES "public"."crawls"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_requester_fk" FOREIGN KEY ("organization_id","requested_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_config_fk" FOREIGN KEY ("organization_id","project_id","crawl_config_id") REFERENCES "public"."crawl_configs"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_outbox" ADD CONSTRAINT "job_outbox_crawl_fk" FOREIGN KEY ("organization_id","project_id","crawl_id") REFERENCES "public"."crawls"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_checkpoints_tenant_crawl_idx" ON "crawl_checkpoints" USING btree ("organization_id","crawl_id");--> statement-breakpoint
CREATE INDEX "crawl_frontier_next_idx" ON "crawl_frontier" USING btree ("organization_id","crawl_id","state","depth","discovered_at","id");--> statement-breakpoint
CREATE INDEX "crawl_frontier_project_url_idx" ON "crawl_frontier" USING btree ("organization_id","project_id","url_hash");--> statement-breakpoint
CREATE INDEX "crawl_pages_tenant_crawl_depth_idx" ON "crawl_pages" USING btree ("organization_id","crawl_id","depth","id");--> statement-breakpoint
CREATE INDEX "crawl_pages_tenant_project_fetched_idx" ON "crawl_pages" USING btree ("organization_id","project_id","fetched_at");--> statement-breakpoint
CREATE INDEX "crawl_robots_tenant_project_idx" ON "crawl_robots" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "crawl_robots_tenant_crawl_host_idx" ON "crawl_robots" USING btree ("organization_id","crawl_id","hostname");--> statement-breakpoint
CREATE INDEX "crawl_usage_reservations_tenant_status_idx" ON "crawl_usage_reservations" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crawls_one_active_project_unique" ON "crawls" USING btree ("organization_id","project_id") WHERE "crawls"."status" in ('queued', 'validating', 'discovering', 'crawling');--> statement-breakpoint
CREATE INDEX "crawls_tenant_project_created_idx" ON "crawls" USING btree ("organization_id","project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "crawls_tenant_status_progress_idx" ON "crawls" USING btree ("organization_id","status","last_progress_at");--> statement-breakpoint
CREATE INDEX "crawls_queue_job_idx" ON "crawls" USING btree ("queue_job_id");--> statement-breakpoint
CREATE INDEX "crawls_tenant_requester_idx" ON "crawls" USING btree ("organization_id","requested_by_membership_id");--> statement-breakpoint
CREATE INDEX "job_outbox_dispatch_idx" ON "job_outbox" USING btree ("status","available_at","created_at","id");--> statement-breakpoint
CREATE INDEX "job_outbox_tenant_crawl_idx" ON "job_outbox" USING btree ("organization_id","crawl_id");--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD CONSTRAINT "crawl_configs_user_agent_check" CHECK (length(btrim("crawl_configs"."user_agent")) between 8 and 256);--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD CONSTRAINT "crawl_configs_redirect_limit_check" CHECK ("crawl_configs"."redirect_limit" between 0 and 10);--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD CONSTRAINT "crawl_configs_max_response_bytes_check" CHECK ("crawl_configs"."max_response_bytes" between 65536 and 5000000);--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD CONSTRAINT "crawl_configs_request_timeout_check" CHECK ("crawl_configs"."request_timeout_ms" between 1000 and 30000);--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD CONSTRAINT "crawl_configs_total_timeout_check" CHECK ("crawl_configs"."total_timeout_ms" between 10000 and 1800000);--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD CONSTRAINT "crawl_configs_content_types_check" CHECK (cardinality("crawl_configs"."supported_content_types") between 1 and 4 and "crawl_configs"."supported_content_types" <@ array['text/html', 'application/xhtml+xml', 'application/xml', 'text/xml']::text[]);
