import { describe, expect, it } from "vitest";

import { DEFAULT_AUDIT_ENGINE_POLICY } from "../src/contracts.js";
import { VersionedAuditEngine } from "../src/engine.js";
import { ONS_RULES } from "../src/rules/ons.js";
import { extraction, page, redirect, snapshot } from "./fixtures.js";
import { ONS_RULE_FIXTURES, type OnsRuleFixtureSet, type OnsRuleId } from "./ons-fixtures.js";

const EXPECTED_IDS = [
  "ONS-001",
  "ONS-002",
  "ONS-003",
  "ONS-004",
  "ONS-005",
  "ONS-006",
  "ONS-007",
  "ONS-008",
  "ONS-009",
  "ONS-010",
  "ONS-011",
  "ONS-012",
  "ONS-013",
  "ONS-014",
  "ONS-015",
  "ONS-016",
  "ONS-017",
  "ONS-018",
  "ONS-019",
  "ONS-020",
  "ONS-021",
  "ONS-022",
  "ONS-023",
  "ONS-024",
  "ONS-025",
] as const satisfies readonly OnsRuleId[];

const VERSION_TWO_IDS = new Set<OnsRuleId>([
  "ONS-003",
  "ONS-005",
  "ONS-006",
  "ONS-009",
  "ONS-011",
  "ONS-012",
  "ONS-014",
  "ONS-016",
  "ONS-022",
  "ONS-023",
  "ONS-025",
]);

function fixtureFor(id: string): OnsRuleFixtureSet {
  if (EXPECTED_IDS.includes(id as OnsRuleId)) return ONS_RULE_FIXTURES[id as OnsRuleId];
  throw new TypeError(`Missing ONS fixture for ${id}.`);
}

function evaluate(id: OnsRuleId, fixture: ReturnType<typeof snapshot>) {
  const rule = ONS_RULES.find((candidate) => candidate.id === id);
  expect(rule).toBeDefined();
  if (rule === undefined) throw new TypeError(`Missing ${id}.`);
  return new VersionedAuditEngine([rule]).evaluate(fixture);
}

describe("M5 on-page HTML rule catalog", () => {
  it("registers every ONS-001 through ONS-025 definition exactly once", () => {
    expect(ONS_RULES.map((rule) => rule.id)).toEqual(EXPECTED_IDS);
    expect(new Set(ONS_RULES.map((rule) => `${rule.id}@${rule.version}`)).size).toBe(25);
  });

  it.each(ONS_RULES)("provides the complete immutable M5 contract for $id", (rule) => {
    expect(rule.version).toBe(VERSION_TWO_IDS.has(rule.id) ? 2 : 1);
    expect(rule.category).toBe("on-page");
    expect(rule.deterministic).toBe(true);
    expect(rule.firstSupportedVersion).toBe("M5");
    expect(rule.requiredData.length).toBeGreaterThan(0);
    expect(rule.description.length).toBeGreaterThan(20);
    expect(rule.eligibility.length).toBeGreaterThan(20);
    expect(rule.explanation.length).toBeGreaterThan(20);
    expect(rule.expectedValue.length).toBeGreaterThan(20);
    expect(rule.recommendedFix.length).toBeGreaterThan(40);
    expect(rule.verification.length).toBeGreaterThan(30);
    expect(rule.impactAreas.length).toBeGreaterThan(0);
  });

  it.each(ONS_RULES)("evaluates the positive fixture honestly for $id", (rule) => {
    const fixture = fixtureFor(rule.id);
    const report = new VersionedAuditEngine([rule]).evaluate(fixture.passing);

    expect(report.failures).toEqual([]);
    expect(report.results.length).toBeGreaterThan(0);
    expect(report.results.every((result) => result.status === fixture.passingStatus)).toBe(true);
    if (fixture.passingStatus === "not-checked") {
      expect(report.results.every((result) => result.eligibility.state !== "eligible")).toBe(true);
    } else {
      expect(report.results.every((result) => result.eligibility.state === "eligible")).toBe(true);
    }
  });

  it.each(ONS_RULES)("evaluates the issue or review fixture for $id", (rule) => {
    const fixture = fixtureFor(rule.id);
    const report = new VersionedAuditEngine([rule]).evaluate(fixture.issue);

    expect(report.failures).toEqual([]);
    expect(report.results.length).toBeGreaterThan(0);
    expect(report.results.every((result) => result.status === fixture.issueStatus)).toBe(true);
    for (const result of report.results.filter((candidate) =>
      ["failed", "manual-review"].includes(candidate.status),
    )) {
      expect(result.target.pageId).not.toBeNull();
      expect(result.target.normalizedUrl).toMatch(/^https:\/\//u);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence.some((item) => item.url !== undefined)).toBe(true);
      expect(result.detectedValue.length).toBeGreaterThan(15);
    }
  });

  it.each(ONS_RULES)("never passes unavailable boundary data for $id", (rule) => {
    const report = new VersionedAuditEngine([rule]).evaluate(fixtureFor(rule.id).boundary);

    expect(report.failures).toEqual([]);
    expect(report.results.length).toBeGreaterThan(0);
    expect(report.results.every((result) => result.status === "not-checked")).toBe(true);
    expect(report.results.every((result) => result.eligibility.state !== "eligible")).toBe(true);
  });

  it.each(ONS_RULES)("is deterministic for the same completed crawl for $id", (rule) => {
    const fixture = fixtureFor(rule.id).issue;
    const engine = new VersionedAuditEngine([rule], DEFAULT_AUDIT_ENGINE_POLICY);
    expect(fixture.status).toBe("completed");
    expect(engine.evaluate(fixture)).toEqual(engine.evaluate(fixture));
  });

  it("distinguishes missing title metadata from an empty title", () => {
    const missing = snapshot({
      pages: [page({ extraction: extraction({ title: null, titleTagCount: 0 }) })],
    });
    expect(evaluate("ONS-001", missing).results[0]?.status).toBe("failed");
    expect(evaluate("ONS-002", missing).results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "ineligible" },
    });

    const empty = snapshot({
      pages: [page({ extraction: extraction({ title: " ", titleTagCount: 1 }) })],
    });
    expect(evaluate("ONS-001", empty).results[0]?.status).toBe("passed");
    expect(evaluate("ONS-002", empty).results[0]?.status).toBe("failed");
  });

  it("does not turn a partial duplicate corpus into a pass", () => {
    const partial = snapshot({ status: "partially_completed" });
    for (const id of ["ONS-003", "ONS-009", "ONS-016"] as const) {
      expect(evaluate(id, partial).results[0]).toMatchObject({
        status: "not-checked",
        eligibility: { state: "unavailable" },
      });
    }
  });

  it("does not infer uniqueness when another relevant page has unknown transport", () => {
    const known = page({
      id: "known-page",
      requestedUrl: "https://example.com/known",
      normalizedUrl: "https://example.com/known",
      finalUrl: "https://example.com/known",
      importance: "important",
      extraction: extraction({
        id: "extract-known-page",
        title: "Known Unique Page Title",
        metaDescription:
          "A known and otherwise unique description that must not pass against incomplete coverage.",
        headings: [{ id: "known-h1", level: 1, ordinal: 0, text: "Known unique primary heading" }],
      }),
    });
    const unresolved = page({
      id: "unresolved-page",
      requestedUrl: "https://example.com/unresolved",
      normalizedUrl: "https://example.com/unresolved",
      finalUrl: null,
      statusCode: null,
      contentType: null,
      robotsDecision: "not-checked",
      errorType: null,
      extraction: null,
      importance: "important",
      discoverySource: "link",
    });
    const incompleteTransport = snapshot({ pages: [known, unresolved] });

    for (const id of ["ONS-003", "ONS-009", "ONS-016"] as const) {
      const report = evaluate(id, incompleteTransport);
      expect(report.failures).toEqual([]);
      expect(report.results).toHaveLength(1);
      expect(report.results[0]).toMatchObject({
        target: { pageId: known.id },
        status: "not-checked",
        eligibility: { state: "unavailable", missingData: ["transport"] },
      });
    }
  });

  it("excludes redirecting requested URLs from indexable duplicate-title, description, and H1 corpora", () => {
    const sharedExtraction = {
      title: "One preferred page title",
      metaDescription: "One preferred page description used by the redirect destination.",
      headings: Object.freeze([
        Object.freeze({ id: "shared-h1", level: 1 as const, ordinal: 0, text: "Preferred page" }),
      ]),
    };
    const redirected = page({
      id: "page-old",
      requestedUrl: "https://example.com/old",
      normalizedUrl: "https://example.com/old",
      finalUrl: "https://example.com/new",
      discoverySource: "link",
      importance: "important",
      redirectChain: Object.freeze([
        redirect({
          requestedUrl: "https://example.com/old",
          resolvedUrl: "https://example.com/new",
        }),
      ]),
      extraction: extraction({ id: "extract-old-final-document", ...sharedExtraction }),
    });
    const destination = page({
      id: "page-new",
      requestedUrl: "https://example.com/new",
      normalizedUrl: "https://example.com/new",
      finalUrl: "https://example.com/new",
      discoverySource: "link",
      importance: "important",
      extraction: extraction({ id: "extract-new", ...sharedExtraction }),
    });
    const completed = snapshot({ pages: Object.freeze([redirected, destination]) });

    for (const id of ["ONS-003", "ONS-009", "ONS-016"] as const) {
      const report = evaluate(id, completed);
      expect(report.failures, id).toEqual([]);
      expect(report.results, id).toEqual([
        expect.objectContaining({
          target: expect.objectContaining({ pageId: destination.id }),
          status: "passed",
        }),
      ]);
    }
  });

  it("routes multiple H1 semantics to manual review with an explicit limitation", () => {
    const report = evaluate("ONS-015", fixtureFor("ONS-015").issue);
    expect(report.results[0]).toMatchObject({
      status: "manual-review",
      eligibility: { state: "eligible" },
    });
    expect(report.results[0]?.eligibility.reason).toContain("cannot determine");
    expect(report.results[0]?.detectedValue).toContain("no automated quality conclusion");
  });

  it("does not claim declared social images or icons are fetchable without a fetch observation", () => {
    for (const id of ["ONS-023", "ONS-024"] as const) {
      const report = evaluate(id, fixtureFor(id).passing);
      expect(report.results[0]).toMatchObject({
        status: "not-checked",
        eligibility: { state: "unavailable", missingData: ["resources"] },
      });
      expect(report.results[0]?.eligibility.reason).toMatch(/fetch|request/iu);
    }
  });

  it("keeps ONS-023 social-image evidence useful without retaining URL secrets", () => {
    const invalid = evaluate(
      "ONS-023",
      snapshot({
        pages: [
          page({
            extraction: extraction({
              openGraph: {
                "og:image": ["data:text/plain,private-social-image-payload"],
              },
            }),
          }),
        ],
      }),
    ).results[0];
    expect(invalid).toMatchObject({ status: "failed" });
    expect(invalid?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "invalid_social_image_urls",
          value: ["invalid_values=1", expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)],
        }),
      ]),
    );
    expect(JSON.stringify(invalid)).not.toContain("private-social-image-payload");

    const valid = evaluate(
      "ONS-023",
      snapshot({
        pages: [
          page({
            extraction: extraction({
              openGraph: {
                "og:image": [
                  "https://example.com/share.png?signature=private-social-image-query#private-fragment",
                ],
              },
            }),
          }),
        ],
      }),
    ).results[0];
    expect(valid).toMatchObject({ status: "not-checked" });
    expect(JSON.stringify(valid)).toContain("signature=[redacted]");
    expect(JSON.stringify(valid)).not.toContain("private-social-image-query");
    expect(JSON.stringify(valid)).not.toContain("private-fragment");
  });

  it("requires explicit completeness provenance before concluding absent metadata or headings", () => {
    const legacyMetadata = snapshot({
      pages: [page({ extraction: extraction({ documentMetadataComplete: false }) })],
    });
    for (const id of [
      "ONS-001",
      "ONS-002",
      "ONS-003",
      "ONS-004",
      "ONS-005",
      "ONS-006",
      "ONS-007",
      "ONS-008",
      "ONS-009",
      "ONS-010",
      "ONS-011",
      "ONS-012",
      "ONS-018",
      "ONS-019",
      "ONS-020",
      "ONS-021",
      "ONS-022",
      "ONS-023",
      "ONS-024",
    ] as const) {
      const report = evaluate(id, legacyMetadata);
      expect(report.failures).toEqual([]);
      expect(report.results.every((result) => result.status === "not-checked")).toBe(true);
      expect(report.results.every((result) => result.eligibility.state !== "eligible")).toBe(true);
    }

    const truncatedHeadings = snapshot({
      pages: [page({ extraction: extraction({ headingsComplete: false, headings: [] }) })],
    });
    for (const id of ["ONS-013", "ONS-014", "ONS-015", "ONS-016", "ONS-017"] as const) {
      const report = evaluate(id, truncatedHeadings);
      expect(report.failures).toEqual([]);
      expect(report.results.every((result) => result.status === "not-checked")).toBe(true);
      expect(report.results.every((result) => result.eligibility.state !== "eligible")).toBe(true);
    }
  });

  it("checks meta encoding byte position and refuses an unknown position", () => {
    const boundary = snapshot({
      pages: [
        page({
          extraction: extraction({
            characterEncoding: {
              used: "utf-8",
              declared: "utf-8",
              source: "meta",
              declarationOffsetBytes: 1_024,
            },
          }),
        }),
      ],
    });
    expect(evaluate("ONS-020", boundary).results[0]?.status).toBe("passed");

    const late = snapshot({
      pages: [
        page({
          extraction: extraction({
            characterEncoding: {
              used: "utf-8",
              declared: "utf-8",
              source: "meta",
              declarationOffsetBytes: 1_025,
            },
          }),
        }),
      ],
    });
    expect(evaluate("ONS-020", late).results[0]?.status).toBe("failed");

    const unknown = snapshot({
      pages: [
        page({
          extraction: extraction({
            characterEncoding: {
              used: "utf-8",
              declared: "utf-8",
              source: "meta",
              declarationOffsetBytes: null,
            },
          }),
        }),
      ],
    });
    expect(evaluate("ONS-020", unknown).results[0]?.status).toBe("not-checked");
  });

  it("keeps every objective issue page-scoped with observed page evidence", () => {
    for (const rule of ONS_RULES) {
      const report = new VersionedAuditEngine([rule]).evaluate(fixtureFor(rule.id).issue);
      for (const result of report.results.filter((candidate) => candidate.status === "failed")) {
        expect(result.target).toMatchObject({
          scope: "page",
          pageId: expect.any(String),
          normalizedUrl: expect.stringMatching(/^https:\/\//u),
        });
        expect(
          result.evidence.some(
            (item) => item.url !== undefined && item.observationId.trim().length > 0,
          ),
        ).toBe(true);
      }
    }
  });

  it("does not persist a visible-text excerpt for ONS-025 evidence", () => {
    const customerText = "PRIVATE CUSTOMER COPY THAT IS NOT NEEDED FOR THIS FINDING";
    const report = evaluate(
      "ONS-025",
      snapshot({
        pages: [
          page({
            extraction: extraction({
              meaningfulContent: false,
              visibleText: customerText,
              wordCount: 9,
            }),
            renderedExtraction: extraction({
              id: "extract-rendered-private",
              source: "rendered",
              meaningfulContent: false,
              visibleText: customerText,
              wordCount: 9,
            }),
          }),
        ],
      }),
    );

    expect(report.results[0]?.status).toBe("failed");
    expect(JSON.stringify(report.results[0]?.evidence)).not.toContain(customerText);
    expect(JSON.stringify(report.results[0]?.evidence)).toContain("visible_text_characters");
  });

  it("uses rendered evidence for an empty raw shell and refuses to guess when it is absent", () => {
    const rawShell = extraction({
      visibleText: "",
      wordCount: 0,
      meaningfulContent: false,
      clientRendered: true,
    });
    const rendered = extraction({
      id: "extract-rendered-meaningful",
      source: "rendered",
      visibleText: "Rendered content explains the page clearly.",
      wordCount: 6,
      meaningfulContent: true,
    });

    expect(
      evaluate(
        "ONS-025",
        snapshot({ pages: [page({ extraction: rawShell, renderedExtraction: rendered })] }),
      ).results[0]?.status,
    ).toBe("passed");
    expect(
      evaluate(
        "ONS-025",
        snapshot({ pages: [page({ extraction: rawShell, renderedExtraction: null })] }),
      ).results[0]?.status,
    ).toBe("not-checked");

    const completeStaticSource = extraction({
      id: "extract-complete-static-empty",
      visibleText: "",
      visibleTextComplete: true,
      wordCount: 0,
      meaningfulContent: false,
      clientRendered: false,
    });
    const completeStaticResult = evaluate(
      "ONS-025",
      snapshot({ pages: [page({ extraction: completeStaticSource, renderedExtraction: null })] }),
    ).results[0];
    expect(completeStaticResult).toMatchObject({
      status: "failed",
      eligibility: { state: "eligible" },
    });
    expect(completeStaticResult?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "raw",
          observationId: completeStaticSource.id,
          field: "visible_text_signals",
          value: expect.arrayContaining(["visible_text_complete=true"]),
        }),
      ]),
    );

    const staticSourceWithRenderedResult = evaluate(
      "ONS-025",
      snapshot({
        pages: [page({ extraction: completeStaticSource, renderedExtraction: rendered })],
      }),
    ).results[0];
    expect(staticSourceWithRenderedResult).toMatchObject({
      status: "passed",
      eligibility: { state: "eligible" },
    });
    expect(staticSourceWithRenderedResult?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "rendered",
          observationId: rendered.id,
          field: "visible_text_signals",
        }),
      ]),
    );
  });

  it("preserves structured Open Graph issue provenance while redacting URL details", () => {
    const observedAt = "2026-07-16T12:34:56.000Z";
    const source = extraction({
      id: "extract-open-graph-conflict",
      extractedAt: observedAt,
      openGraph: Object.freeze({
        "og:title": Object.freeze(["Example title"]),
        "og:type": Object.freeze(["article"]),
        "og:url": Object.freeze([
          "https://example.com/first?token=first-query-secret",
          "https://example.com/second?token=second-query-secret",
        ]),
        "og:image": Object.freeze(["data:text/plain,open-graph-image-secret"]),
      }),
    });
    const result = evaluate("ONS-022", snapshot({ pages: [page({ extraction: source })] }))
      .results[0];

    expect(result).toMatchObject({ status: "failed", target: { pageId: "page-home" } });
    expect(result?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "raw",
          observationId: source.id,
          observedAt,
          field: "document_metadata_complete",
          value: true,
        }),
        expect.objectContaining({
          source: "raw",
          observationId: source.id,
          observedAt,
          field: "open_graph_issue",
          value: [
            "og:url",
            "conflicting_values",
            "https://example.com/first?token=[redacted]",
            "https://example.com/second?token=[redacted]",
          ],
        }),
        expect.objectContaining({
          source: "raw",
          observationId: source.id,
          observedAt,
          field: "open_graph_issue",
          value: [
            "og:image",
            "malformed_or_unsupported_url",
            "invalid_values=1",
            expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
          ],
        }),
      ]),
    );
    const persisted = JSON.stringify(result);
    expect(persisted).not.toContain("first-query-secret");
    expect(persisted).not.toContain("second-query-secret");
    expect(persisted).not.toContain("open-graph-image-secret");
  });

  it("does not let Unicode case folding change title or description character thresholds", () => {
    const belowTitleMinimum = snapshot({
      pages: [page({ extraction: extraction({ title: `${"A".repeat(13)}İ` }) })],
    });
    const atTitleMaximum = snapshot({
      pages: [page({ extraction: extraction({ title: `${"A".repeat(59)}İ` }) })],
    });
    const belowDescriptionMinimum = snapshot({
      pages: [
        page({
          extraction: extraction({ metaDescription: `${"A".repeat(48)}İ` }),
        }),
      ],
    });
    const atDescriptionMaximum = snapshot({
      pages: [
        page({
          extraction: extraction({ metaDescription: `${"A".repeat(159)}İ` }),
        }),
      ],
    });

    expect(evaluate("ONS-005", belowTitleMinimum).results[0]?.status).toBe("failed");
    expect(evaluate("ONS-006", atTitleMaximum).results[0]?.status).toBe("passed");
    expect(evaluate("ONS-011", belowDescriptionMinimum).results[0]?.status).toBe("failed");
    expect(evaluate("ONS-012", atDescriptionMaximum).results[0]?.status).toBe("passed");
  });

  it("does not infer empty rendered content from incomplete visible-text persistence", () => {
    const rawShell = extraction({
      visibleText: "",
      wordCount: 0,
      meaningfulContent: false,
      clientRendered: true,
    });
    const incompleteRendered = extraction({
      id: "extract-rendered-incomplete",
      source: "rendered",
      visibleText: "",
      visibleTextComplete: false,
      wordCount: 0,
      meaningfulContent: false,
    });

    const result = evaluate(
      "ONS-025",
      snapshot({ pages: [page({ extraction: rawShell, renderedExtraction: incompleteRendered })] }),
    ).results[0];

    expect(result).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["rendered-extraction"] },
    });
    expect(result?.eligibility.reason).toContain("coverage is incomplete");
    expect(result?.evidence).toEqual([
      expect.objectContaining({
        source: "rendered",
        observationId: incompleteRendered.id,
        field: "visible_text_complete",
        value: false,
      }),
    ]);
  });

  it("rejects duplicate viewport directives and invalid optional scale values", () => {
    for (const declaration of [
      "width=500, width=device-width, initial-scale=1",
      "width=device-width, initial-scale=1, maximum-scale=banana",
    ]) {
      const report = evaluate(
        "ONS-018",
        snapshot({
          pages: [page({ extraction: extraction({ viewportDeclarations: [declaration] }) })],
        }),
      );
      expect(report.failures).toEqual([]);
      expect(report.results[0]?.status, declaration).toBe("failed");
    }
  });

  it("keeps the maximum persisted viewport issue set within the result contract", () => {
    const declarations = Array.from(
      { length: 64 },
      () => "width=device-width, initial-scale=bad, minimum-scale=bad, maximum-scale=bad",
    );
    const report = evaluate(
      "ONS-018",
      snapshot({
        pages: [page({ extraction: extraction({ viewportDeclarations: declarations }) })],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]?.status).toBe("failed");
    expect(report.results[0]?.detectedValue.length).toBeLessThan(4_096);
  });

  it("bounds duplicate metadata peer evidence for a high-collision corpus", () => {
    const pages = Array.from({ length: 500 }, (_, index) => {
      const normalizedUrl = `https://example.com/duplicate-${index}`;
      return page({
        id: `duplicate-page-${index}`,
        requestedUrl: normalizedUrl,
        normalizedUrl,
        finalUrl: normalizedUrl,
        extraction: extraction({
          id: `duplicate-extraction-${index}`,
          title: "One shared title",
        }),
      });
    });
    const report = evaluate("ONS-003", snapshot({ pages }));

    expect(report.failures).toEqual([]);
    expect(report.results).toHaveLength(500);
    expect(report.results.every((result) => result.status === "failed")).toBe(true);
    expect(report.results.every((result) => result.evidence.length <= 13)).toBe(true);
  });

  it("keeps large heading-hierarchy findings within the result contract", () => {
    const headings = Array.from({ length: 1_000 }, (_, index) => ({
      id: `heading-${index}`,
      level: (index % 2 === 0 ? 1 : 3) as 1 | 3,
      ordinal: index,
      text: `Section ${index}`,
    }));
    const report = evaluate(
      "ONS-017",
      snapshot({ pages: [page({ extraction: extraction({ headings, headingsComplete: true }) })] }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]?.status).toBe("failed");
    expect(report.results[0]?.detectedValue.length).toBeLessThan(2_000);
  });

  it("bounds empty-H1 evidence while preserving the exact observed total", () => {
    const headings = Array.from({ length: 25_000 }, (_, index) => ({
      id: `empty-heading-${index}`,
      level: 1 as const,
      ordinal: index,
      text: "",
    }));
    const report = evaluate(
      "ONS-014",
      snapshot({ pages: [page({ extraction: extraction({ headings, headingsComplete: true }) })] }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]?.status).toBe("failed");
    expect(report.results[0]?.detectedValue).toBe("25000 of 25000 H1 heading(s) were empty.");
    const sample = report.results[0]?.evidence[0]?.value;
    expect(Array.isArray(sample)).toBe(true);
    expect(sample).toHaveLength(24);
    expect(sample?.at(-1)).toMatch(/^omitted=24977; sha256:[0-9a-f]{64}$/u);
  });
});
