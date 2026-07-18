import { createWorkerDatabaseRuntime } from "@searvia/database/workers";
import { createServiceLogger, toSafeErrorMetadata } from "@searvia/logging";

import { startCrawlerWorkerApplication } from "./bootstrap.js";
import type { AuditEvaluationPersistencePort } from "./audit-processor.js";
import { createS3CompatiblePageArtifactStore } from "./artifact-storage.js";
import { SafeDatabaseCrawlExecutor } from "./crawl-executor.js";
import { DatabaseCrawlProcessingPersistence } from "./database-adapter.js";
import {
  createPlaywrightBrowserEngine,
  type PlaywrightChromiumLauncherPort,
} from "./playwright-adapter.js";
import { BoundedBrowserRenderer } from "./renderer.js";
import { createWorkerStartupConfiguration } from "./startup.js";

const environment = createWorkerStartupConfiguration();
const logger = createServiceLogger({
  service: environment.service,
  environment: environment.nodeEnv,
  level: environment.logLevel,
});
const databaseRuntime = createWorkerDatabaseRuntime(process.env, environment.service);
const repository = databaseRuntime.repository;
const auditPersistence: AuditEvaluationPersistencePort = {
  loadAuditSnapshot: (scope) => databaseRuntime.loadAuditCrawlSnapshot(scope),
  hasTerminalEvaluationRun: (scope) => databaseRuntime.hasTerminalAuditEvaluationRun(scope),
  persistEvaluationReport: (input) => databaseRuntime.persistAuditEvaluationReport(input),
};
const persistence = new DatabaseCrawlProcessingPersistence(
  repository,
  databaseRuntime,
  environment,
);
let executor: SafeDatabaseCrawlExecutor | undefined;

function isPlaywrightChromiumLauncher(value: unknown): value is PlaywrightChromiumLauncherPort {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "launch") === "function"
  );
}

async function loadPlaywrightChromium(): Promise<PlaywrightChromiumLauncherPort> {
  const moduleName: string = "playwright-core";
  const loaded: unknown = await import(moduleName);
  if (typeof loaded !== "object" || loaded === null) {
    throw new TypeError("The Playwright module did not expose a Chromium launcher.");
  }
  const chromium: unknown = Reflect.get(loaded, "chromium");
  if (!isPlaywrightChromiumLauncher(chromium)) {
    throw new TypeError("The Playwright module did not expose a Chromium launcher.");
  }
  return chromium;
}

try {
  const artifactStore = createS3CompatiblePageArtifactStore({
    endpoint: environment.objectStorageEndpoint,
    region: environment.objectStorageRegion,
    bucket: environment.objectStorageBucket,
    accessKey: environment.objectStorageAccessKey,
    secretKey: environment.objectStorageSecretKey,
    ...(environment.objectStorageSessionToken === undefined
      ? {}
      : { sessionToken: environment.objectStorageSessionToken }),
    forcePathStyle: environment.objectStorageForcePathStyle,
    requestTimeoutMs: environment.objectStorageRequestTimeoutMs,
    maxHtmlBytes: environment.artifactMaxHtmlBytes,
  });
  const renderer = environment.renderingEnabled
    ? new BoundedBrowserRenderer(createPlaywrightBrowserEngine(await loadPlaywrightChromium()), {
        executablePath: environment.renderingBrowserExecutable ?? "",
        timeoutMs: environment.renderingTimeoutMs,
        settleTimeoutMs: environment.renderingSettleTimeoutMs,
        quietWindowMs: environment.renderingQuietWindowMs,
        maxRawHtmlBytes: environment.renderingMaxRawHtmlBytes,
        maxRenderedHtmlBytes: environment.renderingMaxHtmlBytes,
        maxBlockedRequests: environment.renderingMaxBlockedRequests,
        maxMemoryMb: environment.renderingBrowserMemoryMb,
        closeTimeoutMs: environment.renderingCloseTimeoutMs,
      })
    : undefined;
  executor = new SafeDatabaseCrawlExecutor(repository, persistence, {
    artifactStore,
    workerRenderingEnabled: environment.renderingEnabled,
    ...(renderer === undefined ? {} : { renderer }),
  });
  await databaseRuntime.checkHealth();
  await startCrawlerWorkerApplication({
    persistence,
    executor,
    auditPersistence,
    onProcessingError(error) {
      logger.warn(
        {
          event: "crawl.processing.failed",
          ...toSafeErrorMetadata(error),
        },
        "A crawl processing attempt failed.",
      );
    },
    onAuditProcessingError(error) {
      logger.warn(
        {
          event: "audit.processing.failed",
          ...toSafeErrorMetadata(error),
        },
        "An audit evaluation attempt failed.",
      );
    },
  });
} catch (error) {
  logger.fatal(
    {
      event: "crawl.worker.startup.failed",
      status: "unhealthy",
      ...toSafeErrorMetadata(error),
    },
    "Crawler worker startup failed.",
  );
  process.exitCode = 1;
  try {
    await executor?.close();
  } finally {
    await persistence.close();
  }
}
