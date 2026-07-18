import type {
  AuditCrawlSnapshot,
  AuditPageExtraction,
  AuditPageObservation,
} from "../src/index.js";
import { extraction, page, snapshot } from "./fixtures.js";

export type OnsRuleId = `ONS-${
  | "001"
  | "002"
  | "003"
  | "004"
  | "005"
  | "006"
  | "007"
  | "008"
  | "009"
  | "010"
  | "011"
  | "012"
  | "013"
  | "014"
  | "015"
  | "016"
  | "017"
  | "018"
  | "019"
  | "020"
  | "021"
  | "022"
  | "023"
  | "024"
  | "025"}`;

export type OnsExpectedStatus = "passed" | "failed" | "manual-review" | "not-checked";

export interface OnsRuleFixtureSet {
  readonly passing: AuditCrawlSnapshot;
  readonly passingStatus: "passed" | "not-checked";
  readonly issue: AuditCrawlSnapshot;
  readonly issueStatus: "failed" | "manual-review" | "not-checked";
  readonly boundary: AuditCrawlSnapshot;
}

const GOOD_TITLE = "Example Technical Audit Guide";
const GOOD_DESCRIPTION =
  "A clear and complete description of this technical audit page for users and search systems.";

function onsExtraction(overrides: Partial<AuditPageExtraction> = {}): AuditPageExtraction {
  return extraction({
    title: GOOD_TITLE,
    titleTagCount: 1,
    metaDescription: GOOD_DESCRIPTION,
    metaDescriptionTagCount: 1,
    headings: [
      { id: "heading-h1", level: 1, ordinal: 0, text: "Technical Audit Guide" },
      { id: "heading-h2", level: 2, ordinal: 1, text: "Audit details" },
    ],
    openGraph: {
      "og:title": [GOOD_TITLE],
      "og:type": ["website"],
      "og:url": ["https://example.com/"],
      "og:image": ["https://example.com/share.png"],
    },
    ...overrides,
  });
}

function onsPage(
  id = "page-home",
  path = "/",
  extractionOverrides: Partial<AuditPageExtraction> = {},
  pageOverrides: Partial<AuditPageObservation> = {},
): AuditPageObservation {
  const normalizedUrl = new URL(path, "https://example.com").href;
  return page({
    id,
    requestedUrl: normalizedUrl,
    normalizedUrl,
    finalUrl: normalizedUrl,
    extraction: onsExtraction({
      id: `extract-${id}`,
      canonicalUrl: normalizedUrl,
      ...extractionOverrides,
    }),
    ...pageOverrides,
  });
}

function one(
  extractionOverrides: Partial<AuditPageExtraction> = {},
  pageOverrides: Partial<AuditPageObservation> = {},
  snapshotOverrides: Partial<AuditCrawlSnapshot> = {},
): AuditCrawlSnapshot {
  return snapshot({
    pages: [onsPage("page-home", "/", extractionOverrides, pageOverrides)],
    ...snapshotOverrides,
  });
}

function pair(
  extractionOverrides: Partial<AuditPageExtraction>,
  pageOverrides: Partial<AuditPageObservation> = {},
): AuditCrawlSnapshot {
  return snapshot({
    pages: [
      onsPage("page-a", "/a", extractionOverrides, pageOverrides),
      onsPage("page-b", "/b", extractionOverrides, {
        ...pageOverrides,
        discoverySource: "link",
      }),
    ],
  });
}

const metadataBoundary = one({ documentMetadataComplete: false });
const headingBoundary = one({ headingsComplete: false });
const partialCorpusBoundary = one({}, {}, { status: "partially_completed" });

function fixtures(
  issue: AuditCrawlSnapshot,
  boundary: AuditCrawlSnapshot,
  options: Readonly<{
    passing?: AuditCrawlSnapshot;
    passingStatus?: "passed" | "not-checked";
    issueStatus?: "failed" | "manual-review" | "not-checked";
  }> = {},
): OnsRuleFixtureSet {
  return Object.freeze({
    passing: options.passing ?? one(),
    passingStatus: options.passingStatus ?? "passed",
    issue,
    issueStatus: options.issueStatus ?? "failed",
    boundary,
  });
}

const fixtureMap = {
  "ONS-001": fixtures(one({ title: null, titleTagCount: 0 }), metadataBoundary),
  "ONS-002": fixtures(one({ title: "", titleTagCount: 1 }), metadataBoundary),
  "ONS-003": fixtures(
    pair({ title: "Duplicated Page Title", titleTagCount: 1 }),
    partialCorpusBoundary,
  ),
  "ONS-004": fixtures(one({ titleTagCount: 2 }), metadataBoundary),
  "ONS-005": fixtures(one({ title: "Short" }), metadataBoundary),
  "ONS-006": fixtures(one({ title: "T".repeat(61) }), metadataBoundary),
  "ONS-007": fixtures(one({ metaDescription: null, metaDescriptionTagCount: 0 }), metadataBoundary),
  "ONS-008": fixtures(one({ metaDescription: "", metaDescriptionTagCount: 1 }), metadataBoundary),
  "ONS-009": fixtures(
    pair({
      metaDescription:
        "The same complete description is deliberately repeated across both fixture pages.",
      metaDescriptionTagCount: 1,
    }),
    partialCorpusBoundary,
  ),
  "ONS-010": fixtures(one({ metaDescriptionTagCount: 2 }), metadataBoundary),
  "ONS-011": fixtures(one({ metaDescription: "A short summary." }), metadataBoundary),
  "ONS-012": fixtures(one({ metaDescription: "D".repeat(161) }), metadataBoundary),
  "ONS-013": fixtures(one({ headings: [] }), headingBoundary),
  "ONS-014": fixtures(
    one({ headings: [{ id: "empty-h1", level: 1, ordinal: 0, text: "  " }] }),
    headingBoundary,
  ),
  "ONS-015": fixtures(
    one({
      headings: [
        { id: "first-h1", level: 1, ordinal: 0, text: "Primary topic" },
        { id: "second-h1", level: 1, ordinal: 1, text: "Secondary region" },
      ],
    }),
    headingBoundary,
    { issueStatus: "manual-review" },
  ),
  "ONS-016": fixtures(
    pair(
      {
        headings: [{ id: "shared-h1", level: 1, ordinal: 0, text: "Shared important topic" }],
      },
      { importance: "important" },
    ),
    partialCorpusBoundary,
  ),
  "ONS-017": fixtures(
    one({
      headings: [
        { id: "first-h1", level: 1, ordinal: 0, text: "Primary topic" },
        { id: "skipped-h3", level: 3, ordinal: 1, text: "Skipped section" },
      ],
    }),
    headingBoundary,
  ),
  "ONS-018": fixtures(one({ viewportDeclarations: [] }), metadataBoundary),
  "ONS-019": fixtures(one({ htmlLanguage: "en_US" }), metadataBoundary),
  "ONS-020": fixtures(
    one({
      characterEncoding: {
        used: "utf-8",
        declared: null,
        source: "default",
        declarationOffsetBytes: null,
      },
    }),
    one({
      characterEncoding: {
        used: "utf-8",
        declared: "utf-8",
        source: "meta",
        declarationOffsetBytes: null,
      },
    }),
  ),
  "ONS-021": fixtures(one({ htmlDoctypePresent: false }), metadataBoundary),
  "ONS-022": fixtures(one({ openGraph: { "og:title": [GOOD_TITLE] } }), metadataBoundary),
  "ONS-023": fixtures(one({ openGraph: {}, socialCards: {} }), metadataBoundary, {
    passingStatus: "not-checked",
  }),
  "ONS-024": fixtures(one({ iconDeclarationCount: 0 }), metadataBoundary, {
    passingStatus: "not-checked",
    issueStatus: "not-checked",
  }),
  "ONS-025": fixtures(
    snapshot({
      pages: [
        onsPage(
          "page-home",
          "/",
          {
            visibleText: "",
            wordCount: 0,
            meaningfulContent: false,
            clientRendered: true,
          },
          {
            renderedExtraction: onsExtraction({
              id: "extract-page-home-rendered",
              source: "rendered",
              visibleText: "",
              wordCount: 0,
              meaningfulContent: false,
            }),
          },
        ),
      ],
    }),
    one({
      visibleText: "",
      wordCount: 0,
      meaningfulContent: false,
      clientRendered: true,
    }),
  ),
} satisfies Readonly<Record<OnsRuleId, OnsRuleFixtureSet>>;

export const ONS_RULE_FIXTURES: Readonly<Record<OnsRuleId, OnsRuleFixtureSet>> =
  Object.freeze(fixtureMap);
