import {
  logLevelSchema,
  runtimeEnvironmentSchema,
  serviceNameSchema,
  type LogLevel,
  type RuntimeEnvironment,
} from "@searvia/shared-types";
import { z } from "zod";

import {
  EnvironmentValidationError,
  environmentIssues,
  type EnvironmentSource,
  isProduction,
  requiredProductionIssue,
} from "./environment.js";

export type { EnvironmentSource } from "./environment.js";

const LOCAL_REDIS_URL = "redis://127.0.0.1:6379/0";
const LOCAL_OBJECT_STORAGE = Object.freeze({
  endpoint: "http://localhost:9000",
  region: "us-west-2",
  bucket: "searvia-local",
  accessKey: "searvia",
  secretKey: "searvia_minio_local_only",
});
const booleanStringSchema = z.enum(["true", "false"]).transform((value) => value === "true");
const objectStorageEndpointSchema = z
  .url()
  .superRefine((value, context) => {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "Must use HTTP or HTTPS." });
    }
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      context.addIssue({
        code: "custom",
        message: "Must be an origin without credentials, path, query, or fragment.",
      });
    }
  })
  .transform((value) => new URL(value).origin);
const objectStorageBucketSchema = z
  .string()
  .trim()
  .min(3)
  .max(63)
  .regex(
    /^(?!.*\.\.)(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9][a-z0-9.-]*[a-z0-9]$/u,
    "Must be a valid DNS-compatible S3 bucket name.",
  );
const queuePrefixSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, "Use a lowercase, hyphenated queue prefix.");

const redisUrlSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, context) => {
    try {
      const parsed = new URL(value);

      if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
        context.addIssue({
          code: "custom",
          message: "Must use the redis:// or rediss:// protocol.",
        });
      }

      if (!parsed.hostname) {
        context.addIssue({
          code: "custom",
          message: "Must include a Redis hostname.",
        });
      }
    } catch {
      context.addIssue({ code: "custom", message: "Must be a valid Redis URL." });
    }
  });

const workerEnvironmentInputSchema = z.object({
  NODE_ENV: runtimeEnvironmentSchema.default("development"),
  LOG_LEVEL: logLevelSchema.default("info"),
  REDIS_URL: redisUrlSchema.optional(),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  QUEUE_PREFIX: queuePrefixSchema.optional(),
  CRAWL_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  CRAWL_EXECUTION_LEASE_MS: z.coerce.number().int().min(30_000).max(900_000).default(300_000),
  CRAWL_JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  CRAWL_JOB_BACKOFF_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  CRAWL_JOB_BACKOFF_JITTER: z.coerce.number().min(0).max(1).default(0.5),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(500),
  OUTBOX_LEASE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  OUTBOX_MAX_PUBLISH_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
  WORKER_HEALTH_INTERVAL_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
  OBJECT_STORAGE_ENDPOINT: objectStorageEndpointSchema.optional(),
  OBJECT_STORAGE_REGION: z.string().trim().min(1).max(128).optional(),
  OBJECT_STORAGE_BUCKET: objectStorageBucketSchema.optional(),
  OBJECT_STORAGE_ACCESS_KEY: z.string().trim().min(1).max(256).optional(),
  OBJECT_STORAGE_SECRET_KEY: z.string().trim().min(1).max(1_024).optional(),
  OBJECT_STORAGE_SESSION_TOKEN: z.string().trim().min(1).max(8_192).optional(),
  OBJECT_STORAGE_FORCE_PATH_STYLE: booleanStringSchema.default(true),
  OBJECT_STORAGE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
  CRAWL_ARTIFACT_MAX_HTML_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(5_000_000)
    .default(5_000_000),
  CRAWL_RENDERING_ENABLED: booleanStringSchema.default(false),
  CRAWL_RENDER_BROWSER_EXECUTABLE: z.string().trim().min(1).max(2_048).optional(),
  CRAWL_RENDER_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(10_000),
  CRAWL_RENDER_SETTLE_TIMEOUT_MS: z.coerce.number().int().min(0).max(10_000).default(1_500),
  CRAWL_RENDER_QUIET_WINDOW_MS: z.coerce.number().int().min(0).max(5_000).default(250),
  CRAWL_RENDER_MAX_RAW_HTML_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(5_000_000)
    .default(2 * 1_024 * 1_024),
  CRAWL_RENDER_MAX_HTML_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(5_000_000)
    .default(4 * 1_024 * 1_024),
  CRAWL_RENDER_MAX_BLOCKED_REQUESTS: z.coerce.number().int().min(1).max(1_000).default(100),
  CRAWL_RENDER_BROWSER_MEMORY_MB: z.coerce.number().int().min(64).max(2_048).default(256),
  CRAWL_RENDER_CLOSE_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
});

export interface WorkerEnvironment {
  readonly service: string;
  readonly nodeEnv: RuntimeEnvironment;
  readonly logLevel: LogLevel;
  readonly redisUrl: string;
  readonly redisConnectTimeoutMs: number;
  readonly queuePrefix: string;
  readonly crawlWorkerConcurrency: number;
  readonly crawlExecutionLeaseMs: number;
  readonly crawlJobAttempts: number;
  readonly crawlJobBackoffMs: number;
  readonly crawlJobBackoffJitter: number;
  readonly outboxPollIntervalMs: number;
  readonly outboxLeaseMs: number;
  readonly outboxBatchSize: number;
  readonly outboxMaxPublishAttempts: number;
  readonly healthIntervalMs: number;
  readonly shutdownTimeoutMs: number;
  readonly objectStorageEndpoint: string;
  readonly objectStorageRegion: string;
  readonly objectStorageBucket: string;
  readonly objectStorageAccessKey: string;
  readonly objectStorageSecretKey: string;
  readonly objectStorageSessionToken: string | undefined;
  readonly objectStorageForcePathStyle: boolean;
  readonly objectStorageRequestTimeoutMs: number;
  readonly artifactMaxHtmlBytes: number;
  readonly renderingEnabled: boolean;
  readonly renderingBrowserExecutable: string | null;
  readonly renderingTimeoutMs: number;
  readonly renderingSettleTimeoutMs: number;
  readonly renderingQuietWindowMs: number;
  readonly renderingMaxRawHtmlBytes: number;
  readonly renderingMaxHtmlBytes: number;
  readonly renderingMaxBlockedRequests: number;
  readonly renderingBrowserMemoryMb: number;
  readonly renderingCloseTimeoutMs: number;
}

export function parseWorkerEnvironment(
  service: string,
  source: EnvironmentSource = process.env,
): WorkerEnvironment {
  const serviceResult = serviceNameSchema.safeParse(service);

  if (!serviceResult.success) {
    throw new EnvironmentValidationError(service || "worker", [
      {
        path: "service",
        message: serviceResult.error.issues[0]?.message ?? "Invalid service name.",
      },
    ]);
  }

  const result = workerEnvironmentInputSchema.safeParse(source);

  if (!result.success) {
    throw new EnvironmentValidationError(serviceResult.data, environmentIssues(result.error));
  }

  if (isProduction(result.data.NODE_ENV)) {
    const issues = [requiredProductionIssue("REDIS_URL", result.data.REDIS_URL)];
    if (
      result.data.REDIS_URL !== undefined &&
      new URL(result.data.REDIS_URL).protocol !== "rediss:"
    ) {
      issues.push({
        path: "REDIS_URL",
        message: "Worker Redis must use TLS (rediss://) in production.",
      });
    }
    if (serviceResult.data === "crawler-worker") {
      issues.push(
        requiredProductionIssue("OBJECT_STORAGE_ENDPOINT", result.data.OBJECT_STORAGE_ENDPOINT),
        requiredProductionIssue("OBJECT_STORAGE_REGION", result.data.OBJECT_STORAGE_REGION),
        requiredProductionIssue("OBJECT_STORAGE_BUCKET", result.data.OBJECT_STORAGE_BUCKET),
        requiredProductionIssue("OBJECT_STORAGE_ACCESS_KEY", result.data.OBJECT_STORAGE_ACCESS_KEY),
        requiredProductionIssue("OBJECT_STORAGE_SECRET_KEY", result.data.OBJECT_STORAGE_SECRET_KEY),
      );
      if (
        result.data.OBJECT_STORAGE_ENDPOINT !== undefined &&
        new URL(result.data.OBJECT_STORAGE_ENDPOINT).protocol !== "https:"
      ) {
        issues.push({
          path: "OBJECT_STORAGE_ENDPOINT",
          message: "Crawler object storage must use HTTPS in production.",
        });
      }
    }
    const presentIssues = issues.filter((issue) => issue !== undefined);
    if (presentIssues.length > 0) {
      throw new EnvironmentValidationError(serviceResult.data, presentIssues);
    }
  }

  if (
    result.data.CRAWL_RENDERING_ENABLED &&
    result.data.CRAWL_RENDER_BROWSER_EXECUTABLE === undefined
  ) {
    throw new EnvironmentValidationError(serviceResult.data, [
      {
        path: "CRAWL_RENDER_BROWSER_EXECUTABLE",
        message: "Required when browser rendering is enabled.",
      },
    ]);
  }

  return Object.freeze({
    service: serviceResult.data,
    nodeEnv: result.data.NODE_ENV,
    logLevel: result.data.LOG_LEVEL,
    redisUrl: result.data.REDIS_URL ?? LOCAL_REDIS_URL,
    redisConnectTimeoutMs: result.data.REDIS_CONNECT_TIMEOUT_MS,
    queuePrefix: result.data.QUEUE_PREFIX ?? `searvia-${result.data.NODE_ENV}`,
    crawlWorkerConcurrency: result.data.CRAWL_WORKER_CONCURRENCY,
    crawlExecutionLeaseMs: result.data.CRAWL_EXECUTION_LEASE_MS,
    crawlJobAttempts: result.data.CRAWL_JOB_ATTEMPTS,
    crawlJobBackoffMs: result.data.CRAWL_JOB_BACKOFF_MS,
    crawlJobBackoffJitter: result.data.CRAWL_JOB_BACKOFF_JITTER,
    outboxPollIntervalMs: result.data.OUTBOX_POLL_INTERVAL_MS,
    outboxLeaseMs: result.data.OUTBOX_LEASE_MS,
    outboxBatchSize: result.data.OUTBOX_BATCH_SIZE,
    outboxMaxPublishAttempts: result.data.OUTBOX_MAX_PUBLISH_ATTEMPTS,
    healthIntervalMs: result.data.WORKER_HEALTH_INTERVAL_MS,
    shutdownTimeoutMs: result.data.WORKER_SHUTDOWN_TIMEOUT_MS,
    objectStorageEndpoint: result.data.OBJECT_STORAGE_ENDPOINT ?? LOCAL_OBJECT_STORAGE.endpoint,
    objectStorageRegion: result.data.OBJECT_STORAGE_REGION ?? LOCAL_OBJECT_STORAGE.region,
    objectStorageBucket: result.data.OBJECT_STORAGE_BUCKET ?? LOCAL_OBJECT_STORAGE.bucket,
    objectStorageAccessKey: result.data.OBJECT_STORAGE_ACCESS_KEY ?? LOCAL_OBJECT_STORAGE.accessKey,
    objectStorageSecretKey: result.data.OBJECT_STORAGE_SECRET_KEY ?? LOCAL_OBJECT_STORAGE.secretKey,
    objectStorageSessionToken: result.data.OBJECT_STORAGE_SESSION_TOKEN,
    objectStorageForcePathStyle: result.data.OBJECT_STORAGE_FORCE_PATH_STYLE,
    objectStorageRequestTimeoutMs: result.data.OBJECT_STORAGE_REQUEST_TIMEOUT_MS,
    artifactMaxHtmlBytes: result.data.CRAWL_ARTIFACT_MAX_HTML_BYTES,
    renderingEnabled: result.data.CRAWL_RENDERING_ENABLED,
    renderingBrowserExecutable: result.data.CRAWL_RENDER_BROWSER_EXECUTABLE ?? null,
    renderingTimeoutMs: result.data.CRAWL_RENDER_TIMEOUT_MS,
    renderingSettleTimeoutMs: result.data.CRAWL_RENDER_SETTLE_TIMEOUT_MS,
    renderingQuietWindowMs: result.data.CRAWL_RENDER_QUIET_WINDOW_MS,
    renderingMaxRawHtmlBytes: result.data.CRAWL_RENDER_MAX_RAW_HTML_BYTES,
    renderingMaxHtmlBytes: result.data.CRAWL_RENDER_MAX_HTML_BYTES,
    renderingMaxBlockedRequests: result.data.CRAWL_RENDER_MAX_BLOCKED_REQUESTS,
    renderingBrowserMemoryMb: result.data.CRAWL_RENDER_BROWSER_MEMORY_MB,
    renderingCloseTimeoutMs: result.data.CRAWL_RENDER_CLOSE_TIMEOUT_MS,
  });
}
