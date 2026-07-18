import {
  CRAWL_JOB_CONTRACT_VERSION,
  crawlProgressCountersSchema,
  type CrawlDeadLetterJob,
  type CrawlExecuteJob,
  type CrawlProgressCounters,
} from "@searvia/shared-types";
import {
  UnrecoverableCrawlJobError,
  type CrawlJobDeliveryContext,
  type CrawlJobHandler,
} from "@searvia/job-queue";

export interface CrawlExecutionConfiguration {
  readonly startUrl: string;
  readonly pageLimit: number;
  readonly maxDepth: number;
  readonly includeSubdomains: boolean;
  readonly respectRobots: true;
  readonly requestDelayMs: number;
  readonly concurrency: number;
  readonly includePatterns: readonly string[];
  readonly excludePatterns: readonly string[];
  readonly queryPolicy: "keep" | "ignore_tracking" | "ignore_all";
  readonly userAgent: string;
  readonly redirectLimit: number;
  readonly maxResponseBytes: number;
  readonly requestTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly supportedContentTypes: readonly string[];
  readonly renderingEnabled: boolean;
  readonly submittedSitemapUrls: readonly string[];
}

export interface AuthorizedCrawlExecution {
  readonly organizationId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly configuration: CrawlExecutionConfiguration;
  readonly initialCounters: CrawlProgressCounters;
}

export type CrawlClaimResult =
  | Readonly<{ state: "claimed"; execution: AuthorizedCrawlExecution }>
  | Readonly<{ state: "busy"; retryAfterMs: number }>
  | Readonly<{ state: "terminal" | "cancelled" }>;

export type PreClaimFailureResult =
  | Readonly<{ state: "retryable" | "already_terminal" | "cancelled" }>
  | Readonly<{ state: "busy"; retryAfterMs: number }>
  | Readonly<{
      state: "failed";
      finalStatus: "failed" | "partially_completed";
    }>;

export interface CrawlProcessingPersistencePort {
  readonly executionLeaseHeartbeatMs: number;
  claimExecution(
    input: Readonly<{
      contract: CrawlExecuteJob;
      queueJobId: string;
      attempt: number;
    }>,
  ): Promise<CrawlClaimResult>;
  recordPreClaimFailure(
    input: Readonly<{
      contract: CrawlExecuteJob;
      queueJobId: string;
      attempt: number;
      errorType: string;
      errorMessage: string;
      terminal: boolean;
    }>,
  ): Promise<PreClaimFailureResult>;
  isCancellationRequested(execution: AuthorizedCrawlExecution): Promise<boolean>;
  renewExecutionLease(execution: AuthorizedCrawlExecution): Promise<void>;
  recordProgress(
    execution: AuthorizedCrawlExecution,
    counters: CrawlProgressCounters,
  ): Promise<void>;
  recordCompletion(
    execution: AuthorizedCrawlExecution,
    input: Readonly<{
      status: "completed" | "partially_completed";
      counters: CrawlProgressCounters;
    }>,
  ): Promise<void>;
  recordCancellation(
    execution: AuthorizedCrawlExecution,
    counters: CrawlProgressCounters,
  ): Promise<void>;
  recordFailure(
    execution: AuthorizedCrawlExecution,
    input: Readonly<{
      attempt: number;
      errorType: string;
      errorMessage: string;
      retryable: boolean;
      terminal: boolean;
      finalStatus: "failed" | "partially_completed" | null;
      deadLetter: CrawlDeadLetterJob | null;
    }>,
  ): Promise<void>;
  recordRejectedScope(
    input: Readonly<{
      contract: CrawlExecuteJob;
      queueJobId: string;
      attempt: number;
      errorType: string;
      errorMessage: string;
      deadLetter: CrawlDeadLetterJob;
    }>,
  ): Promise<void>;
  checkpointInterruption(
    execution: AuthorizedCrawlExecution,
    input: Readonly<{ attempt: number; reason: "queue-abort" | "worker-shutdown" }>,
  ): Promise<void>;
  close?(): Promise<void>;
}

export interface CrawlExecutionHooks {
  readonly signal: AbortSignal | undefined;
  reportProgress(counters: CrawlProgressCounters): Promise<void>;
  isCancellationRequested(): Promise<boolean>;
}

export interface CrawlExecutionResult {
  readonly status: "completed" | "partially_completed" | "cancelled";
  readonly counters: CrawlProgressCounters;
}

export interface CrawlExecutor {
  execute(
    execution: AuthorizedCrawlExecution,
    hooks: CrawlExecutionHooks,
  ): Promise<CrawlExecutionResult>;
  close?(): Promise<void>;
}

export interface ClassifiedCrawlFailure {
  readonly type: string;
  readonly safeMessage: string;
  readonly retryable: boolean;
  readonly partial: boolean;
}

export class CrawlExecutionError extends Error {
  readonly failure: ClassifiedCrawlFailure;

  constructor(failure: ClassifiedCrawlFailure, options?: ErrorOptions) {
    super(failure.safeMessage, options);
    this.name = "CrawlExecutionError";
    this.failure = failure;
  }
}

function normalizeErrorType(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 120);
  return normalized.length > 0 ? normalized : "crawl_worker_error";
}

export function classifyCrawlFailure(error: unknown): ClassifiedCrawlFailure {
  if (error instanceof CrawlExecutionError) {
    return Object.freeze({
      type: normalizeErrorType(error.failure.type),
      safeMessage: error.failure.safeMessage.trim().slice(0, 1_000),
      retryable: error.failure.retryable,
      partial: error.failure.partial,
    });
  }

  return Object.freeze({
    type: "crawl_worker_error",
    safeMessage: "The crawl worker could not complete this attempt.",
    retryable: true,
    partial: false,
  });
}

function assertTenantContext(contract: CrawlExecuteJob, execution: AuthorizedCrawlExecution): void {
  if (
    execution.organizationId !== contract.organizationId ||
    execution.projectId !== contract.projectId ||
    execution.crawlId !== contract.crawlId
  ) {
    throw new CrawlExecutionError({
      type: "tenant_scope_mismatch",
      safeMessage: "The queued crawl scope did not match the persisted crawl.",
      retryable: false,
      partial: false,
    });
  }
}

function deadLetterFor(
  contract: CrawlExecuteJob,
  delivery: CrawlJobDeliveryContext,
  failure: ClassifiedCrawlFailure,
  finalStatus: "failed" | "partially_completed",
): CrawlDeadLetterJob {
  return {
    contractVersion: CRAWL_JOB_CONTRACT_VERSION,
    jobType: "crawl.dead-letter",
    organizationId: contract.organizationId,
    projectId: contract.projectId,
    crawlId: contract.crawlId,
    sourceJobId: contract.crawlId,
    traceId: contract.traceId,
    idempotencyKey: `dead-letter-${contract.crawlId}`,
    finalStatus,
    attemptsMade: Math.max(1, delivery.attemptsMade + 1),
    errorType: failure.type,
    errorMessage: failure.safeMessage,
    failedAt: new Date().toISOString(),
  };
}

export interface CrawlJobProcessorDependencies {
  readonly persistence: CrawlProcessingPersistencePort;
  readonly executor: CrawlExecutor;
  readonly onError?: (error: unknown, contract: CrawlExecuteJob) => void;
}

function interruptionError(): CrawlExecutionError {
  return new CrawlExecutionError({
    type: "crawl_interrupted",
    safeMessage: "Crawl processing was interrupted.",
    retryable: true,
    partial: false,
  });
}

function isDeliveryAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function leaseRenewalError(cause: unknown): CrawlExecutionError {
  return new CrawlExecutionError(
    {
      type: "execution_lease_renewal_failed",
      safeMessage: "The crawl worker could not renew its execution lease.",
      retryable: true,
      partial: false,
    },
    { cause },
  );
}

function terminalPersistenceError(cause: unknown): CrawlExecutionError {
  return new CrawlExecutionError(
    {
      type: "crawl_state_persistence_unavailable",
      safeMessage: "The crawl worker could not persist its durable state.",
      retryable: true,
      partial: false,
    },
    { cause },
  );
}

const PERSISTENCE_DEFERRAL_MS = 1_000;

class ExecutionLeaseHeartbeat {
  readonly #controller = new AbortController();
  readonly #execution: AuthorizedCrawlExecution;
  readonly #intervalMs: number;
  readonly #persistence: CrawlProcessingPersistencePort;
  #failure: CrawlExecutionError | undefined;
  #inFlight: Promise<void> | undefined;
  #stopped = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(persistence: CrawlProcessingPersistencePort, execution: AuthorizedCrawlExecution) {
    this.#persistence = persistence;
    this.#execution = execution;
    this.#intervalMs = Math.max(1, Math.floor(persistence.executionLeaseHeartbeatMs));
  }

  get failure(): CrawlExecutionError | undefined {
    return this.#failure;
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  start(): void {
    this.#schedule();
  }

  throwIfFailed(): void {
    if (this.#failure !== undefined) throw this.#failure;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#inFlight;
  }

  #schedule(): void {
    if (this.#stopped || this.#failure !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      const renewal = this.#renew();
      this.#inFlight = renewal;
      void renewal.then(() => {
        if (this.#inFlight === renewal) this.#inFlight = undefined;
        this.#schedule();
      });
    }, this.#intervalMs);
    this.#timer.unref();
  }

  async #renew(): Promise<void> {
    try {
      await this.#persistence.renewExecutionLease(this.#execution);
    } catch (cause) {
      this.#failure ??= leaseRenewalError(cause);
      if (!this.#controller.signal.aborted) this.#controller.abort(this.#failure);
    }
  }
}

function executionSignal(
  deliverySignal: AbortSignal | undefined,
  heartbeatSignal: AbortSignal,
): AbortSignal {
  return deliverySignal === undefined
    ? heartbeatSignal
    : AbortSignal.any([deliverySignal, heartbeatSignal]);
}

export function createCrawlJobProcessor(
  dependencies: CrawlJobProcessorDependencies,
): CrawlJobHandler {
  return async (contract, delivery) => {
    const attempt = delivery.attemptsMade + 1;
    let claim: CrawlClaimResult;

    while (true) {
      try {
        claim = await dependencies.persistence.claimExecution({
          contract,
          queueJobId: delivery.queueJobId,
          attempt,
        });
      } catch (error) {
        const failure = classifyCrawlFailure(error);
        const terminal = !failure.retryable || attempt >= delivery.maxAttempts;
        dependencies.onError?.(new CrawlExecutionError(failure), contract);

        let reconciliation: PreClaimFailureResult;
        try {
          reconciliation = await dependencies.persistence.recordPreClaimFailure({
            contract,
            queueJobId: delivery.queueJobId,
            attempt,
            errorType: failure.type,
            errorMessage: failure.safeMessage,
            terminal,
          });
        } catch (reconciliationError) {
          const reconciliationFailure = terminalPersistenceError(reconciliationError);
          dependencies.onError?.(reconciliationFailure, contract);
          await delivery.defer(PERSISTENCE_DEFERRAL_MS);
          continue;
        }

        if (reconciliation.state === "busy") {
          await delivery.defer(reconciliation.retryAfterMs);
          continue;
        }
        if (reconciliation.state === "already_terminal" || reconciliation.state === "cancelled") {
          return;
        }
        if (!failure.retryable) {
          throw new UnrecoverableCrawlJobError(failure.safeMessage);
        }
        throw new CrawlExecutionError(failure);
      }

      if (claim.state !== "busy") break;
      await delivery.defer(claim.retryAfterMs);
    }

    if (claim.state !== "claimed") {
      return;
    }

    const execution = claim.execution;
    let lastCounters = execution.initialCounters;

    try {
      assertTenantContext(contract, execution);
    } catch (error) {
      const failure = classifyCrawlFailure(error);
      const deadLetter = deadLetterFor(contract, delivery, failure, "failed");
      dependencies.onError?.(new CrawlExecutionError(failure), contract);
      try {
        await dependencies.persistence.recordRejectedScope({
          contract,
          queueJobId: delivery.queueJobId,
          attempt,
          errorType: failure.type,
          errorMessage: failure.safeMessage,
          deadLetter,
        });
      } catch (persistenceError) {
        dependencies.onError?.(terminalPersistenceError(persistenceError), contract);
        await delivery.defer(PERSISTENCE_DEFERRAL_MS);
      }
      throw new UnrecoverableCrawlJobError(failure.safeMessage);
    }

    const heartbeat = new ExecutionLeaseHeartbeat(dependencies.persistence, execution);
    let persistenceDeferralRequested = false;
    heartbeat.start();

    try {
      if (isDeliveryAborted(delivery.signal)) throw interruptionError();
      if (await dependencies.persistence.isCancellationRequested(execution)) {
        await heartbeat.stop();
        heartbeat.throwIfFailed();
        try {
          await dependencies.persistence.recordCancellation(execution, lastCounters);
        } catch (persistenceError) {
          persistenceDeferralRequested = true;
          dependencies.onError?.(terminalPersistenceError(persistenceError), contract);
          await delivery.defer(PERSISTENCE_DEFERRAL_MS);
        }
        return;
      }

      const result = await dependencies.executor.execute(execution, {
        signal: executionSignal(delivery.signal, heartbeat.signal),
        async reportProgress(counters) {
          const validated = crawlProgressCountersSchema.parse(counters);
          lastCounters = validated;
          await dependencies.persistence.recordProgress(execution, validated);
        },
        isCancellationRequested: () => dependencies.persistence.isCancellationRequested(execution),
      });
      const counters = crawlProgressCountersSchema.parse(result.counters);
      lastCounters = counters;

      heartbeat.throwIfFailed();
      if (isDeliveryAborted(delivery.signal)) throw interruptionError();
      if (result.status === "cancelled") {
        if (!(await dependencies.persistence.isCancellationRequested(execution))) {
          throw interruptionError();
        }
        if (isDeliveryAborted(delivery.signal)) throw interruptionError();
        await heartbeat.stop();
        heartbeat.throwIfFailed();
        try {
          await dependencies.persistence.recordCancellation(execution, counters);
        } catch (persistenceError) {
          persistenceDeferralRequested = true;
          dependencies.onError?.(terminalPersistenceError(persistenceError), contract);
          await delivery.defer(PERSISTENCE_DEFERRAL_MS);
        }
        return;
      }

      await heartbeat.stop();
      heartbeat.throwIfFailed();
      try {
        await dependencies.persistence.recordCompletion(execution, {
          status: result.status,
          counters,
        });
      } catch (persistenceError) {
        persistenceDeferralRequested = true;
        dependencies.onError?.(terminalPersistenceError(persistenceError), contract);
        await delivery.defer(PERSISTENCE_DEFERRAL_MS);
      }
    } catch (error) {
      await heartbeat.stop();
      if (persistenceDeferralRequested) throw error;
      const effectiveError = heartbeat.failure ?? error;
      if (
        heartbeat.failure === undefined &&
        (isDeliveryAborted(delivery.signal) ||
          (effectiveError instanceof CrawlExecutionError &&
            effectiveError.failure.type === "crawl_interrupted"))
      ) {
        const interruption = interruptionError();
        if (attempt >= delivery.maxAttempts) {
          const finalStatus = lastCounters.succeeded > 0 ? "partially_completed" : "failed";
          try {
            await dependencies.persistence.recordFailure(execution, {
              attempt,
              errorType: interruption.failure.type,
              errorMessage: interruption.failure.safeMessage,
              retryable: true,
              terminal: true,
              finalStatus,
              deadLetter: deadLetterFor(contract, delivery, interruption.failure, finalStatus),
            });
          } catch (persistenceError) {
            dependencies.onError?.(terminalPersistenceError(persistenceError), contract);
            await delivery.defer(PERSISTENCE_DEFERRAL_MS);
          }
        } else {
          try {
            await dependencies.persistence.checkpointInterruption(execution, {
              attempt,
              reason:
                delivery.signal?.reason === "worker-shutdown" ? "worker-shutdown" : "queue-abort",
            });
          } catch (persistenceError) {
            dependencies.onError?.(terminalPersistenceError(persistenceError), contract);
            await delivery.defer(PERSISTENCE_DEFERRAL_MS);
          }
        }
        dependencies.onError?.(interruption, contract);
        throw interruption;
      }

      const failure = classifyCrawlFailure(effectiveError);
      dependencies.onError?.(new CrawlExecutionError(failure), contract);
      const terminal = !failure.retryable || attempt >= delivery.maxAttempts;
      const finalStatus = terminal
        ? failure.partial || lastCounters.succeeded > 0
          ? "partially_completed"
          : "failed"
        : null;
      try {
        await dependencies.persistence.recordFailure(execution, {
          attempt,
          errorType: failure.type,
          errorMessage: failure.safeMessage,
          retryable: failure.retryable,
          terminal,
          finalStatus,
          deadLetter:
            finalStatus === null ? null : deadLetterFor(contract, delivery, failure, finalStatus),
        });
      } catch (persistenceError) {
        dependencies.onError?.(terminalPersistenceError(persistenceError), contract);
        await delivery.defer(PERSISTENCE_DEFERRAL_MS);
      }

      if (!failure.retryable) {
        throw new UnrecoverableCrawlJobError(failure.safeMessage);
      }
      throw new CrawlExecutionError(failure);
    }
  };
}
