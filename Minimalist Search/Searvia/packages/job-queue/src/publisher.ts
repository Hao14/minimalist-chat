import {
  AUDIT_EVALUATE_JOB_TYPE,
  CRAWL_DEAD_LETTER_JOB_TYPE,
  CRAWL_EXECUTE_JOB_TYPE,
  type AuditEvaluateJob,
  type CrawlDeadLetterJob,
  type CrawlExecuteJob,
} from "@searvia/shared-types";
import { Queue, type JobsOptions } from "bullmq";

import { closeOwnedRedisConnection, createProducerRedisConnection } from "./connections.js";
import {
  AUDIT_QUEUE_NAME,
  CRAWL_DEAD_LETTER_QUEUE_NAME,
  CRAWL_QUEUE_NAME,
  crawlQueueJobId,
  crawlQueueOptionsForJob,
  parseSearviaQueueJob,
  type CrawlJobRetryPolicy,
  type SearviaQueueName,
  type SearviaQueueJob,
} from "./contracts.js";

export interface PublishedCrawlJob {
  readonly jobId: string;
  readonly queueName: SearviaQueueName;
}

export interface CrawlJobPublisher {
  publish(job: SearviaQueueJob): Promise<PublishedCrawlJob>;
  waitUntilReady(): Promise<void>;
  close(): Promise<void>;
  disconnect?(): void;
}

export interface QueueAddPort<TJob extends SearviaQueueJob> {
  add(jobName: TJob["jobType"], data: TJob, options: JobsOptions): Promise<void>;
  waitUntilReady(): Promise<void>;
  close(): Promise<void>;
}

export interface CrawlJobPublisherConfiguration {
  readonly redisUrl: string;
  readonly redisConnectTimeoutMs: number;
  readonly queuePrefix: string;
  readonly retryPolicy: CrawlJobRetryPolicy;
}

export class PortBackedCrawlJobPublisher implements CrawlJobPublisher {
  readonly #executionQueue: QueueAddPort<CrawlExecuteJob>;
  readonly #auditQueue: QueueAddPort<AuditEvaluateJob> | undefined;
  readonly #deadLetterQueue: QueueAddPort<CrawlDeadLetterJob>;
  readonly #retryPolicy: CrawlJobRetryPolicy;

  constructor(
    executionQueue: QueueAddPort<CrawlExecuteJob>,
    deadLetterQueue: QueueAddPort<CrawlDeadLetterJob>,
    retryPolicy: CrawlJobRetryPolicy,
    auditQueue?: QueueAddPort<AuditEvaluateJob>,
  ) {
    this.#executionQueue = executionQueue;
    this.#deadLetterQueue = deadLetterQueue;
    this.#retryPolicy = retryPolicy;
    this.#auditQueue = auditQueue;
  }

  async publish(job: SearviaQueueJob): Promise<PublishedCrawlJob> {
    const parsed = parseSearviaQueueJob(job);
    const options = crawlQueueOptionsForJob(parsed, this.#retryPolicy);

    if (parsed.jobType === CRAWL_EXECUTE_JOB_TYPE) {
      await this.#executionQueue.add(parsed.jobType, parsed, options);
      return { jobId: crawlQueueJobId(parsed), queueName: CRAWL_QUEUE_NAME };
    }

    if (parsed.jobType === AUDIT_EVALUATE_JOB_TYPE) {
      if (this.#auditQueue === undefined) {
        throw new Error("The audit evaluation queue is not configured.");
      }
      await this.#auditQueue.add(parsed.jobType, parsed, options);
      return { jobId: crawlQueueJobId(parsed), queueName: AUDIT_QUEUE_NAME };
    }

    await this.#deadLetterQueue.add(CRAWL_DEAD_LETTER_JOB_TYPE, parsed, options);
    return { jobId: crawlQueueJobId(parsed), queueName: CRAWL_DEAD_LETTER_QUEUE_NAME };
  }

  async waitUntilReady(): Promise<void> {
    await Promise.all(
      [...new Set([this.#executionQueue, this.#auditQueue, this.#deadLetterQueue])]
        .filter((queue): queue is QueueAddPort<SearviaQueueJob> => queue !== undefined)
        .map((queue) => queue.waitUntilReady()),
    );
  }

  async close(): Promise<void> {
    await Promise.all(
      [...new Set([this.#executionQueue, this.#auditQueue, this.#deadLetterQueue])]
        .filter((queue): queue is QueueAddPort<SearviaQueueJob> => queue !== undefined)
        .map((queue) => queue.close()),
    );
  }
}

function executionQueuePort(
  queue: Queue<CrawlExecuteJob, unknown, typeof CRAWL_EXECUTE_JOB_TYPE>,
): QueueAddPort<CrawlExecuteJob> {
  return {
    async add(jobName, data, options) {
      await queue.add(jobName, data, options);
    },
    async waitUntilReady() {
      await queue.waitUntilReady();
    },
    async close() {
      await queue.close();
    },
  };
}

function auditQueuePort(
  queue: Queue<AuditEvaluateJob, unknown, typeof AUDIT_EVALUATE_JOB_TYPE>,
): QueueAddPort<AuditEvaluateJob> {
  return {
    async add(jobName, data, options) {
      await queue.add(jobName, data, options);
    },
    async waitUntilReady() {
      await queue.waitUntilReady();
    },
    async close() {
      await queue.close();
    },
  };
}

function deadLetterQueuePort(
  queue: Queue<CrawlDeadLetterJob, unknown, typeof CRAWL_DEAD_LETTER_JOB_TYPE>,
): QueueAddPort<CrawlDeadLetterJob> {
  return {
    async add(_jobName, data, options) {
      await queue.add(CRAWL_DEAD_LETTER_JOB_TYPE, data, options);
    },
    async waitUntilReady() {
      await queue.waitUntilReady();
    },
    async close() {
      await queue.close();
    },
  };
}

export function createBullMqCrawlJobPublisher(
  configuration: CrawlJobPublisherConfiguration,
): CrawlJobPublisher {
  const connection = createProducerRedisConnection({
    url: configuration.redisUrl,
    connectTimeoutMs: configuration.redisConnectTimeoutMs,
  });
  const executionQueue = new Queue<CrawlExecuteJob, unknown, typeof CRAWL_EXECUTE_JOB_TYPE>(
    CRAWL_QUEUE_NAME,
    {
      connection,
      prefix: configuration.queuePrefix,
    },
  );
  const auditQueue = new Queue<AuditEvaluateJob, unknown, typeof AUDIT_EVALUATE_JOB_TYPE>(
    AUDIT_QUEUE_NAME,
    {
      connection,
      prefix: configuration.queuePrefix,
    },
  );
  const deadLetterQueue = new Queue<CrawlDeadLetterJob, unknown, typeof CRAWL_DEAD_LETTER_JOB_TYPE>(
    CRAWL_DEAD_LETTER_QUEUE_NAME,
    {
      connection,
      prefix: configuration.queuePrefix,
    },
  );
  const publisher = new PortBackedCrawlJobPublisher(
    executionQueuePort(executionQueue),
    deadLetterQueuePort(deadLetterQueue),
    configuration.retryPolicy,
    auditQueuePort(auditQueue),
  );

  return {
    publish: (job) => publisher.publish(job),
    waitUntilReady: () => publisher.waitUntilReady(),
    disconnect() {
      connection.disconnect(false);
    },
    async close() {
      try {
        await publisher.close();
      } finally {
        await closeOwnedRedisConnection(connection);
      }
    },
  };
}
