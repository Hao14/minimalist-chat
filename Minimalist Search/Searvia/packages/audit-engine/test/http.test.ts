import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { VersionedAuditEngine } from "../src/engine.js";
import { HTTP_RULES } from "../src/rules/http.js";
import {
  extraction,
  fixtureSet,
  historicalRedirect,
  page,
  redirect,
  snapshot,
  type RuleFixtureSet,
} from "./fixtures.js";

const validRedirectPage = page({
  requestedUrl: "https://example.com/old",
  normalizedUrl: "https://example.com/old",
  finalUrl: "https://example.com/new",
  redirectChain: [redirect()],
  extraction: extraction({ canonicalUrl: "https://example.com/new" }),
});

const temporaryRedirectPage = page({
  requestedUrl: "https://example.com/old",
  normalizedUrl: "https://example.com/old",
  finalUrl: "https://example.com/new",
  redirectChain: [redirect({ statusCode: 302 })],
});

const internalSource = (targetId: string) =>
  page({
    links: [
      {
        id: "link-target",
        targetPageId: targetId,
        targetUrl: "https://example.com/target",
        normalizedTargetUrl: "https://example.com/target",
        scope: "internal",
        relValues: [],
        linkType: "anchor",
        discovered: true,
      },
    ],
  });

function evaluateHttpRule(id: string, input: ReturnType<typeof snapshot>) {
  const rule = HTTP_RULES.find((candidate) => candidate.id === id);
  expect(rule).toBeDefined();
  if (rule === undefined) throw new TypeError(`Missing HTTP rule ${id}.`);
  return new VersionedAuditEngine([rule]).evaluate(input);
}

const httpFixtures: Readonly<Record<string, RuleFixtureSet>> = Object.freeze({
  "HTTP-001": fixtureSet({
    passing: snapshot({
      pages: [
        page({
          requestedUrl: "http://example.com/",
          normalizedUrl: "http://example.com/",
          finalUrl: "https://example.com/",
          redirectChain: [
            redirect({
              requestedUrl: "http://example.com/",
              resolvedUrl: "https://example.com/",
            }),
          ],
        }),
      ],
    }),
    failing: snapshot({
      pages: [
        page({
          requestedUrl: "http://example.com/",
          normalizedUrl: "http://example.com/",
          finalUrl: "http://example.com/",
        }),
      ],
    }),
    boundary: snapshot(),
  }),
  "HTTP-002": fixtureSet({
    passing: snapshot({
      pages: [
        page({ requestedUrl: "https://example.com/", finalUrl: "https://example.com/" }),
        page({
          id: "page-www",
          requestedUrl: "https://www.example.com/",
          normalizedUrl: "https://www.example.com/",
          finalUrl: "https://example.com/",
        }),
      ],
    }),
    failing: snapshot({
      pages: [
        page({ requestedUrl: "https://example.com/", finalUrl: "https://example.com/" }),
        page({
          id: "page-www",
          requestedUrl: "https://www.example.com/",
          normalizedUrl: "https://www.example.com/",
          finalUrl: "https://www.example.com/",
        }),
      ],
    }),
    boundary: snapshot(),
  }),
  "HTTP-003": fixtureSet({
    passing: snapshot({ pages: [validRedirectPage] }),
    failing: snapshot({
      pages: [
        page({
          redirectChain: [0, 1, 2, 3].map((sequence) =>
            redirect({ sequence, resolvedUrl: `https://example.com/hop-${sequence}` }),
          ),
        }),
      ],
    }),
    boundary: snapshot({ pages: [] }),
  }),
  "HTTP-004": fixtureSet({
    passing: snapshot(),
    failing: snapshot({ pages: [page({ statusCode: null, errorType: "redirect_loop" })] }),
    boundary: snapshot({ pages: [] }),
  }),
  "HTTP-005": fixtureSet({
    passing: snapshot({
      pages: [
        internalSource("page-target"),
        page({
          id: "page-target",
          normalizedUrl: "https://example.com/target",
          requestedUrl: "https://example.com/target",
          finalUrl: "https://example.com/target",
        }),
      ],
    }),
    failing: snapshot({
      pages: [
        internalSource("page-target"),
        page({
          id: "page-target",
          normalizedUrl: "https://example.com/target",
          requestedUrl: "https://example.com/target",
          finalUrl: "https://example.com/final",
          redirectChain: [redirect()],
        }),
      ],
    }),
    boundary: snapshot(),
  }),
  "HTTP-006": fixtureSet({
    passing: snapshot({
      pages: [temporaryRedirectPage],
      historicalRedirects: [historicalRedirect()],
    }),
    failing: snapshot({
      pages: [temporaryRedirectPage],
      historicalRedirects: [
        historicalRedirect(),
        historicalRedirect({
          crawlId: "historical-crawl-b",
          crawlFinishedAt: "2026-07-08T12:05:00.000Z",
          observedAt: "2026-07-08T12:00:00.000Z",
        }),
      ],
    }),
    boundary: snapshot({ pages: [temporaryRedirectPage] }),
  }),
  "HTTP-007": fixtureSet({
    passing: snapshot({ pages: [validRedirectPage] }),
    failing: snapshot({ pages: [page({ ...validRedirectPage, statusCode: 404 })] }),
    boundary: snapshot(),
  }),
  "HTTP-008": fixtureSet({
    passing: snapshot({ pages: [validRedirectPage] }),
    failing: snapshot({ pages: [page({ ...validRedirectPage, statusCode: 503 })] }),
    boundary: snapshot(),
  }),
  "HTTP-009": fixtureSet({
    passing: snapshot({ pages: [page({ extraction: extraction({ metaRefreshUrl: null }) })] }),
    failing: snapshot({
      pages: [page({ extraction: extraction({ metaRefreshUrl: "https://example.com/new" }) })],
    }),
    boundary: snapshot({ pages: [page({ extraction: null })] }),
  }),
  "HTTP-010": fixtureSet({
    passing: snapshot({
      pages: [page({ extraction: extraction({ javascriptRedirectUrl: null }) })],
    }),
    failing: snapshot({
      pages: [
        page({
          extraction: extraction({ javascriptRedirectUrl: "https://example.com/app" }),
        }),
      ],
    }),
    boundary: snapshot({ pages: [page({ extraction: null })] }),
  }),
  "HTTP-011": fixtureSet({
    passing: snapshot({ pages: [validRedirectPage] }),
    failing: snapshot({ pages: [page({ statusCode: null, errorType: "invalid_redirect" })] }),
    boundary: snapshot(),
  }),
  "HTTP-012": fixtureSet({
    passing: snapshot(),
    failing: snapshot({ pages: [page({ contentType: "text/plain" })] }),
    boundary: snapshot({
      pages: [
        page({
          extraction: null,
          htmlDetected: null,
          htmlDetectionSource: null,
          htmlDetectionBytes: null,
        }),
      ],
    }),
  }),
  "HTTP-013": fixtureSet({
    passing: snapshot(),
    failing: snapshot({ pages: [page({ statusCode: null, errorType: "response_too_large" })] }),
    boundary: snapshot({ pages: [] }),
  }),
  "HTTP-014": fixtureSet({
    passing: snapshot(),
    failing: snapshot({ pages: [page({ compression: null })] }),
    boundary: snapshot({ pages: [page({ responseBytes: 1_023, transferSize: 1_023 })] }),
  }),
  "HTTP-015": fixtureSet({
    passing: snapshot(),
    failing: snapshot({ pages: [page({ securityHeaders: {} })] }),
    boundary: snapshot({ origin: "http://example.com" }),
  }),
});

describe("HTTP-001 through HTTP-015", () => {
  it("registers exactly the requested stable rule IDs", () => {
    expect(HTTP_RULES.map((rule) => rule.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => `HTTP-${String(index + 1).padStart(3, "0")}`),
    );
  });

  for (const rule of HTTP_RULES) {
    it(`${rule.id} has passing, failing, and boundary/unavailable fixtures`, () => {
      const fixtures = httpFixtures[rule.id];
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

  it("fails HTTP-001 when HTTP redirects to a successful external HTTPS host", () => {
    const report = evaluateHttpRule(
      "HTTP-001",
      snapshot({
        pages: [
          page({
            requestedUrl: "http://example.com/",
            normalizedUrl: "http://example.com/",
            finalUrl: "https://external.example/",
            redirectChain: [
              redirect({
                requestedUrl: "http://example.com/",
                resolvedUrl: "https://external.example/",
              }),
            ],
            statusCode: 200,
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({ status: "failed" });
  });

  it("does not pass HTTP-001 without a conclusive final target status", () => {
    const report = evaluateHttpRule(
      "HTTP-001",
      snapshot({
        pages: [
          page({
            requestedUrl: "http://example.com/",
            normalizedUrl: "http://example.com/",
            finalUrl: "https://example.com/",
            redirectChain: [
              redirect({
                requestedUrl: "http://example.com/",
                resolvedUrl: "https://example.com/",
              }),
            ],
            statusCode: null,
            errorType: "request_timeout",
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable" },
    });
  });

  it("orders HTTP-001 failure evidence before healthy observations", () => {
    const report = evaluateHttpRule(
      "HTTP-001",
      snapshot({
        pages: [
          page({
            id: "healthy-http",
            requestedUrl: "http://example.com/healthy",
            normalizedUrl: "http://example.com/healthy",
            finalUrl: "https://example.com/healthy",
            redirectChain: [
              redirect({
                requestedUrl: "http://example.com/healthy",
                resolvedUrl: "https://example.com/healthy",
              }),
            ],
          }),
          page({
            id: "external-http",
            requestedUrl: "http://example.com/external",
            normalizedUrl: "http://example.com/external",
            finalUrl: "https://external.example/external",
            redirectChain: [
              redirect({
                requestedUrl: "http://example.com/external",
                resolvedUrl: "https://external.example/external",
              }),
            ],
          }),
        ],
      }),
    );

    expect(report.results[0]?.status).toBe("failed");
    expect(report.results[0]?.evidence[0]?.url).toBe("http://example.com/external");
  });

  it("compares HTTP-002 only across equivalent path and query pairs", () => {
    const report = evaluateHttpRule(
      "HTTP-002",
      snapshot({
        pages: [
          page({
            id: "apex-only",
            requestedUrl: "https://example.com/apex-only",
            normalizedUrl: "https://example.com/apex-only",
            finalUrl: "https://example.com/apex-only",
          }),
          page({
            id: "www-only",
            requestedUrl: "https://www.example.com/www-only",
            normalizedUrl: "https://www.example.com/www-only",
            finalUrl: "https://example.com/www-only",
          }),
          page({
            id: "apex-paired",
            requestedUrl: "https://example.com/products?view=full",
            normalizedUrl: "https://example.com/products?view=full",
            finalUrl: "https://example.com/products?view=full",
          }),
          page({
            id: "www-paired",
            requestedUrl: "https://www.example.com/products?view=full",
            normalizedUrl: "https://www.example.com/products?view=full",
            finalUrl: "https://example.com/products?view=full",
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({ status: "passed" });
  });

  it("does not compare HTTP-002 observations from different path/query pairs", () => {
    const report = evaluateHttpRule(
      "HTTP-002",
      snapshot({
        pages: [
          page({
            requestedUrl: "https://example.com/products?view=grid",
            normalizedUrl: "https://example.com/products?view=grid",
            finalUrl: "https://example.com/products?view=grid",
          }),
          page({
            id: "www-list",
            requestedUrl: "https://www.example.com/products?view=list",
            normalizedUrl: "https://www.example.com/products?view=list",
            finalUrl: "https://example.com/products?view=list",
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable" },
    });
  });

  it("does not pass HTTP-002 when an equivalent pair lacks a final status", () => {
    const report = evaluateHttpRule(
      "HTTP-002",
      snapshot({
        pages: [
          page({
            requestedUrl: "https://example.com/products",
            normalizedUrl: "https://example.com/products",
            finalUrl: "https://example.com/products",
          }),
          page({
            id: "www-products",
            requestedUrl: "https://www.example.com/products",
            normalizedUrl: "https://www.example.com/products",
            finalUrl: "https://example.com/products",
            statusCode: null,
            errorType: "request_timeout",
          }),
        ],
      }),
    );

    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable" },
    });
  });

  it("orders HTTP-002 failing variant evidence before its healthy pair", () => {
    const report = evaluateHttpRule(
      "HTTP-002",
      snapshot({
        pages: [
          page({
            requestedUrl: "https://example.com/products",
            normalizedUrl: "https://example.com/products",
            finalUrl: "https://example.com/products",
          }),
          page({
            id: "www-products",
            requestedUrl: "https://www.example.com/products",
            normalizedUrl: "https://www.example.com/products",
            finalUrl: "https://www.example.com/products",
          }),
        ],
      }),
    );

    expect(report.results[0]?.status).toBe("failed");
    expect(report.results[0]?.evidence[0]?.url).toBe("https://www.example.com/products");
  });

  it("does not pass HTTP-005 when one of several internal targets is absent", () => {
    const source = page({
      links: [
        ...internalSource("page-target").links,
        {
          id: "missing-link",
          targetPageId: "missing-page",
          targetUrl: "https://example.com/missing?token=private",
          normalizedTargetUrl: "https://example.com/missing?token=private",
          scope: "internal",
          relValues: [],
          linkType: "anchor",
          discovered: true,
        },
      ],
    });
    const report = evaluateHttpRule(
      "HTTP-005",
      snapshot({
        pages: [
          source,
          page({
            id: "page-target",
            normalizedUrl: "https://example.com/target",
            requestedUrl: "https://example.com/target",
            finalUrl: "https://example.com/target",
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["pages"] },
    });
    expect(JSON.stringify(report.results[0]?.evidence)).not.toContain("private");
  });

  it("does not pass HTTP-005 when a URL-only internal target is ambiguous", () => {
    const duplicateUrl = "https://example.com/duplicate";
    const source = page({
      links: [
        {
          id: "ambiguous-link",
          targetPageId: null,
          targetUrl: duplicateUrl,
          normalizedTargetUrl: duplicateUrl,
          scope: "internal",
          relValues: [],
          linkType: "anchor",
          discovered: true,
        },
      ],
    });
    const report = evaluateHttpRule(
      "HTTP-005",
      snapshot({
        pages: [
          source,
          page({ id: "duplicate-a", normalizedUrl: duplicateUrl, requestedUrl: duplicateUrl }),
          page({ id: "duplicate-b", normalizedUrl: duplicateUrl, requestedUrl: duplicateUrl }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["pages"] },
    });
  });

  it("does not pass HTTP-005 when a resolved target lacks a transport conclusion", () => {
    const report = evaluateHttpRule(
      "HTTP-005",
      snapshot({
        pages: [
          internalSource("page-target"),
          page({
            id: "page-target",
            normalizedUrl: "https://example.com/target",
            requestedUrl: "https://example.com/target",
            finalUrl: null,
            statusCode: null,
            errorType: "request_timeout",
            extraction: null,
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: {
        state: "unavailable",
        missingData: ["transport", "redirects"],
      },
    });
  });

  it("requires complete source-link coverage for HTTP-005 passes but retains conclusive failures", () => {
    const source = page({
      ...internalSource("page-target"),
      extraction: extraction({ linksComplete: false }),
    });
    const directTarget = page({
      id: "page-target",
      normalizedUrl: "https://example.com/target",
      requestedUrl: "https://example.com/target",
      finalUrl: "https://example.com/target",
    });
    const incomplete = evaluateHttpRule("HTTP-005", snapshot({ pages: [source, directTarget] }));
    expect(incomplete.failures).toEqual([]);
    expect(incomplete.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["links"] },
    });

    const redirectedTarget = page({
      ...directTarget,
      finalUrl: "https://example.com/final",
      redirectChain: [redirect()],
    });
    const conclusive = evaluateHttpRule(
      "HTTP-005",
      snapshot({ pages: [source, redirectedTarget] }),
    );
    expect(conclusive.results[0]?.status).toBe("failed");
  });

  it("reports HTTP-005 unavailable when a truncated source retained no internal links", () => {
    const report = evaluateHttpRule(
      "HTTP-005",
      snapshot({ pages: [page({ extraction: extraction({ linksComplete: false }), links: [] })] }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["links"] },
    });
  });

  it.each(["HTTP-007", "HTTP-008"])(
    "%s does not pass a redirect without a final target status",
    (id) => {
      const report = evaluateHttpRule(
        id,
        snapshot({
          pages: [
            page({
              ...validRedirectPage,
              statusCode: null,
              errorType: "request_timeout",
            }),
          ],
        }),
      );

      expect(report.failures).toEqual([]);
      expect(report.results[0]).toMatchObject({
        status: "not-checked",
        eligibility: { state: "unavailable" },
      });
    },
  );

  it("does not report HTTP-012 as healthy when HTML detection is false", () => {
    const report = evaluateHttpRule(
      "HTTP-012",
      snapshot({
        pages: [
          page({
            contentType: "text/plain",
            extraction: null,
            htmlDetected: false,
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "ineligible" },
    });
  });

  it("does not pass HTTP-013 for a no-response observation with unknown bytes", () => {
    const report = evaluateHttpRule(
      "HTTP-013",
      snapshot({
        pages: [
          page({
            finalUrl: null,
            statusCode: null,
            contentLength: null,
            responseBytes: 0,
            transferSize: 0,
            errorType: null,
            extraction: null,
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable" },
    });
  });

  it("allows HTTP-013 to pass a completed zero-byte response", () => {
    const report = evaluateHttpRule(
      "HTTP-013",
      snapshot({
        pages: [
          page({
            statusCode: 204,
            contentLength: null,
            responseBytes: 0,
            transferSize: 0,
            errorType: null,
            extraction: null,
          }),
        ],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({ status: "passed" });
  });

  it.each(["HTTP-003", "HTTP-004"] as const)(
    "%s never passes an inconclusive no-response transport observation",
    (id) => {
      const report = evaluateHttpRule(
        id,
        snapshot({
          pages: [page({ statusCode: null, errorType: null, finalUrl: null, redirectChain: [] })],
        }),
      );

      expect(report.failures).toEqual([]);
      expect(report.results[0]).toMatchObject({
        status: "not-checked",
        eligibility: {
          state: "unavailable",
          missingData: ["transport", "redirects"],
        },
      });
    },
  );

  it("keeps HTTP-005 long and high-cardinality link evidence deterministic and bounded", () => {
    const longPath = "long-segment-".repeat(260);
    const targets = Array.from({ length: 18 }, (_, index) => {
      const targetUrl = `https://example.com/${longPath}${index}`;
      const finalTarget = `${targetUrl}-final`;
      return page({
        id: `long-target-${index}`,
        requestedUrl: targetUrl,
        normalizedUrl: targetUrl,
        finalUrl: finalTarget,
        redirectChain: [
          redirect({ requestedUrl: targetUrl, resolvedUrl: finalTarget, location: finalTarget }),
        ],
      });
    });
    const source = page({
      links: targets.map((target, index) => ({
        id: `long-link-${index}`,
        targetPageId: target.id,
        targetUrl: target.normalizedUrl,
        normalizedTargetUrl: target.normalizedUrl,
        scope: "internal" as const,
        relValues: [],
        linkType: "anchor" as const,
        discovered: true,
      })),
    });

    const report = evaluateHttpRule("HTTP-005", snapshot({ pages: [source, ...targets] }));
    const finding = report.results[0];
    const serializedEvidence = JSON.stringify(finding?.evidence);

    expect(HTTP_RULES.find((rule) => rule.id === "HTTP-005")).toMatchObject({
      version: 4,
      requiredData: ["links", "pages", "transport", "redirects"],
    });
    expect(report.failures).toEqual([]);
    expect(finding?.status).toBe("failed");
    expect(Buffer.byteLength(serializedEvidence, "utf8")).toBeLessThanOrEqual(65_536);
    expect(serializedEvidence).toContain("sha256:");
    expect(evaluateHttpRule("HTTP-005", snapshot({ pages: [source, ...targets] }))).toEqual(report);
  });

  it("attributes HTTP-006 history evidence to each historical observation time", () => {
    const report = evaluateHttpRule("HTTP-006", httpFixtures["HTTP-006"]!.failing);
    const historical = report.results[0]?.evidence.filter(
      (item) => item.field === "historical_temporary_redirect",
    );

    expect(report.failures).toEqual([]);
    expect(HTTP_RULES.find((rule) => rule.id === "HTTP-006")?.version).toBe(5);
    expect(historical?.map((item) => item.observedAt)).toEqual([
      "2026-07-01T12:00:00.000Z",
      "2026-07-08T12:00:00.000Z",
    ]);
    expect(
      historical?.every((item) => item.kind === "redirect" && item.source === "transport"),
    ).toBe(true);
    expect(JSON.stringify(historical)).toContain("historical-crawl-a");
    expect(JSON.stringify(historical)).toContain("historical-crawl-b");
  });

  it("evaluates every HTTP-006 temporary hop independently of redirect-chain array order", () => {
    const firstHop = redirect({
      sequence: 0,
      requestedUrl: "https://example.com/old",
      resolvedUrl: "https://example.com/middle",
      location: "/middle",
      statusCode: 302,
    });
    const persistentLaterHop = redirect({
      sequence: 1,
      requestedUrl: "https://example.com/middle",
      resolvedUrl: "https://example.com/new",
      location: "/new",
      statusCode: 307,
    });
    const histories = [
      historicalRedirect({
        requestedUrl: firstHop.requestedUrl,
        resolvedUrl: firstHop.resolvedUrl,
      }),
      historicalRedirect({
        requestedUrl: persistentLaterHop.requestedUrl,
        resolvedUrl: persistentLaterHop.resolvedUrl,
      }),
      historicalRedirect({
        crawlId: "historical-crawl-b",
        crawlFinishedAt: "2026-07-08T12:05:00.000Z",
        observedAt: "2026-07-08T12:00:00.000Z",
        requestedUrl: persistentLaterHop.requestedUrl,
        resolvedUrl: persistentLaterHop.resolvedUrl,
        statusCode: 307,
      }),
    ];
    const evaluate = (redirectChain: readonly ReturnType<typeof redirect>[]) =>
      evaluateHttpRule(
        "HTTP-006",
        snapshot({
          pages: [page({ redirectChain, finalUrl: persistentLaterHop.resolvedUrl })],
          historicalRedirects: histories,
        }),
      );

    const ordered = evaluate([firstHop, persistentLaterHop]);
    const reversed = evaluate([persistentLaterHop, firstHop]);
    expect(ordered.results[0]?.status).toBe("failed");
    expect(reversed.results).toEqual(ordered.results);
    expect(ordered.results[0]?.detectedValue).toContain("1 of 2 temporary redirect hop(s)");
  });

  it("keeps HTTP-006 not-checked when any hop has no history, unless another hop proves failure", () => {
    const firstHop = redirect({
      sequence: 0,
      requestedUrl: "https://example.com/old",
      resolvedUrl: "https://example.com/middle",
      location: "/middle",
      statusCode: 302,
    });
    const unknownHop = redirect({
      sequence: 1,
      requestedUrl: "https://example.com/middle",
      resolvedUrl: "https://example.com/new",
      location: "/new",
      statusCode: 307,
    });
    const knownHistory = historicalRedirect({
      requestedUrl: firstHop.requestedUrl,
      resolvedUrl: firstHop.resolvedUrl,
    });
    const unavailable = evaluateHttpRule(
      "HTTP-006",
      snapshot({
        pages: [page({ redirectChain: [firstHop, unknownHop] })],
        historicalRedirects: [knownHistory],
      }),
    );
    expect(unavailable.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["crawl-history"] },
    });

    const conclusive = evaluateHttpRule(
      "HTTP-006",
      snapshot({
        pages: [page({ redirectChain: [firstHop, unknownHop] })],
        historicalRedirects: [
          knownHistory,
          historicalRedirect({
            crawlId: "historical-crawl-b",
            crawlFinishedAt: "2026-07-08T12:05:00.000Z",
            observedAt: "2026-07-08T12:00:00.000Z",
            requestedUrl: firstHop.requestedUrl,
            resolvedUrl: firstHop.resolvedUrl,
          }),
        ],
        historicalRedirectCoverage: {
          complete: false,
          truncated: true,
          pageObservationLimit: 10_000,
          loadedPageObservationCount: 10_000,
          loadedCrawlCount: 2,
        },
      }),
    );
    expect(conclusive.results[0]?.status).toBe("failed");
  });

  it("retains a conclusive HTTP-006 failure when prior crawl history was truncated", () => {
    const report = evaluateHttpRule(
      "HTTP-006",
      snapshot({
        pages: [temporaryRedirectPage],
        historicalRedirects: [historicalRedirect(), historicalRedirect({ crawlId: "crawl-b" })],
        historicalRedirectCoverage: {
          complete: false,
          truncated: true,
          pageObservationLimit: 10_000,
          loadedPageObservationCount: 10_000,
          loadedCrawlCount: 2,
        },
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "failed",
      eligibility: { state: "eligible" },
    });
  });

  it("counts matching HTTP-006 observations by distinct prior crawl identity", () => {
    const duplicatePageObservation = historicalRedirect({
      observedAt: "2026-07-01T12:01:00.000Z",
    });
    const report = evaluateHttpRule(
      "HTTP-006",
      snapshot({
        pages: [temporaryRedirectPage],
        historicalRedirects: [historicalRedirect(), duplicatePageObservation],
      }),
    );

    expect(report.failures).toEqual([]);
    expect(report.results[0]).toMatchObject({
      status: "passed",
      detectedValue:
        "All 1 temporary redirect hop(s) were observed in fewer than two prior completed crawls.",
    });
  });

  it.each(["HTTP-009", "HTTP-010"] as const)(
    "%s attributes redirect-signal evidence to the persisted raw extraction",
    (ruleId) => {
      const report = evaluateHttpRule(ruleId, httpFixtures[ruleId]!.failing);

      expect(HTTP_RULES.find((rule) => rule.id === ruleId)?.version).toBe(3);
      expect(report.results[0]?.evidence[0]).toMatchObject({
        kind: "extraction",
        source: "raw",
        observationId: "extract-home",
      });
    },
  );

  it.each(["HTTP-009", "HTTP-010"] as const)(
    "%s masks query credentials in redirect-signal evidence and detected values",
    (ruleId) => {
      const secret = `redirect-secret-${"x".repeat(1_000)}`;
      const field = ruleId === "HTTP-009" ? "metaRefreshUrl" : "javascriptRedirectUrl";
      const report = evaluateHttpRule(
        ruleId,
        snapshot({
          pages: [
            page({
              extraction: extraction({
                [field]: `https://example.com/destination?token=${secret}`,
              }),
            }),
          ],
        }),
      );
      const serialized = JSON.stringify(report.results[0]);

      expect(serialized).not.toContain(secret);
      expect(serialized).toContain("redacted");
    },
  );

  it.each(["HTTP-009", "HTTP-010"] as const)(
    "%s keeps rendered-only extraction signals not-checked",
    (ruleId) => {
      const field = ruleId === "HTTP-009" ? "metaRefreshUrl" : "javascriptRedirectUrl";
      const report = evaluateHttpRule(
        ruleId,
        snapshot({
          pages: [
            page({
              extraction: extraction({
                source: "rendered",
                [field]: "https://example.com/rendered-only",
              }),
            }),
          ],
        }),
      );

      expect(report.results[0]).toMatchObject({
        status: "not-checked",
        eligibility: {
          state: "unavailable",
          missingData: ["raw-extraction", "redirect-signals"],
        },
      });
    },
  );

  it("requires bounded response-prefix provenance before evaluating HTTP-012", () => {
    const report = evaluateHttpRule(
      "HTTP-012",
      snapshot({
        pages: [page({ htmlDetected: true, htmlDetectionSource: null, htmlDetectionBytes: null })],
      }),
    );

    expect(HTTP_RULES.find((rule) => rule.id === "HTTP-012")?.version).toBe(3);
    expect(report.results[0]).toMatchObject({
      status: "not-checked",
      eligibility: { state: "unavailable", missingData: ["transport"] },
    });
  });

  it("redacts long query secrets before HTTP-001 and HTTP-002 evidence hashing", () => {
    const secret = `sensitive-${"x".repeat(1_500)}`;
    const longPath = `/${"privacy-path-".repeat(100)}`;
    const rawHttpsUrl = `https://example.com${longPath}?token=${secret}`;
    const rawDigest = createHash("sha256").update(rawHttpsUrl).digest("hex");
    const secretDigest = createHash("sha256").update(secret).digest("hex");
    const http001 = evaluateHttpRule(
      "HTTP-001",
      snapshot({
        pages: [
          page({
            requestedUrl: `http://example.com${longPath}?token=${secret}`,
            normalizedUrl: `http://example.com${longPath}?token=${secret}`,
            finalUrl: rawHttpsUrl,
            redirectChain: [
              redirect({
                requestedUrl: `http://example.com${longPath}?token=${secret}`,
                resolvedUrl: rawHttpsUrl,
              }),
            ],
          }),
        ],
      }),
    );
    const http002 = evaluateHttpRule(
      "HTTP-002",
      snapshot({
        pages: [
          page({
            id: "privacy-apex",
            requestedUrl: rawHttpsUrl,
            normalizedUrl: rawHttpsUrl,
            finalUrl: rawHttpsUrl,
          }),
          page({
            id: "privacy-www",
            requestedUrl: `https://www.example.com${longPath}?token=${secret}`,
            normalizedUrl: `https://www.example.com${longPath}?token=${secret}`,
            finalUrl: rawHttpsUrl,
          }),
        ],
      }),
    );
    const serialized = JSON.stringify([http001.results, http002.results]);

    expect(http001.failures).toEqual([]);
    expect(http002.failures).toEqual([]);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(rawDigest);
    expect(serialized).not.toContain(secretDigest);
    expect(serialized).toContain("redacted");
    expect(serialized).toContain("sha256:");
  });

  it("evaluates only the first HSTS header field and rejects malformed effective policies", () => {
    const weakFirst = evaluateHttpRule(
      "HTTP-015",
      snapshot({
        pages: [
          page({
            securityHeaders: {
              "strict-transport-security": ["max-age=60", "max-age=31536000"],
            },
          }),
        ],
      }),
    );
    const strongFirst = evaluateHttpRule(
      "HTTP-015",
      snapshot({
        pages: [
          page({
            securityHeaders: {
              "strict-transport-security": ["max-age=31536000", "max-age=0"],
            },
          }),
        ],
      }),
    );
    const duplicateDirective = evaluateHttpRule(
      "HTTP-015",
      snapshot({
        pages: [
          page({
            securityHeaders: {
              "strict-transport-security": ["max-age=31536000; max-age=0"],
            },
          }),
        ],
      }),
    );

    expect(HTTP_RULES.find((rule) => rule.id === "HTTP-015")?.version).toBe(3);
    expect(weakFirst.results[0]).toMatchObject({ status: "failed" });
    expect(weakFirst.results[0]?.evidence[0]?.value).toEqual(
      expect.arrayContaining(["header_count=2", "effective_max_age=60"]),
    );
    expect(strongFirst.results[0]).toMatchObject({ status: "passed" });
    expect(duplicateDirective.results[0]).toMatchObject({
      status: "failed",
      detectedValue:
        "The first Strict-Transport-Security header has no single valid max-age directive.",
    });
  });
});
