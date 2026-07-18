import type { EnvironmentSource } from "@searvia/config/worker";

import { createAuditJobProcessor, type AuditEvaluationPersistencePort } from "./audit-processor.js";
import {
  createCrawlJobProcessor,
  type CrawlExecutor,
  type CrawlProcessingPersistencePort,
} from "./processor.js";
import {
  createCrawlerWorkerRuntime,
  installCrawlerWorkerSignalHandlers,
  type CrawlerWorkerRuntime,
} from "./runtime.js";
import { createWorkerStartupConfiguration } from "./startup.js";

export interface CrawlerWorkerApplicationAdapters {
  readonly persistence: CrawlProcessingPersistencePort;
  readonly executor: CrawlExecutor;
  readonly auditPersistence?: AuditEvaluationPersistencePort;
  readonly onProcessingError?: (error: unknown) => void;
  readonly onAuditProcessingError?: (error: unknown) => void;
}

/**
 * Composition hook for the database and crawler-core adapters. Keeping those
 * adapters outside this app layer makes the BullMQ lifecycle independently testable.
 */
export async function startCrawlerWorkerApplication(
  adapters: CrawlerWorkerApplicationAdapters,
  source?: EnvironmentSource,
): Promise<CrawlerWorkerRuntime> {
  const environment = createWorkerStartupConfiguration(source);
  const handler = createCrawlJobProcessor({
    persistence: adapters.persistence,
    executor: adapters.executor,
    ...(adapters.onProcessingError === undefined
      ? {}
      : {
          onError: (error: unknown) => {
            adapters.onProcessingError?.(error);
          },
        }),
  });
  const auditHandler =
    adapters.auditPersistence === undefined
      ? undefined
      : createAuditJobProcessor({
          persistence: adapters.auditPersistence,
          ...(adapters.onAuditProcessingError === undefined
            ? {}
            : {
                onError: (error: unknown) => {
                  adapters.onAuditProcessingError?.(error);
                },
              }),
        });
  const closePersistence =
    adapters.persistence.close === undefined && adapters.executor.close === undefined
      ? undefined
      : async (): Promise<void> => {
          try {
            await adapters.executor.close?.();
          } finally {
            await adapters.persistence.close?.();
          }
        };
  const runtime = createCrawlerWorkerRuntime({
    environment,
    handler,
    ...(auditHandler === undefined ? {} : { auditHandler }),
    ...(closePersistence === undefined ? {} : { closePersistence }),
  });
  installCrawlerWorkerSignalHandlers(runtime);
  try {
    await runtime.start();
  } catch (error) {
    await runtime.shutdown("startup-failure");
    throw error;
  }
  return runtime;
}
