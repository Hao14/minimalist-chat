import { describe, expect, it } from "vitest";

import { auditEvidenceItemSchema, redactAuditUrlDetails } from "../src/index.js";

describe("audit evidence boundary", () => {
  it("redacts URL credentials, query values, and fragments while preserving useful paths", () => {
    const input = [
      "https://audit-user:audit-password@example.com/path",
      "https://audit-user:audit-password@example.com/path?token=query-secret#fragment-secret",
      "//audit-user:audit-password@example.com/path",
      "//audit-user:audit-password@example.com/path?token=query-secret",
    ].join(" ");
    const redacted = redactAuditUrlDetails(input);

    expect(redacted).toBe(
      "https://[redacted]@example.com/path https://[redacted]@example.com/path?token=[redacted]#[redacted] //[redacted]@example.com/path //[redacted]@example.com/path?token=[redacted]",
    );
    expect(redacted).not.toContain("audit-user");
    expect(redacted).not.toContain("audit-password");
    expect(redacted).not.toContain("query-secret");
    expect(redacted).not.toContain("fragment-secret");
  });

  it("validates complete finite evidence items and rejects loose JSON", () => {
    const valid = {
      kind: "page",
      source: "transport",
      observationId: "page-observation",
      observedAt: "2026-07-16T12:00:00.000Z",
      field: "status_code",
      value: 200,
    } as const;

    expect(auditEvidenceItemSchema.safeParse(valid).success).toBe(true);
    expect(
      auditEvidenceItemSchema.safeParse({ source: "transport", field: "status" }).success,
    ).toBe(false);
    expect(auditEvidenceItemSchema.safeParse({ ...valid, kind: "unknown" }).success).toBe(false);
    expect(auditEvidenceItemSchema.safeParse({ ...valid, value: Number.NaN }).success).toBe(false);
  });
});
