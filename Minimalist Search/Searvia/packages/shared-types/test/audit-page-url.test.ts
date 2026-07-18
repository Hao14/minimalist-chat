import { describe, expect, it } from "vitest";

import { privacySafeAuditPageUrl } from "../src/index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("privacySafeAuditPageUrl", () => {
  it("keeps an ordinary normalized page URL unchanged", () => {
    expect(privacySafeAuditPageUrl("https://example.com/path", HASH_A)).toBe(
      "https://example.com/path",
    );
  });

  it("replaces query and fragment details with the precomputed crawl URL hash", () => {
    const value = privacySafeAuditPageUrl(
      "https://example.com/path?token=secret#private-fragment",
      HASH_A,
    );

    expect(value).toBe(`https://example.com/path?__searvia_detail_sha256=${HASH_A}`);
    expect(value).not.toContain("secret");
    expect(value).not.toContain("private-fragment");
  });

  it("keeps sensitive variants distinct without hashing them in the audit layer", () => {
    expect(privacySafeAuditPageUrl("https://example.com/path?token=one", HASH_A)).not.toBe(
      privacySafeAuditPageUrl("https://example.com/path?token=two", HASH_B),
    );
  });

  it("strips URL user-info at the output boundary", () => {
    const value = privacySafeAuditPageUrl(
      "https://private-user:private-password@example.com/path",
      HASH_A,
    );

    expect(value).toBe(`https://example.com/path?__searvia_detail_sha256=${HASH_A}`);
    expect(value).not.toContain("private-user");
    expect(value).not.toContain("private-password");
  });

  it.each(["", "A".repeat(64), "a".repeat(63), `${"a".repeat(63)}g`])(
    "rejects an invalid precomputed hash: %s",
    (hash) => {
      expect(() => privacySafeAuditPageUrl("https://example.com/path", hash)).toThrow(
        /lowercase 64-character SHA-256/u,
      );
    },
  );

  it.each(["not a URL", "ftp://example.com/path", "mailto:test@example.com"])(
    "rejects an unsupported normalized URL: %s",
    (url) => {
      expect(() => privacySafeAuditPageUrl(url, HASH_A)).toThrow(/absolute HTTP\(S\) URL/u);
    },
  );
});
