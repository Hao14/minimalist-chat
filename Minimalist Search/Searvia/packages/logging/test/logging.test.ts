import { describe, expect, it } from "vitest";

import { createServiceLogger, toSafeErrorMetadata } from "../src/index.js";

function captureDestination(lines: string[]): { write(message: string): void } {
  return {
    write(message) {
      lines.push(message);
    },
  };
}

describe("structured logging", () => {
  it("emits the required service context and readable level", () => {
    const lines: string[] = [];
    const logger = createServiceLogger(
      {
        service: "crawler-worker",
        environment: "test",
        level: "info",
      },
      captureDestination(lines),
    );

    logger.info({ traceId: "trace-123", event: "worker.healthy" }, "Healthy");

    const record: unknown = JSON.parse(lines.join(""));
    expect(record).toMatchObject({
      service: "crawler-worker",
      environment: "test",
      level: "info",
      traceId: "trace-123",
      event: "worker.healthy",
      msg: "Healthy",
    });
    expect(record).toHaveProperty("timestamp");
  });

  it("redacts sensitive keys, credential URLs, bearer values, and messages", () => {
    const lines: string[] = [];
    const logger = createServiceLogger(
      { service: "report-worker", environment: "test" },
      captureDestination(lines),
    );
    const secret = "never-emit-this-value";

    logger.warn(
      {
        authorization: `Bearer ${secret}`,
        nested: { password: secret },
        redisUrl: `redis://worker:${secret}@localhost:6379/0`,
      },
      `token=${secret}`,
    );

    const output = lines.join("");
    expect(output).not.toContain(secret);
    expect(output).toContain("[REDACTED]");
  });

  it("sanitizes credentials embedded in Error metadata", () => {
    const secret = "redis-password-value";
    const metadata = toSafeErrorMetadata(
      new Error(`Redis redis://worker:${secret}@localhost failed`),
    );

    expect(JSON.stringify(metadata)).not.toContain(secret);
    expect(metadata).toHaveProperty("error.type", "Error");
  });
});
