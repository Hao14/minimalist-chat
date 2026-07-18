import { describe, expect, it } from "vitest";

import { parseClientEnvironment } from "../src/client.js";
import { EnvironmentValidationError } from "../src/environment.js";
import { parseServerEnvironment } from "../src/server.js";
import { parseWorkerEnvironment } from "../src/worker.js";

describe("client environment", () => {
  it("uses safe local defaults without reading server environment", () => {
    expect(parseClientEnvironment({ NODE_ENV: "test" })).toEqual({
      nodeEnv: "test",
      appUrl: "http://localhost:3000",
      siteUrl: "http://localhost:3000",
    });
  });

  it("requires explicit public URLs in production", () => {
    expect(() => parseClientEnvironment({ NODE_ENV: "production" })).toThrowError(
      EnvironmentValidationError,
    );
  });

  it("normalizes public origins before they are used in generated URLs", () => {
    expect(
      parseClientEnvironment({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://app.example.test/",
        NEXT_PUBLIC_SITE_URL: "https://www.example.test/",
      }),
    ).toMatchObject({
      appUrl: "https://app.example.test",
      siteUrl: "https://www.example.test",
    });
  });
});

describe("server environment", () => {
  it("uses isolated local database defaults outside production", () => {
    expect(parseServerEnvironment({ NODE_ENV: "test" })).toMatchObject({
      nodeEnv: "test",
      appEnv: "test",
      databasePoolMax: 10,
      databaseConnectionTimeoutMs: 5_000,
      databaseIdleTimeoutMs: 10_000,
      databaseQueryTimeoutMs: 15_000,
      databaseStatementTimeoutMs: 15_000,
      authSecret: expect.stringContaining("development-only"),
      objectStorageEndpoint: "http://localhost:9000",
      objectStorageBucket: "searvia-local",
      objectStorageForcePathStyle: true,
    });
  });

  it("fails closed when production service values are absent", () => {
    expect(() => parseServerEnvironment({ NODE_ENV: "production" })).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "APP_URL" }),
          expect.objectContaining({ path: "DATABASE_URL" }),
          expect.objectContaining({ path: "BETTER_AUTH_SECRET" }),
        ]),
      }),
    );
  });

  it("fails closed when APP_ENV selects production on a development Node runtime", () => {
    expect(() =>
      parseServerEnvironment({ NODE_ENV: "development", APP_ENV: "production" }),
    ).toThrowError(EnvironmentValidationError);
  });

  it("refuses development seed data in production", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "development",
        APP_ENV: "production",
        SEARVIA_ENABLE_DEV_SEED: "true",
        SEARVIA_DEV_SEED_PASSWORD: "development-password-only",
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "SEARVIA_ENABLE_DEV_SEED" }),
        ]),
      }),
    );
  });

  it("requires an explicit development password when seeding is enabled", () => {
    expect(() =>
      parseServerEnvironment({ NODE_ENV: "test", SEARVIA_ENABLE_DEV_SEED: "true" }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "SEARVIA_DEV_SEED_PASSWORD" }),
        ]),
      }),
    );
  });
});

describe("worker environment", () => {
  it("uses safe local defaults outside production", () => {
    expect(parseWorkerEnvironment("crawler-worker", { NODE_ENV: "test" })).toEqual({
      service: "crawler-worker",
      nodeEnv: "test",
      logLevel: "info",
      redisUrl: "redis://127.0.0.1:6379/0",
      redisConnectTimeoutMs: 5_000,
      queuePrefix: "searvia-test",
      crawlWorkerConcurrency: 2,
      crawlExecutionLeaseMs: 300_000,
      crawlJobAttempts: 4,
      crawlJobBackoffMs: 1_000,
      crawlJobBackoffJitter: 0.5,
      outboxPollIntervalMs: 500,
      outboxLeaseMs: 30_000,
      outboxBatchSize: 20,
      outboxMaxPublishAttempts: 10,
      healthIntervalMs: 30_000,
      shutdownTimeoutMs: 10_000,
      objectStorageEndpoint: "http://localhost:9000",
      objectStorageRegion: "us-west-2",
      objectStorageBucket: "searvia-local",
      objectStorageAccessKey: "searvia",
      objectStorageSecretKey: "searvia_minio_local_only",
      objectStorageSessionToken: undefined,
      objectStorageForcePathStyle: true,
      objectStorageRequestTimeoutMs: 10_000,
      artifactMaxHtmlBytes: 5_000_000,
      renderingEnabled: false,
      renderingBrowserExecutable: null,
      renderingTimeoutMs: 10_000,
      renderingSettleTimeoutMs: 1_500,
      renderingQuietWindowMs: 250,
      renderingMaxRawHtmlBytes: 2 * 1_024 * 1_024,
      renderingMaxHtmlBytes: 4 * 1_024 * 1_024,
      renderingMaxBlockedRequests: 100,
      renderingBrowserMemoryMb: 256,
      renderingCloseTimeoutMs: 2_000,
    });
  });

  it("requires Redis explicitly in production", () => {
    expect(() =>
      parseWorkerEnvironment("scheduler-worker", { NODE_ENV: "production" }),
    ).toThrowError(EnvironmentValidationError);
  });

  it("rejects plaintext Redis transport in production", () => {
    expect(() =>
      parseWorkerEnvironment("scheduler-worker", {
        NODE_ENV: "production",
        REDIS_URL: "redis://user:password@cache.example.test:6379/0",
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ path: "REDIS_URL" })]),
      }),
    );
  });

  it("requires private object storage for the production crawler worker", () => {
    expect(() =>
      parseWorkerEnvironment("crawler-worker", {
        NODE_ENV: "production",
        REDIS_URL: "rediss://cache.example.test:6380/0",
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "OBJECT_STORAGE_ENDPOINT" }),
          expect.objectContaining({ path: "OBJECT_STORAGE_SECRET_KEY" }),
        ]),
      }),
    );
  });

  it("rejects plaintext object storage for the production crawler worker", () => {
    expect(() =>
      parseWorkerEnvironment("crawler-worker", {
        NODE_ENV: "production",
        REDIS_URL: "rediss://cache.example.test:6380/0",
        OBJECT_STORAGE_ENDPOINT: "http://objects.example.test",
        OBJECT_STORAGE_REGION: "us-west-2",
        OBJECT_STORAGE_BUCKET: "searvia-production",
        OBJECT_STORAGE_ACCESS_KEY: "access-key",
        OBJECT_STORAGE_SECRET_KEY: "secret-key",
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "OBJECT_STORAGE_ENDPOINT" }),
        ]),
      }),
    );
  });

  it("requires an explicit executable before browser rendering can be enabled", () => {
    expect(() =>
      parseWorkerEnvironment("crawler-worker", {
        NODE_ENV: "test",
        CRAWL_RENDERING_ENABLED: "true",
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "CRAWL_RENDER_BROWSER_EXECUTABLE" }),
        ]),
      }),
    );
  });

  it("accepts bounded rendering and S3-compatible worker settings", () => {
    expect(
      parseWorkerEnvironment("crawler-worker", {
        NODE_ENV: "test",
        CRAWL_RENDERING_ENABLED: "true",
        CRAWL_RENDER_BROWSER_EXECUTABLE: "C:/browser/chrome.exe",
        CRAWL_RENDER_TIMEOUT_MS: "5000",
        CRAWL_RENDER_MAX_BLOCKED_REQUESTS: "40",
        OBJECT_STORAGE_SESSION_TOKEN: "temporary-session-token",
      }),
    ).toMatchObject({
      renderingEnabled: true,
      renderingBrowserExecutable: "C:/browser/chrome.exe",
      renderingTimeoutMs: 5_000,
      renderingMaxBlockedRequests: 40,
      objectStorageSessionToken: "temporary-session-token",
    });
  });

  it("accepts the timeout names documented in the root environment file", () => {
    const environment = parseWorkerEnvironment("report-worker", {
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      REDIS_URL: "rediss://cache.example.test:6380/0",
      REDIS_CONNECT_TIMEOUT_MS: "5000",
      WORKER_HEALTH_INTERVAL_MS: "15000",
      WORKER_SHUTDOWN_TIMEOUT_MS: "7500",
      QUEUE_PREFIX: "searvia-production",
      CRAWL_WORKER_CONCURRENCY: "8",
      CRAWL_EXECUTION_LEASE_MS: "180000",
      CRAWL_JOB_ATTEMPTS: "5",
      CRAWL_JOB_BACKOFF_MS: "2000",
      CRAWL_JOB_BACKOFF_JITTER: "0.25",
      OUTBOX_POLL_INTERVAL_MS: "1000",
      OUTBOX_LEASE_MS: "45000",
      OUTBOX_BATCH_SIZE: "25",
      OUTBOX_MAX_PUBLISH_ATTEMPTS: "12",
    });

    expect(environment).toMatchObject({
      logLevel: "warn",
      redisUrl: "rediss://cache.example.test:6380/0",
      redisConnectTimeoutMs: 5_000,
      queuePrefix: "searvia-production",
      crawlWorkerConcurrency: 8,
      crawlExecutionLeaseMs: 180_000,
      crawlJobAttempts: 5,
      crawlJobBackoffMs: 2_000,
      crawlJobBackoffJitter: 0.25,
      outboxPollIntervalMs: 1_000,
      outboxLeaseMs: 45_000,
      outboxBatchSize: 25,
      outboxMaxPublishAttempts: 12,
      healthIntervalMs: 15_000,
      shutdownTimeoutMs: 7_500,
    });
  });

  it("does not include a rejected Redis credential in its error", () => {
    const secret = "do-not-log-this-password";

    expect(() =>
      parseWorkerEnvironment("crawler-worker", {
        NODE_ENV: "production",
        REDIS_URL: `https://user:${secret}@cache.example.test`,
      }),
    ).toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining(secret),
      }),
    );
  });

  it("rejects unbounded queue and outbox behavior", () => {
    expect(() =>
      parseWorkerEnvironment("crawler-worker", {
        NODE_ENV: "test",
        CRAWL_JOB_ATTEMPTS: "11",
        OUTBOX_BATCH_SIZE: "101",
      }),
    ).toThrowError(EnvironmentValidationError);
  });
});
