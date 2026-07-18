import { extractPage } from "../src/index.js";
import { describe, expect, it } from "vitest";

function extractCanonical(href: string) {
  const body = `<!doctype html><html><head><link rel="canonical" href="${href}"></head><body><main>Canonical extraction fixture content.</main></body></html>`;
  return extractPage({
    contentType: "text/html; charset=utf-8",
    depth: 0,
    finalUrl: "https://example.com/source",
    headers: { "content-type": "text/html; charset=utf-8" },
    includeSubdomains: false,
    normalizedUrl: "https://example.com/source",
    raw: { body, kind: "raw" },
    redirectChain: [],
    requestedUrl: "https://example.com/source",
    responseBytes: Buffer.byteLength(body),
    scopeHostname: "example.com",
    statusCode: 200,
    transferSize: Buffer.byteLength(body),
  }).raw.canonical;
}

describe("canonical normalization provenance", () => {
  it("returns a normalized canonical without a failure code", () => {
    expect(extractCanonical("/preferred?campaign=private")).toMatchObject({
      error: null,
      normalizedUrl: "https://example.com/preferred?campaign=private",
      resolvedUrl: "https://example.com/preferred?campaign=private",
    });
  });

  it.each([
    ["", "empty_url"],
    ["https://user:secret@example.com/private?token=secret", "userinfo_not_allowed"],
    ["javascript:alert(1)", "unsupported_protocol"],
    ["https://[invalid", "invalid_url"],
  ] as const)("classifies %j as %s", (href, code) => {
    expect(extractCanonical(href)).toMatchObject({
      error: code,
      normalizedUrl: null,
    });
  });
});
