import { randomUUID } from "node:crypto";

import type { EnvironmentSource } from "@searvia/config/worker";
import { createBullMqCrawlJobPublisher, type CrawlJobPublisher } from "@searvia/job-queue";

import type { CrawlOutboxPersistencePort } from "./outbox-publisher.js";
import {
  createOutboxPublisherRuntime,
  installOutboxPublisherSignalHandlers,
  type OutboxPublisherRuntime,
} from "./runtime.js";
import { createWorkerStartupConfiguration } from "./startup.js";

export interface OutboxPublisherApplicationAdapters {
  readonly persistence: CrawlOutboxPersistencePort;
  readonly publisher?: CrawlJobPublisher;
  readonly publisherId?: string;
}

/** Composition hook for the @searvia/database transactional outbox adapter. */
export async function startOutboxPublisherApplication(
  adapters: OutboxPublisherApplicationAdapters,
  source?: EnvironmentSource,
): Promise<OutboxPublisherRuntime> {
  const environment = createWorkerStartupConfiguration(source);
  const publisher =
    adapters.publisher ??
    createBullMqCrawlJobPublisher({
      redisUrl: environment.redisUrl,
      redisConnectTimeoutMs: environment.redisConnectTimeoutMs,
      queuePrefix: environment.queuePrefix,
      retryPolicy: {
        attempts: environment.crawlJobAttempts,
        backoffMs: environment.crawlJobBackoffMs,
        jitter: environment.crawlJobBackoffJitter,
      },
    });
  const runtime = createOutboxPublisherRuntime({
    environment,
    persistence: adapters.persistence,
    publisher,
    publisherId: adapters.publisherId ?? randomUUID(),
  });
  installOutboxPublisherSignalHandlers(runtime);
  try {
    await runtime.start();
  } catch (error) {
    await runtime.shutdown("startup-failure");
    throw error;
  }
  return runtime;
}
