import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabaseClient } from "./client.js";
import type { DatabaseConfig } from "./config.js";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(config: DatabaseConfig): Promise<void> {
  const client = createDatabaseClient(config);

  try {
    await migrate(client.db, { migrationsFolder });
  } finally {
    await client.close();
  }
}
