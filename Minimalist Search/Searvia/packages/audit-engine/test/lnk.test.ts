import { describe, expect, it } from "vitest";

import { VersionedAuditEngine } from "../src/engine.js";
import { LNK_RULES } from "../src/rules/lnk.js";

import { LNK_FIXTURES } from "./lnk-fixtures.js";

const EXPECTED_RULE_IDS = Array.from(
  { length: 20 },
  (_, index) => `LNK-${String(index + 1).padStart(3, "0")}`,
);
const VERSION_TWO_RULE_IDS = new Set(["LNK-004", "LNK-005", "LNK-013", "LNK-018", "LNK-020"]);
const VERSION_THREE_RULE_IDS = new Set(["LNK-010", "LNK-011", "LNK-019"]);

describe("LNK audit rules", () => {
  it("defines the complete approved category with immutable M5 version metadata", () => {
    expect(LNK_RULES.map((rule) => rule.id)).toEqual(EXPECTED_RULE_IDS);
    expect(Object.keys(LNK_FIXTURES).sort()).toEqual(EXPECTED_RULE_IDS);
    for (const rule of LNK_RULES) {
      expect(rule).toMatchObject({
        version: VERSION_THREE_RULE_IDS.has(rule.id)
          ? 3
          : VERSION_TWO_RULE_IDS.has(rule.id)
            ? 2
            : 1,
        category: "links-architecture",
        deterministic: true,
        firstSupportedVersion: "M5",
      });
      expect(rule.requiredData.length).toBeGreaterThan(0);
      expect(rule.expectedValue.length).toBeGreaterThan(0);
      expect(rule.recommendedFix.length).toBeGreaterThan(0);
      expect(rule.verification.length).toBeGreaterThan(0);
    }
  });

  for (const rule of LNK_RULES) {
    const fixtures = LNK_FIXTURES[rule.id]!;
    for (const fixtureName of ["passing", "finding", "boundary"] as const) {
      it(`${rule.id} has a deterministic ${fixtureName} regression fixture`, () => {
        const fixture = fixtures[fixtureName];
        const engine = new VersionedAuditEngine([rule]);
        const first = engine.evaluate(fixture.snapshot);
        const second = engine.evaluate(fixture.snapshot);

        expect(first).toEqual(second);
        expect(first.failures).toEqual([]);
        expect(first.results.length).toBeGreaterThan(0);
        expect(first.results.some((result) => result.status === fixture.expectedStatus)).toBe(true);
        for (const result of first.results) {
          expect(result.evidence.length).toBeGreaterThan(0);
          expect(Buffer.byteLength(JSON.stringify(result.evidence), "utf8")).toBeLessThanOrEqual(
            65_536,
          );
          if (result.status === "not-checked") {
            expect(result.eligibility.state).not.toBe("eligible");
          }
        }
      });
    }
  }

  it("attaches every automated failure to a crawl page and observed evidence", () => {
    for (const rule of LNK_RULES) {
      const report = new VersionedAuditEngine([rule]).evaluate(
        LNK_FIXTURES[rule.id]!.finding.snapshot,
      );
      for (const result of report.results.filter((candidate) => candidate.status === "failed")) {
        expect(result.target).toMatchObject({ scope: "page" });
        expect(result.target.pageId, rule.id).not.toBeNull();
        expect(result.target.normalizedUrl, rule.id).not.toBeNull();
        expect(
          result.evidence.some((item) => item.url !== undefined),
          rule.id,
        ).toBe(true);
        expect(
          result.evidence.every(
            (item) => item.observationId.length > 0 && Number.isFinite(Date.parse(item.observedAt)),
          ),
          rule.id,
        ).toBe(true);
      }
    }
  });

  it("keeps unavailable external target transport Not Checked", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-004")!;
    const report = new VersionedAuditEngine([rule]).evaluate(
      LNK_FIXTURES["LNK-004"]!.boundary.snapshot,
    );

    expect(report.failures).toEqual([]);
    expect(report.results.some((result) => result.status === "passed")).toBe(false);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["transport"] },
    });
  });

  it("treats an observed external request error as a broken target even without a status code", () => {
    const definition = LNK_RULES.find((candidate) => candidate.id === "LNK-004")!;
    const fixture = LNK_FIXTURES["LNK-004"]!.finding.snapshot;
    const report = new VersionedAuditEngine([definition]).evaluate({
      ...fixture,
      pages: Object.freeze(
        fixture.pages.map((candidate) =>
          candidate.id === "page-target"
            ? Object.freeze({
                ...candidate,
                statusCode: null,
                contentType: null,
                finalUrl: null,
                errorType: "timeout" as const,
                errorMessage: "The external request timed out.",
              })
            : candidate,
        ),
      ),
    });

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "failed",
      target: { pageId: "page-source" },
    });
    expect(report.results[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "external_target_transport",
          value: ["unavailable", "timeout"],
        }),
      ]),
    );
  });

  it("does not classify a redirecting requested URL as an indexable orphan page", () => {
    const definition = LNK_RULES.find((candidate) => candidate.id === "LNK-010")!;
    const fixture = LNK_FIXTURES["LNK-010"]!.finding.snapshot;
    const report = new VersionedAuditEngine([definition]).evaluate({
      ...fixture,
      pages: Object.freeze(
        fixture.pages.map((candidate) =>
          candidate.id === "page-target"
            ? Object.freeze({
                ...candidate,
                finalUrl: "https://example.com/preferred",
                redirectChain: Object.freeze([
                  Object.freeze({
                    sequence: 0,
                    requestedUrl: candidate.requestedUrl,
                    statusCode: 301,
                    location: "/preferred",
                    resolvedUrl: "https://example.com/preferred",
                  }),
                ]),
              })
            : candidate,
        ),
      ),
    });

    expect(report.failures).toEqual([]);
    expect(report.results.some((result) => result.status === "failed")).toBe(false);
    expect(
      report.results.some(
        (result) => result.target.pageId === "page-target" && result.status === "failed",
      ),
    ).toBe(false);
  });

  it.each([
    ["LNK-010", "finding"],
    ["LNK-011", "finding"],
    ["LNK-013", "finding"],
    ["LNK-019", "passing"],
    ["LNK-020", "finding"],
  ] as const)(
    "%s keeps graph-absence conclusions Not Checked when a rendered source graph was not persisted",
    (id, fixtureName) => {
      const definition = LNK_RULES.find((candidate) => candidate.id === id)!;
      const fixture = LNK_FIXTURES[id]![fixtureName].snapshot;
      const renderedSource = fixture.pages[0]!;
      const raw = renderedSource.extraction!;
      const report = new VersionedAuditEngine([definition]).evaluate({
        ...fixture,
        pages: Object.freeze([
          Object.freeze({
            ...renderedSource,
            extraction: Object.freeze({ ...raw, clientRendered: true }),
            renderedExtraction: Object.freeze({
              ...raw,
              id: `${raw.id}-rendered`,
              source: "rendered" as const,
              clientRendered: false,
            }),
          }),
          ...fixture.pages.slice(1),
        ]),
      });

      expect(report.failures, id).toEqual([]);
      expect(
        report.results.some((result) => result.status === "failed"),
        id,
      ).toBe(false);
      expect(
        report.results.some(
          (result) =>
            result.status === "not-checked" &&
            result.eligibility.state === "unavailable" &&
            result.eligibility.missingData.includes("links"),
        ),
        id,
      ).toBe(true);
    },
  );

  it.each(["LNK-007", "LNK-008", "LNK-017"] as const)(
    "%s explains why unavailable extraction semantics cannot be inferred",
    (id) => {
      const rule = LNK_RULES.find((candidate) => candidate.id === id)!;
      const fixture = id === "LNK-017" ? LNK_FIXTURES[id]!.finding : LNK_FIXTURES[id]!.passing;
      const report = new VersionedAuditEngine([rule]).evaluate(fixture.snapshot);

      expect(report.failures).toEqual([]);
      expect(
        report.results.some(
          (result) => result.target.pageId === "page-source" && result.status === "not-checked",
        ),
      ).toBe(true);
      expect(
        report.results
          .filter((result) => result.status === "not-checked")
          .every((result) => result.eligibility.reason.length > 40),
      ).toBe(true);
    },
  );

  it("does not classify valid mailto or tel schemes as malformed href failures", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-007")!;
    const fixture = LNK_FIXTURES["LNK-007"]!.finding.snapshot;
    const source = fixture.pages[0]!;
    const mailto = source.links[0]!;
    for (const targetUrl of ["mailto:owner@example.com", "tel:+12025550123"]) {
      const report = new VersionedAuditEngine([rule]).evaluate({
        ...fixture,
        pages: Object.freeze([
          Object.freeze({
            ...source,
            links: Object.freeze([Object.freeze({ ...mailto, targetUrl })]),
          }),
        ]),
      });

      expect(report.failures).toEqual([]);
      expect(report.results.some((result) => result.status === "failed")).toBe(false);
      expect(report.results[0]?.status).toBe("not-checked");
    }
  });

  it("uses the final response URL scheme when deciding whether LNK-005 is eligible", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-005")!;
    const fixture = LNK_FIXTURES["LNK-005"]!.finding.snapshot;
    const source = fixture.pages.find((page) => page.id === "page-source")!;

    const upgradedReport = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze(
        fixture.pages.map((page) =>
          page.id === source.id
            ? Object.freeze({
                ...page,
                requestedUrl: "http://example.com/",
                normalizedUrl: "http://example.com/",
                finalUrl: "https://example.com/",
              })
            : page,
        ),
      ),
    });
    const downgradedReport = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze(
        fixture.pages.map((page) =>
          page.id === source.id
            ? Object.freeze({
                ...page,
                requestedUrl: "https://example.com/",
                normalizedUrl: "https://example.com/",
                finalUrl: "http://example.com/",
              })
            : page,
        ),
      ),
    });

    expect(upgradedReport.failures).toEqual([]);
    const upgradedResult = upgradedReport.results.find(
      (result) => result.target.pageId === source.id,
    );
    expect(upgradedResult?.status).toBe("failed");
    expect(upgradedResult?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "transport",
          observationId: source.id,
          observedAt: source.observedAt,
          field: "source_final_url",
          value: "https://example.com/",
        }),
      ]),
    );
    expect(downgradedReport.failures).toEqual([]);
    expect(
      downgradedReport.results.some(
        (result) => result.target.pageId === source.id && result.status === "failed",
      ),
    ).toBe(false);
  });

  it("reserves LNK-005 source-scheme provenance within the evidence cap", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-005")!;
    const fixture = LNK_FIXTURES["LNK-005"]!.finding.snapshot;
    const source = fixture.pages.find((page) => page.id === "page-source")!;
    const baseLink = source.links[0]!;
    const report = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze(
        fixture.pages.map((page) =>
          page.id === source.id
            ? Object.freeze({
                ...page,
                links: Object.freeze(
                  Array.from({ length: 30 }, (_, index) =>
                    Object.freeze({ ...baseLink, id: `insecure-link-${index}` }),
                  ),
                ),
              })
            : page,
        ),
      ),
    });
    const result = report.results.find((candidate) => candidate.target.pageId === source.id)!;

    expect(report.failures).toEqual([]);
    expect(result).toMatchObject({
      status: "failed",
      detectedValue: "30 internal links use HTTP on this HTTPS page.",
    });
    expect(result.evidence).toHaveLength(25);
    expect(result.evidence[0]).toMatchObject({ field: "source_final_url" });
  });

  it.each(["LNK-013", "LNK-015", "LNK-020"] as const)(
    "%s returns Manual Review instead of inventing qualitative intent",
    (id) => {
      const rule = LNK_RULES.find((candidate) => candidate.id === id)!;
      const report = new VersionedAuditEngine([rule]).evaluate(LNK_FIXTURES[id]!.finding.snapshot);
      const result = report.results.find((candidate) => candidate.status === "manual-review");

      expect(report.failures).toEqual([]);
      expect(result).toBeDefined();
      expect(result?.eligibility.state).toBe("eligible");
      expect(result?.detectedValue.toLowerCase()).toMatch(/human|intent|review/u);
    },
  );

  it("does not label an empty stored anchor as a deterministic failure", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-016")!;
    const report = new VersionedAuditEngine([rule]).evaluate(
      LNK_FIXTURES["LNK-016"]!.boundary.snapshot,
    );

    expect(report.failures).toEqual([]);
    expect(report.results.some((result) => result.status === "failed")).toBe(false);
    expect(report.results.some((result) => result.status === "manual-review")).toBe(true);
  });

  it("keeps important-page depth Not Checked on a partial crawl", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-012")!;
    const report = new VersionedAuditEngine([rule]).evaluate(
      LNK_FIXTURES["LNK-012"]!.boundary.snapshot,
    );

    expect(report.failures).toEqual([]);
    expect(report.results.some((result) => result.status === "failed")).toBe(false);
    expect(report.results.some((result) => result.status === "passed")).toBe(false);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["crawl"] },
    });
  });

  it("does not fail context-sensitive Next text on an explicit pagination edge", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-016")!;
    const fixture = LNK_FIXTURES["LNK-016"]!.passing.snapshot;
    const source = fixture.pages[0]!;
    const link = source.links[0]!;
    const report = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze([
        Object.freeze({
          ...source,
          links: Object.freeze([
            Object.freeze({
              ...link,
              anchorText: "Next",
              linkType: "pagination" as const,
              relValues: Object.freeze(["next"]),
            }),
          ]),
        }),
        ...fixture.pages.slice(1),
      ]),
    });

    expect(report.failures).toEqual([]);
    expect(report.results.some((result) => result.status === "failed")).toBe(false);
    expect(report.results.find((result) => result.target.pageId === "page-source")?.status).toBe(
      "passed",
    );
  });

  it("reports a known broken pagination target before requiring target extraction", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-018")!;
    const fixture = LNK_FIXTURES["LNK-018"]!.finding.snapshot;
    const report = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze(
        fixture.pages.map((page) =>
          page.id === "page-target" ? Object.freeze({ ...page, extraction: null }) : page,
        ),
      ),
    });

    expect(report.failures).toEqual([]);
    const result = report.results.find((candidate) => candidate.target.pageId === "page-source")!;
    const target = fixture.pages.find((page) => page.id === "page-target")!;

    expect(result.status).toBe("failed");
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "pagination_target_status",
          observationId: target.id,
          observedAt: target.observedAt,
          url: target.normalizedUrl,
          value: 404,
        }),
      ]),
    );
  });

  it("keeps the exact LNK-018 failure count while bounding decisive target evidence", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-018")!;
    const fixture = LNK_FIXTURES["LNK-018"]!.passing.snapshot;
    const baseSource = fixture.pages.find((page) => page.id === "page-source")!;
    const baseTarget = fixture.pages.find((page) => page.id === "page-target")!;
    const baseLink = baseSource.links[0]!;
    const targets = Array.from({ length: 30 }, (_, index) => {
      const url = `https://example.com/pagination-${index}`;
      return Object.freeze({
        ...baseTarget,
        id: `pagination-target-${index}`,
        requestedUrl: url,
        normalizedUrl: url,
        finalUrl: url,
        extraction: Object.freeze({
          ...baseTarget.extraction!,
          id: `pagination-extraction-${index}`,
          canonicalUrl: url,
        }),
        links: Object.freeze([]),
      });
    });
    const source = Object.freeze({
      ...baseSource,
      links: Object.freeze(
        targets.map((target, index) =>
          Object.freeze({
            ...baseLink,
            id: `pagination-link-${index}`,
            targetPageId: target.id,
            targetUrl: target.normalizedUrl,
            normalizedTargetUrl: target.normalizedUrl,
            ordinal: index,
          }),
        ),
      ),
    });
    const report = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze([source, ...targets]),
    });
    const result = report.results.find((candidate) => candidate.target.pageId === source.id)!;
    const retainedTargetEvidence = result.evidence.filter(
      (item) => item.field === "pagination_target_links_complete",
    );

    expect(report.failures).toEqual([]);
    expect(result.status).toBe("failed");
    expect(result.detectedValue).toBe(
      "30 broken or non-reciprocal pagination edges were observed on this page.",
    );
    expect(result.evidence).toHaveLength(24);
    expect(
      result.evidence.filter((item) => item.field === "missing_reciprocal_pagination_edge"),
    ).toHaveLength(12);
    expect(retainedTargetEvidence).toHaveLength(12);
    for (const item of retainedTargetEvidence) {
      const target = targets.find((candidate) => candidate.extraction?.id === item.observationId)!;
      expect(item).toMatchObject({
        observationId: target.extraction!.id,
        observedAt: target.extraction!.extractedAt,
        url: target.normalizedUrl,
        value: true,
      });
    }
  });

  it("does not let an unrelated incomplete page suppress verified LNK-018 pagination", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-018")!;
    const fixture = LNK_FIXTURES["LNK-018"]!.passing.snapshot;
    const template = fixture.pages[0]!;
    const unrelatedUrl = "https://example.com/unrelated-incomplete";
    const report = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze([
        ...fixture.pages,
        Object.freeze({
          ...template,
          id: "page-unrelated-incomplete",
          requestedUrl: unrelatedUrl,
          normalizedUrl: unrelatedUrl,
          finalUrl: unrelatedUrl,
          extraction: null,
          links: Object.freeze([]),
          discoverySource: "link" as const,
        }),
      ]),
    });

    expect(report.failures).toEqual([]);
    expect(report.results.find((result) => result.target.pageId === "page-source")).toMatchObject({
      status: "passed",
      eligibility: { state: "eligible" },
    });
  });

  it("indexes inbound edges once while bounding per-target evidence samples", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-013")!;
    const fixture = LNK_FIXTURES["LNK-013"]!.passing.snapshot;
    const baseSource = fixture.pages.find((page) => page.id === "page-source")!;
    const target = fixture.pages.find((page) => page.id === "page-target")!;
    const baseLink = baseSource.links[0]!;
    const sources = Array.from({ length: 30 }, (_, index) => {
      const url = `https://example.com/source-${index}`;
      return Object.freeze({
        ...baseSource,
        id: `bulk-source-${index}`,
        requestedUrl: url,
        normalizedUrl: url,
        finalUrl: url,
        extraction: Object.freeze({
          ...baseSource.extraction!,
          id: `bulk-extraction-${index}`,
          canonicalUrl: url,
        }),
        links: Object.freeze([
          Object.freeze({ ...baseLink, id: `bulk-link-${index}`, ordinal: index }),
        ]),
      });
    });
    const report = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze([target, ...sources]),
    });
    const result = report.results.find((candidate) => candidate.target.pageId === target.id)!;

    expect(report.failures).toEqual([]);
    expect(result.status).toBe("manual-review");
    expect(result.detectedValue).toContain("30 inbound internal links");
    expect(result.evidence).toHaveLength(13);
  });

  it("does not pass LNK-006 when target transport is unavailable despite stale extraction", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-006")!;
    const fixture = LNK_FIXTURES["LNK-006"]!.passing.snapshot;
    const target = fixture.pages.find((page) => page.id === "page-target")!;
    const report = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze(
        fixture.pages.map((page) =>
          page.id === target.id ? Object.freeze({ ...page, statusCode: null }) : page,
        ),
      ),
    });

    expect(report.failures).toEqual([]);
    expect(report.results.find((result) => result.target.pageId === "page-source")).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["transport"] },
    });
  });

  it("keeps ambiguous or unresolved target canonicals Not Checked for LNK-006", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-006")!;
    const fixture = LNK_FIXTURES["LNK-006"]!.passing.snapshot;
    const target = fixture.pages.find((page) => page.id === "page-target")!;
    const cases = [
      {
        canonicalTagCount: 2,
        canonicalUrl: "https://example.com/target",
        canonicalNormalizationFailure: null,
      },
      {
        canonicalTagCount: 1,
        canonicalUrl: null,
        canonicalNormalizationFailure: { code: "unsupported_protocol" as const },
      },
    ] as const;

    for (const extractionOverride of cases) {
      const report = new VersionedAuditEngine([rule]).evaluate({
        ...fixture,
        pages: Object.freeze(
          fixture.pages.map((page) =>
            page.id === target.id
              ? Object.freeze({
                  ...page,
                  extraction: Object.freeze({ ...page.extraction!, ...extractionOverride }),
                })
              : page,
          ),
        ),
      });
      const result = report.results.find((candidate) => candidate.target.pageId === "page-source");

      expect(report.failures).toEqual([]);
      expect(result).toMatchObject({
        status: "not-checked",
        eligibility: { state: "unavailable", missingData: ["raw-extraction"] },
      });
      expect(result?.evidence).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "canonical_target_coverage" })]),
      );
    }
  });

  it("allows an observed zero-canonical target to pass LNK-006", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-006")!;
    const fixture = LNK_FIXTURES["LNK-006"]!.passing.snapshot;
    const report = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze(
        fixture.pages.map((page) =>
          page.id === "page-target"
            ? Object.freeze({
                ...page,
                extraction: Object.freeze({
                  ...page.extraction!,
                  canonicalTagCount: 0,
                  canonicalUrl: null,
                  canonicalNormalizationFailure: null,
                }),
              })
            : page,
        ),
      ),
    });

    expect(report.failures).toEqual([]);
    expect(report.results.find((result) => result.target.pageId === "page-source")?.status).toBe(
      "passed",
    );
  });

  it("does not treat an incomplete zero-canonical observation as conclusive for LNK-006", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-006")!;
    const fixture = LNK_FIXTURES["LNK-006"]!.passing.snapshot;
    const report = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze(
        fixture.pages.map((page) =>
          page.id === "page-target"
            ? Object.freeze({
                ...page,
                extraction: Object.freeze({
                  ...page.extraction!,
                  documentMetadataComplete: false,
                  canonicalTagCount: 0,
                  canonicalUrl: null,
                  canonicalNormalizationFailure: null,
                }),
              })
            : page,
        ),
      ),
    });

    expect(report.failures).toEqual([]);
    expect(report.results.find((result) => result.target.pageId === "page-source")).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["raw-extraction"] },
    });
    expect(
      report.results
        .find((result) => result.target.pageId === "page-source")
        ?.evidence.some((item) => item.field === "canonical_metadata_complete"),
    ).toBe(true);
  });

  it("does not pass LNK-019 below threshold when a raw link collection is incomplete", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-019")!;
    const fixture = LNK_FIXTURES["LNK-019"]!.passing.snapshot;
    const source = fixture.pages[0]!;
    const report = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze([
        Object.freeze({
          ...source,
          extraction: Object.freeze({ ...source.extraction!, linksComplete: false }),
        }),
      ]),
    });

    expect(report.failures).toEqual([]);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["links"] },
    });
  });

  it("attributes LNK-019 group aggregates to the crawl and samples to their real pages", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-019")!;
    const fixture = LNK_FIXTURES["LNK-019"]!.finding.snapshot;
    const pages = fixture.pages.map((page, index) =>
      Object.freeze({
        ...page,
        observedAt: `2026-07-16T12:00:${String(index).padStart(2, "0")}.000Z`,
      }),
    );
    const report = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze(pages),
    });
    const pageByObservationId = new Map(pages.map((page) => [page.id, page]));

    expect(report.failures).toEqual([]);
    expect(report.results).toHaveLength(10);
    for (const result of report.results) {
      expect(result.status).toBe("failed");
      expect(result.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "query_variant_group",
            observationId: fixture.crawlId,
            observedAt: fixture.finishedAt,
          }),
          expect.objectContaining({
            field: "query_variant_threshold",
            observationId: fixture.crawlId,
            observedAt: fixture.finishedAt,
          }),
        ]),
      );
      const samples = result.evidence.filter((item) => item.field === "query_variant_sample");
      expect(samples).toHaveLength(10);
      for (const sample of samples) {
        const observedPage = pageByObservationId.get(sample.observationId)!;
        expect(observedPage).toBeDefined();
        expect(sample.observedAt).toBe(observedPage.observedAt);
        expect(new URL(sample.url!).origin + new URL(sample.url!).pathname).toBe(
          new URL(observedPage.normalizedUrl).origin + new URL(observedPage.normalizedUrl).pathname,
        );
        expect(sample.url).toContain("filter=[redacted]");
      }
    }
  });

  it.each(["LNK-010", "LNK-011"] as const)(
    "%s records complete-graph coverage when an absence becomes a failure",
    (id) => {
      const rule = LNK_RULES.find((candidate) => candidate.id === id)!;
      const fixture = LNK_FIXTURES[id]!.finding.snapshot;
      const report = new VersionedAuditEngine([rule]).evaluate(fixture);
      const result = report.results.find((candidate) => candidate.status === "failed")!;

      expect(report.failures).toEqual([]);
      expect(result.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "link_graph_coverage",
            observationId: fixture.crawlId,
            observedAt: fixture.finishedAt,
            value: expect.arrayContaining([
              "crawl_status=completed",
              `total_pages=${fixture.pages.length}`,
            ]),
          }),
        ]),
      );
      if (id === "LNK-010") {
        expect(result.evidence).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: "indexability_transport" }),
            expect.objectContaining({
              source: "robots",
              observationId: "robots-home",
              field: "indexability_robots",
            }),
            expect.objectContaining({
              source: "raw",
              field: "indexability_directives",
            }),
          ]),
        );
      } else {
        expect(result.evidence).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: "page_importance",
              value: "important",
            }),
          ]),
        );
      }
    },
  );

  it("bounds and redacts high-cardinality link evidence", () => {
    const rule = LNK_RULES.find((candidate) => candidate.id === "LNK-015")!;
    const fixture = LNK_FIXTURES["LNK-015"]!.finding.snapshot;
    const source = fixture.pages[0]!;
    const baseLink = source.links[0]!;
    const sourceUrl = `https://example.com/${"source-segment-".repeat(180)}`;
    const targetPath = "target-segment-".repeat(180);
    const links = Array.from({ length: 25 }, (_, index) =>
      Object.freeze({
        ...baseLink,
        id: `long-nofollow-${index}`,
        targetPageId: null,
        targetUrl: `https://example.com/${targetPath}${index}?token=super-secret-${index}`,
        normalizedTargetUrl: `https://example.com/${targetPath}${index}?token=super-secret-${index}`,
        anchorText: "Long evidence target",
        relValues: Object.freeze(["nofollow", "policy-token-".repeat(250)]),
        ordinal: index,
      }),
    );
    const report = new VersionedAuditEngine([rule]).evaluate({
      ...fixture,
      pages: Object.freeze([
        Object.freeze({
          ...source,
          requestedUrl: sourceUrl,
          normalizedUrl: sourceUrl,
          finalUrl: sourceUrl,
          links: Object.freeze(links),
        }),
      ]),
    });
    const result = report.results[0]!;
    const serialized = JSON.stringify(result.evidence);

    expect(report.failures).toEqual([]);
    expect(result.status).toBe("manual-review");
    expect(result.evidence).toHaveLength(25);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(65_536);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).toContain("sha256:");
  });

  it("preserves conclusive link failures when unrelated graph coverage is incomplete", () => {
    for (const id of [
      "LNK-001",
      "LNK-002",
      "LNK-003",
      "LNK-005",
      "LNK-006",
      "LNK-009",
      "LNK-014",
    ] as const) {
      const rule = LNK_RULES.find((candidate) => candidate.id === id)!;
      const fixture = LNK_FIXTURES[id]!.finding.snapshot;
      const firstPage = fixture.pages[0]!;
      const report = new VersionedAuditEngine([rule]).evaluate({
        ...fixture,
        pages: Object.freeze([
          ...fixture.pages,
          {
            ...firstPage,
            id: `incomplete-${id}`,
            requestedUrl: `https://example.com/incomplete-${id.toLowerCase()}`,
            normalizedUrl: `https://example.com/incomplete-${id.toLowerCase()}`,
            finalUrl: `https://example.com/incomplete-${id.toLowerCase()}`,
            extraction: null,
            links: Object.freeze([]),
          },
        ]),
      });

      expect(report.failures).toEqual([]);
      expect(
        report.results.some((result) => result.status === "failed"),
        id,
      ).toBe(true);
    }
  });
});
