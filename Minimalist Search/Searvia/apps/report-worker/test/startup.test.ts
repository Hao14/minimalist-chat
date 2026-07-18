import { describe, expect, it } from "vitest";

import { createWorkerStartupConfiguration, WORKER_SERVICE_NAME } from "../src/startup.js";

describe("report-worker startup configuration", () => {
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
});
