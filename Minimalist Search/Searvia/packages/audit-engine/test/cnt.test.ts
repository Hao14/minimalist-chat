import { describe, expect, it } from "vitest";

import { VersionedAuditEngine } from "../src/engine.js";
import { CNT_RULES } from "../src/rules/cnt.js";
import { CNT_FIXTURES } from "./cnt-fixtures.js";
import { extraction, page, snapshot } from "./fixtures.js";

const MANUAL_RULE_IDS = new Set([
  "CNT-007",
  "CNT-008",
  "CNT-009",
  "CNT-010",
  "CNT-011",
  "CNT-012",
  "CNT-013",
  "CNT-014",
  "CNT-015",
  "CNT-016",
  "CNT-017",
  "CNT-018",
  "CNT-019",
  "CNT-020",
]);

const VERSION_TWO_IDS = new Set(["CNT-003", "CNT-006", "CNT-016", "CNT-017", "CNT-018"]);
const VERSION_THREE_IDS = new Set(["CNT-001", "CNT-002", "CNT-012", "CNT-014", "CNT-015"]);

function rule(id: string) {
  const definition = CNT_RULES.find((candidate) => candidate.id === id);
  expect(definition, `missing ${id}`).toBeDefined();
  if (definition === undefined) throw new TypeError(`Missing ${id}.`);
  return definition;
}

function withExtractionFlags(
  input: ReturnType<typeof snapshot>,
  flags: Readonly<{
    visibleTextComplete?: boolean;
    clientRendered?: boolean;
    linksComplete?: boolean;
  }>,
) {
  return Object.freeze({
    ...input,
    pages: Object.freeze(
      input.pages.map((candidate) =>
        candidate.extraction === null
          ? candidate
          : Object.freeze({
              ...candidate,
              extraction: Object.freeze({ ...candidate.extraction, ...flags }),
            }),
      ),
    ),
  });
}

describe("CNT rule catalog", () => {
  it("defines exactly CNT-001 through CNT-020 with their immutable M5 versions", () => {
    expect(CNT_RULES.map((definition) => definition.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `CNT-${String(index + 1).padStart(3, "0")}`),
    );
    expect(
      CNT_RULES.every(
        (definition) =>
          definition.version ===
            (VERSION_THREE_IDS.has(definition.id)
              ? 3
              : VERSION_TWO_IDS.has(definition.id)
                ? 2
                : 1) &&
          definition.firstSupportedVersion === "M5" &&
          definition.category === "content-quality" &&
          definition.deterministic,
      ),
    ).toBe(true);
    expect(Object.isFrozen(CNT_RULES)).toBe(true);
  });

  it("declares configuration as required data for the configured thin-content threshold", () => {
    expect(rule("CNT-001").requiredData).toContain("configuration");
  });

  it("provides complete actionable metadata for every rule", () => {
    for (const definition of CNT_RULES) {
      expect(definition.title.length, `${definition.id} title`).toBeGreaterThan(12);
      expect(definition.description.length, `${definition.id} description`).toBeGreaterThan(35);
      expect(definition.eligibility.length, `${definition.id} eligibility`).toBeGreaterThan(30);
      expect(definition.explanation.length, `${definition.id} explanation`).toBeGreaterThan(50);
      expect(definition.expectedValue.length, `${definition.id} expected`).toBeGreaterThan(30);
      expect(definition.recommendedFix.length, `${definition.id} fix`).toBeGreaterThan(60);
      expect(definition.verification.length, `${definition.id} verification`).toBeGreaterThan(40);
      expect(definition.requiredData.length, `${definition.id} required data`).toBeGreaterThan(0);
      expect(definition.impactAreas.length, `${definition.id} impact`).toBeGreaterThan(0);
    }
  });

  it("has a passing/review, issue/review, and unavailable fixture for every rule", () => {
    expect(Object.keys(CNT_FIXTURES).sort()).toEqual(CNT_RULES.map(({ id }) => id).sort());

    for (const definition of CNT_RULES) {
      const fixtures = CNT_FIXTURES[definition.id];
      expect(fixtures, definition.id).toBeDefined();
      if (fixtures === undefined) continue;
      const engine = new VersionedAuditEngine([definition]);
      const passing = engine.evaluate(fixtures.passing);
      const failing = engine.evaluate(fixtures.failing);
      const boundary = engine.evaluate(fixtures.boundary);

      expect(passing.failures, `${definition.id} passing engine failures`).toEqual([]);
      expect(failing.failures, `${definition.id} failing engine failures`).toEqual([]);
      expect(boundary.failures, `${definition.id} boundary engine failures`).toEqual([]);
      expect(
        passing.results.some((result) => result.status === fixtures.passingStatus),
        `${definition.id} passing/review status`,
      ).toBe(true);
      expect(
        failing.results.some((result) => result.status === fixtures.failingStatus),
        `${definition.id} issue/review status`,
      ).toBe(true);
      expect(
        boundary.results.some((result) => result.status === fixtures.boundaryStatus),
        `${definition.id} boundary status`,
      ).toBe(true);
      expect(engine.evaluate(fixtures.failing), `${definition.id} deterministic replay`).toEqual(
        failing,
      );
    }
  });

  it("never fabricates a pass or objective failure for qualitative rules", () => {
    for (const id of MANUAL_RULE_IDS) {
      const fixtures = CNT_FIXTURES[id];
      if (fixtures === undefined) throw new TypeError(`Missing ${id} fixture.`);
      const results = new VersionedAuditEngine([rule(id)]).evaluate(fixtures.failing).results;

      expect(
        results.some((result) => result.status === "manual-review"),
        id,
      ).toBe(true);
      expect(
        results.some((result) => result.status === "passed" || result.status === "failed"),
        id,
      ).toBe(false);
      for (const result of results.filter(({ status }) => status === "manual-review")) {
        expect(result.detectedValue, id).toMatch(/manual review required/i);
        expect(result.confidence, id).toBe("low");
        expect(result.evidence.length, id).toBeGreaterThan(0);
        expect(
          result.evidence.some((item) => item.field === "visible_text_sample"),
          id,
        ).toBe(false);
        expect(JSON.stringify(result.evidence), id).not.toContain("useful0");
      }
    }
  });

  it("requires complete link evidence before requesting linked qualitative review", () => {
    for (const id of ["CNT-012", "CNT-014"] as const) {
      const fixture = CNT_FIXTURES[id];
      if (fixture === undefined) throw new TypeError(`Missing ${id} fixture.`);
      const report = new VersionedAuditEngine([rule(id)]).evaluate(
        withExtractionFlags(fixture.passing, { linksComplete: false }),
      );

      expect(report.failures, id).toEqual([]);
      expect(report.results, id).toEqual([
        expect.objectContaining({
          status: "not-checked",
          eligibility: expect.objectContaining({
            state: "unavailable",
            missingData: ["links"],
          }),
          evidence: expect.arrayContaining([
            expect.objectContaining({
              source: "raw",
              field: "links_complete",
              value: false,
            }),
          ]),
        }),
      ]);
    }
  });

  it("attributes every objective failure to its page and raw observed evidence", () => {
    for (const definition of CNT_RULES) {
      const fixtures = CNT_FIXTURES[definition.id];
      if (fixtures === undefined) continue;
      const results = new VersionedAuditEngine([definition]).evaluate(fixtures.failing).results;
      for (const finding of results.filter(({ status }) => status === "failed")) {
        expect(finding.target.scope, definition.id).toBe("page");
        expect(finding.target.pageId, definition.id).not.toBeNull();
        expect(finding.target.normalizedUrl, definition.id).not.toBeNull();
        expect(
          finding.evidence.some(
            (item) =>
              item.url === finding.target.normalizedUrl &&
              (item.source === "raw" || item.source === "graph"),
          ),
          `${definition.id} page evidence`,
        ).toBe(true);
        expect(
          Buffer.byteLength(JSON.stringify(finding.evidence), "utf8"),
          definition.id,
        ).toBeLessThanOrEqual(65_536);
      }
    }
  });
});

describe("CNT detector regressions", () => {
  it("does not pass pages too short to produce an eight-word boilerplate shingle", () => {
    const pages = Array.from({ length: 3 }, (_, index) => {
      const normalizedUrl = `https://example.com/short-${index}`;
      return page({
        id: `short-page-${index}`,
        requestedUrl: normalizedUrl,
        normalizedUrl,
        finalUrl: normalizedUrl,
        extraction: extraction({
          id: `short-extraction-${index}`,
          visibleText: `short page text ${index}`,
          wordCount: 4,
          visibleTextComplete: true,
        }),
      });
    });
    const report = new VersionedAuditEngine([rule("CNT-002")]).evaluate(snapshot({ pages }));

    expect(report.failures).toEqual([]);
    expect(report.results).toHaveLength(3);
    expect(report.results).toEqual(
      expect.arrayContaining(
        pages.map((candidate) =>
          expect.objectContaining({
            target: expect.objectContaining({ pageId: candidate.id }),
            status: "not-checked",
            eligibility: expect.objectContaining({ state: "ineligible", missingData: [] }),
            evidence: expect.arrayContaining([
              expect.objectContaining({
                observationId: candidate.extraction?.id,
                field: "total_eight_word_shingles",
                value: 0,
              }),
            ]),
          }),
        ),
      ),
    );
    expect(report.results.some(({ status }) => status === "passed")).toBe(false);
  });

  it("records corpus peers for boilerplate and duplicate-section failures", () => {
    for (const id of ["CNT-002", "CNT-003"] as const) {
      const fixture = CNT_FIXTURES[id];
      if (fixture === undefined) throw new TypeError(`Missing ${id} fixture.`);
      const results = new VersionedAuditEngine([rule(id)]).evaluate(fixture.failing).results;

      expect(
        results.every((result) => result.status === "failed"),
        id,
      ).toBe(true);
      expect(
        results.every((result) => result.evidence.some((item) => /peer/u.test(item.field))),
        id,
      ).toBe(true);
    }
  });

  it("does not infer citation role or health from external anchors", () => {
    const fixture = CNT_FIXTURES["CNT-015"];
    if (fixture === undefined) throw new TypeError("Missing CNT-015 fixture.");
    const result = new VersionedAuditEngine([rule("CNT-015")]).evaluate(fixture.boundary)
      .results[0];

    expect(result).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["links"] },
    });
    expect(result?.evidence).toEqual([
      expect.objectContaining({ field: "links_complete", value: false }),
      expect.objectContaining({ field: "retained_external_anchor_count", value: 1 }),
    ]);

    for (const input of [fixture.passing, fixture.failing]) {
      const report = new VersionedAuditEngine([rule("CNT-015")]).evaluate(input);
      expect(report.results.some(({ status }) => status === "manual-review")).toBe(true);
      expect(report.results.some(({ status }) => status === "passed" || status === "failed")).toBe(
        false,
      );
    }
    const incompleteKnownBroken = new VersionedAuditEngine([rule("CNT-015")]).evaluate(
      withExtractionFlags(fixture.failing, { linksComplete: false }),
    );
    expect(incompleteKnownBroken.results.some(({ status }) => status === "failed")).toBe(false);
    expect(incompleteKnownBroken.results.some(({ status }) => status === "not-checked")).toBe(true);

    const source = fixture.passing.pages.find((candidate) => candidate.id === "page-citation")!;
    const secretSourceUrl =
      "https://example.com/citation?token=private-citation-query#private-citation-fragment";
    const redacted = new VersionedAuditEngine([rule("CNT-015")]).evaluate({
      ...fixture.passing,
      pages: Object.freeze(
        fixture.passing.pages.map((candidate) =>
          candidate.id === source.id
            ? Object.freeze({
                ...candidate,
                requestedUrl: secretSourceUrl,
                normalizedUrl: secretSourceUrl,
                finalUrl: secretSourceUrl,
              })
            : candidate,
        ),
      ),
    });
    const serialized = JSON.stringify(redacted.results);
    expect(serialized).toContain("token=[redacted]");
    expect(serialized).not.toContain("private-citation-query");
    expect(serialized).not.toContain("private-citation-fragment");
  });

  it("keeps both apparent contact signals and their absence as manual review", () => {
    const fixture = CNT_FIXTURES["CNT-017"];
    if (fixture === undefined) throw new TypeError("Missing CNT-017 fixture.");
    for (const input of [fixture.passing, fixture.failing]) {
      const result = new VersionedAuditEngine([rule("CNT-017")]).evaluate(input).results[0];
      expect(result).toMatchObject({ status: "manual-review", confidence: "low" });
      expect(result?.detectedValue).toMatch(/patterns do not prove/i);
    }
  });

  it("never passes from incomplete visible text and preserves only conclusive positives", () => {
    const conclusiveFailures = new Set(["CNT-001", "CNT-003", "CNT-004", "CNT-005"]);
    for (const id of ["CNT-001", "CNT-002", "CNT-003", "CNT-004", "CNT-005", "CNT-006"] as const) {
      const fixture = CNT_FIXTURES[id];
      if (fixture === undefined) throw new TypeError(`Missing ${id} fixture.`);
      const engine = new VersionedAuditEngine([rule(id)]);
      const passing = engine.evaluate(
        withExtractionFlags(fixture.passing, { visibleTextComplete: false }),
      );
      const failing = engine.evaluate(
        withExtractionFlags(fixture.failing, { visibleTextComplete: false }),
      );

      expect(passing.failures, id).toEqual([]);
      expect(
        passing.results.some(({ status }) => status === "passed"),
        id,
      ).toBe(false);
      expect(
        passing.results.some(({ status }) => status === "not-checked"),
        id,
      ).toBe(true);
      expect(failing.failures, id).toEqual([]);
      expect(
        failing.results.some(({ status }) => status === "passed"),
        id,
      ).toBe(false);
      expect(
        failing.results.some(({ status }) => status === "failed"),
        id,
      ).toBe(conclusiveFailures.has(id));
      if (!conclusiveFailures.has(id)) {
        expect(
          failing.results.some(({ status }) => status === "not-checked"),
          id,
        ).toBe(true);
      }
    }
  });

  it("does not evaluate client-rendered content without rendered evidence", () => {
    for (const definition of CNT_RULES) {
      const fixture = CNT_FIXTURES[definition.id];
      if (fixture === undefined) throw new TypeError(`Missing ${definition.id} fixture.`);
      const report = new VersionedAuditEngine([definition]).evaluate(
        withExtractionFlags(fixture.passing, { clientRendered: true }),
      );

      expect(report.failures, definition.id).toEqual([]);
      expect(
        report.results.some(({ status }) =>
          ["passed", "failed", "manual-review", "opportunity", "warning"].includes(status),
        ),
        definition.id,
      ).toBe(false);
      expect(
        report.results.some(
          (result) =>
            result.status === "not-checked" &&
            result.eligibility.state !== "eligible" &&
            result.eligibility.missingData.includes("rendered-extraction"),
        ),
        definition.id,
      ).toBe(true);
    }
  });

  it("evaluates client-rendered pages from rendered text with rendered provenance", () => {
    const report = new VersionedAuditEngine([rule("CNT-004")]).evaluate(
      snapshot({
        pages: [
          page({
            extraction: extraction({
              id: "raw-shell",
              clientRendered: true,
              visibleText: null,
              wordCount: 0,
            }),
            renderedExtraction: extraction({
              id: "rendered-content",
              source: "rendered",
              visibleText: "The final interface still contains lorem ipsum placeholder copy.",
              wordCount: 9,
            }),
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({ status: "failed", target: { pageId: "page-home" } });
    expect(report.results[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "rendered",
          observationId: "rendered-content",
          field: "placeholder_marker",
        }),
      ]),
    );
  });

  it("attributes rendered corpus-analysis gaps to rendered extraction", () => {
    const pages = [0, 1].map((index) => {
      const normalizedUrl = `https://example.com/rendered-${index}`;
      return page({
        id: `rendered-page-${index}`,
        requestedUrl: normalizedUrl,
        normalizedUrl,
        finalUrl: normalizedUrl,
        extraction: extraction({
          id: `raw-shell-${index}`,
          clientRendered: true,
          visibleText: null,
          wordCount: 0,
        }),
        renderedExtraction: extraction({
          id: `rendered-extraction-${index}`,
          source: "rendered",
          visibleText: `${"unique rendered content ".repeat(5_000)} page ${index}`,
          wordCount: 15_002,
        }),
      });
    });
    const report = new VersionedAuditEngine([rule("CNT-003")]).evaluate(snapshot({ pages }));

    expect(report.failures).toEqual([]);
    expect(report.results.every((result) => result.status === "not-checked")).toBe(true);
    expect(
      report.results.every((result) =>
        result.eligibility.missingData.includes("rendered-extraction"),
      ),
    ).toBe(true);
  });

  it.each(["CNT-001", "CNT-002", "CNT-003"] as const)(
    "%s keeps unsupported language-aware word segmentation Not Checked",
    (id) => {
      const pageCount = id === "CNT-002" ? 3 : id === "CNT-003" ? 2 : 1;
      const pages = Array.from({ length: pageCount }, (_, index) => {
        const normalizedUrl = `https://example.com/zh-${index}`;
        return page({
          id: `page-zh-${index}`,
          requestedUrl: normalizedUrl,
          normalizedUrl,
          finalUrl: normalizedUrl,
          discoverySource: index === 0 ? "seed" : "link",
          extraction: extraction({
            id: `extract-zh-${index}`,
            htmlLanguage: "zh-Hans",
            visibleText:
              "这是一个包含大量有用信息的测试页面用于验证确定性内容分析不会错误地把连续书写的文本当作单个英文单词。".repeat(
                8,
              ),
            wordCount: 120,
          }),
        });
      });
      const report = new VersionedAuditEngine([rule(id)]).evaluate(snapshot({ pages }));

      expect(report.failures).toEqual([]);
      expect(report.results.every((result) => result.status === "not-checked")).toBe(true);
      expect(
        report.results.every((result) =>
          result.eligibility.reason.includes("language-aware word segmentation"),
        ),
      ).toBe(true);
    },
  );

  it("does not apply the English keyword-repetition policy to non-English content", () => {
    const visibleText = `${Array.from({ length: 30 }, () => "ranking").join(" ")} ${Array.from(
      { length: 80 },
      (_, index) => `contenido${index}`,
    ).join(" ")}`;
    const report = new VersionedAuditEngine([rule("CNT-006")]).evaluate(
      snapshot({
        pages: [
          page({
            extraction: extraction({
              htmlLanguage: "es",
              visibleText,
              wordCount: 110,
            }),
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable" },
    });
    expect(report.results[0]?.eligibility.reason).toContain("English stopword policy");
  });

  it.each(["CNT-012", "CNT-014", "CNT-015", "CNT-016", "CNT-017", "CNT-018"] as const)(
    "%s does not combine rendered text with an unrepresentative raw-shell link graph",
    (id) => {
      const fixture = CNT_FIXTURES[id];
      if (fixture === undefined) throw new TypeError(`Missing ${id} fixture.`);
      const source = fixture.passing.pages[0]!;
      const raw = source.extraction!;
      const report = new VersionedAuditEngine([rule(id)]).evaluate({
        ...fixture.passing,
        pages: Object.freeze([
          Object.freeze({
            ...source,
            extraction: Object.freeze({
              ...raw,
              clientRendered: true,
              visibleText: null,
              wordCount: 0,
            }),
            renderedExtraction: Object.freeze({
              ...raw,
              id: `${raw.id}-rendered`,
              source: "rendered" as const,
              clientRendered: false,
            }),
          }),
          ...fixture.passing.pages.slice(1),
        ]),
      });

      expect(report.failures, id).toEqual([]);
      expect(
        report.results.some(
          (result) =>
            result.status === "not-checked" &&
            result.eligibility.state === "unavailable" &&
            result.eligibility.missingData.includes("links"),
        ),
        id,
      ).toBe(true);
      expect(
        report.results.some((result) => result.status === "failed"),
        id,
      ).toBe(false);
    },
  );

  it("does not mistake legitimate Portuguese or Romanian text for mojibake", () => {
    for (const visibleText of [
      "SÃO PAULO oferece informação clara para visitantes em português.",
      "ÂNCEPEM analiza conținutului românesc cu diacritice corecte.",
    ]) {
      const report = new VersionedAuditEngine([rule("CNT-005")]).evaluate(
        snapshot({ pages: [page({ extraction: extraction({ visibleText, wordCount: 9 }) })] }),
      );
      expect(report.failures).toEqual([]);
      expect(report.results[0]?.status, visibleText).toBe("passed");
    }

    const mojibake = new VersionedAuditEngine([rule("CNT-005")]).evaluate(
      snapshot({
        pages: [
          page({
            extraction: extraction({
              visibleText: "The broken label reads Fran\u00C3\u00A7ais instead of French text.",
              wordCount: 10,
            }),
          }),
        ],
      }),
    );
    expect(mojibake.failures).toEqual([]);
    expect(mojibake.results[0]?.status).toBe("failed");
  });

  it("bounds large text, corpus, match, and token analysis", () => {
    const latePlaceholder = `${"safe content ".repeat(10_000)} lorem ipsum`;
    const lateEncoding = `${"safe content ".repeat(10_000)} \uFFFD`;
    for (const [id, text] of [
      ["CNT-004", latePlaceholder],
      ["CNT-005", lateEncoding],
    ] as const) {
      const input = snapshot({
        pages: [
          page({
            extraction: extraction({
              visibleText: text,
              wordCount: 20_002,
              visibleTextComplete: true,
            }),
          }),
        ],
      });
      const report = new VersionedAuditEngine([rule(id)]).evaluate(input);
      expect(report.failures, id).toEqual([]);
      expect(report.results[0]?.status, id).toBe("not-checked");
    }

    const longToken = "x".repeat(5_000);
    const tokenReport = new VersionedAuditEngine([rule("CNT-006")]).evaluate(
      snapshot({
        pages: [
          page({
            extraction: extraction({
              visibleText: `${longToken} ${Array.from({ length: 80 }, (_, index) => `term${index}`).join(" ")}`,
              wordCount: 81,
            }),
          }),
        ],
      }),
    );
    expect(tokenReport.failures).toEqual([]);
    expect(tokenReport.results[0]?.status).toBe("not-checked");
    expect(JSON.stringify(tokenReport.results)).not.toContain(longToken);

    const corpusPages = Array.from({ length: 251 }, (_, pageIndex) => {
      const normalizedUrl = `https://example.com/bounded-${pageIndex}`;
      const text = Array.from(
        { length: 40 },
        (_, wordIndex) => `page${pageIndex}term${wordIndex}`,
      ).join(" ");
      return page({
        id: `bounded-page-${pageIndex}`,
        requestedUrl: normalizedUrl,
        normalizedUrl,
        finalUrl: normalizedUrl,
        extraction: extraction({
          id: `bounded-extract-${pageIndex}`,
          visibleText: text,
          wordCount: 40,
        }),
      });
    });
    const corpusReport = new VersionedAuditEngine([rule("CNT-003")]).evaluate(
      snapshot({ pages: corpusPages }),
    );
    expect(corpusReport.failures).toEqual([]);
    expect(corpusReport.results.some(({ status }) => status === "passed")).toBe(false);
    expect(corpusReport.results.every(({ status }) => status === "not-checked")).toBe(true);

    const densePages = Array.from({ length: 17 }, (_, pageIndex) => {
      const normalizedUrl = `https://example.com/dense-${pageIndex}`;
      const text = Array.from(
        { length: 15_000 },
        (_, wordIndex) => `p${pageIndex.toString(36)}${wordIndex.toString(36)}`,
      ).join(" ");
      return page({
        id: `dense-page-${pageIndex}`,
        requestedUrl: normalizedUrl,
        normalizedUrl,
        finalUrl: normalizedUrl,
        extraction: extraction({
          id: `dense-extract-${pageIndex}`,
          visibleText: text,
          wordCount: 15_000,
        }),
      });
    });
    const shingleBudgetReport = new VersionedAuditEngine([rule("CNT-003")]).evaluate(
      snapshot({ pages: densePages }),
    );
    expect(shingleBudgetReport.failures).toEqual([]);
    expect(shingleBudgetReport.results.some(({ status }) => status === "passed")).toBe(false);
    expect(shingleBudgetReport.results.every(({ status }) => status === "not-checked")).toBe(true);
  });

  it("does not turn partial corpus absence into a pass", () => {
    for (const id of ["CNT-002", "CNT-003", "CNT-017"] as const) {
      const fixture = CNT_FIXTURES[id];
      if (fixture === undefined) throw new TypeError(`Missing ${id} fixture.`);
      const report = new VersionedAuditEngine([rule(id)]).evaluate(fixture.boundary);

      expect(
        report.results.some((result) => result.status === "passed"),
        id,
      ).toBe(false);
      expect(
        report.results.some((result) => result.status === "not-checked"),
        id,
      ).toBe(true);
    }
  });
});
