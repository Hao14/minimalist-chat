import type { AuditEvidenceItem } from "@searvia/shared-types";

import type { AuditObservationKey, AuditRuleDefinition, AuditRuleOutcome } from "../contracts.js";
import type {
  AuditCrawlSnapshot,
  AuditPageExtraction,
  AuditPageLink,
  AuditPageObservation,
} from "../snapshot.js";
import {
  boundedEvidenceText,
  boundedEvidenceUrl,
  boundedPageEvidence,
  checkedOutcome,
  crawlEvidence,
  defineM5Rule,
  defineM5RuleVersion,
  eligibleOutcome,
  evidence,
  evidenceObservationDigest,
  isHtmlContentType,
  isSuccessful,
  notCheckedOutcome,
  pageEvidence,
  pageTarget,
  pageUnavailable,
  siteTarget,
  siteUnavailable,
} from "./helpers.js";

const CONTENT_IMPACTS = ["search-visibility", "ai-retrievability", "user-experience"] as const;
const CONTENT_SEARCH_IMPACTS = ["search-visibility", "ai-retrievability"] as const;
const SHINGLE_WIDTH = 8;
const LARGE_SHARED_SHINGLE_COUNT = 30;
const BOILERPLATE_MINIMUM_PAGES = 3;
const BOILERPLATE_RATIO = 0.75;
const KEYWORD_MINIMUM_WORDS = 50;
const KEYWORD_MINIMUM_OCCURRENCES = 10;
const KEYWORD_MAXIMUM_RATIO = 0.12;
const MAX_TEXT_ANALYSIS_CHARACTERS = 100_000;
const MAX_TEXT_ANALYSIS_TOKENS = 20_000;
const MAX_ANALYZED_CORPUS_PAGES = 250;
const MAX_CORPUS_SHINGLES = 250_000;
const MAX_PAIR_UPDATES = 1_000_000;
const MAX_TOKEN_CHARACTERS = 64;
const MAX_PATTERN_MATCHES = 10_000;
const NON_WHITESPACE_SEGMENTED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "because",
  "been",
  "before",
  "being",
  "between",
  "but",
  "can",
  "could",
  "does",
  "each",
  "for",
  "from",
  "had",
  "has",
  "have",
  "into",
  "its",
  "may",
  "more",
  "most",
  "not",
  "our",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

interface ContentPage {
  readonly page: AuditPageObservation;
  readonly extraction: AuditPageExtraction;
  readonly text: string;
}

interface TextAnalysis {
  readonly tokens: readonly string[];
  readonly complete: boolean;
  readonly analyzedCharacters: number;
  readonly tokenBudgetExceeded: boolean;
  readonly oversizedTokenObserved: boolean;
  readonly segmentationSupported: boolean;
}

interface BoundedTextWindow {
  readonly text: string;
  readonly complete: boolean;
  readonly analyzedCharacters: number;
}

interface CorpusIssue {
  readonly reason: string;
  readonly missingData: readonly AuditObservationKey[];
}

function contentExtractionMissingData(
  pages: readonly ContentPage[],
): readonly AuditObservationKey[] {
  const missing = new Set<AuditObservationKey>();
  for (const { extraction } of pages) {
    missing.add(extraction.source === "rendered" ? "rendered-extraction" : "raw-extraction");
  }
  return Object.freeze([...missing].sort());
}

function boundedTextWindow(candidate: ContentPage): BoundedTextWindow {
  const text = candidate.text.slice(0, MAX_TEXT_ANALYSIS_CHARACTERS);
  return Object.freeze({
    text,
    complete:
      candidate.extraction.visibleTextComplete &&
      candidate.text.length <= MAX_TEXT_ANALYSIS_CHARACTERS,
    analyzedCharacters: text.length,
  });
}

function analyzeText(candidate: ContentPage): TextAnalysis {
  const window = boundedTextWindow(candidate);
  const segmentationSupported = !NON_WHITESPACE_SEGMENTED_SCRIPT.test(window.text);
  const tokens: string[] = [];
  let tokenBudgetExceeded = false;
  let oversizedTokenObserved = false;
  for (const match of window.text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    if (tokens.length >= MAX_TEXT_ANALYSIS_TOKENS) {
      tokenBudgetExceeded = true;
      break;
    }
    const token = match[0];
    if (token.length <= MAX_TOKEN_CHARACTERS) {
      tokens.push(token.toLocaleLowerCase("und"));
    } else {
      oversizedTokenObserved = true;
    }
  }
  return Object.freeze({
    tokens: Object.freeze(tokens),
    complete:
      window.complete && segmentationSupported && !tokenBudgetExceeded && !oversizedTokenObserved,
    analyzedCharacters: window.analyzedCharacters,
    tokenBudgetExceeded,
    oversizedTokenObserved,
    segmentationSupported,
  });
}

function primaryHtmlLanguage(extraction: AuditPageExtraction): string | null {
  const value = extraction.htmlLanguage?.trim().replaceAll("_", "-").toLowerCase();
  if (value === undefined || value === "") return null;
  return value.split("-", 1)[0] ?? null;
}

function selectedContentExtraction(page: AuditPageObservation): AuditPageExtraction | null {
  const raw = page.extraction;
  if (raw === null || raw.source !== "raw") return null;
  if (!raw.clientRendered) return raw.visibleText === null ? null : raw;
  const rendered = page.renderedExtraction;
  return rendered?.source === "rendered" && rendered.visibleText !== null ? rendered : null;
}

function contentPage(page: AuditPageObservation): ContentPage | null {
  if (!isSuccessful(page) || !isHtmlContentType(page.contentType)) return null;
  const extraction = selectedContentExtraction(page);
  if (extraction === null || extraction.visibleText === null) return null;
  return Object.freeze({
    page,
    extraction,
    text: extraction.visibleText,
  });
}

function contentPages(snapshot: AuditCrawlSnapshot): readonly ContentPage[] {
  return Object.freeze(
    snapshot.pages.flatMap((page) => {
      const candidate = contentPage(page);
      return candidate === null ? [] : [candidate];
    }),
  );
}

function pageCoverageOutcome(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
): AuditRuleOutcome | null {
  if (page.statusCode === null) {
    return notCheckedOutcome({
      target: pageTarget(page),
      snapshot,
      reason: "The page transport result is unavailable, so content could not be evaluated.",
      missingData: ["transport"],
      evidence: [pageEvidence(page, "status_code", null)],
    });
  }
  if (!isSuccessful(page)) return null;
  if (page.contentType === null) {
    return notCheckedOutcome({
      target: pageTarget(page),
      snapshot,
      reason: "The successful response has no usable content type.",
      missingData: ["transport"],
      evidence: [pageEvidence(page, "content_type", null)],
    });
  }
  if (!isHtmlContentType(page.contentType)) return null;
  if (
    page.extraction === null ||
    page.extraction.source !== "raw" ||
    (!page.extraction.clientRendered && page.extraction.visibleText === null)
  ) {
    return notCheckedOutcome({
      target: pageTarget(page),
      snapshot,
      reason: "Successful raw HTML text extraction is unavailable for this page.",
      missingData: ["raw-extraction"],
      evidence: [
        pageEvidence(
          page,
          "raw_extraction",
          page.extraction?.source ?? "missing",
          page.extraction?.source,
        ),
      ],
    });
  }
  if (page.extraction.clientRendered && selectedContentExtraction(page) === null) {
    return notCheckedOutcome({
      target: pageTarget(page),
      snapshot,
      reason:
        "The raw extraction identifies a client-rendered page, but final rendered content is unavailable.",
      missingData: ["rendered-extraction"],
      evidence: [pageEvidence(page, "client_rendered", true, "raw")],
    });
  }
  return null;
}

function evaluateContentPages(
  snapshot: AuditCrawlSnapshot,
  key: string,
  evaluate: (candidate: ContentPage) => AuditRuleOutcome,
): readonly AuditRuleOutcome[] {
  const outcomes: AuditRuleOutcome[] = [];
  for (const page of snapshot.pages) {
    const coverage = pageCoverageOutcome(snapshot, page);
    if (coverage !== null) {
      outcomes.push(coverage);
      continue;
    }
    const candidate = contentPage(page);
    if (candidate !== null) outcomes.push(evaluate(candidate));
  }
  return outcomes.length === 0
    ? pageUnavailable(
        snapshot,
        key,
        "No successfully extracted raw or required rendered HTML page is available for this content check.",
        ["pages", "transport", "raw-extraction"],
      )
    : Object.freeze(outcomes);
}

function corpusIssue(
  snapshot: AuditCrawlSnapshot,
  requireLinks = false,
  requireCompleteText = false,
): CorpusIssue | null {
  if (snapshot.status !== "completed") {
    return Object.freeze({
      reason: "The crawl is partial, so site-wide absence or repetition cannot be concluded.",
      missingData: Object.freeze(["crawl"] as const),
    });
  }
  for (const page of snapshot.pages) {
    if (page.statusCode === null || (isSuccessful(page) && page.contentType === null)) {
      return Object.freeze({
        reason: "At least one page has incomplete transport coverage.",
        missingData: Object.freeze(["transport"] as const),
      });
    }
    if (!isSuccessful(page) || !isHtmlContentType(page.contentType)) continue;
    const extraction = selectedContentExtraction(page);
    if (extraction === null) {
      const renderedRequired = page.extraction?.source === "raw" && page.extraction.clientRendered;
      return Object.freeze({
        reason: renderedRequired
          ? "At least one client-rendered page lacks usable rendered visible text."
          : "At least one successful HTML page lacks usable raw visible text.",
        missingData: Object.freeze([
          renderedRequired ? "rendered-extraction" : "raw-extraction",
        ] as const),
      });
    }
    if (requireCompleteText && !extraction.visibleTextComplete) {
      return Object.freeze({
        reason: "At least one successful HTML page has incomplete persisted visible text.",
        missingData: Object.freeze([
          extraction.source === "rendered" ? "rendered-extraction" : "raw-extraction",
        ] as const),
      });
    }
    if (requireLinks && extraction.source === "rendered") {
      return Object.freeze({
        reason:
          "At least one client-rendered page uses rendered text, but rendered link observations are not persisted.",
        missingData: Object.freeze(["links"] as const),
      });
    }
    if (requireLinks && page.extraction?.linksComplete !== true) {
      return Object.freeze({
        reason: "At least one successful HTML page has an incomplete persisted link set.",
        missingData: Object.freeze(["links"] as const),
      });
    }
  }
  return null;
}

function corpusSegmentationIssue(pages: readonly ContentPage[]): CorpusIssue | null {
  const unsupported = pages.find((candidate) =>
    NON_WHITESPACE_SEGMENTED_SCRIPT.test(boundedTextWindow(candidate).text),
  );
  if (unsupported === undefined) return null;
  return Object.freeze({
    reason:
      "At least one page uses a script that requires language-aware word segmentation, which this deterministic Phase 1 analyzer does not provide.",
    missingData: Object.freeze([
      unsupported.extraction.source === "rendered" ? "rendered-extraction" : "raw-extraction",
    ] as const),
  });
}

function textAnalysisNotChecked(
  snapshot: AuditCrawlSnapshot,
  candidate: ContentPage,
  analysis: TextAnalysis,
  reason: string,
): AuditRuleOutcome {
  return notCheckedOutcome({
    target: pageTarget(candidate.page),
    snapshot,
    reason,
    missingData: [
      candidate.extraction.source === "rendered" ? "rendered-extraction" : "raw-extraction",
    ],
    evidence: [
      pageEvidence(
        candidate.page,
        "visible_text_complete",
        candidate.extraction.visibleTextComplete,
        candidate.extraction.source,
      ),
      pageEvidence(
        candidate.page,
        "analyzed_text_characters",
        analysis.analyzedCharacters,
        candidate.extraction.source,
      ),
      pageEvidence(
        candidate.page,
        "analysis_token_budget_exceeded",
        analysis.tokenBudgetExceeded,
        candidate.extraction.source,
      ),
      pageEvidence(
        candidate.page,
        "analysis_oversized_token_observed",
        analysis.oversizedTokenObserved,
        candidate.extraction.source,
      ),
      pageEvidence(
        candidate.page,
        "language_aware_segmentation_supported",
        analysis.segmentationSupported,
        candidate.extraction.source,
      ),
    ],
  });
}

function boundedTextNotChecked(
  snapshot: AuditCrawlSnapshot,
  candidate: ContentPage,
  window: BoundedTextWindow,
  reason: string,
): AuditRuleOutcome {
  return notCheckedOutcome({
    target: pageTarget(candidate.page),
    snapshot,
    reason,
    missingData: [
      candidate.extraction.source === "rendered" ? "rendered-extraction" : "raw-extraction",
    ],
    evidence: [
      pageEvidence(
        candidate.page,
        "visible_text_complete",
        candidate.extraction.visibleTextComplete,
        candidate.extraction.source,
      ),
      pageEvidence(
        candidate.page,
        "analyzed_text_characters",
        window.analyzedCharacters,
        candidate.extraction.source,
      ),
    ],
  });
}

function corpusNotChecked(
  snapshot: AuditCrawlSnapshot,
  pages: readonly ContentPage[],
  issue: CorpusIssue,
): readonly AuditRuleOutcome[] {
  if (pages.length === 0) {
    return pageUnavailable(snapshot, "content-corpus", issue.reason, issue.missingData);
  }
  return Object.freeze(
    pages.map(({ page, extraction }) =>
      notCheckedOutcome({
        target: pageTarget(page),
        snapshot,
        reason: issue.reason,
        missingData: issue.missingData,
        evidence: [
          crawlEvidence(snapshot, "crawl_status", snapshot.status),
          pageEvidence(page, "content_observation", extraction.id, extraction.source),
        ],
      }),
    ),
  );
}

interface ShingleAnalysis {
  readonly shingles: ReadonlySet<string>;
  readonly complete: boolean;
}

function boundedShingleSet(
  tokens: readonly string[],
  maximumShingles: number,
  width = SHINGLE_WIDTH,
): ShingleAnalysis {
  const shingles = new Set<string>();
  if (maximumShingles <= 0) {
    return Object.freeze({ shingles, complete: tokens.length < width });
  }
  for (let index = 0; index + width <= tokens.length; index += 1) {
    shingles.add(tokens.slice(index, index + width).join(" "));
    if (shingles.size >= maximumShingles) {
      return Object.freeze({
        shingles,
        complete: index + width >= tokens.length,
      });
    }
  }
  return Object.freeze({ shingles, complete: true });
}

interface AnalyzedCorpusPage {
  readonly candidate: ContentPage;
  readonly shingles: ReadonlySet<string>;
}

interface AnalyzedCorpus {
  readonly pages: readonly AnalyzedCorpusPage[];
  readonly complete: boolean;
}

function analyzeCorpus(pages: readonly ContentPage[]): AnalyzedCorpus {
  const selected = [...pages]
    .sort((left, right) => left.page.id.localeCompare(right.page.id))
    .slice(0, MAX_ANALYZED_CORPUS_PAGES);
  let remainingShingles = MAX_CORPUS_SHINGLES;
  let complete = pages.length <= MAX_ANALYZED_CORPUS_PAGES;
  const analyzed: AnalyzedCorpusPage[] = [];
  for (const candidate of selected) {
    if (remainingShingles === 0) {
      complete = false;
      break;
    }
    const analysis = analyzeText(candidate);
    const shingleAnalysis = boundedShingleSet(analysis.tokens, remainingShingles);
    remainingShingles -= shingleAnalysis.shingles.size;
    if (!analysis.complete || !shingleAnalysis.complete) complete = false;
    analyzed.push(Object.freeze({ candidate, shingles: shingleAnalysis.shingles }));
  }
  return Object.freeze({
    pages: Object.freeze(analyzed),
    complete,
  });
}

function shinglePostings(
  pages: readonly AnalyzedCorpusPage[],
): ReadonlyMap<string, readonly number[]> {
  const postings = new Map<string, number[]>();
  pages.forEach(({ shingles }, pageIndex) => {
    for (const shingle of shingles) {
      const indexes = postings.get(shingle) ?? [];
      indexes.push(pageIndex);
      postings.set(shingle, indexes);
    }
  });
  return postings;
}

interface DuplicatePairIndex {
  readonly counts: ReadonlyMap<string, number>;
  readonly samples: ReadonlyMap<string, string>;
  readonly complete: boolean;
}

function duplicatePairIndex(postings: ReadonlyMap<string, readonly number[]>): DuplicatePairIndex {
  const counts = new Map<string, number>();
  const samples = new Map<string, string>();
  let updates = 0;
  let complete = true;
  outer: for (const [shingle, indexes] of postings) {
    for (let left = 0; left < indexes.length; left += 1) {
      for (let right = left + 1; right < indexes.length; right += 1) {
        if (updates >= MAX_PAIR_UPDATES) {
          complete = false;
          break outer;
        }
        const leftIndex = indexes[left];
        const rightIndex = indexes[right];
        if (leftIndex === undefined || rightIndex === undefined) continue;
        const key = `${leftIndex}:${rightIndex}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (!samples.has(key)) samples.set(key, shingle);
        updates += 1;
      }
    }
  }
  return Object.freeze({ counts, samples, complete });
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function manualPageOutcomes(
  snapshot: AuditCrawlSnapshot,
  key: string,
  limitation: string,
  requireCompleteLinks = false,
): readonly AuditRuleOutcome[] {
  return evaluateContentPages(snapshot, key, ({ page, extraction, text }) => {
    if (requireCompleteLinks && extraction.source === "rendered") {
      return notCheckedOutcome({
        target: pageTarget(page),
        snapshot,
        reason:
          "Rendered text is required for this client-rendered page, but rendered link observations are not persisted and raw-shell links cannot support the review.",
        missingData: ["links"],
        evidence: [
          pageEvidence(page, "selected_content_source", extraction.source, extraction.source),
          pageEvidence(page, "rendered_links_persisted", false, extraction.source),
        ],
      });
    }
    if (requireCompleteLinks && page.extraction?.linksComplete !== true) {
      return notCheckedOutcome({
        target: pageTarget(page),
        snapshot,
        reason:
          "The persisted source-page link set is incomplete, so the links needed for this review cannot be enumerated.",
        missingData: ["links"],
        evidence: [
          pageEvidence(page, "links_complete", page.extraction?.linksComplete ?? false, "raw"),
          pageEvidence(page, "retained_link_count", page.links.length, "raw"),
        ],
      });
    }
    return eligibleOutcome({
      target: pageTarget(page),
      status: "manual-review",
      reason:
        "The available observations support review but cannot produce an automated conclusion.",
      evidence: [
        pageEvidence(page, "word_count", extraction.wordCount, extraction.source),
        pageEvidence(page, "visible_text_characters", text.length, extraction.source),
      ],
      detectedValue: `Manual review required: ${limitation}`,
      confidence: "low",
    });
  });
}

function manualSiteOutcome(
  snapshot: AuditCrawlSnapshot,
  key: string,
  limitation: string,
  requireLinks = false,
): readonly AuditRuleOutcome[] {
  const pages = contentPages(snapshot);
  const issue = corpusIssue(snapshot, requireLinks);
  if (pages.length === 0) {
    return siteUnavailable(
      snapshot,
      key,
      "No successfully extracted raw or required rendered HTML page is available for site-level review.",
      ["pages", "transport", "raw-extraction", "rendered-extraction"],
    );
  }
  if (issue !== null) return siteUnavailable(snapshot, key, issue.reason, issue.missingData);
  return [
    eligibleOutcome({
      target: siteTarget(snapshot, key),
      status: "manual-review",
      reason: "The crawl evidence supports review but not a human-quality conclusion.",
      evidence: [
        crawlEvidence(snapshot, "reviewed_html_page_count", pages.length),
        ...pages
          .slice(0, 5)
          .map(({ page, extraction }) =>
            boundedPageEvidence(page, "review_page", extraction.wordCount, extraction.source),
          ),
      ],
      detectedValue: `Manual review required: ${limitation}`,
      confidence: "low",
    }),
  ];
}

function externalLinkEvidence(
  source: AuditPageObservation,
  link: AuditPageLink,
  field: string,
  value: string | number | null,
): AuditEvidenceItem {
  return evidence({
    kind: "link",
    source: "graph",
    observationId: link.id,
    observedAt: source.extraction?.extractedAt ?? source.observedAt,
    field,
    value,
    url: boundedEvidenceUrl(source.normalizedUrl),
  });
}

const cnt001 = defineM5RuleVersion(
  {
    id: "CNT-001",
    title: "Page contains very little unique content",
    category: "content-quality",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Checks extracted visible-text volume and lexical diversity against versioned thresholds.",
    eligibility:
      "A successful HTML page has usable raw text, or usable rendered text when the raw extraction identifies client rendering; lexical-diversity and pass conclusions also require complete bounded visible-text analysis in a supported whitespace-segmented script.",
    requiredData: ["configuration", "pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "A page with very little readable, non-repeated vocabulary may not give visitors or search systems enough information to understand its purpose.",
    expectedValue:
      "The page has at least the configured visible-word threshold and at least 40 distinct lexical terms.",
    recommendedFix:
      "Add original, page-specific copy that explains the page purpose, answers the visitor's main questions, and removes repeated filler; then rerun extraction.",
    verification:
      "Rerun the crawl and confirm both the persisted visible-word count and distinct-term count meet the rule thresholds.",
    confidence: "high",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  3,
  (snapshot, policy) =>
    evaluateContentPages(snapshot, "thin-content", (candidate) => {
      const { page, extraction, text } = candidate;
      const analysis = analyzeText(candidate);
      if (!analysis.segmentationSupported) {
        return textAnalysisNotChecked(
          snapshot,
          candidate,
          analysis,
          "The page uses a script that requires language-aware word segmentation, which this deterministic Phase 1 analyzer does not provide.",
        );
      }
      const uniqueTerms = new Set(analysis.tokens.filter((token) => token.length >= 3)).size;
      const wordCount = extraction.wordCount;
      if (!analysis.complete && wordCount >= policy.thinContentMinimumWords) {
        return textAnalysisNotChecked(
          snapshot,
          candidate,
          analysis,
          "Visible-text or analysis coverage is incomplete, so lexical diversity and a passing content-volume conclusion are unavailable.",
        );
      }
      const failed = wordCount < policy.thinContentMinimumWords || uniqueTerms < 40;
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [
          pageEvidence(page, "word_count", wordCount, extraction.source),
          pageEvidence(page, "distinct_lexical_terms", uniqueTerms, extraction.source),
          pageEvidence(page, "visible_text_characters", text.length, extraction.source),
          pageEvidence(
            page,
            "visible_text_complete",
            extraction.visibleTextComplete,
            extraction.source,
          ),
        ],
        detectedValue: `${wordCount} visible words and ${uniqueTerms} distinct lexical terms were extracted.`,
        expectedValue: `At least ${policy.thinContentMinimumWords} visible words and 40 distinct lexical terms.`,
      });
    }),
);

const cnt002 = defineM5RuleVersion(
  {
    id: "CNT-002",
    title: "Boilerplate content dominates unique page content",
    category: "content-quality",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Measures the share of a page's word shingles repeated across most crawled HTML pages.",
    eligibility:
      "A completed crawl has at least three successful, complete raw or required rendered HTML text extractions in supported whitespace-segmented scripts within the bounded corpus-analysis budget, and the target page yields at least one eight-word shingle.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "When nearly all extracted text repeats across the site, the page contributes little distinct information beyond shared navigation and template copy.",
    expectedValue:
      "Fewer than 75% of the page's eight-word shingles appear on at least two-thirds of crawled pages.",
    recommendedFix:
      "Keep navigation and legal template copy concise, then add substantial page-specific text that describes this page's topic, offer, evidence, or answer.",
    verification:
      "Complete a new crawl and compare the page's common-shingle count and boilerplate ratio with the documented threshold.",
    confidence: "medium",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  3,
  (snapshot) => {
    const pages = contentPages(snapshot);
    const issue = corpusIssue(snapshot, false, true) ?? corpusSegmentationIssue(pages);
    if (issue !== null) return corpusNotChecked(snapshot, pages, issue);
    if (pages.length < BOILERPLATE_MINIMUM_PAGES) {
      return pageUnavailable(
        snapshot,
        "boilerplate-corpus",
        "At least three extracted HTML pages are required to distinguish shared boilerplate from page-specific text.",
        ["pages", "raw-extraction"],
      );
    }
    const corpus = analyzeCorpus(pages);
    if (!corpus.complete) {
      return corpusNotChecked(
        snapshot,
        pages,
        Object.freeze({
          reason:
            "The bounded text, token, page, or shingle analysis budget was reached, so boilerplate dominance cannot be concluded.",
          missingData: contentExtractionMissingData(pages),
        }),
      );
    }
    const supportThreshold = Math.max(2, Math.ceil(pages.length * (2 / 3)));
    const postings = shinglePostings(corpus.pages);
    const commonCounts = Array.from({ length: corpus.pages.length }, () => 0);
    const peerIndexes = Array.from({ length: corpus.pages.length }, () => new Set<number>());
    for (const indexes of postings.values()) {
      if (indexes.length < supportThreshold) continue;
      for (const pageIndex of indexes) {
        if (pageIndex === undefined) continue;
        commonCounts[pageIndex] = (commonCounts[pageIndex] ?? 0) + 1;
        const peers = peerIndexes[pageIndex];
        if (peers !== undefined && peers.size < 3) {
          for (const peerIndex of indexes) {
            if (peerIndex !== pageIndex) peers.add(peerIndex);
            if (peers.size === 3) break;
          }
        }
      }
    }
    return Object.freeze(
      corpus.pages.map(({ candidate, shingles }, pageIndex) => {
        if (shingles.size === 0) {
          return notCheckedOutcome({
            target: pageTarget(candidate.page),
            snapshot,
            state: "ineligible",
            reason:
              "Fewer than eight normalized lexical words were available, so no eight-word shingle exists for a boilerplate-share measurement.",
            missingData: [],
            evidence: [
              pageEvidence(
                candidate.page,
                "total_eight_word_shingles",
                0,
                candidate.extraction.source,
              ),
              pageEvidence(
                candidate.page,
                "word_count",
                candidate.extraction.wordCount,
                candidate.extraction.source,
              ),
            ],
          });
        }
        const commonCount = commonCounts[pageIndex] ?? 0;
        const repeatedRatio = ratio(commonCount, shingles.size);
        const failed = shingles.size > 0 && repeatedRatio >= BOILERPLATE_RATIO;
        const peers = [...(peerIndexes[pageIndex] ?? [])].flatMap((peerIndex) => {
          const peer = corpus.pages[peerIndex];
          return peer === undefined ? [] : [peer.candidate];
        });
        return checkedOutcome({
          target: pageTarget(candidate.page),
          failed,
          evidence: [
            pageEvidence(
              candidate.page,
              "total_eight_word_shingles",
              shingles.size,
              candidate.extraction.source,
            ),
            pageEvidence(
              candidate.page,
              "cross_page_common_shingles",
              commonCount,
              candidate.extraction.source,
            ),
            pageEvidence(
              candidate.page,
              "boilerplate_ratio",
              repeatedRatio,
              candidate.extraction.source,
            ),
            crawlEvidence(snapshot, "required_page_support", supportThreshold),
            ...peers
              .slice(0, 3)
              .map(({ page, extraction }) =>
                boundedPageEvidence(page, "repeated_text_peer", extraction.id, extraction.source),
              ),
          ],
          detectedValue: `${commonCount} of ${shingles.size} eight-word shingles (${Math.round(repeatedRatio * 100)}%) recur across at least ${supportThreshold} pages.`,
        });
      }),
    );
  },
);

const cnt003 = defineM5RuleVersion(
  {
    id: "CNT-003",
    title: "Large content sections are duplicated across multiple pages",
    category: "content-quality",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Finds pages sharing a conservative minimum number of exact consecutive word shingles.",
    eligibility:
      "At least two bounded raw or required rendered HTML text observations use supported whitespace-segmented scripts and can prove a retained duplicate; an absence pass also requires complete crawl and analysis coverage.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "Large repeated passages can blur which page is authoritative and reduce the distinct value of each URL.",
    expectedValue: "No pair of pages shares 30 or more distinct exact eight-word shingles.",
    recommendedFix:
      "Keep the best version of the repeated passage, rewrite the other page around its distinct purpose, and canonicalize or consolidate URLs when their purpose is actually identical.",
    verification:
      "Complete a fresh crawl and confirm that no page pair reaches the shared-shingle threshold.",
    confidence: "high",
    impactAreas: CONTENT_SEARCH_IMPACTS,
    responsibleOwner: "content",
  },
  2,
  (snapshot) => {
    const pages = contentPages(snapshot);
    const issue = corpusIssue(snapshot) ?? corpusSegmentationIssue(pages);
    if (pages.length < 2) {
      if (issue !== null) return corpusNotChecked(snapshot, pages, issue);
      return pageUnavailable(
        snapshot,
        "duplicated-sections",
        "At least two extracted HTML pages are required for a cross-page duplicate-section comparison.",
        ["pages", "raw-extraction"],
      );
    }
    const corpus = analyzeCorpus(pages);
    const postings = shinglePostings(corpus.pages);
    const pairs = duplicatePairIndex(postings);
    const coverageIssue =
      issue ??
      (!corpus.complete || !pairs.complete
        ? Object.freeze({
            reason:
              "The bounded text, token, page, shingle, or pair-analysis budget was reached, so duplicate-section absence cannot be concluded.",
            missingData: contentExtractionMissingData(pages),
          })
        : null);
    const analyzedIndex = new Map(
      corpus.pages.map(({ candidate }, index) => [candidate.page.id, index] as const),
    );
    return Object.freeze(
      pages.map((candidate) => {
        const pageIndex = analyzedIndex.get(candidate.page.id) ?? -1;
        const peers =
          pageIndex < 0
            ? []
            : corpus.pages
                .flatMap((peer, peerIndex) => {
                  if (peerIndex === pageIndex) return [];
                  const key = `${Math.min(pageIndex, peerIndex)}:${Math.max(pageIndex, peerIndex)}`;
                  const sharedCount = pairs.counts.get(key) ?? 0;
                  return sharedCount < LARGE_SHARED_SHINGLE_COUNT
                    ? []
                    : [
                        {
                          peer: peer.candidate,
                          sharedCount,
                          sample: pairs.samples.get(key) ?? "unavailable",
                        },
                      ];
                })
                .sort(
                  (left, right) =>
                    right.sharedCount - left.sharedCount ||
                    left.peer.page.id.localeCompare(right.peer.page.id),
                );
        const strongest = peers[0];
        if (strongest === undefined && coverageIssue !== null) {
          return notCheckedOutcome({
            target: pageTarget(candidate.page),
            snapshot,
            reason: coverageIssue.reason,
            missingData: coverageIssue.missingData,
            evidence: [
              pageEvidence(
                candidate.page,
                "duplicate_section_threshold",
                LARGE_SHARED_SHINGLE_COUNT,
                candidate.extraction.source,
              ),
              pageEvidence(
                candidate.page,
                "visible_text_complete",
                candidate.extraction.visibleTextComplete,
                candidate.extraction.source,
              ),
            ],
          });
        }
        return checkedOutcome({
          target: pageTarget(candidate.page),
          failed: strongest !== undefined,
          evidence: [
            pageEvidence(
              candidate.page,
              "duplicate_section_threshold",
              LARGE_SHARED_SHINGLE_COUNT,
              candidate.extraction.source,
            ),
            pageEvidence(
              candidate.page,
              "maximum_shared_shingles",
              strongest?.sharedCount ?? 0,
              candidate.extraction.source,
            ),
            ...(strongest === undefined
              ? []
              : [
                  boundedPageEvidence(
                    strongest.peer.page,
                    "duplicate_section_peer",
                    strongest.peer.page.normalizedUrl,
                    strongest.peer.extraction.source,
                  ),
                  pageEvidence(
                    candidate.page,
                    "shared_shingle_sha256",
                    evidenceObservationDigest([strongest.sample]),
                    candidate.extraction.source,
                  ),
                ]),
          ],
          detectedValue:
            strongest === undefined
              ? `No page pair shared ${LARGE_SHARED_SHINGLE_COUNT} exact eight-word shingles.`
              : `${strongest.sharedCount} exact eight-word shingles are shared with another observed page.`,
        });
      }),
    );
  },
);

const PLACEHOLDER_PATTERNS = Object.freeze([
  /\blorem\s+ipsum\b/iu,
  /\bdolor\s+sit\s+amet\b/iu,
  /\b(?:your|insert)\s+(?:headline|copy|text)\s+here\b/iu,
  /\b(?:todo|tbd):?\s+(?:add|replace|write|complete)\b/iu,
  /\bplaceholder\s+(?:copy|content|text)\b/iu,
]);

const cnt004 = defineM5Rule(
  {
    id: "CNT-004",
    title: "Page contains placeholder or lorem ipsum content",
    category: "content-quality",
    defaultSeverity: "high",
    scope: "page",
    description:
      "Matches a bounded set of explicit placeholder and lorem-ipsum phrases in visible text.",
    eligibility:
      "A successful HTML page has usable raw text, or usable rendered text when the raw extraction identifies client rendering; absence requires a complete bounded text window.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "Placeholder copy exposes unfinished content to visitors and gives crawlers text that does not describe the real page.",
    expectedValue: "Visible page text contains no recognized placeholder or lorem-ipsum marker.",
    recommendedFix:
      "Replace every observed placeholder passage with reviewed, page-specific copy and verify that template defaults cannot be published again.",
    verification:
      "Rerun the crawl and confirm the exact observed marker is absent from extracted visible text.",
    confidence: "high",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  (snapshot) =>
    evaluateContentPages(snapshot, "placeholder-text", (candidate) => {
      const { page, extraction, text } = candidate;
      const window = boundedTextWindow(candidate);
      const match = PLACEHOLDER_PATTERNS.map((pattern) => window.text.match(pattern)?.[0]).find(
        (value): value is string => value !== undefined,
      );
      if (match === undefined && !window.complete) {
        return boundedTextNotChecked(
          snapshot,
          candidate,
          window,
          "Visible text or the bounded analysis window is incomplete, so absence of placeholder text cannot be concluded.",
        );
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: match !== undefined,
        evidence: [
          pageEvidence(page, "placeholder_marker", match ?? "none", extraction.source),
          pageEvidence(page, "visible_text_characters", text.length, extraction.source),
          pageEvidence(page, "visible_text_complete", window.complete, extraction.source),
        ],
        detectedValue:
          match === undefined
            ? "No recognized placeholder marker was found in visible text."
            : `Recognized placeholder marker: ${boundedEvidenceText(match)}.`,
      });
    }),
);

const BROKEN_ENCODING_PATTERN =
  /\uFFFD|(?:Ã|Â)[\u0080-\u00BF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|(?:â€˜|â€™|â€œ|â€\u009d|â€“|â€”|â€¦|â€¢|â„¢|â‚¬)/gu;

const cnt005 = defineM5Rule(
  {
    id: "CNT-005",
    title: "Visible text contains broken character encoding",
    category: "content-quality",
    defaultSeverity: "high",
    scope: "page",
    description:
      "Detects Unicode replacement characters and common UTF-8-as-legacy-codepage mojibake sequences.",
    eligibility:
      "A successful HTML page has usable raw text, or usable rendered text when the raw extraction identifies client rendering; absence requires a complete bounded text window.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "Broken character decoding makes content difficult to read and can corrupt names, punctuation, and terms used for retrieval.",
    expectedValue:
      "Visible text contains no Unicode replacement character or recognized mojibake sequence.",
    recommendedFix:
      "Serve UTF-8 bytes with a matching HTTP Content-Type charset and early meta charset declaration, then repair already-corrupted source text.",
    verification:
      "Fetch and decode the page again, then confirm the persisted visible text contains none of the observed corruption markers.",
    confidence: "high",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "developer",
  },
  (snapshot) =>
    evaluateContentPages(snapshot, "broken-encoding", (candidate) => {
      const { page, extraction } = candidate;
      const window = boundedTextWindow(candidate);
      let markerCount = 0;
      let matchBudgetExceeded = false;
      const markerSamples = new Set<string>();
      for (const match of window.text.matchAll(BROKEN_ENCODING_PATTERN)) {
        markerCount += 1;
        if (markerSamples.size < 10) markerSamples.add(match[0]);
        if (markerCount >= MAX_PATTERN_MATCHES) {
          matchBudgetExceeded = true;
          break;
        }
      }
      if (markerCount === 0 && !window.complete) {
        return boundedTextNotChecked(
          snapshot,
          candidate,
          window,
          "Visible text or the bounded analysis window is incomplete, so absence of encoding corruption cannot be concluded.",
        );
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: markerCount > 0,
        evidence: [
          pageEvidence(page, "encoding_corruption_count", markerCount, extraction.source),
          pageEvidence(
            page,
            "encoding_corruption_markers",
            markerCount === 0 ? ["none"] : [...markerSamples],
            extraction.source,
          ),
          pageEvidence(
            page,
            "encoding_match_budget_exceeded",
            matchBudgetExceeded,
            extraction.source,
          ),
        ],
        detectedValue: `${markerCount}${matchBudgetExceeded ? "+" : ""} recognized broken-encoding sequence${markerCount === 1 ? " was" : "s were"} observed in the bounded analysis window.`,
      });
    }),
);

const cnt006 = defineM5RuleVersion(
  {
    id: "CNT-006",
    title: "Keyword repetition suggests possible keyword stuffing",
    category: "content-quality",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Measures the dominant non-stopword frequency using conservative count and share thresholds.",
    eligibility:
      "A successful HTML page declares English content and provides complete bounded raw or required rendered analysis of at least 50 lexical words using a supported whitespace-segmented script.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "An unusually dominant repeated term can make copy unnatural and may indicate text written for repetition rather than readers.",
    expectedValue:
      "No non-stopword appears at least 10 times while exceeding 12% of eligible lexical words.",
    recommendedFix:
      "Rewrite repeated phrases in natural language, use precise related terms only where they improve meaning, and keep the primary term where context requires it.",
    verification:
      "Rerun extraction and confirm the dominant eligible term remains below either the count or frequency threshold.",
    confidence: "medium",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  2,
  (snapshot) =>
    evaluateContentPages(snapshot, "keyword-repetition", (candidate) => {
      const { page, extraction } = candidate;
      const analysis = analyzeText(candidate);
      const language = primaryHtmlLanguage(extraction);
      if (language !== "en" || !analysis.segmentationSupported) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason:
            "The deterministic keyword-repetition detector uses an English stopword policy and whitespace word segmentation, so it cannot conclude a result for an undeclared, non-English, or unsupported-script page.",
          missingData: [
            extraction.source === "rendered" ? "rendered-extraction" : "raw-extraction",
          ],
          evidence: [
            pageEvidence(page, "html_language", extraction.htmlLanguage, extraction.source),
            pageEvidence(
              page,
              "language_aware_segmentation_supported",
              analysis.segmentationSupported,
              extraction.source,
            ),
          ],
        });
      }
      if (!analysis.complete) {
        return textAnalysisNotChecked(
          snapshot,
          candidate,
          analysis,
          "Visible text or the bounded token analysis is incomplete, so a keyword-repetition ratio cannot be concluded.",
        );
      }
      if (analysis.tokens.length < KEYWORD_MINIMUM_WORDS) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason: `Only ${analysis.tokens.length} lexical words were available; at least ${KEYWORD_MINIMUM_WORDS} are required for a stable repetition ratio.`,
          state: "ineligible",
          missingData: [],
          evidence: [
            pageEvidence(page, "lexical_word_count", analysis.tokens.length, extraction.source),
          ],
        });
      }
      const eligible = analysis.tokens.filter(
        (token) => token.length >= 3 && !STOP_WORDS.has(token),
      );
      const counts = new Map<string, number>();
      for (const token of eligible) counts.set(token, (counts.get(token) ?? 0) + 1);
      const dominant = [...counts.entries()].sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      )[0];
      const repetitions = dominant?.[1] ?? 0;
      const repetitionRatio = ratio(repetitions, eligible.length);
      const failed =
        repetitions >= KEYWORD_MINIMUM_OCCURRENCES && repetitionRatio > KEYWORD_MAXIMUM_RATIO;
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [
          pageEvidence(page, "eligible_lexical_word_count", eligible.length, extraction.source),
          pageEvidence(
            page,
            "dominant_term_sha256",
            dominant === undefined ? "none" : evidenceObservationDigest([dominant[0]]),
            extraction.source,
          ),
          pageEvidence(page, "dominant_term_count", repetitions, extraction.source),
          pageEvidence(page, "dominant_term_ratio", repetitionRatio, extraction.source),
        ],
        detectedValue:
          dominant === undefined
            ? "No eligible content term was available."
            : `The dominant term appears ${repetitions} times across ${eligible.length} eligible words (${Math.round(repetitionRatio * 100)}%).`,
      });
    }),
);

const cnt007 = defineM5Rule(
  {
    id: "CNT-007",
    title: "Important text may be hidden or visually inaccessible",
    category: "content-quality",
    defaultSeverity: "manual-review",
    scope: "page",
    description:
      "Routes visual prominence, CSS hiding, and assistive-technology availability to human review.",
    eligibility:
      "A successful HTML page has usable raw or required rendered visible text for comparison during review.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "Text can exist in extracted markup while remaining hidden, clipped, low contrast, or inaccessible in the rendered experience.",
    expectedValue:
      "Important text is visibly rendered and available to keyboard and assistive-technology users.",
    recommendedFix:
      "Inspect the rendered page at supported breakpoints, remove unintended hiding or clipping, correct contrast and focus behavior, and verify with accessibility tooling and a screen reader.",
    verification:
      "A reviewer confirms the important text is visible, readable, keyboard reachable where interactive, and represented in the accessibility tree.",
    confidence: "low",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "developer",
  },
  (snapshot) =>
    manualPageOutcomes(
      snapshot,
      "hidden-text",
      "persisted extracted text does not prove CSS contrast, clipping, or accessibility-tree exposure.",
    ),
);

const cnt008 = defineM5Rule(
  {
    id: "CNT-008",
    title: "Page purpose, product, service, or primary topic is unclear",
    category: "content-quality",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Routes semantic clarity and page-purpose judgment to a reviewer without using an LLM.",
    eligibility: "A successful HTML page has usable raw or required rendered visible text.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "Visitors and retrieval systems need clear language that states what the page is about and what action or answer it provides.",
    expectedValue:
      "A human reader can identify the page's primary purpose, subject, and intended next step without inference.",
    recommendedFix:
      "Rewrite the opening heading and copy to name the subject, audience, value, and intended action in specific language; remove competing or ambiguous introductions.",
    verification:
      "A reviewer unfamiliar with the site can accurately state the page purpose after reading its heading and opening content.",
    confidence: "low",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  (snapshot) =>
    manualPageOutcomes(
      snapshot,
      "page-purpose",
      "purpose and semantic clarity require human interpretation of the page, audience, and offer.",
    ),
);

const cnt009 = defineM5Rule(
  {
    id: "CNT-009",
    title: "Informational page lacks a concise answer-first summary",
    category: "content-quality",
    defaultSeverity: "opportunity",
    scope: "page",
    description:
      "Routes informational-page classification and answer-first quality to human review.",
    eligibility: "A successful HTML page has usable raw or required rendered visible text.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "A concise opening answer helps visitors and answer systems understand the central response before supporting detail.",
    expectedValue:
      "When the page is informational, its opening directly summarizes the main answer in clear, specific language.",
    recommendedFix:
      "If the page answers an informational need, add a short direct summary immediately after the primary heading, then support it with details and evidence.",
    verification:
      "A reviewer confirms the page is informational and that its opening accurately answers the main need without requiring later context.",
    confidence: "low",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  (snapshot) =>
    manualPageOutcomes(
      snapshot,
      "answer-first",
      "automation cannot reliably classify informational intent or judge whether an opening summary is concise and sufficient.",
    ),
);

const cnt010 = defineM5Rule(
  {
    id: "CNT-010",
    title: "Question-oriented content does not answer questions directly",
    category: "content-quality",
    defaultSeverity: "opportunity",
    scope: "page",
    description: "Routes question intent and answer directness to human review.",
    eligibility: "A successful HTML page has usable raw or required rendered visible text.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "Question-led content that delays or avoids the answer creates friction for readers and answer retrieval.",
    expectedValue:
      "Each material question is followed by an accurate, direct answer before optional elaboration.",
    recommendedFix:
      "Place a one- or two-sentence direct answer immediately after each important question, then add qualifications, examples, and supporting detail.",
    verification:
      "A reviewer checks each question and confirms the adjacent text answers it directly and accurately.",
    confidence: "low",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  (snapshot) =>
    manualPageOutcomes(
      snapshot,
      "direct-answers",
      "punctuation and headings do not establish question intent, answer accuracy, or semantic directness.",
    ),
);

const cnt011 = defineM5Rule(
  {
    id: "CNT-011",
    title: "Editorial content has no identifiable author",
    category: "content-quality",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Routes editorial classification and author attribution to review when structured author signals are unavailable.",
    eligibility: "A successful HTML page has usable raw or required rendered visible text.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "Editorial material without clear attribution gives readers less context for responsibility, expertise, and accountability.",
    expectedValue:
      "Editorial pages visibly identify a responsible author or editorial organization.",
    recommendedFix:
      "Add a visible byline linked to an author or editorial profile and expose equivalent machine-readable author data when applicable.",
    verification:
      "A reviewer confirms the page is editorial and can identify the responsible author or organization from the page itself.",
    confidence: "low",
    impactAreas: CONTENT_SEARCH_IMPACTS,
    responsibleOwner: "content",
  },
  (snapshot) =>
    manualPageOutcomes(
      snapshot,
      "editorial-author",
      "the audit snapshot does not preserve complete structured author attribution, and visible-name patterns cannot reliably identify editorial authorship.",
    ),
);

const cnt012 = defineM5RuleVersion(
  {
    id: "CNT-012",
    title: "Author lacks biography, expertise, or credential information",
    category: "content-quality",
    defaultSeverity: "opportunity",
    scope: "page",
    description: "Routes author biography and expertise sufficiency to human review.",
    eligibility:
      "A successful HTML page has usable raw visible text and its complete persisted raw link collection; rendered content is unavailable because rendered links are not persisted.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction", "links"],
    explanation:
      "Relevant author context can help readers understand who created the material and why their experience is applicable.",
    expectedValue:
      "Where authorship matters, the page links to accurate biography, experience, and relevant credential information.",
    recommendedFix:
      "Create or improve the linked author profile with verifiable role, relevant experience, credentials where appropriate, and editorial responsibility.",
    verification:
      "A reviewer follows the author attribution and confirms the biography and expertise are relevant, specific, and supportable.",
    confidence: "low",
    impactAreas: CONTENT_SEARCH_IMPACTS,
    responsibleOwner: "content",
  },
  3,
  (snapshot) =>
    manualPageOutcomes(
      snapshot,
      "author-expertise",
      "expertise relevance, credential validity, and biography sufficiency require human verification.",
      true,
    ),
);

const cnt013 = defineM5Rule(
  {
    id: "CNT-013",
    title: "Time-sensitive content lacks publish or modified dates",
    category: "content-quality",
    defaultSeverity: "low",
    scope: "page",
    description:
      "Routes time sensitivity and trustworthy date attribution to review when structured date provenance is unavailable.",
    eligibility: "A successful HTML page has usable raw or required rendered visible text.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "Readers cannot judge freshness when time-sensitive guidance or news lacks a clear publication or update date.",
    expectedValue:
      "Time-sensitive pages visibly show an accurate publication date and a meaningful last-modified date when revised.",
    recommendedFix:
      "Add visible publication and updated dates backed by matching structured data, and change the modified date only when the content materially changes.",
    verification:
      "A reviewer confirms the content is time-sensitive and the displayed dates accurately describe publication and material revision.",
    confidence: "low",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  (snapshot) =>
    manualPageOutcomes(
      snapshot,
      "content-dates",
      "the snapshot does not establish time sensitivity or preserve complete date semantics and provenance.",
    ),
);

const cnt014 = defineM5RuleVersion(
  {
    id: "CNT-014",
    title: "Material factual claims lack supporting evidence or citations",
    category: "content-quality",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Routes claim materiality, factual accuracy, and evidence quality to human review.",
    eligibility:
      "A successful HTML page has usable raw visible text and its complete persisted raw link collection; rendered content is unavailable because rendered links are not persisted.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction", "links"],
    explanation:
      "Material claims without traceable support are harder for readers to verify and may undermine trust in the page.",
    expectedValue:
      "Material factual claims link to primary, current, and relevant evidence or clearly identify their source.",
    recommendedFix:
      "Identify each material factual claim, link it to the strongest available primary source, and qualify or remove claims that cannot be supported.",
    verification:
      "A reviewer traces each material claim to its cited source and confirms the source actually supports the wording and context.",
    confidence: "low",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  3,
  (snapshot) =>
    manualPageOutcomes(
      snapshot,
      "claim-evidence",
      "claim detection, materiality, source quality, and whether evidence supports a statement require human judgment.",
      true,
    ),
);

const cnt015 = defineM5RuleVersion(
  {
    id: "CNT-015",
    title: "Outbound citations or supporting-source links are broken",
    category: "content-quality",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Routes citation-role classification and supporting-source health to review without inferring semantics from external anchors.",
    eligibility:
      "A successful raw HTML extraction has a complete persisted link set containing external anchors.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction", "links"],
    explanation:
      "A broken supporting link prevents readers from checking the source and weakens the evidence trail behind the page.",
    expectedValue:
      "Every observed outbound source link resolves without a terminal 4xx, 5xx, or request error.",
    recommendedFix:
      "Replace each broken outbound URL with the current authoritative source, update the citation context if the source changed, or remove unsupported claims.",
    verification:
      "Request every cited target again and confirm it returns a usable response at the intended final URL.",
    confidence: "low",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  3,
  (snapshot) =>
    evaluateContentPages(snapshot, "outbound-sources", ({ page, extraction }) => {
      if (extraction.source === "rendered") {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason:
            "Rendered text is required for this client-rendered page, but rendered links are not persisted, so outbound citation candidates cannot be enumerated.",
          missingData: ["links"],
          evidence: [
            pageEvidence(page, "selected_content_source", extraction.source, extraction.source),
            pageEvidence(page, "rendered_links_persisted", false, extraction.source),
          ],
        });
      }
      const links = page.links.filter(
        (link) => link.scope === "external" && link.linkType === "anchor",
      );
      if (page.extraction?.linksComplete !== true) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason:
            "The persisted source-page link set is incomplete, so citation candidates cannot be enumerated.",
          missingData: ["links"],
          evidence: [
            pageEvidence(page, "links_complete", false, "raw"),
            pageEvidence(page, "retained_external_anchor_count", links.length, "raw"),
          ],
        });
      }
      if (links.length === 0) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason:
            "No outbound anchor link was observed, so this rule is not applicable to the page.",
          state: "ineligible",
          missingData: [],
          evidence: [pageEvidence(page, "outbound_anchor_count", 0, "raw")],
        });
      }
      return eligibleOutcome({
        target: pageTarget(page),
        status: "manual-review",
        reason:
          "External anchors are observed, but the snapshot does not preserve whether each link is a citation or supporting source.",
        evidence: [
          pageEvidence(page, "outbound_anchor_count", links.length, "raw"),
          pageEvidence(page, "links_complete", true, "raw"),
          ...links
            .slice(0, 5)
            .map((link) =>
              externalLinkEvidence(
                page,
                link,
                "external_anchor_candidate",
                boundedEvidenceUrl(link.normalizedTargetUrl),
              ),
            ),
        ],
        detectedValue:
          "Manual review required: external anchors cannot be classified as citations or supporting sources from persisted crawl semantics.",
        confidence: "low",
      });
    }),
);

const cnt016 = defineM5RuleVersion(
  {
    id: "CNT-016",
    title: "Website lacks clear company or organization identity information",
    category: "content-quality",
    defaultSeverity: "medium",
    scope: "site",
    description: "Routes organization identity clarity and sufficiency to human review.",
    eligibility:
      "A completed crawl contains successful raw HTML text and its complete raw link graph; client-rendered content is unavailable until rendered links are persisted.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "rendered-extraction", "links"],
    explanation:
      "Clear ownership and organization information helps visitors understand who is responsible for the website and its claims.",
    expectedValue:
      "The site clearly identifies the responsible company or organization and provides discoverable supporting information.",
    recommendedFix:
      "Add a discoverable organization or About page naming the responsible entity, its role, relevant background, and verifiable business details.",
    verification:
      "A reviewer starts at the homepage and confirms the responsible organization can be identified and its information is clear and supportable.",
    confidence: "low",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  2,
  (snapshot) =>
    manualSiteOutcome(
      snapshot,
      "organization-identity",
      "names and About-like paths do not prove that identity information is clear, complete, or truthful.",
      true,
    ),
);

const cnt017 = defineM5RuleVersion(
  {
    id: "CNT-017",
    title: "Website lacks discoverable contact or support information",
    category: "content-quality",
    defaultSeverity: "medium",
    scope: "site",
    description: "Routes contact-channel discoverability and actual availability to human review.",
    eligibility:
      "A completed crawl contains successful raw HTML text and its complete raw link graph; client-rendered content is unavailable until rendered links are persisted.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "rendered-extraction", "links"],
    explanation:
      "Visitors need a discoverable way to ask for help, resolve problems, or contact the organization responsible for the site.",
    expectedValue:
      "The site exposes a clear contact or support destination from crawlable content.",
    recommendedFix:
      "Add a clearly labeled Contact or Support link in persistent navigation and provide an appropriate monitored email, telephone, form, or help destination.",
    verification:
      "Start from the homepage, follow the visible contact path, and confirm the published channel works and reaches the responsible team.",
    confidence: "low",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  2,
  (snapshot) =>
    manualSiteOutcome(
      snapshot,
      "contact-discovery",
      "email-, telephone-, and help-like text patterns do not prove that a contact channel is visible, appropriate, monitored, or functional.",
      true,
    ),
);

const cnt018 = defineM5RuleVersion(
  {
    id: "CNT-018",
    title: "Website lacks required privacy, terms, or policy pages for its use case",
    category: "content-quality",
    defaultSeverity: "high",
    scope: "site",
    description:
      "Routes use-case-specific policy obligations and policy sufficiency to human or legal review.",
    eligibility:
      "A completed crawl contains successful raw HTML text and its complete raw link graph; client-rendered content is unavailable until rendered links are persisted.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "rendered-extraction", "links"],
    explanation:
      "Which policies are required depends on jurisdiction, audience, data practices, transactions, and the site's actual operation.",
    expectedValue:
      "The site publishes every policy required for its jurisdictions and use case, and those policies accurately describe current practices.",
    recommendedFix:
      "Have qualified counsel identify applicable obligations, publish the required policies in persistent navigation, and keep their language aligned with actual data and business practices.",
    verification:
      "A qualified reviewer maps the site's use case and jurisdictions to its published policies and confirms each policy is current and discoverable.",
    confidence: "low",
    impactAreas: ["user-experience", "security", "search-visibility"],
    responsibleOwner: "content",
  },
  2,
  (snapshot) =>
    manualSiteOutcome(
      snapshot,
      "required-policies",
      "URL labels cannot establish jurisdiction, legal applicability, policy completeness, or whether published terms match actual practices.",
      true,
    ),
);

const cnt019 = defineM5Rule(
  {
    id: "CNT-019",
    title: "Product functionality, pricing, limitations, or availability is unclear",
    category: "content-quality",
    defaultSeverity: "medium",
    scope: "site",
    description: "Routes commercial clarity and disclosure sufficiency to human review.",
    eligibility: "A completed crawl contains successful raw or required rendered HTML text.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "Unclear capabilities, costs, limitations, or availability prevent visitors from making an informed decision and can create misleading expectations.",
    expectedValue:
      "Relevant pages clearly and consistently explain what is offered, what it costs, material constraints, and where or when it is available.",
    recommendedFix:
      "State capabilities, pricing basis, important exclusions, prerequisites, regional or timing limits, and availability next to the relevant decision point.",
    verification:
      "A reviewer compares product, pricing, checkout, and support content and confirms a visitor can understand the material terms without inference.",
    confidence: "low",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  (snapshot) =>
    manualSiteOutcome(
      snapshot,
      "commercial-clarity",
      "automation cannot know the actual offer or judge whether the disclosed functionality, price, limitations, and availability are complete and consistent.",
    ),
);

const cnt020 = defineM5Rule(
  {
    id: "CNT-020",
    title: "Content contains potentially stale claims or outdated details",
    category: "content-quality",
    defaultSeverity: "manual-review",
    scope: "page",
    description:
      "Routes claim currency and real-world validity to human review without an external knowledge or LLM dependency.",
    eligibility: "A successful HTML page has usable raw or required rendered visible text.",
    requiredData: ["pages", "transport", "raw-extraction", "rendered-extraction"],
    explanation:
      "A date or old wording can be a clue, but only comparison with authoritative current facts can establish whether a claim is stale.",
    expectedValue:
      "Material claims, dates, prices, availability, people, and process details remain accurate as of the stated review date.",
    recommendedFix:
      "Assign an owner and review cadence, verify time-sensitive statements against authoritative sources, update inaccurate details, and show a meaningful reviewed or modified date.",
    verification:
      "A reviewer checks each time-sensitive statement against the current authoritative source and records the review date.",
    confidence: "low",
    impactAreas: CONTENT_IMPACTS,
    responsibleOwner: "content",
  },
  (snapshot) =>
    manualPageOutcomes(
      snapshot,
      "stale-claims",
      "the crawl has no authoritative real-world reference against which to verify claim currency or factual accuracy.",
    ),
);

export const CNT_RULES = Object.freeze([
  cnt001,
  cnt002,
  cnt003,
  cnt004,
  cnt005,
  cnt006,
  cnt007,
  cnt008,
  cnt009,
  cnt010,
  cnt011,
  cnt012,
  cnt013,
  cnt014,
  cnt015,
  cnt016,
  cnt017,
  cnt018,
  cnt019,
  cnt020,
] satisfies readonly AuditRuleDefinition[]);
