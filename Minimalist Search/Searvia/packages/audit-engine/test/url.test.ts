import { describe, expect, it } from "vitest";

import { VersionedAuditEngine } from "../src/engine.js";
import { URL_RULES } from "../src/rules/url.js";
import {
  extraction,
  fixtureSet,
  page,
  redirect,
  snapshot,
  type RuleFixtureSet,
} from "./fixtures.js";

function canonicalPair(
  input: Readonly<{
    sourceUrl?: string;
    targetUrl?: string;
    sourceExtraction?: ReturnType<typeof extraction>;
    target?: ReturnType<typeof page>;
  }> = {},
) {
  const sourceUrl = input.sourceUrl ?? "https://example.com/source";
  const targetUrl = input.targetUrl ?? "https://example.com/target";
  const source = page({
    id: "page-source",
    requestedUrl: sourceUrl,
    normalizedUrl: sourceUrl,
    finalUrl: sourceUrl,
    importance: "important",
    discoverySource: "link",
    extraction:
      input.sourceExtraction ??
      extraction({ id: "extract-source", canonicalUrl: targetUrl, canonicalTagCount: 1 }),
  });
  const target =
    input.target ??
    page({
      id: "page-target",
      requestedUrl: targetUrl,
      normalizedUrl: targetUrl,
      finalUrl: targetUrl,
      extraction: extraction({ id: "extract-target", canonicalUrl: targetUrl }),
    });
  return [source, target] as const;
}

function sameHashPeer(url: string, id: string, hash = "a".repeat(64)) {
  return page({
    id,
    requestedUrl: url,
    normalizedUrl: url,
    finalUrl: url,
    extraction: extraction({ id: `extract-${id}`, canonicalUrl: url, contentHash: hash }),
  });
}

const urlFixtures: Readonly<Record<string, RuleFixtureSet>> = Object.freeze({
  "URL-001": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [page({ extraction: extraction({ canonicalTagCount: 0, canonicalUrl: null }) })],
    }),
    boundary: snapshot({ pages: [page({ extraction: null })] }),
  }),
  "URL-002": fixtureSet({
    passing: snapshot(),
    failing: snapshot({ pages: [page({ extraction: extraction({ canonicalTagCount: 2 }) })] }),
    boundary: snapshot({ pages: [page({ extraction: null })] }),
  }),
  "URL-003": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [
        page({
          extraction: extraction({
            canonicalTagCount: 1,
            canonicalUrl: null,
            canonicalNormalizationFailure: { code: "unsupported_protocol" },
          }),
        }),
      ],
    }),
    boundary: snapshot({
      pages: [
        page({
          extraction: extraction({
            canonicalTagCount: 1,
            canonicalUrl: null,
            canonicalNormalizationFailure: null,
          }),
        }),
      ],
    }),
  }),
  "URL-004": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: canonicalPair({
        target: page({
          id: "page-target",
          requestedUrl: "https://example.com/target",
          normalizedUrl: "https://example.com/target",
          finalUrl: "https://example.com/final",
          redirectChain: [redirect()],
        }),
      }),
    }),
    boundary: snapshot({ pages: [canonicalPair()[0]] }),
  }),
  "URL-005": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: canonicalPair({
        target: page({
          id: "page-target",
          normalizedUrl: "https://example.com/target",
          statusCode: 404,
        }),
      }),
    }),
    boundary: snapshot({ pages: [canonicalPair()[0]] }),
  }),
  "URL-006": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: canonicalPair({
        target: page({
          id: "page-target",
          normalizedUrl: "https://example.com/target",
          statusCode: 503,
        }),
      }),
    }),
    boundary: snapshot({ pages: [canonicalPair()[0]] }),
  }),
  "URL-007": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: canonicalPair({
        target: page({
          id: "page-target",
          normalizedUrl: "https://example.com/target",
          extraction: extraction({ id: "extract-target", metaRobots: ["noindex"] }),
        }),
      }),
    }),
    boundary: snapshot({ pages: [canonicalPair()[0]] }),
  }),
  "URL-008": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [page({ extraction: extraction({ canonicalUrl: "https://other.example/page" }) })],
    }),
    boundary: snapshot({
      pages: [page({ extraction: extraction({ canonicalTagCount: 1, canonicalUrl: null }) })],
    }),
  }),
  "URL-009": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [
        page({
          id: "page-a",
          normalizedUrl: "https://example.com/a",
          extraction: extraction({ id: "extract-a", canonicalUrl: "https://example.com/b" }),
        }),
        page({
          id: "page-b",
          normalizedUrl: "https://example.com/b",
          extraction: extraction({ id: "extract-b", canonicalUrl: "https://example.com/a" }),
        }),
      ],
    }),
    boundary: snapshot({ pages: [canonicalPair()[0]] }),
  }),
  "URL-010": fixtureSet({
    passing: snapshot({ pages: canonicalPair() }),
    failing: snapshot({
      pages: canonicalPair({
        target: page({
          id: "page-target",
          normalizedUrl: "https://example.com/target",
          extraction: extraction({
            id: "extract-target",
            canonicalUrl: "https://example.com/target",
            contentHash: "b".repeat(64),
            similarityFingerprint: "ffffffffffffffff",
          }),
        }),
      }),
    }),
    boundary: snapshot({ pages: [canonicalPair()[0]] }),
  }),
  "URL-011": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [page({ extraction: extraction({ canonicalUrl: "http://www.example.com/" }) })],
    }),
    boundary: snapshot({
      pages: [page({ extraction: extraction({ canonicalUrl: "https://example.com/different" }) })],
    }),
  }),
  "URL-012": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [page(), sameHashPeer("https://example.com/duplicate", "page-duplicate")],
    }),
    boundary: snapshot({ status: "partially_completed" }),
  }),
  "URL-013": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [
        page(),
        page({
          id: "page-near",
          normalizedUrl: "https://example.com/near",
          extraction: extraction({
            id: "extract-near",
            canonicalUrl: "https://example.com/near",
            contentHash: "b".repeat(64),
            similarityFingerprint: "0000000000000001",
          }),
        }),
      ],
    }),
    boundary: snapshot({ status: "partially_completed" }),
  }),
  "URL-014": fixtureSet({
    passing: snapshot({
      pages: [
        sameHashPeer("https://example.com/items?view=a", "page-a", "a".repeat(64)),
        sameHashPeer("https://example.com/items?view=b", "page-b", "b".repeat(64)),
      ],
    }),
    failing: snapshot({
      pages: [
        sameHashPeer("https://example.com/items?view=a", "page-a"),
        sameHashPeer("https://example.com/items?view=b", "page-b"),
      ],
    }),
    boundary: snapshot({
      configuration: {
        maxDepth: 5,
        redirectLimit: 5,
        maxResponseBytes: 5_000_000,
        queryPolicy: "ignore_tracking",
      },
    }),
  }),
  "URL-015": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [
        sameHashPeer("https://example.com/About", "page-upper"),
        sameHashPeer("https://example.com/about", "page-lower"),
      ],
    }),
    boundary: snapshot({ status: "partially_completed" }),
  }),
  "URL-016": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [
        sameHashPeer("https://example.com/about", "page-no-slash"),
        sameHashPeer("https://example.com/about/", "page-slash"),
      ],
    }),
    boundary: snapshot({ status: "partially_completed" }),
  }),
  "URL-017": fixtureSet({
    passing: snapshot({
      pages: [
        sameHashPeer("https://example.com/docs/index.html", "page-index", "a".repeat(64)),
        sameHashPeer("https://example.com/docs/", "page-directory", "b".repeat(64)),
      ],
    }),
    failing: snapshot({
      pages: [
        sameHashPeer("https://example.com/docs/index.html", "page-index"),
        sameHashPeer("https://example.com/docs/", "page-directory"),
      ],
    }),
    boundary: snapshot({
      pages: [sameHashPeer("https://example.com/docs/index.html", "page-index")],
    }),
  }),
  "URL-018": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [page({ normalizedUrl: `https://example.com/${"long-segment-".repeat(12)}` })],
    }),
    boundary: snapshot({
      pages: [page({ normalizedUrl: `https://example.com/${"x".repeat(95)}` })],
    }),
    boundaryStatus: "passed",
  }),
  "URL-019": fixtureSet({
    passing: snapshot(),
    failing: snapshot({ pages: [page({ requestedUrl: "https://example.com/bad%ZZ" })] }),
    boundary: snapshot({ pages: [] }),
  }),
  "URL-020": fixtureSet({
    passing: snapshot({
      pages: [
        page({
          normalizedUrl: "https://example.com/articles?page=2",
          requestedUrl: "https://example.com/articles?page=2",
          extraction: extraction({ canonicalUrl: "https://example.com/articles?page=2" }),
        }),
      ],
    }),
    failing: snapshot({
      pages: [
        page({
          normalizedUrl: "https://example.com/articles?page=2",
          requestedUrl: "https://example.com/articles?page=2",
          extraction: extraction({ canonicalUrl: "https://example.com/articles" }),
        }),
      ],
    }),
    boundary: snapshot(),
  }),
});

describe("URL-001 through URL-020", () => {
  it("registers exactly the requested stable rule IDs", () => {
    expect(URL_RULES.map((rule) => rule.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `URL-${String(index + 1).padStart(3, "0")}`),
    );
  });

  for (const rule of URL_RULES) {
    it(`${rule.id} has passing, failing, and boundary/unavailable fixtures`, () => {
      const fixtures = urlFixtures[rule.id];
      expect(fixtures, `${rule.id} fixture set`).toBeDefined();
      if (fixtures === undefined) return;
      const engine = new VersionedAuditEngine([rule]);
      const passing = engine.evaluate(fixtures.passing);
      const failing = engine.evaluate(fixtures.failing);
      const boundary = engine.evaluate(fixtures.boundary);

      expect(passing.failures).toEqual([]);
      expect(passing.results.some((result) => result.status === "passed")).toBe(true);
      expect(failing.failures).toEqual([]);
      expect(failing.results.some((result) => result.status === "failed")).toBe(true);
      for (const finding of failing.results.filter((result) => result.status === "failed")) {
        expect(finding.evidence.length, `${rule.id} evidence`).toBeGreaterThan(0);
        expect(finding.detectedValue, `${rule.id} detected value`).not.toBe(finding.expectedValue);
        expect(finding.explanation.length, `${rule.id} explanation`).toBeGreaterThan(20);
        expect(finding.recommendedFix.length, `${rule.id} fix`).toBeGreaterThan(40);
        expect(Buffer.byteLength(JSON.stringify(finding.evidence), "utf8")).toBeLessThanOrEqual(
          65_536,
        );
      }
      expect(boundary.failures).toEqual([]);
      expect(boundary.results.some((result) => result.status === fixtures.boundaryStatus)).toBe(
        true,
      );
    });
  }

  it("records both URL-010 pages and hashes in actionable comparison evidence", () => {
    const rule = URL_RULES.find((candidate) => candidate.id === "URL-010")!;
    const report = new VersionedAuditEngine([rule]).evaluate(urlFixtures["URL-010"].failing);
    const finding = report.results.find((result) => result.status === "failed");

    expect(finding).toBeDefined();
    const byField = new Map(finding?.evidence.map((item) => [item.field, item]));
    expect(byField.get("source_content_hash")).toMatchObject({
      observationId: "extract-source",
      url: "https://example.com/source",
      value: "a".repeat(64),
    });
    expect(byField.get("canonical_target_url")).toMatchObject({
      value: "https://example.com/target",
    });
    expect(byField.get("canonical_target_content_hash")).toMatchObject({
      observationId: "extract-target",
      url: "https://example.com/target",
      value: "b".repeat(64),
    });
    expect(byField.get("canonical_content_distance")?.value).toBeGreaterThan(0);
  });

  it("records bounded structured URL-003 failure evidence without canonical raw values", () => {
    const rule = URL_RULES.find((candidate) => candidate.id === "URL-003")!;
    const targetUrl = "https://example.com/source?token=super-secret";
    const report = new VersionedAuditEngine([rule]).evaluate(
      snapshot({
        pages: [
          page({
            requestedUrl: targetUrl,
            normalizedUrl: targetUrl,
            finalUrl: targetUrl,
            extraction: extraction({
              canonicalUrl: null,
              canonicalTagCount: 1,
              canonicalNormalizationFailure: { code: "userinfo_not_allowed" },
            }),
          }),
        ],
      }),
    );
    const finding = report.results[0];

    expect(rule.version).toBe(3);
    expect(finding).toMatchObject({
      status: "failed",
      eligibility: { state: "eligible" },
      detectedValue: "Canonical normalization failed with userinfo_not_allowed.",
    });
    expect(finding?.evidence).toEqual([
      expect.objectContaining({
        field: "canonical_tag_count",
        value: 1,
        source: "raw",
        url: "https://example.com/source?token=[redacted]",
      }),
      expect.objectContaining({
        field: "canonical_normalization_failure_code",
        value: "userinfo_not_allowed",
        source: "raw",
        url: "https://example.com/source?token=[redacted]",
      }),
    ]);
    expect(JSON.stringify(finding)).not.toContain("super-secret");
  });

  it("keeps legacy URL-003 normalization provenance unknown instead of passing or failing", () => {
    const rule = URL_RULES.find((candidate) => candidate.id === "URL-003")!;
    const report = new VersionedAuditEngine([rule]).evaluate(urlFixtures["URL-003"].boundary);

    expect(report.failures).toEqual([]);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["raw-extraction"] },
    });
    expect(report.results[0]?.evidence).toEqual([
      expect.objectContaining({ field: "canonical_tag_count", value: 1 }),
      expect.objectContaining({
        field: "canonical_normalization_failure_code",
        value: "not_recorded",
      }),
    ]);
  });

  it("does not treat redirects or rendered-only observations as eligible raw-page passes", () => {
    const missingCanonical = new VersionedAuditEngine([
      URL_RULES.find((rule) => rule.id === "URL-001")!,
    ]).evaluate(snapshot({ pages: [page({ statusCode: 302 })] }));
    const multipleCanonical = new VersionedAuditEngine([
      URL_RULES.find((rule) => rule.id === "URL-002")!,
    ]).evaluate(snapshot({ pages: [page({ extraction: extraction({ source: "rendered" }) })] }));

    expect(missingCanonical.results.every((result) => result.status === "not-checked")).toBe(true);
    expect(multipleCanonical.results.every((result) => result.status === "not-checked")).toBe(true);
  });

  it("does not omit legacy directive-scope coverage from URL-001", () => {
    const rule = URL_RULES.find((candidate) => candidate.id === "URL-001")!;
    const known = page({
      id: "page-known",
      requestedUrl: "https://example.com/known",
      normalizedUrl: "https://example.com/known",
      finalUrl: "https://example.com/known",
      extraction: extraction({ id: "extract-known" }),
    });
    const legacyMissing = page({
      id: "page-legacy-missing",
      requestedUrl: "https://example.com/legacy-missing",
      normalizedUrl: "https://example.com/legacy-missing",
      finalUrl: "https://example.com/legacy-missing",
      extraction: extraction({
        id: "extract-legacy-missing",
        canonicalTagCount: 0,
        canonicalUrl: null,
        directiveScopePreserved: false,
      }),
    });
    const legacyPresent = page({
      id: "page-legacy-present",
      requestedUrl: "https://example.com/legacy-present",
      normalizedUrl: "https://example.com/legacy-present",
      finalUrl: "https://example.com/legacy-present",
      extraction: extraction({
        id: "extract-legacy-present",
        canonicalUrl: "https://example.com/legacy-present",
        directiveScopePreserved: false,
      }),
    });
    const report = new VersionedAuditEngine([rule]).evaluate(
      snapshot({ pages: [known, legacyMissing, legacyPresent] }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results.find((result) => result.target.pageId === known.id)?.status).toBe(
      "passed",
    );
    for (const legacy of [legacyMissing, legacyPresent]) {
      expect(report.results.find((result) => result.target.pageId === legacy.id)).toMatchObject({
        status: "not-checked",
        eligibility: { state: "unavailable", missingData: ["raw-extraction"] },
      });
    }

    const knownFailure = page({
      ...known,
      extraction: extraction({
        id: "extract-known-failure",
        canonicalTagCount: 0,
        canonicalUrl: null,
      }),
    });
    const failureFirst = new VersionedAuditEngine([rule]).evaluate(
      snapshot({ pages: [knownFailure, legacyPresent] }),
    );
    expect(
      failureFirst.results.find((result) => result.target.pageId === knownFailure.id)?.status,
    ).toBe("failed");
    expect(
      failureFirst.results.find((result) => result.target.pageId === legacyPresent.id)?.status,
    ).toBe("not-checked");
  });

  it("does not pass canonical transport rules when target status is unavailable", () => {
    for (const id of ["URL-004", "URL-005", "URL-006"] as const) {
      const rule = URL_RULES.find((candidate) => candidate.id === id)!;
      const result = new VersionedAuditEngine([rule]).evaluate(
        snapshot({
          pages: canonicalPair({
            target: page({
              id: "page-target",
              normalizedUrl: "https://example.com/target",
              statusCode: null,
            }),
          }),
        }),
      );
      expect(result.results[0]?.status, id).toBe("not-checked");
    }
  });

  it("treats duplicate normalized target observations as ambiguous regardless of order", () => {
    const source = canonicalPair()[0];
    const targetA = page({
      id: "target-a",
      normalizedUrl: "https://example.com/target",
      statusCode: 200,
    });
    const targetB = page({
      id: "target-b",
      normalizedUrl: "https://example.com/target",
      statusCode: 404,
    });
    const rule = URL_RULES.find((candidate) => candidate.id === "URL-004")!;
    for (const targets of [
      [targetA, targetB],
      [targetB, targetA],
    ]) {
      const report = new VersionedAuditEngine([rule]).evaluate(
        snapshot({ pages: [source, ...targets] }),
      );
      expect(report.results[0]?.status).toBe("not-checked");
    }
  });

  it("requires conclusive canonical-target robots and directive ownership", () => {
    const rule = URL_RULES.find((candidate) => candidate.id === "URL-007")!;
    const unavailableRobots = new VersionedAuditEngine([rule]).evaluate(
      snapshot({
        pages: canonicalPair({
          target: page({
            id: "page-target",
            normalizedUrl: "https://example.com/target",
            robotsDecision: "not-checked",
          }),
        }),
      }),
    );
    const flattenedDirective = new VersionedAuditEngine([rule]).evaluate(
      snapshot({
        pages: canonicalPair({
          target: page({
            id: "page-target",
            normalizedUrl: "https://example.com/target",
            extraction: extraction({
              id: "extract-target",
              metaRobots: ["noindex"],
              directiveScopePreserved: false,
            }),
          }),
        }),
      }),
    );
    const flattenedPassingValues = new VersionedAuditEngine([rule]).evaluate(
      snapshot({
        pages: canonicalPair({
          target: page({
            id: "page-target",
            normalizedUrl: "https://example.com/target",
            extraction: extraction({
              id: "extract-target",
              directiveScopePreserved: false,
            }),
          }),
        }),
      }),
    );
    const conclusiveBlock = new VersionedAuditEngine([rule]).evaluate(
      snapshot({
        pages: canonicalPair({
          target: page({
            id: "page-target",
            normalizedUrl: "https://example.com/target",
            robotsDecision: "disallowed",
            extraction: extraction({
              id: "extract-target",
              directiveScopePreserved: false,
            }),
          }),
        }),
      }),
    );
    expect(unavailableRobots.results[0]?.status).toBe("not-checked");
    expect(flattenedDirective.results[0]?.status).toBe("not-checked");
    expect(flattenedPassingValues.results[0]?.status).toBe("not-checked");
    expect(conclusiveBlock.results[0]?.status).toBe("failed");
  });

  it.each(["URL-012", "URL-013", "URL-014", "URL-015", "URL-016"] as const)(
    "does not pass %s corpus absence when directive scope is unavailable",
    (id) => {
      const rule = URL_RULES.find((candidate) => candidate.id === id)!;
      const baseUrl =
        id === "URL-014" ? "https://example.com/items?view=known" : "https://example.com/known";
      const known = page({
        id: `page-known-${id}`,
        requestedUrl: baseUrl,
        normalizedUrl: baseUrl,
        finalUrl: baseUrl,
        extraction: extraction({
          id: `extract-known-${id}`,
          canonicalUrl: baseUrl,
          contentHash: "a".repeat(64),
          similarityFingerprint: "0000000000000000",
        }),
      });
      const legacyUrl =
        id === "URL-014" ? "https://example.com/items?view=legacy" : "https://example.com/legacy";
      const legacy = page({
        id: `page-legacy-${id}`,
        requestedUrl: legacyUrl,
        normalizedUrl: legacyUrl,
        finalUrl: legacyUrl,
        extraction: extraction({
          id: `extract-legacy-${id}`,
          canonicalUrl: legacyUrl,
          contentHash: "b".repeat(64),
          similarityFingerprint: "ffffffffffffffff",
          directiveScopePreserved: false,
        }),
      });
      const report = new VersionedAuditEngine([rule]).evaluate(
        snapshot({ pages: [known, legacy] }),
      );

      expect(report.failures).toEqual([]);
      expect(report.results.some((result) => result.status === "passed")).toBe(false);
      expect(report.results.some((result) => result.status === "not-checked")).toBe(true);
    },
  );

  it.each(["URL-012", "URL-013", "URL-014", "URL-015", "URL-016"] as const)(
    "preserves conclusive %s failures when unrelated directive scope is unavailable",
    (id) => {
      const rule = URL_RULES.find((candidate) => candidate.id === id)!;
      const fixture = urlFixtures[id].failing;
      const legacyUrl = `https://example.com/legacy-${id.toLowerCase()}`;
      const report = new VersionedAuditEngine([rule]).evaluate(
        snapshot({
          ...fixture,
          pages: [
            ...fixture.pages,
            page({
              id: `page-legacy-${id}`,
              requestedUrl: legacyUrl,
              normalizedUrl: legacyUrl,
              finalUrl: legacyUrl,
              extraction: extraction({
                id: `extract-legacy-${id}`,
                canonicalUrl: legacyUrl,
                contentHash: "c".repeat(64),
                directiveScopePreserved: false,
              }),
            }),
          ],
        }),
      );

      expect(report.failures).toEqual([]);
      expect(report.results.some((result) => result.status === "failed")).toBe(true);
    },
  );

  it("does not conclude canonical-chain or corpus passes from incomplete raw observations", () => {
    const loopRule = URL_RULES.find((candidate) => candidate.id === "URL-009")!;
    const duplicateRule = URL_RULES.find((candidate) => candidate.id === "URL-012")!;
    const loop = new VersionedAuditEngine([loopRule]).evaluate(
      snapshot({
        pages: [
          canonicalPair()[0],
          page({
            id: "page-target",
            normalizedUrl: "https://example.com/target",
            extraction: null,
          }),
        ],
      }),
    );
    const duplicate = new VersionedAuditEngine([duplicateRule]).evaluate(
      snapshot({
        pages: [
          page(),
          page({
            id: "page-unknown",
            normalizedUrl: "https://example.com/unknown",
            extraction: null,
          }),
        ],
      }),
    );
    expect(loop.results[0]?.status).toBe("not-checked");
    expect(duplicate.results.some((result) => result.status === "passed")).toBe(false);
    expect(duplicate.results.some((result) => result.status === "not-checked")).toBe(true);
  });

  it("never mistakes missing query extraction for a duplicate and redacts query values in evidence", () => {
    const rule = URL_RULES.find((candidate) => candidate.id === "URL-014")!;
    const missing = new VersionedAuditEngine([rule]).evaluate(
      snapshot({
        pages: [
          sameHashPeer("https://example.com/items?token=secret-a", "page-a"),
          page({
            id: "page-b",
            requestedUrl: "https://example.com/items?token=secret-b",
            normalizedUrl: "https://example.com/items?token=secret-b",
            extraction: null,
          }),
        ],
      }),
    );
    const failed = new VersionedAuditEngine([rule]).evaluate(urlFixtures["URL-014"]!.failing);
    const serializedEvidence = JSON.stringify(failed.results.flatMap((result) => result.evidence));

    expect(missing.results.some((result) => result.status === "failed")).toBe(false);
    expect(missing.results.some((result) => result.status === "not-checked")).toBe(true);
    expect(serializedEvidence).not.toContain("view=a");
    expect(serializedEvidence).not.toContain("view=b");
    expect(serializedEvidence).toContain("redacted");
  });

  it("does not fabricate raw-source evidence when URL eligibility has no extraction", () => {
    const rule = URL_RULES.find((candidate) => candidate.id === "URL-001")!;
    const result = new VersionedAuditEngine([rule]).evaluate(
      snapshot({ pages: [page({ extraction: null })] }),
    ).results[0];

    expect(result?.status).toBe("not-checked");
    expect(result?.evidence.some((item) => item.source === "raw")).toBe(false);
    expect(result?.evidence).toEqual([
      expect.objectContaining({
        observationId: "page-home",
        source: "transport",
        field: "eligibility_transport",
      }),
    ]);
  });

  it("attributes every URL-009 cycle edge to its contributing extraction", () => {
    const rule = URL_RULES.find((candidate) => candidate.id === "URL-009")!;
    const result = new VersionedAuditEngine([rule]).evaluate(urlFixtures["URL-009"]!.failing)
      .results[0];
    const edgeEvidence = result?.evidence.filter((item) => item.field === "canonical_cycle_edge");

    expect(rule.version).toBe(4);
    expect(result?.status).toBe("failed");
    expect(edgeEvidence?.map((item) => item.observationId)).toEqual(["extract-a", "extract-b"]);
    expect(edgeEvidence?.every((item) => item.source === "raw")).toBe(true);
  });

  it.each(["URL-012", "URL-013", "URL-014", "URL-015", "URL-016"] as const)(
    "%s records source and peer extraction provenance",
    (id) => {
      const rule = URL_RULES.find((candidate) => candidate.id === id)!;
      const result = new VersionedAuditEngine([rule]).evaluate(urlFixtures[id].failing).results[0];
      const extractionEvidence = result?.evidence.filter((item) => item.source === "raw") ?? [];

      expect(result?.status).toBe("failed");
      expect(new Set(extractionEvidence.map((item) => item.observationId)).size).toBeGreaterThan(1);
      expect(
        extractionEvidence.every((item) => item.observedAt === "2026-07-16T12:00:00.000Z"),
      ).toBe(true);
    },
  );

  it("records both URL-017 extraction hashes with their own provenance", () => {
    const rule = URL_RULES.find((candidate) => candidate.id === "URL-017")!;
    const result = new VersionedAuditEngine([rule]).evaluate(urlFixtures["URL-017"]!.failing)
      .results[0];

    expect(rule.version).toBe(3);
    expect(result?.status).toBe("failed");
    expect(result?.evidence.map((item) => item.observationId)).toEqual([
      "extract-page-index",
      "extract-page-directory",
    ]);
  });

  it("keeps long, high-cardinality URL comparison evidence bounded and reproducible", () => {
    const longPath = "duplicate-segment-".repeat(190);
    const pages = Array.from({ length: 15 }, (_, index) =>
      sameHashPeer(`https://example.com/${longPath}${index}`, `long-duplicate-${index}`),
    );
    const rule = URL_RULES.find((candidate) => candidate.id === "URL-012")!;
    const engine = new VersionedAuditEngine([rule]);
    const input = snapshot({ pages });
    const report = engine.evaluate(input);
    const serializedEvidence = JSON.stringify(report.results[0]?.evidence);

    expect(report.failures).toEqual([]);
    expect(report.results.every((result) => result.status === "failed")).toBe(true);
    expect(Buffer.byteLength(serializedEvidence, "utf8")).toBeLessThanOrEqual(65_536);
    expect(serializedEvidence).toContain("sha256:");
    expect(engine.evaluate(input)).toEqual(report);
  });

  it("reports exact crawl, transport, and robots gaps for URL corpus rules", () => {
    const rule = URL_RULES.find((candidate) => candidate.id === "URL-012")!;
    const evaluate = (input: ReturnType<typeof snapshot>) =>
      new VersionedAuditEngine([rule]).evaluate(input).results[0];

    expect(evaluate(snapshot({ status: "partially_completed" }))?.eligibility).toMatchObject({
      missingData: ["crawl"],
    });
    expect(evaluate(snapshot({ pages: [page({ statusCode: null })] }))?.eligibility).toMatchObject({
      missingData: ["transport"],
    });
    expect(
      evaluate(snapshot({ pages: [page({ robotsDecision: "not-checked" })] }))?.eligibility,
    ).toMatchObject({ missingData: ["robots"] });
  });
});
