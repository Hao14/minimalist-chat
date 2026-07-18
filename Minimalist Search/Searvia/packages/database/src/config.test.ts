import { describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "./config.js";

describe("parseDatabaseConfig", () => {
  it("uses safe pool defaults", () => {
    expect(
      parseDatabaseConfig({ DATABASE_URL: "postgresql://user:password@localhost:5432/searvia" }),
    ).toEqual({
      applicationName: "searvia",
      connectionString: "postgresql://user:password@localhost:5432/searvia",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      max: 10,
      queryTimeoutMillis: 15_000,
      statementTimeoutMillis: 15_000,
    });
  });

  it("rejects missing and non-PostgreSQL connection URLs", () => {
    expect(() => parseDatabaseConfig({})).toThrow();
    expect(() => parseDatabaseConfig({ DATABASE_URL: "redis://localhost:6379" })).toThrow(
      "DATABASE_URL",
    );
  });
});
