import { describe, expect, it } from "vitest";

import { DEFAULT_AUDIT_ENGINE_POLICY } from "../src/contracts.js";
import { VersionedAuditEngine } from "../src/engine.js";
import { CRW_RULES } from "../src/rules/crw.js";
import { CRW_RULE_FIXTURES, type CrwRuleFixtureSet, type CrwRuleId } from "./crw-fixtures.js";
import { extraction, page, sitemap, snapshot } from "./fixtures.js";

const EXPECTED_IDS = [
  "CRW-001",
  "CRW-002",
  "CRW-003",
  "CRW-004",
  "CRW-005",
  "CRW-006",
  "CRW-007",
  "CRW-008",
  "CRW-009",
  "CRW-010",
  "CRW-011",
  "CRW-012",
  "CRW-013",
  "CRW-014",
  "CRW-015",
] as const satisfies readonly CrwRuleId[];

const EXPECTED_VERSIONS: Readonly<Record<CrwRuleId, number>> = Object.freeze({
  "CRW-001": 4,
  "CRW-002": 4,
  "CRW-003": 4,
  "CRW-004": 3,
  "CRW-005": 3,
  "CRW-006": 2,
  "CRW-007": 3,
  "CRW-008": 3,
  "CRW-009": 3,
  "CRW-010": 4,
  "CRW-011": 4,
  "CRW-012": 5,
  "CRW-013": 3,
  "CRW-014": 2,
  "CRW-015": 2,
});

function fixtureFor(id: string): CrwRuleFixtureSet {
  switch (id) {
    case "CRW-001":
    case "CRW-002":
    case "CRW-003":
    case "CRW-004":
    case "CRW-005":
    case "CRW-006":
    case "CRW-007":
    case "CRW-008":
    case "CRW-009":
    case "CRW-010":
    case "CRW-011":
    case "CRW-012":
    case "CRW-013":
    case "CRW-014":
    case "CRW-015":
      return CRW_RULE_FIXTURES[id];
    default:
      throw new TypeError(`Missing CRW fixture for ${id}.`);
  }
}

describe("M4A crawlability rule catalog", () => {
  it("registers every CRW-001 through CRW-015 definition exactly once", () => {
    expect(CRW_RULES.map((rule) => rule.id)).toEqual(EXPECTED_IDS);
    expect(new Set(CRW_RULES.map((rule) => `${rule.id}@${rule.version}`)).size).toBe(15);
  });

  it.each(CRW_RULES)("provides the complete immutable contract for $id", (rule) => {
    expect(rule.version).toBe(EXPECTED_VERSIONS[rule.id as CrwRuleId]);
    expect(rule.category).toBe("crawlability");
    expect(rule.deterministic).toBe(true);
    expect(rule.firstSupportedVersion).toBe("M4A");
    expect(rule.requiredData.length).toBeGreaterThan(0);
    expect(rule.description.length).toBeGreaterThan(20);
    expect(rule.eligibility.length).toBeGreaterThan(20);
    expect(rule.explanation.length).toBeGreaterThan(20);
    expect(rule.expectedValue.length).toBeGreaterThan(20);
    expect(rule.recommendedFix.length).toBeGreaterThan(40);
    expect(rule.verification.length).toBeGreaterThan(30);
    expect(rule.impactAreas.length).toBeGreaterThan(0);
  });

  it.each(CRW_RULES)("passes the eligible passing fixture for $id", (rule) => {
    const report = new VersionedAuditEngine([rule]).evaluate(fixtureFor(rule.id).passing);

    expect(report.failures).toEqual([]);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.status).toBe("passed");
    expect(report.results[0]?.eligibility.state).toBe("eligible");
  });

  it.each(CRW_RULES)("fails the eligible failing fixture for $id", (rule) => {
    const report = new VersionedAuditEngine([rule]).evaluate(fixtureFor(rule.id).failing);

    expect(report.failures).toEqual([]);
    expect(report.results).toHaveLength(1);
    const result = report.results[0];
    expect(result?.status).toBe("failed");
    expect(result?.eligibility.state).toBe("eligible");
    expect(result?.evidence.length).toBeGreaterThan(0);
    expect(result?.detectedValue).not.toBe(result?.expectedValue);
    expect(result?.recommendedFix.length).toBeGreaterThan(40);
    expect(result?.evidence.every((item) => item.url !== undefined)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result?.evidence), "utf8")).toBeLessThanOrEqual(65_536);
  });

  it.each(CRW_RULES)("does not pass the boundary or unavailable fixture for $id", (rule) => {
    const report = new VersionedAuditEngine([rule]).evaluate(fixtureFor(rule.id).boundary);

    expect(report.failures).toEqual([]);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.status).toBe("not-checked");
    expect(report.results[0]?.eligibility.state).not.toBe("eligible");
    expect(report.results[0]?.evidence.length).toBeGreaterThan(0);
  });

  it.each(CRW_RULES)("reproduces the same result from the same completed crawl for $id", (rule) => {
    const engine = new VersionedAuditEngine([rule], DEFAULT_AUDIT_ENGINE_POLICY);
    const fixture = fixtureFor(rule.id).failing;

    expect(fixture.status).toBe("completed");
    expect(engine.evaluate(fixture)).toEqual(engine.evaluate(fixture));
  });

  it("integrates all 15 rules through the engine without detector failures", () => {
    for (const rule of CRW_RULES) {
      const fixture = fixtureFor(rule.id);
      for (const completedCrawl of [fixture.passing, fixture.failing]) {
        const report = new VersionedAuditEngine([rule]).evaluate(completedCrawl);
        expect(completedCrawl.status).toBe("completed");
        expect(report.failures).toEqual([]);
        expect(report.counts.evaluated).toBe(1);
        expect(report.counts.notChecked).toBe(0);
      }
    }
  });

  it.each([
    ["CRW-007", { metaRobots: [], xRobotsTag: [] }],
    ["CRW-007", { metaRobots: ["noindex"], xRobotsTag: [] }],
    ["CRW-008", { metaRobots: [], xRobotsTag: ["noindex"] }],
    ["CRW-009", { metaRobots: ["index"], xRobotsTag: ["noindex"] }],
  ] as const)("does not attribute flattened crawler-scoped directives for %s", (id, directives) => {
    const rule = CRW_RULES.find((candidate) => candidate.id === id);
    expect(rule).toBeDefined();
    if (rule === undefined) return;
    const report = new VersionedAuditEngine([rule]).evaluate(
      snapshot({
        pages: [
          page({
            extraction: extraction({
              ...directives,
              directiveScopePreserved: false,
            }),
          }),
        ],
      }),
    );

    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable" },
    });
  });

  it("uses the crawler-computed sitemap identity for CRW-011 without retaining URL details", () => {
    const rule = CRW_RULES.find((candidate) => candidate.id === "CRW-011");
    expect(rule).toBeDefined();
    if (rule === undefined) return;
    const precomputedHash = "b".repeat(64);
    const report = new VersionedAuditEngine([rule]).evaluate(
      snapshot({
        sitemaps: [
          sitemap({
            requestedUrl: "https://example.com/sitemap.xml?token=private",
            normalizedUrl: "https://example.com/sitemap.xml?token=private",
            urlHash: precomputedHash,
            status: "failed",
            robotsDecision: "disallowed",
            robotsObservationId: "robots-home",
            robotsResult: "fetched",
            errorType: "robots_disallowed",
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]?.target.key).toContain(precomputedHash);
    expect(JSON.stringify(report.results)).not.toContain("private");
  });

  it("reports unresolved CRW-012 page coverage without hiding conclusive page results", () => {
    const rule = CRW_RULES.find((candidate) => candidate.id === "CRW-012");
    expect(rule).toBeDefined();
    if (rule === undefined) return;

    const known = page({
      id: "known-target",
      requestedUrl: "https://example.com/known-target",
      normalizedUrl: "https://example.com/known-target",
      finalUrl: "https://example.com/known-target",
      importance: "standard",
      discoverySource: "link",
      extraction: extraction({ id: "extract-known-target" }),
    });
    const legacy = page({
      id: "legacy-target",
      requestedUrl: "https://example.com/legacy-target",
      normalizedUrl: "https://example.com/legacy-target",
      finalUrl: "https://example.com/legacy-target",
      importance: "standard",
      discoverySource: "link",
      extraction: extraction({
        id: "extract-legacy-target",
        metaRobots: ["index"],
        directiveScopePreserved: false,
      }),
    });
    const source = page({
      id: "source",
      requestedUrl: "https://example.com/",
      normalizedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      importance: "homepage",
      discoverySource: "seed",
      links: [
        {
          id: "link-known",
          targetPageId: known.id,
          targetUrl: known.normalizedUrl,
          normalizedTargetUrl: known.normalizedUrl,
          scope: "internal",
          relValues: [],
          linkType: "anchor",
          discovered: true,
        },
        {
          id: "link-legacy",
          targetPageId: legacy.id,
          targetUrl: legacy.normalizedUrl,
          normalizedTargetUrl: legacy.normalizedUrl,
          scope: "internal",
          relValues: [],
          linkType: "anchor",
          discovered: true,
        },
      ],
    });

    const mixed = new VersionedAuditEngine([rule]).evaluate(
      snapshot({ pages: [source, known, legacy] }),
    );
    expect(mixed.failures).toEqual([]);
    expect(mixed.results.find((result) => result.target.pageId === known.id)?.status).toBe(
      "passed",
    );
    expect(mixed.results.find((result) => result.target.pageId === legacy.id)).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["raw-extraction"] },
    });

    const conclusiveFailure = new VersionedAuditEngine([rule]).evaluate(
      snapshot({
        pages: [page({ ...source, links: [source.links[1]!] }), known, legacy],
      }),
    );
    expect(
      conclusiveFailure.results.find((result) => result.target.pageId === known.id)?.status,
    ).toBe("failed");
    expect(
      conclusiveFailure.results.find((result) => result.target.pageId === legacy.id)?.status,
    ).toBe("not-checked");
  });

  it("does not infer CRW-012 orphan absence from an incomplete persisted link graph", () => {
    const rule = CRW_RULES.find((candidate) => candidate.id === "CRW-012");
    expect(rule).toBeDefined();
    if (rule === undefined) return;

    const target = page({
      id: "target",
      requestedUrl: "https://example.com/target",
      normalizedUrl: "https://example.com/target",
      finalUrl: "https://example.com/target",
      importance: "standard",
      discoverySource: "link",
    });
    const incompleteSource = page({
      id: "source",
      importance: "homepage",
      discoverySource: "seed",
      extraction: extraction({ id: "extract-source", linksComplete: false }),
      links: [],
    });
    const incomplete = new VersionedAuditEngine([rule]).evaluate(
      snapshot({ pages: [incompleteSource, target] }),
    );

    expect(incomplete.failures).toEqual([]);
    expect(incomplete.results.find((result) => result.target.pageId === target.id)).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["links"] },
    });

    const retainedLink = {
      id: "retained-link",
      targetPageId: target.id,
      targetUrl: target.normalizedUrl,
      normalizedTargetUrl: target.normalizedUrl,
      scope: "internal" as const,
      relValues: [],
      linkType: "anchor" as const,
      discovered: true,
    };
    const positive = new VersionedAuditEngine([rule]).evaluate(
      snapshot({ pages: [page({ ...incompleteSource, links: [retainedLink] }), target] }),
    );
    expect(positive.results.find((result) => result.target.pageId === target.id)?.status).toBe(
      "passed",
    );
  });

  it("does not pass CRW-001 when the seed has no status or conclusive transport outcome", () => {
    const rule = CRW_RULES.find((candidate) => candidate.id === "CRW-001");
    expect(rule).toBeDefined();
    if (rule === undefined) return;

    const report = new VersionedAuditEngine([rule]).evaluate(
      snapshot({
        pages: [
          page({
            requestedUrl: "https://example.com/",
            normalizedUrl: "https://example.com/",
            finalUrl: null,
            statusCode: null,
            contentType: null,
            contentLength: null,
            responseBytes: 0,
            transferSize: 0,
            errorType: null,
            errorMessage: null,
            robotsDecision: "not-checked",
            discoverySource: "seed",
            extraction: null,
            depth: 0,
          }),
        ],
        robots: [],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["transport"] },
    });
  });

  it("allows a post-DNS transport error to confirm CRW-001 resolution", () => {
    const rule = CRW_RULES.find((candidate) => candidate.id === "CRW-001");
    expect(rule).toBeDefined();
    if (rule === undefined) return;

    const report = new VersionedAuditEngine([rule]).evaluate(
      snapshot({
        pages: [
          page({
            finalUrl: null,
            statusCode: null,
            errorType: "connect_timeout",
            discoverySource: "seed",
            extraction: null,
            depth: 0,
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "passed",
      eligibility: { state: "eligible" },
    });
  });
});
