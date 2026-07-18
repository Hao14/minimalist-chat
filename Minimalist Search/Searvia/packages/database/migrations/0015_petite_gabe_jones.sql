ALTER TABLE "crawl_page_resources" ADD COLUMN "robots_decision" "robots_decision" DEFAULT 'not_checked' NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_page_resources" ADD COLUMN "robots_observation_id" uuid;--> statement-breakpoint
ALTER TABLE "crawl_robots" ADD CONSTRAINT "crawl_robots_tenant_crawl_id_unique" UNIQUE("organization_id","project_id","crawl_id","id");--> statement-breakpoint
ALTER TABLE "crawl_page_resources" ADD CONSTRAINT "page_resources_robots_observation_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","robots_observation_id") REFERENCES "public"."crawl_robots"("organization_id","project_id","crawl_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_resources_tenant_crawl_robots_idx" ON "crawl_page_resources" USING btree ("organization_id","project_id","crawl_id","robots_decision","resource_type","id");--> statement-breakpoint
ALTER TABLE "crawl_page_resources" ADD CONSTRAINT "page_resources_robots_provenance_check" CHECK ("crawl_page_resources"."robots_decision" = 'not_checked' or "crawl_page_resources"."robots_observation_id" is not null);
