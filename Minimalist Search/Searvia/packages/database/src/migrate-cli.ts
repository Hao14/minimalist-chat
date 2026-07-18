import { parseDatabaseConfig } from "./config.js";
import { runMigrations } from "./migrations.js";

const config = parseDatabaseConfig(process.env, "searvia-migrations");

await runMigrations(config);
process.stdout.write(
  `${JSON.stringify({ event: "database.migrations.complete", service: "database" })}\n`,
);
