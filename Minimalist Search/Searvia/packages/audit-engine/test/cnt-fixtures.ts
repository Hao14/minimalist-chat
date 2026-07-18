import type { AuditCrawlSnapshot, AuditPageLink, AuditPageObservation } from "../src/index.js";
import { extraction, page, snapshot } from "./fixtures.js";

type ExpectedStatus = "passed" | "failed" | "manual-review" | "not-checked";

export interface CntFixtureSet {
  readonly passing: AuditCrawlSnapshot;
  readonly passingStatus: ExpectedStatus;
  readonly failing: AuditCrawlSnapshot;
  readonly failingStatus: ExpectedStatus;
  readonly boundary: AuditCrawlSnapshot;
  readonly boundaryStatus: "not-checked";
}

function lexicalText(prefix: string, count = 150): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(" ");
}

function textPage(
  id: string,
  text: string,
  overrides: Partial<AuditPageObservation> = {},
): AuditPageObservation {
  const normalizedUrl = overrides.normalizedUrl ?? `https://example.com/${id}`;
  return page({
    id,
    requestedUrl: normalizedUrl,
    normalizedUrl,
    finalUrl: normalizedUrl,
    discoverySource: id === "page-home" ? "seed" : "link",
    depth: id === "page-home" ? 0 : 1,
    importance: id === "page-home" ? "homepage" : "standard",
    extraction: extraction({
      id: `extract-${id}`,
      title: `Title for ${id}`,
      canonicalUrl: normalizedUrl,
      visibleText: text,
      wordCount: text.trim() === "" ? 0 : text.trim().split(/\s+/u).length,
      contentHash: id.padEnd(64, "a").slice(0, 64),
    }),
    ...overrides,
  });
}

function link(overrides: Partial<AuditPageLink> = {}): AuditPageLink {
  return Object.freeze({
    id: "link-external",
    targetPageId: "page-source-target",
    targetUrl: "https://source.example/reference",
    normalizedTargetUrl: "https://source.example/reference",
    scope: "external",
    anchorText: "Primary source",
    relValues: Object.freeze([]),
    linkType: "anchor",
    discovered: false,
    crawlDepth: 1,
    discoverySource: "link",
    ordinal: 0,
    ...overrides,
  });
}

const normalPage = textPage("page-home", lexicalText("useful"), {
  normalizedUrl: "https://example.com/",
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
});
const noExtraction = snapshot({ pages: [page({ extraction: null })] });
const manualReview = snapshot({ pages: [normalPage] });
const partialReview = snapshot({ status: "partially_completed", pages: [normalPage] });

function manualPageFixture(): CntFixtureSet {
  return Object.freeze({
    passing: manualReview,
    passingStatus: "manual-review",
    failing: manualReview,
    failingStatus: "manual-review",
    boundary: noExtraction,
    boundaryStatus: "not-checked",
  });
}

function manualSiteFixture(): CntFixtureSet {
  return Object.freeze({
    passing: manualReview,
    passingStatus: "manual-review",
    failing: manualReview,
    failingStatus: "manual-review",
    boundary: partialReview,
    boundaryStatus: "not-checked",
  });
}

const sharedBoilerplate = lexicalText("shared", 160);
const duplicateSection = lexicalText("repeated", 90);

const healthyExternalSource = textPage("page-source-target", lexicalText("authority"), {
  normalizedUrl: "https://source.example/reference",
  requestedUrl: "https://source.example/reference",
  finalUrl: "https://source.example/reference",
});
const outboundSource = textPage("page-citation", lexicalText("citation"), {
  links: [link()],
});

export const CNT_FIXTURES: Readonly<Record<string, CntFixtureSet>> = Object.freeze({
  "CNT-001": {
    passing: snapshot({ pages: [normalPage] }),
    passingStatus: "passed",
    failing: snapshot({
      pages: [textPage("page-thin", "Small page with only a few distinct words.")],
    }),
    failingStatus: "failed",
    boundary: noExtraction,
    boundaryStatus: "not-checked",
  },
  "CNT-002": {
    passing: snapshot({
      pages: [
        textPage("page-alpha", lexicalText("alpha")),
        textPage("page-bravo", lexicalText("bravo")),
        textPage("page-charlie", lexicalText("charlie")),
      ],
    }),
    passingStatus: "passed",
    failing: snapshot({
      pages: [
        textPage("page-one", `${sharedBoilerplate} one-specific detail`),
        textPage("page-two", `${sharedBoilerplate} two-specific detail`),
        textPage("page-three", `${sharedBoilerplate} three-specific detail`),
      ],
    }),
    failingStatus: "failed",
    boundary: snapshot({ status: "partially_completed", pages: [normalPage] }),
    boundaryStatus: "not-checked",
  },
  "CNT-003": {
    passing: snapshot({
      pages: [textPage("page-red", lexicalText("red")), textPage("page-blue", lexicalText("blue"))],
    }),
    passingStatus: "passed",
    failing: snapshot({
      pages: [
        textPage("page-copy-a", `${duplicateSection} ${lexicalText("endingA", 30)}`),
        textPage("page-copy-b", `${duplicateSection} ${lexicalText("endingB", 30)}`),
      ],
    }),
    failingStatus: "failed",
    boundary: snapshot({ pages: [normalPage] }),
    boundaryStatus: "not-checked",
  },
  "CNT-004": {
    passing: snapshot({ pages: [normalPage] }),
    passingStatus: "passed",
    failing: snapshot({
      pages: [textPage("page-placeholder", `Lorem ipsum dolor sit amet ${lexicalText("draft")}`)],
    }),
    failingStatus: "failed",
    boundary: noExtraction,
    boundaryStatus: "not-checked",
  },
  "CNT-005": {
    passing: snapshot({ pages: [normalPage] }),
    passingStatus: "passed",
    failing: snapshot({
      pages: [textPage("page-encoding", `Broken replacement \uFFFD ${lexicalText("content")}`)],
    }),
    failingStatus: "failed",
    boundary: noExtraction,
    boundaryStatus: "not-checked",
  },
  "CNT-006": {
    passing: snapshot({ pages: [normalPage] }),
    passingStatus: "passed",
    failing: snapshot({
      pages: [
        textPage(
          "page-repetition",
          `${Array.from({ length: 25 }, () => "ranking").join(" ")} ${lexicalText("varied", 75)}`,
        ),
      ],
    }),
    failingStatus: "failed",
    boundary: snapshot({
      pages: [textPage("page-short", "brief words do not support a stable frequency ratio")],
    }),
    boundaryStatus: "not-checked",
  },
  "CNT-007": manualPageFixture(),
  "CNT-008": manualPageFixture(),
  "CNT-009": manualPageFixture(),
  "CNT-010": manualPageFixture(),
  "CNT-011": manualPageFixture(),
  "CNT-012": manualPageFixture(),
  "CNT-013": manualPageFixture(),
  "CNT-014": manualPageFixture(),
  "CNT-015": {
    passing: snapshot({ pages: [outboundSource, healthyExternalSource] }),
    passingStatus: "manual-review",
    failing: snapshot({
      pages: [
        outboundSource,
        page({ ...healthyExternalSource, statusCode: 404, extraction: null }),
      ],
    }),
    failingStatus: "manual-review",
    boundary: snapshot({
      pages: [
        textPage("page-citation-unobserved", lexicalText("citation"), {
          links: [link({ id: "link-unobserved", targetPageId: null })],
          extraction: extraction({
            id: "extract-page-citation-unobserved",
            visibleText: lexicalText("citation"),
            wordCount: 150,
            linksComplete: false,
          }),
        }),
      ],
    }),
    boundaryStatus: "not-checked",
  },
  "CNT-016": manualSiteFixture(),
  "CNT-017": {
    passing: snapshot({
      pages: [
        textPage("page-contact", `${lexicalText("company")} Contact support@example.com for help.`),
      ],
    }),
    passingStatus: "manual-review",
    failing: manualReview,
    failingStatus: "manual-review",
    boundary: partialReview,
    boundaryStatus: "not-checked",
  },
  "CNT-018": manualSiteFixture(),
  "CNT-019": manualSiteFixture(),
  "CNT-020": manualPageFixture(),
});
