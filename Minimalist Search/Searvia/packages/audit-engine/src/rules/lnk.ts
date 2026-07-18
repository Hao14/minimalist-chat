import type { AuditEvidenceItem } from "@searvia/shared-types";

import type { AuditObservationKey, AuditRuleDefinition, AuditRuleOutcome } from "../contracts.js";
import type { AuditCrawlSnapshot, AuditPageLink, AuditPageObservation } from "../snapshot.js";
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
  hasNoindex,
  isHtmlContentType,
  isSuccessful,
  maskedUrlForEvidence,
  notCheckedOutcome,
  pageIndexabilityMissingData,
  pageEvidence,
  pageTarget,
  pageUnavailable,
  requestedPageIndexabilityState,
  safeUrl,
} from "./helpers.js";

const LINK_IMPACTS = ["crawlability", "search-visibility", "user-experience"] as const;
const ARCHITECTURE_IMPACTS = [
  "crawlability",
  "indexability",
  "search-visibility",
  "ai-retrievability",
  "user-experience",
] as const;
const NAVIGATION_LINK_TYPES = new Set<AuditPageLink["linkType"]>(["anchor", "area", "pagination"]);
const GENERIC_ANCHOR_TEXT = new Set([
  "click",
  "click here",
  "continue",
  "go",
  "here",
  "learn more",
  "more",
  "read more",
  "this",
  "view",
  "visit",
]);

interface GraphCoverageIssue {
  readonly reason: string;
  readonly missingData: readonly AuditObservationKey[];
}

function navigationLinks(page: AuditPageObservation): readonly AuditPageLink[] {
  return page.links.filter((link) => NAVIGATION_LINK_TYPES.has(link.linkType));
}

function linkEvidence(
  source: AuditPageObservation,
  link: AuditPageLink,
  field: string,
  value: string | number | boolean | null | readonly (string | number | boolean | null)[],
): AuditEvidenceItem {
  const boundedValue = Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? boundedEvidenceText(item, 512) : item))
    : typeof value === "string"
      ? boundedEvidenceText(value, 512)
      : value;
  return evidence({
    kind: "link",
    source: "graph",
    observationId: link.id,
    observedAt: source.extraction?.extractedAt ?? source.observedAt,
    field,
    value: boundedValue,
    url: boundedEvidenceUrl(source.normalizedUrl, 512),
  });
}

function pageCoverageIssue(page: AuditPageObservation): GraphCoverageIssue | null {
  if (page.statusCode === null || (isSuccessful(page) && page.contentType === null)) {
    return {
      reason: "The page transport or content type is unavailable.",
      missingData: ["transport"],
    };
  }
  if (!isSuccessful(page) || !isHtmlContentType(page.contentType)) return null;
  if (page.extraction === null || page.extraction.source !== "raw") {
    return {
      reason: "Raw HTML link extraction is unavailable for this page.",
      missingData: ["raw-extraction"],
    };
  }
  return null;
}

function graphCoverageIssue(snapshot: AuditCrawlSnapshot): GraphCoverageIssue | null {
  if (snapshot.status !== "completed") {
    return {
      reason: "The crawl was only partially completed, so link-graph absence is inconclusive.",
      missingData: ["crawl"],
    };
  }
  for (const page of snapshot.pages) {
    const issue = pageCoverageIssue(page);
    if (issue !== null) return issue;
    if (
      isSuccessful(page) &&
      isHtmlContentType(page.contentType) &&
      page.extraction?.source === "raw" &&
      page.extraction.clientRendered
    ) {
      return {
        reason: `The raw extraction identifies ${boundedEvidenceUrl(page.normalizedUrl, 512)} as client-rendered, but rendered link-graph observations are unavailable.`,
        missingData: ["links"],
      };
    }
    if (
      isSuccessful(page) &&
      isHtmlContentType(page.contentType) &&
      page.extraction?.source === "raw" &&
      !page.extraction.linksComplete
    ) {
      return {
        reason: `The persisted link collection for ${boundedEvidenceUrl(page.normalizedUrl, 512)} was truncated.`,
        missingData: ["links"],
      };
    }
  }
  return null;
}

function graphCoverageEvidence(snapshot: AuditCrawlSnapshot): AuditEvidenceItem {
  const successfulHtmlSources = snapshot.pages.filter(
    (page) => isSuccessful(page) && isHtmlContentType(page.contentType),
  );
  const completeLinkSources = successfulHtmlSources.filter(
    (page) =>
      page.extraction?.source === "raw" &&
      !page.extraction.clientRendered &&
      page.extraction.linksComplete,
  );
  return crawlEvidence(snapshot, "link_graph_coverage", [
    `crawl_status=${snapshot.status}`,
    `total_pages=${snapshot.pages.length}`,
    `successful_html_sources=${successfulHtmlSources.length}`,
    `complete_link_sources=${completeLinkSources.length}`,
  ]);
}

function indexabilityEvidence(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
): readonly AuditEvidenceItem[] {
  const extraction = page.extraction;
  const robots = snapshot.robots.find((observation) => observation.id === page.robotsObservationId);
  const robotsEvidence =
    robots === undefined
      ? pageEvidence(
          page,
          "indexability_robots",
          [
            page.robotsDecision,
            `observation_id=${page.robotsObservationId ?? "unavailable"}`,
            `result=${page.robotsResult ?? "unavailable"}`,
          ],
          "robots",
        )
      : evidence({
          kind: "robots",
          source: "robots",
          observationId: robots.id,
          observedAt: robots.fetchedAt,
          field: "indexability_robots",
          value: [page.robotsDecision, `result=${robots.result}`],
          url: boundedEvidenceUrl(robots.requestedUrl, 512),
        });
  return [
    pageEvidence(
      page,
      "indexability_transport",
      [page.statusCode ?? "unavailable", page.contentType ?? "unavailable"],
      "transport",
    ),
    robotsEvidence,
    pageEvidence(
      page,
      "indexability_directives",
      [
        `scope_preserved=${extraction?.directiveScopePreserved ?? false}`,
        `meta_noindex=${hasNoindex(extraction?.metaRobots ?? [])}`,
        `x_robots_noindex=${hasNoindex(extraction?.xRobotsTag ?? [])}`,
      ],
      "raw",
    ),
  ];
}

function pageNotChecked(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
  reason: string,
  missingData: readonly AuditObservationKey[],
  evidenceItems: readonly AuditEvidenceItem[] = [
    pageEvidence(page, "link_rule_eligibility", [
      page.statusCode ?? "unavailable",
      page.contentType ?? "unavailable",
      page.extraction?.source ?? "unavailable",
      page.extraction?.linksComplete ?? false,
    ]),
  ],
): AuditRuleOutcome {
  return notCheckedOutcome({
    target: pageTarget(page),
    snapshot,
    reason,
    missingData,
    evidence: evidenceItems,
  });
}

function coveredHtmlPages(snapshot: AuditCrawlSnapshot): readonly AuditPageObservation[] {
  return snapshot.pages.filter(
    (page) =>
      page.statusCode === null ||
      (isSuccessful(page) && (page.contentType === null || isHtmlContentType(page.contentType))),
  );
}

function ensureCoverage(
  snapshot: AuditCrawlSnapshot,
  key: string,
  outcomes: readonly AuditRuleOutcome[],
): readonly AuditRuleOutcome[] {
  return outcomes.length > 0
    ? outcomes
    : pageUnavailable(snapshot, key, "No eligible HTML page was available for this link check.", [
        "pages",
      ]);
}

function pagesById(snapshot: AuditCrawlSnapshot): ReadonlyMap<string, AuditPageObservation | null> {
  const result = new Map<string, AuditPageObservation | null>();
  for (const page of snapshot.pages) {
    result.set(page.id, result.has(page.id) ? null : page);
  }
  return result;
}

function pagesByUrl(
  snapshot: AuditCrawlSnapshot,
): ReadonlyMap<string, AuditPageObservation | null> {
  const result = new Map<string, AuditPageObservation | null>();
  for (const page of snapshot.pages) {
    result.set(page.normalizedUrl, result.has(page.normalizedUrl) ? null : page);
  }
  return result;
}

function resolveLinkTarget(
  link: AuditPageLink,
  byId: ReadonlyMap<string, AuditPageObservation | null>,
  byUrl: ReadonlyMap<string, AuditPageObservation | null>,
): AuditPageObservation | null {
  if (link.targetPageId !== null) return byId.get(link.targetPageId) ?? null;
  return byUrl.get(link.normalizedTargetUrl) ?? null;
}

interface InboundNavigationSummary {
  readonly count: number;
  readonly distinctSourceCount: number;
  readonly samples: readonly Readonly<{
    source: AuditPageObservation;
    link: AuditPageLink;
  }>[];
}

const EMPTY_INBOUND_SUMMARY: InboundNavigationSummary = Object.freeze({
  count: 0,
  distinctSourceCount: 0,
  samples: Object.freeze([]),
});

/** Builds one linear graph index per detector and retains at most 12 evidence edges per target. */
function buildInboundNavigationIndex(
  snapshot: AuditCrawlSnapshot,
): ReadonlyMap<string, InboundNavigationSummary> {
  const byId = pagesById(snapshot);
  const byUrl = pagesByUrl(snapshot);
  const mutable = new Map<
    string,
    {
      count: number;
      readonly sourceIds: Set<string>;
      readonly samples: Array<{ source: AuditPageObservation; link: AuditPageLink }>;
    }
  >();
  for (const source of snapshot.pages) {
    for (const link of navigationLinks(source)) {
      if (link.scope !== "internal") continue;
      const target = resolveLinkTarget(link, byId, byUrl);
      if (target === null || target.id === source.id) continue;
      const summary = mutable.get(target.id) ?? {
        count: 0,
        sourceIds: new Set<string>(),
        samples: [],
      };
      summary.count += 1;
      summary.sourceIds.add(source.id);
      if (summary.samples.length < 12) summary.samples.push({ source, link });
      mutable.set(target.id, summary);
    }
  }
  return new Map(
    [...mutable.entries()].map(([targetId, summary]) => [
      targetId,
      Object.freeze({
        count: summary.count,
        distinctSourceCount: summary.sourceIds.size,
        samples: Object.freeze(summary.samples.map((sample) => Object.freeze(sample))),
      }),
    ]),
  );
}

function transportLinkRule(
  statusFamily: 4 | 5,
  metadata: Parameters<typeof defineM5Rule>[0],
): AuditRuleDefinition {
  return defineM5Rule(metadata, (snapshot) => {
    const byId = pagesById(snapshot);
    const byUrl = pagesByUrl(snapshot);
    const outcomes = coveredHtmlPages(snapshot).map((source) => {
      const coverage = pageCoverageIssue(source);
      if (coverage !== null) {
        return pageNotChecked(snapshot, source, coverage.reason, coverage.missingData);
      }
      const candidates = navigationLinks(source).filter((link) => link.scope === "internal");
      const matches: Array<{ link: AuditPageLink; target: AuditPageObservation }> = [];
      let unavailable = false;
      for (const link of candidates) {
        const target = resolveLinkTarget(link, byId, byUrl);
        if (target === null || target.statusCode === null) {
          unavailable = true;
          continue;
        }
        if (Math.floor(target.statusCode / 100) === statusFamily) matches.push({ link, target });
      }
      if (matches.length > 0) {
        const evidenceItems = matches
          .slice(0, 12)
          .flatMap(({ link, target }) => [
            linkEvidence(source, link, `internal_link_${statusFamily}xx`, [
              maskedUrlForEvidence(link.normalizedTargetUrl),
              target.statusCode,
            ]),
            pageEvidence(target, "target_status_code", target.statusCode),
          ]);
        return checkedOutcome({
          target: pageTarget(source),
          failed: true,
          evidence: evidenceItems,
          detectedValue: `${matches.length} internal link${matches.length === 1 ? "" : "s"} on this page resolved to ${statusFamily}xx responses.`,
        });
      }
      if (unavailable || !source.extraction!.linksComplete) {
        return pageNotChecked(
          snapshot,
          source,
          unavailable
            ? "At least one internal link target was not observed, so the transport check is incomplete."
            : "The persisted link collection was truncated.",
          [unavailable ? "transport" : "links"],
          [pageEvidence(source, "internal_link_target_coverage", [candidates.length, unavailable])],
        );
      }
      return checkedOutcome({
        target: pageTarget(source),
        failed: false,
        evidence: [pageEvidence(source, "checked_internal_link_count", candidates.length, "graph")],
        detectedValue: `Checked ${candidates.length} internal navigation links; none resolved to a ${statusFamily}xx response.`,
      });
    });
    return ensureCoverage(snapshot, metadata.id.toLowerCase(), outcomes);
  });
}

const lnk001 = transportLinkRule(4, {
  id: "LNK-001",
  title: "Internal link returns a 4xx response",
  category: "links-architecture",
  defaultSeverity: "high",
  scope: "page",
  description: "Checks observed internal navigation targets for client-error responses.",
  eligibility: "The source link and target transport response were persisted.",
  requiredData: ["pages", "transport", "raw-extraction", "links"],
  explanation: "A broken internal link blocks users and crawlers from reaching the intended page.",
  expectedValue: "Every internal navigation link resolves to a non-4xx destination.",
  recommendedFix:
    "Update each listed source link to a successful destination, restore the missing page, or remove the link.",
  verification:
    "Fetch every listed target from its source page and confirm no response is in the 400-499 range.",
  confidence: "high",
  impactAreas: LINK_IMPACTS,
  responsibleOwner: "developer",
});

const lnk002 = transportLinkRule(5, {
  id: "LNK-002",
  title: "Internal link returns a 5xx response",
  category: "links-architecture",
  defaultSeverity: "high",
  scope: "page",
  description: "Checks observed internal navigation targets for server-error responses.",
  eligibility: "The source link and target transport response were persisted.",
  requiredData: ["pages", "transport", "raw-extraction", "links"],
  explanation:
    "An internal link to a server error makes navigation unreliable for users and crawlers.",
  expectedValue: "Every internal navigation link resolves to a non-5xx destination.",
  recommendedFix:
    "Repair the listed destination or update the source link to a stable successful URL.",
  verification:
    "Fetch every listed target from its source page and confirm no response is in the 500-599 range.",
  confidence: "high",
  impactAreas: LINK_IMPACTS,
  responsibleOwner: "developer",
});

const lnk003 = defineM5Rule(
  {
    id: "LNK-003",
    title: "Internal link points through a redirect",
    category: "links-architecture",
    defaultSeverity: "medium",
    scope: "page",
    description: "Finds internal navigation links whose requested target redirects.",
    eligibility: "The source link and exact requested target transport record were persisted.",
    requiredData: ["pages", "transport", "redirects", "raw-extraction", "links"],
    explanation:
      "Redirecting internal links add avoidable requests and preserve stale destination references.",
    expectedValue: "Internal navigation links point directly to their final successful URLs.",
    recommendedFix:
      "Replace each listed href with the recorded final URL after confirming it is the intended canonical destination.",
    verification:
      "Re-crawl the source page and confirm each internal link has an empty redirect chain.",
    confidence: "high",
    impactAreas: LINK_IMPACTS,
    responsibleOwner: "developer",
  },
  (snapshot) => {
    const byId = pagesById(snapshot);
    const byUrl = pagesByUrl(snapshot);
    const outcomes = coveredHtmlPages(snapshot).map((source) => {
      const coverage = pageCoverageIssue(source);
      if (coverage !== null)
        return pageNotChecked(snapshot, source, coverage.reason, coverage.missingData);
      const candidates = navigationLinks(source).filter((link) => link.scope === "internal");
      const redirected: Array<{ link: AuditPageLink; target: AuditPageObservation }> = [];
      let unavailable = false;
      for (const link of candidates) {
        const target = resolveLinkTarget(link, byId, byUrl);
        if (target === null || target.statusCode === null) {
          unavailable = true;
        } else if (target.redirectChain.length > 0) {
          redirected.push({ link, target });
        }
      }
      if (redirected.length > 0) {
        return checkedOutcome({
          target: pageTarget(source),
          failed: true,
          evidence: redirected
            .slice(0, 12)
            .flatMap(({ link, target }) => [
              linkEvidence(source, link, "redirecting_internal_link", [
                maskedUrlForEvidence(link.normalizedTargetUrl),
                target.redirectChain.length,
                maskedUrlForEvidence(target.finalUrl ?? target.normalizedUrl),
              ]),
              pageEvidence(target, "redirect_hop_count", target.redirectChain.length),
            ]),
          detectedValue: `${redirected.length} internal link${redirected.length === 1 ? "" : "s"} point through a redirect.`,
        });
      }
      if (unavailable || !source.extraction!.linksComplete) {
        return pageNotChecked(
          snapshot,
          source,
          unavailable
            ? "At least one internal link target was not observed."
            : "The persisted link collection was truncated.",
          [unavailable ? "transport" : "links"],
        );
      }
      return checkedOutcome({
        target: pageTarget(source),
        failed: false,
        evidence: [pageEvidence(source, "checked_internal_link_count", candidates.length, "graph")],
        detectedValue: `Checked ${candidates.length} internal navigation links; none used a redirect.`,
      });
    });
    return ensureCoverage(snapshot, "lnk-003", outcomes);
  },
);

const lnk004 = defineM5RuleVersion(
  {
    id: "LNK-004",
    title: "External link is broken",
    category: "links-architecture",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Checks external navigation links only when their destination transport was observed.",
    eligibility: "The external destination has an exact persisted transport response.",
    requiredData: ["pages", "transport", "raw-extraction", "links"],
    explanation:
      "Broken outbound references frustrate users and weaken the value of cited supporting sources.",
    expectedValue:
      "Observed external navigation targets return a successful or intentional redirect response.",
    recommendedFix:
      "Replace, repair, or remove each listed external link after verifying the intended source.",
    verification:
      "Fetch the listed external destinations and confirm they no longer return an error.",
    confidence: "high",
    impactAreas: ["user-experience", "search-visibility"],
    responsibleOwner: "content",
  },
  2,
  (snapshot) => {
    const byId = pagesById(snapshot);
    const byUrl = pagesByUrl(snapshot);
    const outcomes = coveredHtmlPages(snapshot).map((source) => {
      const coverage = pageCoverageIssue(source);
      if (coverage !== null)
        return pageNotChecked(snapshot, source, coverage.reason, coverage.missingData);
      const candidates = navigationLinks(source).filter((link) => link.scope === "external");
      const broken: Array<{ link: AuditPageLink; target: AuditPageObservation }> = [];
      let unavailable = false;
      for (const link of candidates) {
        const target = resolveLinkTarget(link, byId, byUrl);
        if (target === null) unavailable = true;
        else if (
          target.errorType !== null ||
          (target.statusCode !== null && target.statusCode >= 400)
        )
          broken.push({ link, target });
        else if (target.statusCode === null) unavailable = true;
      }
      if (broken.length > 0) {
        return checkedOutcome({
          target: pageTarget(source),
          failed: true,
          evidence: broken
            .slice(0, 12)
            .flatMap(({ link, target }) => [
              linkEvidence(source, link, "broken_external_link", [
                maskedUrlForEvidence(link.normalizedTargetUrl),
                target.statusCode ?? "unavailable",
                target.errorType ?? "none",
              ]),
              pageEvidence(target, "external_target_transport", [
                target.statusCode ?? "unavailable",
                target.errorType ?? "none",
              ]),
            ]),
          detectedValue: `${broken.length} observed external destination${broken.length === 1 ? " is" : "s are"} broken.`,
        });
      }
      if (candidates.length > 0 && unavailable) {
        return pageNotChecked(
          snapshot,
          source,
          "External destinations are not fetched by the site crawl, so their availability is not known.",
          ["transport"],
          candidates
            .slice(0, 12)
            .map((link) =>
              linkEvidence(
                source,
                link,
                "unchecked_external_link",
                maskedUrlForEvidence(link.normalizedTargetUrl),
              ),
            ),
        );
      }
      if (!source.extraction!.linksComplete) {
        return pageNotChecked(snapshot, source, "The persisted link collection was truncated.", [
          "links",
        ]);
      }
      return checkedOutcome({
        target: pageTarget(source),
        failed: false,
        evidence: [
          pageEvidence(source, "observed_external_link_count", candidates.length, "graph"),
        ],
        detectedValue: `All ${candidates.length} observed external link targets were available.`,
      });
    });
    return ensureCoverage(snapshot, "lnk-004", outcomes);
  },
);

const lnk005 = defineM5RuleVersion(
  {
    id: "LNK-005",
    title: "Internal HTTPS page links to an HTTP URL",
    category: "links-architecture",
    defaultSeverity: "medium",
    scope: "page",
    description: "Finds insecure HTTP destinations in internal links on HTTPS pages.",
    eligibility: "The source is HTTPS and its raw link collection is available.",
    requiredData: ["pages", "transport", "raw-extraction", "links"],
    explanation:
      "Downgrade links can expose navigation to interception and create unnecessary redirects or mixed security expectations.",
    expectedValue: "Every internal link on an HTTPS page uses an HTTPS URL.",
    recommendedFix: "Change each listed internal href to the verified HTTPS destination.",
    verification:
      "Inspect the page source and confirm no internal navigation href uses the http scheme.",
    confidence: "high",
    impactAreas: ["security", "user-experience", "search-visibility"],
    responsibleOwner: "developer",
  },
  2,
  (snapshot) => {
    const outcomes = coveredHtmlPages(snapshot).flatMap((source) => {
      const sourceUrl = safeUrl(source.finalUrl ?? source.normalizedUrl);
      if (sourceUrl?.protocol !== "https:") return [];
      const coverage = pageCoverageIssue(source);
      if (coverage !== null)
        return [pageNotChecked(snapshot, source, coverage.reason, coverage.missingData)];
      const insecure = navigationLinks(source).filter((link) => {
        const target = safeUrl(link.targetUrl);
        return link.scope === "internal" && target?.protocol === "http:";
      });
      const sourceSchemeEvidence = pageEvidence(
        source,
        "source_final_url",
        boundedEvidenceUrl(source.finalUrl ?? source.normalizedUrl, 512),
        "transport",
      );
      if (insecure.length > 0) {
        return [
          checkedOutcome({
            target: pageTarget(source),
            failed: true,
            evidence: [
              sourceSchemeEvidence,
              ...insecure
                .slice(0, 24)
                .map((link) =>
                  linkEvidence(
                    source,
                    link,
                    "insecure_internal_link",
                    maskedUrlForEvidence(link.targetUrl),
                  ),
                ),
            ],
            detectedValue: `${insecure.length} internal link${insecure.length === 1 ? "" : "s"} use HTTP on this HTTPS page.`,
          }),
        ];
      }
      if (!source.extraction!.linksComplete) {
        return [
          pageNotChecked(snapshot, source, "The persisted link collection was truncated.", [
            "links",
          ]),
        ];
      }
      return [
        checkedOutcome({
          target: pageTarget(source),
          failed: false,
          evidence: [
            sourceSchemeEvidence,
            pageEvidence(
              source,
              "checked_internal_link_count",
              navigationLinks(source).length,
              "graph",
            ),
          ],
          detectedValue: "No internal navigation link uses HTTP.",
        }),
      ];
    });
    return ensureCoverage(snapshot, "lnk-005", outcomes);
  },
);

const lnk006 = defineM5Rule(
  {
    id: "LNK-006",
    title: "Internal link points to a noncanonical URL",
    category: "links-architecture",
    defaultSeverity: "medium",
    scope: "page",
    description: "Finds internal links to pages that declare a different canonical URL.",
    eligibility: "The source link and target raw canonical extraction were persisted.",
    requiredData: ["pages", "transport", "raw-extraction", "links"],
    explanation:
      "Linking to a noncanonical variant wastes crawl requests and divides internal-link signals.",
    expectedValue: "Internal links point directly to the target page's declared canonical URL.",
    recommendedFix:
      "Replace each listed href with the target's declared canonical URL after verifying that canonical is intentional.",
    verification:
      "Re-crawl the source and confirm every internal link target is self-canonical or has no conflicting canonical.",
    confidence: "high",
    impactAreas: ARCHITECTURE_IMPACTS,
    responsibleOwner: "seo",
  },
  (snapshot) => {
    const byId = pagesById(snapshot);
    const byUrl = pagesByUrl(snapshot);
    const outcomes = coveredHtmlPages(snapshot).map((source) => {
      const coverage = pageCoverageIssue(source);
      if (coverage !== null)
        return pageNotChecked(snapshot, source, coverage.reason, coverage.missingData);
      const candidates = navigationLinks(source).filter((link) => link.scope === "internal");
      const noncanonical: Array<{
        link: AuditPageLink;
        target: AuditPageObservation;
        canonical: string;
      }> = [];
      const unavailableData = new Set<AuditObservationKey>();
      const unavailableEvidence: AuditEvidenceItem[] = [];
      for (const link of candidates) {
        const target = resolveLinkTarget(link, byId, byUrl);
        if (target === null || target.statusCode === null) {
          unavailableData.add("transport");
          continue;
        }
        if (target.extraction?.source !== "raw") {
          unavailableData.add("raw-extraction");
          continue;
        }
        const extraction = target.extraction;
        if (!extraction.documentMetadataComplete) {
          unavailableData.add("raw-extraction");
          if (unavailableEvidence.length < 12) {
            unavailableEvidence.push(
              pageEvidence(target, "canonical_metadata_complete", false, "raw"),
            );
          }
          continue;
        }
        const canonical = extraction.canonicalUrl;
        const noDeclaration =
          extraction.canonicalTagCount === 0 &&
          canonical === null &&
          extraction.canonicalNormalizationFailure === null;
        if (noDeclaration) continue;

        const oneResolvedDeclaration =
          extraction.canonicalTagCount === 1 &&
          canonical !== null &&
          extraction.canonicalNormalizationFailure === null;
        if (!oneResolvedDeclaration) {
          unavailableData.add("raw-extraction");
          if (unavailableEvidence.length < 12) {
            unavailableEvidence.push(
              pageEvidence(
                target,
                "canonical_target_coverage",
                [
                  extraction.canonicalTagCount,
                  canonical === null ? "unresolved" : "resolved",
                  extraction.canonicalNormalizationFailure?.code ?? "none",
                ],
                "raw",
              ),
            );
          }
          continue;
        }
        if (canonical !== target.normalizedUrl) noncanonical.push({ link, target, canonical });
      }
      if (noncanonical.length > 0) {
        return checkedOutcome({
          target: pageTarget(source),
          failed: true,
          evidence: noncanonical
            .slice(0, 12)
            .flatMap(({ link, target, canonical }) => [
              linkEvidence(source, link, "noncanonical_internal_link", [
                maskedUrlForEvidence(link.normalizedTargetUrl),
                maskedUrlForEvidence(canonical),
              ]),
              pageEvidence(target, "declared_canonical", maskedUrlForEvidence(canonical), "raw"),
            ]),
          detectedValue: `${noncanonical.length} internal link${noncanonical.length === 1 ? "" : "s"} point to a URL canonicalized elsewhere.`,
        });
      }
      if (unavailableData.size > 0 || !source.extraction!.linksComplete) {
        if (!source.extraction!.linksComplete) unavailableData.add("links");
        return pageNotChecked(
          snapshot,
          source,
          "At least one internal target lacks transport or an unambiguous canonical declaration, or the source link collection was truncated.",
          [...unavailableData],
          [
            pageEvidence(source, "checked_internal_link_count", candidates.length, "graph"),
            ...unavailableEvidence,
          ],
        );
      }
      return checkedOutcome({
        target: pageTarget(source),
        failed: false,
        evidence: [pageEvidence(source, "checked_internal_link_count", candidates.length, "graph")],
        detectedValue: `Checked ${candidates.length} internal links; none point to a declared noncanonical URL.`,
      });
    });
    return ensureCoverage(snapshot, "lnk-006", outcomes);
  },
);

const lnk007 = defineM5Rule(
  {
    id: "LNK-007",
    title: "Link has an empty or malformed href",
    category: "links-architecture",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Reports coverage as unavailable because raw invalid-href observations are not persisted.",
    eligibility:
      "A supported parser error observation identifies an empty or malformed href; Phase 1 does not persist that observation.",
    requiredData: ["pages", "transport", "raw-extraction", "links"],
    explanation: "Empty and malformed href values do not provide a reliable crawlable destination.",
    expectedValue:
      "Every navigation element has a non-empty syntactically valid href appropriate to its action, including valid mailto or tel contact links.",
    recommendedFix:
      "Replace each confirmed empty or malformed href with a valid destination; preserve valid mailto or tel contact actions, and use a button for non-navigation behavior.",
    verification:
      "Inspect the listed source element and validate its href; confirm the next crawl retains no malformed-href observation.",
    confidence: "high",
    impactAreas: LINK_IMPACTS,
    responsibleOwner: "developer",
  },
  (snapshot) => {
    const outcomes = coveredHtmlPages(snapshot).map((source) => {
      const coverage = pageCoverageIssue(source);
      if (coverage !== null)
        return pageNotChecked(snapshot, source, coverage.reason, coverage.missingData);
      return pageNotChecked(
        snapshot,
        source,
        "The extraction persistence model omits invalid href parser errors and valid non-HTTP navigation schemes cannot be classified as malformed, so this check is unavailable.",
        ["raw-extraction"],
        [
          pageEvidence(
            source,
            "persisted_navigation_link_count",
            navigationLinks(source).length,
            "graph",
          ),
        ],
      );
    });
    return ensureCoverage(snapshot, "lnk-007", outcomes);
  },
);

const lnk008 = defineM5Rule(
  {
    id: "LNK-008",
    title: "Essential navigation depends on JavaScript event handlers instead of links",
    category: "links-architecture",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Requires review of navigation implemented through event handlers rather than crawlable links.",
    eligibility:
      "DOM event-handler and navigation-role observations are available; Phase 1 does not persist them.",
    requiredData: ["pages", "raw-extraction", "rendered-extraction", "links"],
    explanation:
      "Event-handler-only navigation can be unavailable to crawlers, keyboards, and users when scripts fail.",
    expectedValue:
      "Essential destinations are represented by crawlable anchor href values with usable accessible names.",
    recommendedFix:
      "Implement each essential destination as a normal anchor with an HTTP(S) href; enhance it with JavaScript only after the link works without scripts.",
    verification:
      "Disable JavaScript and use keyboard navigation to confirm that every essential destination remains reachable through an anchor.",
    confidence: "low",
    impactAreas: ARCHITECTURE_IMPACTS,
    responsibleOwner: "developer",
  },
  (snapshot) => {
    const outcomes = coveredHtmlPages(snapshot).map((page) =>
      pageNotChecked(
        snapshot,
        page,
        "Phase 1 does not persist DOM event handlers or identify which controls are essential navigation, so automated certainty is unavailable.",
        ["raw-extraction", "rendered-extraction"],
        [pageEvidence(page, "event_handler_navigation_observation", "not_collected")],
      ),
    );
    return ensureCoverage(snapshot, "lnk-008", outcomes);
  },
);

const lnk009 = defineM5Rule(
  {
    id: "LNK-009",
    title: "Placeholder hash link is present",
    category: "links-architecture",
    defaultSeverity: "low",
    scope: "page",
    description: "Finds navigation links whose destination is only an empty fragment marker.",
    eligibility: "The page has a complete persisted raw link collection.",
    requiredData: ["pages", "transport", "raw-extraction", "links"],
    explanation:
      "A placeholder hash changes focus or scroll position without providing a real destination.",
    expectedValue:
      "Navigation links use a real URL or a fragment name that identifies a real target.",
    recommendedFix:
      "Replace the placeholder href with the intended destination; use a button when the control performs an in-page action.",
    verification:
      "Inspect the source and confirm no navigation href resolves to only a trailing # marker.",
    confidence: "high",
    impactAreas: ["user-experience", "crawlability"],
    responsibleOwner: "developer",
  },
  (snapshot) => {
    const outcomes = coveredHtmlPages(snapshot).map((source) => {
      const coverage = pageCoverageIssue(source);
      if (coverage !== null)
        return pageNotChecked(snapshot, source, coverage.reason, coverage.missingData);
      const placeholders = navigationLinks(source).filter((link) =>
        link.targetUrl.trim().endsWith("#"),
      );
      if (placeholders.length > 0) {
        return checkedOutcome({
          target: pageTarget(source),
          failed: true,
          evidence: placeholders
            .slice(0, 25)
            .map((link) =>
              linkEvidence(
                source,
                link,
                "placeholder_hash_href",
                maskedUrlForEvidence(link.targetUrl),
              ),
            ),
          detectedValue: `${placeholders.length} placeholder hash link${placeholders.length === 1 ? " is" : "s are"} present on this page.`,
        });
      }
      if (!source.extraction!.linksComplete) {
        return pageNotChecked(snapshot, source, "The persisted link collection was truncated.", [
          "links",
        ]);
      }
      return checkedOutcome({
        target: pageTarget(source),
        failed: false,
        evidence: [
          pageEvidence(
            source,
            "checked_navigation_link_count",
            navigationLinks(source).length,
            "graph",
          ),
        ],
        detectedValue: "No persisted navigation link uses an empty hash destination.",
      });
    });
    return ensureCoverage(snapshot, "lnk-009", outcomes);
  },
);

const lnk010 = defineM5RuleVersion(
  {
    id: "LNK-010",
    title: "Indexable page has no discovered internal links pointing to it",
    category: "links-architecture",
    defaultSeverity: "high",
    scope: "page",
    description: "Checks indexable non-seed pages for an inbound internal navigation edge.",
    eligibility:
      "Requested-page indexability and a complete persisted crawl graph are available; client-rendered sources require rendered link-graph evidence that Phase 1 does not retain.",
    requiredData: ["crawl", "pages", "transport", "robots", "raw-extraction", "links"],
    explanation:
      "An indexable page with no inbound internal links is isolated from normal site discovery and receives no internal-link support.",
    expectedValue:
      "Every indexable non-homepage page has at least one inbound internal navigation link.",
    recommendedFix:
      "Add a crawlable anchor from a relevant navigation area, hub, or contextual page to this exact preferred URL.",
    verification:
      "Run a complete crawl and confirm at least one inbound anchor, area, or pagination edge reaches the page.",
    confidence: "high",
    impactAreas: ARCHITECTURE_IMPACTS,
    responsibleOwner: "seo",
  },
  3,
  (snapshot) => {
    const graphIssue = graphCoverageIssue(snapshot);
    const inboundIndex = buildInboundNavigationIndex(snapshot);
    const candidates = snapshot.pages.filter(
      (page) => page.importance !== "homepage" && page.discoverySource !== "seed",
    );
    const outcomes = candidates.flatMap((target) => {
      const indexability = requestedPageIndexabilityState(target);
      if (indexability === "not-indexable") return [];
      if (indexability === "unknown") {
        return [
          pageNotChecked(
            snapshot,
            target,
            "Transport, robots, or raw directive evidence cannot establish page indexability.",
            pageIndexabilityMissingData(target),
          ),
        ];
      }
      const inbound = inboundIndex.get(target.id) ?? EMPTY_INBOUND_SUMMARY;
      if (inbound.count === 0 && graphIssue !== null) {
        return [
          pageNotChecked(snapshot, target, graphIssue.reason, graphIssue.missingData, [
            pageEvidence(target, "observed_inbound_internal_links", 0, "graph"),
          ]),
        ];
      }
      return [
        checkedOutcome({
          target: pageTarget(target),
          failed: inbound.count === 0,
          evidence: [
            pageEvidence(target, "observed_inbound_internal_links", inbound.count, "graph"),
            ...(inbound.count === 0
              ? [graphCoverageEvidence(snapshot), ...indexabilityEvidence(snapshot, target)]
              : []),
            ...inbound.samples.map(({ source, link }) =>
              linkEvidence(
                source,
                link,
                "inbound_internal_link",
                maskedUrlForEvidence(target.normalizedUrl),
              ),
            ),
          ],
          detectedValue:
            inbound.count === 0
              ? "No inbound internal navigation link points to this page in the complete crawl graph."
              : `${inbound.count} inbound internal navigation link${inbound.count === 1 ? " points" : "s point"} to this page.`,
        }),
      ];
    });
    return ensureCoverage(snapshot, "lnk-010", outcomes);
  },
);

const lnk011 = defineM5RuleVersion(
  {
    id: "LNK-011",
    title: "Important page has insufficient internal-link support",
    category: "links-architecture",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Compares distinct inbound internal-link sources for explicitly important pages with the versioned threshold.",
    eligibility:
      "The page is explicitly important and the completed raw link graph is available without an unobserved client-rendered link source.",
    requiredData: ["crawl", "configuration", "pages", "transport", "raw-extraction", "links"],
    explanation:
      "An important page supported by too few internal pages can be difficult to discover and weakly prioritized.",
    expectedValue:
      "Every important page receives links from at least the configured number of distinct internal source pages.",
    recommendedFix:
      "Add useful crawlable links from additional relevant hubs, navigation areas, or contextual pages without repeating boilerplate links solely to meet a count.",
    verification:
      "Re-crawl and confirm the page meets the configured distinct inbound-source threshold.",
    confidence: "high",
    impactAreas: ARCHITECTURE_IMPACTS,
    responsibleOwner: "seo",
  },
  3,
  (snapshot, policy) => {
    const graphIssue = graphCoverageIssue(snapshot);
    const inboundIndex = buildInboundNavigationIndex(snapshot);
    const candidates = snapshot.pages.filter((page) => page.importance === "important");
    const outcomes = candidates.map((target) => {
      const inbound = inboundIndex.get(target.id) ?? EMPTY_INBOUND_SUMMARY;
      const sourceCount = inbound.distinctSourceCount;
      if (sourceCount < policy.minimumImportantInboundLinks && graphIssue !== null) {
        return pageNotChecked(snapshot, target, graphIssue.reason, graphIssue.missingData, [
          pageEvidence(target, "observed_distinct_inbound_sources", sourceCount, "graph"),
        ]);
      }
      return checkedOutcome({
        target: pageTarget(target),
        failed: sourceCount < policy.minimumImportantInboundLinks,
        evidence: [
          pageEvidence(target, "observed_distinct_inbound_sources", sourceCount, "graph"),
          pageEvidence(target, "page_importance", target.importance, "transport"),
          ...(sourceCount < policy.minimumImportantInboundLinks
            ? [graphCoverageEvidence(snapshot)]
            : []),
          crawlEvidence(
            snapshot,
            "minimum_important_inbound_links",
            policy.minimumImportantInboundLinks,
          ),
          ...inbound.samples
            .slice(0, 10)
            .map(({ source, link }) =>
              linkEvidence(
                source,
                link,
                "important_page_inbound_link",
                maskedUrlForEvidence(target.normalizedUrl),
              ),
            ),
        ],
        detectedValue: `This important page has ${sourceCount} distinct inbound internal source page${sourceCount === 1 ? "" : "s"}.`,
        expectedValue: `At least ${policy.minimumImportantInboundLinks} distinct inbound internal source pages.`,
      });
    });
    return ensureCoverage(snapshot, "lnk-011", outcomes);
  },
);

const lnk012 = defineM5Rule(
  {
    id: "LNK-012",
    title: "Important page is buried at excessive depth",
    category: "links-architecture",
    defaultSeverity: "medium",
    scope: "page",
    description: "Compares explicitly important pages with the configured crawl-depth threshold.",
    eligibility: "An explicitly important page has a persisted depth from a completed crawl.",
    requiredData: ["crawl", "pages", "configuration"],
    explanation:
      "Important pages buried behind many link hops are harder for users and crawlers to discover.",
    expectedValue: "Important pages are found at or below the configured depth threshold.",
    recommendedFix:
      "Link the page from a shallower relevant hub, primary navigation, or homepage section so its shortest crawl path meets the threshold.",
    verification:
      "Re-crawl and confirm the page depth is no greater than the configured threshold.",
    confidence: "high",
    impactAreas: ARCHITECTURE_IMPACTS,
    responsibleOwner: "seo",
  },
  (snapshot, policy) => {
    const candidates = snapshot.pages.filter((page) => page.importance === "important");
    const outcomes = candidates.map((page) => {
      const evidenceItems = [
        pageEvidence(page, "crawl_depth", page.depth),
        crawlEvidence(snapshot, "important_depth_threshold", policy.importantDepthThreshold),
        crawlEvidence(snapshot, "crawl_status", snapshot.status),
      ];
      if (snapshot.status !== "completed") {
        return pageNotChecked(
          snapshot,
          page,
          "The partial crawl cannot prove that the observed depth is the page's shortest reachable path.",
          ["crawl"],
          evidenceItems,
        );
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: page.depth > policy.importantDepthThreshold,
        evidence: evidenceItems,
        detectedValue: `This important page was discovered at depth ${page.depth}.`,
        expectedValue: `Important page depth is at most ${policy.importantDepthThreshold}.`,
      });
    });
    return ensureCoverage(snapshot, "lnk-012", outcomes);
  },
);

const lnk013 = defineM5RuleVersion(
  {
    id: "LNK-013",
    title: "Page has few relevant contextual internal links",
    category: "links-architecture",
    defaultSeverity: "opportunity",
    scope: "page",
    description: "Presents important pages for human review of contextual internal-link relevance.",
    eligibility:
      "An important page and its observed inbound graph are available; semantic relevance requires human judgment.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "links"],
    explanation:
      "Relevant contextual links can help users and crawlers connect related information, but link relevance cannot be inferred from counts alone.",
    expectedValue:
      "Important pages receive useful contextual links from genuinely related content.",
    recommendedFix:
      "Review the listed inbound sources and add natural contextual links only where they help readers reach related content.",
    verification:
      "A reviewer confirms the source context, target relationship, and anchor wording for each important page.",
    confidence: "low",
    impactAreas: ARCHITECTURE_IMPACTS,
    responsibleOwner: "content",
  },
  2,
  (snapshot) => {
    const graphIssue = graphCoverageIssue(snapshot);
    const inboundIndex = buildInboundNavigationIndex(snapshot);
    const candidates = snapshot.pages.filter((page) => page.importance === "important");
    const outcomes = candidates.map((target) => {
      const inbound = inboundIndex.get(target.id) ?? EMPTY_INBOUND_SUMMARY;
      if (graphIssue !== null) {
        return pageNotChecked(snapshot, target, graphIssue.reason, graphIssue.missingData, [
          pageEvidence(target, "observed_inbound_internal_links", inbound.count, "graph"),
        ]);
      }
      return eligibleOutcome({
        target: pageTarget(target),
        status: "manual-review",
        evidence: [
          pageEvidence(target, "observed_inbound_internal_links", inbound.count, "graph"),
          ...inbound.samples.map(({ source, link }) =>
            linkEvidence(source, link, "contextual_relevance_candidate", [
              maskedUrlForEvidence(target.normalizedUrl),
              link.anchorText ?? "anchor_text_unavailable",
            ]),
          ),
        ],
        detectedValue: `Human review is required: ${inbound.count} inbound internal link${inbound.count === 1 ? " was" : "s were"} observed, but DOM placement and topical relevance are not available with sufficient certainty.`,
        reason:
          "Automated link counts cannot establish whether a link is contextual or topically relevant.",
      });
    });
    return ensureCoverage(snapshot, "lnk-013", outcomes);
  },
);

const lnk014 = defineM5Rule(
  {
    id: "LNK-014",
    title: "Page contains an excessive number of links",
    category: "links-architecture",
    defaultSeverity: "low",
    scope: "page",
    description: "Compares persisted navigation-link counts with the versioned page threshold.",
    eligibility:
      "The page has raw extraction; a passing absence conclusion requires a complete link collection.",
    requiredData: ["configuration", "pages", "transport", "raw-extraction", "links"],
    explanation:
      "Very large link sets can dilute navigation clarity, inflate page processing, and signal generated crawl paths.",
    expectedValue: "The page remains at or below the configured navigation-link threshold.",
    recommendedFix:
      "Remove duplicate or low-value links, paginate finite collections where appropriate, and prevent generated controls from emitting unbounded destinations.",
    verification:
      "Re-extract the page and confirm its navigation-link count is at or below the configured threshold.",
    confidence: "high",
    impactAreas: LINK_IMPACTS,
    responsibleOwner: "developer",
  },
  (snapshot, policy) => {
    const outcomes = coveredHtmlPages(snapshot).map((page) => {
      const coverage = pageCoverageIssue(page);
      if (coverage !== null)
        return pageNotChecked(snapshot, page, coverage.reason, coverage.missingData);
      const count = navigationLinks(page).length;
      if (count <= policy.excessivePageLinkThreshold && !page.extraction!.linksComplete) {
        return pageNotChecked(
          snapshot,
          page,
          "The persisted link collection was truncated before the configured threshold was reached.",
          ["links"],
          [
            pageEvidence(page, "persisted_navigation_link_count", count, "graph"),
            crawlEvidence(
              snapshot,
              "excessive_page_link_threshold",
              policy.excessivePageLinkThreshold,
            ),
          ],
        );
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: count > policy.excessivePageLinkThreshold,
        evidence: [
          pageEvidence(page, "persisted_navigation_link_count", count, "graph"),
          crawlEvidence(
            snapshot,
            "excessive_page_link_threshold",
            policy.excessivePageLinkThreshold,
          ),
        ],
        detectedValue: `This page contains ${count} persisted navigation links.`,
        expectedValue: `At most ${policy.excessivePageLinkThreshold} navigation links per page.`,
      });
    });
    return ensureCoverage(snapshot, "lnk-014", outcomes);
  },
);

const lnk015 = defineM5Rule(
  {
    id: "LNK-015",
    title: "Internal navigational link uses nofollow unexpectedly",
    category: "links-architecture",
    defaultSeverity: "medium",
    scope: "page",
    description: "Surfaces internal navigation links carrying nofollow for intent review.",
    eligibility:
      "A complete raw link collection is available; whether nofollow is expected requires human intent.",
    requiredData: ["pages", "transport", "raw-extraction", "links"],
    explanation:
      "Nofollow on an internal navigation link can suppress intended discovery or signal flow, but some uses may be deliberate.",
    expectedValue:
      "Internal navigation links are followable unless a documented policy requires nofollow.",
    recommendedFix:
      "Review each listed link; remove nofollow when the destination should participate in normal discovery, or document the intentional exception.",
    verification:
      "A site owner confirms the intent of every listed nofollow value and a re-crawl verifies any approved source change.",
    confidence: "medium",
    impactAreas: ARCHITECTURE_IMPACTS,
    responsibleOwner: "seo",
  },
  (snapshot) => {
    const outcomes = coveredHtmlPages(snapshot).map((page) => {
      const coverage = pageCoverageIssue(page);
      if (coverage !== null)
        return pageNotChecked(snapshot, page, coverage.reason, coverage.missingData);
      const nofollow = navigationLinks(page).filter(
        (link) =>
          link.scope === "internal" &&
          link.relValues.some((value) => value.toLowerCase() === "nofollow"),
      );
      if (nofollow.length > 0) {
        return eligibleOutcome({
          target: pageTarget(page),
          status: "manual-review",
          evidence: nofollow
            .slice(0, 25)
            .map((link) =>
              linkEvidence(page, link, "internal_nofollow_candidate", [
                maskedUrlForEvidence(link.normalizedTargetUrl),
                link.relValues.join(" "),
              ]),
            ),
          detectedValue: `${nofollow.length} internal navigation link${nofollow.length === 1 ? " uses" : "s use"} nofollow; automated evidence cannot establish whether that choice is intentional.`,
          reason:
            "The rel token is objective, but expected site-owner intent requires human judgment.",
        });
      }
      if (!page.extraction!.linksComplete) {
        return pageNotChecked(snapshot, page, "The persisted link collection was truncated.", [
          "links",
        ]);
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: false,
        evidence: [pageEvidence(page, "internal_nofollow_link_count", 0, "graph")],
        detectedValue: "No internal navigation link uses nofollow.",
      });
    });
    return ensureCoverage(snapshot, "lnk-015", outcomes);
  },
);

function normalizedAnchorText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const lnk016 = defineM5Rule(
  {
    id: "LNK-016",
    title: "Link has empty, generic, or uninformative anchor text",
    category: "links-architecture",
    defaultSeverity: "low",
    scope: "page",
    description:
      "Finds a conservative set of exact generic anchor phrases and sends empty text for review.",
    eligibility:
      "Anchor text was persisted; linked-image accessible names are not available for empty anchors.",
    requiredData: ["pages", "transport", "raw-extraction", "links"],
    explanation:
      "Descriptive link names help users and crawlers understand a destination before following it.",
    expectedValue: "Each navigation link has a concise destination-specific accessible name.",
    recommendedFix:
      "Replace generic wording with concise destination-specific text; for image links, provide an appropriate image alt or accessible name.",
    verification:
      "Review each listed source element and confirm its computed accessible name describes the destination.",
    confidence: "medium",
    impactAreas: ["user-experience", "search-visibility", "ai-retrievability"],
    responsibleOwner: "content",
  },
  (snapshot) => {
    const outcomes = coveredHtmlPages(snapshot).map((page) => {
      const coverage = pageCoverageIssue(page);
      if (coverage !== null)
        return pageNotChecked(snapshot, page, coverage.reason, coverage.missingData);
      const candidates = navigationLinks(page).filter(
        (link) => link.linkType !== "pagination" && paginationDirection(link) === null,
      );
      const generic = candidates.filter((link) => {
        const text = normalizedAnchorText(link.anchorText ?? "");
        return text !== "" && GENERIC_ANCHOR_TEXT.has(text);
      });
      const empty = candidates.filter((link) => normalizedAnchorText(link.anchorText ?? "") === "");
      if (generic.length > 0) {
        return checkedOutcome({
          target: pageTarget(page),
          failed: true,
          evidence: generic
            .slice(0, 25)
            .map((link) =>
              linkEvidence(page, link, "generic_anchor_text", [
                maskedUrlForEvidence(link.normalizedTargetUrl),
                link.anchorText ?? "",
              ]),
            ),
          detectedValue: `${generic.length} link${generic.length === 1 ? " uses" : "s use"} a conservative exact-match generic anchor phrase.`,
        });
      }
      if (empty.length > 0) {
        return eligibleOutcome({
          target: pageTarget(page),
          status: "manual-review",
          evidence: empty
            .slice(0, 25)
            .map((link) =>
              linkEvidence(
                page,
                link,
                "empty_persisted_anchor_text",
                maskedUrlForEvidence(link.normalizedTargetUrl),
              ),
            ),
          detectedValue: `${empty.length} link${empty.length === 1 ? " has" : "s have"} no persisted text; linked-image alt text and computed accessible names are unavailable, so a failure cannot be asserted automatically.`,
          reason:
            "Persisted text alone cannot establish the computed accessible name of an image or labeled link.",
        });
      }
      if (!page.extraction!.linksComplete) {
        return pageNotChecked(snapshot, page, "The persisted link collection was truncated.", [
          "links",
        ]);
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: false,
        evidence: [pageEvidence(page, "checked_anchor_text_count", candidates.length, "graph")],
        detectedValue: `Checked ${candidates.length} persisted link texts; none matched the conservative generic phrase set.`,
      });
    });
    return ensureCoverage(snapshot, "lnk-016", outcomes);
  },
);

const lnk017 = defineM5Rule(
  {
    id: "LNK-017",
    title: "Fragment link points to a missing target",
    category: "links-architecture",
    defaultSeverity: "low",
    scope: "page",
    description: "Identifies fragment-link candidates but does not invent DOM target presence.",
    eligibility:
      "Fragment hrefs and the destination document's element IDs or named anchors are available; target IDs are not persisted in Phase 1.",
    requiredData: ["pages", "transport", "raw-extraction", "links"],
    explanation:
      "A fragment link to a missing element does not move users to the promised section.",
    expectedValue:
      "Every non-empty URL fragment matches an element ID or compatible named anchor in its destination document.",
    recommendedFix:
      "Add the intended stable target ID or update the fragment href to match the destination section exactly.",
    verification:
      "Open each fragment link and confirm focus or scroll moves to the intended destination element.",
    confidence: "low",
    impactAreas: ["user-experience"],
    responsibleOwner: "developer",
  },
  (snapshot) => {
    const outcomes = coveredHtmlPages(snapshot).map((page) => {
      const coverage = pageCoverageIssue(page);
      if (coverage !== null)
        return pageNotChecked(snapshot, page, coverage.reason, coverage.missingData);
      const fragments = navigationLinks(page).filter((link) => {
        const target = safeUrl(link.targetUrl);
        return target !== null && target.hash !== "";
      });
      if (fragments.length > 0) {
        return pageNotChecked(
          snapshot,
          page,
          "Fragment hrefs were observed, but destination element IDs and named anchors are not persisted, so target existence cannot be checked.",
          ["raw-extraction"],
          fragments
            .slice(0, 25)
            .map((link) =>
              linkEvidence(
                page,
                link,
                "unchecked_fragment_target",
                maskedUrlForEvidence(link.targetUrl),
              ),
            ),
        );
      }
      if (!page.extraction!.linksComplete) {
        return pageNotChecked(snapshot, page, "The persisted link collection was truncated.", [
          "links",
        ]);
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: false,
        evidence: [pageEvidence(page, "fragment_link_count", 0, "graph")],
        detectedValue: "No non-empty fragment link was observed on this page.",
      });
    });
    return ensureCoverage(snapshot, "lnk-017", outcomes);
  },
);

function paginationDirection(link: AuditPageLink): "next" | "prev" | null {
  for (const value of link.relValues) {
    const tokens = value.toLowerCase().split(/\s+/u);
    if (tokens.includes("next")) return "next";
    if (tokens.includes("prev")) return "prev";
  }
  return null;
}

interface PaginationTargetIndex {
  readonly nextPageIds: Set<string>;
  readonly nextUrls: Set<string>;
  readonly previousPageIds: Set<string>;
  readonly previousUrls: Set<string>;
}

function paginationTargetIndex(
  snapshot: AuditCrawlSnapshot,
): ReadonlyMap<string, PaginationTargetIndex> {
  const index = new Map<string, PaginationTargetIndex>();
  for (const page of snapshot.pages) {
    const targets: PaginationTargetIndex = {
      nextPageIds: new Set<string>(),
      nextUrls: new Set<string>(),
      previousPageIds: new Set<string>(),
      previousUrls: new Set<string>(),
    };
    for (const link of navigationLinks(page)) {
      const direction = paginationDirection(link);
      if (direction === null) continue;
      const pageIds = direction === "next" ? targets.nextPageIds : targets.previousPageIds;
      const urls = direction === "next" ? targets.nextUrls : targets.previousUrls;
      if (link.targetPageId !== null) pageIds.add(link.targetPageId);
      urls.add(link.normalizedTargetUrl);
    }
    index.set(page.id, targets);
  }
  return index;
}

const lnk018 = defineM5RuleVersion(
  {
    id: "LNK-018",
    title: "Pagination sequence is incomplete or broken",
    category: "links-architecture",
    defaultSeverity: "high",
    scope: "page",
    description:
      "Checks observed rel-next/prev edges for reachable targets and reciprocal sequence edges.",
    eligibility:
      "A retained pagination edge and target transport are available; missing-reciprocal and passing conclusions require complete relevant source and target link coverage.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "links"],
    explanation:
      "Broken pagination edges prevent users and crawlers from traversing the complete sequence.",
    expectedValue:
      "Every pagination edge reaches a successful page and has the corresponding reciprocal edge.",
    recommendedFix:
      "Repair each listed next or previous URL and add the matching reciprocal relation on the adjacent page.",
    verification:
      "Traverse the full sequence in both directions and confirm every edge resolves successfully and reciprocally.",
    confidence: "high",
    impactAreas: ARCHITECTURE_IMPACTS,
    responsibleOwner: "developer",
  },
  2,
  (snapshot) => {
    const byId = pagesById(snapshot);
    const byUrl = pagesByUrl(snapshot);
    const paginationTargets = paginationTargetIndex(snapshot);
    const outcomes = coveredHtmlPages(snapshot).flatMap((source) => {
      const candidates = navigationLinks(source).filter(
        (link) => paginationDirection(link) !== null,
      );
      if (candidates.length === 0) return [];
      const coverage = pageCoverageIssue(source);
      if (coverage !== null)
        return [pageNotChecked(snapshot, source, coverage.reason, coverage.missingData)];
      const failures: AuditEvidenceItem[] = [];
      let failureCount = 0;
      let unavailable = false;
      for (const link of candidates) {
        const direction = paginationDirection(link)!;
        const target = resolveLinkTarget(link, byId, byUrl);
        if (target === null || target.statusCode === null) {
          unavailable = true;
          continue;
        }
        if (!isSuccessful(target)) {
          failureCount += 1;
          if (failures.length < 24) {
            failures.push(
              linkEvidence(source, link, "broken_pagination_target", [
                direction,
                maskedUrlForEvidence(link.normalizedTargetUrl),
                target.statusCode,
              ]),
              boundedPageEvidence(
                target,
                "pagination_target_status",
                target.statusCode,
                "transport",
              ),
            );
          }
          continue;
        }
        if (target.extraction?.source !== "raw") {
          unavailable = true;
          continue;
        }
        const reciprocal = direction === "next" ? "prev" : "next";
        const targetPagination = paginationTargets.get(target.id);
        const reciprocalPageIds =
          reciprocal === "next" ? targetPagination?.nextPageIds : targetPagination?.previousPageIds;
        const reciprocalUrls =
          reciprocal === "next" ? targetPagination?.nextUrls : targetPagination?.previousUrls;
        const hasReciprocal =
          reciprocalPageIds?.has(source.id) === true ||
          reciprocalUrls?.has(source.normalizedUrl) === true;
        if (!hasReciprocal && target.extraction.linksComplete) {
          failureCount += 1;
          if (failures.length < 24) {
            failures.push(
              linkEvidence(source, link, "missing_reciprocal_pagination_edge", [
                direction,
                maskedUrlForEvidence(link.normalizedTargetUrl),
                reciprocal,
              ]),
              boundedPageEvidence(target, "pagination_target_links_complete", true, "raw"),
            );
          }
        } else if (!hasReciprocal) {
          unavailable = true;
        }
      }
      if (failureCount > 0) {
        return [
          checkedOutcome({
            target: pageTarget(source),
            failed: true,
            evidence: failures,
            detectedValue: `${failureCount} broken or non-reciprocal pagination edge${failureCount === 1 ? " was" : "s were"} observed on this page.`,
          }),
        ];
      }
      const coverageIssue = unavailable
        ? {
            reason: "At least one pagination target or reciprocal link collection is unavailable.",
            missingData: ["transport", "raw-extraction", "links"] as const,
          }
        : snapshot.status !== "completed"
          ? {
              reason:
                "The crawl was only partially completed, so pagination coverage is inconclusive.",
              missingData: ["crawl"] as const,
            }
          : source.extraction!.linksComplete
            ? null
            : {
                reason: "The persisted source-page link collection was truncated.",
                missingData: ["links"] as const,
              };
      if (coverageIssue !== null) {
        return [
          pageNotChecked(snapshot, source, coverageIssue.reason, coverageIssue.missingData, [
            crawlEvidence(snapshot, "pagination_crawl_status", snapshot.status),
            pageEvidence(
              source,
              "pagination_source_links_complete",
              source.extraction!.linksComplete,
              "raw",
            ),
            ...candidates
              .slice(0, 23)
              .map((link) =>
                linkEvidence(source, link, "pagination_edge_coverage", [
                  paginationDirection(link) ?? "unknown",
                  maskedUrlForEvidence(link.normalizedTargetUrl),
                ]),
              ),
          ]),
        ];
      }
      return [
        checkedOutcome({
          target: pageTarget(source),
          failed: false,
          evidence: candidates
            .slice(0, 25)
            .map((link) =>
              linkEvidence(source, link, "verified_pagination_edge", [
                paginationDirection(link) ?? "unknown",
                maskedUrlForEvidence(link.normalizedTargetUrl),
              ]),
            ),
          detectedValue: `${candidates.length} pagination edge${candidates.length === 1 ? " is" : "s are"} reachable and reciprocal.`,
        }),
      ];
    });
    return ensureCoverage(snapshot, "lnk-018", outcomes);
  },
);

interface QueryVariantGroup {
  readonly key: string;
  readonly pages: readonly AuditPageObservation[];
}

function queryVariantGroups(snapshot: AuditCrawlSnapshot): readonly QueryVariantGroup[] {
  const groups = new Map<string, Map<string, AuditPageObservation>>();
  for (const page of snapshot.pages) {
    const parsed = safeUrl(page.normalizedUrl);
    if (parsed === null || parsed.search === "") continue;
    const key = `${parsed.origin}${parsed.pathname}`;
    const pages = groups.get(key) ?? new Map<string, AuditPageObservation>();
    if (!pages.has(page.normalizedUrl)) pages.set(page.normalizedUrl, page);
    groups.set(key, pages);
  }
  return [...groups.entries()]
    .map(([key, pagesByUrl]) => ({
      key,
      pages: [...pagesByUrl.values()].sort((left, right) =>
        left.normalizedUrl.localeCompare(right.normalizedUrl),
      ),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

const lnk019 = defineM5RuleVersion(
  {
    id: "LNK-019",
    title: "Facets, calendars, filters, or parameters generate unbounded crawl paths",
    category: "links-architecture",
    defaultSeverity: "high",
    scope: "page",
    description:
      "Groups retained query URLs by origin and path and compares their cardinality with the configured threshold.",
    eligibility:
      "Query-bearing crawl pages were retained; a passing conclusion requires a completed crawl with complete raw link-graph coverage and no unobserved client-rendered link source, while retained variants can still prove a threshold failure.",
    requiredData: ["crawl", "configuration", "pages", "transport", "raw-extraction", "links"],
    explanation:
      "Generated parameter combinations can create effectively unbounded navigation paths and consume crawl capacity.",
    expectedValue:
      "Each origin-and-path group remains below the configured query-variant threshold.",
    recommendedFix:
      "Emit crawlable links only for valid finite states, constrain generated combinations, canonicalize duplicates, and exclude trap patterns until fixed.",
    verification:
      "Run a completed crawl with the intended query policy and confirm every path group remains below the threshold.",
    confidence: "medium",
    impactAreas: ARCHITECTURE_IMPACTS,
    responsibleOwner: "developer",
  },
  3,
  (snapshot, policy) => {
    const groups = queryVariantGroups(snapshot);
    const graphIssue = graphCoverageIssue(snapshot);
    const outcomes = groups.flatMap((group) => {
      const excessive = group.pages.length >= policy.queryVariantThreshold;
      return group.pages.map((page) => {
        const groupEvidence = [
          pageEvidence(page, "query_variant_group_membership", maskedUrlForEvidence(group.key)),
          crawlEvidence(snapshot, "query_variant_group", [
            maskedUrlForEvidence(group.key),
            group.pages.length,
          ]),
          crawlEvidence(snapshot, "query_variant_threshold", policy.queryVariantThreshold),
          ...group.pages
            .slice(0, 10)
            .map((candidate) =>
              boundedPageEvidence(
                candidate,
                "query_variant_sample",
                maskedUrlForEvidence(candidate.normalizedUrl),
              ),
            ),
        ];
        if (!excessive && graphIssue !== null) {
          return pageNotChecked(
            snapshot,
            page,
            graphIssue.reason,
            graphIssue.missingData,
            groupEvidence,
          );
        }
        return checkedOutcome({
          target: pageTarget(page),
          failed: excessive,
          evidence: groupEvidence,
          detectedValue: `The path group containing this page has ${group.pages.length} retained query variants.`,
          expectedValue: `Fewer than ${policy.queryVariantThreshold} retained query variants per path group.`,
          confidence: "medium",
        });
      });
    });
    return ensureCoverage(snapshot, "lnk-019", outcomes);
  },
);

const lnk020 = defineM5RuleVersion(
  {
    id: "LNK-020",
    title: "Important page is missing from relevant navigation or breadcrumbs",
    category: "links-architecture",
    defaultSeverity: "opportunity",
    scope: "page",
    description:
      "Presents important pages for human review because navigation-region semantics are not persisted.",
    eligibility:
      "An explicitly important page and its inbound link graph are available; relevance and DOM region require human judgment.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "rendered-extraction", "links"],
    explanation:
      "Relevant navigation and breadcrumbs can expose important pages consistently, but raw link counts do not identify those semantic regions.",
    expectedValue:
      "Important pages appear in an appropriate navigation or breadcrumb path when that placement helps users.",
    recommendedFix:
      "Review the page's role and add it to the most relevant navigation or breadcrumb trail only when that improves user orientation.",
    verification:
      "A reviewer confirms the page appears in the appropriate semantic navigation region and that the link works without JavaScript.",
    confidence: "low",
    impactAreas: ARCHITECTURE_IMPACTS,
    responsibleOwner: "seo",
  },
  2,
  (snapshot) => {
    const graphIssue = graphCoverageIssue(snapshot);
    const inboundIndex = buildInboundNavigationIndex(snapshot);
    const candidates = snapshot.pages.filter((page) => page.importance === "important");
    const outcomes = candidates.map((target) => {
      const inbound = inboundIndex.get(target.id) ?? EMPTY_INBOUND_SUMMARY;
      if (graphIssue !== null) {
        return pageNotChecked(snapshot, target, graphIssue.reason, graphIssue.missingData, [
          pageEvidence(target, "observed_inbound_internal_links", inbound.count, "graph"),
        ]);
      }
      return eligibleOutcome({
        target: pageTarget(target),
        status: "manual-review",
        evidence: [
          pageEvidence(target, "observed_inbound_internal_links", inbound.count, "graph"),
          pageEvidence(target, "navigation_region_observation", "not_collected"),
          ...inbound.samples.map(({ source, link }) =>
            linkEvidence(source, link, "navigation_placement_candidate", [
              maskedUrlForEvidence(target.normalizedUrl),
              link.anchorText ?? "anchor_text_unavailable",
            ]),
          ),
        ],
        detectedValue: `Human review is required: ${inbound.count} inbound link${inbound.count === 1 ? " was" : "s were"} observed, but the extraction model does not identify relevant navigation or breadcrumb regions.`,
        reason: "DOM placement and site-information architecture relevance require human judgment.",
      });
    });
    return ensureCoverage(snapshot, "lnk-020", outcomes);
  },
);

export const LNK_RULES = Object.freeze([
  lnk001,
  lnk002,
  lnk003,
  lnk004,
  lnk005,
  lnk006,
  lnk007,
  lnk008,
  lnk009,
  lnk010,
  lnk011,
  lnk012,
  lnk013,
  lnk014,
  lnk015,
  lnk016,
  lnk017,
  lnk018,
  lnk019,
  lnk020,
] satisfies readonly AuditRuleDefinition[]);
