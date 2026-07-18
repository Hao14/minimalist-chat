import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";

import { createServiceLogger, toSafeErrorMetadata } from "@searvia/logging";

import { createWorkerStartupConfiguration } from "./startup.js";

const environment = createWorkerStartupConfiguration();
const logger = createServiceLogger({
  service: environment.service,
  environment: environment.nodeEnv,
  level: environment.logLevel,
});
const traceId = randomUUID();
const redis = new Redis(environment.redisUrl, {
  connectTimeout: environment.redisConnectTimeoutMs,
  enableOfflineQueue: false,
  enableReadyCheck: false,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => (attempt <= 3 ? Math.min(attempt * 250, 1_000) : null),
});

let healthTimer: NodeJS.Timeout | undefined;
let healthCheckInFlight = false;
let shutdownPromise: Promise<void> | undefined;

redis.on("error", (error) => {
  logger.warn(
    {
      event: "worker.redis.error",
      traceId,
      ...toSafeErrorMetadata(error),
    },
    "Redis emitted an error.",
  );
});

async function checkHealth(throwOnFailure = false): Promise<void> {
  if (healthCheckInFlight) return;
  healthCheckInFlight = true;
  const checkedAt = new Date().toISOString();

  try {
    const response = await redis.ping();
    if (response !== "PONG") {
      throw new Error("Redis health check returned an unexpected response.");
    }

    logger.info(
      {
        event: "worker.health",
        traceId,
        status: "healthy",
        checkedAt,
        dependencies: {
          redis: { status: "healthy", checkedAt },
        },
      },
      "Worker is healthy.",
    );
  } catch (error) {
    logger.error(
      {
        event: "worker.health",
        traceId,
        status: "unhealthy",
        checkedAt,
        dependencies: {
          redis: { status: "unhealthy", checkedAt },
        },
        ...toSafeErrorMetadata(error),
      },
      "Worker health check failed.",
    );
    if (throwOnFailure) throw error;
  } finally {
    healthCheckInFlight = false;
  }
}

async function closeRedis(): Promise<void> {
  if (redis.status === "ready") {
    await redis.quit();
    return;
  }

  redis.disconnect(false);
}

function shutdown(signal: NodeJS.Signals | "startup-failure"): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    if (healthTimer) clearInterval(healthTimer);

    logger.info(
      {
        event: "worker.shutdown.started",
        traceId,
        signal,
        status: "stopping",
      },
      "Worker shutdown started.",
    );

    let timeout: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        closeRedis(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Worker shutdown timed out.")),
            environment.shutdownTimeoutMs,
          );
        }),
      ]);

      logger.info(
        {
          event: "worker.shutdown.completed",
          traceId,
          signal,
          status: "stopped",
        },
        "Worker shutdown completed.",
      );
    } catch (error) {
      redis.disconnect(false);
      process.exitCode = 1;
      logger.error(
        {
          event: "worker.shutdown.failed",
          traceId,
          signal,
          status: "unhealthy",
          ...toSafeErrorMetadata(error),
        },
        "Worker shutdown failed.",
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  })();

  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

logger.info(
  {
    event: "worker.starting",
    traceId,
    status: "starting",
    capability: "foundation-only",
  },
  "Worker is starting. No job consumer is configured in M0.",
);

try {
  await redis.connect();
  await checkHealth(true);
  healthTimer = setInterval(() => {
    void checkHealth();
  }, environment.healthIntervalMs);
} catch (error) {
  logger.fatal(
    {
      event: "worker.startup.failed",
      traceId,
      status: "unhealthy",
      ...toSafeErrorMetadata(error),
    },
    "Worker startup failed.",
  );
  process.exitCode = 1;
  await shutdown("startup-failure");
}
