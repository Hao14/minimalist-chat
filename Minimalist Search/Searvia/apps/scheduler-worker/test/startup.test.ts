import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import packageMetadata from "../package.json" with { type: "json" };

import { createWorkerStartupConfiguration, WORKER_SERVICE_NAME } from "../src/startup.js";

describe("scheduler-worker startup configuration", () => {
  it("uses the correct structured service identity", () => {
    expect(createWorkerStartupConfiguration({ NODE_ENV: "test" })).toMatchObject({
      service: WORKER_SERVICE_NAME,
      nodeEnv: "test",
      redisUrl: "redis://127.0.0.1:6379/0",
    });
  });

  it("fails closed when production Redis configuration is missing", () => {
    expect(() => createWorkerStartupConfiguration({ NODE_ENV: "production" })).toThrow("REDIS_URL");
  });

  it("starts the compiled executable main without importing it into unit tests", () => {
    expect(packageMetadata.scripts.dev).toContain("src/main.ts");
    expect(packageMetadata.scripts.start).toContain("dist/main.js");
    expect(existsSync(new URL("../src/main.ts", import.meta.url))).toBe(true);
    expect(readFileSync(new URL("../Dockerfile", import.meta.url), "utf8")).toContain(
      'CMD ["node", "--enable-source-maps", "dist/main.js"]',
    );
  });
});
