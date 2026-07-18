import {
  CrawlError,
  createCrawlRunner,
  createRobotsService,
  type CancellationPort,
  type CrawlPersistencePort,
  type CrawlProgress,
  type CrawlRunnerConfig,
  type CrawlState,
  type FrontierEntry,
  type PersistedFetch,
  type RobotsPersistenceRecord,
  type SitemapPersistenceRecord,
} from "@searvia/crawler-core";
import { createTestSafeHttpClient } from "@searvia/crawler-core/testing";
import { afterEach, describe, expect, it } from "vitest";

import { startCrawlerFixtureSite, type CrawlerFixtureSite } from "../src/index.js";

const openSites: CrawlerFixtureSite[] = [];

afterEach(async () => {
  await Promise.all(openSites.splice(0).map((site) => site.close()));
});

async function fixture(kind: Parameters<typeof startCrawlerFixtureSite>[0]) {
  const site = await startCrawlerFixtureSite(kind);
  openSites.push(site);
  return site;
}

function scope(origin: string) {
  return { hostname: new URL(origin).hostname, includeSubdomains: false } as const;
}

class FixturePersistence implements CrawlPersistencePort {
  readonly fetches: PersistedFetch[] = [];
  readonly states: CrawlState[] = [];
  readonly discovered: FrontierEntry[] = [];
  readonly robots: RobotsPersistenceRecord[] = [];
  readonly sitemaps: SitemapPersistenceRecord[] = [];
  readonly progress: CrawlProgress[] = [];

  async discover(entry: FrontierEntry): Promise<boolean> {
    this.discovered.push(entry);
    return true;
  }
  async recordFetch(fetch: PersistedFetch): Promise<void> {
    this.fetches.push(fetch);
  }
  async recordProgress(progress: CrawlProgress): Promise<void> {
    this.progress.push(progress);
  }
  async recordRobots(record: RobotsPersistenceRecord) {
    this.robots.push(record);
    return {
      observationId: `fixture-robots-${this.robots.length}`,
      result:
        record.state === "parsed"
          ? ("fetched" as const)
          : record.state === "unavailable" && [404, 410].includes(record.statusCode ?? 0)
            ? ("not_found" as const)
            : ("unavailable" as const),
    };
  }
  async recordSitemap(record: SitemapPersistenceRecord): Promise<Readonly<{ id: string }>> {
    this.sitemaps.push(record);
    return { id: `fixture-sitemap-${this.sitemaps.length}` };
  }
  async transition(state: CrawlState): Promise<void> {
    this.states.push(state);
  }
}

const cancellation: CancellationPort = {
  isCancellationRequested: async () => false,
};

const runnerConfig: CrawlRunnerConfig = {
  cancellationPollMs: 50,
  concurrency: 2,
  excludePatterns: [],
  includePatterns: [],
  includeSubdomains: false,
  maxDepth: 3,
  maxDiscoveredUrls: 30,
  maxPages: 10,
  maxQueryVariantsPerPath: 3,
  maxRetries: 2,
  maxSitemapUrls: 20,
  maxSitemaps: 2,
  maxSitemapDepth: 2,
  queryPolicy: "ignore_tracking",
  requestDelayMs: 0,
  respectRobots: true,
  supportedContentTypes: ["text/html", "application/xhtml+xml"],
  submittedSitemapUrls: [],
  totalDeadlineMs: 10_000,
};

function crawler(
  site: CrawlerFixtureSite,
  overrides: Parameters<typeof createTestSafeHttpClient>[0]["fetchLimits"] = {},
) {
  return createTestSafeHttpClient({
    exactEndpoints: [site.origin],
    fetchLimits: {
      connectTimeoutMs: 1_000,
      dnsTimeoutMs: 1_000,
      headersTimeoutMs: 1_000,
      idleTimeoutMs: 1_000,
      requestTimeoutMs: 3_000,
      ...overrides,
    },
  });
}

async function runFixture(site: CrawlerFixtureSite, config: CrawlRunnerConfig = runnerConfig) {
  const persistence = new FixturePersistence();
  const result = await createCrawlRunner({
    cancellation,
    client: crawler(site),
    persistence,
    random: () => 0,
  }).run({
    config,
    target: {
      crawlId: "crawl-fixture",
      organizationId: "organization-fixture",
      projectId: "project-fixture",
      startUrl: `${site.origin}/`,
    },
  });
  return { persistence, result };
}

describe("deterministic crawler fixture sites", () => {
  it("fetches and discovers the healthy site without duplicate tracking URLs", async () => {
    const site = await fixture("healthy");
    const { result } = await runFixture(site);
    expect(result.state).toBe("completed");
    expect(result.progress.succeeded).toBe(2);
    expect(site.requestCount("/about")).toBe(1);
  });

  it("honors robots.txt and never requests the blocked path", async () => {
    const site = await fixture("robots-blocked");
    const { result } = await runFixture(site);
    expect(result.state).toBe("completed");
    expect(result.progress.blocked).toBe(1);
    expect(site.requestCount("/private")).toBe(0);
    expect(site.requestCount("/public")).toBe(1);
  });

  it("revalidates robots across a changed origin and never fetches the disallowed redirect target", async () => {
    const site = await fixture("robots-redirect-blocked");
    if (site.trapOrigin === null) throw new Error("Expected the redirect destination fixture.");
    const persistence = new FixturePersistence();
    const client = createTestSafeHttpClient({
      exactEndpoints: [site.origin, site.trapOrigin],
      fetchLimits: {
        connectTimeoutMs: 1_000,
        dnsTimeoutMs: 1_000,
        headersTimeoutMs: 1_000,
        idleTimeoutMs: 1_000,
        requestTimeoutMs: 3_000,
      },
    });
    const result = await createCrawlRunner({
      cancellation,
      client,
      persistence,
      random: () => 0,
    }).run({
      config: runnerConfig,
      target: {
        crawlId: "crawl-robots-redirect",
        organizationId: "organization-fixture",
        projectId: "project-fixture",
        startUrl: `${site.origin}/`,
      },
    });

    expect(result.state).toBe("completed");
    expect(result.progress).toMatchObject({ blocked: 1, failed: 0, processed: 1 });
    expect(site.trapRequestCount("/robots.txt")).toBe(1);
    expect(site.trapRequestCount("/private")).toBe(0);
    expect(persistence.robots).toContainEqual(
      expect.objectContaining({ origin: site.trapOrigin, state: "parsed" }),
    );
    expect(persistence.fetches).toContainEqual(
      expect.objectContaining({
        errorCode: "robots_disallowed",
        fetchKind: "page",
        // The redirect-target policy cannot be attributed to the original
        // requested-URL row. Keep the operational block, but persist the
        // original row as not checked rather than attaching cross-origin proof.
        robotsDecision: "not_checked",
        robotsObservationId: null,
      }),
    );
  });

  it("follows a bounded redirect chain and detects loops", async () => {
    const chain = await fixture("redirect-chain");
    const chainResponse = await crawler(chain).fetch({
      kind: "page",
      scope: scope(chain.origin),
      url: `${chain.origin}/`,
    });
    expect(chainResponse.finalUrl).toBe(`${chain.origin}/final`);
    expect(chainResponse.redirectChain).toHaveLength(2);

    const loop = await fixture("redirect-loop");
    await expect(
      crawler(loop).fetch({ kind: "page", scope: scope(loop.origin), url: `${loop.origin}/` }),
    ).rejects.toMatchObject({ code: "redirect_loop" });
  });

  it("revalidates a private redirect and proves the trap receives zero requests", async () => {
    const site = await fixture("private-ip-redirect");
    await expect(
      crawler(site).fetch({ kind: "page", scope: scope(site.origin), url: `${site.origin}/` }),
    ).rejects.toMatchObject({ code: "blocked_address" });
    expect(site.trapRequestCount()).toBe(0);
  });

  it("stops chunked and decompressed oversized responses", async () => {
    const site = await fixture("oversized-response");
    const limited = crawler(site, {
      maxEncodedBytes: 64 * 1_024,
      maxResponseBytes: 32 * 1_024,
    });
    await expect(
      limited.fetch({ kind: "page", scope: scope(site.origin), url: `${site.origin}/` }),
    ).rejects.toMatchObject({ code: "response_too_large" });
    await expect(
      limited.fetch({ kind: "page", scope: scope(site.origin), url: `${site.origin}/gzip` }),
    ).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("enforces header and idle-body timeouts", async () => {
    const site = await fixture("timeout");
    const limited = crawler(site, {
      headersTimeoutMs: 100,
      idleTimeoutMs: 100,
      requestTimeoutMs: 1_000,
    });
    await expect(
      limited.fetch({ kind: "page", scope: scope(site.origin), url: `${site.origin}/` }),
    ).rejects.toMatchObject({ code: "headers_timeout" });
    await expect(
      limited.fetch({ kind: "page", scope: scope(site.origin), url: `${site.origin}/idle` }),
    ).rejects.toMatchObject({ code: "idle_timeout" });
  });

  it("preserves an active request abort reason from the crawl deadline", async () => {
    const site = await fixture("timeout");
    const controller = new AbortController();
    const pending = crawler(site, {
      headersTimeoutMs: 1_000,
      requestTimeoutMs: 2_000,
    }).fetch({
      kind: "page",
      scope: scope(site.origin),
      signal: controller.signal,
      url: `${site.origin}/`,
    });
    while (site.requestCount("/") === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    controller.abort(
      new CrawlError("request_timeout", "The total crawl deadline was exceeded.", {
        transient: true,
      }),
    );

    await expect(pending).rejects.toMatchObject({ code: "request_timeout" });
  });

  it("discovers pages declared by a robots sitemap", async () => {
    const site = await fixture("sitemap-discovery");
    const { result } = await runFixture(site);
    expect(result.state).toBe("completed");
    expect(site.requestCount("/sitemap.xml")).toBe(1);
    expect(site.requestCount("/from-sitemap")).toBe(1);
  });

  it("does not let sitemap metadata consume a one-page crawl allowance", async () => {
    const site = await fixture("sitemap-discovery");
    const { persistence, result } = await runFixture(site, {
      ...runnerConfig,
      maxPages: 1,
    });

    expect(result.state).toBe("completed");
    expect(result.progress).toMatchObject({ processed: 1, succeeded: 1 });
    expect(site.requestCount("/sitemap.xml")).toBe(1);
    expect(site.requestCount("/")).toBe(1);
    expect(site.requestCount("/from-sitemap")).toBe(0);
    expect(persistence.fetches.filter((fetch) => fetch.fetchKind === "page")).toHaveLength(1);
    expect(persistence.sitemaps).toHaveLength(1);
  });

  it("persists broken-link status without treating the worker as crashed", async () => {
    const site = await fixture("broken-links");
    const { persistence, result } = await runFixture(site);
    expect(result.state).toBe("completed");
    expect(persistence.fetches.some((fetch) => fetch.statusCode === 404)).toBe(true);
  });

  it("stops an infinite query frontier at the per-path variant bound", async () => {
    const site = await fixture("infinite-parameter-links");
    const { result } = await runFixture(site);
    expect(result.state).toBe("completed");
    expect(result.progress.succeeded).toBe(3);
    expect(site.requests().filter((request) => request.path.startsWith("/?page=")).length).toBe(2);
  });

  it("retries deterministic server failures and recovers", async () => {
    const site = await fixture("server-error");
    const { result } = await runFixture(site);
    expect(result.state).toBe("completed");
    expect(site.requestCount("/")).toBe(3);
  });

  it("exposes parsed fixture robots behavior through the real client", async () => {
    const site = await fixture("robots-blocked");
    const policy = await createRobotsService(crawler(site)).fetchPolicy(
      site.origin,
      scope(site.origin),
    );
    expect(policy.allows(`${site.origin}/private`)).toBe(false);
    expect(policy.allows(`${site.origin}/public`)).toBe(true);
  });
});

describe("test-only network capability", () => {
  it("cannot be issued outside the test environment", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() =>
        createTestSafeHttpClient({ exactEndpoints: ["http://127.0.0.1:12345"] }),
      ).toThrow("NODE_ENV=test");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
