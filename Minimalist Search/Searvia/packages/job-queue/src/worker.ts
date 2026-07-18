import {
  AUDIT_EVALUATE_JOB_TYPE,
  CRAWL_EXECUTE_JOB_TYPE,
  auditEvaluateJobSchema,
  crawlExecuteJobSchema,
  type AuditEvaluateJob,
  type CrawlExecuteJob,
} from "@searvia/shared-types";
import { DelayedError, UnrecoverableError, Worker } from "bullmq";

import { closeOwnedRedisConnection, createWorkerRedisConnection } from "./connections.js";
import { AUDIT_QUEUE_NAME, CRAWL_QUEUE_NAME } from "./contracts.js";

export interface CrawlJobDeliveryContext {
  readonly queueJobId: string;
  readonly attemptsMade: number;
  readonly attemptsStarted: number;
  readonly maxAttempts: number;
  readonly signal: AbortSignal | undefined;
  defer(retryAfterMs: number): Promise<never>;
}

export type CrawlJobHandler = (
  job: CrawlExecuteJob,
  delivery: CrawlJobDeliveryContext,
) => Promise<void>;

export type AuditJobHandler = (
  job: AuditEvaluateJob,
  delivery: CrawlJobDeliveryContext,
) => Promise<void>;

export interface CrawlWorkerConfiguration {
  readonly redisUrl: string;
  readonly redisConnectTimeoutMs: number;
  readonly queuePrefix: string;
  readonly concurrency: number;
  readonly handler: CrawlJobHandler;
  readonly onError?: (error: Error) => void;
  readonly onFailed?: QueueJobFailedHandler;
}

export interface AuditWorkerConfiguration {
  readonly redisUrl: string;
  readonly redisConnectTimeoutMs: number;
  readonly queuePrefix: string;
  readonly concurrency: number;
  readonly handler: AuditJobHandler;
  readonly onError?: (error: Error) => void;
  readonly onFailed?: QueueJobFailedHandler;
}

export interface QueueJobFailure {
  readonly queueJobId: string | null;
  readonly crawlId: string | null;
  readonly attemptsMade: number;
}

export type QueueJobFailedHandler = (input: QueueJobFailure, error: Error) => void;

export interface QueueWorkerHandle {
  start(): Promise<void>;
  waitUntilReady(): Promise<void>;
  close(force?: boolean): Promise<void>;
  cancelAll(reason?: string): void;
  isRunning(): boolean;
}

export type CrawlWorkerHandle = QueueWorkerHandle;
export type AuditWorkerHandle = QueueWorkerHandle;

export class UnrecoverableCrawlJobError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UnrecoverableCrawlJobError";
  }
}

const MINIMUM_JOB_DEFERRAL_MS = 50;
const MAXIMUM_JOB_DEFERRAL_MS = 900_000;

export interface ActiveCrawlJobDeferralPort {
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

function normalizedDeferralMs(retryAfterMs: number): number {
  if (!Number.isFinite(retryAfterMs)) {
    throw new RangeError("The crawl job deferral must be a finite number of milliseconds.");
  }
  return Math.min(
    MAXIMUM_JOB_DEFERRAL_MS,
    Math.max(MINIMUM_JOB_DEFERRAL_MS, Math.ceil(retryAfterMs)),
  );
}

export async function deferActiveCrawlJob(
  job: ActiveCrawlJobDeferralPort,
  token: string | undefined,
  retryAfterMs: number,
  now = Date.now(),
): Promise<never> {
  if (token === undefined || token.length === 0) {
    throw new Error("The active crawl job cannot be deferred without its BullMQ lock token.");
  }
  const delayedUntil = now + normalizedDeferralMs(retryAfterMs);
  await job.moveToDelayed(delayedUntil, token);
  throw new DelayedError();
}

function normalizeThrownError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("The background job processor threw a non-Error value.");
}

function validateWorkerConcurrency(concurrency: number, workerName: string): void {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new RangeError(`${workerName} concurrency must be between 1 and 32.`);
  }
}

interface BullMqWorkerLifecyclePort {
  run(): Promise<void>;
  waitUntilReady(): Promise<unknown>;
  close(force?: boolean): Promise<void>;
  cancelAllJobs(reason?: string): void;
  isRunning(): boolean;
}

function createWorkerHandle(
  worker: BullMqWorkerLifecyclePort,
  connection: ReturnType<typeof createWorkerRedisConnection>,
): QueueWorkerHandle {
  let runPromise: Promise<void> | undefined;

  return {
    async start() {
      runPromise ??= worker.run();
      await worker.waitUntilReady();
    },
    async waitUntilReady() {
      await worker.waitUntilReady();
    },
    async close(force = false) {
      try {
        await worker.close(force);
        await runPromise;
      } finally {
        await closeOwnedRedisConnection(connection);
      }
    },
    cancelAll(reason) {
      worker.cancelAllJobs(reason);
    },
    isRunning() {
      return worker.isRunning();
    },
  };
}

function throwNormalizedProcessorError(error: unknown): never {
  if (error instanceof UnrecoverableCrawlJobError) {
    throw new UnrecoverableError(error.message);
  }
  throw normalizeThrownError(error);
}

export function createBullMqCrawlWorker(
  configuration: CrawlWorkerConfiguration,
): CrawlWorkerHandle {
  validateWorkerConcurrency(configuration.concurrency, "Crawler worker");

  const connection = createWorkerRedisConnection({
    url: configuration.redisUrl,
    connectTimeoutMs: configuration.redisConnectTimeoutMs,
  });
  const worker = new Worker<CrawlExecuteJob, void, typeof CRAWL_EXECUTE_JOB_TYPE>(
    CRAWL_QUEUE_NAME,
    async (queueJob, token, signal) => {
      try {
        if (queueJob.name !== CRAWL_EXECUTE_JOB_TYPE) {
          throw new UnrecoverableError("Unsupported crawl queue job name.");
        }
        const contract = crawlExecuteJobSchema.safeParse(queueJob.data);
        if (!contract.success) {
          throw new UnrecoverableError("Invalid crawl execution contract.");
        }
        await configuration.handler(contract.data, {
          queueJobId: String(queueJob.id ?? contract.data.crawlId),
          attemptsMade: queueJob.attemptsMade,
          attemptsStarted: queueJob.attemptsStarted,
          maxAttempts: queueJob.opts.attempts ?? 1,
          signal,
          defer: (retryAfterMs) => deferActiveCrawlJob(queueJob, token, retryAfterMs),
        });
      } catch (error) {
        throwNormalizedProcessorError(error);
      }
    },
    {
      autorun: false,
      concurrency: configuration.concurrency,
      connection,
      prefix: configuration.queuePrefix,
    },
  );

  if (configuration.onError !== undefined) {
    worker.on("error", configuration.onError);
  }
  if (configuration.onFailed !== undefined) {
    worker.on("failed", (queueJob, error) => {
      const parsedContract = crawlExecuteJobSchema.safeParse(queueJob?.data);
      configuration.onFailed?.(
        {
          queueJobId: queueJob?.id === undefined ? null : String(queueJob.id),
          crawlId: parsedContract.success ? parsedContract.data.crawlId : null,
          attemptsMade: queueJob?.attemptsMade ?? 0,
        },
        error,
      );
    });
  }

  return createWorkerHandle(worker, connection);
}

export function createBullMqAuditWorker(
  configuration: AuditWorkerConfiguration,
): AuditWorkerHandle {
  validateWorkerConcurrency(configuration.concurrency, "Audit worker");

  const connection = createWorkerRedisConnection({
    url: configuration.redisUrl,
    connectTimeoutMs: configuration.redisConnectTimeoutMs,
  });
  const worker = new Worker<AuditEvaluateJob, void, typeof AUDIT_EVALUATE_JOB_TYPE>(
    AUDIT_QUEUE_NAME,
    async (queueJob, token, signal) => {
      try {
        if (queueJob.name !== AUDIT_EVALUATE_JOB_TYPE) {
          throw new UnrecoverableError("Unsupported audit queue job name.");
        }
        const contract = auditEvaluateJobSchema.safeParse(queueJob.data);
        if (!contract.success) {
          throw new UnrecoverableError("Invalid audit evaluation contract.");
        }
        await configuration.handler(contract.data, {
          queueJobId: String(queueJob.id ?? contract.data.idempotencyKey),
          attemptsMade: queueJob.attemptsMade,
          attemptsStarted: queueJob.attemptsStarted,
          maxAttempts: queueJob.opts.attempts ?? 1,
          signal,
          defer: (retryAfterMs) => deferActiveCrawlJob(queueJob, token, retryAfterMs),
        });
      } catch (error) {
        throwNormalizedProcessorError(error);
      }
    },
    {
      autorun: false,
      concurrency: configuration.concurrency,
      connection,
      prefix: configuration.queuePrefix,
    },
  );

  if (configuration.onError !== undefined) {
    worker.on("error", configuration.onError);
  }
  if (configuration.onFailed !== undefined) {
    worker.on("failed", (queueJob, error) => {
      const parsedContract = auditEvaluateJobSchema.safeParse(queueJob?.data);
      configuration.onFailed?.(
        {
          queueJobId: queueJob?.id === undefined ? null : String(queueJob.id),
          crawlId: parsedContract.success ? parsedContract.data.crawlId : null,
          attemptsMade: queueJob?.attemptsMade ?? 0,
        },
        error,
      );
    });
  }

  return createWorkerHandle(worker, connection);
}
