"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  crawlApiErrorSchema,
  crawlCreateResponseSchema,
  crawlResponseSchema,
  formatCrawlStatus,
  shouldPollCrawl,
  type CrawlProgressDto,
} from "@/lib/crawl-progress";

import styles from "./application-shell.module.css";

const POLL_INTERVAL_MS = 1_500;

interface CrawlLaunchBoundaryProps {
  readonly projectId: string;
  readonly initialCrawls: readonly CrawlProgressDto[];
  readonly canStart: boolean;
  readonly canCancel: boolean;
}

async function responseError(response: Response): Promise<string> {
  try {
    const parsed = crawlApiErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      return `${parsed.data.error.message} Reference: ${parsed.data.traceId}.`;
    }
  } catch {
    // The generic error below is deliberately independent of malformed response content.
  }
  return "The crawl request could not be completed. Try again.";
}

function utcTimestamp(value: string): string {
  return `${value.slice(0, 19).replace("T", " ")} UTC`;
}

export function CrawlLaunchBoundary({
  projectId,
  initialCrawls,
  canStart,
  canCancel,
}: CrawlLaunchBoundaryProps) {
  const router = useRouter();
  const [crawl, setCrawl] = useState<CrawlProgressDto | null>(initialCrawls[0] ?? null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const refreshedTerminalCrawlId = useRef<string | null>(null);
  const pollCrawlId = crawl !== null && shouldPollCrawl(crawl) ? crawl.id : null;

  useEffect(() => {
    if (pollCrawlId === null) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function poll() {
      try {
        const response = await fetch(`/api/projects/${projectId}/crawls/${pollCrawlId}`, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (response.status === 401) {
          setError("Your session expired. Sign in again to resume live progress.");
          return;
        }
        if (response.status === 403) {
          setError("Your organization access changed. Refresh to confirm your permissions.");
          return;
        }
        if (response.status === 404) {
          setError("This crawl is no longer available to the active organization.");
          return;
        }
        if (!response.ok) throw new Error("progress request failed");
        const parsed = crawlResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("progress response invalid");
        if (!active) return;
        setCrawl(parsed.data.crawl);
        setError("");
        if (shouldPollCrawl(parsed.data.crawl)) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        } else if (refreshedTerminalCrawlId.current !== parsed.data.crawl.id) {
          refreshedTerminalCrawlId.current = parsed.data.crawl.id;
          router.refresh();
        }
      } catch {
        if (!active || controller.signal.aborted) return;
        setError("Live progress is temporarily unavailable. Retrying…");
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    };
  }, [pollCrawlId, projectId, router]);

  async function startCrawl() {
    setStarting(true);
    setError("");
    idempotencyKey.current ??= crypto.randomUUID();

    try {
      const response = await fetch(`/api/projects/${projectId}/crawls`, {
        method: "POST",
        headers: {
          "Idempotency-Key": idempotencyKey.current,
          "X-Request-ID": crypto.randomUUID(),
        },
      });
      if (!response.ok) {
        setError(await responseError(response));
        return;
      }
      const parsed = crawlCreateResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setError("The crawl response was invalid. Refresh and try again.");
        return;
      }
      idempotencyKey.current = null;
      refreshedTerminalCrawlId.current = null;
      setCrawl(parsed.data.crawl);
      router.refresh();
    } catch {
      setError("The crawl could not be queued. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  async function cancelCrawl() {
    if (crawl === null) return;
    setCancelling(true);
    setError("");

    try {
      const response = await fetch(`/api/projects/${projectId}/crawls/${crawl.id}/cancel`, {
        method: "POST",
        headers: { "X-Request-ID": crypto.randomUUID() },
      });
      if (!response.ok) {
        setError(await responseError(response));
        return;
      }
      const parsed = crawlResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setError("The cancellation response was invalid. Refresh to confirm crawl status.");
        return;
      }
      setCrawl(parsed.data.crawl);
      if (!shouldPollCrawl(parsed.data.crawl)) {
        refreshedTerminalCrawlId.current = parsed.data.crawl.id;
        router.refresh();
      }
    } catch {
      setError("Cancellation could not be requested. Try again.");
    } finally {
      setCancelling(false);
    }
  }

  if (crawl === null) {
    return (
      <section className={styles.emptyState} aria-labelledby="audit-empty-heading">
        <h2 id="audit-empty-heading">No audit has been run yet.</h2>
        <p>Start a crawl to discover allowed public pages. Audit rules run in a later stage.</p>
        <div className={styles.crawlBoundary}>
          {canStart ? (
            <button
              className={styles.primaryButton}
              disabled={starting}
              onClick={startCrawl}
              type="button"
            >
              {starting ? "Queueing crawl…" : "Start first crawl"}
            </button>
          ) : (
            <p>Your role can view crawl progress but cannot start a crawl.</p>
          )}
          {error ? (
            <p className={styles.crawlError} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  const active = shouldPollCrawl(crawl);

  return (
    <section className={styles.crawlPanel} aria-labelledby="crawl-status-heading">
      <div className={styles.crawlHeading}>
        <div>
          <p className={styles.eyebrow}>Latest crawl</p>
          <h2 id="crawl-status-heading">{formatCrawlStatus(crawl.status)}</h2>
        </div>
        <span className={styles.crawlStatus} data-status={crawl.status} aria-live="polite">
          {crawl.cancellationRequested && active
            ? "Cancellation requested"
            : formatCrawlStatus(crawl.status)}
        </span>
      </div>

      <dl className={styles.progressGrid} aria-label="Real crawl progress counters">
        <div>
          <dt>Discovered</dt>
          <dd>{crawl.discoveredCount}</dd>
        </div>
        <div>
          <dt>Processed</dt>
          <dd>{crawl.processedCount}</dd>
        </div>
        <div>
          <dt>Succeeded</dt>
          <dd>{crawl.succeededCount}</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd>{crawl.failedCount}</dd>
        </div>
        <div>
          <dt>Blocked</dt>
          <dd>{crawl.blockedCount}</dd>
        </div>
        <div>
          <dt>Skipped</dt>
          <dd>{crawl.skippedCount}</dd>
        </div>
        <div>
          <dt>Extracted</dt>
          <dd>{crawl.extractedPageCount}</dd>
        </div>
        <div>
          <dt>Extraction failures</dt>
          <dd>{crawl.extractionFailedCount}</dd>
        </div>
        <div>
          <dt>Rendered</dt>
          <dd>{crawl.renderedPageCount}</dd>
        </div>
        <div>
          <dt>Artifacts</dt>
          <dd>{crawl.artifactCount}</dd>
        </div>
        <div>
          <dt>Sitemaps</dt>
          <dd>{crawl.sitemapCount}</dd>
        </div>
        <div>
          <dt>Sitemap URLs</dt>
          <dd>{crawl.sitemapUrlCount}</dd>
        </div>
        <div>
          <dt>Bytes received</dt>
          <dd>{crawl.bytesReceived.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Attempts</dt>
          <dd>{crawl.attemptCount}</dd>
        </div>
      </dl>

      <p className={styles.progressTimestamp}>
        Last progress:{" "}
        <time dateTime={crawl.lastProgressAt}>{utcTimestamp(crawl.lastProgressAt)}</time>
      </p>

      {crawl.errorMessage ? (
        <p className={styles.crawlError} role="alert">
          {crawl.errorMessage}
        </p>
      ) : null}
      {error ? (
        <p className={styles.crawlError} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.actions}>
        {active && canCancel ? (
          <button
            className={styles.secondaryButton}
            disabled={cancelling || crawl.cancellationRequested}
            onClick={cancelCrawl}
            type="button"
          >
            {cancelling
              ? "Requesting cancellation…"
              : crawl.cancellationRequested
                ? "Cancellation requested"
                : "Cancel crawl"}
          </button>
        ) : null}
        {!active && canStart ? (
          <button
            className={styles.primaryButton}
            disabled={starting}
            onClick={startCrawl}
            type="button"
          >
            {starting ? "Queueing crawl…" : "Start another crawl"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
