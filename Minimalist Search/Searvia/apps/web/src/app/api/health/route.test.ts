import { describe, expect, it } from "vitest";

import { GET, HEALTH_PAYLOAD } from "./route";

describe("GET /api/health", () => {
  it("returns a cache-disabled liveness response", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(HEALTH_PAYLOAD);
  });
});
