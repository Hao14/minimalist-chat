import { describe, expect, it } from "vitest";

describe("database package import", () => {
  it("loads without opening a connection", async () => {
    const database = await import("@searvia/database");

    expect(typeof database.parseDatabaseConfig).toBe("function");
    expect(typeof database.createDatabaseClient).toBe("function");
  });
});
