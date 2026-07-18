import { z } from "zod";

const postgresUrlSchema = z
  .url()
  .refine(
    (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
    "DATABASE_URL must use the postgres or postgresql protocol",
  );

const databaseEnvironmentSchema = z.object({
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(10_000),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DATABASE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(15_000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(15_000),
  DATABASE_URL: postgresUrlSchema,
});

export interface DatabaseConfig {
  readonly applicationName: string;
  readonly connectionString: string;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
  readonly max: number;
  readonly queryTimeoutMillis: number;
  readonly statementTimeoutMillis: number;
}

export function parseDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>>,
  applicationName = "searvia",
): DatabaseConfig {
  const parsed = databaseEnvironmentSchema.parse(environment);

  return {
    applicationName,
    connectionString: parsed.DATABASE_URL,
    connectionTimeoutMillis: parsed.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: parsed.DATABASE_IDLE_TIMEOUT_MS,
    max: parsed.DATABASE_POOL_MAX,
    queryTimeoutMillis: parsed.DATABASE_QUERY_TIMEOUT_MS,
    statementTimeoutMillis: parsed.DATABASE_STATEMENT_TIMEOUT_MS,
  };
}
