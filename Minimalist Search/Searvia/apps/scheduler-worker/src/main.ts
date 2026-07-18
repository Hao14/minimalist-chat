import { createWorkerDatabaseRuntime } from "@searvia/database/workers";
import { createServiceLogger, toSafeErrorMetadata } from "@searvia/logging";

import { startOutboxPublisherApplication } from "./bootstrap.js";
import { createDatabaseOutboxPersistence } from "./database-adapter.js";
import { createWorkerStartupConfiguration } from "./startup.js";

const environment = createWorkerStartupConfiguration();
const logger = createServiceLogger({
  service: environment.service,
  environment: environment.nodeEnv,
  level: environment.logLevel,
});
const databaseRuntime = createWorkerDatabaseRuntime(process.env, environment.service);
const persistence = createDatabaseOutboxPersistence(databaseRuntime.repository, databaseRuntime);

try {
  await databaseRuntime.checkHealth();
  await startOutboxPublisherApplication({ persistence });
} catch (error) {
  logger.fatal(
    {
      event: "outbox.publisher.startup.failed",
      status: "unhealthy",
      ...toSafeErrorMetadata(error),
    },
    "Outbox publisher startup failed.",
  );
  process.exitCode = 1;
  await persistence.close?.();
}
