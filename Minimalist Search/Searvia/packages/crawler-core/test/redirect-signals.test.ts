import { extractPage, sniffHtmlDocument } from "../src/index.js";
import { describe, expect, it } from "vitest";

function extract(body: string) {
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
  }).raw;
}

describe("bounded redirect-signal extraction", () => {
  it("resolves a meta-refresh destination against the document base URL", () => {
    const result = extract(
      '<!doctype html><base href="/docs/"><meta http-equiv="refresh" content="0; URL=next"><main>Redirecting</main>',
    );

    expect(result.metaRefreshUrl).toBe("https://example.com/docs/next");
    expect(result.javascriptRedirectUrl).toBeNull();
  });

  it.each([
    ["window.location.href = '/account';", "https://example.com/account"],
    ['location.assign("/signin");', "https://example.com/signin"],
    ["window.location.replace('https://www.example.com/new');", "https://www.example.com/new"],
  ])("resolves a literal inline JavaScript navigation: %s", (script, expected) => {
    expect(extract(`<!doctype html><script>${script}</script>`).javascriptRedirectUrl).toBe(
      expected,
    );
  });

  it("does not manufacture redirect signals from comments, strings, dynamic URLs, or unsafe URLs", () => {
    const result = extract(`<!doctype html>
      <meta http-equiv="refresh" content="0; url=javascript:alert(1)">
      <script>
        // location.href = '/comment';
        const example = "window.location = '/string'";
        window.location = target;
        location.replace('https://user:secret@example.com/private');
      </script>
      <script type="application/json">window.location = "/non-executable";</script>`);

    expect(result.metaRefreshUrl).toBeNull();
    expect(result.javascriptRedirectUrl).toBeNull();
  });
});

describe("bounded HTML sniffing provenance", () => {
  it("recognizes a document after bounded whitespace and complete leading comments", () => {
    expect(
      sniffHtmlDocument("  <!-- edge banner --><!doctype html><title>Example</title>"),
    ).toEqual({
      detected: true,
      source: "bounded_response_prefix",
      bytesInspected: 59,
    });
  });

  it("keeps ambiguous markup non-HTML and never inspects more than 4096 bytes", () => {
    const body = `${"x".repeat(4_096)}<!doctype html>`;
    expect(sniffHtmlDocument(body)).toEqual({
      detected: false,
      source: "bounded_response_prefix",
      bytesInspected: 4_096,
    });
    expect(sniffHtmlDocument("plain text").detected).toBe(false);
  });
});
