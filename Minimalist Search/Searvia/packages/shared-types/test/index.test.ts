import { describe, expect, it } from "vitest";

import { auditResultStatusSchema, serviceHealthEventSchema } from "../src/index.js";

describe("shared service contracts", () => {
  it("accepts a structured health event", () => {
    const checkedAt = new Date().toISOString();

    expect(
      serviceHealthEventSchema.parse({
        service: "crawler-worker",
        environment: "test",
        status: "healthy",
        checkedAt,
        traceId: "trace-foundation",
        dependencies: {
          redis: { status: "healthy", checkedAt },
        },
      }),
    ).toMatchObject({ service: "crawler-worker", status: "healthy" });
  });

  it("keeps unavailable checks distinct from passed checks", () => {
    expect(auditResultStatusSchema.parse("not-checked")).toBe("not-checked");
    expect(auditResultStatusSchema.safeParse("unavailable-but-passed").success).toBe(false);
  });
});
