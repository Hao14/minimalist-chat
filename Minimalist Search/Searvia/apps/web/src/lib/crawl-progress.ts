import type { CrawlProgressRecord, CrawlStatus } from "@searvia/database/runtime";
import { z } from "zod";

export const CRAWL_STATUS_VALUES = [
  "queued",
  "validating",
  "discovering",
  "crawling",
  "cancelled",
  "failed",
  "partially_completed",
  "completed",
] as const satisfies readonly CrawlStatus[];

export const ACTIVE_CRAWL_STATUSES = [
  "queued",
  "validating",
  "discovering",
  "crawling",
] as const satisfies readonly CrawlStatus[];

const activeCrawlStatuses = new Set<CrawlStatus>(ACTIVE_CRAWL_STATUSES);

export interface CrawlProgressDto {
  readonly id: string;
  readonly projectId: string;
  readonly status: CrawlStatus;
  readonly cancellationRequested: boolean;
  readonly discoveredCount: number;
  readonly processedCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly blockedCount: number;
  readonly skippedCount: number;
  readonly extractedPageCount: number;
  readonly extractionFailedCount: number;
  readonly renderedPageCount: number;
  readonly artifactCount: number;
  readonly sitemapCount: number;
  readonly sitemapUrlCount: number;
  readonly bytesReceived: number;
  readonly attemptCount: number;
  readonly completionReason: string | null;
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly lastProgressAt: string;
}

export const crawlProgressDtoSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    status: z.enum(CRAWL_STATUS_VALUES),
    cancellationRequested: z.boolean(),
    discoveredCount: z.number().int().nonnegative(),
    processedCount: z.number().int().nonnegative(),
    succeededCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    extractedPageCount: z.number().int().nonnegative(),
    extractionFailedCount: z.number().int().nonnegative(),
    renderedPageCount: z.number().int().nonnegative(),
    artifactCount: z.number().int().nonnegative(),
    sitemapCount: z.number().int().nonnegative(),
    sitemapUrlCount: z.number().int().nonnegative(),
    bytesReceived: z.number().int().nonnegative(),
    attemptCount: z.number().int().nonnegative(),
    completionReason: z.string().max(2_000).nullable(),
    errorType: z.string().max(120).nullable(),
    errorMessage: z.string().max(2_000).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    startedAt: z.iso.datetime({ offset: true }).nullable(),
    finishedAt: z.iso.datetime({ offset: true }).nullable(),
    lastProgressAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const crawlResponseSchema = z.object({ crawl: crawlProgressDtoSchema }).strict();
export const crawlCreateResponseSchema = crawlResponseSchema
  .extend({ created: z.boolean() })
  .strict();

export const crawlApiErrorSchema = z
  .object({
    error: z.object({ code: z.string().max(80), message: z.string().max(500) }).strict(),
    traceId: z.string().max(128),
  })
  .strict();

export function isActiveCrawlStatus(status: CrawlStatus): boolean {
  return activeCrawlStatuses.has(status);
}

export function shouldPollCrawl(crawl: CrawlProgressDto | null): boolean {
  return crawl !== null && isActiveCrawlStatus(crawl.status);
}

export function serializeCrawlProgress(crawl: CrawlProgressRecord): CrawlProgressDto {
  return Object.freeze({
    id: crawl.id,
    projectId: crawl.projectId,
    status: crawl.status,
    cancellationRequested: crawl.cancellationRequested,
    discoveredCount: crawl.discoveredCount,
    processedCount: crawl.processedCount,
    succeededCount: crawl.succeededCount,
    failedCount: crawl.failedCount,
    blockedCount: crawl.blockedCount,
    skippedCount: crawl.skippedCount,
    extractedPageCount: crawl.extractedPageCount,
    extractionFailedCount: crawl.extractionFailedCount,
    renderedPageCount: crawl.renderedPageCount,
    artifactCount: crawl.artifactCount,
    sitemapCount: crawl.sitemapCount,
    sitemapUrlCount: crawl.sitemapUrlCount,
    bytesReceived: crawl.bytesReceived,
    attemptCount: crawl.attemptCount,
    completionReason: crawl.completionReason,
    errorType: crawl.errorType,
    errorMessage: crawl.errorMessage,
    createdAt: crawl.createdAt.toISOString(),
    startedAt: crawl.startedAt?.toISOString() ?? null,
    finishedAt: crawl.finishedAt?.toISOString() ?? null,
    lastProgressAt: crawl.lastProgressAt.toISOString(),
  });
}

export function formatCrawlStatus(status: CrawlStatus): string {
  return status
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
