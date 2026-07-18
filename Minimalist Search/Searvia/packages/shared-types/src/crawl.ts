import { z } from "zod";

export const CRAWL_STATUSES = [
  "queued",
  "validating",
  "discovering",
  "crawling",
  "cancelled",
  "failed",
  "partially_completed",
  "completed",
] as const;

export const crawlStatusSchema = z.enum(CRAWL_STATUSES);

export type CrawlStatus = z.infer<typeof crawlStatusSchema>;

export const CRAWL_TERMINAL_STATUSES = [
  "cancelled",
  "failed",
  "partially_completed",
  "completed",
] as const satisfies readonly CrawlStatus[];

export const crawlTerminalStatusSchema = z.enum(CRAWL_TERMINAL_STATUSES);

export type CrawlTerminalStatus = z.infer<typeof crawlTerminalStatusSchema>;

const ALLOWED_CRAWL_TRANSITIONS = {
  queued: new Set<CrawlStatus>(["validating", "cancelled", "failed"]),
  validating: new Set<CrawlStatus>(["queued", "discovering", "cancelled", "failed"]),
  discovering: new Set<CrawlStatus>([
    "queued",
    "crawling",
    "cancelled",
    "failed",
    "partially_completed",
    "completed",
  ]),
  crawling: new Set<CrawlStatus>([
    "queued",
    "cancelled",
    "failed",
    "partially_completed",
    "completed",
  ]),
  cancelled: new Set<CrawlStatus>(),
  failed: new Set<CrawlStatus>(),
  partially_completed: new Set<CrawlStatus>(),
  completed: new Set<CrawlStatus>(),
} satisfies Readonly<Record<CrawlStatus, ReadonlySet<CrawlStatus>>>;

export function canTransitionCrawlStatus(from: CrawlStatus, to: CrawlStatus): boolean {
  return from === to || ALLOWED_CRAWL_TRANSITIONS[from].has(to);
}

export function isTerminalCrawlStatus(status: CrawlStatus): status is CrawlTerminalStatus {
  return crawlTerminalStatusSchema.safeParse(status).success;
}

export const crawlProgressCountersSchema = z
  .object({
    discovered: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    bytesReceived: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((counters, context) => {
    if (counters.processed > counters.discovered) {
      context.addIssue({
        code: "custom",
        path: ["processed"],
        message: "Processed pages cannot exceed discovered pages.",
      });
    }

    if (
      counters.succeeded + counters.failed + counters.blocked + counters.skipped !==
      counters.processed
    ) {
      context.addIssue({
        code: "custom",
        path: ["succeeded"],
        message: "Processed pages must equal the sum of terminal page outcomes.",
      });
    }
  });

export type CrawlProgressCounters = z.infer<typeof crawlProgressCountersSchema>;

export const crawlProgressSchema = z
  .object({
    crawlId: z.uuid(),
    status: crawlStatusSchema,
    counters: crawlProgressCountersSchema,
    cancellationRequested: z.boolean(),
    lastProgressAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type CrawlProgress = z.infer<typeof crawlProgressSchema>;
