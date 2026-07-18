import { describe, expect, it } from "vitest";

import { extractPage, parseSitemapDocument } from "../src/index.js";

function parseLastModifiedValues(values: readonly string[]) {
  const entries = values
    .map(
      (value, index) =>
        `<url><loc>https://example.com/page-${index}</loc><lastmod>${value}</lastmod></url>`,
    )
    .join("");
  return parseSitemapDocument({
    body: `<urlset>${entries}</urlset>`,
    contentType: "application/xml",
    depth: 0,
    discoverySource: "submitted",
    finalUrl: "https://example.com/sitemap.xml",
    redirectChain: [],
    requestedUrl: "https://example.com/sitemap.xml",
    statusCode: 200,
  });
}

describe("sitemap lastmod validation", () => {
  it("accepts strict W3C dates and zoned date-times", () => {
    const result = parseLastModifiedValues([
      "2024-02-29",
      "2026-07-16T12:30Z",
      "2026-07-16T12:30:45.123+14:00",
      "2026-07-16T00:00:00-07:30",
    ]);

    expect(result.locations.map((location) => location.lastModifiedValid)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(result.issues).not.toContainEqual(expect.objectContaining({ code: "invalid_lastmod" }));
  });

  it("rejects calendar rollover, timezone-less date-times, and invalid time zones", () => {
    const values = [
      "2026-02-29",
      "2026-02-31T00:00:00Z",
      "2026-07-16T12:30:00",
      "2026-07-16T24:00:00Z",
      "2026-07-16T12:30:60Z",
      "2026-07-16T12:30:00+14:01",
    ];
    const result = parseLastModifiedValues(values);

    expect(result.locations.map((location) => location.lastModifiedValid)).toEqual(
      values.map(() => false),
    );
    expect(result.issues.filter((issue) => issue.code === "invalid_lastmod")).toHaveLength(
      values.length,
    );
  });
});

describe("pre-parse structural limits", () => {
  it("rejects hostile HTML structure before constructing an oversized DOM", () => {
    expect(() =>
      extractPage(
        {
          contentType: "text/html",
          depth: 0,
          finalUrl: "https://example.com/",
          headers: {},
          includeSubdomains: false,
          normalizedUrl: "https://example.com/",
          raw: { body: "<i></i>".repeat(101), kind: "raw" },
          redirectChain: [],
          requestedUrl: "https://example.com/",
          responseBytes: 707,
          scopeHostname: "example.com",
          statusCode: 200,
          transferSize: 707,
        },
        { maxNodes: 100 },
      ),
    ).toThrow("pre-parse structural limit");
  });

  it("rejects an over-limit sitemap before XML DOM construction", () => {
    const result = parseSitemapDocument(
      {
        body:
          "<urlset>" +
          "<url><loc>https://example.com/one</loc></url>" +
          "<url><loc>https://example.com/two</loc></url>" +
          "</urlset>",
        contentType: "application/xml",
        depth: 0,
        discoverySource: "submitted",
        finalUrl: "https://example.com/sitemap.xml",
        redirectChain: [],
        requestedUrl: "https://example.com/sitemap.xml",
        statusCode: 200,
      },
      { maxEntries: 1 },
    );

    expect(result.state).toBe("invalid");
    expect(result.locations).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "entry_limit" }));
  });

  it("rejects excessive non-entry XML structure before DOM construction", () => {
    const result = parseSitemapDocument(
      {
        body: `<urlset>${"<extension/>".repeat(129)}</urlset>`,
        contentType: "application/xml",
        depth: 0,
        discoverySource: "submitted",
        finalUrl: "https://example.com/sitemap.xml",
        redirectChain: [],
        requestedUrl: "https://example.com/sitemap.xml",
        statusCode: 200,
      },
      { maxEntries: 1 },
    );

    expect(result.state).toBe("invalid");
    expect(result.locations).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "structural_limit" }));
  });
});
