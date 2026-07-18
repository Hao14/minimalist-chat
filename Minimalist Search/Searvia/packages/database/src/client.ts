import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import type { DatabaseConfig } from "./config.js";
import { searviaSchema } from "./schema.js";

export type SearviaDatabase = NodePgDatabase<typeof searviaSchema>;

export interface Queryable {
  query(queryText: string): Promise<unknown>;
}

export interface DatabaseHealth {
  readonly latencyMs: number;
  readonly status: "ok";
}

export interface DatabaseClient {
  readonly db: SearviaDatabase;
  readonly pool: Pool;
  checkHealth(): Promise<DatabaseHealth>;
  close(): Promise<void>;
}

export function toPoolConfig(config: DatabaseConfig): PoolConfig {
  return {
    application_name: config.applicationName,
    connectionString: config.connectionString,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    idleTimeoutMillis: config.idleTimeoutMillis,
    max: config.max,
    query_timeout: config.queryTimeoutMillis,
    statement_timeout: config.statementTimeoutMillis,
  };
}

export async function checkDatabaseHealth(queryable: Queryable): Promise<DatabaseHealth> {
  const startedAt = performance.now();
  await queryable.query("select 1");

  return {
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    status: "ok",
  };
}

export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
  const pool = new Pool(toPoolConfig(config));
  const db = drizzle(pool, { schema: searviaSchema });

  return {
    db,
    pool,
    checkHealth: () => checkDatabaseHealth(pool),
    close: () => pool.end(),
  };
}
