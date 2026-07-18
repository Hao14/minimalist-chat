import "server-only";

import { parseServerEnvironment } from "@searvia/config/server";
import {
  createDatabaseClient,
  createSearviaCrawlRepository,
  createSearviaRepository,
  type DatabaseClient,
  type SearviaCrawlRepository,
  type SearviaRepository,
} from "@searvia/database/runtime";

interface DatabaseSingleton {
  client?: DatabaseClient;
  crawlRepository?: SearviaCrawlRepository;
  repository?: SearviaRepository;
}

const databaseSingleton = globalThis as typeof globalThis & {
  __searviaDatabase?: DatabaseSingleton;
};

function singleton(): DatabaseSingleton {
  databaseSingleton.__searviaDatabase ??= {};
  return databaseSingleton.__searviaDatabase;
}

export function getDatabaseClient(): DatabaseClient {
  const state = singleton();

  if (state.client === undefined) {
    const environment = parseServerEnvironment(process.env);
    state.client = createDatabaseClient({
      applicationName: "searvia-web",
      connectionString: environment.databaseUrl,
      connectionTimeoutMillis: environment.databaseConnectionTimeoutMs,
      idleTimeoutMillis: environment.databaseIdleTimeoutMs,
      max: environment.databasePoolMax,
      queryTimeoutMillis: environment.databaseQueryTimeoutMs,
      statementTimeoutMillis: environment.databaseStatementTimeoutMs,
    });
  }

  return state.client;
}

export function getSearviaRepository(): SearviaRepository {
  const state = singleton();
  state.repository ??= createSearviaRepository(getDatabaseClient().db);
  return state.repository;
}

export function getSearviaCrawlRepository(): SearviaCrawlRepository {
  const state = singleton();
  state.crawlRepository ??= createSearviaCrawlRepository(getDatabaseClient().db);
  return state.crawlRepository;
}
