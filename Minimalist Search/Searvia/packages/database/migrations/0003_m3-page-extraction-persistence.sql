CREATE TYPE "public"."page_artifact_kind" AS ENUM('raw_html', 'rendered_html');--> statement-breakpoint
CREATE TYPE "public"."page_extraction_source" AS ENUM('raw', 'rendered');--> statement-breakpoint
CREATE TYPE "public"."page_link_scope" AS ENUM('internal', 'external');--> statement-breakpoint
CREATE TYPE "public"."page_link_type" AS ENUM('anchor', 'area', 'canonical', 'hreflang', 'pagination', 'form_action', 'iframe', 'other');--> statement-breakpoint
CREATE TYPE "public"."page_resource_type" AS ENUM('script', 'stylesheet', 'iframe', 'form');--> statement-breakpoint
CREATE TYPE "public"."sitemap_compression" AS ENUM('identity', 'gzip');--> statement-breakpoint
CREATE TYPE "public"."sitemap_entry_type" AS ENUM('url', 'sitemap');--> statement-breakpoint
CREATE TYPE "public"."sitemap_format" AS ENUM('urlset', 'index', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."sitemap_source" AS ENUM('robots', 'submitted', 'default', 'nested');--> statement-breakpoint
CREATE TYPE "public"."sitemap_status" AS ENUM('parsed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."structured_data_kind" AS ENUM('json_ld', 'microdata');--> statement-breakpoint
CREATE TYPE "public"."structured_data_parse_status" AS ENUM('parsed', 'invalid');--> statement-breakpoint
CREATE TABLE "crawl_page_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"kind" "page_artifact_kind" NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"object_version" text,
	"etag" text,
	"content_type" text NOT NULL,
	"content_encoding" text DEFAULT 'gzip' NOT NULL,
	"uncompressed_bytes" bigint NOT NULL,
	"stored_bytes" bigint NOT NULL,
	"content_sha256" text NOT NULL,
	"storage_sha256" text NOT NULL,
	"stored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_artifacts_page_kind_unique" UNIQUE("page_id","kind"),
	CONSTRAINT "page_artifacts_tenant_object_unique" UNIQUE("organization_id","bucket","object_key"),
	CONSTRAINT "page_artifacts_object_key_check" CHECK (length("crawl_page_artifacts"."bucket") between 3 and 255 and length("crawl_page_artifacts"."object_key") between 32 and 1024 and "crawl_page_artifacts"."object_key" like ('organizations/' || "crawl_page_artifacts"."organization_id"::text || '/projects/' || "crawl_page_artifacts"."project_id"::text || '/crawls/' || "crawl_page_artifacts"."crawl_id"::text || '/pages/' || "crawl_page_artifacts"."page_id"::text || '/%')),
	CONSTRAINT "page_artifacts_metadata_check" CHECK (length("crawl_page_artifacts"."content_type") between 3 and 255 and "crawl_page_artifacts"."content_encoding" = 'gzip' and "crawl_page_artifacts"."uncompressed_bytes" between 0 and 5000000 and "crawl_page_artifacts"."stored_bytes" between 0 and 5000000 and length("crawl_page_artifacts"."content_sha256") = 64 and length("crawl_page_artifacts"."storage_sha256") = 64 and ("crawl_page_artifacts"."object_version" is null or length("crawl_page_artifacts"."object_version") between 1 and 1024) and ("crawl_page_artifacts"."etag" is null or length("crawl_page_artifacts"."etag") between 1 and 512))
);
--> statement-breakpoint
CREATE TABLE "crawl_page_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"source" "page_extraction_source" NOT NULL,
	"title" text,
	"meta_description" text,
	"meta_robots" text[] DEFAULT array[]::text[] NOT NULL,
	"x_robots_tag" text[] DEFAULT array[]::text[] NOT NULL,
	"canonical_url" text,
	"canonical_tag_count" integer DEFAULT 0 NOT NULL,
	"visible_text" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"html_language" text,
	"character_encoding" text,
	"open_graph" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"social_cards" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"dom_hash" text,
	"similarity_fingerprint" text,
	"meaningful_content" boolean DEFAULT false NOT NULL,
	"client_rendered" boolean DEFAULT false NOT NULL,
	"rendering_error_type" text,
	"rendering_error_message" text,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_extract_page_source_unique" UNIQUE("page_id","source"),
	CONSTRAINT "page_extract_tenant_id_unique" UNIQUE("organization_id","project_id","crawl_id","page_id","id"),
	CONSTRAINT "page_extract_text_length_check" CHECK (("crawl_page_extractions"."title" is null or length("crawl_page_extractions"."title") <= 2000) and ("crawl_page_extractions"."meta_description" is null or length("crawl_page_extractions"."meta_description") <= 8000) and ("crawl_page_extractions"."visible_text" is null or octet_length("crawl_page_extractions"."visible_text") <= 2000000)),
	CONSTRAINT "page_extract_directive_count_check" CHECK (cardinality("crawl_page_extractions"."meta_robots") <= 64 and cardinality("crawl_page_extractions"."x_robots_tag") <= 64 and octet_length(array_to_string("crawl_page_extractions"."meta_robots", E'
')) <= 16384 and octet_length(array_to_string("crawl_page_extractions"."x_robots_tag", E'
')) <= 16384),
	CONSTRAINT "page_extract_counts_check" CHECK ("crawl_page_extractions"."word_count" between 0 and 1000000 and "crawl_page_extractions"."canonical_tag_count" between 0 and 100),
	CONSTRAINT "page_extract_url_language_check" CHECK (("crawl_page_extractions"."canonical_url" is null or length("crawl_page_extractions"."canonical_url") between 8 and 4096) and ("crawl_page_extractions"."html_language" is null or length("crawl_page_extractions"."html_language") between 1 and 80) and ("crawl_page_extractions"."character_encoding" is null or length("crawl_page_extractions"."character_encoding") between 1 and 80)),
	CONSTRAINT "page_extract_social_size_check" CHECK (jsonb_typeof("crawl_page_extractions"."open_graph") = 'object' and jsonb_typeof("crawl_page_extractions"."social_cards") = 'object' and octet_length("crawl_page_extractions"."open_graph"::text) <= 131072 and octet_length("crawl_page_extractions"."social_cards"::text) <= 131072),
	CONSTRAINT "page_extract_hash_check" CHECK (("crawl_page_extractions"."content_hash" is null or length("crawl_page_extractions"."content_hash") = 64) and ("crawl_page_extractions"."dom_hash" is null or length("crawl_page_extractions"."dom_hash") = 64) and ("crawl_page_extractions"."similarity_fingerprint" is null or length("crawl_page_extractions"."similarity_fingerprint") between 16 and 256)),
	CONSTRAINT "page_extract_render_error_check" CHECK (("crawl_page_extractions"."rendering_error_type" is null or length("crawl_page_extractions"."rendering_error_type") between 1 and 120) and ("crawl_page_extractions"."rendering_error_message" is null or length("crawl_page_extractions"."rendering_error_message") between 1 and 2000))
);
--> statement-breakpoint
CREATE TABLE "crawl_page_headings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"extraction_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_headings_extract_ordinal_unique" UNIQUE("extraction_id","ordinal"),
	CONSTRAINT "page_headings_level_check" CHECK ("crawl_page_headings"."level" between 1 and 6),
	CONSTRAINT "page_headings_ordinal_check" CHECK ("crawl_page_headings"."ordinal" between 0 and 9999),
	CONSTRAINT "page_headings_text_check" CHECK (length("crawl_page_headings"."text") between 0 and 2000)
);
--> statement-breakpoint
CREATE TABLE "crawl_page_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"extraction_id" uuid NOT NULL,
	"source_url" text,
	"normalized_url" text,
	"url_hash" text,
	"scope" "page_link_scope",
	"alt_text" text,
	"title" text,
	"width" integer,
	"height" integer,
	"loading" text,
	"srcset" text,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_images_extract_ordinal_unique" UNIQUE("extraction_id","ordinal"),
	CONSTRAINT "page_images_url_check" CHECK (("crawl_page_images"."source_url" is null or length("crawl_page_images"."source_url") <= 4096) and ("crawl_page_images"."normalized_url" is null or length("crawl_page_images"."normalized_url") between 8 and 4096) and ("crawl_page_images"."url_hash" is null or length("crawl_page_images"."url_hash") = 64)),
	CONSTRAINT "page_images_text_check" CHECK (("crawl_page_images"."alt_text" is null or length("crawl_page_images"."alt_text") <= 4000) and ("crawl_page_images"."title" is null or length("crawl_page_images"."title") <= 2000) and ("crawl_page_images"."loading" is null or length("crawl_page_images"."loading") <= 80) and ("crawl_page_images"."srcset" is null or length("crawl_page_images"."srcset") <= 16000)),
	CONSTRAINT "page_images_dimensions_check" CHECK (("crawl_page_images"."width" is null or "crawl_page_images"."width" between 0 and 100000) and ("crawl_page_images"."height" is null or "crawl_page_images"."height" between 0 and 100000)),
	CONSTRAINT "page_images_ordinal_check" CHECK ("crawl_page_images"."ordinal" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "crawl_page_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"source_page_id" uuid NOT NULL,
	"extraction_id" uuid NOT NULL,
	"target_frontier_id" uuid,
	"target_page_id" uuid,
	"target_url" text NOT NULL,
	"normalized_target_url" text NOT NULL,
	"target_url_hash" text NOT NULL,
	"scope" "page_link_scope" NOT NULL,
	"anchor_text" text,
	"rel_values" text[] DEFAULT array[]::text[] NOT NULL,
	"link_type" "page_link_type" DEFAULT 'anchor' NOT NULL,
	"hreflang" text,
	"discovered" boolean DEFAULT false NOT NULL,
	"crawl_depth" integer NOT NULL,
	"discovery_source" "crawl_discovery_source" NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_links_extract_ordinal_unique" UNIQUE("extraction_id","ordinal"),
	CONSTRAINT "page_links_url_check" CHECK (length("crawl_page_links"."target_url") between 1 and 4096 and length("crawl_page_links"."normalized_target_url") between 8 and 4096 and length("crawl_page_links"."target_url_hash") = 64),
	CONSTRAINT "page_links_text_check" CHECK (("crawl_page_links"."anchor_text" is null or length("crawl_page_links"."anchor_text") <= 4000) and ("crawl_page_links"."hreflang" is null or length("crawl_page_links"."hreflang") between 1 and 80) and cardinality("crawl_page_links"."rel_values") <= 64 and octet_length(array_to_string("crawl_page_links"."rel_values", E'
')) <= 8192),
	CONSTRAINT "page_links_discovered_check" CHECK (not "crawl_page_links"."discovered" or "crawl_page_links"."target_frontier_id" is not null),
	CONSTRAINT "page_links_depth_check" CHECK ("crawl_page_links"."crawl_depth" between 0 and 10),
	CONSTRAINT "page_links_ordinal_check" CHECK ("crawl_page_links"."ordinal" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "crawl_page_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"extraction_id" uuid NOT NULL,
	"resource_type" "page_resource_type" NOT NULL,
	"source_url" text,
	"normalized_url" text,
	"url_hash" text,
	"scope" "page_link_scope",
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_resources_extract_ordinal_unique" UNIQUE("extraction_id","ordinal"),
	CONSTRAINT "page_resources_url_check" CHECK (("crawl_page_resources"."source_url" is null or length("crawl_page_resources"."source_url") <= 4096) and ("crawl_page_resources"."normalized_url" is null or length("crawl_page_resources"."normalized_url") between 8 and 4096) and ("crawl_page_resources"."url_hash" is null or length("crawl_page_resources"."url_hash") = 64)),
	CONSTRAINT "page_resources_attributes_check" CHECK (jsonb_typeof("crawl_page_resources"."attributes") = 'object' and octet_length("crawl_page_resources"."attributes"::text) <= 65536),
	CONSTRAINT "page_resources_ordinal_check" CHECK ("crawl_page_resources"."ordinal" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "crawl_page_structured_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"extraction_id" uuid NOT NULL,
	"kind" "structured_data_kind" NOT NULL,
	"parse_status" "structured_data_parse_status" NOT NULL,
	"schema_types" text[] DEFAULT array[]::text[] NOT NULL,
	"raw_value" text NOT NULL,
	"parsed_value" jsonb,
	"error_message" text,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_structured_extract_ordinal_unique" UNIQUE("extraction_id","ordinal"),
	CONSTRAINT "page_structured_shape_check" CHECK (("crawl_page_structured_data"."parse_status" = 'parsed' and "crawl_page_structured_data"."parsed_value" is not null and "crawl_page_structured_data"."error_message" is null) or ("crawl_page_structured_data"."parse_status" = 'invalid' and "crawl_page_structured_data"."parsed_value" is null and "crawl_page_structured_data"."error_message" is not null)),
	CONSTRAINT "page_structured_size_check" CHECK (octet_length("crawl_page_structured_data"."raw_value") <= 262144 and ("crawl_page_structured_data"."parsed_value" is null or octet_length("crawl_page_structured_data"."parsed_value"::text) <= 262144) and cardinality("crawl_page_structured_data"."schema_types") <= 64 and octet_length(array_to_string("crawl_page_structured_data"."schema_types", E'
')) <= 8192 and ("crawl_page_structured_data"."error_message" is null or length("crawl_page_structured_data"."error_message") between 1 and 2000)),
	CONSTRAINT "page_structured_ordinal_check" CHECK ("crawl_page_structured_data"."ordinal" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "crawl_sitemap_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"sitemap_id" uuid NOT NULL,
	"entry_type" "sitemap_entry_type" NOT NULL,
	"loc" text NOT NULL,
	"normalized_loc" text NOT NULL,
	"url_hash" text NOT NULL,
	"lastmod_raw" text,
	"lastmod_at" timestamp with time zone,
	"target_frontier_id" uuid,
	"target_page_id" uuid,
	"target_sitemap_id" uuid,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sitemap_entries_sitemap_type_hash_unique" UNIQUE("sitemap_id","entry_type","url_hash"),
	CONSTRAINT "sitemap_entries_url_check" CHECK (length("crawl_sitemap_entries"."loc") between 1 and 4096 and length("crawl_sitemap_entries"."normalized_loc") between 8 and 4096 and length("crawl_sitemap_entries"."url_hash") = 64),
	CONSTRAINT "sitemap_entries_lastmod_check" CHECK ("crawl_sitemap_entries"."lastmod_raw" is null or length("crawl_sitemap_entries"."lastmod_raw") between 1 and 128),
	CONSTRAINT "sitemap_entries_ordinal_check" CHECK ("crawl_sitemap_entries"."ordinal" between 0 and 50000),
	CONSTRAINT "sitemap_entries_target_check" CHECK (("crawl_sitemap_entries"."entry_type" = 'url' and "crawl_sitemap_entries"."target_sitemap_id" is null) or ("crawl_sitemap_entries"."entry_type" = 'sitemap' and "crawl_sitemap_entries"."target_frontier_id" is null and "crawl_sitemap_entries"."target_page_id" is null))
);
--> statement-breakpoint
CREATE TABLE "crawl_sitemaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"parent_sitemap_id" uuid,
	"requested_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"final_url" text,
	"url_hash" text NOT NULL,
	"source" "sitemap_source" NOT NULL,
	"status" "sitemap_status" NOT NULL,
	"format" "sitemap_format" DEFAULT 'unknown' NOT NULL,
	"compression" "sitemap_compression" DEFAULT 'identity' NOT NULL,
	"status_code" integer,
	"content_type" text,
	"content_length" bigint,
	"transfer_size" integer DEFAULT 0 NOT NULL,
	"depth" integer NOT NULL,
	"redirect_chain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url_count" integer DEFAULT 0 NOT NULL,
	"child_sitemap_count" integer DEFAULT 0 NOT NULL,
	"error_type" text,
	"error_message" text,
	"fetched_at" timestamp with time zone,
	"parsed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_sitemaps_crawl_url_hash_unique" UNIQUE("crawl_id","url_hash"),
	CONSTRAINT "crawl_sitemaps_tenant_id_unique" UNIQUE("organization_id","project_id","crawl_id","id"),
	CONSTRAINT "crawl_sitemaps_url_check" CHECK (length("crawl_sitemaps"."requested_url") between 8 and 4096 and length("crawl_sitemaps"."normalized_url") between 8 and 4096 and ("crawl_sitemaps"."final_url" is null or length("crawl_sitemaps"."final_url") between 8 and 4096) and length("crawl_sitemaps"."url_hash") = 64),
	CONSTRAINT "crawl_sitemaps_status_code_check" CHECK ("crawl_sitemaps"."status_code" is null or "crawl_sitemaps"."status_code" between 100 and 599),
	CONSTRAINT "crawl_sitemaps_size_check" CHECK (("crawl_sitemaps"."content_length" is null or "crawl_sitemaps"."content_length" between 0 and 1000000000) and "crawl_sitemaps"."transfer_size" between 0 and 5000000),
	CONSTRAINT "crawl_sitemaps_depth_check" CHECK ("crawl_sitemaps"."depth" between 0 and 5),
	CONSTRAINT "crawl_sitemaps_redirect_check" CHECK (jsonb_typeof("crawl_sitemaps"."redirect_chain") = 'array' and jsonb_array_length("crawl_sitemaps"."redirect_chain") <= 10),
	CONSTRAINT "crawl_sitemaps_counts_check" CHECK ("crawl_sitemaps"."url_count" between 0 and 50000 and "crawl_sitemaps"."child_sitemap_count" between 0 and 100),
	CONSTRAINT "crawl_sitemaps_error_check" CHECK (("crawl_sitemaps"."error_type" is null or length("crawl_sitemaps"."error_type") between 1 and 120) and ("crawl_sitemaps"."error_message" is null or length("crawl_sitemaps"."error_message") between 1 and 2000)),
	CONSTRAINT "crawl_sitemaps_lifecycle_check" CHECK (("crawl_sitemaps"."status" = 'parsed' and "crawl_sitemaps"."parsed_at" is not null and "crawl_sitemaps"."error_type" is null and "crawl_sitemaps"."error_message" is null) or ("crawl_sitemaps"."status" = 'failed' and "crawl_sitemaps"."error_type" is not null and "crawl_sitemaps"."error_message" is not null) or ("crawl_sitemaps"."status" = 'skipped' and "crawl_sitemaps"."parsed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD COLUMN "rendering_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD COLUMN "submitted_sitemap_urls" text[] DEFAULT array[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "response_headers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "omitted_response_headers" text[] DEFAULT array[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "content_length" bigint;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "transfer_size" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "compression" text;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "cache_headers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "security_headers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "extracted_page_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "extraction_failed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "rendered_page_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "artifact_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "sitemap_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "sitemap_url_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_tenant_page_id_unique" UNIQUE("organization_id","project_id","crawl_id","id");--> statement-breakpoint
ALTER TABLE "crawl_page_artifacts" ADD CONSTRAINT "page_artifacts_page_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","page_id") REFERENCES "public"."crawl_pages"("organization_id","project_id","crawl_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_page_extractions" ADD CONSTRAINT "page_extract_page_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","page_id") REFERENCES "public"."crawl_pages"("organization_id","project_id","crawl_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_page_headings" ADD CONSTRAINT "page_headings_extract_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","page_id","extraction_id") REFERENCES "public"."crawl_page_extractions"("organization_id","project_id","crawl_id","page_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_page_images" ADD CONSTRAINT "page_images_extract_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","page_id","extraction_id") REFERENCES "public"."crawl_page_extractions"("organization_id","project_id","crawl_id","page_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_page_links" ADD CONSTRAINT "page_links_extract_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","source_page_id","extraction_id") REFERENCES "public"."crawl_page_extractions"("organization_id","project_id","crawl_id","page_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_page_links" ADD CONSTRAINT "page_links_target_frontier_fk" FOREIGN KEY ("organization_id","crawl_id","target_frontier_id") REFERENCES "public"."crawl_frontier"("organization_id","crawl_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_page_links" ADD CONSTRAINT "page_links_target_page_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","target_page_id") REFERENCES "public"."crawl_pages"("organization_id","project_id","crawl_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_page_resources" ADD CONSTRAINT "page_resources_extract_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","page_id","extraction_id") REFERENCES "public"."crawl_page_extractions"("organization_id","project_id","crawl_id","page_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_page_structured_data" ADD CONSTRAINT "page_structured_extract_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","page_id","extraction_id") REFERENCES "public"."crawl_page_extractions"("organization_id","project_id","crawl_id","page_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_sitemap_entries" ADD CONSTRAINT "sitemap_entries_sitemap_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","sitemap_id") REFERENCES "public"."crawl_sitemaps"("organization_id","project_id","crawl_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_sitemap_entries" ADD CONSTRAINT "sitemap_entries_frontier_fk" FOREIGN KEY ("organization_id","crawl_id","target_frontier_id") REFERENCES "public"."crawl_frontier"("organization_id","crawl_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_sitemap_entries" ADD CONSTRAINT "sitemap_entries_page_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","target_page_id") REFERENCES "public"."crawl_pages"("organization_id","project_id","crawl_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_sitemap_entries" ADD CONSTRAINT "sitemap_entries_target_sitemap_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","target_sitemap_id") REFERENCES "public"."crawl_sitemaps"("organization_id","project_id","crawl_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_sitemaps" ADD CONSTRAINT "crawl_sitemaps_crawl_fk" FOREIGN KEY ("organization_id","project_id","crawl_id") REFERENCES "public"."crawls"("organization_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_sitemaps" ADD CONSTRAINT "crawl_sitemaps_parent_fk" FOREIGN KEY ("organization_id","project_id","crawl_id","parent_sitemap_id") REFERENCES "public"."crawl_sitemaps"("organization_id","project_id","crawl_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_artifacts_tenant_crawl_page_idx" ON "crawl_page_artifacts" USING btree ("organization_id","project_id","crawl_id","page_id","kind");--> statement-breakpoint
CREATE INDEX "page_extract_tenant_crawl_source_idx" ON "crawl_page_extractions" USING btree ("organization_id","crawl_id","source","page_id");--> statement-breakpoint
CREATE INDEX "page_extract_tenant_content_hash_idx" ON "crawl_page_extractions" USING btree ("organization_id","project_id","content_hash");--> statement-breakpoint
CREATE INDEX "page_extract_tenant_similarity_idx" ON "crawl_page_extractions" USING btree ("organization_id","project_id","similarity_fingerprint");--> statement-breakpoint
CREATE INDEX "page_headings_tenant_page_level_idx" ON "crawl_page_headings" USING btree ("organization_id","crawl_id","page_id","level","ordinal");--> statement-breakpoint
CREATE INDEX "page_images_tenant_page_idx" ON "crawl_page_images" USING btree ("organization_id","crawl_id","page_id","ordinal");--> statement-breakpoint
CREATE INDEX "page_links_tenant_source_idx" ON "crawl_page_links" USING btree ("organization_id","crawl_id","source_page_id","ordinal");--> statement-breakpoint
CREATE INDEX "page_links_tenant_target_hash_idx" ON "crawl_page_links" USING btree ("organization_id","crawl_id","target_url_hash","source_page_id");--> statement-breakpoint
CREATE INDEX "page_links_tenant_target_page_idx" ON "crawl_page_links" USING btree ("organization_id","project_id","crawl_id","target_page_id");--> statement-breakpoint
CREATE INDEX "page_links_tenant_target_frontier_idx" ON "crawl_page_links" USING btree ("organization_id","crawl_id","target_frontier_id");--> statement-breakpoint
CREATE INDEX "page_resources_tenant_page_type_idx" ON "crawl_page_resources" USING btree ("organization_id","crawl_id","page_id","resource_type","ordinal");--> statement-breakpoint
CREATE INDEX "page_structured_tenant_page_kind_idx" ON "crawl_page_structured_data" USING btree ("organization_id","crawl_id","page_id","kind","ordinal");--> statement-breakpoint
CREATE INDEX "sitemap_entries_tenant_crawl_url_idx" ON "crawl_sitemap_entries" USING btree ("organization_id","crawl_id","entry_type","url_hash");--> statement-breakpoint
CREATE INDEX "sitemap_entries_tenant_sitemap_ordinal_idx" ON "crawl_sitemap_entries" USING btree ("organization_id","sitemap_id","ordinal","id");--> statement-breakpoint
CREATE INDEX "sitemap_entries_target_frontier_idx" ON "crawl_sitemap_entries" USING btree ("organization_id","crawl_id","target_frontier_id");--> statement-breakpoint
CREATE INDEX "sitemap_entries_target_page_idx" ON "crawl_sitemap_entries" USING btree ("organization_id","project_id","crawl_id","target_page_id");--> statement-breakpoint
CREATE INDEX "sitemap_entries_target_sitemap_idx" ON "crawl_sitemap_entries" USING btree ("organization_id","project_id","crawl_id","target_sitemap_id");--> statement-breakpoint
CREATE INDEX "crawl_sitemaps_tenant_crawl_status_idx" ON "crawl_sitemaps" USING btree ("organization_id","crawl_id","status","depth","id");--> statement-breakpoint
CREATE INDEX "crawl_sitemaps_tenant_project_url_idx" ON "crawl_sitemaps" USING btree ("organization_id","project_id","url_hash");--> statement-breakpoint
CREATE INDEX "crawl_sitemaps_tenant_cursor_idx" ON "crawl_sitemaps" USING btree ("organization_id","project_id","crawl_id","depth","normalized_url","id");--> statement-breakpoint
CREATE INDEX "crawl_sitemaps_tenant_parent_idx" ON "crawl_sitemaps" USING btree ("organization_id","project_id","crawl_id","parent_sitemap_id");--> statement-breakpoint
CREATE INDEX "crawl_pages_tenant_cursor_idx" ON "crawl_pages" USING btree ("organization_id","project_id","crawl_id","depth","normalized_url","id");--> statement-breakpoint
ALTER TABLE "crawl_configs" ADD CONSTRAINT "crawl_configs_sitemap_urls_check" CHECK (cardinality("crawl_configs"."submitted_sitemap_urls") <= 20 and array_position("crawl_configs"."submitted_sitemap_urls", null) is null and octet_length(array_to_string("crawl_configs"."submitted_sitemap_urls", E'
')) <= 81920);--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_transfer_size_check" CHECK ("crawl_pages"."transfer_size" between 0 and 5000000 and ("crawl_pages"."content_length" is null or "crawl_pages"."content_length" between 0 and 1000000000));--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_header_size_check" CHECK (jsonb_typeof("crawl_pages"."response_headers") = 'object' and jsonb_typeof("crawl_pages"."cache_headers") = 'object' and jsonb_typeof("crawl_pages"."security_headers") = 'object' and octet_length("crawl_pages"."response_headers"::text) <= 65536 and octet_length("crawl_pages"."cache_headers"::text) <= 32768 and octet_length("crawl_pages"."security_headers"::text) <= 32768 and cardinality("crawl_pages"."omitted_response_headers") <= 64 and array_position("crawl_pages"."omitted_response_headers", null) is null and octet_length(array_to_string("crawl_pages"."omitted_response_headers", E'
')) <= 8192);--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_compression_check" CHECK ("crawl_pages"."compression" is null or length("crawl_pages"."compression") between 1 and 80);--> statement-breakpoint
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_m3_counters_check" CHECK ("crawls"."extracted_page_count" >= 0 and "crawls"."extraction_failed_count" >= 0 and "crawls"."rendered_page_count" >= 0 and "crawls"."artifact_count" >= 0 and "crawls"."sitemap_count" >= 0 and "crawls"."sitemap_url_count" >= 0);
