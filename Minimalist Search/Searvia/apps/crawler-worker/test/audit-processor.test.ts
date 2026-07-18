import type { AuditCrawlSnapshot } from "@searvia/audit-engine";
import { DatabaseDomainError } from "@searvia/database";
import type { AuditEvaluateJob } from "@searvia/shared-types";
import { describe, expect, it, vi } from "vitest";

import {
  createAuditJobProcessor,
  type AuditEvaluationReportPersistenceInput,
  type AuditEvaluationPersistencePort,
} from "../src/audit-processor.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const CRAWL_ID = "00000000-0000-4000-8000-000000000003";
const FINISHED_AT = "2026-07-16T17:00:00.000Z";

function snapshot(overrides: Partial<AuditCrawlSnapshot> = {}): AuditCrawlSnapshot {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    crawlId: CRAWL_ID,
    origin: "https://example.com",
    status: "completed",
    startedAt: "2026-07-16T16:59:00.000Z",
    finishedAt: FINISHED_AT,
    errorType: null,
    configuration: {
      maxDepth: 3,
      redirectLimit: 5,
      maxResponseBytes: 5_000_000,
      queryPolicy: "ignore_tracking",
    },
    pages: [],
    robots: [],
    sitemaps: [],
    historicalRedirects: [],
    historicalRedirectCoverage: {
      complete: true,
      truncated: false,
      pageObservationLimit: 10_000,
      loadedPageObservationCount: 0,
      loadedCrawlCount: 0,
    },
    ...overrides,
  };
}

function contract(): AuditEvaluateJob {
  return {
    contractVersion: 1,
    jobType: "audit.evaluate",
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    crawlId: CRAWL_ID,
    traceId: "trace-12345678",
    idempotencyKey: `audit-${CRAWL_ID}`,
    crawlStatus: "completed",
    crawlFinishedAt: FINISHED_AT,
  };
}

function delivery() {
  return {
    queueJobId: `audit-${CRAWL_ID}`,
    attemptsMade: 0,
    attemptsStarted: 1,
    maxAttempts: 4,
    signal: undefined,
    defer: async (): Promise<never> => {
      throw new Error("Not used by audit evaluation.");
    },
  };
}

class FakePersistence implements AuditEvaluationPersistencePort {
  readonly reports: AuditEvaluationReportPersistenceInput[] = [];
  readonly terminalRunLookups: Array<{
    organizationId: string;
    projectId: string;
    crawlId: string;
  }> = [];
  currentSnapshot = snapshot();
  terminalEvaluationRunExists = false;
  terminalEvaluationRunResponses: boolean[] = [];
  persistError: unknown;

  async loadAuditSnapshot(): Promise<AuditCrawlSnapshot> {
    return this.currentSnapshot;
  }

  async hasTerminalEvaluationRun(scope: {
    organizationId: string;
    projectId: string;
    crawlId: string;
  }): Promise<boolean> {
    this.terminalRunLookups.push(scope);
    return this.terminalEvaluationRunResponses.shift() ?? this.terminalEvaluationRunExists;
  }

  async persistEvaluationReport(input: AuditEvaluationReportPersistenceInput): Promise<void> {
    if (this.persistError !== undefined) throw this.persistError;
    this.reports.push(input);
  }
}

describe("audit evaluation worker stage", () => {
  it("evaluates and persists all 130 active rules from one immutable completed crawl", async () => {
    const persistence = new FakePersistence();
    const processor = createAuditJobProcessor({ persistence });

    await processor(contract(), delivery());

    expect(persistence.reports).toHaveLength(1);
    expect(persistence.terminalRunLookups).toEqual([
      { organizationId: ORGANIZATION_ID, projectId: PROJECT_ID, crawlId: CRAWL_ID },
    ]);
    const report = persistence.reports[0];
    expect(report?.engineVersion).toBe(1);
    expect(report?.definitions).toHaveLength(130);
    expect(report?.results.length).toBeGreaterThanOrEqual(130);
    expect(
      report?.results.every(
        (result) => result.eligibility === "eligible" || result.status === "not-checked",
      ),
    ).toBe(true);
    expect(
      report?.results
        .filter((result) => result.status === "not-checked")
        .every(
          (result) =>
            result.confidence === null &&
            Array.isArray(result.missingData) &&
            typeof result.notEvaluatedReason === "string" &&
            result.notEvaluatedReason.length > 0,
        ),
    ).toBe(true);
  });

  it("acknowledges a retry for an already persisted terminal run without reevaluating", async () => {
    const persistence = new FakePersistence();
    persistence.terminalEvaluationRunExists = true;
    const evaluate = vi.fn(() => {
      throw new Error("A persisted crawl must not be reevaluated with the active catalog.");
    });
    const processor = createAuditJobProcessor({ persistence, evaluate });

    await expect(processor(contract(), delivery())).resolves.toBeUndefined();

    expect(persistence.terminalRunLookups).toEqual([
      { organizationId: ORGANIZATION_ID, projectId: PROJECT_ID, crawlId: CRAWL_ID },
    ]);
    expect(evaluate).not.toHaveBeenCalled();
    expect(persistence.reports).toHaveLength(0);
  });

  it("fails closed when persistence reports an immutable-report conflict", async () => {
    const persistence = new FakePersistence();
    persistence.terminalEvaluationRunResponses.push(false, true);
    persistence.persistError = new DatabaseDomainError("CONFLICT", "immutable report conflict");
    const processor = createAuditJobProcessor({ persistence });

    await expect(processor(contract(), delivery())).rejects.toThrow("immutable report conflict");

    expect(persistence.terminalRunLookups).toEqual([
      { organizationId: ORGANIZATION_ID, projectId: PROJECT_ID, crawlId: CRAWL_ID },
    ]);
    expect(persistence.reports).toHaveLength(0);
  });

  it("does not suppress a non-conflict persistence failure", async () => {
    const persistence = new FakePersistence();
    persistence.terminalEvaluationRunResponses.push(false, true);
    persistence.persistError = Object.assign(new Error("database connection lost"), {
      code: "CONFLICT",
    });
    const processor = createAuditJobProcessor({ persistence });

    await expect(processor(contract(), delivery())).rejects.toThrow("database connection lost");

    expect(persistence.terminalRunLookups).toHaveLength(1);
    expect(persistence.reports).toHaveLength(0);
  });

  it("fails closed before persistence when the loaded tenant scope does not match", async () => {
    const persistence = new FakePersistence();
    persistence.currentSnapshot = snapshot({ organizationId: crypto.randomUUID() });
    const onError = vi.fn();
    const processor = createAuditJobProcessor({ persistence, onError });

    await expect(processor(contract(), delivery())).rejects.toThrow("tenant scope");
    expect(persistence.terminalRunLookups).toHaveLength(0);
    expect(persistence.reports).toHaveLength(0);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("rejects a stale terminal-snapshot timestamp and deterministic queue ID", async () => {
    const persistence = new FakePersistence();
    const processor = createAuditJobProcessor({ persistence });

    await expect(
      processor({ ...contract(), crawlFinishedAt: "2026-07-16T17:00:01.000Z" }, delivery()),
    ).rejects.toThrow("timestamp");
    await expect(
      processor(contract(), { ...delivery(), queueJobId: crypto.randomUUID() }),
    ).rejects.toThrow("queue job ID");
    expect(persistence.terminalRunLookups).toHaveLength(0);
    expect(persistence.reports).toHaveLength(0);
  });
});
