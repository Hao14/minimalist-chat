import type { AuditEvidenceItem } from "@searvia/shared-types";

import type {
  AuditEnginePolicy,
  AuditObservationKey,
  AuditRuleDefinition,
  AuditRuleOutcome,
} from "../contracts.js";
import type { AuditCrawlSnapshot, AuditPageExtraction, AuditPageObservation } from "../snapshot.js";
import {
  boundedEvidenceText,
  boundedEvidenceUrl,
  boundedPageEvidence,
  checkedOutcome,
  defineM5RuleVersion,
  eligibleOutcome,
  evidenceObservationDigest,
  isHtmlContentType,
  isSuccessful,
  notCheckedOutcome,
  pageEvidence,
  pageIndexabilityMissingData,
  pageTarget,
  pageUnavailable,
  requestedPageIndexabilityState,
  sampleEvidenceStrings,
  safeUrl,
  type defineM5Rule,
} from "./helpers.js";

const ON_PAGE_IMPACTS = ["search-visibility", "ai-retrievability", "user-experience"] as const;
const HTML_IMPACTS = ["search-visibility", "user-experience"] as const;

type M5RuleMetadata = Parameters<typeof defineM5Rule>[0];
type MetadataDetector = (
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
  extraction: AuditPageExtraction,
  policy: AuditEnginePolicy,
) => AuditRuleOutcome;

function successfulHtmlPages(snapshot: AuditCrawlSnapshot): readonly AuditPageObservation[] {
  return snapshot.pages.filter((page) => isSuccessful(page) && isHtmlContentType(page.contentType));
}

function unavailablePage(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
  reason: string,
  missingData: readonly AuditObservationKey[],
  evidenceItems?: readonly AuditEvidenceItem[],
): AuditRuleOutcome {
  return notCheckedOutcome({
    target: pageTarget(page),
    snapshot,
    reason,
    missingData,
    ...(evidenceItems === undefined ? {} : { evidence: evidenceItems }),
  });
}

function ineligiblePage(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
  reason: string,
  field: string,
  value: string | number,
): AuditRuleOutcome {
  return notCheckedOutcome({
    target: pageTarget(page),
    snapshot,
    state: "ineligible",
    reason,
    missingData: [],
    evidence: [pageEvidence(page, field, value, "raw")],
  });
}

function metadataUnavailable(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
  key: string,
): AuditRuleOutcome | null {
  const extraction = page.extraction;
  if (extraction === null || extraction.source !== "raw") {
    return unavailablePage(
      snapshot,
      page,
      "A successful raw HTML extraction is unavailable, so document metadata cannot be evaluated.",
      ["raw-extraction"],
      [pageEvidence(page, `${key}_raw_extraction`, "unavailable")],
    );
  }
  if (!extraction.documentMetadataComplete) {
    return unavailablePage(
      snapshot,
      page,
      "The persisted extraction does not prove complete document-metadata coverage. Missing tags cannot be inferred from legacy or bounded data.",
      ["raw-extraction"],
      [pageEvidence(page, `${key}_metadata_complete`, false, "raw")],
    );
  }
  return null;
}

function headingsUnavailable(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
  key: string,
): AuditRuleOutcome | null {
  const extraction = page.extraction;
  if (extraction === null || extraction.source !== "raw") {
    return unavailablePage(
      snapshot,
      page,
      "A successful raw HTML extraction is unavailable, so headings cannot be evaluated.",
      ["raw-extraction"],
      [pageEvidence(page, `${key}_raw_extraction`, "unavailable")],
    );
  }
  if (!extraction.headingsComplete) {
    return unavailablePage(
      snapshot,
      page,
      "The persisted heading collection is incomplete, so absence and heading counts cannot be concluded.",
      ["raw-extraction"],
      [pageEvidence(page, `${key}_headings_complete`, false, "raw")],
    );
  }
  return null;
}

function defineMetadataRule(
  metadata: M5RuleMetadata,
  coverageKey: string,
  detector: MetadataDetector,
  version = 1,
): AuditRuleDefinition {
  return defineM5RuleVersion(metadata, version, (snapshot, policy) => {
    const pages = successfulHtmlPages(snapshot);
    if (pages.length === 0) {
      return pageUnavailable(
        snapshot,
        coverageKey,
        "No successfully fetched HTML page was available for this document-metadata check.",
        ["pages", "transport", "raw-extraction"],
      );
    }
    return pages.map((page) => {
      const unavailable = metadataUnavailable(snapshot, page, coverageKey);
      if (unavailable !== null) return unavailable;
      return detector(snapshot, page, page.extraction!, policy);
    });
  });
}

function defineHeadingRule(
  metadata: M5RuleMetadata,
  coverageKey: string,
  detector: MetadataDetector,
  version = 1,
): AuditRuleDefinition {
  return defineM5RuleVersion(metadata, version, (snapshot, policy) => {
    const pages = successfulHtmlPages(snapshot);
    if (pages.length === 0) {
      return pageUnavailable(
        snapshot,
        coverageKey,
        "No successfully fetched HTML page was available for this heading check.",
        ["pages", "transport", "raw-extraction"],
      );
    }
    return pages.map((page) => {
      const unavailable = headingsUnavailable(snapshot, page, coverageKey);
      if (unavailable !== null) return unavailable;
      return detector(snapshot, page, page.extraction!, policy);
    });
  });
}

function normalizedWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizedText(value: string): string {
  return normalizedWhitespace(value).toLowerCase();
}

interface CorpusCoverageIssue {
  readonly reason: string;
  readonly missingData: readonly AuditObservationKey[];
}

function duplicateCorpusIssue(
  snapshot: AuditCrawlSnapshot,
  kind: "title" | "meta-description" | "h1",
  importantOnly: boolean,
): CorpusCoverageIssue | null {
  if (snapshot.status !== "completed") {
    return {
      reason: "The crawl was not completed, so absence of a duplicate cannot be concluded.",
      missingData: ["crawl"],
    };
  }
  for (const page of snapshot.pages) {
    if (importantOnly && page.importance === "standard" && page.discoverySource !== "seed") {
      continue;
    }
    const indexability = requestedPageIndexabilityState(page);
    if (indexability === "unknown") {
      return {
        reason: `Indexability is unavailable for ${boundedEvidenceUrl(page.normalizedUrl, 512)}, so the comparison corpus is incomplete.`,
        missingData: pageIndexabilityMissingData(page),
      };
    }
    if (indexability !== "indexable") continue;
    const extraction = page.extraction;
    const complete =
      extraction?.source === "raw" &&
      (kind === "h1" ? extraction.headingsComplete : extraction.documentMetadataComplete);
    if (!complete) {
      return {
        reason: `Comparable ${kind} extraction is unavailable for ${boundedEvidenceUrl(page.normalizedUrl, 512)}, so the comparison corpus is incomplete.`,
        missingData: ["raw-extraction"],
      };
    }
  }
  return null;
}

function duplicateEvidence(
  page: AuditPageObservation,
  field: string,
  value: string,
  peers: readonly AuditPageObservation[],
): readonly AuditEvidenceItem[] {
  return [
    pageEvidence(page, `${field}_source`, boundedEvidenceText(value), "raw"),
    ...peers
      .slice(0, 12)
      .map((peer) =>
        boundedPageEvidence(
          peer,
          `${field}_duplicate_peer`,
          [`peer_page=${peer.id}`, `observed_value=${boundedEvidenceText(value)}`],
          "raw",
        ),
      ),
  ];
}

function duplicateMetadataRule(
  metadata: M5RuleMetadata,
  kind: "title" | "meta-description",
  version: number,
): AuditRuleDefinition {
  return defineM5RuleVersion(metadata, version, (snapshot) => {
    const issue = duplicateCorpusIssue(snapshot, kind, false);
    const pages = successfulHtmlPages(snapshot).filter((page) => {
      if (requestedPageIndexabilityState(page) !== "indexable") return false;
      const extraction = page.extraction;
      if (extraction?.source !== "raw" || !extraction.documentMetadataComplete) return false;
      const count =
        kind === "title" ? extraction.titleTagCount : extraction.metaDescriptionTagCount;
      const value = kind === "title" ? extraction.title : extraction.metaDescription;
      return count === 1 && value !== null && normalizedText(value) !== "";
    });
    if (pages.length === 0) {
      return pageUnavailable(
        snapshot,
        `${kind}-duplicates`,
        issue?.reason ?? `No indexable page had one non-empty ${kind} value to compare.`,
        issue?.missingData ?? ["raw-extraction", "robots"],
      );
    }
    const pagesByValue = new Map<string, AuditPageObservation[]>();
    for (const page of pages) {
      const value =
        kind === "title"
          ? (page.extraction?.title ?? "")
          : (page.extraction?.metaDescription ?? "");
      const comparable = normalizedText(value);
      const matching = pagesByValue.get(comparable) ?? [];
      matching.push(page);
      pagesByValue.set(comparable, matching);
    }
    return pages.map((page) => {
      const value =
        kind === "title"
          ? (page.extraction?.title ?? "")
          : (page.extraction?.metaDescription ?? "");
      const comparable = normalizedText(value);
      const matching = pagesByValue.get(comparable) ?? [];
      const peerCount = Math.max(0, matching.length - 1);
      const peers: AuditPageObservation[] = [];
      for (const peer of matching) {
        if (peer.id !== page.id) peers.push(peer);
        if (peers.length === 12) break;
      }
      if (peerCount === 0 && issue !== null) {
        return unavailablePage(snapshot, page, issue.reason, issue.missingData, [
          pageEvidence(page, `${kind}_corpus_coverage`, "incomplete", "raw"),
        ]);
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: peerCount > 0,
        evidence: duplicateEvidence(page, kind.replace("-", "_"), value, peers),
        detectedValue:
          peerCount > 0
            ? `The normalized ${kind} value occurs on ${peerCount + 1} indexable crawled pages.`
            : `The normalized ${kind} value is unique among eligible crawled pages.`,
      });
    });
  });
}

function h1Values(extraction: AuditPageExtraction): readonly string[] {
  return extraction.headings
    .filter((heading) => heading.level === 1 && normalizedText(heading.text) !== "")
    .map((heading) => normalizedText(heading.text));
}

const ons001 = defineMetadataRule(
  {
    id: "ONS-001",
    title: "Page title is missing",
    category: "on-page",
    defaultSeverity: "high",
    scope: "page",
    description: "Checks complete raw HTML metadata for the presence of a title element.",
    eligibility: "A successful HTML response has complete raw document-metadata extraction.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation:
      "A missing title removes a primary search-result and document-identification signal.",
    expectedValue: "The raw HTML document contains at least one title element.",
    recommendedFix:
      "Add one descriptive title element inside the document head and make it specific to this page.",
    verification: "Inspect the raw HTML head and confirm exactly one title element is present.",
    confidence: "high",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "seo",
  },
  "title-missing",
  (_snapshot, page, extraction) =>
    checkedOutcome({
      target: pageTarget(page),
      failed: extraction.titleTagCount === 0,
      evidence: [pageEvidence(page, "title_tag_count", extraction.titleTagCount, "raw")],
      detectedValue: `${extraction.titleTagCount} title element(s) were observed in raw HTML.`,
    }),
);

const ons002 = defineMetadataRule(
  {
    id: "ONS-002",
    title: "Page title is empty",
    category: "on-page",
    defaultSeverity: "high",
    scope: "page",
    description: "Checks whether an observed title element contains non-whitespace text.",
    eligibility: "Complete raw metadata contains at least one title element and a preserved value.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation: "An empty title provides no useful label to search engines, browsers, or users.",
    expectedValue: "The title element contains concise, page-specific text.",
    recommendedFix:
      "Replace the empty title content with a concise page-specific title that identifies the topic or purpose.",
    verification:
      "Inspect the raw title element and confirm its text is non-empty after whitespace normalization.",
    confidence: "high",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "seo",
  },
  "title-empty",
  (snapshot, page, extraction) => {
    if (extraction.titleTagCount !== 1) {
      return ineligiblePage(
        snapshot,
        page,
        extraction.titleTagCount === 0
          ? "No title element exists; ONS-001 reports the missing element and emptiness is not evaluated."
          : "Multiple title elements exist; ONS-004 reports the ambiguity and a single empty-title value cannot be selected safely.",
        "title_tag_count",
        extraction.titleTagCount,
      );
    }
    if (extraction.title === null) {
      return unavailablePage(
        snapshot,
        page,
        "A title element count was preserved but its selected text value is unavailable.",
        ["raw-extraction"],
        [pageEvidence(page, "title_value", "unavailable", "raw")],
      );
    }
    return checkedOutcome({
      target: pageTarget(page),
      failed: normalizedText(extraction.title) === "",
      evidence: [pageEvidence(page, "title_text", boundedEvidenceText(extraction.title), "raw")],
      detectedValue:
        normalizedText(extraction.title) === ""
          ? "The observed title contains no non-whitespace text."
          : "The observed title contains non-whitespace text.",
    });
  },
);

const ons003 = duplicateMetadataRule(
  {
    id: "ONS-003",
    title: "Page title is duplicated across indexable pages",
    category: "on-page",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Compares whitespace-normalized titles across indexable pages in a completed crawl.",
    eligibility:
      "A non-redirecting requested URL is indexable, has one non-empty raw title, and has conclusive corpus coverage.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "robots"],
    explanation:
      "Duplicate titles make distinct pages harder to distinguish in search results and reports.",
    expectedValue: "The page title is unique among eligible indexable crawled pages.",
    recommendedFix:
      "Write a distinct title that describes this page's unique purpose while retaining accurate brand context.",
    verification:
      "Re-crawl the site and confirm the normalized title occurs on only this indexable page.",
    confidence: "high",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "seo",
  },
  "title",
  2,
);

const ons004 = defineMetadataRule(
  {
    id: "ONS-004",
    title: "Page contains multiple title elements",
    category: "on-page",
    defaultSeverity: "high",
    scope: "page",
    description: "Counts title elements in complete raw document metadata.",
    eligibility: "A successful HTML response has complete raw document-metadata extraction.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation:
      "Multiple title elements create ambiguous document metadata and inconsistent parser behavior.",
    expectedValue: "The raw HTML document contains no more than one title element.",
    recommendedFix:
      "Remove duplicate title elements and keep one authoritative title inside the document head.",
    verification: "Inspect the raw HTML and confirm exactly zero or one title element remains.",
    confidence: "high",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "developer",
  },
  "multiple-titles",
  (_snapshot, page, extraction) =>
    checkedOutcome({
      target: pageTarget(page),
      failed: extraction.titleTagCount > 1,
      evidence: [pageEvidence(page, "title_tag_count", extraction.titleTagCount, "raw")],
      detectedValue: `${extraction.titleTagCount} title element(s) were observed in raw HTML.`,
    }),
);

function defineTitleLengthRule(
  id: "ONS-005" | "ONS-006",
  mode: "minimum" | "maximum",
  metadata: Omit<M5RuleMetadata, "id">,
): AuditRuleDefinition {
  return defineMetadataRule(
    { ...metadata, id },
    `${id.toLowerCase()}-title-length`,
    (snapshot, page, extraction, policy) => {
      if (
        extraction.titleTagCount !== 1 ||
        extraction.title === null ||
        normalizedText(extraction.title) === ""
      ) {
        return ineligiblePage(
          snapshot,
          page,
          "Title length requires exactly one non-empty title; missing, empty, or multiple-title cases are handled separately.",
          "title_tag_count",
          extraction.titleTagCount,
        );
      }
      const length = [...normalizedWhitespace(extraction.title)].length;
      const threshold =
        mode === "minimum" ? policy.titleMinimumCharacters : policy.titleMaximumCharacters;
      const failed = mode === "minimum" ? length < threshold : length > threshold;
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [pageEvidence(page, "title_character_count", length, "raw")],
        detectedValue: `The normalized title contains ${length} Unicode character(s).`,
        expectedValue:
          mode === "minimum"
            ? `At least ${threshold} Unicode character(s).`
            : `At most ${threshold} Unicode character(s).`,
        confidence: "medium",
      });
    },
    2,
  );
}

const ons005 = defineTitleLengthRule("ONS-005", "minimum", {
  title: "Page title is unusually short",
  category: "on-page",
  defaultSeverity: "low",
  scope: "page",
  description: "Measures a single normalized title against the versioned minimum-character policy.",
  eligibility: "Complete raw metadata contains exactly one non-empty title element.",
  requiredData: ["pages", "transport", "raw-extraction", "configuration"],
  explanation:
    "An unusually short title may not communicate enough page-specific context to users or search systems.",
  expectedValue: "The title meets the configured minimum character threshold.",
  recommendedFix:
    "Expand the title with accurate page-specific context without adding repetitive or irrelevant words.",
  verification:
    "Measure the normalized title and confirm it meets the versioned minimum-character threshold.",
  confidence: "medium",
  impactAreas: ON_PAGE_IMPACTS,
  responsibleOwner: "seo",
});

const ons006 = defineTitleLengthRule("ONS-006", "maximum", {
  title: "Page title is likely truncated because of excessive length",
  category: "on-page",
  defaultSeverity: "medium",
  scope: "page",
  description: "Measures a single normalized title against the versioned maximum-character policy.",
  eligibility: "Complete raw metadata contains exactly one non-empty title element.",
  requiredData: ["pages", "transport", "raw-extraction", "configuration"],
  explanation:
    "A long title is more likely to be truncated and can obscure the page's most useful wording.",
  expectedValue: "The title stays within the configured maximum character threshold.",
  recommendedFix:
    "Shorten the title to its essential page-specific wording and move low-value qualifiers after the core topic.",
  verification:
    "Measure the normalized title and confirm it is within the versioned maximum-character threshold.",
  confidence: "medium",
  impactAreas: ON_PAGE_IMPACTS,
  responsibleOwner: "seo",
});

const ons007 = defineMetadataRule(
  {
    id: "ONS-007",
    title: "Meta description is missing",
    category: "on-page",
    defaultSeverity: "medium",
    scope: "page",
    description: "Checks complete raw metadata for a meta description declaration.",
    eligibility: "A successful HTML response has complete raw document-metadata extraction.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation:
      "A missing description leaves search systems without a deliberate summary candidate for the page.",
    expectedValue: "The raw HTML contains at least one meta description declaration.",
    recommendedFix:
      "Add one accurate meta description that summarizes this page and sets an honest expectation for visitors.",
    verification:
      "Inspect the raw HTML head and confirm one meta description declaration is present.",
    confidence: "high",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "seo",
  },
  "meta-description-missing",
  (_snapshot, page, extraction) =>
    checkedOutcome({
      target: pageTarget(page),
      failed: extraction.metaDescriptionTagCount === 0,
      evidence: [
        pageEvidence(page, "meta_description_tag_count", extraction.metaDescriptionTagCount, "raw"),
      ],
      detectedValue: `${extraction.metaDescriptionTagCount} meta description declaration(s) were observed.`,
    }),
);

const ons008 = defineMetadataRule(
  {
    id: "ONS-008",
    title: "Meta description is empty",
    category: "on-page",
    defaultSeverity: "medium",
    scope: "page",
    description: "Checks whether an observed meta description contains non-whitespace text.",
    eligibility:
      "Complete raw metadata contains at least one meta description and a preserved value.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation:
      "An empty meta description provides no useful page summary to search systems or users.",
    expectedValue: "The meta description contains an accurate non-empty page summary.",
    recommendedFix:
      "Replace the empty content value with a concise and accurate summary of this page's distinct purpose.",
    verification:
      "Inspect the raw meta description and confirm its content is non-empty after whitespace normalization.",
    confidence: "high",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "seo",
  },
  "meta-description-empty",
  (snapshot, page, extraction) => {
    if (extraction.metaDescriptionTagCount !== 1) {
      return ineligiblePage(
        snapshot,
        page,
        extraction.metaDescriptionTagCount === 0
          ? "No meta description exists; ONS-007 reports the missing declaration and emptiness is not evaluated."
          : "Multiple meta descriptions exist; ONS-010 reports the ambiguity and a single empty-description value cannot be selected safely.",
        "meta_description_tag_count",
        extraction.metaDescriptionTagCount,
      );
    }
    if (extraction.metaDescription === null) {
      return unavailablePage(
        snapshot,
        page,
        "A meta description count was preserved but its selected content value is unavailable.",
        ["raw-extraction"],
        [pageEvidence(page, "meta_description_value", "unavailable", "raw")],
      );
    }
    return checkedOutcome({
      target: pageTarget(page),
      failed: normalizedText(extraction.metaDescription) === "",
      evidence: [
        pageEvidence(
          page,
          "meta_description",
          boundedEvidenceText(extraction.metaDescription),
          "raw",
        ),
      ],
      detectedValue:
        normalizedText(extraction.metaDescription) === ""
          ? "The observed meta description contains no non-whitespace text."
          : "The observed meta description contains non-whitespace text.",
    });
  },
);

const ons009 = duplicateMetadataRule(
  {
    id: "ONS-009",
    title: "Meta description is duplicated across pages",
    category: "on-page",
    defaultSeverity: "low",
    scope: "page",
    description:
      "Compares whitespace-normalized meta descriptions across indexable pages in a completed crawl.",
    eligibility:
      "A non-redirecting requested URL is indexable, has one non-empty raw description, and has conclusive corpus coverage.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "robots"],
    explanation:
      "Repeated descriptions make distinct pages less distinguishable and provide weak page-specific summaries.",
    expectedValue: "The description is unique among eligible indexable crawled pages.",
    recommendedFix:
      "Write a distinct description that accurately summarizes this page rather than reusing a site-wide template verbatim.",
    verification:
      "Re-crawl the site and confirm the normalized description occurs on only this indexable page.",
    confidence: "high",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "seo",
  },
  "meta-description",
  2,
);

const ons010 = defineMetadataRule(
  {
    id: "ONS-010",
    title: "Page contains multiple meta descriptions",
    category: "on-page",
    defaultSeverity: "medium",
    scope: "page",
    description: "Counts meta description declarations in complete raw document metadata.",
    eligibility: "A successful HTML response has complete raw document-metadata extraction.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation:
      "Multiple descriptions are ambiguous and different parsers may select different values.",
    expectedValue: "The raw HTML contains no more than one meta description declaration.",
    recommendedFix:
      "Remove duplicate meta description declarations and retain one accurate page-specific content value.",
    verification:
      "Inspect the raw HTML and confirm exactly zero or one meta description declaration remains.",
    confidence: "high",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "developer",
  },
  "multiple-meta-descriptions",
  (_snapshot, page, extraction) =>
    checkedOutcome({
      target: pageTarget(page),
      failed: extraction.metaDescriptionTagCount > 1,
      evidence: [
        pageEvidence(page, "meta_description_tag_count", extraction.metaDescriptionTagCount, "raw"),
      ],
      detectedValue: `${extraction.metaDescriptionTagCount} meta description declaration(s) were observed.`,
    }),
);

function defineDescriptionLengthRule(
  id: "ONS-011" | "ONS-012",
  mode: "minimum" | "maximum",
  metadata: Omit<M5RuleMetadata, "id">,
): AuditRuleDefinition {
  return defineMetadataRule(
    { ...metadata, id },
    `${id.toLowerCase()}-description-length`,
    (snapshot, page, extraction, policy) => {
      if (
        extraction.metaDescriptionTagCount !== 1 ||
        extraction.metaDescription === null ||
        normalizedText(extraction.metaDescription) === ""
      ) {
        return ineligiblePage(
          snapshot,
          page,
          "Description length requires exactly one non-empty description; missing, empty, or multiple-description cases are handled separately.",
          "meta_description_tag_count",
          extraction.metaDescriptionTagCount,
        );
      }
      const length = [...normalizedWhitespace(extraction.metaDescription)].length;
      const threshold =
        mode === "minimum"
          ? policy.metaDescriptionMinimumCharacters
          : policy.metaDescriptionMaximumCharacters;
      const failed = mode === "minimum" ? length < threshold : length > threshold;
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [pageEvidence(page, "meta_description_character_count", length, "raw")],
        detectedValue: `The normalized meta description contains ${length} Unicode character(s).`,
        expectedValue:
          mode === "minimum"
            ? `At least ${threshold} Unicode character(s).`
            : `At most ${threshold} Unicode character(s).`,
        confidence: "medium",
      });
    },
    2,
  );
}

const ons011 = defineDescriptionLengthRule("ONS-011", "minimum", {
  title: "Meta description is unusually short",
  category: "on-page",
  defaultSeverity: "low",
  scope: "page",
  description:
    "Measures one normalized description against the versioned minimum-character policy.",
  eligibility: "Complete raw metadata contains exactly one non-empty meta description.",
  requiredData: ["pages", "transport", "raw-extraction", "configuration"],
  explanation:
    "An unusually short description may not communicate enough context to help users understand the page.",
  expectedValue: "The description meets the configured minimum character threshold.",
  recommendedFix:
    "Expand the description with accurate page-specific context while keeping it concise and useful.",
  verification:
    "Measure the normalized description and confirm it meets the versioned minimum-character threshold.",
  confidence: "medium",
  impactAreas: ON_PAGE_IMPACTS,
  responsibleOwner: "seo",
});

const ons012 = defineDescriptionLengthRule("ONS-012", "maximum", {
  title: "Meta description is likely truncated because of excessive length",
  category: "on-page",
  defaultSeverity: "low",
  scope: "page",
  description:
    "Measures one normalized description against the versioned maximum-character policy.",
  eligibility: "Complete raw metadata contains exactly one non-empty meta description.",
  requiredData: ["pages", "transport", "raw-extraction", "configuration"],
  explanation:
    "An excessive description is more likely to be truncated and hide its most useful wording.",
  expectedValue: "The description stays within the configured maximum character threshold.",
  recommendedFix:
    "Shorten the description to a direct, accurate summary and remove repetitive or low-value qualifiers.",
  verification:
    "Measure the normalized description and confirm it is within the versioned maximum-character threshold.",
  confidence: "medium",
  impactAreas: ON_PAGE_IMPACTS,
  responsibleOwner: "seo",
});

const ons013 = defineHeadingRule(
  {
    id: "ONS-013",
    title: "H1 heading is missing",
    category: "on-page",
    defaultSeverity: "high",
    scope: "page",
    description: "Checks a complete raw heading collection for at least one H1 element.",
    eligibility: "A successful raw HTML extraction preserved the complete heading collection.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation: "A missing H1 removes a prominent structural label for the page's primary topic.",
    expectedValue: "The page contains at least one H1 heading.",
    recommendedFix: "Add a visible H1 that accurately names the page's primary topic or purpose.",
    verification: "Inspect the raw heading outline and confirm at least one H1 is present.",
    confidence: "high",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "content",
  },
  "h1-missing",
  (_snapshot, page, extraction) => {
    const count = extraction.headings.filter((heading) => heading.level === 1).length;
    return checkedOutcome({
      target: pageTarget(page),
      failed: count === 0,
      evidence: [pageEvidence(page, "h1_count", count, "raw")],
      detectedValue: `${count} H1 heading(s) were observed in raw HTML.`,
    });
  },
);

const ons014 = defineHeadingRule(
  {
    id: "ONS-014",
    title: "H1 heading is empty",
    category: "on-page",
    defaultSeverity: "high",
    scope: "page",
    description: "Checks preserved H1 elements for headings without non-whitespace text.",
    eligibility: "A complete raw heading collection contains at least one H1 element.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation: "An empty H1 creates structure without communicating a primary page topic.",
    expectedValue: "Every H1 heading contains visible non-whitespace text.",
    recommendedFix:
      "Remove decorative empty H1 elements or add accurate visible text to the page's primary H1.",
    verification: "Inspect every H1 in raw HTML and confirm each contains non-whitespace text.",
    confidence: "high",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "content",
  },
  "h1-empty",
  (snapshot, page, extraction) => {
    const headings = extraction.headings.filter((heading) => heading.level === 1);
    if (headings.length === 0) {
      return ineligiblePage(
        snapshot,
        page,
        "No H1 exists; ONS-013 reports the missing heading and emptiness is not evaluated.",
        "h1_count",
        0,
      );
    }
    const empty = headings.filter((heading) => normalizedText(heading.text) === "");
    return checkedOutcome({
      target: pageTarget(page),
      failed: empty.length > 0,
      evidence: [
        pageEvidence(
          page,
          "empty_h1_ordinal_sample",
          empty.length === 0
            ? "none"
            : sampleEvidenceStrings(
                empty.map((heading) => String(heading.ordinal)),
                { maximumItems: 24 },
              ),
          "raw",
        ),
      ],
      detectedValue: `${empty.length} of ${headings.length} H1 heading(s) were empty.`,
    });
  },
  2,
);

const ons015 = defineHeadingRule(
  {
    id: "ONS-015",
    title: "Multiple H1 headings require review",
    category: "on-page",
    defaultSeverity: "medium",
    scope: "page",
    description: "Counts H1 elements and routes multiple-heading cases to explicit human review.",
    eligibility: "A successful raw HTML extraction preserved the complete heading collection.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation:
      "Multiple H1 elements can be intentional or confusing; count alone cannot determine semantic quality.",
    expectedValue:
      "A reviewer confirms the H1 structure clearly communicates one primary page purpose.",
    recommendedFix:
      "Review the rendered heading structure; keep multiple H1 elements only when each is semantically justified, otherwise consolidate them.",
    verification:
      "A human reviews the rendered page and documented heading outline for a clear primary topic.",
    confidence: "medium",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "seo",
  },
  "multiple-h1",
  (_snapshot, page, extraction) => {
    const headings = extraction.headings.filter((heading) => heading.level === 1);
    if (headings.length <= 1) {
      return checkedOutcome({
        target: pageTarget(page),
        failed: false,
        evidence: [pageEvidence(page, "h1_count", headings.length, "raw")],
        detectedValue: `${headings.length} H1 heading(s) were observed.`,
      });
    }
    return eligibleOutcome({
      target: pageTarget(page),
      status: "manual-review",
      reason:
        "Automated extraction can count H1 elements but cannot determine whether multiple headings are semantically justified in the rendered page.",
      evidence: [
        pageEvidence(page, "h1_count", headings.length, "raw"),
        pageEvidence(
          page,
          "h1_text_sample",
          sampleEvidenceStrings(
            headings.map((heading) => heading.text),
            { maximumItems: 10 },
          ),
          "raw",
        ),
      ],
      detectedValue: `${headings.length} H1 headings require human review; no automated quality conclusion was made.`,
    });
  },
);

const ons016 = defineM5RuleVersion(
  {
    id: "ONS-016",
    title: "H1 is duplicated across important pages",
    category: "on-page",
    defaultSeverity: "medium",
    scope: "page",
    description: "Compares normalized non-empty H1 text across important indexable pages.",
    eligibility:
      "An important non-redirecting requested URL is indexable, has complete H1 extraction, and has conclusive corpus coverage.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "robots"],
    explanation:
      "Repeated primary headings make important pages harder to distinguish by topic and purpose.",
    expectedValue: "Important pages use distinct H1 text appropriate to their individual purpose.",
    recommendedFix:
      "Rewrite the primary heading to identify this page's distinct purpose while keeping its wording accurate and visible.",
    verification:
      "Re-crawl important pages and confirm their normalized H1 values no longer overlap.",
    confidence: "high",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "content",
  },
  2,
  (snapshot) => {
    const issue = duplicateCorpusIssue(snapshot, "h1", true);
    const pages = successfulHtmlPages(snapshot).filter((page) => {
      if (page.importance === "standard" && page.discoverySource !== "seed") return false;
      if (requestedPageIndexabilityState(page) !== "indexable") return false;
      return page.extraction?.source === "raw" && page.extraction.headingsComplete;
    });
    const comparable = pages.filter((page) => h1Values(page.extraction!).length > 0);
    if (comparable.length === 0) {
      return pageUnavailable(
        snapshot,
        "important-h1-duplicates",
        issue?.reason ?? "No important indexable page had a non-empty H1 value to compare.",
        issue?.missingData ?? ["raw-extraction", "robots"],
      );
    }
    const pagesByH1 = new Map<string, AuditPageObservation[]>();
    const pagesById = new Map(comparable.map((page) => [page.id, page] as const));
    for (const page of comparable) {
      for (const value of new Set(h1Values(page.extraction!))) {
        const matching = pagesByH1.get(value) ?? [];
        matching.push(page);
        pagesByH1.set(value, matching);
      }
    }
    return comparable.map((page) => {
      const values = new Set(h1Values(page.extraction!));
      const peerIds = new Set<string>();
      for (const value of values) {
        for (const peer of pagesByH1.get(value) ?? []) {
          if (peer.id !== page.id) peerIds.add(peer.id);
          if (peerIds.size === 12) break;
        }
        if (peerIds.size === 12) break;
      }
      const peers = [...peerIds]
        .sort((left, right) => left.localeCompare(right))
        .flatMap((id) => {
          const peer = pagesById.get(id);
          return peer === undefined ? [] : [peer];
        });
      if (peers.length === 0 && issue !== null) {
        return unavailablePage(snapshot, page, issue.reason, issue.missingData, [
          pageEvidence(page, "h1_corpus_coverage", "incomplete", "raw"),
        ]);
      }
      const observed = sampleEvidenceStrings([...values]).join(" | ");
      return checkedOutcome({
        target: pageTarget(page),
        failed: peers.length > 0,
        evidence: duplicateEvidence(page, "h1", observed, peers),
        detectedValue:
          peers.length > 0
            ? "At least one other important page shares a normalized H1; evidence contains a bounded peer sample."
            : "No other eligible important page shares a normalized H1.",
      });
    });
  },
);

const ons017 = defineHeadingRule(
  {
    id: "ONS-017",
    title: "Heading hierarchy skips logical levels",
    category: "on-page",
    defaultSeverity: "low",
    scope: "page",
    description:
      "Walks headings in document order and detects upward jumps of more than one level.",
    eligibility:
      "A successful raw HTML extraction preserved the complete ordered heading collection.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation:
      "Skipped heading levels can make document structure harder to understand and navigate.",
    expectedValue:
      "The heading outline does not jump from one level to a level more than one deeper.",
    recommendedFix:
      "Re-level headings so each nested section advances by one level while preserving the intended document structure.",
    verification:
      "Inspect headings in document order and confirm no level increases by more than one at a time.",
    confidence: "high",
    impactAreas: HTML_IMPACTS,
    responsibleOwner: "content",
  },
  "heading-hierarchy",
  (_snapshot, page, extraction) => {
    const ordered = [...extraction.headings].sort(
      (left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id),
    );
    const skips: string[] = [];
    let previousLevel = 0;
    for (const heading of ordered) {
      if (heading.level > previousLevel + 1) {
        skips.push(
          previousLevel === 0
            ? `start→h${heading.level}@${heading.ordinal}`
            : `h${previousLevel}→h${heading.level}@${heading.ordinal}`,
        );
      }
      previousLevel = heading.level;
    }
    return checkedOutcome({
      target: pageTarget(page),
      failed: skips.length > 0,
      evidence: [
        pageEvidence(
          page,
          "heading_level_skips",
          skips.length === 0 ? "none" : sampleEvidenceStrings(skips),
          "raw",
        ),
      ],
      detectedValue:
        skips.length === 0
          ? "No heading-level skip was observed."
          : `${skips.length} heading-level skip(s) were observed: ${sampleEvidenceStrings(skips, { maximumItems: 5 }).join(", ")}.`,
    });
  },
);

function viewportIssues(declarations: readonly string[]): readonly string[] {
  const issues: string[] = [];
  if (declarations.length === 0) return ["missing viewport declaration"];
  if (declarations.length > 1) issues.push(`${declarations.length} viewport declarations`);
  for (const [index, declaration] of declarations.entries()) {
    const directives = new Map<string, string>();
    for (const part of declaration
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value !== "")) {
      const separator = part.indexOf("=");
      const key = (separator === -1 ? part : part.slice(0, separator)).trim();
      const value = (separator === -1 ? "" : part.slice(separator + 1)).trim();
      if (key === "") {
        issues.push(`viewport ${index + 1} has an empty directive name`);
        continue;
      }
      if (directives.has(key)) {
        issues.push(`viewport ${index + 1} repeats ${key}`);
        continue;
      }
      directives.set(key, value);
    }
    if (directives.get("width") !== "device-width") {
      issues.push(`viewport ${index + 1} lacks width=device-width`);
    }
    for (const scale of ["initial-scale", "minimum-scale", "maximum-scale"] as const) {
      const value = directives.get(scale);
      if (
        value !== undefined &&
        (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value) ||
          !Number.isFinite(Number(value)) ||
          Number(value) <= 0)
      ) {
        issues.push(`viewport ${index + 1} has invalid ${scale}`);
      }
    }
  }
  return issues;
}

const ons018 = defineMetadataRule(
  {
    id: "ONS-018",
    title: "Mobile viewport declaration is missing or invalid",
    category: "on-page",
    defaultSeverity: "high",
    scope: "page",
    description: "Parses complete viewport metadata and checks for one device-width declaration.",
    eligibility: "A successful HTML response has complete raw document-metadata extraction.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation:
      "Missing or invalid viewport configuration can render mobile pages at an unsuitable layout width.",
    expectedValue:
      "One viewport declaration includes width=device-width and valid numeric scale values.",
    recommendedFix:
      'Add one `<meta name="viewport" content="width=device-width, initial-scale=1">` declaration and remove conflicts.',
    verification:
      "Inspect raw viewport metadata and test the page at representative mobile viewport widths.",
    confidence: "high",
    impactAreas: HTML_IMPACTS,
    responsibleOwner: "developer",
  },
  "mobile-viewport",
  (_snapshot, page, extraction) => {
    const issues = viewportIssues(extraction.viewportDeclarations);
    return checkedOutcome({
      target: pageTarget(page),
      failed: issues.length > 0,
      evidence: [
        pageEvidence(
          page,
          "viewport_validation",
          issues.length === 0
            ? sampleEvidenceStrings(extraction.viewportDeclarations)
            : sampleEvidenceStrings(issues),
          "raw",
        ),
      ],
      detectedValue:
        issues.length === 0
          ? "One valid mobile viewport declaration was observed."
          : `${issues.length} viewport issue(s) were observed: ${sampleEvidenceStrings(issues, { maximumItems: 8 }).join("; ")}`,
    });
  },
);

function validLanguageTag(value: string): boolean {
  const normalized = value.trim();
  if (normalized === "" || /\s|_/u.test(normalized)) return false;
  try {
    return Intl.getCanonicalLocales(normalized).length === 1;
  } catch {
    return false;
  }
}

const ons019 = defineMetadataRule(
  {
    id: "ONS-019",
    title: "HTML language declaration is missing or invalid",
    category: "on-page",
    defaultSeverity: "medium",
    scope: "page",
    description: "Validates the raw HTML lang value as one canonicalizable BCP 47 language tag.",
    eligibility: "A successful HTML response has complete raw document-metadata extraction.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation:
      "A valid document language helps browsers and assistive and search systems interpret page text.",
    expectedValue: "The root HTML element declares one valid BCP 47 language tag.",
    recommendedFix:
      "Set the root html element's lang attribute to the page's primary valid BCP 47 language tag, such as en or en-US.",
    verification:
      "Inspect the raw root html element and validate its lang value as a single BCP 47 tag.",
    confidence: "high",
    impactAreas: HTML_IMPACTS,
    responsibleOwner: "developer",
  },
  "html-language",
  (_snapshot, page, extraction) => {
    const value = extraction.htmlLanguage;
    const valid = value !== null && validLanguageTag(value);
    return checkedOutcome({
      target: pageTarget(page),
      failed: !valid,
      evidence: [pageEvidence(page, "html_language", value ?? "missing", "raw")],
      detectedValue:
        value === null
          ? "No HTML language declaration was observed."
          : valid
            ? `The language declaration ${value} is valid.`
            : `The language declaration ${value} is not a valid single BCP 47 tag.`,
    });
  },
);

const ons020 = defineMetadataRule(
  {
    id: "ONS-020",
    title: "Character encoding is missing or declared too late",
    category: "on-page",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Checks declaration provenance and enforces the first-1024-byte bound for meta charset.",
    eligibility:
      "Complete raw extraction preserves encoding source and a meta byte offset when applicable.",
    requiredData: ["pages", "transport", "headers", "raw-extraction"],
    explanation:
      "A missing or late declaration can cause text to be decoded incorrectly before the browser finds the intended encoding.",
    expectedValue:
      "Encoding is declared by BOM or HTTP header, or by meta markup within the first 1024 bytes.",
    recommendedFix:
      "Serve a correct charset in the Content-Type header or place a UTF-8 meta charset declaration entirely within the first 1024 bytes.",
    verification:
      "Inspect response headers and raw byte offsets to confirm the effective declaration is early and unambiguous.",
    confidence: "high",
    impactAreas: HTML_IMPACTS,
    responsibleOwner: "developer",
  },
  "character-encoding",
  (snapshot, page, extraction) => {
    const encoding = extraction.characterEncoding;
    if (encoding === null) {
      return unavailablePage(
        snapshot,
        page,
        "Encoding provenance was not preserved, so declaration presence and position cannot be evaluated.",
        ["headers", "raw-extraction"],
        [pageEvidence(page, "character_encoding", "unavailable", "raw")],
      );
    }
    if (encoding.source === "meta" && encoding.declarationOffsetBytes === null) {
      return unavailablePage(
        snapshot,
        page,
        "A meta encoding was observed but its byte offset was not preserved; declaration timing cannot be inferred.",
        ["raw-extraction"],
        [pageEvidence(page, "character_encoding_source", "meta; offset unavailable", "raw")],
      );
    }
    const missing = encoding.source === "default" || encoding.declared === null;
    const late =
      encoding.source === "meta" &&
      encoding.declarationOffsetBytes !== null &&
      encoding.declarationOffsetBytes > 1024;
    return checkedOutcome({
      target: pageTarget(page),
      failed: missing || late,
      evidence: [
        pageEvidence(
          page,
          "character_encoding",
          [
            `used=${encoding.used}`,
            `declared=${encoding.declared ?? "none"}`,
            `source=${encoding.source}`,
            `offset_bytes=${encoding.declarationOffsetBytes ?? "not-applicable"}`,
          ],
          "raw",
        ),
      ],
      detectedValue: missing
        ? "No explicit character-encoding declaration was observed."
        : late
          ? `The meta encoding declaration ends at byte ${encoding.declarationOffsetBytes}.`
          : `The ${encoding.source} encoding declaration was available early enough.`,
    });
  },
);

const ons021 = defineMetadataRule(
  {
    id: "ONS-021",
    title: "HTML document type is missing",
    category: "on-page",
    defaultSeverity: "low",
    scope: "page",
    description: "Checks complete raw document metadata for an HTML doctype declaration.",
    eligibility: "A successful HTML response has complete raw document-metadata extraction.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation:
      "A missing HTML doctype can trigger legacy rendering modes and inconsistent layout behavior.",
    expectedValue: "The raw document declares the HTML doctype before document markup.",
    recommendedFix:
      "Add `<!doctype html>` as the first document declaration before the root html element.",
    verification:
      "Inspect the raw response prefix and confirm the HTML doctype is present before document markup.",
    confidence: "high",
    impactAreas: HTML_IMPACTS,
    responsibleOwner: "developer",
  },
  "html-doctype",
  (_snapshot, page, extraction) =>
    checkedOutcome({
      target: pageTarget(page),
      failed: !extraction.htmlDoctypePresent,
      evidence: [pageEvidence(page, "html_doctype_present", extraction.htmlDoctypePresent, "raw")],
      detectedValue: extraction.htmlDoctypePresent
        ? "An HTML doctype declaration was observed."
        : "No HTML doctype declaration was observed.",
    }),
);

function metadataValues(
  record: Readonly<Record<string, readonly string[]>>,
  key: string,
): readonly string[] {
  return Object.entries(record)
    .filter(([candidate]) => candidate.toLowerCase() === key)
    .flatMap(([, values]) => values)
    .map((value) => value.trim());
}

function validPublicMetadataUrl(value: string): boolean {
  const parsed = safeUrl(value);
  return (
    parsed !== null &&
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    parsed.username === "" &&
    parsed.password === ""
  );
}

type OpenGraphField = "og:title" | "og:type" | "og:url" | "og:image";
type OpenGraphIssueCode =
  "missing_or_empty" | "conflicting_values" | "malformed_or_unsupported_url";

interface OpenGraphIssue {
  readonly field: OpenGraphField;
  readonly code: OpenGraphIssueCode;
  readonly values: readonly string[];
}

function openGraphIssues(extraction: AuditPageExtraction): readonly OpenGraphIssue[] {
  const issues: OpenGraphIssue[] = [];
  for (const key of ["og:title", "og:type", "og:url", "og:image"] as const) {
    const values = metadataValues(extraction.openGraph, key);
    if (values.length === 0 || values.every((value) => value === "")) {
      issues.push({ field: key, code: "missing_or_empty", values });
      continue;
    }
    if (key !== "og:image" && new Set(values).size > 1) {
      issues.push({ field: key, code: "conflicting_values", values });
    }
    if (key === "og:url" || key === "og:image") {
      const invalidValues = values.filter((value) => !validPublicMetadataUrl(value));
      if (invalidValues.length > 0) {
        issues.push({
          field: key,
          code: "malformed_or_unsupported_url",
          values: invalidValues,
        });
      }
    }
  }
  return issues;
}

function openGraphIssueDescription(issue: OpenGraphIssue): string {
  switch (issue.code) {
    case "missing_or_empty":
      return `${issue.field} is missing or empty`;
    case "conflicting_values":
      return `${issue.field} has conflicting values`;
    case "malformed_or_unsupported_url":
      return `${issue.field} contains a malformed or unsupported URL`;
  }
}

function openGraphIssueEvidence(
  page: AuditPageObservation,
  issue: OpenGraphIssue,
): AuditEvidenceItem {
  let observedValues: readonly string[];
  if (issue.code === "missing_or_empty") {
    observedValues = [
      `observed_values=${issue.values.length}`,
      `empty_values=${issue.values.filter((value) => value === "").length}`,
    ];
  } else if (issue.code === "malformed_or_unsupported_url") {
    observedValues = [
      `invalid_values=${issue.values.length}`,
      `sha256:${evidenceObservationDigest(issue.values)}`,
    ];
  } else {
    observedValues = sampleEvidenceStrings(
      issue.values.map((value) =>
        issue.field === "og:url"
          ? validPublicMetadataUrl(value)
            ? boundedEvidenceUrl(value, 512)
            : `invalid_url_sha256:${evidenceObservationDigest([value])}`
          : value,
      ),
      { maximumItems: 6, maximumItemBytes: 512, maximumTotalBytes: 4_096 },
    );
  }
  return pageEvidence(
    page,
    "open_graph_issue",
    [issue.field, issue.code, ...observedValues],
    "raw",
  );
}

const ons022 = defineMetadataRule(
  {
    id: "ONS-022",
    title: "Essential Open Graph metadata is missing or inconsistent",
    category: "on-page",
    defaultSeverity: "low",
    scope: "page",
    description:
      "Validates required Open Graph fields, duplicate consistency, and HTTP(S) URL syntax.",
    eligibility: "A successful HTML response has complete raw document-metadata extraction.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation:
      "Incomplete or conflicting Open Graph metadata can produce unreliable link previews.",
    expectedValue:
      "Open Graph title, type, URL, and image each contain one consistent valid value.",
    recommendedFix:
      "Add one consistent og:title, og:type, og:url, and absolute HTTP(S) og:image value that accurately represent this page.",
    verification:
      "Inspect raw Open Graph metadata and validate a generated preview with the target sharing platforms.",
    confidence: "high",
    impactAreas: HTML_IMPACTS,
    responsibleOwner: "seo",
  },
  "open-graph",
  (_snapshot, page, extraction) => {
    const issues = openGraphIssues(extraction);
    return checkedOutcome({
      target: pageTarget(page),
      failed: issues.length > 0,
      evidence: [
        pageEvidence(
          page,
          "document_metadata_complete",
          extraction.documentMetadataComplete,
          "raw",
        ),
        ...(issues.length === 0
          ? [pageEvidence(page, "open_graph_validation", "required fields valid", "raw")]
          : issues.map((issue) => openGraphIssueEvidence(page, issue))),
      ],
      detectedValue:
        issues.length === 0
          ? "All required Open Graph fields contain consistent valid values."
          : issues.map(openGraphIssueDescription).join("; "),
    });
  },
  2,
);

const ons023 = defineMetadataRule(
  {
    id: "ONS-023",
    title: "Social sharing image is missing or cannot be fetched",
    category: "on-page",
    defaultSeverity: "low",
    scope: "page",
    description:
      "Checks for a syntactically valid Open Graph or social-card image without inventing fetchability.",
    eligibility:
      "Complete raw social metadata is available; availability requires a separate image fetch observation.",
    requiredData: ["pages", "transport", "raw-extraction", "resources"],
    explanation:
      "A missing or unavailable image can leave shared links without a useful visual preview.",
    expectedValue:
      "A declared social sharing image resolves successfully through the safe fetch pipeline.",
    recommendedFix:
      "Declare an absolute HTTPS sharing image and verify that the public image response succeeds with a supported image content type.",
    verification:
      "Fetch the declared image through the protected crawler and test a generated preview on target platforms.",
    confidence: "high",
    impactAreas: HTML_IMPACTS,
    responsibleOwner: "seo",
  },
  "social-sharing-image",
  (snapshot, page, extraction) => {
    const values = [
      ...metadataValues(extraction.openGraph, "og:image"),
      ...metadataValues(extraction.socialCards, "twitter:image"),
      ...metadataValues(extraction.socialCards, "twitter:image:src"),
    ].filter((value) => value !== "");
    if (values.length === 0) {
      return checkedOutcome({
        target: pageTarget(page),
        failed: true,
        evidence: [pageEvidence(page, "social_image_declarations", 0, "raw")],
        detectedValue: "No Open Graph or Twitter social sharing image was declared.",
      });
    }
    const invalid = values.filter((value) => !validPublicMetadataUrl(value));
    if (invalid.length > 0) {
      return checkedOutcome({
        target: pageTarget(page),
        failed: true,
        evidence: [
          pageEvidence(
            page,
            "invalid_social_image_urls",
            [`invalid_values=${invalid.length}`, `sha256:${evidenceObservationDigest(invalid)}`],
            "raw",
          ),
        ],
        detectedValue: `${invalid.length} declared social image URL(s) were malformed or unsupported.`,
      });
    }
    return unavailablePage(
      snapshot,
      page,
      "A valid social image declaration exists, but this crawl did not persist a protected fetch result for that image. Availability cannot be inferred from markup alone.",
      ["resources"],
      [
        pageEvidence(
          page,
          "social_image_url_sample",
          sampleEvidenceStrings(values.map((value) => boundedEvidenceUrl(value, 512))),
          "raw",
        ),
      ],
    );
  },
  2,
);

const ons024 = defineMetadataRule(
  {
    id: "ONS-024",
    title: "Favicon or application icon is missing",
    category: "on-page",
    defaultSeverity: "low",
    scope: "page",
    description:
      "Reports explicit icon-declaration coverage without assuming the implicit favicon path exists.",
    eligibility: "Complete raw document metadata includes the count of explicit icon declarations.",
    requiredData: ["pages", "transport", "raw-extraction", "resources"],
    explanation:
      "Missing icons reduce visual recognition in browser tabs, bookmarks, and installed application surfaces.",
    expectedValue:
      "At least one declared or conventional icon is proven fetchable with an appropriate image response.",
    recommendedFix:
      "Declare a valid favicon or application icon and ensure its public image response succeeds; also support /favicon.ico when appropriate.",
    verification:
      "Fetch declared icon URLs and the conventional favicon path through the protected crawler and inspect browser rendering.",
    confidence: "medium",
    impactAreas: HTML_IMPACTS,
    responsibleOwner: "developer",
  },
  "favicon",
  (snapshot, page, extraction) =>
    unavailablePage(
      snapshot,
      page,
      extraction.iconDeclarationCount === 0
        ? "No explicit icon declaration was observed, but the crawl did not request the conventional /favicon.ico path. Icon absence cannot be concluded automatically."
        : "An explicit icon declaration was observed, but no protected fetch result was persisted. Icon availability cannot be concluded from markup alone.",
      ["resources"],
      [
        pageEvidence(
          page,
          "explicit_icon_declaration_count",
          extraction.iconDeclarationCount,
          "raw",
        ),
      ],
    ),
);

const ons025 = defineM5RuleVersion(
  {
    id: "ONS-025",
    title: "Source or rendered page contains no meaningful visible text",
    category: "on-page",
    defaultSeverity: "high",
    scope: "page",
    description:
      "Uses the persisted extraction's meaningful-content decision, visible-text coverage, and word count.",
    eligibility:
      "A successful HTML response has a successful extraction with visible-text signals; an empty client-rendered raw source also requires rendered evidence.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "Pages without meaningful visible text are difficult for users and search or AI systems to understand.",
    expectedValue:
      "The available source or rendered extraction contains meaningful non-empty visible text.",
    recommendedFix:
      "Provide substantive visible HTML text that explains the page's purpose, and render critical content without requiring unsupported client behavior.",
    verification:
      "Inspect source and, when enabled, rendered extraction to confirm meaningful visible text and a non-zero word count.",
    confidence: "high",
    impactAreas: ON_PAGE_IMPACTS,
    responsibleOwner: "content",
  },
  2,
  (snapshot) => {
    const pages = successfulHtmlPages(snapshot);
    if (pages.length === 0) {
      return pageUnavailable(
        snapshot,
        "meaningful-visible-text",
        "No successfully fetched HTML page was available for visible-text evaluation.",
        ["pages", "transport", "raw-extraction"],
      );
    }
    return pages.map((page) => {
      const rawExtraction = page.extraction;
      let extraction = rawExtraction ?? page.renderedExtraction;
      if (extraction === null) {
        return unavailablePage(
          snapshot,
          page,
          "No successful source or rendered extraction was available, so visible text was not checked.",
          ["raw-extraction", "rendered-extraction"],
          [pageEvidence(page, "visible_text_extraction", "unavailable")],
        );
      }
      if (extraction.visibleText === null && page.renderedExtraction !== null) {
        extraction = page.renderedExtraction;
      }
      if (extraction.visibleText === null) {
        return unavailablePage(
          snapshot,
          page,
          "The extraction did not preserve visible text, so absence of meaningful content cannot be concluded.",
          [extraction.source === "raw" ? "raw-extraction" : "rendered-extraction"],
          [pageEvidence(page, "visible_text", "unavailable", extraction.source)],
        );
      }
      const failed =
        !extraction.meaningfulContent ||
        extraction.wordCount === 0 ||
        normalizedText(extraction.visibleText) === "";
      if (failed && extraction.source === "raw") {
        const rendered = page.renderedExtraction;
        if (rendered !== null && rendered.visibleText !== null) {
          extraction = rendered;
        } else if (extraction.clientRendered) {
          return unavailablePage(
            snapshot,
            page,
            "The raw extraction has no meaningful visible text, but no complete rendered extraction is available; an empty source shell cannot prove that the rendered page lacks meaningful content.",
            ["rendered-extraction"],
            [
              pageEvidence(
                page,
                "visible_text_signals",
                [
                  "source=raw",
                  `client_rendered=${rawExtraction?.clientRendered ?? false}`,
                  `meaningful=${extraction.meaningfulContent}`,
                  `word_count=${extraction.wordCount}`,
                ],
                "raw",
              ),
            ],
          );
        }
      }
      if (extraction.visibleText === null) {
        return unavailablePage(
          snapshot,
          page,
          "The selected extraction did not preserve visible text, so meaningful-content absence cannot be evaluated.",
          [extraction.source === "raw" ? "raw-extraction" : "rendered-extraction"],
          [pageEvidence(page, "visible_text", "unavailable", extraction.source)],
        );
      }
      const selectedVisibleText = extraction.visibleText;
      const selectedFailed =
        !extraction.meaningfulContent ||
        extraction.wordCount === 0 ||
        normalizedText(selectedVisibleText) === "";
      if (selectedFailed && !extraction.visibleTextComplete) {
        return unavailablePage(
          snapshot,
          page,
          "The selected extraction has no meaningful visible-text signal, but persisted visible-text coverage is incomplete. Absence cannot be concluded from truncated evidence.",
          [extraction.source === "raw" ? "raw-extraction" : "rendered-extraction"],
          [pageEvidence(page, "visible_text_complete", false, extraction.source)],
        );
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: selectedFailed,
        evidence: [
          pageEvidence(
            page,
            "visible_text_signals",
            [
              `source=${extraction.source}`,
              `meaningful=${extraction.meaningfulContent}`,
              `word_count=${extraction.wordCount}`,
              `visible_text_characters=${[...selectedVisibleText].length}`,
              `visible_text_complete=${extraction.visibleTextComplete}`,
              `content_hash=${extraction.contentHash ?? "unavailable"}`,
            ],
            extraction.source,
          ),
        ],
        detectedValue: selectedFailed
          ? `The ${extraction.source} extraction contains no meaningful visible text (${extraction.wordCount} words).`
          : `The ${extraction.source} extraction contains meaningful visible text (${extraction.wordCount} words).`,
      });
    });
  },
);

export const ONS_RULES: readonly AuditRuleDefinition[] = Object.freeze([
  ons001,
  ons002,
  ons003,
  ons004,
  ons005,
  ons006,
  ons007,
  ons008,
  ons009,
  ons010,
  ons011,
  ons012,
  ons013,
  ons014,
  ons015,
  ons016,
  ons017,
  ons018,
  ons019,
  ons020,
  ons021,
  ons022,
  ons023,
  ons024,
  ons025,
]);
