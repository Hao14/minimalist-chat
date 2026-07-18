import type { WorkerEnvironment } from "@searvia/config/worker";
import type { CrawlProgressCounters } from "@searvia/shared-types";
import type {
  CrawlWorkerRepository,
  WorkerDatabaseRuntime,
  WorkerExecutionContext,
  WorkerResumableFrontierEntry,
} from "@searvia/database/workers";

import type {
  AuthorizedCrawlExecution,
  CrawlClaimResult,
  CrawlProcessingPersistencePort,
} from "./processor.js";

export class DatabaseCrawlProcessingPersistence implements CrawlProcessingPersistencePort {
  readonly #databaseRuntime: WorkerDatabaseRuntime;
  readonly #executionStates = new WeakMap<
    AuthorizedCrawlExecution,
    Readonly<{ context: WorkerExecutionContext; initialCounters: CrawlProgressCounters }>
  >();
  readonly #leaseMs: number;
  readonly #repository: CrawlWorkerRepository;
  #closePromise: Promise<void> | undefined;

  get executionLeaseHeartbeatMs(): number {
    return Math.max(1_000, Math.floor(this.#leaseMs / 3));
  }

  constructor(
    repository: CrawlWorkerRepository,
    databaseRuntime: WorkerDatabaseRuntime,
    environment: Pick<WorkerEnvironment, "crawlExecutionLeaseMs">,
  ) {
    this.#repository = repository;
    this.#databaseRuntime = databaseRuntime;
    this.#leaseMs = environment.crawlExecutionLeaseMs;
  }

  contextFor(execution: AuthorizedCrawlExecution): WorkerExecutionContext {
    const state = this.#executionStates.get(execution);
    if (state === undefined) {
      throw new Error("The crawl execution is not associated with an active database lease.");
    }
    return state.context;
  }

  initialCountersFor(execution: AuthorizedCrawlExecution): CrawlProgressCounters {
    const state = this.#executionStates.get(execution);
    if (state === undefined) {
      throw new Error("The crawl execution is not associated with an active database lease.");
    }
    return state.initialCounters;
  }

  resumableFrontierFor(
    execution: AuthorizedCrawlExecution,
    limit: number,
  ): Promise<readonly WorkerResumableFrontierEntry[]> {
    return this.#repository.listResumableFrontier(this.contextFor(execution), limit);
  }

  async claimExecution(
    input: Parameters<CrawlProcessingPersistencePort["claimExecution"]>[0],
  ): Promise<CrawlClaimResult> {
    const claim = await this.#repository.claimExecution({
      organizationId: input.contract.organizationId,
      projectId: input.contract.projectId,
      crawlId: input.contract.crawlId,
      queueJobId: input.queueJobId,
      requestedByMembershipId: input.contract.requestedByMembershipId,
      traceId: input.contract.traceId,
      idempotencyKey: input.contract.idempotencyKey,
      estimatedPages: input.contract.estimatedPages,
      leaseMs: this.#leaseMs,
    });

    if (claim.kind === "terminal") return Object.freeze({ state: "terminal" });
    if (claim.kind === "cancelled") return Object.freeze({ state: "cancelled" });
    if (claim.kind === "busy") {
      return Object.freeze({ state: "busy", retryAfterMs: claim.retryAfterMs });
    }

    const execution: AuthorizedCrawlExecution = Object.freeze({
      organizationId: claim.crawl.organizationId,
      projectId: claim.crawl.projectId,
      crawlId: claim.crawl.crawlId,
      configuration: claim.crawl.config,
      initialCounters: Object.freeze({ ...claim.crawl.counters }),
    });
    this.#executionStates.set(
      execution,
      Object.freeze({
        context: Object.freeze({
          organizationId: claim.crawl.organizationId,
          projectId: claim.crawl.projectId,
          crawlId: claim.crawl.crawlId,
          executionToken: claim.executionToken,
        }),
        initialCounters: Object.freeze({ ...claim.crawl.counters }),
      }),
    );
    return Object.freeze({ state: "claimed", execution });
  }

  async recordPreClaimFailure(
    input: Parameters<CrawlProcessingPersistencePort["recordPreClaimFailure"]>[0],
  ): ReturnType<CrawlProcessingPersistencePort["recordPreClaimFailure"]> {
    const result = await this.#repository.reconcilePreClaimFailure({
      organizationId: input.contract.organizationId,
      projectId: input.contract.projectId,
      crawlId: input.contract.crawlId,
      queueJobId: input.queueJobId,
      requestedByMembershipId: input.contract.requestedByMembershipId,
      traceId: input.contract.traceId,
      idempotencyKey: input.contract.idempotencyKey,
      estimatedPages: input.contract.estimatedPages,
      attemptsMade: input.attempt,
      errorType: input.errorType,
      errorMessage: input.errorMessage,
      terminal: input.terminal,
    });

    if (result.kind === "busy") {
      return Object.freeze({ state: "busy", retryAfterMs: result.retryAfterMs });
    }
    if (result.kind === "failed") {
      return Object.freeze({ state: "failed", finalStatus: result.status });
    }
    return Object.freeze({ state: result.kind });
  }

  isCancellationRequested(execution: AuthorizedCrawlExecution): Promise<boolean> {
    const context = this.contextFor(execution);
    return this.#repository.isCancellationRequested(
      context.organizationId,
      context.projectId,
      context.crawlId,
      context.executionToken,
    );
  }

  async renewExecutionLease(execution: AuthorizedCrawlExecution): Promise<void> {
    const renewed = await this.#repository.renewExecutionLease(
      this.contextFor(execution),
      this.#leaseMs,
    );
    if (!renewed) {
      throw new Error("The crawl execution lease is no longer active.");
    }
  }

  recordProgress(
    execution: AuthorizedCrawlExecution,
    counters: Parameters<CrawlProcessingPersistencePort["recordProgress"]>[1],
  ): Promise<void> {
    return this.#repository.recordExecutionProgress(
      this.contextFor(execution),
      counters,
      this.#leaseMs,
    );
  }

  async recordCompletion(
    execution: AuthorizedCrawlExecution,
    input: Parameters<CrawlProcessingPersistencePort["recordCompletion"]>[1],
  ): Promise<void> {
    const context = this.contextFor(execution);
    await this.#repository.recordExecutionProgress(context, input.counters, this.#leaseMs);
    await this.#repository.completeExecution(context, {
      status: input.status,
      completionReason:
        input.status === "completed" ? "frontier_exhausted" : "frontier_exhausted_with_failures",
    });
  }

  async recordCancellation(
    execution: AuthorizedCrawlExecution,
    counters: Parameters<CrawlProcessingPersistencePort["recordCancellation"]>[1],
  ): Promise<void> {
    const context = this.contextFor(execution);
    await this.#repository.recordExecutionProgress(context, counters, this.#leaseMs);
    await this.#repository.completeExecution(context, {
      status: "cancelled",
      completionReason: "cancelled_by_user",
    });
  }

  async recordFailure(
    execution: AuthorizedCrawlExecution,
    input: Parameters<CrawlProcessingPersistencePort["recordFailure"]>[1],
  ): Promise<void> {
    const context = this.contextFor(execution);
    if (!input.terminal) {
      await this.#repository.releaseExecutionForRetry(context, input.errorType, input.errorMessage);
      return;
    }

    if (input.deadLetter === null || input.finalStatus === null) {
      throw new Error("A terminal crawl failure requires a typed dead-letter contract.");
    }
    await this.#repository.finalizeExecutionFailure(context, {
      errorType: input.errorType,
      errorMessage: input.errorMessage,
      attemptsMade: input.deadLetter.attemptsMade,
      now: new Date(input.deadLetter.failedAt),
    });
  }

  async recordRejectedScope(
    input: Parameters<CrawlProcessingPersistencePort["recordRejectedScope"]>[0],
  ): Promise<void> {
    await this.#repository.recordDeadLetter(
      {
        organizationId: input.contract.organizationId,
        projectId: input.contract.projectId,
        crawlId: input.contract.crawlId,
      },
      {
        errorType: input.errorType,
        errorMessage: input.errorMessage,
        queueJobId: input.queueJobId,
        attemptsMade: input.deadLetter.attemptsMade,
        now: new Date(input.deadLetter.failedAt),
      },
    );
  }

  async checkpointInterruption(
    execution: AuthorizedCrawlExecution,
    input: Parameters<CrawlProcessingPersistencePort["checkpointInterruption"]>[1],
  ): Promise<void> {
    const context = this.contextFor(execution);
    await this.#repository.releaseExecutionForRetry(
      context,
      "crawl_interrupted",
      input.reason === "worker-shutdown"
        ? "The worker shut down before the crawl completed."
        : "Queue processing was interrupted before the crawl completed.",
    );
  }

  close(): Promise<void> {
    this.#closePromise ??= this.#databaseRuntime.close();
    return this.#closePromise;
  }
}
