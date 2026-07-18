import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ACTIVE_AUDIT_RULES,
  M4A_RULES,
  M5_EXPANSION_RULES,
  createActiveAuditEngine,
  createM4AAuditEngine,
} from "../src/catalog.js";
import { ACTIVE_AUDIT_CATALOG_VERSION, M4A_CATALOG_VERSION } from "../src/engine.js";
import {
  extraction,
  historicalRedirect,
  page,
  redirect,
  robots,
  sitemap,
  snapshot,
} from "./fixtures.js";

const ACTIVE_VERSION_OVERRIDES: Readonly<Record<string, number>> = Object.freeze({
  "CRW-001": 4,
  "CRW-002": 4,
  "CRW-003": 4,
  "CRW-004": 3,
  "CRW-005": 3,
  "CRW-007": 3,
  "CRW-008": 3,
  "CRW-009": 3,
  "CRW-010": 4,
  "CRW-011": 4,
  "CRW-012": 5,
  "CRW-013": 3,
  "HTTP-003": 4,
  "HTTP-004": 3,
  "HTTP-005": 4,
  "HTTP-006": 5,
  "HTTP-009": 3,
  "HTTP-010": 3,
  "HTTP-012": 3,
  "HTTP-013": 3,
  "HTTP-015": 3,
  "RSM-004": 3,
  "RSM-005": 3,
  "RSM-007": 3,
  "RSM-008": 3,
  "RSM-009": 3,
  "RSM-010": 3,
  "RSM-011": 3,
  "RSM-012": 3,
  "RSM-013": 3,
  "RSM-014": 5,
  "RSM-015": 5,
  "URL-001": 5,
  "URL-003": 3,
  "URL-004": 3,
  "URL-005": 3,
  "URL-006": 3,
  "URL-007": 3,
  "URL-009": 4,
  "URL-012": 4,
  "URL-013": 4,
  "URL-014": 4,
  "URL-015": 4,
  "URL-016": 4,
  "URL-017": 3,
  "ONS-003": 2,
  "ONS-005": 2,
  "ONS-006": 2,
  "ONS-009": 2,
  "ONS-011": 2,
  "ONS-012": 2,
  "ONS-014": 2,
  "ONS-016": 2,
  "ONS-022": 2,
  "ONS-023": 2,
  "ONS-025": 2,
  "CNT-001": 3,
  "CNT-002": 3,
  "CNT-003": 2,
  "CNT-006": 2,
  "CNT-012": 3,
  "CNT-014": 3,
  "CNT-015": 3,
  "CNT-016": 2,
  "CNT-017": 2,
  "CNT-018": 2,
  "LNK-004": 2,
  "LNK-005": 2,
  "LNK-010": 3,
  "LNK-011": 3,
  "LNK-013": 2,
  "LNK-018": 2,
  "LNK-019": 3,
  "LNK-020": 2,
});

describe("M4A rule catalog", () => {
  it("matches the approved IDs, titles, and default severities in AUDIT_RULES.md", () => {
    const catalog = readFileSync(new URL("../../../docs/AUDIT_RULES.md", import.meta.url), "utf8");
    const approved = new Map<string, { severity: string; title: string }>();
    for (const match of catalog.matchAll(
      /^(CRW|HTTP|RSM|URL)-(\d{3})\s+\|\s+([A-Za-z-]+)\s+\|\s+(.+)$/gmu,
    )) {
      const [, prefix, number, severity, title] = match;
      if (
        prefix !== undefined &&
        number !== undefined &&
        severity !== undefined &&
        title !== undefined
      ) {
        approved.set(`${prefix}-${number}`, {
          severity: severity.toLowerCase(),
          title: title.trim(),
        });
      }
    }

    expect(approved.size).toBe(65);
    for (const rule of M4A_RULES) {
      expect({ severity: rule.defaultSeverity, title: rule.title }).toEqual(approved.get(rule.id));
    }
  });

  it("registers the complete 65-rule immutable catalog once", () => {
    expect(M4A_CATALOG_VERSION).toBe("m4a-5");
    expect(M4A_RULES).toHaveLength(65);
    expect(new Set(M4A_RULES.map((rule) => `${rule.id}@${String(rule.version)}`)).size).toBe(65);
    expect(M4A_RULES.map((rule) => rule.id)).toEqual([
      ...Array.from({ length: 15 }, (_, index) => `CRW-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 15 }, (_, index) => `HTTP-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 15 }, (_, index) => `RSM-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 20 }, (_, index) => `URL-${String(index + 1).padStart(3, "0")}`),
    ]);
  });

  it.each(M4A_RULES)("keeps the full rule contract for $id", (rule) => {
    expect(rule.version).toBe(ACTIVE_VERSION_OVERRIDES[rule.id] ?? 2);
    expect(rule.deterministic).toBe(true);
    expect(rule.requiredData.length).toBeGreaterThan(0);
    expect(rule.title.trim().length).toBeGreaterThan(0);
    expect(rule.description.trim().length).toBeGreaterThan(0);
    expect(rule.eligibility.trim().length).toBeGreaterThan(0);
    expect(rule.explanation.trim().length).toBeGreaterThan(0);
    expect(rule.expectedValue.trim().length).toBeGreaterThan(0);
    expect(rule.recommendedFix.trim().length).toBeGreaterThan(20);
    expect(rule.verification.trim().length).toBeGreaterThan(10);
    expect(rule.impactAreas.length).toBeGreaterThan(0);
    expect(rule.firstSupportedVersion).toBe("M4A");
  });

  it("pins the active version distribution for the persisted manifest", () => {
    const distribution = Object.fromEntries(
      [2, 3, 4, 5].map((version) => [
        String(version),
        M4A_RULES.filter((rule) => rule.version === version).length,
      ]),
    );

    expect(distribution).toEqual({ "2": 20, "3": 27, "4": 13, "5": 5 });
  });

  it("evaluates every rule deterministically against one completed crawl snapshot", () => {
    const completed = snapshot();
    const engine = createM4AAuditEngine();
    const first = engine.evaluate(completed);
    const repeated = engine.evaluate(completed);

    expect(completed.status).toBe("completed");
    expect(first).toEqual(repeated);
    expect(first.counts.rules).toBe(65);
    expect(first.results.length).toBeGreaterThanOrEqual(65);
    expect(first.results.every((result) => result.evidence.length > 0)).toBe(true);
    expect(
      first.results.every(
        (result) => result.eligibility.state === "eligible" || result.status === "not-checked",
      ),
    ).toBe(true);
  });

  it.each(["completed", "partially_completed"] as const)(
    "evaluates an empty %s crawl without detector failures",
    (status) => {
      const report = createM4AAuditEngine().evaluate(
        snapshot({
          status,
          pages: [],
          robots: [],
          sitemaps: [],
          historicalRedirects: [],
        }),
      );

      expect(report.counts.rules).toBe(65);
      expect(report.failures).toEqual([]);
      expect(report.results.every((result) => result.status === "not-checked")).toBe(true);
    },
  );

  it("never emits injected query or fragment secrets from any catalog result", () => {
    const querySecret = "catalog-query-secret";
    const fragmentSecret = "catalog-fragment-secret";
    const sensitiveUrl = `https://example.com/sensitive?token=${querySecret}#${fragmentSecret}`;
    const completed = snapshot({
      pages: [
        page({
          normalizedUrl: "https://example.com/sensitive",
          requestedUrl: sensitiveUrl,
          finalUrl: sensitiveUrl,
          redirectChain: [
            redirect({
              requestedUrl: sensitiveUrl,
              location: sensitiveUrl,
              resolvedUrl: sensitiveUrl,
            }),
          ],
          errorMessage: `Request detail: ${sensitiveUrl}`,
          extraction: extraction({ canonicalUrl: sensitiveUrl }),
          links: [
            {
              id: "secret-link",
              targetPageId: null,
              targetUrl: sensitiveUrl,
              normalizedTargetUrl: sensitiveUrl,
              scope: "internal",
              relValues: [],
              linkType: "anchor",
              discovered: true,
            },
          ],
          resources: [
            {
              id: "secret-script",
              resourceType: "script",
              sourceUrl: sensitiveUrl,
              normalizedUrl: sensitiveUrl,
              scope: "internal",
              robotsDecision: "allowed",
            },
          ],
        }),
      ],
      robots: [
        robots({
          requestedUrl: sensitiveUrl,
          finalUrl: sensitiveUrl,
          sitemapUrls: [sensitiveUrl],
          content: `User-agent: *\nAllow: /\nSitemap: ${sensitiveUrl}\n`,
        }),
      ],
      sitemaps: [
        sitemap({
          requestedUrl: sensitiveUrl,
          normalizedUrl: sensitiveUrl,
          finalUrl: sensitiveUrl,
          entries: [
            {
              id: "secret-entry",
              entryType: "url",
              loc: sensitiveUrl,
              normalizedLoc: sensitiveUrl,
              targetPageId: "page-home",
            },
          ],
        }),
      ],
      historicalRedirects: [
        historicalRedirect({ requestedUrl: sensitiveUrl, resolvedUrl: sensitiveUrl }),
      ],
    });

    const report = createM4AAuditEngine().evaluate(completed);
    const serializedResults = JSON.stringify({
      results: report.results,
      failures: report.failures,
    });
    expect(serializedResults).not.toContain(querySecret);
    expect(serializedResults).not.toContain(fragmentSecret);
    expect(serializedResults).toContain("redacted");
  });
});

describe("active audit catalog", () => {
  it("matches all 130 implemented IDs, titles, and default severities in AUDIT_RULES.md", () => {
    const catalog = readFileSync(new URL("../../../docs/AUDIT_RULES.md", import.meta.url), "utf8");
    const approved = new Map<string, { severity: string; title: string }>();
    for (const match of catalog.matchAll(
      /^(CRW|HTTP|RSM|URL|ONS|CNT|LNK)-(\d{3})\s+\|\s+([^|]+?)\s+\|\s+(.+)$/gmu,
    )) {
      const [, prefix, number, severity, title] = match;
      if (
        prefix !== undefined &&
        number !== undefined &&
        severity !== undefined &&
        title !== undefined
      ) {
        approved.set(`${prefix}-${number}`, {
          severity: severity.toLowerCase().replaceAll(/\s+/gu, "-"),
          title: title.trim(),
        });
      }
    }

    expect(approved.size).toBe(130);
    for (const rule of ACTIVE_AUDIT_RULES) {
      expect({ severity: rule.defaultSeverity, title: rule.title }).toEqual(approved.get(rule.id));
    }
  });

  it("registers the partial M5 expansion exactly once without implying the full Phase 1 catalog", () => {
    expect(ACTIVE_AUDIT_CATALOG_VERSION).toBe("m5-partial-3");
    expect(M5_EXPANSION_RULES).toHaveLength(65);
    expect(ACTIVE_AUDIT_RULES).toHaveLength(130);
    expect(
      new Set(ACTIVE_AUDIT_RULES.map((rule) => `${rule.id}@${String(rule.version)}`)).size,
    ).toBe(130);
    expect(ACTIVE_AUDIT_RULES.map((rule) => rule.id)).toEqual([
      ...M4A_RULES.map((rule) => rule.id),
      ...Array.from({ length: 25 }, (_, index) => `ONS-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 20 }, (_, index) => `CNT-${String(index + 1).padStart(3, "0")}`),
      ...Array.from({ length: 20 }, (_, index) => `LNK-${String(index + 1).padStart(3, "0")}`),
    ]);
  });

  it.each(M5_EXPANSION_RULES)("keeps the M5 contract for $id", (rule) => {
    expect(rule.version).toBe(ACTIVE_VERSION_OVERRIDES[rule.id] ?? 1);
    expect(rule.deterministic).toBe(true);
    expect(rule.firstSupportedVersion).toBe("M5");
    expect(rule.requiredData.length).toBeGreaterThan(0);
    expect(rule.description.trim().length).toBeGreaterThan(0);
    expect(rule.eligibility.trim().length).toBeGreaterThan(0);
    expect(rule.explanation.trim().length).toBeGreaterThan(0);
    expect(rule.expectedValue.trim().length).toBeGreaterThan(0);
    expect(rule.recommendedFix.trim().length).toBeGreaterThan(20);
    expect(rule.verification.trim().length).toBeGreaterThan(10);
    expect(rule.impactAreas.length).toBeGreaterThan(0);
  });

  it("pins the expansion and complete active version distributions", () => {
    const expansionDistribution = Object.fromEntries(
      [1, 2, 3].map((version) => [
        String(version),
        M5_EXPANSION_RULES.filter((rule) => rule.version === version).length,
      ]),
    );
    const activeDistribution = Object.fromEntries(
      [1, 2, 3, 4, 5].map((version) => [
        String(version),
        ACTIVE_AUDIT_RULES.filter((rule) => rule.version === version).length,
      ]),
    );

    expect(expansionDistribution).toEqual({ "1": 36, "2": 21, "3": 8 });
    expect(activeDistribution).toEqual({
      "1": 36,
      "2": 41,
      "3": 35,
      "4": 13,
      "5": 5,
    });
  });

  it("keeps current-state architecture and milestone documentation aligned with the manifest", () => {
    const architecture = readFileSync(
      new URL("../../../docs/ARCHITECTURE.md", import.meta.url),
      "utf8",
    );
    const phaseOnePlan = readFileSync(
      new URL("../../../docs/PHASE_1_PLAN.md", import.meta.url),
      "utf8",
    );
    const currentSourceStatus = phaseOnePlan.match(/Current source status:[^\r\n]+/u)?.[0];

    expect(architecture).toContain(
      "ONS/CNT/LNK expansion selects 36 version-1, 21 version-2, and 8 version-3 definitions",
    );
    expect(architecture).toContain(
      "complete active distribution is 36 at version 1, 41 at version 2, 35 at version 3, 13 at version 4, and 5 at version 5",
    );
    expect(currentSourceStatus).toContain(
      "The expansion selects 36 version-1, 21 version-2, and 8 version-3 definitions",
    );
    expect(currentSourceStatus).not.toContain("version-1 definitions and run");
  });

  it("evaluates all 130 rules deterministically against a completed crawl", () => {
    const completed = snapshot();
    const first = createActiveAuditEngine().evaluate(completed);
    const repeated = createActiveAuditEngine().evaluate(completed);

    expect(first).toEqual(repeated);
    expect(first.catalogVersion).toBe(ACTIVE_AUDIT_CATALOG_VERSION);
    expect(first.counts.rules).toBe(130);
    expect(first.results.length).toBeGreaterThanOrEqual(130);
    expect(first.failures).toEqual([]);
    expect(first.results.every((result) => result.evidence.length > 0)).toBe(true);
    expect(
      first.results.every(
        (result) => result.eligibility.state === "eligible" || result.status === "not-checked",
      ),
    ).toBe(true);
  });

  it.each(["completed", "partially_completed"] as const)(
    "reports an empty %s crawl as unavailable without detector failures",
    (status) => {
      const report = createActiveAuditEngine().evaluate(
        snapshot({
          status,
          pages: [],
          robots: [],
          sitemaps: [],
          historicalRedirects: [],
        }),
      );

      expect(report.counts.rules).toBe(130);
      expect(report.failures).toEqual([]);
      expect(report.results.every((result) => result.status === "not-checked")).toBe(true);
    },
  );
});
