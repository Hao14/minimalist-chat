import type { CrawlPageDetailRecord, CrawlPageRecord } from "@searvia/database/runtime";
import { describe, expect, it } from "vitest";

import {
  decodeCrawlPageCursor,
  encodeCrawlPageCursor,
  serializeCrawlPage,
  serializeCrawlPageDetail,
} from "./crawl-pages";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CRAWL_ID = "22222222-2222-4222-8222-222222222222";
const PAGE_ID = "33333333-3333-4333-8333-333333333333";

const page: CrawlPageRecord = {
  id: PAGE_ID,
  crawlId: CRAWL_ID,
  requestedUrl: "https://example.com/",
  normalizedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  urlHash: "a".repeat(64),
  statusCode: 200,
  contentType: "text/html; charset=utf-8",
  htmlDetected: true,
  htmlDetectionSource: "bounded_response_prefix",
  htmlDetectionBytes: 120,
  responseHeaders: {
    "cache-control": ["max-age=60"],
    "proxy-authenticate": ["Basic realm=private"],
    "set-cookie": ["session=secret"],
    "www-authenticate": ["Bearer realm=private"],
  },
  omittedResponseHeaders: ["set-cookie"],
  contentLength: 120,
  responseBytes: 120,
  transferSize: 90,
  compression: "gzip",
  cacheHeaders: { "cache-control": ["max-age=60"] },
  securityHeaders: { "content-security-policy": ["default-src 'self'"] },
  depth: 0,
  redirectChain: [],
  robotsDecision: "not_checked",
  robotsObservationId: null,
  timing: {
    startedAt: "2026-07-16T04:00:00.000Z",
    dnsMs: 4,
    ttfbMs: 20,
    downloadMs: 5,
    totalMs: 29,
  },
  errorType: null,
  errorMessage: null,
  discoverySource: "seed",
  fetchedAt: new Date("2026-07-16T04:00:00.000Z"),
};

describe("crawl page API serialization", () => {
  it("serializes crawl pages without sensitive response headers", () => {
    const serialized = serializeCrawlPage(page);
    expect(serialized.fetchedAt).toBe("2026-07-16T04:00:00.000Z");
    expect(serialized.responseHeaders).toEqual({ "cache-control": ["max-age=60"] });
    expect(JSON.stringify(serialized)).not.toContain("session=secret");
  });

  it("never exposes object-storage locations or provider metadata", () => {
    const artifact: CrawlPageDetailRecord["artifacts"][number] = {
      id: "44444444-4444-4444-8444-444444444444",
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      crawlId: CRAWL_ID,
      pageId: PAGE_ID,
      kind: "raw_html",
      bucket: "private-customer-artifacts",
      objectKey: `organizations/${ORGANIZATION_ID}/projects/${PROJECT_ID}/crawls/${CRAWL_ID}/pages/${PAGE_ID}/raw.html.gz`,
      objectVersion: "provider-version-secret",
      etag: "provider-etag-secret",
      contentType: "text/html; charset=utf-8",
      contentEncoding: "gzip",
      uncompressedBytes: 120,
      storedBytes: 90,
      contentSha256: "a".repeat(64),
      storageSha256: "b".repeat(64),
      storedAt: new Date("2026-07-16T04:00:01.000Z"),
      createdAt: new Date("2026-07-16T04:00:01.000Z"),
    };
    const detail: CrawlPageDetailRecord = {
      page,
      extractions: [],
      artifacts: [artifact],
      headings: [],
      links: [],
      images: [],
      resources: [],
      structuredData: [],
      collectionTruncated: {
        headings: false,
        links: false,
        images: false,
        resources: false,
        structuredData: false,
      },
    };

    const body = JSON.stringify(serializeCrawlPageDetail(detail));
    expect(body).toContain('"kind":"raw_html"');
    expect(body).not.toContain("private-customer-artifacts");
    expect(body).not.toContain("organizations/");
    expect(body).not.toContain("provider-version-secret");
    expect(body).not.toContain("provider-etag-secret");
  });

  it("round-trips a versioned cursor and rejects a cursor for another crawl", () => {
    const encoded = encodeCrawlPageCursor({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      crawlId: CRAWL_ID,
      depth: 2,
      normalizedUrl: "https://example.com/docs",
      pageId: PAGE_ID,
    });
    expect(encoded).not.toBeNull();
    const decodedPayload = Buffer.from(encoded ?? "", "base64url").toString("utf8");
    expect(decodedPayload).not.toContain(ORGANIZATION_ID);
    expect(decodedPayload).not.toContain(PROJECT_ID);
    expect(decodeCrawlPageCursor(encoded ?? "", CRAWL_ID)).toEqual({
      crawlId: CRAWL_ID,
      depth: 2,
      normalizedUrl: "https://example.com/docs",
      pageId: PAGE_ID,
    });
    expect(decodeCrawlPageCursor(encoded ?? "", "55555555-5555-4555-8555-555555555555")).toBeNull();
    expect(decodeCrawlPageCursor("not+base64", CRAWL_ID)).toBeNull();
  });
});
