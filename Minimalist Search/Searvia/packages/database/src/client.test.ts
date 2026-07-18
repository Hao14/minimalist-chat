import { describe, expect, it, vi } from "vitest";

import { checkDatabaseHealth, toPoolConfig } from "./client.js";

describe("database client configuration", () => {
  it("maps validated configuration to pg without exposing additional values", () => {
    expect(
      toPoolConfig({
        applicationName: "test",
        connectionString: "postgresql://user:password@localhost:5432/searvia",
        connectionTimeoutMillis: 500,
        idleTimeoutMillis: 1_000,
        max: 2,
        queryTimeoutMillis: 2_000,
        statementTimeoutMillis: 3_000,
      }),
    ).toEqual({
      application_name: "test",
      connectionString: "postgresql://user:password@localhost:5432/searvia",
      connectionTimeoutMillis: 500,
      idleTimeoutMillis: 1_000,
      max: 2,
      query_timeout: 2_000,
      statement_timeout: 3_000,
    });
  });

  it("runs a minimal health query", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });

    await expect(checkDatabaseHealth({ query })).resolves.toMatchObject({ status: "ok" });
    expect(query).toHaveBeenCalledWith("select 1");
  });
});
