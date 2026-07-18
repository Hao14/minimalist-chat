import { describe, expect, it } from "vitest";

import type { AuditRuleDefinition } from "../src/contracts.js";
import { VersionedAuditEngine } from "../src/engine.js";
import {
  checkedOutcome,
  crawlEvidence,
  defineRule,
  evidence,
  pageTarget,
  pageEvidence,
  sampleEvidenceStrings,
  siteTarget,
} from "../src/rules/helpers.js";
import { extraction, page, snapshot } from "./fixtures.js";

const validRule = defineRule(
  {
    id: "CRW-001",
    title: "Contract fixture",
    category: "crawlability",
    defaultSeverity: "critical",
    scope: "site",
    description: "Exercises the engine contract.",
    eligibility: "A completed crawl exists.",
    requiredData: ["crawl"],
    explanation: "The fixture explains the deterministic result.",
    expectedValue: "The fixture remains healthy.",
    recommendedFix: "Correct the fixture input and run the same rule version again.",
    verification: "Re-run the fixture and inspect the evidence.",
    confidence: "high",
    impactAreas: ["crawlability"],
    responsibleOwner: "developer",
  },
  (input) => [
    checkedOutcome({
      target: siteTarget(input),
      failed: false,
      evidence: [crawlEvidence(input, "fixture", "healthy")],
      detectedValue: "The fixture is healthy.",
    }),
  ],
);

describe("VersionedAuditEngine", () => {
  it("is repeatable for the same immutable snapshot and rule versions", () => {
    const engine = new VersionedAuditEngine([validRule]);
    expect(engine.evaluate(snapshot())).toEqual(engine.evaluate(snapshot()));
  });

  it("reports failures, warnings, opportunities, and manual reviews separately", () => {
    const resultRule = (
      id: AuditRuleDefinition["id"],
      status: "failed" | "warning" | "opportunity" | "manual-review",
    ): AuditRuleDefinition =>
      Object.freeze({
        ...validRule,
        id,
        evaluate(input) {
          return [
            {
              target: siteTarget(input),
              eligibility: { state: "eligible", reason: "The fixture is eligible." },
              status,
              evidence: [crawlEvidence(input, "fixture_status", status)],
              detectedValue: `The fixture produced ${status}.`,
            },
          ];
        },
      });
    const unavailable: AuditRuleDefinition = Object.freeze({
      ...validRule,
      id: "CRW-006",
      evaluate() {
        throw new Error("fixture detector failure");
      },
    });
    const report = new VersionedAuditEngine([
      validRule,
      resultRule("CRW-002", "failed"),
      resultRule("CRW-003", "warning"),
      resultRule("CRW-004", "opportunity"),
      resultRule("CRW-005", "manual-review"),
      unavailable,
    ]).evaluate(snapshot());

    expect(report.counts).toEqual({
      rules: 6,
      results: 6,
      eligible: 5,
      evaluated: 5,
      failed: 1,
      warning: 1,
      opportunity: 1,
      manualReview: 1,
      passed: 1,
      notChecked: 1,
    });
  });

  it("redacts page-target query and fragment details without collapsing variant identity", () => {
    const firstSecret = "first-query-secret";
    const secondSecret = "second-query-secret";
    const fragmentSecret = "fragment-secret";
    const firstUrl = `https://example.com/items?token=${firstSecret}#${fragmentSecret}`;
    const secondUrl = `https://example.com/items?token=${secondSecret}`;
    const targetRule = defineRule(
      {
        id: "URL-019",
        title: "Privacy-safe target fixture",
        category: "urls-canonicals",
        defaultSeverity: "high",
        scope: "page",
        description: "Exercises privacy-safe page target normalization.",
        eligibility: "A page observation exists.",
        requiredData: ["pages"],
        explanation: "Page target identity must not expose query or fragment values.",
        expectedValue: "Every page target retains distinct privacy-safe identity.",
        recommendedFix: "Keep page target normalization at the engine output boundary.",
        verification: "Inspect both normalized result targets and compare their fingerprints.",
        confidence: "high",
        impactAreas: ["search-visibility"],
        responsibleOwner: "developer",
      },
      (input) =>
        input.pages.map((observation) =>
          checkedOutcome({
            target: pageTarget(observation),
            failed: false,
            evidence: [pageEvidence(observation, "status_code", observation.statusCode)],
            detectedValue: "The page target was observed.",
          }),
        ),
    );
    const input = snapshot({
      pages: [
        page({
          id: "page-first-query",
          requestedUrl: firstUrl,
          normalizedUrl: firstUrl,
          finalUrl: firstUrl,
        }),
        page({
          id: "page-second-query",
          requestedUrl: secondUrl,
          normalizedUrl: secondUrl,
          finalUrl: secondUrl,
        }),
      ],
    });
    const report = new VersionedAuditEngine([targetRule]).evaluate(input);
    const targets = report.results.map((result) => result.target.normalizedUrl);
    const serialized = JSON.stringify(report.results);

    expect(report.failures).toEqual([]);
    expect(new Set(targets).size).toBe(2);
    expect(targets).toEqual(
      input.pages
        .map(
          (observation) =>
            `https://example.com/items?__searvia_detail_sha256=${observation.urlHash}`,
        )
        .sort(),
    );
    expect(
      targets.every((target) =>
        /^https:\/\/example\.com\/items\?__searvia_detail_sha256=[a-f0-9]{64}$/u.test(target ?? ""),
      ),
    ).toBe(true);
    expect(
      report.results.every((result) => result.target.key === result.target.normalizedUrl),
    ).toBe(true);
    expect(serialized).not.toContain(firstSecret);
    expect(serialized).not.toContain(secondSecret);
    expect(serialized).not.toContain(fragmentSecret);
    expect(new VersionedAuditEngine([targetRule]).evaluate(input)).toEqual(report);
  });

  it("rejects a page target whose URL does not match its snapshot page ID", () => {
    const first = page({ id: "page-first", normalizedUrl: "https://example.com/first" });
    const second = page({ id: "page-second", normalizedUrl: "https://example.com/second" });
    const mismatched: AuditRuleDefinition = Object.freeze({
      ...validRule,
      id: "URL-020",
      scope: "page",
      evaluate() {
        return [
          checkedOutcome({
            target: {
              scope: "page",
              key: second.normalizedUrl,
              pageId: first.id,
              normalizedUrl: second.normalizedUrl,
            },
            failed: false,
            evidence: [pageEvidence(first, "status_code", first.statusCode)],
            detectedValue: "The mismatched target must not be persisted.",
          }),
        ];
      },
    });

    const report = new VersionedAuditEngine([mismatched]).evaluate(
      snapshot({ pages: [first, second] }),
    );

    expect(report.results).toEqual([
      expect.objectContaining({
        status: "not-checked",
        target: expect.objectContaining({ pageId: null }),
      }),
    ]);
    expect(report.failures).toEqual([
      expect.objectContaining({
        ruleId: "URL-020",
        errorType: "invalid-result",
        message: expect.stringMatching(/does not match its ID/u),
      }),
    ]);
  });

  it("attributes transport and extraction evidence to their own observation times", () => {
    const observation = page({
      observedAt: "2026-07-16T10:01:00.000Z",
      extraction: extraction({ id: "raw-observation", extractedAt: "2026-07-16T10:02:00.000Z" }),
      renderedExtraction: extraction({
        id: "rendered-observation",
        source: "rendered",
        extractedAt: "2026-07-16T10:03:00.000Z",
      }),
    });
    expect(pageEvidence(observation, "status_code", 200).observedAt).toBe(
      "2026-07-16T10:01:00.000Z",
    );
    expect(pageEvidence(observation, "title", "Example", "raw").observedAt).toBe(
      "2026-07-16T10:02:00.000Z",
    );
    expect(pageEvidence(observation, "title", "Example", "raw").observationId).toBe(
      "raw-observation",
    );
    expect(pageEvidence(observation, "title", "Example", "rendered")).toMatchObject({
      observationId: "rendered-observation",
      observedAt: "2026-07-16T10:03:00.000Z",
      source: "rendered",
    });
  });

  it("removes failed extraction placeholders and their derived evidence before detectors run", () => {
    const unsafeSnapshot = structuredClone(
      snapshot({
        pages: [
          page({
            links: [
              {
                id: "unsafe-link",
                targetPageId: null,
                targetUrl: "https://example.com/unsafe",
                normalizedTargetUrl: "https://example.com/unsafe",
                scope: "internal",
                relValues: [],
                linkType: "anchor",
                discovered: false,
              },
            ],
            resources: [
              {
                id: "unsafe-script",
                resourceType: "script",
                sourceUrl: "/unsafe.js",
                normalizedUrl: "https://example.com/unsafe.js",
                scope: "internal",
              },
            ],
          }),
        ],
      }),
    );
    const unsafeExtraction = unsafeSnapshot.pages[0]?.extraction;
    if (unsafeExtraction === null || unsafeExtraction === undefined) {
      throw new Error("Expected an extraction fixture.");
    }
    Object.defineProperty(unsafeExtraction, "status", { value: "failed" });

    let observed:
      Readonly<{ extraction: boolean; linkCount: number; resourceCount: number }> | undefined;
    const provenanceRule: AuditRuleDefinition = Object.freeze({
      ...validRule,
      id: "CRW-015",
      evaluate(input) {
        const observedPage = input.pages[0];
        if (observedPage === undefined) throw new Error("Expected a page fixture.");
        observed = Object.freeze({
          extraction: observedPage.extraction !== null,
          linkCount: observedPage.links.length,
          resourceCount: observedPage.resources.length,
        });
        return [
          checkedOutcome({
            target: siteTarget(input),
            failed: false,
            evidence: [crawlEvidence(input, "fixture", "observed")],
            detectedValue: "The detector received the guarded snapshot.",
          }),
        ];
      },
    });

    new VersionedAuditEngine([provenanceRule]).evaluate(unsafeSnapshot);
    expect(observed).toEqual({ extraction: false, linkCount: 0, resourceCount: 0 });
  });

  it("redacts URL query values and fragments at the normalized result boundary", () => {
    const secretRule: AuditRuleDefinition = Object.freeze({
      ...validRule,
      id: "CRW-015",
      evaluate(input) {
        return [
          checkedOutcome({
            target: siteTarget(input),
            failed: true,
            evidence: [
              evidence({
                kind: "crawl",
                source: "crawl",
                observationId: input.crawlId,
                observedAt: input.finishedAt,
                field: "url_shapes",
                value: [
                  "https://example.com/path?token=query-secret&view=full#fragment-secret",
                  "https://userinfo-login-secret:userinfo-password-secret@example.com/private",
                  "https://userinfo-login-secret:userinfo-password-secret@example.com/private?token=userinfo-query-secret",
                  "//userinfo-login-secret:userinfo-password-secret@example.com/private",
                  "//userinfo-login-secret:userinfo-password-secret@example.com/private?token=userinfo-relative-query-secret",
                  "source=https://example.com/old?key=source-secret -> destination=https://example.com/new?key=destination-secret",
                  "pair=/products?view=grid&session=relative-secret",
                  "https://example.com/sitemap.xml?signature=sitemap-secret",
                  "Question? this is ordinary prose.",
                  "https://example.com/docs",
                ],
                url: "https://userinfo-login-secret:userinfo-password-secret@example.com/report?token=url-secret#url-fragment-secret",
                excerpt:
                  "Sitemap: //userinfo-login-secret:userinfo-password-secret@example.com/map.xml?signature=excerpt-secret#excerpt-fragment-secret",
              }),
            ],
            detectedValue:
              "Detected https://example.com/result?token=detected-secret#detected-fragment-secret and /relative?token=relative-detected-secret.",
            expectedValue:
              "Expected https://example.com/result?token=expected-secret#expected-fragment-secret.",
          }),
        ];
      },
    });

    const result = new VersionedAuditEngine([secretRule]).evaluate(snapshot()).results[0];
    expect(result).toBeDefined();
    const serialized = JSON.stringify(result);
    for (const secret of [
      "query-secret",
      "fragment-secret",
      "source-secret",
      "destination-secret",
      "relative-secret",
      "sitemap-secret",
      "url-secret",
      "url-fragment-secret",
      "excerpt-secret",
      "excerpt-fragment-secret",
      "detected-secret",
      "detected-fragment-secret",
      "relative-detected-secret",
      "expected-secret",
      "expected-fragment-secret",
      "userinfo-login-secret",
      "userinfo-password-secret",
      "userinfo-query-secret",
      "userinfo-relative-query-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(result?.evidence[0]).toMatchObject({
      url: "https://[redacted]@example.com/report?token=[redacted]#[redacted]",
      excerpt: "Sitemap: //[redacted]@example.com/map.xml?signature=[redacted]#[redacted]",
      value: expect.arrayContaining([
        "https://example.com/path?token=[redacted]&view=[redacted]#[redacted]",
        "https://[redacted]@example.com/private",
        "https://[redacted]@example.com/private?token=[redacted]",
        "//[redacted]@example.com/private",
        "//[redacted]@example.com/private?token=[redacted]",
        "source=https://example.com/old?key=[redacted] -> destination=https://example.com/new?key=[redacted]",
        "pair=/products?view=[redacted]&session=[redacted]",
        "https://example.com/sitemap.xml?signature=[redacted]",
        "Question? this is ordinary prose.",
        "https://example.com/docs",
      ]),
    });
    expect(result?.detectedValue).toBe(
      "Detected https://example.com/result?token=[redacted]#[redacted] and /relative?token=[redacted].",
    );
    expect(result?.expectedValue).toBe(
      "Expected https://example.com/result?token=[redacted]#[redacted].",
    );
  });

  it("rejects duplicate immutable rule versions", () => {
    expect(() => new VersionedAuditEngine([validRule, validRule])).toThrow(
      "Duplicate audit rule version CRW-001@2",
    );
  });

  it("rejects multiple active versions of the same stable rule", () => {
    const versionThree: AuditRuleDefinition = Object.freeze({ ...validRule, version: 3 });
    expect(() => new VersionedAuditEngine([validRule, versionThree])).toThrow(
      "Multiple active versions were registered for audit rule CRW-001",
    );
  });

  it("rejects a rule that does not declare deterministic evaluation", () => {
    const nonDeterministic: AuditRuleDefinition = Object.freeze({
      ...validRule,
      deterministic: false,
    });
    expect(() => new VersionedAuditEngine([nonDeterministic])).toThrow(
      "must declare deterministic evaluation",
    );
  });

  it("isolates detector failures as visible not-checked results", () => {
    const broken: AuditRuleDefinition = Object.freeze({
      ...validRule,
      id: "CRW-002",
      evaluate() {
        throw new Error("fixture detector failure");
      },
    });
    const report = new VersionedAuditEngine([validRule, broken]).evaluate(snapshot());
    expect(report.results).toHaveLength(2);
    expect(report.results.find((result) => result.ruleId === "CRW-002")?.status).toBe(
      "not-checked",
    );
    expect(report.failures).toEqual([
      expect.objectContaining({ ruleId: "CRW-002", errorType: "detector-error" }),
    ]);
  });

  it("isolates non-finite and invalidly classified evidence before persistence", () => {
    const invalidEvidenceRules: readonly AuditRuleDefinition[] = [
      Object.freeze({
        ...validRule,
        id: "CRW-002",
        evaluate(input) {
          return [
            checkedOutcome({
              target: siteTarget(input),
              failed: false,
              evidence: [crawlEvidence(input, "non_finite", Number.NaN)],
              detectedValue: "Invalid numeric evidence must be isolated.",
            }),
          ];
        },
      }),
      Object.freeze({
        ...validRule,
        id: "CRW-003",
        evaluate(input) {
          return [
            checkedOutcome({
              target: siteTarget(input),
              failed: false,
              evidence: [
                evidence({
                  kind: "invalid-kind" as "crawl",
                  source: "crawl",
                  observationId: input.crawlId,
                  observedAt: input.finishedAt,
                  field: "classification",
                  value: "invalid",
                }),
              ],
              detectedValue: "Invalid evidence classification must be isolated.",
            }),
          ];
        },
      }),
      Object.freeze({
        ...validRule,
        id: "CRW-004",
        evaluate(input) {
          return [
            checkedOutcome({
              target: siteTarget(input),
              failed: false,
              evidence: [
                evidence({
                  kind: "crawl",
                  source: "invalid-source" as "crawl",
                  observationId: input.crawlId,
                  observedAt: input.finishedAt,
                  field: "classification",
                  value: "invalid",
                }),
              ],
              detectedValue: "Invalid evidence source must be isolated.",
            }),
          ];
        },
      }),
    ];

    const report = new VersionedAuditEngine([validRule, ...invalidEvidenceRules]).evaluate(
      snapshot(),
    );

    expect(report.results.find((result) => result.ruleId === validRule.id)?.status).toBe("passed");
    expect(
      report.results
        .filter((result) => result.ruleId !== validRule.id)
        .every((result) => result.status === "not-checked"),
    ).toBe(true);
    expect(report.failures).toHaveLength(3);
    expect(report.failures.map((failure) => failure.ruleId)).toEqual([
      "CRW-002",
      "CRW-003",
      "CRW-004",
    ]);
  });

  it("isolates evidence that would be rejected by the shared persistence schema", () => {
    const invalidEvidenceRules: readonly AuditRuleDefinition[] = [
      Object.freeze({
        ...validRule,
        id: "CRW-002",
        evaluate(input) {
          return [
            checkedOutcome({
              target: siteTarget(input),
              failed: false,
              evidence: [crawlEvidence(input, "oversized_scalar", "x".repeat(4_097))],
              detectedValue: "Oversized scalar evidence must be isolated.",
            }),
          ];
        },
      }),
      Object.freeze({
        ...validRule,
        id: "CRW-003",
        evaluate(input) {
          return [
            checkedOutcome({
              target: siteTarget(input),
              failed: false,
              evidence: [
                crawlEvidence(
                  input,
                  "oversized_array",
                  Array.from({ length: 1_001 }, () => true),
                ),
              ],
              detectedValue: "Oversized array evidence must be isolated.",
            }),
          ];
        },
      }),
      Object.freeze({
        ...validRule,
        id: "CRW-004",
        evaluate(input) {
          return [
            checkedOutcome({
              target: siteTarget(input),
              failed: false,
              evidence: [
                evidence({
                  kind: "crawl",
                  source: "crawl",
                  observationId: "https://example.com/observation?token=secret",
                  observedAt: input.finishedAt,
                  field: "secret_bearing_observation_id",
                  value: "invalid",
                }),
              ],
              detectedValue: "Secret-bearing observation identity must be isolated.",
            }),
          ];
        },
      }),
    ];

    const report = new VersionedAuditEngine([validRule, ...invalidEvidenceRules]).evaluate(
      snapshot(),
    );

    expect(report.results.find((result) => result.ruleId === validRule.id)?.status).toBe("passed");
    expect(
      report.results
        .filter((result) => result.ruleId !== validRule.id)
        .every((result) => result.status === "not-checked"),
    ).toBe(true);
    expect(report.failures).toEqual([
      expect.objectContaining({
        ruleId: "CRW-002",
        errorType: "invalid-result",
        message: "Rule CRW-002 returned evidence outside the shared audit schema.",
      }),
      expect.objectContaining({
        ruleId: "CRW-003",
        errorType: "invalid-result",
        message: "Rule CRW-003 returned evidence outside the shared audit schema.",
      }),
      expect.objectContaining({
        ruleId: "CRW-004",
        errorType: "invalid-result",
        message: "Rule CRW-004 returned a secret-bearing evidence observation ID.",
      }),
    ]);
  });

  it("never accepts an ineligible result as passed", () => {
    const invalid: AuditRuleDefinition = Object.freeze({
      ...validRule,
      id: "CRW-003",
      evaluate(input) {
        return [
          {
            target: siteTarget(input),
            eligibility: { state: "unavailable", reason: "missing", missingData: ["pages"] },
            status: "passed",
            evidence: [crawlEvidence(input, "fixture", "missing")],
            detectedValue: "Invalid pass.",
          },
        ];
      },
    });
    const report = new VersionedAuditEngine([invalid]).evaluate(snapshot());
    expect(report.results[0]?.status).toBe("not-checked");
    expect(report.failures).toHaveLength(1);
  });

  it("requires unavailable observations to be declared by immutable rule metadata", () => {
    const invalid: AuditRuleDefinition = Object.freeze({
      ...validRule,
      id: "CRW-005",
      evaluate(input) {
        return [
          {
            target: siteTarget(input),
            eligibility: {
              state: "unavailable",
              reason: "Robots evidence is unavailable.",
              missingData: ["robots"],
            },
            status: "not-checked",
            evidence: [crawlEvidence(input, "robots_coverage", "unavailable")],
            detectedValue: "Robots evidence was not evaluated.",
          },
        ];
      },
    });

    const report = new VersionedAuditEngine([invalid]).evaluate(snapshot());
    expect(report.results[0]?.status).toBe("not-checked");
    expect(report.failures).toEqual([
      expect.objectContaining({
        ruleId: "CRW-005",
        message: "Rule CRW-005 reported undeclared missing data: robots.",
      }),
    ]);
  });

  it("rejects eligible page results without persisted page identity", () => {
    const invalid: AuditRuleDefinition = Object.freeze({
      ...validRule,
      id: "CRW-004",
      scope: "page",
      evaluate(input) {
        return [
          checkedOutcome({
            target: {
              scope: "page",
              key: `${input.origin}#missing-page`,
              pageId: null,
              normalizedUrl: null,
            },
            failed: false,
            evidence: [crawlEvidence(input, "fixture", "healthy")],
            detectedValue: "Invalid unidentified pass.",
          }),
        ];
      },
    });
    const report = new VersionedAuditEngine([invalid]).evaluate(snapshot());
    expect(report.results[0]?.status).toBe("not-checked");
    expect(report.failures).toHaveLength(1);
  });

  it("samples UTF-8 evidence by bytes without splitting code points", () => {
    const values = ["😀".repeat(400), "second", "third"];
    const first = sampleEvidenceStrings(values, {
      maximumItems: 2,
      maximumItemBytes: 256,
      maximumTotalBytes: 512,
    });

    expect(first).toEqual(
      sampleEvidenceStrings(values, {
        maximumItems: 2,
        maximumItemBytes: 256,
        maximumTotalBytes: 512,
      }),
    );
    expect(first).toHaveLength(2);
    expect(Buffer.byteLength(first[0] ?? "", "utf8")).toBeLessThanOrEqual(256);
    expect(first[0]).toMatch(/sha256:[0-9a-f]{64}\]$/u);
    expect(first[0]).not.toContain("�");
    expect(first[1]).toMatch(/^omitted=2; sha256:[0-9a-f]{64}$/u);
  });
});
