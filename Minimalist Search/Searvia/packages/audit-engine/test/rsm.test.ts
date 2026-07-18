import { describe, expect, it } from "vitest";

import { DEFAULT_AUDIT_ENGINE_POLICY } from "../src/contracts.js";
import { VersionedAuditEngine } from "../src/engine.js";
import { RSM_RULES } from "../src/rules/rsm.js";
import { extraction, page, redirect, robots, sitemap, snapshot } from "./fixtures.js";
import { rsmFixtureFor } from "./rsm-fixtures.js";

const EXPECTED_SEVERITIES = [
  "low",
  "high",
  "medium",
  "critical",
  "medium",
  "low",
  "medium",
  "high",
  "high",
  "high",
  "medium",
  "medium",
  "high",
  "high",
  "medium",
] as const;

function rsmRule(id: string) {
  const rule = RSM_RULES.find((candidate) => candidate.id === id);
  if (rule === undefined) throw new TypeError(`Missing RSM rule ${id}.`);
  return rule;
}

describe("RSM-001 through RSM-015", () => {
  it("registers exactly the requested stable rule IDs and default severities", () => {
    expect(RSM_RULES.map((rule) => rule.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => `RSM-${String(index + 1).padStart(3, "0")}`),
    );
    expect(RSM_RULES.map((rule) => rule.defaultSeverity)).toEqual(EXPECTED_SEVERITIES);
    expect(RSM_RULES.every((rule) => rule.category === "robots-sitemaps")).toBe(true);
    expect(RSM_RULES.every((rule) => rule.scope === "site" && rule.version >= 2)).toBe(true);
    expect(rsmRule("RSM-005").version).toBe(3);
    expect(rsmRule("RSM-007")).toMatchObject({
      version: 3,
      requiredData: ["crawl", "robots", "sitemaps"],
    });
  });

  it.each(RSM_RULES)("passes the eligible passing fixture for $id", (rule) => {
    const report = new VersionedAuditEngine([rule]).evaluate(rsmFixtureFor(rule.id).passing);

    expect(report.failures).toEqual([]);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.status).toBe("passed");
    expect(report.results[0]?.eligibility.state).toBe("eligible");
    expect(report.results[0]?.evidence.length).toBeGreaterThan(0);
  });

  it.each(RSM_RULES)("fails the eligible failing fixture for $id", (rule) => {
    const report = new VersionedAuditEngine([rule]).evaluate(rsmFixtureFor(rule.id).failing);

    expect(report.failures).toEqual([]);
    expect(report.results).toHaveLength(1);
    const result = report.results[0];
    expect(result?.status).toBe("failed");
    expect(result?.eligibility.state).toBe("eligible");
    expect(result?.evidence.length).toBeGreaterThan(0);
    expect(result?.detectedValue).not.toBe(result?.expectedValue);
    expect(result?.recommendedFix.length).toBeGreaterThan(40);
    expect(Buffer.byteLength(JSON.stringify(result?.evidence), "utf8")).toBeLessThanOrEqual(65_536);
  });

  it.each(RSM_RULES)("does not pass the boundary or unavailable fixture for $id", (rule) => {
    const report = new VersionedAuditEngine([rule]).evaluate(rsmFixtureFor(rule.id).boundary);

    expect(report.failures).toEqual([]);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.status).toBe("not-checked");
    expect(report.results[0]?.eligibility.state).not.toBe("eligible");
    expect(report.results[0]?.evidence.length).toBeGreaterThan(0);
  });

  it.each(RSM_RULES)("reproduces its result from the same completed crawl for $id", (rule) => {
    const fixture = rsmFixtureFor(rule.id).failing;
    const engine = new VersionedAuditEngine([rule], DEFAULT_AUDIT_ENGINE_POLICY);

    expect(fixture.status).toBe("completed");
    expect(engine.evaluate(fixture)).toEqual(engine.evaluate(fixture));
  });

  it("keeps unavailable M3 robots content and resource decisions out of pass coverage", () => {
    const contentUnavailable = snapshot({ robots: [robots({ content: null })] });
    for (const id of ["RSM-003", "RSM-004"] as const) {
      const rule = RSM_RULES.find((candidate) => candidate.id === id);
      expect(rule).toBeDefined();
      if (rule === undefined) continue;
      const result = new VersionedAuditEngine([rule]).evaluate(contentUnavailable).results[0];
      expect(result?.status).toBe("not-checked");
      expect(result?.eligibility.state).toBe("unavailable");
    }

    const resourceRule = RSM_RULES.find((candidate) => candidate.id === "RSM-005");
    expect(resourceRule).toBeDefined();
    if (resourceRule !== undefined) {
      const result = new VersionedAuditEngine([resourceRule]).evaluate(
        rsmFixtureFor("RSM-005").boundary,
      ).results[0];
      expect(result?.status).toBe("not-checked");
      expect(result?.eligibility.state).toBe("unavailable");
    }
  });

  it("does not conclude RSM-007 sitemap absence from a partially completed crawl", () => {
    const result = new VersionedAuditEngine([rsmRule("RSM-007")]).evaluate(
      snapshot({ status: "partially_completed", sitemaps: [], robots: [robots()] }),
    ).results[0];

    expect(result).toMatchObject({
      status: "not-checked",
      eligibility: {
        state: "unavailable",
        missingData: ["crawl", "sitemaps"],
      },
    });
  });

  it("requires successful raw extraction coverage for every successful HTML page before RSM-005 passes", () => {
    expect(rsmRule("RSM-005")).toMatchObject({
      requiredData: ["pages", "transport", "raw-extraction", "resources", "robots"],
      eligibility: expect.stringContaining("Every successful HTML page"),
    });
    const allowedResource = {
      id: "resource-allowed",
      resourceType: "stylesheet" as const,
      sourceUrl: "https://example.com/assets/app.css",
      normalizedUrl: "https://example.com/assets/app.css",
      scope: "internal" as const,
      robotsDecision: "allowed" as const,
      robotsObservationId: "robots-allowed",
      robotsResult: "fetched" as const,
    };
    const coveredPage = page({ resources: [allowedResource] });
    const passing = new VersionedAuditEngine([rsmRule("RSM-005")]).evaluate(
      snapshot({ pages: [coveredPage] }),
    ).results[0];
    expect(passing?.status).toBe("passed");

    const unavailablePage = page({
      id: "page-unavailable-extraction",
      requestedUrl: "https://example.com/unavailable",
      normalizedUrl: "https://example.com/unavailable",
      finalUrl: "https://example.com/unavailable",
      extraction: null,
      resources: [],
    });
    const mixed = new VersionedAuditEngine([rsmRule("RSM-005")]).evaluate(
      snapshot({ pages: [coveredPage, unavailablePage] }),
    ).results[0];
    expect(mixed?.status).toBe("not-checked");
    expect(mixed?.eligibility).toMatchObject({
      state: "unavailable",
      missingData: expect.arrayContaining(["raw-extraction", "resources"]),
    });
    expect(mixed?.evidence).toEqual([
      expect.objectContaining({
        observationId: unavailablePage.id,
        field: "renderingResourceExtractionCoverage",
        value: "source=unavailable; links_complete=false",
      }),
    ]);

    const incompletePage = page({
      extraction: extraction({ linksComplete: false }),
      resources: [allowedResource],
    });
    const truncated = new VersionedAuditEngine([rsmRule("RSM-005")]).evaluate(
      snapshot({ pages: [incompletePage] }),
    ).results[0];
    expect(truncated).toMatchObject({
      status: "not-checked",
      eligibility: {
        state: "unavailable",
        missingData: expect.arrayContaining(["raw-extraction", "resources"]),
      },
      evidence: [
        expect.objectContaining({
          observationId: incompletePage.id,
          field: "renderingResourceExtractionCoverage",
          value: "source=raw; links_complete=false",
        }),
      ],
    });
  });

  it("keeps a conclusive RSM-005 block failure-first despite unrelated extraction gaps", () => {
    const blockedPage = page({
      resources: [
        {
          id: "resource-blocked",
          resourceType: "script",
          sourceUrl: "https://example.com/assets/app.js",
          normalizedUrl: "https://example.com/assets/app.js",
          scope: "internal",
          robotsDecision: "disallowed",
          robotsObservationId: "robots-blocked",
          robotsResult: "fetched",
        },
      ],
    });
    const unavailablePage = page({
      id: "page-unrelated-unavailable",
      requestedUrl: "https://example.com/unrelated-unavailable",
      normalizedUrl: "https://example.com/unrelated-unavailable",
      finalUrl: "https://example.com/unrelated-unavailable",
      extraction: null,
      resources: [],
    });

    const result = new VersionedAuditEngine([rsmRule("RSM-005")]).evaluate(
      snapshot({ pages: [unavailablePage, blockedPage] }),
    ).results[0];
    expect(result?.status).toBe("failed");
    expect(result?.eligibility.state).toBe("eligible");
    expect(result?.evidence[0]).toMatchObject({
      observationId: "resource-blocked",
      field: "resourceRobotsDecision",
      value: expect.stringContaining("decision=disallowed"),
    });
  });

  it("never passes failed, errored, or unparsed sitemap lifecycles", () => {
    const timedOut = snapshot({
      sitemaps: [
        sitemap({
          status: "failed",
          statusCode: 200,
          errorType: "request_timeout",
          errorMessage: "The sitemap body timed out.",
          entries: [],
        }),
      ],
    });

    const access = new VersionedAuditEngine([rsmRule("RSM-008")]).evaluate(timedOut).results[0];
    const parsing = new VersionedAuditEngine([rsmRule("RSM-009")]).evaluate(timedOut).results[0];
    expect(access?.status).toBe("failed");
    expect(parsing?.status).toBe("not-checked");
    expect(parsing?.eligibility.state).toBe("unavailable");

    const unclassifiedParseFailure = snapshot({
      sitemaps: [
        sitemap({
          status: "failed",
          statusCode: 200,
          format: "unknown",
          errorType: null,
          errorMessage: null,
          entries: [],
        }),
      ],
    });
    const unparsed = new VersionedAuditEngine([rsmRule("RSM-009")]).evaluate(
      unclassifiedParseFailure,
    ).results[0];
    const unparsedAccess = new VersionedAuditEngine([rsmRule("RSM-008")]).evaluate(
      unclassifiedParseFailure,
    ).results[0];
    expect(unparsed?.status).toBe("failed");
    expect(unparsedAccess?.status).toBe("not-checked");
  });

  it("does not pass sitemap alignment with unknown important-page indexability", () => {
    const report = new VersionedAuditEngine([rsmRule("RSM-015")]).evaluate(
      snapshot({
        pages: [
          page(),
          page({
            id: "page-important-unparsed",
            requestedUrl: "https://example.com/important-unparsed",
            normalizedUrl: "https://example.com/important-unparsed",
            finalUrl: "https://example.com/important-unparsed",
            importance: "important",
            discoverySource: "link",
            extraction: null,
          }),
        ],
      }),
    );

    expect(report.results[0]?.status).toBe("not-checked");
    expect(report.results[0]?.eligibility.state).toBe("unavailable");
    expect(report.results[0]?.eligibility).toMatchObject({
      missingData: expect.arrayContaining(["raw-extraction"]),
    });
  });

  it("uses preserved crawler ownership and never guesses from legacy flattened directives", () => {
    const scopedHeader = Object.freeze({
      "x-robots-tag": Object.freeze(["googlebot: noindex"]),
    });
    const preserved = snapshot({
      pages: [
        page({
          responseHeaders: scopedHeader,
          extraction: extraction({
            xRobotsTag: [],
            directiveScopePreserved: true,
          }),
        }),
      ],
    });
    expect(
      new VersionedAuditEngine([rsmRule("RSM-014")]).evaluate(preserved).results[0]?.status,
    ).toBe("passed");
    expect(
      new VersionedAuditEngine([rsmRule("RSM-015")]).evaluate(preserved).results[0]?.status,
    ).toBe("passed");

    const legacyFlattened = snapshot({
      pages: [
        page({
          responseHeaders: scopedHeader,
          extraction: extraction({
            xRobotsTag: ["noindex"],
            directiveScopePreserved: false,
          }),
        }),
      ],
    });
    for (const id of ["RSM-014", "RSM-015"] as const) {
      const result = new VersionedAuditEngine([rsmRule(id)]).evaluate(legacyFlattened).results[0];
      expect(result?.status).toBe("not-checked");
      expect(result?.eligibility.state).toBe("unavailable");
    }

    const renderedOnly = snapshot({
      pages: [
        page({
          extraction: extraction({
            source: "rendered",
            xRobotsTag: [],
            directiveScopePreserved: true,
          }),
        }),
      ],
    });
    for (const id of ["RSM-014", "RSM-015"] as const) {
      const result = new VersionedAuditEngine([rsmRule(id)]).evaluate(renderedOnly).results[0];
      expect(result?.status).toBe("not-checked");
      expect(result?.eligibility.state).toBe("unavailable");
    }

    const conclusiveBlock = snapshot({
      pages: [
        page({
          robotsDecision: "disallowed",
          extraction: extraction({ source: "rendered", directiveScopePreserved: false }),
        }),
      ],
    });
    expect(
      new VersionedAuditEngine([rsmRule("RSM-014")]).evaluate(conclusiveBlock).results[0]?.status,
    ).toBe("failed");
  });

  it("prioritizes failing observations in bounded aggregate evidence", () => {
    const robotObservations = [
      ...Array.from({ length: 25 }, (_, index) =>
        robots({
          id: `robots-healthy-${index}`,
          origin: `https://healthy-${index}.example`,
          requestedUrl: `https://healthy-${index}.example/robots.txt`,
          finalUrl: `https://healthy-${index}.example/robots.txt`,
        }),
      ),
      robots({
        id: "robots-missing-last",
        origin: "https://missing.example",
        requestedUrl: "https://missing.example/robots.txt",
        finalUrl: "https://missing.example/robots.txt",
        statusCode: 404,
        result: "not_found",
        content: null,
        sitemapUrls: [],
      }),
    ];
    const robotsResult = new VersionedAuditEngine([rsmRule("RSM-001")]).evaluate(
      snapshot({ robots: robotObservations }),
    ).results[0];
    expect(robotsResult?.status).toBe("failed");
    expect(robotsResult?.evidence[0]?.value).toBe("not_found");

    const sitemapObservations = [
      ...Array.from({ length: 25 }, (_, index) =>
        sitemap({
          id: `sitemap-healthy-${index}`,
          requestedUrl: `https://example.com/sitemap-${index}.xml`,
          normalizedUrl: `https://example.com/sitemap-${index}.xml`,
          finalUrl: `https://example.com/sitemap-${index}.xml`,
        }),
      ),
      sitemap({
        id: "sitemap-failed-last",
        requestedUrl: "https://example.com/sitemap-failed.xml",
        normalizedUrl: "https://example.com/sitemap-failed.xml",
        finalUrl: "https://example.com/sitemap-failed.xml",
        status: "failed",
        statusCode: 503,
        errorType: "network_error",
        errorMessage: "The sitemap server was unavailable.",
        entries: [],
      }),
    ];
    const sitemapResult = new VersionedAuditEngine([rsmRule("RSM-008")]).evaluate(
      snapshot({ sitemaps: sitemapObservations }),
    ).results[0];
    expect(sitemapResult?.status).toBe("failed");
    expect(sitemapResult?.evidence[0]).toMatchObject({
      field: "transportState",
      value: ["failed", 503, "network_error"],
    });
  });

  it("records the selected robots group and matched whole-site patterns for RSM-004", () => {
    const result = new VersionedAuditEngine([rsmRule("RSM-004")]).evaluate(
      snapshot({
        robots: [
          robots({
            userAgent: "SearviaBot/1.0",
            content: "User-agent: *\nAllow: /public\n\nUser-agent: searviabot\nDisallow: /\n",
          }),
        ],
      }),
    ).results[0];
    const resolution = result?.evidence.find(
      (item) => item.field === "whole_site_policy_resolution",
    );

    expect(rsmRule("RSM-004").version).toBe(3);
    expect(result?.status).toBe("failed");
    expect(resolution).toMatchObject({ observationId: "robots-home", source: "robots" });
    expect(resolution?.value).toEqual(
      expect.arrayContaining([
        "configured_user_agent=SearviaBot/1.0",
        "product_token=searviabot",
        "group_1_agents=searviabot",
        "group_1_disallow=/",
        "matched_whole_site_disallows=1",
        "blocks_entire_site=true",
      ]),
    );
  });

  it("records the exact RSM-010 limit signal and named thresholds", () => {
    const result = new VersionedAuditEngine([rsmRule("RSM-010")]).evaluate(
      rsmFixtureFor("RSM-010").failing,
    ).results[0];
    const limit = result?.evidence.find((item) => item.field === "limit_observations");

    expect(result?.status).toBe("failed");
    expect(limit?.value).toEqual(
      expect.arrayContaining([
        "parsed_entry_count=0",
        "configured_max_response_bytes=5000000",
        "supported_max_entries=50000",
        "diagnostic=entry_limit",
      ]),
    );
  });

  it("never passes duplicate, malformed, or legacy-ambiguous RSM-011 canonicals", () => {
    const observations = [
      extraction({ canonicalTagCount: 2, canonicalUrl: "https://example.com/" }),
      extraction({
        canonicalTagCount: 1,
        canonicalUrl: null,
        canonicalNormalizationFailure: { code: "unsupported_protocol" },
      }),
      extraction({
        canonicalTagCount: 1,
        canonicalUrl: null,
        canonicalNormalizationFailure: null,
      }),
    ];
    const statuses = observations.map(
      (pageExtraction) =>
        new VersionedAuditEngine([rsmRule("RSM-011")]).evaluate(
          snapshot({ pages: [page({ extraction: pageExtraction })] }),
        ).results[0]?.status,
    );

    expect(statuses).toEqual(["not-checked", "failed", "not-checked"]);
    expect(statuses).not.toContain("passed");
  });

  it.each(["RSM-011", "RSM-012", "RSM-013", "RSM-014"] as const)(
    "%s preserves both sitemap-entry and target-page provenance",
    (id) => {
      const result = new VersionedAuditEngine([rsmRule(id)]).evaluate(rsmFixtureFor(id).failing)
        .results[0];
      const observationIds = result?.evidence.map((item) => item.observationId) ?? [];

      expect(result?.status).toBe("failed");
      expect(observationIds).toContain("sitemap-entry-home");
      expect(observationIds).toContain(
        id === "RSM-011" || id === "RSM-014" ? "extract-home" : "page-home",
      );
      expect(
        result?.evidence
          .filter((item) => item.observationId !== "crawl-a")
          .every((item) => item.observedAt === "2026-07-16T12:00:00.000Z"),
      ).toBe(true);
    },
  );

  it("keeps long, high-cardinality sitemap target evidence within the engine budget", () => {
    const longPath = "sitemap-target-".repeat(230);
    const pages = Array.from({ length: 15 }, (_, index) => {
      const url = `https://example.com/${longPath}${index}`;
      return page({
        id: `long-page-${index}`,
        requestedUrl: url,
        normalizedUrl: url,
        finalUrl: `${url}-final`,
        redirectChain: [
          redirect({ requestedUrl: url, resolvedUrl: `${url}-final`, location: `${url}-final` }),
        ],
      });
    });
    const targetSitemap = sitemap({
      entries: pages.map((target, index) => ({
        id: `long-entry-${index}`,
        entryType: "url" as const,
        loc: target.normalizedUrl,
        normalizedLoc: target.normalizedUrl,
        targetPageId: target.id,
      })),
    });
    const report = new VersionedAuditEngine([rsmRule("RSM-012")]).evaluate(
      snapshot({ pages, sitemaps: [targetSitemap] }),
    );
    const serializedEvidence = JSON.stringify(report.results[0]?.evidence);

    expect(report.failures).toEqual([]);
    expect(report.results[0]?.status).toBe("failed");
    expect(Buffer.byteLength(serializedEvidence, "utf8")).toBeLessThanOrEqual(65_536);
    expect(serializedEvidence).toContain("sha256:");
  });

  it("reports exact crawl, transport, and robots gaps for RSM-015", () => {
    const partial = new VersionedAuditEngine([rsmRule("RSM-015")]).evaluate(
      snapshot({ status: "partially_completed" }),
    ).results[0];
    const transport = new VersionedAuditEngine([rsmRule("RSM-015")]).evaluate(
      snapshot({ pages: [page({ statusCode: null })] }),
    ).results[0];
    const robotsGap = new VersionedAuditEngine([rsmRule("RSM-015")]).evaluate(
      snapshot({ pages: [page({ robotsDecision: "not-checked" })] }),
    ).results[0];

    expect(partial?.eligibility).toMatchObject({ missingData: ["crawl"] });
    expect(transport?.eligibility).toMatchObject({ missingData: ["transport"] });
    expect(robotsGap?.eligibility).toMatchObject({ missingData: ["robots"] });
  });
});
