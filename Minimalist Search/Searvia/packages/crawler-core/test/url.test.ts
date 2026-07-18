import {
  assertSafeWebPort,
  hashNormalizedUrl,
  isUrlInScope,
  normalizeCrawlUrl,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("crawl URL normalization", () => {
  it("normalizes IDNA, host casing, dot segments, fragments, ports, and percent escapes", () => {
    expect(normalizeCrawlUrl("HTTPS://BÜCHER.Example:443/a/../b/%7e?q=%2f#fragment")).toBe(
      "https://xn--bcher-kva.example/b/~?q=%2F",
    );
  });

  it("resolves relative links and applies query policies", () => {
    expect(
      normalizeCrawlUrl("../next?utm_source=x&a=1&fbclid=y", {
        baseUrl: "https://example.com/a/page",
        queryPolicy: "ignore_tracking",
      }),
    ).toBe("https://example.com/next?a=1");
    expect(normalizeCrawlUrl("https://example.com/a?x=1", { queryPolicy: "ignore_all" })).toBe(
      "https://example.com/a",
    );
  });

  it.each([
    ["ftp://example.com/", "unsupported_protocol"],
    ["https://user:secret@example.com/", "userinfo_not_allowed"],
    ["https://exa mple.com/", "invalid_url"],
    ["https://exa_mple.com/", "invalid_hostname"],
  ])("rejects %s", (value, code) => {
    expect(() => normalizeCrawlUrl(value)).toThrowError(expect.objectContaining({ code }));
  });

  it("rejects URLs that cannot fit in durable crawl records", () => {
    expect(() => normalizeCrawlUrl(`https://example.com/${"a".repeat(4_096)}`)).toThrowError(
      expect.objectContaining({ code: "invalid_url" }),
    );
  });

  it("enforces hostname label boundaries for subdomain scope", () => {
    expect(
      isUrlInScope("https://docs.example.com/", {
        hostname: "example.com",
        includeSubdomains: true,
      }),
    ).toBe(true);
    expect(
      isUrlInScope("https://evilexample.com/", {
        hostname: "example.com",
        includeSubdomains: true,
      }),
    ).toBe(false);
    expect(
      isUrlInScope("https://docs.example.com/", {
        hostname: "example.com",
        includeSubdomains: false,
      }),
    ).toBe(false);
  });

  it("permits only reviewed web ports", () => {
    expect(() => assertSafeWebPort(new URL("https://example.com:8443/"))).not.toThrow();
    expect(() => assertSafeWebPort(new URL("http://example.com:22/"))).toThrowError(
      expect.objectContaining({ code: "unsafe_port" }),
    );
  });

  it("uses a stable SHA-256 URL identity", () => {
    expect(hashNormalizedUrl("https://example.com/")).toMatch(/^[\da-f]{64}$/u);
    expect(hashNormalizedUrl("https://example.com/")).toBe(
      hashNormalizedUrl("https://example.com/"),
    );
  });
});
