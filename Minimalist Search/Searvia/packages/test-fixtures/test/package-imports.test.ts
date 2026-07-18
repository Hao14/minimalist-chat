import { auditEngineFoundation } from "@searvia/audit-engine";
import { configFoundation } from "@searvia/config";
import { parseClientEnvironment } from "@searvia/config/client";
import { parseServerEnvironment } from "@searvia/config/server";
import { parseWorkerEnvironment } from "@searvia/config/worker";
import { createSafeHttpClient } from "@searvia/crawler-core";
import { createServiceLogger } from "@searvia/logging";
import { providerAdaptersFoundation } from "@searvia/provider-adapters";
import { calculateScoreCoverage } from "@searvia/scoring";
import { FoundationStatus } from "@searvia/ui";
import { describe, expect, it } from "vitest";

import { identifyTestFixture } from "../src/index.js";

describe("foundation package imports", () => {
  it("loads every package in the worker/runtime foundation slice", () => {
    expect(auditEngineFoundation.milestone).toBe("M0");
    expect(configFoundation.entryPoints).toContain("worker");
    expect(typeof parseClientEnvironment).toBe("function");
    expect(typeof parseServerEnvironment).toBe("function");
    expect(typeof parseWorkerEnvironment).toBe("function");
    expect(typeof createSafeHttpClient).toBe("function");
    expect(typeof createServiceLogger).toBe("function");
    expect(providerAdaptersFoundation.liveAdapters).toBe(0);
    expect(typeof calculateScoreCoverage).toBe("function");
    expect(typeof FoundationStatus).toBe("function");
    expect(identifyTestFixture("import-smoke").synthetic).toBe(true);
  });
});
