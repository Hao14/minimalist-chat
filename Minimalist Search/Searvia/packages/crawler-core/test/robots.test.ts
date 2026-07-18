import { createHash } from "node:crypto";

import {
  CrawlError,
  createRobotsService,
  parseRobotsTxt,
  type SafeFetchResponse,
  type SafeHttpClient,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

function response(statusCode: number, body: string | null): SafeFetchResponse {
  const encodedBody = body === null ? null : new TextEncoder().encode(body);
  return {
    body: encodedBody,
    contentEncoding: null,
    contentLength: encodedBody?.byteLength ?? 0,
    contentType: body === null ? null : "text/plain",
    finalUrl: "https://example.com/robots.txt",
    normalizedUrl: "https://example.com/robots.txt",
    omittedResponseHeaders: [],
    redirectChain: [],
    responseHeaders: {},
    responseBytes: encodedBody?.byteLength ?? 0,
    requestedUrl: "https://example.com/robots.txt",
    retryAfterMs: null,
    statusCode,
    timing: {
      dnsMs: 1,
      downloadMs: 1,
      startedAt: new Date(0).toISOString(),
      totalMs: 3,
      ttfbMs: 1,
    },
    transferBytes: encodedBody?.byteLength ?? 0,
  };
}

describe("robots parser", () => {
  it("merges matching groups, applies longest-match precedence, and honors Allow ties", () => {
    const parsed = parseRobotsTxt(
      [
        "User-agent: *",
        "Disallow: /fallback",
        "User-agent: SearviaBot",
        "Disallow: /private/*",
        "Allow: /private/public$",
        "User-agent: searviabot",
        "Disallow: /merged",
      ].join("\n"),
      "SearviaBot",
    );
    expect(parsed.allows("https://example.com/private/secret")).toBe(false);
    expect(parsed.allows("https://example.com/private/public")).toBe(true);
    expect(parsed.allows("https://example.com/merged")).toBe(false);
    expect(parsed.allows("https://example.com/fallback")).toBe(true);
  });

  it("keeps Sitemap outside group parsing and interprets crawl delay", () => {
    const parsed = parseRobotsTxt(
      "\uFEFFUser-agent: SearviaBot\nDisallow: /x\nSitemap: https://example.com/map.xml\nAllow: /x/open\nCrawl-delay: 1.25\n",
      "SearviaBot",
    );
    expect(parsed.sitemapUrls).toEqual(["https://example.com/map.xml"]);
    expect(parsed.crawlDelayMs).toBe(1_250);
    expect(parsed.allows("https://example.com/x/open")).toBe(true);
  });

  it("treats an empty Disallow directive as no restriction", () => {
    const parsed = parseRobotsTxt("User-agent: *\nDisallow:\n", "SearviaBot");
    expect(parsed.allows("https://example.com/anything")).toBe(true);
  });

  it("matches the product token exactly and falls back to the wildcard group", () => {
    const parsed = parseRobotsTxt(
      [
        "User-agent: Searvia",
        "Disallow: /",
        "User-agent: SearviaB",
        "Disallow: /",
        "User-agent: *",
        "Allow: /",
      ].join("\n"),
      "SearviaBot",
    );

    expect(parsed.allows("https://example.com/public")).toBe(true);
  });

  it("canonicalizes percent-encoded robots rules before matching", () => {
    const parsed = parseRobotsTxt(
      "User-agent: SearviaBot\nDisallow: /foo%62ar\nDisallow: /private%2fsecret\n",
      "SearviaBot",
    );

    expect(parsed.allows("https://example.com/foobar")).toBe(false);
    expect(parsed.allows("https://example.com/private%2Fsecret")).toBe(false);
  });

  it("treats percent-encoded wildcard and anchor octets as literals", () => {
    const parsed = parseRobotsTxt(
      "User-agent: SearviaBot\nDisallow: /path/file-with-a-%2A.html\nDisallow: /path/foo-%24\n",
      "SearviaBot",
    );

    expect(parsed.allows("https://example.com/path/file-with-a-*.html")).toBe(false);
    expect(parsed.allows("https://example.com/path/foo-$")).toBe(false);
  });

  it("fails closed when the bounded rule budget is exceeded by irrelevant groups", () => {
    const noise = Array.from({ length: 10_000 }, (_, index) => `Disallow: /noise-${index}`);
    const parsed = parseRobotsTxt(
      ["User-agent: OtherBot", ...noise, "User-agent: SearviaBot", "Disallow: /private"].join("\n"),
      "SearviaBot",
    );

    expect(parsed.allows("https://example.com/private")).toBe(false);
    expect(parsed.allows("https://example.com/public")).toBe(false);
  });
});

describe("robots fetch policy", () => {
  it("allows on 4xx unavailability and disallows on 5xx unreachable state", async () => {
    let status = 404;
    const client: SafeHttpClient = { fetch: async () => response(status, null) };
    const service = createRobotsService(client);
    const scope = { hostname: "example.com", includeSubdomains: false };
    const unavailable = await service.fetchPolicy("https://example.com", scope);
    expect(unavailable.state).toBe("unavailable");
    expect(unavailable.allows("https://example.com/page")).toBe(true);

    status = 503;
    const unreachable = await service.fetchPolicy("https://example.com", scope);
    expect(unreachable.state).toBe("unreachable");
    expect(unreachable.allows("https://example.com/page")).toBe(false);
  });

  it("retries transient failures with a bound and succeeds when robots recovers", async () => {
    let attempts = 0;
    const client: SafeHttpClient = {
      async fetch() {
        attempts += 1;
        if (attempts === 1) {
          throw new CrawlError("network_error", "temporary", { transient: true });
        }
        return response(200, "User-agent: SearviaBot\nAllow: /\n");
      },
    };
    const service = createRobotsService(client, "SearviaBot", "SearviaBot/1.0", {
      clock: { now: () => 0, sleep: async () => undefined },
      maxRetries: 2,
      random: () => 0,
    });

    await expect(
      service.fetchPolicy("https://example.com", {
        hostname: "example.com",
        includeSubdomains: false,
      }),
    ).resolves.toMatchObject({ state: "parsed" });
    expect(attempts).toBe(2);
  });

  it("fails closed after exhausting retryable robots responses", async () => {
    let attempts = 0;
    const client: SafeHttpClient = {
      async fetch() {
        attempts += 1;
        return response(503, "temporarily unavailable");
      },
    };
    const service = createRobotsService(client, "SearviaBot", "SearviaBot/1.0", {
      clock: { now: () => 0, sleep: async () => undefined },
      maxRetries: 2,
      random: () => 0,
    });
    const policy = await service.fetchPolicy("https://example.com", {
      hostname: "example.com",
      includeSubdomains: false,
    });

    expect(attempts).toBe(3);
    expect(policy.state).toBe("unreachable");
    expect(policy.allows("https://example.com/page")).toBe(false);
  });

  it("retains only bounded valid robots text for persistence", async () => {
    const validText = "User-agent: SearviaBot\nAllow: /\n";
    let body = validText;
    const client: SafeHttpClient = { fetch: async () => response(200, body) };
    const service = createRobotsService(client);
    const scope = { hostname: "example.com", includeSubdomains: false };

    await expect(service.fetchPolicy("https://example.com", scope)).resolves.toMatchObject({
      state: "parsed",
      content: validText,
      contentDigest: createHash("sha256").update(validText).digest("hex"),
    });

    body = `${"x".repeat(500_001)}`;
    await expect(
      service.fetchPolicy("https://large.example.com", {
        hostname: "large.example.com",
        includeSubdomains: false,
      }),
    ).resolves.toMatchObject({
      state: "unreachable",
      content: null,
      errorCode: "response_too_large",
    });

    body = "User-agent: *\nAllow: /\u0000hidden\n";
    await expect(
      service.fetchPolicy("https://invalid.example.com", {
        hostname: "invalid.example.com",
        includeSubdomains: false,
      }),
    ).resolves.toMatchObject({
      state: "unreachable",
      content: null,
      errorCode: "parse_error",
    });
  });
});
