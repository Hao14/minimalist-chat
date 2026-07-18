ALTER TABLE "crawl_page_extractions" DROP CONSTRAINT "page_extract_url_language_check";--> statement-breakpoint
ALTER TABLE "crawl_robots" DROP CONSTRAINT "crawl_robots_delay_check";--> statement-breakpoint
ALTER TABLE "crawl_page_extractions" ADD COLUMN "links_complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_page_extractions" ADD COLUMN "meta_refresh_url" text;--> statement-breakpoint
ALTER TABLE "crawl_page_extractions" ADD COLUMN "javascript_redirect_url" text;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "html_detected" boolean;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "html_detection_source" text;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "html_detection_bytes" integer;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "robots_observation_id" uuid;--> statement-breakpoint
ALTER TABLE "crawl_sitemaps" ADD COLUMN "robots_decision" "robots_decision" DEFAULT 'not_checked' NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_sitemaps" ADD COLUMN "robots_observation_id" uuid;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_robots_observation_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","robots_observation_id") REFERENCES "public"."crawl_robots"("organization_id","project_id","crawl_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_sitemaps" ADD CONSTRAINT "crawl_sitemaps_robots_observation_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","robots_observation_id") REFERENCES "public"."crawl_robots"("organization_id","project_id","crawl_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "crawl_pages" SET "robots_decision" = 'not_checked', "robots_observation_id" = NULL WHERE "robots_decision" <> 'not_checked' AND "robots_observation_id" IS NULL;--> statement-breakpoint
UPDATE "crawl_sitemaps" SET "robots_decision" = 'not_checked', "robots_observation_id" = NULL WHERE "robots_decision" <> 'not_checked' AND "robots_observation_id" IS NULL;--> statement-breakpoint
-- Schemas before 0016 bounded robots content and digest lengths independently,
-- but did not bind either value to a fetched observation. Do not manufacture a
-- digest for legacy content or reinterpret an unavailable/invalid result as a
-- successful fetch. Discard only the unproven body/digest before adding the
-- provenance constraint; fetched content with an existing digest is preserved.
UPDATE "crawl_robots" SET "content" = NULL, "content_sha256" = NULL WHERE "result" <> 'fetched' AND ("content" IS NOT NULL OR "content_sha256" IS NOT NULL);--> statement-breakpoint
UPDATE "crawl_robots" SET "content" = NULL WHERE "result" = 'fetched' AND "content" IS NOT NULL AND "content_sha256" IS NULL;--> statement-breakpoint
CREATE INDEX "crawl_pages_tenant_robots_idx" ON "crawl_pages" USING btree ("organization_id","project_id","crawl_id","robots_decision","id");--> statement-breakpoint
CREATE INDEX "crawl_sitemaps_tenant_robots_idx" ON "crawl_sitemaps" USING btree ("organization_id","project_id","crawl_id","robots_decision","id");--> statement-breakpoint
ALTER TABLE "crawl_page_extractions" ADD CONSTRAINT "page_extract_completeness_status_check" CHECK (("crawl_page_extractions"."directive_scope_preserved" = false and "crawl_page_extractions"."links_complete" = false) or "crawl_page_extractions"."status" = 'succeeded');--> statement-breakpoint
ALTER TABLE "crawl_page_extractions" ADD CONSTRAINT "page_extract_url_language_check" CHECK (("crawl_page_extractions"."canonical_url" is null or length("crawl_page_extractions"."canonical_url") between 8 and 4096) and ("crawl_page_extractions"."meta_refresh_url" is null or length("crawl_page_extractions"."meta_refresh_url") between 8 and 4096) and ("crawl_page_extractions"."javascript_redirect_url" is null or length("crawl_page_extractions"."javascript_redirect_url") between 8 and 4096) and ("crawl_page_extractions"."html_language" is null or length("crawl_page_extractions"."html_language") between 1 and 80) and ("crawl_page_extractions"."character_encoding" is null or length("crawl_page_extractions"."character_encoding") between 1 and 80));--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_html_detection_check" CHECK (("crawl_pages"."html_detected" is null and "crawl_pages"."html_detection_source" is null and "crawl_pages"."html_detection_bytes" is null) or ("crawl_pages"."html_detected" is not null and "crawl_pages"."html_detection_source" = 'bounded_response_prefix' and "crawl_pages"."html_detection_bytes" between 0 and 4096));--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_robots_provenance_check" CHECK ("crawl_pages"."robots_decision" = 'not_checked' or "crawl_pages"."robots_observation_id" is not null);--> statement-breakpoint
ALTER TABLE "crawl_robots" ADD CONSTRAINT "crawl_robots_content_provenance_check" CHECK ("crawl_robots"."content" is null or ("crawl_robots"."result" = 'fetched' and "crawl_robots"."content_sha256" is not null));--> statement-breakpoint
ALTER TABLE "crawl_robots" ADD CONSTRAINT "crawl_robots_delay_check" CHECK ("crawl_robots"."crawl_delay_ms" is null or "crawl_robots"."crawl_delay_ms" between 0 and 86400000);--> statement-breakpoint
ALTER TABLE "crawl_sitemaps" ADD CONSTRAINT "crawl_sitemaps_robots_provenance_check" CHECK ("crawl_sitemaps"."robots_decision" = 'not_checked' or "crawl_sitemaps"."robots_observation_id" is not null);
