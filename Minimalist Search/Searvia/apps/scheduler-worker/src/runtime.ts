import type { WorkerEnvironment } from "@searvia/config/worker";
import { createServiceLogger, toSafeErrorMetadata } from "@searvia/logging";
import type { CrawlJobPublisher } from "@searvia/job-queue";

import { CrawlOutboxDispatcher, type CrawlOutboxPersistencePort } from "./outbox-publisher.js";

export interface OutboxPublisherRuntimeDependencies {
  readonly environment: WorkerEnvironment;
  readonly persistence: CrawlOutboxPersistencePort;
  readonly publisher: CrawlJobPublisher;
  readonly publisherId: string;
  readonly forceExit?: (code: number) => void;
}

export interface OutboxPublisherRuntime {
  start(): Promise<void>;
  shutdown(signal: NodeJS.Signals | "startup-failure"): Promise<void>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function createOutboxPublisherRuntime(
  dependencies: OutboxPublisherRuntimeDependencies,
): OutboxPublisherRuntime {
  const { environment } = dependencies;
  const logger = createServiceLogger({
    service: environment.service,
    environment: environment.nodeEnv,
    level: environment.logLevel,
  });
  const dispatcher = new CrawlOutboxDispatcher({
    persistence: dependencies.persistence,
    publisher: dependencies.publisher,
    configuration: {
      publisherId: dependencies.publisherId,
      leaseMs: environment.outboxLeaseMs,
      batchSize: environment.outboxBatchSize,
      maxPublishAttempts: environment.outboxMaxPublishAttempts,
    },
    onError: (error, outboxId) => {
      logger.warn(
        {
          event: "outbox.publisher.error",
          outboxId,
          ...toSafeErrorMetadata(error),
        },
        "Outbox publication encountered an error.",
      );
    },
  });
  let running = false;
  let stopping = false;
  let startPromise: Promise<void> | undefined;
  let loopPromise: Promise<void> | undefined;
  let wakeDelay: (() => void) | undefined;
  let shutdownPromise: Promise<void> | undefined;
  const dispatchAbort = new AbortController();
  const forceExit = dependencies.forceExit ?? ((code: number) => process.exit(code));

  async function delay(): Promise<void> {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        wakeDelay = undefined;
        resolve();
      }, environment.outboxPollIntervalMs);
      wakeDelay = () => {
        clearTimeout(timeout);
        wakeDelay = undefined;
        resolve();
      };
    });
  }

  async function runLoop(): Promise<void> {
    while (running) {
      try {
        const result = await dispatcher.dispatchOnce(dispatchAbort.signal);
        if (result.claimed > 0 || result.recovered > 0) {
          logger.info(
            { event: "outbox.publisher.batch", ...result },
            "Outbox publisher processed a batch.",
          );
        }
      } catch (error) {
        if (dispatchAbort.signal.aborted) return;
        logger.error(
          { event: "outbox.publisher.loop.failed", ...toSafeErrorMetadata(error) },
          "Outbox publisher loop failed and will retry.",
        );
      }
      if (running) await delay();
    }
  }

  return {
    start() {
      startPromise ??= (async () => {
        if (stopping) throw new Error("The outbox publisher is already stopping.");
        await dependencies.publisher.waitUntilReady();
        if (stopping) throw new Error("The outbox publisher stopped during startup.");
        running = true;
        loopPromise = runLoop();
        logger.info(
          { event: "outbox.publisher.ready", status: "healthy" },
          "Outbox publisher is ready.",
        );
      })();
      return startPromise;
    },

    shutdown(signal) {
      if (shutdownPromise !== undefined) return shutdownPromise;

      shutdownPromise = (async () => {
        stopping = true;
        running = false;
        wakeDelay?.();
        logger.info(
          { event: "outbox.publisher.shutdown.started", signal, status: "stopping" },
          "Outbox publisher shutdown started.",
        );

        const gracefulShutdown = (async () => {
          await (loopPromise ?? Promise.resolve());
          try {
            await dependencies.publisher.close();
          } finally {
            await dependencies.persistence.close?.();
          }
        })();

        try {
          await withTimeout(
            gracefulShutdown,
            environment.shutdownTimeoutMs,
            "Outbox publisher shutdown timed out.",
          );
        } catch (error) {
          dispatchAbort.abort(error);
          try {
            dependencies.publisher.disconnect?.();
          } catch (disconnectError) {
            logger.warn(
              {
                event: "outbox.publisher.disconnect.failed",
                signal,
                ...toSafeErrorMetadata(disconnectError),
              },
              "Outbox publisher Redis disconnect failed during forced shutdown.",
            );
          }
          logger.warn(
            {
              event: "outbox.publisher.shutdown.forced",
              signal,
              ...toSafeErrorMetadata(error),
            },
            "Outbox publisher could not complete graceful shutdown; forcing process exit.",
          );
          forceExit(1);
          return;
        }

        logger.info(
          { event: "outbox.publisher.shutdown.completed", signal, status: "stopped" },
          "Outbox publisher shutdown completed.",
        );
      })();

      return shutdownPromise;
    },
  };
}

export function installOutboxPublisherSignalHandlers(runtime: OutboxPublisherRuntime): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void runtime.shutdown(signal).catch(() => {
        process.exit(1);
      });
    });
  }
}
