import { createHash } from "node:crypto";

import {
  createCrawlRunner,
  CrawlError,
  type CancellationPort,
  type CrawlClock,
  type CrawlPersistencePort,
  type CrawlProgress,
  type CrawlRunnerConfig,
  type CrawlState,
  type FrontierEntry,
  type PersistedFetch,
  type PersistedFetchContext,
  type RobotsPersistenceRecord,
  type SitemapPersistenceRecord,
  type SafeFetchRequest,
  type SafeFetchResponse,
  type SafeHttpClient,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

class MemoryPersistence implements CrawlPersistencePort {
  readonly discovered: FrontierEntry[] = [];
  readonly fetches: PersistedFetch[] = [];
  readonly fetchContexts: PersistedFetchContext[] = [];
  readonly progress: CrawlProgress[] = [];
  readonly robots: RobotsPersistenceRecord[] = [];
  readonly sitemaps: SitemapPersistenceRecord[] = [];
  readonly states: CrawlState[] = [];

  async discover(entry: FrontierEntry): Promise<boolean> {
    this.discovered.push(entry);
    return true;
  }
  async recordFetch(fetch: PersistedFetch, context?: PersistedFetchContext): Promise<void> {
    this.fetches.push(fetch);
    if (context !== undefined) this.fetchContexts.push(context);
  }
  async recordProgress(progress: CrawlProgress): Promise<void> {
    this.progress.push(progress);
  }
  async recordRobots(record: RobotsPersistenceRecord) {
    this.robots.push(record);
    return {
      observationId: `robots-${this.robots.length}`,
      result:
        record.state === "parsed"
          ? ("fetched" as const)
          : record.state === "unreachable" &&
              record.statusCode !== null &&
              record.statusCode >= 200 &&
              record.statusCode < 300
            ? ("invalid" as const)
            : record.state === "unavailable" && [404, 410].includes(record.statusCode ?? 0)
              ? ("not_found" as const)
              : ("unavailable" as const),
    };
  }
  async recordSitemap(record: SitemapPersistenceRecord): Promise<Readonly<{ id: string }>> {
    this.sitemaps.push(record);
    return { id: `sitemap-${this.sitemaps.length}` };
  }
  async transition(state: CrawlState): Promise<void> {
    this.states.push(state);
  }
}

function fetched(request: SafeFetchRequest, body: string, statusCode = 200): SafeFetchResponse {
  const encodedBody = new TextEncoder().encode(body);
  return {
    body: encodedBody,
    contentEncoding: null,
    contentLength: encodedBody.byteLength,
    contentType: request.kind === "robots" ? "text/plain" : "text/html",
    finalUrl: request.url,
    normalizedUrl: request.url,
    omittedResponseHeaders: [],
    redirectChain: [],
    responseHeaders: {},
    responseBytes: encodedBody.byteLength,
    requestedUrl: request.url,
    retryAfterMs: null,
    statusCode,
    timing: {
      dnsMs: 0,
      downloadMs: 0,
      startedAt: new Date(0).toISOString(),
      totalMs: 1,
      ttfbMs: 0,
    },
    transferBytes: encodedBody.byteLength,
  };
}

const config: CrawlRunnerConfig = {
  cancellationPollMs: 50,
  concurrency: 1,
  excludePatterns: [],
  includePatterns: [],
  includeSubdomains: false,
  maxDepth: 2,
  maxDiscoveredUrls: 20,
  maxPages: 10,
  maxQueryVariantsPerPath: 3,
  maxRetries: 2,
  maxSitemapUrls: 10,
  maxSitemaps: 2,
  maxSitemapDepth: 2,
  queryPolicy: "ignore_tracking",
  requestDelayMs: 0,
  respectRobots: true,
  supportedContentTypes: ["text/html", "application/xhtml+xml"],
  submittedSitemapUrls: [],
  totalDeadlineMs: 5_000,
};

const neverCancelled: CancellationPort = {
  isCancellationRequested: async () => false,
};

const immediateClock: CrawlClock = {
  now: () => 0,
  sleep: async () => undefined,
};

describe("crawl runner", () => {
  it("discovers breadth-first, retries transient errors, and records progress", async () => {
    const persistence = new MemoryPersistence();
    const attempts = new Map<string, number>();
    const client: SafeHttpClient = {
      async fetch(request) {
        attempts.set(request.url, (attempts.get(request.url) ?? 0) + 1);
        if (request.kind === "robots") {
          return fetched(request, "User-agent: SearviaBot\nAllow: /\n");
        }
        if (request.url.endsWith("/a") && attempts.get(request.url) === 1) {
          throw new CrawlError("network_error", "temporary", { transient: true });
        }
        if (request.url === "https://example.com/") {
          return fetched(request, '<a href="/a">A</a><a href="/b">B</a>');
        }
        return fetched(request, "done");
      },
    };
    const result = await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
      random: () => 0,
    }).run({
      config,
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    expect(result.state).toBe("completed");
    expect(result.progress.succeeded).toBe(3);
    expect(result.progress.processed).toBe(3);
    expect(attempts.get("https://example.com/a")).toBe(2);
    expect(persistence.fetches.map((fetch) => fetch.normalizedUrl)).toEqual([
      "https://example.com/",
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(persistence.states).toEqual(["validating", "discovering", "crawling", "completed"]);
  });

  it("uses structured HTML extraction for encoding, base URLs, areas, and raw-text exclusion", async () => {
    const persistence = new MemoryPersistence();
    const pageRequests: string[] = [];
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(request, "User-agent: SearviaBot\nAllow: /\n");
        }
        pageRequests.push(request.url);
        if (request.url !== "https://example.com/") return fetched(request, "done");

        const html =
          '<meta charset="windows-1252"><base href="/section/">' +
          "<script>const ignored = '<a href=\"/script-only\">';</script>" +
          '<!-- <a href="/comment-only">Comment</a> -->' +
          '<map><area href="café" alt="Café"></map>' +
          '<a href="/real?utm_source=test&amp;b=2">Real</a>';
        const body = Uint8Array.from([...html].map((character) => character.charCodeAt(0)));
        return {
          ...fetched(request, html),
          body,
          contentLength: body.byteLength,
          responseBytes: body.byteLength,
          responseHeaders: { "content-type": ["text/html; charset=windows-1252"] },
          transferBytes: body.byteLength,
        };
      },
    };

    const result = await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config,
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    expect(result.state).toBe("completed");
    expect(pageRequests).toEqual([
      "https://example.com/",
      "https://example.com/section/caf%C3%A9",
      "https://example.com/real?b=2",
    ]);
    expect(pageRequests).not.toContain("https://example.com/script-only");
    expect(pageRequests).not.toContain("https://example.com/comment-only");
    expect(persistence.fetches[0]?.discoveredUrls).toEqual([
      "https://example.com/section/caf%C3%A9",
      "https://example.com/real?b=2",
    ]);
  });

  it("persists a fetched page instead of retry-looping when discovery extraction hits a safety limit", async () => {
    const persistence = new MemoryPersistence();
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(request, "User-agent: SearviaBot\nAllow: /\n");
        }
        return fetched(request, "<i>".repeat(100_001));
      },
    };

    const result = await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config,
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    expect(result.state).toBe("completed");
    expect(result.progress.succeeded).toBe(1);
    expect(persistence.fetches).toHaveLength(1);
    expect(persistence.fetches[0]?.discoveredUrls).toEqual([]);
  });

  it("rehydrates persisted entries without replaying the seed or double-charging discovery", async () => {
    class ResumePersistence extends MemoryPersistence {
      override async discover(entry: FrontierEntry): Promise<boolean> {
        this.discovered.push(entry);
        return entry.normalizedUrl !== "https://example.com/";
      }
    }
    const persistence = new ResumePersistence();
    const pageRequests: string[] = [];
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(request, "User-agent: SearviaBot\nAllow: /\n");
        }
        pageRequests.push(request.url);
        return fetched(
          request,
          request.url.endsWith("/pending")
            ? '<a href="/new">New</a><a href="/over-limit">Over</a>'
            : "done",
        );
      },
    };

    const result = await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config: { ...config, maxDiscoveredUrls: 4, maxPages: 2 },
      initialDiscoveredCount: 3,
      resumeEntries: [
        {
          depth: 1,
          discoverySource: "link",
          requestedUrl: "https://example.com/pending",
        },
      ],
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    expect(result.state).toBe("completed");
    expect(result.progress.discovered).toBe(4);
    expect(pageRequests).toEqual(["https://example.com/pending", "https://example.com/new"]);
    expect(persistence.fetches.map((fetch) => fetch.normalizedUrl)).toEqual([
      "https://example.com/pending",
      "https://example.com/new",
    ]);
    expect(persistence.discovered.map((entry) => entry.normalizedUrl)).not.toContain(
      "https://example.com/over-limit",
    );
  });

  it("honors robots without sending the blocked page request", async () => {
    const persistence = new MemoryPersistence();
    let pageRequests = 0;
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(request, "User-agent: SearviaBot\nDisallow: /\n");
        }
        pageRequests += 1;
        return fetched(request, "should not happen");
      },
    };
    const result = await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config,
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });
    expect(result.state).toBe("completed");
    expect(result.progress.blocked).toBe(1);
    expect(pageRequests).toBe(0);
    expect(persistence.robots[0]).toMatchObject({
      content: "User-agent: SearviaBot\nDisallow: /\n",
      state: "parsed",
      statusCode: 200,
    });
    expect(persistence.fetches[0]).toMatchObject({
      errorCode: "robots_disallowed",
      robotsDecision: "disallowed",
      robotsObservationId: "robots-1",
    });
  });

  it("exposes resource robots decisions with the persisted policy provenance", async () => {
    const persistence = new MemoryPersistence();
    const requestedRobots: string[] = [];
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          requestedRobots.push(request.url);
          return fetched(
            request,
            "User-agent: SearviaBot\nDisallow: /assets/blocked.js\nAllow: /assets/allowed.css\n",
          );
        }
        return fetched(request, "<html><body>done</body></html>");
      },
    };
    await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config,
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    const fetchContext = persistence.fetchContexts[0];
    expect(fetchContext).toBeDefined();
    if (fetchContext === undefined) throw new Error("Expected a persisted fetch context.");
    await expect(
      fetchContext.observeResourceRobots("https://example.com/assets/blocked.js"),
    ).resolves.toEqual({
      decision: "disallowed",
      observationId: "robots-1",
      result: "fetched",
    });
    await expect(
      fetchContext.observeResourceRobots("https://example.com/assets/allowed.css"),
    ).resolves.toEqual({
      decision: "allowed",
      observationId: "robots-1",
      result: "fetched",
    });
    const unobservedSubdomains = await Promise.all(
      Array.from({ length: 250 }, (_, index) =>
        fetchContext.observeResourceRobots(`https://assets-${index}.example.com/app.js`),
      ),
    );
    expect(new Set(unobservedSubdomains.map((observation) => observation?.decision))).toEqual(
      new Set(["not_checked"]),
    );
    expect(
      unobservedSubdomains.every(
        (observation) => observation.observationId === null && observation.result === null,
      ),
    ).toBe(true);
    expect(requestedRobots).toEqual(["https://example.com/robots.txt"]);
  });

  it("keeps resource robots decisions not checked when policy retrieval is unavailable", async () => {
    const persistence = new MemoryPersistence();
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") return fetched(request, "forbidden", 403);
        return fetched(request, "<html><body>done</body></html>");
      },
    };
    const result = await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config,
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    await expect(
      persistence.fetchContexts[0]?.observeResourceRobots("https://example.com/assets/app.js"),
    ).resolves.toEqual({
      decision: "not_checked",
      observationId: "robots-1",
      result: "unavailable",
    });
    expect(result).toMatchObject({ state: "failed", errorCode: "robots_unreachable" });
    expect(persistence.fetches[0]).toMatchObject({
      errorCode: "robots_unreachable",
      robotsDecision: "not_checked",
      robotsObservationId: "robots-1",
    });
  });

  it("blocks an excessive robots crawl delay without recording an explicit denial", async () => {
    const persistence = new MemoryPersistence();
    let pageRequests = 0;
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(request, "User-agent: SearviaBot\nAllow: /\nCrawl-delay: 61\n");
        }
        pageRequests += 1;
        return fetched(request, "should not happen");
      },
    };
    const result = await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config,
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    expect(pageRequests).toBe(0);
    expect(result).toMatchObject({ state: "failed", errorCode: "crawl_limit" });
    expect(persistence.fetches[0]).toMatchObject({
      errorCode: "crawl_limit",
      robotsDecision: "not_checked",
      robotsObservationId: "robots-1",
    });
    expect(persistence.robots[0]?.crawlDelayMs).toBe(61_000);
  });

  it("marks an unsupported successful page response as skipped", async () => {
    const persistence = new MemoryPersistence();
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(request, "User-agent: SearviaBot\nAllow: /\n");
        }
        return { ...fetched(request, "xml"), contentType: "application/xhtml+xml" };
      },
    };
    const result = await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config: { ...config, supportedContentTypes: ["text/html"] },
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    expect(result.state).toBe("completed");
    expect(result.progress).toMatchObject({ failed: 0, skipped: 1, succeeded: 0 });
    expect(persistence.fetches).toHaveLength(1);
    expect(persistence.fetches[0]).toMatchObject({
      errorCode: "unsupported_content_type",
      fetchKind: "page",
      statusCode: 200,
    });
  });

  it("fetches and persists robots policy separately for each encountered origin", async () => {
    const persistence = new MemoryPersistence();
    const requestedRobots: string[] = [];
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          requestedRobots.push(request.url);
          return fetched(request, "User-agent: SearviaBot\nAllow: /\n");
        }
        if (request.url === "https://example.com/") {
          return fetched(request, '<a href="https://docs.example.com/guide">Guide</a>');
        }
        return fetched(request, "done");
      },
    };
    const result = await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config: { ...config, includeSubdomains: true },
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    expect(result.state).toBe("completed");
    expect(result.progress.succeeded).toBe(2);
    expect(requestedRobots).toEqual([
      "https://example.com/robots.txt",
      "https://docs.example.com/robots.txt",
    ]);
    expect(persistence.robots.map((record) => record.origin)).toEqual([
      "https://example.com",
      "https://docs.example.com",
    ]);
  });

  it("persists submitted and robots-declared sitemaps and traverses bounded indexes", async () => {
    const persistence = new MemoryPersistence();
    const robotsIndex =
      "<sitemapindex><sitemap><loc>https://example.com/nested.xml</loc></sitemap></sitemapindex>";
    const nestedUrlSet =
      "<urlset><url><loc>https://example.com/from-index</loc><lastmod>2026-07-15</lastmod></url></urlset>";
    const submittedUrlSet =
      "<urlset><url><loc>https://example.com/from-submitted</loc></url></urlset>";
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(
            request,
            "User-agent: SearviaBot\nAllow: /\nSitemap: https://example.com/robots-index.xml\n",
          );
        }
        if (request.kind === "sitemap") {
          if (request.url.endsWith("/robots-index.xml")) {
            return {
              ...fetched(request, robotsIndex),
              contentType: "application/xml",
            };
          }
          if (request.url.endsWith("/nested.xml")) {
            return {
              ...fetched(request, nestedUrlSet),
              contentEncoding: "gzip",
              contentType: "application/xml",
              transferBytes: 80,
            };
          }
          return {
            ...fetched(request, submittedUrlSet),
            contentType: "application/xml",
          };
        }
        return fetched(request, "<html><title>Page</title><body>Page content</body></html>");
      },
    };

    const result = await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config: {
        ...config,
        maxPages: 3,
        maxSitemaps: 5,
        submittedSitemapUrls: ["https://example.com/submitted.xml"],
      },
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    expect(result.state).toBe("completed");
    expect(persistence.sitemaps.map((sitemap) => sitemap.source)).toEqual([
      "submitted",
      "robots",
      "index",
    ]);
    expect(persistence.sitemaps[2]).toMatchObject({
      compression: "gzip",
      documentDigest: createHash("sha256").update(nestedUrlSet).digest("hex"),
      parentPersistenceId: "sitemap-2",
      state: "parsed",
      transferBytes: 80,
    });
    expect(persistence.sitemaps.map((sitemap) => sitemap.documentDigest)).toEqual([
      createHash("sha256").update(submittedUrlSet).digest("hex"),
      createHash("sha256").update(robotsIndex).digest("hex"),
      createHash("sha256").update(nestedUrlSet).digest("hex"),
    ]);
    expect(persistence.sitemaps[2]?.locations[0]).toMatchObject({
      lastModified: "2026-07-15",
      lastModifiedValid: true,
      normalizedUrl: "https://example.com/from-index",
    });
    expect(persistence.discovered.map((entry) => entry.normalizedUrl)).toEqual(
      expect.arrayContaining([
        "https://example.com/from-index",
        "https://example.com/from-submitted",
      ]),
    );
    expect(persistence.fetches.every((fetch) => fetch.fetchKind === "page")).toBe(true);
  });

  it("commits the immutable sitemap before adding its page entries to the frontier", async () => {
    const events: string[] = [];
    class OrderedPersistence extends MemoryPersistence {
      override async discover(entry: FrontierEntry): Promise<boolean> {
        events.push(`discover:${entry.normalizedUrl}`);
        return super.discover(entry);
      }

      override async recordSitemap(
        record: SitemapPersistenceRecord,
      ): Promise<Readonly<{ id: string }>> {
        events.push(`sitemap:${record.normalizedUrl}`);
        return super.recordSitemap(record);
      }
    }
    const persistence = new OrderedPersistence();
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(request, "User-agent: SearviaBot\nAllow: /\n");
        }
        if (request.kind === "sitemap") {
          return {
            ...fetched(
              request,
              "<urlset><url><loc>https://example.com/from-sitemap</loc></url></urlset>",
            ),
            contentType: "application/xml",
          };
        }
        return fetched(request, "done");
      },
    };

    await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config: {
        ...config,
        maxPages: 2,
        submittedSitemapUrls: ["https://example.com/sitemap.xml"],
      },
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    expect(events.indexOf("discover:https://example.com/from-sitemap")).toBeGreaterThan(
      events.indexOf("sitemap:https://example.com/sitemap.xml"),
    );
  });

  it("does not leak frontier URLs when immutable sitemap persistence conflicts", async () => {
    class ConflictingPersistence extends MemoryPersistence {
      override async recordSitemap(): Promise<Readonly<{ id: string }>> {
        throw new Error("immutable sitemap conflict");
      }
    }
    const persistence = new ConflictingPersistence();
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(request, "User-agent: SearviaBot\nAllow: /\n");
        }
        if (request.kind === "sitemap") {
          return {
            ...fetched(
              request,
              "<urlset><url><loc>https://example.com/from-conflict</loc></url></urlset>",
            ),
            contentType: "application/xml",
          };
        }
        return fetched(request, "done");
      },
    };

    await expect(
      createCrawlRunner({
        cancellation: neverCancelled,
        client,
        clock: immediateClock,
        persistence,
      }).run({
        config: {
          ...config,
          submittedSitemapUrls: ["https://example.com/sitemap.xml"],
        },
        target: {
          crawlId: "crawl",
          organizationId: "org",
          projectId: "project",
          startUrl: "https://example.com/",
        },
      }),
    ).rejects.toThrow("immutable sitemap conflict");
    expect(persistence.discovered.map((entry) => entry.normalizedUrl)).not.toContain(
      "https://example.com/from-conflict",
    );
  });

  it("does not refetch a sitemap redirect destination already persisted through its alias", async () => {
    const persistence = new MemoryPersistence();
    const sitemapRequests: string[] = [];
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(request, "User-agent: SearviaBot\nAllow: /\n");
        }
        if (request.kind === "sitemap") {
          sitemapRequests.push(request.url);
          return {
            ...fetched(request, "<urlset></urlset>"),
            contentType: "application/xml",
            finalUrl: "https://example.com/canonical.xml",
            redirectChain: [
              {
                fromUrl: "https://example.com/alias.xml",
                statusCode: 301,
                toUrl: "https://example.com/canonical.xml",
              },
            ],
          };
        }
        return fetched(request, "done");
      },
    };

    await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config: {
        ...config,
        submittedSitemapUrls: [
          "https://example.com/alias.xml",
          "https://example.com/canonical.xml",
        ],
      },
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    expect(sitemapRequests).toEqual(["https://example.com/alias.xml"]);
    expect(persistence.sitemaps).toHaveLength(1);
    expect(persistence.sitemaps[0]).toMatchObject({
      finalUrl: "https://example.com/canonical.xml",
      normalizedUrl: "https://example.com/alias.xml",
    });
  });

  it("paces actual redirect target operations through the destination origin scheduler", async () => {
    const persistence = new MemoryPersistence();
    let now = 0;
    const events: string[] = [];
    const destinationStarts: number[] = [];
    const clock: CrawlClock = {
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    };
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(request, "User-agent: SearviaBot\nAllow: /\n");
        }
        if (request.scheduleRequest === undefined) {
          throw new Error("Expected every page request to provide a scheduler hook.");
        }
        await request.scheduleRequest({ redirect: null, url: request.url }, async () => undefined);
        if (request.url === "https://example.com/") {
          return fetched(
            request,
            '<a href="https://a.example.com/page">A</a><a href="https://b.example.com/page">B</a>',
          );
        }

        const suffix = new URL(request.url).hostname.startsWith("a.") ? "a" : "b";
        const redirect = Object.freeze({
          fromUrl: request.url,
          statusCode: 302,
          toUrl: `https://target.example.com/${suffix}`,
        });
        events.push(`authorize:${redirect.toUrl}`);
        await request.authorizeRedirect?.(redirect);
        await request.scheduleRequest({ redirect, url: redirect.toUrl }, async () => {
          events.push(`target:${redirect.toUrl}`);
          destinationStarts.push(now);
        });
        return {
          ...fetched(request, "done"),
          finalUrl: redirect.toUrl,
          redirectChain: [redirect],
        };
      },
    };

    const result = await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock,
      persistence,
    }).run({
      config: {
        ...config,
        concurrency: 2,
        includeSubdomains: true,
        maxPages: 3,
        requestDelayMs: 100,
      },
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    expect(result.state).toBe("completed");
    expect(destinationStarts).toEqual([0, 100]);
    for (const suffix of ["a", "b"]) {
      expect(events.indexOf(`authorize:https://target.example.com/${suffix}`)).toBeLessThan(
        events.indexOf(`target:https://target.example.com/${suffix}`),
      );
    }
  });

  it("does not bind a cross-origin redirect robots denial to the requested page origin", async () => {
    const persistence = new MemoryPersistence();
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(
            request,
            new URL(request.url).origin === "https://blocked.example.net"
              ? "User-agent: SearviaBot\nDisallow: /\n"
              : "User-agent: SearviaBot\nAllow: /\n",
          );
        }
        const redirect = Object.freeze({
          fromUrl: request.url,
          statusCode: 302,
          toUrl: "https://blocked.example.net/private",
        });
        await request.authorizeRedirect?.(redirect);
        throw new Error("A denied redirect destination must not be requested.");
      },
    };

    await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config,
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });

    expect(persistence.fetches[0]).toMatchObject({
      errorCode: "robots_disallowed",
      robotsDecision: "not_checked",
      robotsObservationId: null,
    });
    expect(persistence.robots.map((record) => record.origin)).toEqual([
      "https://example.com",
      "https://blocked.example.net",
    ]);
  });

  it("propagates persistence failures so the durable worker can retry the attempt", async () => {
    const storageFailure = new Error("object storage unavailable");
    class FailingPersistence extends MemoryPersistence {
      override async recordFetch(): Promise<void> {
        throw storageFailure;
      }
    }
    const persistence = new FailingPersistence();
    const client: SafeHttpClient = {
      async fetch(request) {
        return fetched(
          request,
          request.kind === "robots"
            ? "User-agent: SearviaBot\nAllow: /\n"
            : "<html><title>Evidence</title><body>content</body></html>",
        );
      },
    };

    await expect(
      createCrawlRunner({
        cancellation: neverCancelled,
        client,
        clock: immediateClock,
        persistence,
      }).run({
        config,
        target: {
          crawlId: "crawl",
          organizationId: "org",
          projectId: "project",
          startUrl: "https://example.com/",
        },
      }),
    ).rejects.toBe(storageFailure);
    expect(persistence.states).not.toContain("failed");
  });

  it("aborts an active request and reaches cancelled", async () => {
    const persistence = new MemoryPersistence();
    const external = new AbortController();
    const client: SafeHttpClient = {
      async fetch(request) {
        if (request.kind === "robots") {
          return fetched(request, "User-agent: SearviaBot\nAllow: /\n");
        }
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener(
            "abort",
            () => reject(new CrawlError("cancelled", "cancelled")),
            { once: true },
          );
          external.abort();
        });
      },
    };
    const result = await createCrawlRunner({
      cancellation: neverCancelled,
      client,
      clock: immediateClock,
      persistence,
    }).run({
      config,
      signal: external.signal,
      target: {
        crawlId: "crawl",
        organizationId: "org",
        projectId: "project",
        startUrl: "https://example.com/",
      },
    });
    expect(result.state).toBe("cancelled");
    expect(persistence.states.at(-1)).toBe("cancelled");
  });
});
