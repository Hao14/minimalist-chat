import type { AuditCrawlSnapshot, AuditPageLink, AuditPageObservation } from "../src/index.js";

import { extraction, page, redirect, snapshot } from "./fixtures.js";

type ExpectedStatus = "passed" | "failed" | "manual-review" | "not-checked";

interface FixtureScenario {
  readonly snapshot: AuditCrawlSnapshot;
  readonly expectedStatus: ExpectedStatus;
}

export interface LnkRuleFixtureSet {
  readonly passing: FixtureScenario;
  readonly finding: FixtureScenario;
  readonly boundary: FixtureScenario;
}

function makeLink(overrides: Partial<AuditPageLink> = {}): AuditPageLink {
  return Object.freeze({
    id: "link-source-target",
    targetPageId: "page-target",
    targetUrl: "https://example.com/target",
    normalizedTargetUrl: "https://example.com/target",
    scope: "internal",
    anchorText: "Useful target",
    relValues: Object.freeze([]),
    linkType: "anchor",
    discovered: true,
    crawlDepth: 1,
    discoverySource: "link",
    ordinal: 0,
    ...overrides,
  });
}

function makePage(
  url: string,
  id: string,
  overrides: Partial<AuditPageObservation> = {},
): AuditPageObservation {
  return page({
    id,
    requestedUrl: url,
    normalizedUrl: url,
    finalUrl: url,
    discoverySource: id === "page-source" ? "seed" : "link",
    depth: id === "page-source" ? 0 : 1,
    importance: id === "page-source" ? "homepage" : "standard",
    robotsObservationId: "robots-home",
    robotsResult: "fetched",
    extraction: extraction({
      id: `extract-${id}`,
      canonicalUrl: url,
    }),
    ...overrides,
  });
}

function linkedSite(
  linkOverrides: Partial<AuditPageLink> = {},
  targetOverrides: Partial<AuditPageObservation> = {},
  sourceOverrides: Partial<AuditPageObservation> = {},
): AuditCrawlSnapshot {
  const link = makeLink(linkOverrides);
  const source = makePage("https://example.com/", "page-source", {
    links: Object.freeze([link]),
    ...sourceOverrides,
  });
  const targetUrl = link.normalizedTargetUrl;
  const target = makePage(targetUrl, link.targetPageId ?? "page-target", targetOverrides);
  return snapshot({ pages: Object.freeze([source, target]) });
}

function noLinkSite(
  targetOverrides: Partial<AuditPageObservation> = {},
  sourceOverrides: Partial<AuditPageObservation> = {},
): AuditCrawlSnapshot {
  return snapshot({
    pages: Object.freeze([
      makePage("https://example.com/", "page-source", sourceOverrides),
      makePage("https://example.com/target", "page-target", targetOverrides),
    ]),
  });
}

function scenario(input: AuditCrawlSnapshot, expectedStatus: ExpectedStatus): FixtureScenario {
  return Object.freeze({ snapshot: input, expectedStatus });
}

function triad(
  passing: FixtureScenario,
  finding: FixtureScenario,
  boundary: FixtureScenario,
): LnkRuleFixtureSet {
  return Object.freeze({ passing, finding, boundary });
}

const passLinked = () => scenario(linkedSite(), "passed");
const missingRaw = () => scenario(linkedSite({}, {}, { extraction: null }), "not-checked");

const sourceWithLinks = (
  links: readonly AuditPageLink[],
  overrides: Partial<AuditPageObservation> = {},
): AuditPageObservation =>
  makePage("https://example.com/", "page-source", {
    links: Object.freeze([...links]),
    ...overrides,
  });

const paginationSite = (targetStatus: number | null, reciprocal: boolean): AuditCrawlSnapshot => {
  const next = makeLink({ relValues: Object.freeze(["next"]) });
  const previous = makeLink({
    id: "link-target-source",
    targetPageId: "page-source",
    targetUrl: "https://example.com/",
    normalizedTargetUrl: "https://example.com/",
    relValues: Object.freeze(["prev"]),
  });
  return snapshot({
    pages: Object.freeze([
      sourceWithLinks([next]),
      makePage("https://example.com/target", "page-target", {
        statusCode: targetStatus,
        links: Object.freeze(reciprocal ? [previous] : []),
      }),
    ]),
  });
};

const queryVariantSite = (count: number, status: AuditCrawlSnapshot["status"] = "completed") =>
  snapshot({
    status,
    pages: Object.freeze(
      Array.from({ length: count }, (_, index) =>
        makePage(`https://example.com/products?filter=${index}`, `page-query-${index}`, {
          discoverySource: index === 0 ? "seed" : "link",
        }),
      ),
    ),
  });

const importantTarget = (overrides: Partial<AuditPageObservation> = {}) => ({
  importance: "important" as const,
  ...overrides,
});

export const LNK_FIXTURES: Readonly<Record<string, LnkRuleFixtureSet>> = Object.freeze({
  "LNK-001": triad(
    passLinked(),
    scenario(linkedSite({}, { statusCode: 404 }), "failed"),
    scenario(linkedSite({}, { statusCode: null }), "not-checked"),
  ),
  "LNK-002": triad(
    passLinked(),
    scenario(linkedSite({}, { statusCode: 503 }), "failed"),
    scenario(linkedSite({}, { statusCode: null }), "not-checked"),
  ),
  "LNK-003": triad(
    passLinked(),
    scenario(
      linkedSite(
        {},
        {
          finalUrl: "https://example.com/final",
          redirectChain: Object.freeze([
            redirect({
              requestedUrl: "https://example.com/target",
              resolvedUrl: "https://example.com/final",
            }),
          ]),
        },
      ),
      "failed",
    ),
    scenario(linkedSite({}, { statusCode: null }), "not-checked"),
  ),
  "LNK-004": triad(
    scenario(
      linkedSite(
        {
          targetUrl: "https://outside.example/resource",
          normalizedTargetUrl: "https://outside.example/resource",
          scope: "external",
        },
        {},
      ),
      "passed",
    ),
    scenario(
      linkedSite(
        {
          targetUrl: "https://outside.example/resource",
          normalizedTargetUrl: "https://outside.example/resource",
          scope: "external",
        },
        { statusCode: 404 },
      ),
      "failed",
    ),
    scenario(
      snapshot({
        pages: Object.freeze([
          sourceWithLinks([
            makeLink({
              targetPageId: null,
              targetUrl: "https://outside.example/resource",
              normalizedTargetUrl: "https://outside.example/resource",
              scope: "external",
            }),
          ]),
        ]),
      }),
      "not-checked",
    ),
  ),
  "LNK-005": triad(
    passLinked(),
    scenario(linkedSite({ targetUrl: "http://example.com/target" }), "failed"),
    missingRaw(),
  ),
  "LNK-006": triad(
    passLinked(),
    scenario(
      linkedSite(
        {},
        {
          extraction: extraction({
            id: "extract-page-target",
            canonicalUrl: "https://example.com/preferred",
          }),
        },
      ),
      "failed",
    ),
    scenario(
      linkedSite(
        {},
        {
          extraction: extraction({
            id: "extract-page-target-multiple-canonicals",
            canonicalTagCount: 2,
            canonicalUrl: "https://example.com/target",
          }),
        },
      ),
      "not-checked",
    ),
  ),
  "LNK-007": triad(
    scenario(linkedSite(), "not-checked"),
    scenario(linkedSite({ targetUrl: "mailto:owner@example.com" }), "not-checked"),
    missingRaw(),
  ),
  "LNK-008": triad(
    scenario(linkedSite(), "not-checked"),
    scenario(
      linkedSite(
        {},
        {},
        { extraction: extraction({ javascriptRedirectUrl: "https://example.com/target" }) },
      ),
      "not-checked",
    ),
    missingRaw(),
  ),
  "LNK-009": triad(
    passLinked(),
    scenario(linkedSite({ targetUrl: "https://example.com/#" }), "failed"),
    scenario(
      linkedSite({}, {}, { extraction: extraction({ linksComplete: false }) }),
      "not-checked",
    ),
  ),
  "LNK-010": triad(
    scenario(linkedSite({}, importantTarget()), "passed"),
    scenario(noLinkSite(importantTarget()), "failed"),
    scenario(
      noLinkSite(importantTarget(), { extraction: extraction({ linksComplete: false }) }),
      "not-checked",
    ),
  ),
  "LNK-011": triad(
    scenario(
      snapshot({
        pages: Object.freeze([
          sourceWithLinks([makeLink()]),
          makePage("https://example.com/other", "page-other", {
            links: Object.freeze([makeLink({ id: "link-other-target" })]),
          }),
          makePage("https://example.com/target", "page-target", importantTarget()),
        ]),
      }),
      "passed",
    ),
    scenario(linkedSite({}, importantTarget()), "failed"),
    scenario(
      linkedSite({}, importantTarget(), { extraction: extraction({ linksComplete: false }) }),
      "not-checked",
    ),
  ),
  "LNK-012": triad(
    scenario(noLinkSite(importantTarget({ depth: 3 })), "passed"),
    scenario(noLinkSite(importantTarget({ depth: 4 })), "failed"),
    scenario(
      snapshot({
        status: "partially_completed",
        pages: noLinkSite(importantTarget({ depth: 4 })).pages,
      }),
      "not-checked",
    ),
  ),
  "LNK-013": triad(
    scenario(linkedSite({}, importantTarget()), "manual-review"),
    scenario(noLinkSite(importantTarget()), "manual-review"),
    scenario(noLinkSite(), "not-checked"),
  ),
  "LNK-014": triad(
    passLinked(),
    scenario(
      snapshot({
        pages: Object.freeze([
          sourceWithLinks(
            Array.from({ length: 201 }, (_, index) =>
              makeLink({ id: `link-excessive-${index}`, ordinal: index }),
            ),
          ),
        ]),
      }),
      "failed",
    ),
    scenario(
      linkedSite({}, {}, { extraction: extraction({ linksComplete: false }) }),
      "not-checked",
    ),
  ),
  "LNK-015": triad(
    passLinked(),
    scenario(linkedSite({ relValues: Object.freeze(["nofollow"]) }), "manual-review"),
    scenario(
      linkedSite({}, {}, { extraction: extraction({ linksComplete: false }) }),
      "not-checked",
    ),
  ),
  "LNK-016": triad(
    passLinked(),
    scenario(linkedSite({ anchorText: "Click here" }), "failed"),
    scenario(linkedSite({ anchorText: null }), "manual-review"),
  ),
  "LNK-017": triad(
    passLinked(),
    scenario(linkedSite({ targetUrl: "https://example.com/target#details" }), "not-checked"),
    scenario(
      linkedSite({}, {}, { extraction: extraction({ linksComplete: false }) }),
      "not-checked",
    ),
  ),
  "LNK-018": triad(
    scenario(paginationSite(200, true), "passed"),
    scenario(paginationSite(404, false), "failed"),
    scenario(paginationSite(null, false), "not-checked"),
  ),
  "LNK-019": triad(
    scenario(queryVariantSite(1), "passed"),
    scenario(queryVariantSite(10), "failed"),
    scenario(queryVariantSite(1, "partially_completed"), "not-checked"),
  ),
  "LNK-020": triad(
    scenario(linkedSite({}, importantTarget()), "manual-review"),
    scenario(noLinkSite(importantTarget()), "manual-review"),
    scenario(noLinkSite(), "not-checked"),
  ),
});
