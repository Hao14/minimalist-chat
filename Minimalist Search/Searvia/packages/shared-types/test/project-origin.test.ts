import { describe, expect, it } from "vitest";

import { normalizeProjectOrigin, ProjectOriginValidationError } from "../src/index.js";

describe("project origin normalization", () => {
  it.each([
    ["minimalist.chat", "https://minimalist.chat"],
    ["https://minimalist.chat", "https://minimalist.chat"],
    ["https://www.example.com/path?source=test#section", "https://www.example.com"],
    ["HTTP://EXAMPLE.COM:80/a", "http://example.com"],
    ["https://example.com:8443/path", "https://example.com:8443"],
    ["https://bücher.example/seite", "https://xn--bcher-kva.example"],
    ["https://example.com./path", "https://example.com"],
  ])("normalizes %s to %s without fetching", (input, expected) => {
    expect(normalizeProjectOrigin(input).origin).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["ftp://example.com", "unsupported-protocol"],
    ["javascript:alert(1)", "unsupported-protocol"],
    ["https:example.com", "invalid-url"],
    ["https://user:secret@example.com", "userinfo-not-allowed"],
    ["user@example.com", "userinfo-not-allowed"],
    ["https://-bad.example", "invalid-hostname"],
    ["https://bad_.example", "invalid-hostname"],
    ["https://localhost", "invalid-hostname"],
    ["https://127.0.0.1", "invalid-hostname"],
    ["https://[::1]", "invalid-hostname"],
    ["not a domain", "invalid-url"],
    ["//example.com", "invalid-url"],
  ])("rejects %s with %s", (input, expectedCode) => {
    try {
      normalizeProjectOrigin(input);
      throw new Error("Expected normalization to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectOriginValidationError);
      expect((error as ProjectOriginValidationError).code).toBe(expectedCode);
    }
  });
});
