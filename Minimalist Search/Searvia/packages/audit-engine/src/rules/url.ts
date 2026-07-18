import type { AuditEvidenceItem } from "@searvia/shared-types";

import type { AuditObservationKey, AuditRuleDefinition, AuditRuleOutcome } from "../contracts.js";
import type { AuditCrawlSnapshot, AuditPageObservation } from "../snapshot.js";
import {
  boundedEvidenceUrl,
  boundedPageEvidence,
  canonicalTarget,
  checkedOutcome,
  crawlEvidence,
  defineRule,
  defineRuleVersion,
  fingerprintDistance,
  hasNoindex,
  isHtmlContentType,
  isIndexable,
  isSuccessful,
  maskedUrlForEvidence,
  notCheckedOutcome,
  pageIndexabilityState,
  pageEvidence,
  pagesByUrl,
  pageTarget,
  pageUnavailable,
  safeUrl,
  sampleEvidenceStrings,
} from "./helpers.js";

const URL_IMPACT = ["indexability", "search-visibility", "ai-retrievability"] as const;

function noCandidates(
  snapshot: AuditCrawlSnapshot,
  key: string,
  reason: string,
  missingData: readonly AuditObservationKey[],
): readonly AuditRuleOutcome[] {
  return pageUnavailable(snapshot, key, reason, missingData);
}

function canonicalPages(snapshot: AuditCrawlSnapshot): readonly AuditPageObservation[] {
  return snapshot.pages.filter(
    (page) =>
      page.extraction?.source === "raw" &&
      page.extraction.canonicalTagCount === 1 &&
      page.extraction.canonicalUrl !== null,
  );
}

interface CorpusCoverageIssue {
  readonly reason: string;
  readonly missingData: readonly AuditObservationKey[];
}

function coverageIssue(reason: string, missingData: AuditObservationKey): CorpusCoverageIssue {
  return Object.freeze({ reason, missingData: Object.freeze([missingData]) });
}

function corpusCoverageIssue(
  snapshot: AuditCrawlSnapshot,
  requireFingerprint = false,
): CorpusCoverageIssue | null {
  if (snapshot.status !== "completed") {
    return coverageIssue("The crawl was partially completed.", "crawl");
  }
  for (const page of snapshot.pages) {
    if (page.statusCode === null) {
      return coverageIssue(
        `The transport result for ${maskedUrlForEvidence(page.normalizedUrl)} is unavailable.`,
        "transport",
      );
    }
    if (!isSuccessful(page)) continue;
    if (page.contentType === null) {
      return coverageIssue(
        `The content type for ${maskedUrlForEvidence(page.normalizedUrl)} is unavailable.`,
        "transport",
      );
    }
    if (!isHtmlContentType(page.contentType)) continue;
    if (page.robotsDecision === "not-checked") {
      return coverageIssue(
        `The robots decision for ${maskedUrlForEvidence(page.normalizedUrl)} is unavailable.`,
        "robots",
      );
    }
    if (page.robotsDecision === "disallowed") continue;
    const extraction = page.extraction;
    if (extraction === null || extraction.source !== "raw") {
      return coverageIssue(
        `Raw extraction for ${maskedUrlForEvidence(page.normalizedUrl)} is unavailable.`,
        "raw-extraction",
      );
    }
    if (!extraction.directiveScopePreserved) {
      return coverageIssue(
        `Crawler-specific directive scope for ${maskedUrlForEvidence(page.normalizedUrl)} is unavailable.`,
        "raw-extraction",
      );
    }
    const noindex = hasNoindex(extraction.metaRobots) || hasNoindex(extraction.xRobotsTag);
    if (noindex || !extraction.meaningfulContent) continue;
    if (extraction.contentHash === null) {
      return coverageIssue(
        `The content hash for ${maskedUrlForEvidence(page.normalizedUrl)} is unavailable.`,
        "raw-extraction",
      );
    }
    if (requireFingerprint && extraction.similarityFingerprint === null) {
      return coverageIssue(
        `The similarity fingerprint for ${maskedUrlForEvidence(page.normalizedUrl)} is unavailable.`,
        "raw-extraction",
      );
    }
  }
  return null;
}

function notCheckedPage(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
  reason: string,
  missingData: readonly AuditObservationKey[],
): AuditRuleOutcome {
  const evidenceItems = [
    pageEvidence(page, "eligibility_transport", [
      page.statusCode ?? "unavailable",
      page.contentType ?? "unavailable",
      page.robotsDecision,
    ]),
    ...(page.extraction === null
      ? []
      : [
          pageEvidence(
            page,
            "eligibility_extraction",
            [page.extraction.source, page.extraction.directiveScopePreserved],
            page.extraction.source,
          ),
        ]),
  ];
  return notCheckedOutcome({
    target: pageTarget(page),
    snapshot,
    reason,
    missingData,
    evidence: evidenceItems,
  });
}

const url001 = defineRuleVersion(
  {
    id: "URL-001",
    title: "Indexable page has no canonical declaration",
    category: "urls-canonicals",
    defaultSeverity: "medium",
    scope: "page",
    description: "Checks eligible indexable HTML pages for a canonical declaration.",
    eligibility:
      "The page is a successful, crawlable, indexable HTML document with raw extraction.",
    requiredData: ["pages", "transport", "raw-extraction", "robots"],
    explanation:
      "A missing canonical leaves the preferred URL implicit when duplicate or variant URLs are discovered.",
    expectedValue: "The indexable page declares exactly one absolute preferred canonical URL.",
    recommendedFix:
      'Add one <link rel="canonical" href="…"> in the document head that points to the preferred successful indexable URL, normally the page\'s own normalized URL.',
    verification:
      "Fetch the page source and confirm one valid canonical resolves to the intended preferred URL.",
    confidence: "high",
    impactAreas: URL_IMPACT,
    responsibleOwner: "seo",
  },
  5,
  (snapshot) => {
    const outcomes: AuditRuleOutcome[] = snapshot.pages.flatMap((page) => {
      const indexability = pageIndexabilityState(page);
      if (indexability === "not-indexable") return [];
      if (indexability === "unknown") {
        const directiveScopeUnavailable =
          page.extraction?.source === "raw" && !page.extraction.directiveScopePreserved;
        return [
          notCheckedPage(
            snapshot,
            page,
            directiveScopeUnavailable
              ? "Crawler-specific directive ownership was not preserved, so the page cannot be established as indexable for canonical evaluation."
              : "Transport, robots, or raw directive evidence is incomplete, so the page cannot be established as indexable for canonical evaluation.",
            directiveScopeUnavailable
              ? ["raw-extraction"]
              : ["transport", "robots", "raw-extraction"],
          ),
        ];
      }
      return [
        checkedOutcome({
          target: pageTarget(page),
          failed: (page.extraction?.canonicalTagCount ?? 0) === 0,
          evidence: [
            pageEvidence(
              page,
              "canonical_tag_count",
              page.extraction?.canonicalTagCount ?? 0,
              "raw",
            ),
          ],
          detectedValue: `${page.extraction?.canonicalTagCount ?? 0} canonical declaration(s).`,
        }),
      ];
    });
    if (outcomes.length === 0) {
      return noCandidates(
        snapshot,
        "missing-canonical",
        "No eligible indexable HTML page was available.",
        ["pages", "raw-extraction"],
      );
    }
    return outcomes;
  },
);

const url002 = defineRule(
  {
    id: "URL-002",
    title: "Page contains multiple canonical declarations",
    category: "urls-canonicals",
    defaultSeverity: "high",
    scope: "page",
    description: "Counts canonical link declarations in parsed raw HTML.",
    eligibility: "A raw HTML extraction is available.",
    requiredData: ["raw-extraction"],
    explanation: "Multiple canonical declarations create conflicting preferred-URL signals.",
    expectedValue: "The page contains at most one canonical declaration.",
    recommendedFix:
      "Remove duplicate or conflicting canonical elements and ensure the CMS, framework, and plugins emit exactly one preferred URL.",
    verification:
      "Inspect the raw document head and response headers and confirm exactly one canonical remains.",
    confidence: "high",
    impactAreas: URL_IMPACT,
    responsibleOwner: "developer",
  },
  (snapshot) => {
    const pages = snapshot.pages.filter((page) => page.extraction?.source === "raw");
    if (pages.length === 0) {
      return noCandidates(snapshot, "multiple-canonical", "No raw HTML extraction was available.", [
        "raw-extraction",
      ]);
    }
    return pages.map((page) =>
      checkedOutcome({
        target: pageTarget(page),
        failed: (page.extraction?.canonicalTagCount ?? 0) > 1,
        evidence: [
          pageEvidence(page, "canonical_tag_count", page.extraction?.canonicalTagCount ?? 0, "raw"),
        ],
        detectedValue: `${page.extraction?.canonicalTagCount ?? 0} canonical declaration(s).`,
      }),
    );
  },
);

const url003 = defineRuleVersion(
  {
    id: "URL-003",
    title: "Canonical URL is malformed or cannot be resolved",
    category: "urls-canonicals",
    defaultSeverity: "high",
    scope: "page",
    description: "Checks whether one declared canonical produced a normalized HTTP(S) URL.",
    eligibility: "Raw extraction found exactly one canonical declaration.",
    requiredData: ["raw-extraction"],
    explanation: "A malformed canonical cannot communicate a usable preferred URL.",
    expectedValue: "The single canonical resolves to a valid credential-free HTTP(S) URL.",
    recommendedFix:
      "Replace the canonical href with one valid absolute HTTPS URL without credentials, whitespace, malformed escapes, or unsupported schemes.",
    verification:
      "Resolve the canonical from the page URL and confirm it parses as the intended absolute HTTP(S) URL.",
    confidence: "high",
    impactAreas: URL_IMPACT,
    responsibleOwner: "developer",
  },
  3,
  (snapshot) => {
    const pages = snapshot.pages.filter(
      (page) => page.extraction?.source === "raw" && page.extraction.canonicalTagCount === 1,
    );
    if (pages.length === 0) {
      return noCandidates(
        snapshot,
        "malformed-canonical",
        "No page had exactly one canonical declaration; missing and duplicate canonicals are evaluated separately.",
        ["raw-extraction"],
      );
    }
    return pages.map((page) => {
      const canonical = page.extraction?.canonicalUrl ?? null;
      const failure = page.extraction?.canonicalNormalizationFailure ?? null;
      const evidence = [
        pageEvidence(page, "canonical_tag_count", 1, "raw"),
        pageEvidence(
          page,
          "canonical_normalization_failure_code",
          failure?.code ?? "not_recorded",
          "raw",
        ),
      ];
      if (failure !== null && canonical === null) {
        return checkedOutcome({
          target: pageTarget(page),
          failed: true,
          evidence,
          detectedValue: `Canonical normalization failed with ${failure.code}.`,
        });
      }
      if (failure === null && canonical !== null && safeUrl(canonical) !== null) {
        return checkedOutcome({
          target: pageTarget(page),
          failed: false,
          evidence: [...evidence, pageEvidence(page, "canonical_url", canonical, "raw")],
          detectedValue: canonical,
        });
      }
      const reason =
        "Canonical normalization provenance was not recorded for this legacy extraction, so the declaration cannot be evaluated safely.";
      return notCheckedOutcome({
        target: pageTarget(page),
        snapshot,
        reason,
        missingData: ["raw-extraction"],
        evidence,
      });
    });
  },
);

function canonicalTransportRule(
  id: "URL-004" | "URL-005" | "URL-006",
  title: string,
  severity: "high",
  description: string,
  explanation: string,
  recommendedFix: string,
  failed: (target: AuditPageObservation) => boolean,
  field: string,
): AuditRuleDefinition {
  return defineRuleVersion(
    {
      id,
      title,
      category: "urls-canonicals",
      defaultSeverity: severity,
      scope: "page",
      description,
      eligibility:
        "One normalized canonical and its exact crawled target observation are available.",
      requiredData: ["pages", "raw-extraction", "transport"],
      explanation,
      expectedValue: "The canonical points directly to a successful non-redirecting URL.",
      recommendedFix,
      verification:
        "Request the canonical URL directly and confirm the expected successful non-redirecting response.",
      confidence: "high",
      impactAreas: URL_IMPACT,
      responsibleOwner: "developer",
    },
    3,
    (snapshot) => {
      const pages = canonicalPages(snapshot);
      if (pages.length === 0) {
        return noCandidates(
          snapshot,
          id.toLowerCase(),
          "No single normalized canonical was available.",
          ["raw-extraction"],
        );
      }
      return pages.map((page) => {
        const target = canonicalTarget(snapshot, page);
        if (target === null) {
          return notCheckedPage(
            snapshot,
            page,
            "The exact canonical target was not crawled, so its transport state is unavailable.",
            ["pages"],
          );
        }
        if (target.statusCode === null) {
          return notCheckedPage(
            snapshot,
            page,
            "The canonical target was crawled without a conclusive transport status.",
            ["transport"],
          );
        }
        return checkedOutcome({
          target: pageTarget(page),
          failed: failed(target),
          evidence: [
            pageEvidence(
              target,
              field,
              field === "redirect_hop_count" ? target.redirectChain.length : target.statusCode,
            ),
          ],
          detectedValue:
            field === "redirect_hop_count"
              ? `${target.redirectChain.length} redirect hop(s) at the canonical target.`
              : `Canonical target status: ${target.statusCode ?? "unavailable"}.`,
        });
      });
    },
  );
}

const url004 = canonicalTransportRule(
  "URL-004",
  "Canonical points to a redirected URL",
  "high",
  "Checks the exact canonical target for redirect hops.",
  "A canonical that redirects adds ambiguity and makes crawlers resolve another URL before reaching the preferred page.",
  "Change the canonical href to the final non-redirecting preferred URL and update internal links to the same destination.",
  (target) =>
    target.redirectChain.length > 0 ||
    (target.statusCode !== null && target.statusCode >= 300 && target.statusCode <= 399),
  "redirect_hop_count",
);
const url005 = canonicalTransportRule(
  "URL-005",
  "Canonical points to a 4xx URL",
  "high",
  "Checks the exact canonical target for a client-error response.",
  "A 4xx canonical target identifies a preferred URL that is unavailable to crawlers and users.",
  "Restore the canonical target with a successful response, or change the canonical to the correct live preferred URL.",
  (target) => target.statusCode !== null && target.statusCode >= 400 && target.statusCode <= 499,
  "status_code",
);
const url006 = canonicalTransportRule(
  "URL-006",
  "Canonical points to a 5xx URL",
  "high",
  "Checks the exact canonical target for a server-error response.",
  "A 5xx canonical target makes the preferred page temporarily or persistently unavailable.",
  "Repair the server or upstream dependency for the canonical target, or use a healthy preferred canonical URL.",
  (target) => target.statusCode !== null && target.statusCode >= 500 && target.statusCode <= 599,
  "status_code",
);

const url007 = defineRuleVersion(
  {
    id: "URL-007",
    title: "Canonical points to a blocked or noindex URL",
    category: "urls-canonicals",
    defaultSeverity: "high",
    scope: "page",
    description: "Checks the exact canonical target's robots decision and index directives.",
    eligibility:
      "One normalized canonical and its exact crawled target policy observations are available.",
    requiredData: ["raw-extraction", "robots", "pages"],
    explanation:
      "A blocked or noindex canonical target asks crawlers to consolidate signals into a URL they cannot index normally.",
    expectedValue: "The canonical target is crawlable and contains no noindex directive.",
    recommendedFix:
      "Remove the blocking robots rule or noindex directive from the intended canonical target, or change the source canonical to a crawlable indexable preferred URL.",
    verification:
      "Re-crawl the canonical target and confirm it is allowed and emits no meta or X-Robots noindex.",
    confidence: "high",
    impactAreas: URL_IMPACT,
    responsibleOwner: "seo",
  },
  3,
  (snapshot) => {
    const pages = canonicalPages(snapshot);
    if (pages.length === 0) {
      return noCandidates(
        snapshot,
        "canonical-indexability",
        "No single normalized canonical was available.",
        ["raw-extraction"],
      );
    }
    return pages.map((page) => {
      const target = canonicalTarget(snapshot, page);
      if (target === null) {
        return notCheckedPage(snapshot, page, "The exact canonical target was not crawled.", [
          "pages",
        ]);
      }
      const blocked = target.robotsDecision === "disallowed";
      if (blocked) {
        return checkedOutcome({
          target: pageTarget(page),
          failed: true,
          evidence: [pageEvidence(target, "canonical_target_robots", target.robotsDecision)],
          detectedValue: "The canonical target is blocked by robots.txt.",
        });
      }
      if (target.statusCode === null || !isSuccessful(target)) {
        return notCheckedPage(
          snapshot,
          page,
          "The canonical target does not have a successful transport observation for directive evaluation.",
          ["transport"],
        );
      }
      if (target.robotsDecision === "not-checked") {
        return notCheckedPage(
          snapshot,
          page,
          "The canonical target's robots decision is unavailable.",
          ["robots"],
        );
      }
      const extraction = target.extraction;
      if (extraction === null || extraction.source !== "raw") {
        return notCheckedPage(
          snapshot,
          page,
          "The canonical target's index directives were not extracted.",
          ["raw-extraction"],
        );
      }
      if (!extraction.directiveScopePreserved) {
        return notCheckedPage(
          snapshot,
          page,
          "The canonical target's crawler-specific directive ownership was not preserved.",
          ["raw-extraction"],
        );
      }
      const noindex = hasNoindex(extraction.metaRobots) || hasNoindex(extraction.xRobotsTag);
      return checkedOutcome({
        target: pageTarget(page),
        failed: noindex,
        evidence: [
          pageEvidence(target, "canonical_target_robots", target.robotsDecision),
          pageEvidence(
            target,
            "canonical_target_index_directives",
            [...extraction.metaRobots, ...extraction.xRobotsTag],
            "raw",
          ),
        ],
        detectedValue: noindex
          ? "The canonical target contains noindex."
          : "The canonical target is crawlable and indexable.",
      });
    });
  },
);

const url008 = defineRule(
  {
    id: "URL-008",
    title: "Canonical unexpectedly points to a different domain",
    category: "urls-canonicals",
    defaultSeverity: "high",
    scope: "page",
    description: "Compares the normalized canonical hostname with the project origin.",
    eligibility: "One normalized canonical URL is available.",
    requiredData: ["crawl", "raw-extraction"],
    explanation:
      "A cross-domain canonical transfers preferred-URL signals outside the audited site and may be accidental, although legitimate syndication is possible.",
    expectedValue: "The canonical remains within the configured project hostname scope.",
    recommendedFix:
      "If the content belongs to this site, point the canonical to the correct in-scope preferred URL; if cross-domain syndication is intentional, document and accept the risk after verifying ownership and reciprocity.",
    verification:
      "Inspect the canonical host and confirm it matches the approved ownership and syndication decision.",
    confidence: "medium",
    impactAreas: URL_IMPACT,
    responsibleOwner: "seo",
  },
  (snapshot) => {
    const origin = safeUrl(snapshot.origin);
    const pages = canonicalPages(snapshot);
    if (origin === null || pages.length === 0) {
      return noCandidates(
        snapshot,
        "cross-domain-canonical",
        "No normalized canonical or project origin was available.",
        ["raw-extraction"],
      );
    }
    return pages.map((page) => {
      const canonical = safeUrl(page.extraction?.canonicalUrl ?? "");
      if (canonical === null) {
        return notCheckedPage(
          snapshot,
          page,
          "The canonical URL is malformed and is evaluated by URL-003.",
          ["raw-extraction"],
        );
      }
      const base = (host: string) => host.toLowerCase().replace(/^www\./u, "");
      const failed = base(canonical.hostname) !== base(origin.hostname);
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [pageEvidence(page, "canonical_hostname", canonical.hostname, "raw")],
        detectedValue: `Page host ${origin.hostname}; canonical host ${canonical.hostname}.`,
      });
    });
  },
);

function canonicalGraphEvidence(
  snapshot: AuditCrawlSnapshot,
  pages: readonly AuditPageObservation[],
  field: "canonical_chain" | "canonical_cycle",
): readonly AuditEvidenceItem[] {
  return Object.freeze([
    crawlEvidence(snapshot, `${field}_sample`, [
      `contributors=${pages.length}`,
      ...sampleEvidenceStrings(
        pages.map(
          (page) =>
            `page=${page.id};url=${boundedEvidenceUrl(page.normalizedUrl)};canonical=${
              page.extraction?.canonicalUrl === null || page.extraction?.canonicalUrl === undefined
                ? "none"
                : boundedEvidenceUrl(page.extraction.canonicalUrl)
            }`,
        ),
        { maximumItems: 10, maximumItemBytes: 1_024, maximumTotalBytes: 10_240 },
      ),
    ]),
    ...pages
      .slice(0, 20)
      .map((page) =>
        boundedPageEvidence(
          page,
          `${field}_edge`,
          [
            `source_url=${boundedEvidenceUrl(page.normalizedUrl)}`,
            `canonical_url=${
              page.extraction?.canonicalUrl === null || page.extraction?.canonicalUrl === undefined
                ? "none"
                : boundedEvidenceUrl(page.extraction.canonicalUrl)
            }`,
          ],
          "raw",
        ),
      ),
  ]);
}

const url009 = defineRuleVersion(
  {
    id: "URL-009",
    title: "Canonical loop detected",
    category: "urls-canonicals",
    defaultSeverity: "critical",
    scope: "page",
    description: "Traverses the observed canonical graph and detects cycles of two or more URLs.",
    eligibility: "The canonical chain is fully represented by crawled pages until it terminates.",
    requiredData: ["raw-extraction", "pages"],
    explanation: "A canonical cycle provides no stable preferred URL for the involved pages.",
    expectedValue:
      "Canonical chains terminate at one self-canonical or canonical-free preferred page.",
    recommendedFix:
      "Choose one preferred successful URL, point every page in the cycle directly to it, and make that destination self-canonical.",
    verification:
      "Traverse each canonical href and confirm the chain converges without revisiting another URL.",
    confidence: "high",
    impactAreas: URL_IMPACT,
    responsibleOwner: "seo",
  },
  4,
  (snapshot) => {
    const pages = canonicalPages(snapshot);
    if (pages.length === 0) {
      return noCandidates(snapshot, "canonical-loop", "No canonical graph edge was available.", [
        "raw-extraction",
      ]);
    }
    const byUrl = pagesByUrl(snapshot);
    return pages.map((page) => {
      const visited = new Map<string, number>();
      const chain: string[] = [];
      const contributors: AuditPageObservation[] = [];
      let current: AuditPageObservation | undefined = page;
      let unavailable = false;
      while (current !== undefined) {
        const url = current.normalizedUrl;
        const prior = visited.get(url);
        if (prior !== undefined) {
          const cycle = chain.slice(prior);
          const cycleContributors = contributors.slice(prior);
          const selfCanonical = cycle.length === 1;
          return checkedOutcome({
            target: pageTarget(page),
            failed: !selfCanonical,
            evidence: canonicalGraphEvidence(snapshot, cycleContributors, "canonical_cycle"),
            detectedValue: selfCanonical
              ? "The canonical graph ends in a self-canonical page."
              : `A canonical cycle contains ${cycle.length} observed page(s).`,
          });
        }
        visited.set(url, chain.length);
        chain.push(url);
        contributors.push(current);
        const extraction = current.extraction;
        if (extraction === null || extraction.source !== "raw") {
          unavailable = true;
          break;
        }
        if (extraction.canonicalTagCount === 0) break;
        if (extraction.canonicalTagCount !== 1 || extraction.canonicalUrl === null) {
          unavailable = true;
          break;
        }
        const canonical = extraction.canonicalUrl;
        const next = byUrl.get(canonical);
        if (next === undefined) {
          unavailable = true;
          break;
        }
        current = next;
        if (chain.length > snapshot.pages.length + 1) break;
      }
      if (unavailable) {
        return notCheckedPage(
          snapshot,
          page,
          "A canonical chain target was not crawled, so loop traversal is incomplete.",
          ["pages"],
        );
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: false,
        evidence: canonicalGraphEvidence(snapshot, contributors, "canonical_chain"),
        detectedValue: `Canonical chain terminated after ${chain.length} observed page(s).`,
      });
    });
  },
);

const url010 = defineRule(
  {
    id: "URL-010",
    title: "Apparently unique page canonicals to a substantially different page",
    category: "urls-canonicals",
    defaultSeverity: "medium",
    scope: "page",
    description: "Compares source and canonical-target content hashes and similarity fingerprints.",
    eligibility:
      "Both source and exact canonical target have meaningful deterministic fingerprints.",
    requiredData: ["raw-extraction", "pages"],
    explanation:
      "Canonicalizing substantially different content can hide a unique page and consolidate signals into an unrelated destination.",
    expectedValue: "Canonical source and target contain substantially equivalent content.",
    recommendedFix:
      "Self-canonicalize the unique page, or consolidate and rewrite the source so its primary content is genuinely equivalent to the chosen canonical target.",
    verification:
      "Compare the primary content of both URLs and confirm the canonical relationship represents duplicate or equivalent content.",
    confidence: "medium",
    impactAreas: URL_IMPACT,
    responsibleOwner: "seo",
  },
  (snapshot, policy) => {
    const pages = canonicalPages(snapshot);
    if (pages.length === 0) {
      return noCandidates(
        snapshot,
        "canonical-content",
        "No canonical source page was available.",
        ["raw-extraction"],
      );
    }
    return pages.map((page) => {
      const target = canonicalTarget(snapshot, page);
      const sourceExtraction = page.extraction;
      const targetExtraction = target?.extraction;
      if (
        target === null ||
        sourceExtraction === null ||
        sourceExtraction.source !== "raw" ||
        sourceExtraction.contentHash === null ||
        sourceExtraction.similarityFingerprint === null ||
        targetExtraction === null ||
        targetExtraction === undefined ||
        targetExtraction.source !== "raw" ||
        targetExtraction.contentHash === null ||
        targetExtraction.similarityFingerprint === null
      ) {
        return notCheckedPage(
          snapshot,
          page,
          "Source and canonical target fingerprints were not both available.",
          ["pages", "raw-extraction"],
        );
      }
      const distance = fingerprintDistance(
        sourceExtraction.similarityFingerprint,
        targetExtraction.similarityFingerprint,
      );
      if (distance === null) {
        return notCheckedPage(snapshot, page, "The fingerprints were incompatible.", [
          "raw-extraction",
        ]);
      }
      const failed =
        sourceExtraction.contentHash !== targetExtraction.contentHash &&
        distance > policy.nearDuplicateMaximumDistance;
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [
          pageEvidence(page, "source_content_hash", sourceExtraction.contentHash, "raw"),
          pageEvidence(page, "canonical_target_url", target.normalizedUrl, "raw"),
          pageEvidence(
            target,
            "canonical_target_content_hash",
            targetExtraction.contentHash,
            "raw",
          ),
          pageEvidence(page, "canonical_content_distance", distance, "raw"),
        ],
        detectedValue: `Similarity distance ${distance}; exact match ${String(sourceExtraction.contentHash === targetExtraction.contentHash)}.`,
        expectedValue: `Exact content match or similarity distance at most ${policy.nearDuplicateMaximumDistance}.`,
        confidence: "medium",
      });
    });
  },
);

const url011 = defineRule(
  {
    id: "URL-011",
    title: "Canonical uses an inconsistent protocol, hostname, or slash format",
    category: "urls-canonicals",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Detects canonical variants that differ only by protocol, www host, or terminal slash.",
    eligibility:
      "The page and canonical collapse to the same semantic path after variant normalization.",
    requiredData: ["raw-extraction"],
    explanation:
      "A canonical variant that contradicts the site's preferred URL format creates avoidable inconsistency.",
    expectedValue: "The canonical uses the exact preferred HTTPS host and slash convention.",
    recommendedFix:
      "Generate the canonical with the same HTTPS protocol, canonical hostname, port, path casing, query policy, and trailing-slash convention as the preferred final URL.",
    verification:
      "Compare the page and canonical URL components and confirm they use the same preferred representation.",
    confidence: "high",
    impactAreas: URL_IMPACT,
    responsibleOwner: "developer",
  },
  (snapshot) => {
    const pages = canonicalPages(snapshot);
    if (pages.length === 0) {
      return noCandidates(
        snapshot,
        "canonical-format",
        "No normalized canonical URL was available.",
        ["raw-extraction"],
      );
    }
    return pages.map((page) => {
      const current = safeUrl(page.normalizedUrl);
      const canonical = safeUrl(page.extraction?.canonicalUrl ?? "");
      if (current === null || canonical === null) {
        return notCheckedPage(snapshot, page, "A URL could not be parsed.", ["raw-extraction"]);
      }
      const semantic = (url: URL) =>
        `${url.hostname.replace(/^www\./u, "").toLowerCase()}${url.pathname.replace(/\/$/u, "") || "/"}${url.search}`;
      if (semantic(current) !== semantic(canonical)) {
        return notCheckedPage(
          snapshot,
          page,
          "The canonical points to a different semantic path, so this format-only rule is ineligible.",
          ["raw-extraction"],
        );
      }
      const failed = current.href !== canonical.href;
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [pageEvidence(page, "canonical_format", canonical.href, "raw")],
        detectedValue: failed
          ? `Page ${current.href}; canonical ${canonical.href}.`
          : "Canonical formatting exactly matches the preferred page URL.",
      });
    });
  },
);

interface CorpusPeerEvidence {
  readonly peer: AuditPageObservation;
  readonly details: readonly string[];
}

function corpusComparisonEvidence(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
  field: string,
  peers: readonly CorpusPeerEvidence[],
): readonly AuditEvidenceItem[] {
  return Object.freeze([
    boundedPageEvidence(
      page,
      `${field}_source`,
      [
        `content_hash=${page.extraction?.contentHash ?? "unavailable"}`,
        `similarity_fingerprint=${page.extraction?.similarityFingerprint ?? "unavailable"}`,
      ],
      "raw",
    ),
    crawlEvidence(snapshot, `${field}_sample`, [
      `source_page=${page.id}`,
      `matching_peers=${peers.length}`,
      ...sampleEvidenceStrings(
        peers.map(
          ({ peer, details }) =>
            `peer=${peer.id};url=${boundedEvidenceUrl(peer.normalizedUrl)};${details.join(";")}`,
        ),
        { maximumItems: 10, maximumItemBytes: 1_024, maximumTotalBytes: 10_240 },
      ),
    ]),
    ...peers
      .slice(0, 12)
      .map(({ peer, details }) => boundedPageEvidence(peer, `${field}_peer`, details, "raw")),
  ]);
}

function corpusPassOrNotChecked(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
  peers: readonly CorpusPeerEvidence[],
  field: string,
  detectedValue: string,
  issue: CorpusCoverageIssue | null,
  expectedValue?: string,
  confidence?: "high" | "medium",
): AuditRuleOutcome {
  if (peers.length === 0 && issue !== null) {
    return notCheckedPage(
      snapshot,
      page,
      `${issue.reason} Absence of a corpus-level duplicate cannot be concluded.`,
      issue.missingData,
    );
  }
  return checkedOutcome({
    target: pageTarget(page),
    failed: peers.length > 0,
    evidence: corpusComparisonEvidence(snapshot, page, field, peers),
    detectedValue,
    ...(expectedValue === undefined ? {} : { expectedValue }),
    ...(confidence === undefined ? {} : { confidence }),
  });
}

const url012 = defineRuleVersion(
  {
    id: "URL-012",
    title: "Exact duplicate content exists on multiple indexable URLs",
    category: "urls-canonicals",
    defaultSeverity: "high",
    scope: "page",
    description: "Groups meaningful indexable pages by deterministic content hash.",
    eligibility:
      "A meaningful indexable raw extraction has a content hash and crawl coverage is conclusive for a pass.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "robots"],
    explanation:
      "Exact duplicates split crawl attention and leave multiple URLs competing for the same content.",
    expectedValue: "No other indexable URL has the same primary-content hash.",
    recommendedFix:
      "Choose one preferred URL, permanently redirect or canonicalize exact duplicates to it, update internal links and sitemaps, or make each page's primary content genuinely distinct.",
    verification:
      "Re-crawl all affected URLs and confirm only the preferred indexable URL retains the duplicate content hash.",
    confidence: "high",
    impactAreas: URL_IMPACT,
    responsibleOwner: "seo",
  },
  4,
  (snapshot) => {
    const coverageIssue = corpusCoverageIssue(snapshot);
    const pages = snapshot.pages.filter(
      (page) =>
        isIndexable(page) &&
        page.extraction?.meaningfulContent &&
        page.extraction.contentHash !== null,
    );
    if (pages.length === 0) {
      if (coverageIssue !== null) {
        return noCandidates(
          snapshot,
          "exact-duplicates",
          coverageIssue.reason,
          coverageIssue.missingData,
        );
      }
      return noCandidates(
        snapshot,
        "exact-duplicates",
        "No indexable content hash was available.",
        ["raw-extraction"],
      );
    }
    return pages.map((page) => {
      const hash = page.extraction?.contentHash;
      const peers = pages.filter(
        (peer) => peer.id !== page.id && peer.extraction?.contentHash === hash,
      );
      return corpusPassOrNotChecked(
        snapshot,
        page,
        peers.map((peer) => ({
          peer,
          details: [`content_hash=${peer.extraction?.contentHash ?? "unavailable"}`],
        })),
        "exact_duplicate_urls",
        `${peers.length} other indexable URL(s) share content hash ${hash}.`,
        coverageIssue,
      );
    });
  },
);

const url013 = defineRuleVersion(
  {
    id: "URL-013",
    title: "Near-duplicate content exists on multiple indexable URLs",
    category: "urls-canonicals",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Compares deterministic similarity fingerprints across indexable pages with different hashes.",
    eligibility:
      "Meaningful indexable pages have compatible fingerprints and crawl coverage is conclusive for a pass.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "robots"],
    explanation:
      "Near-duplicate pages can dilute distinct value and create ambiguous preferred URLs.",
    expectedValue:
      "No different-content indexable peer is within the versioned similarity-distance threshold.",
    recommendedFix:
      "Differentiate the affected pages with unique primary content, or consolidate them under one preferred URL using redirects, canonicals, internal links, and sitemap updates.",
    verification:
      "Re-crawl the pages and confirm their fingerprints are distinct or only one preferred version remains indexable.",
    confidence: "medium",
    impactAreas: URL_IMPACT,
    responsibleOwner: "content",
  },
  4,
  (snapshot, policy) => {
    const coverageIssue = corpusCoverageIssue(snapshot, true);
    const pages = snapshot.pages.filter(
      (page) =>
        isIndexable(page) &&
        page.extraction?.meaningfulContent &&
        page.extraction.contentHash !== null &&
        page.extraction.similarityFingerprint !== null,
    );
    if (pages.length === 0) {
      if (coverageIssue !== null) {
        return noCandidates(
          snapshot,
          "near-duplicates",
          coverageIssue.reason,
          coverageIssue.missingData,
        );
      }
      return noCandidates(
        snapshot,
        "near-duplicates",
        "No compatible indexable fingerprints were available.",
        ["raw-extraction"],
      );
    }
    return pages.map((page) => {
      const peers = pages.flatMap((peer) => {
        if (peer.id === page.id || peer.extraction?.contentHash === page.extraction?.contentHash)
          return [];
        const distance = fingerprintDistance(
          page.extraction?.similarityFingerprint ?? "",
          peer.extraction?.similarityFingerprint ?? "",
        );
        return distance !== null && distance <= policy.nearDuplicateMaximumDistance
          ? [{ peer, distance }]
          : [];
      });
      return corpusPassOrNotChecked(
        snapshot,
        page,
        peers.map(({ peer, distance }) => ({
          peer,
          details: [
            `content_hash=${peer.extraction?.contentHash ?? "unavailable"}`,
            `similarity_fingerprint=${peer.extraction?.similarityFingerprint ?? "unavailable"}`,
            `fingerprint_distance=${distance}`,
          ],
        })),
        "near_duplicate_urls",
        `${peers.length} near-duplicate indexable peer(s).`,
        coverageIssue,
        `No peer within distance ${policy.nearDuplicateMaximumDistance}.`,
        "medium",
      );
    });
  },
);

const url014 = defineRuleVersion(
  {
    id: "URL-014",
    title: "Query parameters create duplicate versions of a page",
    category: "urls-canonicals",
    defaultSeverity: "medium",
    scope: "page",
    description: "Compares retained query variants on the same host and path by content hash.",
    eligibility:
      "The crawl retained query parameters and observed at least one query URL with a content hash.",
    requiredData: ["crawl", "configuration", "pages", "transport", "raw-extraction", "robots"],
    explanation:
      "Duplicate query variants can create a large indexable URL space for the same content.",
    expectedValue:
      "Different retained query variants do not expose the same indexable content unnecessarily.",
    recommendedFix:
      "Choose a query-parameter policy, link only to the preferred form, remove tracking parameters from canonical URLs, and redirect or canonicalize duplicate variants.",
    verification:
      "Request representative parameter variants and confirm they redirect or canonicalize to one preferred URL.",
    confidence: "high",
    impactAreas: URL_IMPACT,
    responsibleOwner: "developer",
  },
  4,
  (snapshot) => {
    if (snapshot.configuration.queryPolicy !== "keep") {
      return noCandidates(
        snapshot,
        "query-duplicates",
        "The crawl did not retain all query parameters, so duplicate variants cannot be concluded.",
        ["configuration"],
      );
    }
    const coverageIssue = corpusCoverageIssue(snapshot);
    const pages = snapshot.pages.filter((page) => {
      const url = safeUrl(page.normalizedUrl);
      return (
        url !== null &&
        url.search !== "" &&
        isIndexable(page) &&
        page.extraction !== null &&
        page.extraction.contentHash !== null
      );
    });
    if (pages.length === 0) {
      if (coverageIssue !== null) {
        return noCandidates(
          snapshot,
          "query-duplicates",
          coverageIssue.reason,
          coverageIssue.missingData,
        );
      }
      return noCandidates(
        snapshot,
        "query-duplicates",
        "No retained query variant with a content hash was observed.",
        ["pages", "raw-extraction"],
      );
    }
    return pages.map((page) => {
      const url = safeUrl(page.normalizedUrl);
      const peers = snapshot.pages.filter((peer) => {
        const peerUrl = safeUrl(peer.normalizedUrl);
        return (
          peer.id !== page.id &&
          url !== null &&
          peerUrl !== null &&
          url.origin === peerUrl.origin &&
          url.pathname === peerUrl.pathname &&
          url.search !== peerUrl.search &&
          isIndexable(peer) &&
          peer.extraction !== null &&
          peer.extraction.source === "raw" &&
          page.extraction !== null &&
          page.extraction.contentHash === peer.extraction.contentHash
        );
      });
      return corpusPassOrNotChecked(
        snapshot,
        page,
        peers.map((peer) => ({
          peer,
          details: [
            `content_hash=${peer.extraction?.contentHash ?? "unavailable"}`,
            "relationship=query-variant",
          ],
        })),
        "duplicate_query_variants",
        `${peers.length} same-content query variant(s).`,
        coverageIssue,
      );
    });
  },
);

function variationRule(
  id: "URL-015" | "URL-016",
  title: string,
  description: string,
  explanation: string,
  recommendedFix: string,
  comparison: (left: URL, right: URL) => boolean,
): AuditRuleDefinition {
  return defineRuleVersion(
    {
      id,
      title,
      category: "urls-canonicals",
      defaultSeverity: "medium",
      scope: "page",
      description,
      eligibility:
        "An indexable page has a content hash and crawl coverage is conclusive for a pass.",
      requiredData: ["crawl", "pages", "transport", "raw-extraction", "robots"],
      explanation,
      expectedValue: "Only one preferred URL variation serves a given indexable document.",
      recommendedFix,
      verification:
        "Request both URL forms and confirm the alternate permanently redirects to the preferred form.",
      confidence: "high",
      impactAreas: URL_IMPACT,
      responsibleOwner: "developer",
    },
    4,
    (snapshot) => {
      const coverageIssue = corpusCoverageIssue(snapshot);
      const pages = snapshot.pages.filter(
        (page) => isIndexable(page) && page.extraction?.contentHash !== null,
      );
      if (pages.length === 0) {
        if (coverageIssue !== null) {
          return noCandidates(
            snapshot,
            id.toLowerCase(),
            coverageIssue.reason,
            coverageIssue.missingData,
          );
        }
        return noCandidates(
          snapshot,
          id.toLowerCase(),
          "No indexable content hash was available.",
          ["raw-extraction"],
        );
      }
      return pages.map((page) => {
        const url = safeUrl(page.normalizedUrl);
        const peers = pages.filter((peer) => {
          const peerUrl = safeUrl(peer.normalizedUrl);
          return (
            peer.id !== page.id &&
            url !== null &&
            peerUrl !== null &&
            comparison(url, peerUrl) &&
            page.extraction?.contentHash === peer.extraction?.contentHash
          );
        });
        return corpusPassOrNotChecked(
          snapshot,
          page,
          peers.map((peer) => ({
            peer,
            details: [
              `content_hash=${peer.extraction?.contentHash ?? "unavailable"}`,
              `relationship=${id === "URL-015" ? "case-variant" : "trailing-slash-variant"}`,
            ],
          })),
          "duplicate_url_variations",
          `${peers.length} same-content URL variation(s).`,
          coverageIssue,
        );
      });
    },
  );
}

const url015 = variationRule(
  "URL-015",
  "URL case variations create duplicate pages",
  "Detects same-content paths that differ only by letter case.",
  "Case-sensitive URL variants can create duplicate documents and inconsistent linking.",
  "Choose one lowercase path convention, permanently redirect case variants to it, and update internal links, canonicals, and sitemaps.",
  (left, right) =>
    left.origin.toLowerCase() === right.origin.toLowerCase() &&
    left.pathname !== right.pathname &&
    left.pathname.toLowerCase() === right.pathname.toLowerCase() &&
    left.search === right.search,
);
const url016 = variationRule(
  "URL-016",
  "Trailing-slash variations create duplicate pages",
  "Detects same-content paths that differ only by a terminal slash.",
  "Serving both slash variants creates duplicate URLs for the same document.",
  "Choose one trailing-slash convention, permanently redirect the alternate form, and use only the preferred form in links, canonicals, and sitemaps.",
  (left, right) => {
    const trim = (path: string) => path.replace(/\/$/u, "") || "/";
    return (
      left.origin === right.origin &&
      left.pathname !== right.pathname &&
      trim(left.pathname) === trim(right.pathname) &&
      left.search === right.search
    );
  },
);

const url017 = defineRuleVersion(
  {
    id: "URL-017",
    title: "Default-document variants such as /index.html create duplicates",
    category: "urls-canonicals",
    defaultSeverity: "medium",
    scope: "page",
    description: "Compares index.html and index.htm URLs with their directory form.",
    eligibility:
      "A default-document URL and its directory peer are both crawled with content hashes.",
    requiredData: ["pages", "raw-extraction"],
    explanation:
      "Default-document filenames can expose a duplicate URL for the directory resource.",
    expectedValue: "The default-document URL redirects to one preferred directory URL.",
    recommendedFix:
      "Permanently redirect /index.html or /index.htm to the directory URL and update internal links, canonicals, and sitemap entries to the directory form.",
    verification:
      "Request the default-document URL and confirm it permanently redirects to the preferred directory URL.",
    confidence: "high",
    impactAreas: URL_IMPACT,
    responsibleOwner: "developer",
  },
  3,
  (snapshot) => {
    const pages = snapshot.pages.filter((page) =>
      /\/(?:index\.html?)$/iu.test(safeUrl(page.normalizedUrl)?.pathname ?? ""),
    );
    if (pages.length === 0) {
      return noCandidates(snapshot, "default-document", "No default-document URL was observed.", [
        "pages",
      ]);
    }
    return pages.map((page) => {
      const url = safeUrl(page.normalizedUrl);
      const directory = url === null ? null : new URL(url.href);
      if (directory !== null)
        directory.pathname = directory.pathname.replace(/index\.html?$/iu, "");
      const peer = directory === null ? undefined : pagesByUrl(snapshot).get(directory.href);
      const pageHash = page.extraction?.contentHash;
      const peerHash = peer?.extraction?.contentHash;
      if (
        peer === undefined ||
        page.extraction?.source !== "raw" ||
        peer.extraction?.source !== "raw" ||
        pageHash === null ||
        pageHash === undefined ||
        peerHash === null ||
        peerHash === undefined
      ) {
        return notCheckedPage(
          snapshot,
          page,
          "The directory peer and both content hashes were not available.",
          ["pages", "raw-extraction"],
        );
      }
      const failed = pageHash === peerHash;
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [
          boundedPageEvidence(
            page,
            "default_document_source",
            [
              `content_hash=${pageHash}`,
              `directory_peer=${boundedEvidenceUrl(peer.normalizedUrl)}`,
            ],
            "raw",
          ),
          boundedPageEvidence(
            peer,
            "default_document_directory_peer",
            [`content_hash=${peerHash}`, `source_page=${page.id}`],
            "raw",
          ),
        ],
        detectedValue: failed
          ? "The default-document and directory URLs have the same content hash."
          : "The observed directory peer contains different content.",
      });
    });
  },
);

const url018 = defineRule(
  {
    id: "URL-018",
    title: "URL exceeds the configured readability or length threshold",
    category: "urls-canonicals",
    defaultSeverity: "low",
    scope: "page",
    description: "Measures the normalized URL against a versioned readability threshold.",
    eligibility: "A normalized page URL is available.",
    requiredData: ["pages", "configuration"],
    explanation:
      "Very long URLs are difficult to read, share, audit, and maintain even when technically valid.",
    expectedValue: "The normalized URL does not exceed the versioned readability threshold.",
    recommendedFix:
      "Replace the URL with a shorter stable descriptive path, preserve essential identifiers only, permanently redirect the old URL, and update links, canonicals, and sitemaps.",
    verification:
      "Measure the preferred normalized URL and confirm it is at or below the configured threshold.",
    confidence: "high",
    impactAreas: [...URL_IMPACT, "user-experience"],
    responsibleOwner: "developer",
  },
  (snapshot, policy) => {
    if (snapshot.pages.length === 0) {
      return noCandidates(snapshot, "url-length", "No normalized page URL was available.", [
        "pages",
      ]);
    }
    return snapshot.pages.map((page) =>
      checkedOutcome({
        target: pageTarget(page),
        failed: page.normalizedUrl.length > policy.urlLengthThreshold,
        evidence: [pageEvidence(page, "normalized_url_length", page.normalizedUrl.length)],
        detectedValue: `${page.normalizedUrl.length} character(s).`,
        expectedValue: `At most ${policy.urlLengthThreshold} character(s).`,
      }),
    );
  },
);

function unsafeUrlReason(value: string): string | null {
  if (
    /\s/u.test(value) ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  ) {
    return "literal whitespace or control character";
  }
  if (/%(?![0-9a-f]{2})/iu.test(value)) return "malformed percent escape";
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(value)) return "percent-encoded control character";
  const parsed = safeUrl(value);
  if (parsed === null) return "malformed absolute URL";
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "unsupported protocol";
  if (parsed.username !== "" || parsed.password !== "") return "embedded credentials";
  return null;
}

const url019 = defineRule(
  {
    id: "URL-019",
    title: "URL contains unsafe, malformed, or improperly encoded characters",
    category: "urls-canonicals",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Validates the preserved requested URL for malformed escapes, controls, credentials, and protocol.",
    eligibility: "A requested page URL is available.",
    requiredData: ["pages"],
    explanation:
      "Malformed or unsafe URL characters can produce inconsistent parsing, broken links, or security-sensitive ambiguity.",
    expectedValue:
      "The URL is valid HTTP(S), credential-free, UTF-8 safe, and uses complete percent escapes.",
    recommendedFix:
      "Generate URLs from validated components, encode UTF-8 bytes with complete percent triplets, remove controls and credentials, and redirect malformed legacy forms to one normalized URL.",
    verification:
      "Parse and decode the URL with a standards-based URL implementation and confirm no unsafe or malformed sequence remains.",
    confidence: "high",
    impactAreas: [...URL_IMPACT, "security", "user-experience"],
    responsibleOwner: "developer",
  },
  (snapshot) => {
    if (snapshot.pages.length === 0) {
      return noCandidates(snapshot, "unsafe-url", "No requested page URL was available.", [
        "pages",
      ]);
    }
    return snapshot.pages.map((page) => {
      const reason = unsafeUrlReason(page.requestedUrl);
      return checkedOutcome({
        target: pageTarget(page),
        failed: reason !== null,
        evidence: [pageEvidence(page, "requested_url_validation", reason ?? "valid")],
        detectedValue:
          reason === null
            ? "The requested URL is valid and safely encoded."
            : `Detected ${reason}.`,
      });
    });
  },
);

function paginationEvidence(page: AuditPageObservation): Readonly<{
  pageNumber: number;
  firstUrls: readonly string[];
  source: string;
}> | null {
  const url = safeUrl(page.normalizedUrl);
  if (url === null) return null;
  for (const parameter of ["page", "p", "paged"] as const) {
    const raw = url.searchParams.get(parameter);
    if (raw !== null && /^\d+$/u.test(raw) && Number(raw) > 1) {
      const removed = new URL(url.href);
      removed.searchParams.delete(parameter);
      const pageOne = new URL(url.href);
      pageOne.searchParams.set(parameter, "1");
      return Object.freeze({
        pageNumber: Number(raw),
        firstUrls: Object.freeze([removed.href, pageOne.href]),
        source: `query parameter ${parameter}`,
      });
    }
  }
  const match = /\/page\/(\d+)\/?$/iu.exec(url.pathname);
  if (match !== null && Number(match[1]) > 1) {
    const first = new URL(url.href);
    first.pathname = first.pathname.replace(/\/page\/\d+\/?$/iu, "/");
    return Object.freeze({
      pageNumber: Number(match[1]),
      firstUrls: Object.freeze([first.href]),
      source: "path segment /page/N",
    });
  }
  return null;
}

const url020 = defineRule(
  {
    id: "URL-020",
    title: "Paginated page is incorrectly canonicalized to the first page",
    category: "urls-canonicals",
    defaultSeverity: "high",
    scope: "page",
    description:
      "Uses versioned query/path pagination patterns to compare a later page's canonical.",
    eligibility:
      "A page number greater than one and one normalized canonical are deterministically observed.",
    requiredData: ["pages", "raw-extraction", "links"],
    explanation:
      "Canonicalizing every paginated page to page one can hide distinct items that appear only on later pages.",
    expectedValue:
      "Each materially distinct paginated page self-canonicalizes to its own preferred URL.",
    recommendedFix:
      "Set each paginated page's canonical to its own normalized URL, keep the sequence crawlable, and use direct pagination links instead of canonicalizing all pages to page one.",
    verification:
      "Inspect page two and later pages and confirm each canonical identifies that page rather than the inferred first page.",
    confidence: "high",
    impactAreas: URL_IMPACT,
    responsibleOwner: "seo",
  },
  (snapshot) => {
    const pages = snapshot.pages.filter((page) => paginationEvidence(page) !== null);
    if (pages.length === 0) {
      return noCandidates(
        snapshot,
        "pagination-canonical",
        "No reliable page-number signal greater than one was observed.",
        ["pages", "links"],
      );
    }
    return pages.map((page) => {
      const pagination = paginationEvidence(page);
      const canonical = page.extraction?.canonicalUrl ?? null;
      if (
        pagination === null ||
        page.extraction?.source !== "raw" ||
        page.extraction.canonicalTagCount !== 1 ||
        canonical === null
      ) {
        return notCheckedPage(
          snapshot,
          page,
          "The paginated page did not have one normalized canonical.",
          ["raw-extraction"],
        );
      }
      const failed = pagination.firstUrls.includes(canonical);
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [pageEvidence(page, "pagination_canonical", canonical, "raw")],
        detectedValue: `Page ${pagination.pageNumber} from ${pagination.source}; canonical ${canonical}.`,
      });
    });
  },
);

export const URL_RULES: readonly AuditRuleDefinition[] = Object.freeze([
  url001,
  url002,
  url003,
  url004,
  url005,
  url006,
  url007,
  url008,
  url009,
  url010,
  url011,
  url012,
  url013,
  url014,
  url015,
  url016,
  url017,
  url018,
  url019,
  url020,
]);
