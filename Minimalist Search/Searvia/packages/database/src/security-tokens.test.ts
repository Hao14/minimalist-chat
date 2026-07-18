import { describe, expect, it } from "vitest";

import {
  createOpaqueRateLimitKey,
  generateInvitationToken,
  hashInvitationToken,
  isInvitationTokenSyntaxValid,
} from "./security-tokens.js";

describe("invitation and rate-limit tokens", () => {
  it("generates a 256-bit bearer token and stores only its SHA-256 hash", () => {
    const first = generateInvitationToken();
    const second = generateInvitationToken();

    expect(isInvitationTokenSyntaxValid(first.rawToken)).toBe(true);
    expect(first.tokenHash).toMatch(/^[a-f\d]{64}$/u);
    expect(first.tokenHash).toBe(hashInvitationToken(first.rawToken));
    expect(first.rawToken).not.toBe(first.tokenHash);
    expect(second.rawToken).not.toBe(first.rawToken);
  });

  it("rejects malformed delivery-token syntax", () => {
    expect(isInvitationTokenSyntaxValid("short")).toBe(false);
    expect(isInvitationTokenSyntaxValid("a".repeat(43))).toBe(true);
    expect(isInvitationTokenSyntaxValid(`${"a".repeat(42)}!`)).toBe(false);
  });

  it("derives opaque stable keys without retaining account identifiers", () => {
    const key = createOpaqueRateLimitKey(["invitation:create", "user@example.com"]);

    expect(key).toHaveLength(64);
    expect(key).not.toContain("user@example.com");
    expect(key).toBe(createOpaqueRateLimitKey(["invitation:create", "user@example.com"]));
  });
});
