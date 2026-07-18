import {
  BreadthFirstFrontier,
  CrawlError,
  discoverAnchorUrls,
  discoverSitemapUrls,
  HostRequestScheduler,
  type CrawlClock,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

const scope = { hostname: "example.com", includeSubdomains: false } as const;

function frontier(overrides: Partial<ConstructorParameters<typeof BreadthFirstFrontier>[1]> = {}) {
  return new BreadthFirstFrontier(scope, {
    excludePatterns: [],
    includePatterns: [],
    maxDepth: 3,
    maxDiscoveredUrls: 20,
    maxPages: 10,
    maxQueryVariantsPerPath: 3,
    queryPolicy: "ignore_tracking",
    ...overrides,
  });
}

describe("bounded discovery", () => {
  it("extracts normalized anchors with base and entity handling", () => {
    const urls = discoverAnchorUrls(
      '<base href="/docs/"><a href="one?a=1&amp;b=2">One</a><a href="javascript:alert(1)">Bad</a><a href="https://u:p@example.com/">Credentials</a>',
      "https://example.com/root",
    );
    expect(urls).toEqual(["https://example.com/docs/one?a=1&b=2"]);
  });

  it("extracts bounded sitemap locations and rejects DTDs", () => {
    expect(
      discoverSitemapUrls(
        "<urlset><url><loc>/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>",
        "https://example.com/sitemap.xml",
        { maxUrls: 1 },
      ),
    ).toEqual(["https://example.com/a"]);
    expect(() =>
      discoverSitemapUrls(
        '<!DOCTYPE foo [<!ENTITY x "boom">]><urlset><loc>&x;</loc></urlset>',
        "https://example.com/sitemap.xml",
      ),
    ).toThrowError(expect.objectContaining({ code: "parse_error" }));
  });
});

describe("breadth-first frontier", () => {
  it("deduplicates normalized URLs and yields strict breadth-first order", () => {
    const queue = frontier();
    expect(
      queue.add({ depth: 0, discoverySource: "seed", requestedUrl: "https://example.com/" })
        .accepted,
    ).toBe(true);
    queue.add({ depth: 2, discoverySource: "link", requestedUrl: "https://example.com/deep" });
    queue.add({ depth: 1, discoverySource: "link", requestedUrl: "https://example.com/one" });
    expect(
      queue.add({
        depth: 1,
        discoverySource: "link",
        requestedUrl: "https://example.com/one#duplicate",
      }),
    ).toMatchObject({ accepted: false, reason: "duplicate" });

    expect(queue.nextBatch(10).map((entry) => entry.normalizedUrl)).toEqual([
      "https://example.com/",
    ]);
    expect(queue.nextBatch(10).map((entry) => entry.normalizedUrl)).toEqual([
      "https://example.com/one",
    ]);
    expect(queue.nextBatch(10).map((entry) => entry.normalizedUrl)).toEqual([
      "https://example.com/deep",
    ]);
  });

  it("enforces query traps, patterns, scope, depth, discovery, and page limits", () => {
    const queue = frontier({
      excludePatterns: ["/blocked*"],
      maxDepth: 1,
      maxDiscoveredUrls: 4,
      maxPages: 2,
      maxQueryVariantsPerPath: 2,
    });
    expect(
      queue.add({ depth: 0, discoverySource: "seed", requestedUrl: "https://example.com/?p=1" }),
    ).toMatchObject({ accepted: true });
    expect(
      queue.add({ depth: 1, discoverySource: "link", requestedUrl: "https://example.com/?p=2" }),
    ).toMatchObject({ accepted: true });
    expect(
      queue.add({ depth: 1, discoverySource: "link", requestedUrl: "https://example.com/?p=3" }),
    ).toMatchObject({ accepted: false, reason: "query_variants" });
    expect(
      queue.add({ depth: 1, discoverySource: "link", requestedUrl: "https://example.com/blocked" }),
    ).toMatchObject({ accepted: false, reason: "pattern" });
    expect(
      queue.add({ depth: 1, discoverySource: "link", requestedUrl: "https://other.example/" }),
    ).toMatchObject({ accepted: false, reason: "scope" });
    expect(
      queue.add({ depth: 2, discoverySource: "link", requestedUrl: "https://example.com/deep" }),
    ).toMatchObject({ accepted: false, reason: "depth" });
    expect(queue.nextBatch(10)).toHaveLength(1);
    expect(queue.nextBatch(10)).toHaveLength(1);
    expect(queue.pageLimitReached).toBe(true);
  });

  it("rehydrates durable entries without charging the crawl-wide discovery budget again", () => {
    const queue = new BreadthFirstFrontier(
      scope,
      {
        excludePatterns: [],
        includePatterns: [],
        maxDepth: 3,
        maxDiscoveredUrls: 4,
        maxPages: 2,
        maxQueryVariantsPerPath: 3,
        queryPolicy: "ignore_tracking",
      },
      { discoveredCount: 3 },
    );

    expect(
      queue.restore({
        depth: 1,
        discoverySource: "link",
        requestedUrl: "https://example.com/pending",
      }),
    ).toMatchObject({ accepted: true });
    expect(queue.discoveredCount).toBe(3);
    expect(
      queue.add({
        depth: 1,
        discoverySource: "link",
        requestedUrl: "https://example.com/new",
      }),
    ).toMatchObject({ accepted: true });
    expect(queue.discoveredCount).toBe(4);
    expect(
      queue.add({
        depth: 1,
        discoverySource: "link",
        requestedUrl: "https://example.com/over-limit",
      }),
    ).toMatchObject({ accepted: false, reason: "discovery_limit" });
    expect(queue.nextBatch(2).map((entry) => entry.normalizedUrl)).toEqual([
      "https://example.com/pending",
      "https://example.com/new",
    ]);
  });

  it("replays already-counted persistence work after the crawl-wide page limit", () => {
    const queue = new BreadthFirstFrontier(
      scope,
      {
        excludePatterns: [],
        includePatterns: [],
        maxDepth: 3,
        maxDiscoveredUrls: 4,
        maxPages: 2,
        maxQueryVariantsPerPath: 3,
        queryPolicy: "ignore_tracking",
      },
      { discoveredCount: 2, processedCount: 2 },
    );

    expect(
      queue.restore({
        countsTowardPageLimit: true,
        depth: 0,
        discoverySource: "seed",
        requestedUrl: "https://example.com/unprocessed",
      }),
    ).toMatchObject({ accepted: true });
    expect(
      queue.restore({
        countsTowardPageLimit: false,
        depth: 1,
        discoverySource: "link",
        requestedUrl: "https://example.com/incomplete-artifact",
      }),
    ).toMatchObject({ accepted: true });

    expect(queue.nextBatch(10).map((entry) => entry.normalizedUrl)).toEqual([
      "https://example.com/incomplete-artifact",
    ]);
    expect(queue.pageLimitReached).toBe(true);
    expect(queue.queuedCount).toBe(1);
  });

  it("releases a tentative discovery charge when persistence reports an existing URL", () => {
    const queue = new BreadthFirstFrontier(
      scope,
      {
        excludePatterns: [],
        includePatterns: [],
        maxDepth: 3,
        maxDiscoveredUrls: 4,
        maxPages: 2,
        maxQueryVariantsPerPath: 3,
        queryPolicy: "ignore_tracking",
      },
      { discoveredCount: 3 },
    );
    const existing = queue.add({
      depth: 0,
      discoverySource: "seed",
      requestedUrl: "https://example.com/",
    });
    if (!existing.accepted) throw new Error("Expected a tentative frontier entry.");
    expect(queue.discoveredCount).toBe(4);

    queue.discardPersisted(existing.entry);

    expect(queue.discoveredCount).toBe(3);
    expect(
      queue.add({
        depth: 1,
        discoverySource: "link",
        requestedUrl: "https://example.com/new",
      }),
    ).toMatchObject({ accepted: true });
  });
});

describe("per-host scheduling", () => {
  it("enforces delay and concurrency deterministically", async () => {
    let now = 0;
    const starts: number[] = [];
    const clock: CrawlClock = {
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    };
    const scheduler = new HostRequestScheduler(clock, 1, 250);
    await Promise.all([
      scheduler.run("example.com", async () => {
        starts.push(now);
      }),
      scheduler.run("example.com", async () => {
        starts.push(now);
      }),
    ]);
    expect(starts).toEqual([0, 250]);
  });

  it("removes a cancelled waiter without stranding the next request", async () => {
    const scheduler = new HostRequestScheduler(
      { now: () => 0, sleep: async () => undefined },
      1,
      0,
    );
    let releaseFirst: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const first = scheduler.run("example.com", async () => {
      markStarted?.();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return "first";
    });
    await started;

    const cancelled = new AbortController();
    const second = scheduler.run("example.com", async () => "second", cancelled.signal);
    const third = scheduler.run("example.com", async () => "third");
    cancelled.abort(new CrawlError("cancelled", "cancelled"));
    await expect(second).rejects.toMatchObject({ code: "cancelled" });
    releaseFirst?.();

    await expect(first).resolves.toBe("first");
    await expect(third).resolves.toBe("third");
  });
});
