import type { WorkerEnvironment } from "@searvia/config/worker";
import {
  createBullMqAuditWorker,
  createBullMqCrawlWorker,
  type AuditJobHandler,
  type AuditWorkerHandle,
  type CrawlJobHandler,
  type CrawlWorkerHandle,
  type QueueWorkerHandle,
} from "@searvia/job-queue";
import { createServiceLogger, toSafeErrorMetadata } from "@searvia/logging";

export interface CrawlerWorkerRuntimeDependencies {
  readonly environment: WorkerEnvironment;
  readonly handler: CrawlJobHandler;
  readonly auditHandler?: AuditJobHandler;
  readonly worker?: CrawlWorkerHandle;
  readonly auditWorker?: AuditWorkerHandle;
  readonly closePersistence?: () => Promise<void>;
}

export interface CrawlerWorkerRuntime {
  start(): Promise<void>;
  shutdown(signal: NodeJS.Signals | "startup-failure"): Promise<void>;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Crawler worker shutdown timed out.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function createCrawlerWorkerRuntime(
  dependencies: CrawlerWorkerRuntimeDependencies,
): CrawlerWorkerRuntime {
  if (dependencies.auditWorker !== undefined && dependencies.auditHandler === undefined) {
    throw new TypeError("An audit worker handle requires an audit job handler.");
  }
  const { environment } = dependencies;
  const logger = createServiceLogger({
    service: environment.service,
    environment: environment.nodeEnv,
    level: environment.logLevel,
  });
  const crawlWorker =
    dependencies.worker ??
    createBullMqCrawlWorker({
      redisUrl: environment.redisUrl,
      redisConnectTimeoutMs: environment.redisConnectTimeoutMs,
      queuePrefix: environment.queuePrefix,
      concurrency: environment.crawlWorkerConcurrency,
      handler: dependencies.handler,
      onError: (error) => {
        logger.error(
          { event: "crawl.worker.error", ...toSafeErrorMetadata(error) },
          "Crawler worker emitted an error.",
        );
      },
      onFailed: (input, error) => {
        logger.warn(
          {
            event: "crawl.worker.job.failed",
            ...input,
            ...toSafeErrorMetadata(error),
          },
          "A crawl job attempt failed.",
        );
      },
    });
  const auditWorker =
    dependencies.auditHandler === undefined
      ? undefined
      : (dependencies.auditWorker ??
        createBullMqAuditWorker({
          redisUrl: environment.redisUrl,
          redisConnectTimeoutMs: environment.redisConnectTimeoutMs,
          queuePrefix: environment.queuePrefix,
          concurrency: environment.crawlWorkerConcurrency,
          handler: dependencies.auditHandler,
          onError: (error) => {
            logger.error(
              { event: "audit.worker.error", ...toSafeErrorMetadata(error) },
              "Audit worker emitted an error.",
            );
          },
          onFailed: (input, error) => {
            logger.warn(
              {
                event: "audit.worker.job.failed",
                ...input,
                ...toSafeErrorMetadata(error),
              },
              "An audit job attempt failed.",
            );
          },
        }));
  const workers: readonly QueueWorkerHandle[] =
    auditWorker === undefined ? [crawlWorker] : [crawlWorker, auditWorker];
  let healthTimer: NodeJS.Timeout | undefined;
  let startPromise: Promise<void> | undefined;
  let shutdownPromise: Promise<void> | undefined;

  return {
    start() {
      if (startPromise === undefined) {
        startPromise = (async () => {
          logger.info(
            { event: "crawl.worker.starting", status: "starting" },
            "Crawler worker is starting.",
          );
          await Promise.all(workers.map((worker) => worker.start()));
          healthTimer = setInterval(() => {
            logger.info(
              {
                event: "crawl.worker.health",
                status: workers.every((worker) => worker.isRunning()) ? "healthy" : "unhealthy",
                crawlQueueRunning: crawlWorker.isRunning(),
                ...(auditWorker === undefined
                  ? {}
                  : { auditQueueRunning: auditWorker.isRunning() }),
              },
              "Crawler worker health checked.",
            );
          }, environment.healthIntervalMs);
          logger.info(
            { event: "crawl.worker.ready", status: "healthy" },
            "Crawler worker is ready.",
          );
        })();
      }
      return startPromise;
    },

    shutdown(signal) {
      if (shutdownPromise !== undefined) return shutdownPromise;

      shutdownPromise = (async () => {
        if (healthTimer !== undefined) clearInterval(healthTimer);
        logger.info(
          { event: "crawl.worker.shutdown.started", signal, status: "stopping" },
          "Crawler worker shutdown started.",
        );

        try {
          try {
            await withTimeout(
              Promise.all(workers.map((worker) => worker.close(false))),
              environment.shutdownTimeoutMs,
            );
          } catch (error) {
            for (const worker of workers) worker.cancelAll("worker-shutdown");
            await Promise.all(workers.map((worker) => worker.close(true)));
            logger.warn(
              {
                event: "crawl.worker.shutdown.forced",
                signal,
                ...toSafeErrorMetadata(error),
              },
              "Crawler worker required a forced shutdown after its graceful bound.",
            );
          } finally {
            await dependencies.closePersistence?.();
          }

          logger.info(
            { event: "crawl.worker.shutdown.completed", signal, status: "stopped" },
            "Crawler worker shutdown completed.",
          );
        } catch (error) {
          logger.error(
            {
              event: "crawl.worker.shutdown.failed",
              signal,
              status: "unhealthy",
              ...toSafeErrorMetadata(error),
            },
            "Crawler worker shutdown failed.",
          );
          throw error;
        }
      })();

      return shutdownPromise;
    },
  };
}

export function installCrawlerWorkerSignalHandlers(runtime: CrawlerWorkerRuntime): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void runtime.shutdown(signal).catch(() => {
        process.exit(1);
      });
    });
  }
}
