import { createDatabaseClient } from "./client.js";
import { parseDatabaseConfig } from "./config.js";

const config = parseDatabaseConfig(process.env, "searvia-database-check");
const client = createDatabaseClient(config);

try {
  const health = await client.checkHealth();
  process.stdout.write(
    `${JSON.stringify({ event: "database.health", service: "database", ...health })}\n`,
  );
} finally {
  await client.close();
}
