import type { AuditRuleDefinition, AuditRuleOutcome } from "../contracts.js";
import type { AuditCrawlSnapshot, AuditPageObservation } from "../snapshot.js";
import {
  boundedEvidenceText,
  boundedEvidenceUrl,
  checkedOutcome,
  crawlEvidence,
  defineRule,
  defineRuleVersion,
  evidence,
  evidenceObservationDigest,
  headerValues,
  isHtmlContentType,
  isSuccessful,
  normalizedContentType,
  notCheckedOutcome,
  pageEvidence,
  pageTarget,
  pageUnavailable,
  safeUrl,
  sampleEvidenceStrings,
  siteTarget,
  siteUnavailable,
} from "./helpers.js";

const HTTP_IMPACT = ["crawlability", "search-visibility", "user-experience"] as const;
const TEXT_CONTENT_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/xhtml+xml",
  "application/xml",
  "image/svg+xml",
  "text/css",
  "text/html",
  "text/javascript",
  "text/plain",
  "text/xml",
]);

function pageResultsOrUnavailable(
  snapshot: AuditCrawlSnapshot,
  key: string,
  pages: readonly AuditPageObservation[],
  evaluate: (page: AuditPageObservation) => AuditRuleOutcome,
) {
  return pages.length === 0
    ? pageUnavailable(snapshot, key, "No page transport observation was available.", ["pages"])
    : pages.map(evaluate);
}

function finalUrl(page: AuditPageObservation): string {
  return page.finalUrl ?? page.normalizedUrl;
}

function hasConclusiveSuccessfulFinalStatus(page: AuditPageObservation): boolean {
  return page.statusCode !== null && page.statusCode >= 200 && page.statusCode < 400;
}

function normalizedFinalUrl(page: AuditPageObservation): string | null {
  const destination = safeUrl(finalUrl(page));
  if (destination === null) return null;
  destination.hash = "";
  return destination.href;
}

const MINIMUM_HSTS_MAX_AGE = 15_552_000n;

type HstsPolicyAssessment = Readonly<
  | { state: "missing"; maxAge: null }
  | { state: "invalid"; maxAge: null }
  | { state: "valid"; maxAge: string }
>;

function assessEffectiveHstsPolicy(values: readonly string[]): HstsPolicyAssessment {
  const effectiveHeader = values[0];
  if (effectiveHeader === undefined) return Object.freeze({ state: "missing", maxAge: null });

  const maxAgeDirectives = effectiveHeader
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => /^max-age(?:[\t ]|=|$)/iu.test(directive));
  if (maxAgeDirectives.length !== 1) {
    return Object.freeze({ state: "invalid", maxAge: null });
  }
  const match = /^max-age[\t ]*=[\t ]*(\d+)$/iu.exec(maxAgeDirectives[0] ?? "");
  if (match?.[1] === undefined) return Object.freeze({ state: "invalid", maxAge: null });

  return Object.freeze({ state: "valid", maxAge: BigInt(match[1]).toString() });
}

const http001 = defineRule(
  {
    id: "HTTP-001",
    title: "HTTP does not redirect consistently to HTTPS",
    category: "http",
    defaultSeverity: "critical",
    scope: "site",
    description: "Checks observed HTTP entry points for a consistent redirect to HTTPS.",
    eligibility:
      "At least one first-party HTTP entry point must have a redirect observation and conclusive final target status.",
    requiredData: ["pages", "transport", "redirects"],
    explanation:
      "Serving the same site over HTTP or redirecting HTTP inconsistently can split indexing signals and expose visitors to an insecure connection.",
    expectedValue: "Every observed HTTP entry point redirects to the canonical HTTPS origin.",
    recommendedFix:
      "Configure the edge or origin server to return one permanent 301 or 308 redirect from every HTTP host and path to the equivalent canonical HTTPS URL.",
    verification:
      "Request representative HTTP URLs and confirm each response reaches the canonical HTTPS URL through one permanent redirect without a downgrade.",
    confidence: "high",
    impactAreas: [...HTTP_IMPACT, "security"],
    responsibleOwner: "infrastructure",
  },
  (snapshot) => {
    const origin = safeUrl(snapshot.origin);
    if (origin === null) {
      return siteUnavailable(snapshot, "http-to-https", "The project origin is malformed.", [
        "crawl",
      ]);
    }
    const baseHost = origin.hostname.replace(/^www\./u, "");
    const candidates = snapshot.pages.filter((page) => {
      const requested = safeUrl(page.requestedUrl);
      return (
        requested !== null &&
        requested.protocol === "http:" &&
        requested.hostname.replace(/^www\./u, "") === baseHost
      );
    });
    if (candidates.length === 0) {
      return siteUnavailable(
        snapshot,
        "http-to-https",
        "No HTTP variant was observed, so redirect behavior cannot be concluded.",
        ["transport", "redirects"],
      );
    }
    const structuralFailures = candidates.filter((page) => {
      const destination = safeUrl(finalUrl(page));
      return (
        destination === null ||
        destination.protocol !== "https:" ||
        destination.host !== origin.host ||
        page.redirectChain.length === 0
      );
    });
    const missingFinalStatus = candidates.filter(
      (page) => page.statusCode === null && !structuralFailures.includes(page),
    );
    const unsuccessfulFinalStatus = candidates.filter(
      (page) =>
        page.statusCode !== null &&
        !hasConclusiveSuccessfulFinalStatus(page) &&
        !structuralFailures.includes(page),
    );
    const failures = [...structuralFailures, ...unsuccessfulFinalStatus];
    const passing = candidates.filter(
      (page) => !failures.includes(page) && !missingFinalStatus.includes(page),
    );
    const ordered = [...failures, ...missingFinalStatus, ...passing];
    const redirectEvidence = ordered
      .slice(0, 10)
      .map((page) =>
        pageEvidence(page, "http_redirect_outcome", [
          `status=${page.statusCode ?? "unavailable"}`,
          `destination=${boundedEvidenceUrl(finalUrl(page), 512)}`,
          `redirects=${page.redirectChain.length}`,
        ]),
      );
    if (failures.length === 0 && missingFinalStatus.length > 0) {
      return [
        notCheckedOutcome({
          target: siteTarget(snapshot, "http-to-https"),
          snapshot,
          reason:
            "At least one structurally valid HTTP-to-HTTPS redirect has no final target status, so consistent success cannot be concluded.",
          missingData: ["transport"],
          evidence: redirectEvidence,
        }),
      ];
    }
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "http-to-https"),
        failed: failures.length > 0,
        evidence: redirectEvidence,
        detectedValue:
          failures.length === 0
            ? `${candidates.length} observed HTTP URL(s) reached the configured HTTPS host with a successful final status.`
            : `${failures.length} of ${candidates.length} observed HTTP URL(s) did not reach the configured HTTPS host with a successful final status.`,
      }),
    ];
  },
);

const http002 = defineRule(
  {
    id: "HTTP-002",
    title: "www and non-www host variants resolve inconsistently",
    category: "http",
    defaultSeverity: "high",
    scope: "site",
    description: "Compares observed www and apex-host entry points.",
    eligibility:
      "Both www and non-www variants must be observed for at least one equivalent path/query pair with conclusive final statuses.",
    requiredData: ["pages", "transport", "redirects"],
    explanation:
      "Inconsistent host variants can create duplicate URLs, split signals, and make canonical host selection ambiguous.",
    expectedValue: "www and non-www variants resolve to one successful canonical HTTPS host.",
    recommendedFix:
      "Choose one canonical hostname and configure a permanent 301 or 308 redirect from every URL on the alternate hostname to the equivalent canonical URL.",
    verification:
      "Request the homepage and representative paths on both hostname variants and confirm they reach the same successful canonical URL.",
    confidence: "high",
    impactAreas: HTTP_IMPACT,
    responsibleOwner: "infrastructure",
  },
  (snapshot) => {
    const origin = safeUrl(snapshot.origin);
    if (origin === null) {
      return siteUnavailable(snapshot, "host-variants", "The project origin is malformed.", [
        "crawl",
      ]);
    }
    const baseHost = origin.hostname.replace(/^www\./u, "");
    const variants = snapshot.pages.flatMap((page) => {
      const requested = safeUrl(page.requestedUrl);
      if (requested === null) return [];
      const variant =
        requested.hostname === baseHost
          ? "apex"
          : requested.hostname === `www.${baseHost}`
            ? "www"
            : null;
      return variant === null
        ? []
        : [
            Object.freeze({
              page,
              variant,
              pairKey: `${requested.pathname}${requested.search}`,
            }),
          ];
    });
    const www = variants.filter((entry) => entry.variant === "www");
    const apex = variants.filter((entry) => entry.variant === "apex");
    if (www.length === 0 || apex.length === 0) {
      return siteUnavailable(
        snapshot,
        "host-variants",
        "Both www and non-www host variants were not observed.",
        ["transport", "redirects"],
      );
    }
    const pairKeys = [...new Set(variants.map((entry) => entry.pairKey))].sort();
    const pairs = pairKeys.flatMap((pairKey) => {
      const matchingApex = apex.filter((entry) => entry.pairKey === pairKey);
      const matchingWww = www.filter((entry) => entry.pairKey === pairKey);
      if (matchingApex.length === 0 || matchingWww.length === 0) return [];
      const entries = [...matchingApex, ...matchingWww];
      const destinations = entries.map((entry) => normalizedFinalUrl(entry.page));
      const canonicalDestinationFailure = destinations.some((destination) => {
        const parsed = destination === null ? null : safeUrl(destination);
        return parsed === null || parsed.protocol !== "https:" || parsed.host !== origin.host;
      });
      const destinationMismatch = new Set(destinations).size !== 1;
      const unsuccessful = entries.some(
        (entry) =>
          entry.page.statusCode !== null && !hasConclusiveSuccessfulFinalStatus(entry.page),
      );
      const unavailable = entries.some((entry) => entry.page.statusCode === null);
      const state =
        canonicalDestinationFailure || destinationMismatch || unsuccessful
          ? "failed"
          : unavailable
            ? "unavailable"
            : "passed";
      const evidencePriority = (entry: (typeof entries)[number]): number => {
        const destination = normalizedFinalUrl(entry.page);
        const parsed = destination === null ? null : safeUrl(destination);
        if (
          parsed === null ||
          parsed.protocol !== "https:" ||
          parsed.host !== origin.host ||
          (entry.page.statusCode !== null && !hasConclusiveSuccessfulFinalStatus(entry.page))
        ) {
          return 0;
        }
        return entry.page.statusCode === null ? 1 : 2;
      };
      const orderedEntries = [...entries].sort(
        (left, right) =>
          evidencePriority(left) - evidencePriority(right) ||
          left.variant.localeCompare(right.variant) ||
          left.page.normalizedUrl.localeCompare(right.page.normalizedUrl),
      );
      return [Object.freeze({ pairKey, entries: Object.freeze(orderedEntries), state })];
    });
    if (pairs.length === 0) {
      return siteUnavailable(
        snapshot,
        "host-variants",
        "Both host variants were observed, but not for an equivalent path and query pair.",
        ["transport", "redirects"],
      );
    }
    const failedPairs = pairs.filter((pair) => pair.state === "failed");
    const unavailablePairs = pairs.filter((pair) => pair.state === "unavailable");
    const passedPairs = pairs.filter((pair) => pair.state === "passed");
    const orderedPairs = [...failedPairs, ...unavailablePairs, ...passedPairs];
    const pairEvidence = orderedPairs
      .flatMap((pair) =>
        pair.entries.map((entry) =>
          pageEvidence(entry.page, "host_variant_pair", [
            `pair=${boundedEvidenceUrl(pair.pairKey, 512)}`,
            `variant=${entry.variant}`,
            `status=${entry.page.statusCode ?? "unavailable"}`,
            `destination=${boundedEvidenceUrl(finalUrl(entry.page), 512)}`,
          ]),
        ),
      )
      .slice(0, 10);
    if (failedPairs.length === 0 && unavailablePairs.length > 0) {
      return [
        notCheckedOutcome({
          target: siteTarget(snapshot, "host-variants"),
          snapshot,
          reason:
            "At least one equivalent www/apex path and query pair has no final target status.",
          missingData: ["transport"],
          evidence: pairEvidence,
        }),
      ];
    }
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "host-variants"),
        failed: failedPairs.length > 0,
        evidence: pairEvidence,
        detectedValue:
          failedPairs.length === 0
            ? `${passedPairs.length} equivalent path/query pair(s) resolved consistently.`
            : `${failedPairs.length} of ${pairs.length} equivalent path/query pair(s) resolved inconsistently.`,
      }),
    ];
  },
);

const http003 = defineRuleVersion(
  {
    id: "HTTP-003",
    title: "Redirect chain exceeds the configured threshold",
    category: "http",
    defaultSeverity: "high",
    scope: "page",
    description: "Counts followed redirects for every observed page request.",
    eligibility: "A page transport observation is available.",
    requiredData: ["pages", "transport", "redirects", "configuration"],
    explanation:
      "Long redirect chains waste crawl time, add latency, and increase the chance that a crawler abandons the destination.",
    expectedValue: "The redirect chain contains no more than the configured audit threshold.",
    recommendedFix:
      "Update the first redirect and every internal link to point directly to the final canonical URL, then remove obsolete intermediate redirects where safe.",
    verification:
      "Request the original URL and confirm the final destination is reached within the threshold.",
    confidence: "high",
    impactAreas: HTTP_IMPACT,
    responsibleOwner: "developer",
  },
  4,
  (snapshot, policy) =>
    pageResultsOrUnavailable(snapshot, "redirect-chain", snapshot.pages, (page) => {
      const failed = page.redirectChain.length > policy.redirectChainThreshold;
      if (!failed && page.statusCode === null) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason:
            "The request did not reach a conclusive transport response, so the observed redirect chain may be incomplete.",
          missingData: ["transport", "redirects"],
          evidence: [pageEvidence(page, "observed_redirect_hop_count", page.redirectChain.length)],
        });
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [pageEvidence(page, "redirect_hop_count", page.redirectChain.length)],
        detectedValue: `${page.redirectChain.length} redirect hop(s).`,
        expectedValue: `At most ${policy.redirectChainThreshold} redirect hop(s).`,
      });
    }),
);

const http004 = defineRuleVersion(
  {
    id: "HTTP-004",
    title: "Redirect loop detected",
    category: "http",
    defaultSeverity: "critical",
    scope: "page",
    description: "Detects crawler-classified loops and repeated destinations in a redirect chain.",
    eligibility: "A page transport observation is available.",
    requiredData: ["pages", "transport", "redirects"],
    explanation: "A redirect loop prevents users and crawlers from reaching content.",
    expectedValue: "The redirect path terminates at a reachable response without revisiting a URL.",
    recommendedFix:
      "Trace the redirect rules for every URL in the loop, remove the circular rule, and point the original URL directly to one final canonical destination.",
    verification:
      "Request the original URL and confirm a finite redirect path ends at a non-redirect response.",
    confidence: "high",
    impactAreas: HTTP_IMPACT,
    responsibleOwner: "infrastructure",
  },
  3,
  (snapshot) =>
    pageResultsOrUnavailable(snapshot, "redirect-loop", snapshot.pages, (page) => {
      const destinations = page.redirectChain.map((hop) => hop.resolvedUrl);
      const repeated = new Set(destinations).size !== destinations.length;
      const failed = page.errorType === "redirect_loop" || repeated;
      if (!failed && page.statusCode === null) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason:
            "The request did not reach a conclusive transport response, so the observed redirect path cannot prove that no loop exists.",
          missingData: ["transport", "redirects"],
          evidence: [
            pageEvidence(page, "redirect_loop_coverage", [
              page.errorType ?? "no_error_classification",
              page.redirectChain.length,
            ]),
          ],
        });
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [
          pageEvidence(
            page,
            "redirect_loop",
            page.errorType === "redirect_loop" ? "crawler_detected" : repeated,
          ),
        ],
        detectedValue: failed ? "A redirect loop was detected." : "No redirect loop was detected.",
      });
    }),
);

const http005 = defineRuleVersion(
  {
    id: "HTTP-005",
    title: "Internal links point to redirected URLs",
    category: "http",
    defaultSeverity: "medium",
    scope: "page",
    description: "Checks each page's internal link targets for observed redirects.",
    eligibility:
      "The source page has at least one internal link, and every internal target resolves uniquely to a crawled page with conclusive redirect transport data.",
    requiredData: ["links", "pages", "transport", "redirects"],
    explanation:
      "Internal links through redirects add latency and waste crawl budget instead of sending users and crawlers directly to the canonical page.",
    expectedValue: "Internal links point directly to final non-redirecting URLs.",
    recommendedFix:
      "Replace each affected internal href with the target page's final canonical URL and update navigation, templates, and content sources that generate the old URL.",
    verification:
      "Re-crawl the source page and confirm every affected internal target has zero redirect hops.",
    confidence: "high",
    impactAreas: HTTP_IMPACT,
    responsibleOwner: "developer",
  },
  4,
  (snapshot) => {
    const pagesForId = new Map<string, AuditPageObservation[]>();
    const pagesForUrl = new Map<string, AuditPageObservation[]>();
    for (const page of snapshot.pages) {
      pagesForId.set(page.id, [...(pagesForId.get(page.id) ?? []), page]);
      pagesForUrl.set(page.normalizedUrl, [...(pagesForUrl.get(page.normalizedUrl) ?? []), page]);
    }
    const candidates = snapshot.pages
      .map((source) => ({
        source,
        links: source.links.filter((link) => link.scope === "internal"),
      }))
      .filter(
        ({ source, links }) =>
          links.length > 0 ||
          (source.extraction?.source === "raw" && !source.extraction.linksComplete),
      );
    if (candidates.length === 0) {
      return pageUnavailable(
        snapshot,
        "internal-redirect-links",
        "No source page had an internal link to evaluate.",
        ["links"],
      );
    }
    return candidates.map(({ source, links }) => {
      const resolutions = links.map((link) => {
        const matches =
          link.targetPageId === null
            ? (pagesForUrl.get(link.normalizedTargetUrl) ?? [])
            : (pagesForId.get(link.targetPageId) ?? []);
        return Object.freeze({ link, matches: Object.freeze(matches) });
      });
      const unresolved = resolutions.filter(({ matches }) => matches.length !== 1);
      const resolved = resolutions.flatMap(({ link, matches }) =>
        matches.length === 1 ? [{ link, target: matches[0]! }] : [],
      );
      const unavailable = resolved.filter(
        ({ target }) => target.statusCode === null && target.redirectChain.length === 0,
      );
      const redirected = resolved.filter(
        ({ target }) =>
          target.redirectChain.length > 0 ||
          (target.statusCode !== null && target.statusCode >= 300 && target.statusCode < 400),
      );
      const linksComplete = source.extraction?.source === "raw" && source.extraction.linksComplete;
      if (
        redirected.length === 0 &&
        (unresolved.length > 0 || unavailable.length > 0 || !linksComplete)
      ) {
        const missingData = [
          ...(!linksComplete ? (["links"] as const) : []),
          ...(unresolved.length > 0 ? (["pages"] as const) : []),
          ...(unavailable.length > 0 ? (["transport", "redirects"] as const) : []),
        ];
        return notCheckedOutcome({
          target: pageTarget(source),
          snapshot,
          reason: `${linksComplete ? "The persisted source link set was complete." : "The source link set was truncated or its completeness is unavailable."} ${unresolved.length} internal link target(s) were absent or ambiguous and ${unavailable.length} resolved target observation(s) lacked conclusive redirect data.`,
          missingData,
          evidence: [
            pageEvidence(source, "internal_target_coverage", [
              `internal_links=${links.length}`,
              `links_complete=${linksComplete}`,
              `resolved=${resolved.length}`,
              `absent_or_ambiguous=${unresolved.length}`,
              `transport_unavailable=${unavailable.length}`,
              ...sampleEvidenceStrings(
                [
                  ...unresolved.map(
                    ({ link }) =>
                      `unresolved_link=${link.id};target=${boundedEvidenceUrl(link.normalizedTargetUrl)}`,
                  ),
                  ...unavailable.map(
                    ({ link, target }) =>
                      `unavailable_link=${link.id};target=${boundedEvidenceUrl(target.normalizedUrl)}`,
                  ),
                ],
                { maximumItems: 10, maximumItemBytes: 1_024, maximumTotalBytes: 8_192 },
              ),
            ]),
          ],
        });
      }
      const redirectedSummary = sampleEvidenceStrings(
        redirected.map(
          ({ link, target }) =>
            `link=${link.id};target=${boundedEvidenceUrl(target.normalizedUrl)};final=${boundedEvidenceUrl(finalUrl(target))}`,
        ),
        { maximumItems: 10, maximumItemBytes: 1_024, maximumTotalBytes: 8_192 },
      );
      const detailedEvidence = redirected.slice(0, 8).flatMap(({ link, target }) => [
        evidence({
          kind: "link",
          source: "graph",
          observationId: link.id,
          observedAt: source.extraction?.extractedAt ?? source.observedAt,
          field: "internal_redirect_link_target",
          value: boundedEvidenceUrl(link.normalizedTargetUrl),
          url: boundedEvidenceUrl(source.normalizedUrl),
        }),
        evidence({
          kind: "page",
          source: "transport",
          observationId: target.id,
          observedAt: target.observedAt,
          field: "internal_redirect_target_transport",
          value: [
            `status_code=${target.statusCode ?? "unavailable"}`,
            `redirect_hops=${target.redirectChain.length}`,
            `final_url=${boundedEvidenceUrl(finalUrl(target))}`,
          ],
          url: boundedEvidenceUrl(target.normalizedUrl),
        }),
      ]);
      return checkedOutcome({
        target: pageTarget(source),
        failed: redirected.length > 0,
        evidence: [
          evidence({
            kind: "page",
            source: "graph",
            observationId: source.id,
            observedAt: source.extraction?.extractedAt ?? source.observedAt,
            field: "redirected_internal_targets",
            value: [
              `redirected=${redirected.length}`,
              `links_complete=${linksComplete}`,
              ...redirectedSummary,
            ],
            url: boundedEvidenceUrl(source.normalizedUrl),
          }),
          ...detailedEvidence,
        ],
        detectedValue: `${redirected.length} redirected internal link target(s).`,
      });
    });
  },
);

const http006 = defineRuleVersion(
  {
    id: "HTTP-006",
    title: "Temporary redirect is used for an apparently permanent move",
    category: "http",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Uses repeated historical observations to identify persistent 302 or 307 redirects.",
    eligibility:
      "A temporary redirect and prior redirect observations for the same move are available.",
    requiredData: ["redirects", "crawl-history"],
    explanation:
      "A temporary redirect that persists across crawls can leave canonical intent unclear and preserve avoidable redirect processing.",
    expectedValue: "Persistent moves use 301 or 308; genuinely temporary moves remain temporary.",
    recommendedFix:
      "If the destination is intended to remain, change the response to 301 or 308 and update internal links to the final URL; otherwise document and remove the temporary redirect when the event ends.",
    verification:
      "Request the source URL and confirm a permanent move returns 301 or 308, or that the temporary redirect has been removed as scheduled.",
    confidence: "medium",
    impactAreas: HTTP_IMPACT,
    responsibleOwner: "developer",
  },
  5,
  (snapshot) => {
    const temporary = snapshot.pages.filter((page) =>
      page.redirectChain.some((hop) => hop.statusCode === 302 || hop.statusCode === 307),
    );
    if (temporary.length === 0) {
      return pageUnavailable(
        snapshot,
        "temporary-redirect",
        "No temporary redirect was observed.",
        ["redirects"],
      );
    }
    return temporary.map((page) => {
      const hops = page.redirectChain
        .filter((item) => item.statusCode === 302 || item.statusCode === 307)
        .sort(
          (left, right) =>
            left.sequence - right.sequence ||
            left.requestedUrl.localeCompare(right.requestedUrl) ||
            left.resolvedUrl.localeCompare(right.resolvedUrl),
        );
      const observations = hops.map((hop) => {
        const matching = snapshot.historicalRedirects.filter(
          (item) => item.requestedUrl === hop.requestedUrl && item.resolvedUrl === hop.resolvedUrl,
        );
        const historyByCrawl = new Map(matching.map((item) => [item.crawlId, item]));
        return Object.freeze({
          hop,
          history: Object.freeze(
            [...historyByCrawl.values()].sort(
              (left, right) =>
                left.crawlFinishedAt.localeCompare(right.crawlFinishedAt) ||
                left.crawlId.localeCompare(right.crawlId),
            ),
          ),
        });
      });
      const persistent = observations.filter(({ history }) => history.length >= 2);
      const unavailable = observations.filter(({ history }) => history.length === 0);
      const hopEvidence = pageEvidence(
        page,
        "current_temporary_redirects",
        sampleEvidenceStrings(
          observations.map(({ hop, history }) =>
            [
              `sequence=${hop.sequence}`,
              `status_code=${hop.statusCode}`,
              `requested_url=${boundedEvidenceUrl(hop.requestedUrl)}`,
              `resolved_url=${boundedEvidenceUrl(hop.resolvedUrl)}`,
              `matching_prior_crawls=${history.length}`,
            ].join(";"),
          ),
          { maximumItems: 10, maximumItemBytes: 1_024, maximumTotalBytes: 8_192 },
        ),
      );
      const historicalSamples = observations.flatMap(({ hop, history }) =>
        history.map(
          (item) =>
            `sequence=${hop.sequence};crawl_id=${item.crawlId};crawl_finished_at=${item.crawlFinishedAt};observed_at=${item.observedAt};status_code=${item.statusCode};requested_url=${boundedEvidenceUrl(item.requestedUrl)};resolved_url=${boundedEvidenceUrl(item.resolvedUrl)}`,
        ),
      );
      const detailedHistories = observations
        .flatMap(({ hop, history }) => history.map((item) => ({ hop, item })))
        .slice(0, 20);
      const coverageEvidence = crawlEvidence(snapshot, "historical_redirect_coverage", [
        `complete=${snapshot.historicalRedirectCoverage.complete}`,
        `truncated=${snapshot.historicalRedirectCoverage.truncated}`,
        `loaded_page_observations=${snapshot.historicalRedirectCoverage.loadedPageObservationCount}`,
        `loaded_crawls=${snapshot.historicalRedirectCoverage.loadedCrawlCount}`,
        `page_observation_limit=${snapshot.historicalRedirectCoverage.pageObservationLimit}`,
      ]);
      const evidenceItems = [
        hopEvidence,
        crawlEvidence(
          snapshot,
          "historical_redirect_sample",
          sampleEvidenceStrings(historicalSamples, {
            maximumItems: 16,
            maximumItemBytes: 1_024,
            maximumTotalBytes: 12_288,
          }),
        ),
        coverageEvidence,
        ...detailedHistories.map(({ hop, item }) =>
          evidence({
            kind: "redirect",
            source: "transport",
            observationId: `historical-redirect-${evidenceObservationDigest([
              String(hop.sequence),
              boundedEvidenceUrl(item.requestedUrl),
              boundedEvidenceUrl(item.resolvedUrl),
              String(item.statusCode),
              item.crawlId,
              item.observedAt,
            ])}`,
            observedAt: item.observedAt,
            field: "historical_temporary_redirect",
            value: [
              `hop_sequence=${hop.sequence}`,
              `crawl_id=${item.crawlId}`,
              `crawl_finished_at=${item.crawlFinishedAt}`,
              `status_code=${item.statusCode}`,
              `resolved_url=${boundedEvidenceUrl(item.resolvedUrl)}`,
            ],
            url: boundedEvidenceUrl(item.requestedUrl),
          }),
        ),
      ];
      if (persistent.length > 0) {
        return checkedOutcome({
          target: pageTarget(page),
          failed: true,
          evidence: evidenceItems,
          detectedValue: `${persistent.length} of ${observations.length} temporary redirect hop(s) persisted across at least two prior completed crawls.`,
          confidence: "medium",
        });
      }
      if (!snapshot.historicalRedirectCoverage.complete || unavailable.length > 0) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason: !snapshot.historicalRedirectCoverage.complete
            ? "Prior completed-crawl page history was truncated or malformed, so every temporary hop cannot be classified safely."
            : `${unavailable.length} temporary redirect hop(s) have no prior crawl observation, so every hop cannot be classified safely.`,
          missingData: ["crawl-history"],
          evidence: evidenceItems,
        });
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: false,
        evidence: evidenceItems,
        detectedValue: `All ${observations.length} temporary redirect hop(s) were observed in fewer than two prior completed crawls.`,
        confidence: "low",
      });
    });
  },
);

function redirectTargetStatusRule(
  id: "HTTP-007" | "HTTP-008",
  title: string,
  range: Readonly<{ minimum: number; maximum: number; label: string }>,
): AuditRuleDefinition {
  return defineRule(
    {
      id,
      title,
      category: "http",
      defaultSeverity: "high",
      scope: "page",
      description: `Checks the final response after a redirect for a ${range.label} status.`,
      eligibility:
        "The page request followed at least one redirect and has a final response status.",
      requiredData: ["transport", "redirects"],
      explanation: `A redirect that ends at a ${range.label} response sends users and crawlers to an unavailable destination.`,
      expectedValue: "The final redirect target returns a successful response.",
      recommendedFix:
        "Correct the destination so it returns a successful response, or change the original redirect to a valid live canonical URL and update internal links.",
      verification:
        "Follow the original URL and confirm the final target returns a successful 2xx response.",
      confidence: "high",
      impactAreas: HTTP_IMPACT,
      responsibleOwner: "developer",
    },
    (snapshot) => {
      const redirected = snapshot.pages.filter((page) => page.redirectChain.length > 0);
      if (redirected.length === 0) {
        return pageUnavailable(
          snapshot,
          `${id.toLowerCase()}-target`,
          "No redirected page was observed.",
          ["redirects"],
        );
      }
      return redirected.map((page) => {
        if (page.statusCode === null) {
          return notCheckedOutcome({
            target: pageTarget(page),
            snapshot,
            reason: "The redirect was observed, but its final target status is unavailable.",
            missingData: ["transport"],
            evidence: [
              pageEvidence(page, "redirect_target_status", page.statusCode),
              pageEvidence(page, "error_type", page.errorType),
            ],
          });
        }
        const failed = page.statusCode >= range.minimum && page.statusCode <= range.maximum;
        return checkedOutcome({
          target: pageTarget(page),
          failed,
          evidence: [pageEvidence(page, "redirect_target_status", page.statusCode)],
          detectedValue: `Final target status: ${page.statusCode ?? "unavailable"}.`,
        });
      });
    },
  );
}

const http007 = redirectTargetStatusRule("HTTP-007", "Redirect target returns a 4xx response", {
  minimum: 400,
  maximum: 499,
  label: "4xx client-error",
});
const http008 = redirectTargetStatusRule("HTTP-008", "Redirect target returns a 5xx response", {
  minimum: 500,
  maximum: 599,
  label: "5xx server-error",
});

function signalRedirectRule(
  id: "HTTP-009" | "HTTP-010",
  title: string,
  field: "metaRefreshUrl" | "javascriptRedirectUrl",
  signalName: string,
): AuditRuleDefinition {
  return defineRuleVersion(
    {
      id,
      title,
      category: "http",
      defaultSeverity: "medium",
      scope: "page",
      description: `Checks the extracted redirect-signal observation for ${signalName}.`,
      eligibility: `The ${signalName} extraction signal was collected for the page.`,
      requiredData: ["raw-extraction", "redirect-signals"],
      explanation: `${signalName} is less reliable and less transparent than an HTTP redirect for crawlers, browsers, and assistive technologies.`,
      expectedValue: "Navigation changes use an appropriate server-side HTTP redirect.",
      recommendedFix:
        "Replace the client-side redirect with a server-side 301/308 for a permanent move or 302/307 for a temporary move, and link directly to the destination.",
      verification:
        "Disable JavaScript, request the source URL, and confirm the HTTP response performs the intended redirect.",
      confidence: "high",
      impactAreas: HTTP_IMPACT,
      responsibleOwner: "developer",
    },
    3,
    (snapshot) => {
      const candidates = snapshot.pages.filter((page) => page.extraction?.source === "raw");
      if (candidates.length === 0) {
        return pageUnavailable(
          snapshot,
          `${id.toLowerCase()}-signal`,
          `The ${signalName} observation was not collected for any page.`,
          ["raw-extraction", "redirect-signals"],
        );
      }
      return candidates.map((page) => {
        const value = page.extraction?.[field] ?? null;
        const evidenceValue = value === null ? null : boundedEvidenceUrl(value);
        return checkedOutcome({
          target: pageTarget(page),
          failed: value !== null,
          evidence: [pageEvidence(page, field, evidenceValue, "raw")],
          detectedValue:
            value === null ? `No ${signalName} was detected.` : `${signalName}: ${evidenceValue}`,
        });
      });
    },
  );
}

const http009 = signalRedirectRule(
  "HTTP-009",
  "Meta-refresh redirect detected",
  "metaRefreshUrl",
  "meta-refresh redirect",
);
const http010 = signalRedirectRule(
  "HTTP-010",
  "Page depends on a JavaScript-only redirect",
  "javascriptRedirectUrl",
  "JavaScript-only redirect",
);

const http011 = defineRule(
  {
    id: "HTTP-011",
    title: "Redirect Location header is missing, malformed, or unsafe",
    category: "http",
    defaultSeverity: "high",
    scope: "page",
    description: "Uses safe-fetch redirect validation errors and valid followed hops.",
    eligibility: "A valid redirect hop or redirect-validation error was observed.",
    requiredData: ["transport", "redirects"],
    explanation:
      "A missing, malformed, or unsafe Location value prevents a redirect from resolving predictably and may expose a security defect.",
    expectedValue: "Every redirect response has a valid credential-free HTTP(S) Location target.",
    recommendedFix:
      "Return one absolute or correctly resolvable relative HTTP(S) Location value without credentials, unsafe ports, private destinations, or protocol downgrade.",
    verification:
      "Request the redirect URL and validate every Location value before confirming the destination response.",
    confidence: "high",
    impactAreas: [...HTTP_IMPACT, "security"],
    responsibleOwner: "developer",
  },
  (snapshot) => {
    const unsafeErrors = new Set([
      "blocked_address",
      "blocked_hostname",
      "https_downgrade",
      "invalid_redirect",
      "unsafe_port",
      "unsupported_protocol",
      "userinfo_not_allowed",
    ]);
    const candidates = snapshot.pages.filter(
      (page) =>
        page.redirectChain.length > 0 ||
        (page.errorType !== null && unsafeErrors.has(page.errorType)),
    );
    if (candidates.length === 0) {
      return pageUnavailable(
        snapshot,
        "redirect-location",
        "No redirect response or redirect-validation error was observed.",
        ["redirects"],
      );
    }
    return candidates.map((page) => {
      const failed = page.errorType !== null && unsafeErrors.has(page.errorType);
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [
          pageEvidence(
            page,
            "location_validation",
            failed ? page.errorType : page.redirectChain.map((hop) => hop.resolvedUrl),
          ),
        ],
        detectedValue: failed
          ? `Redirect validation failed: ${page.errorType}.`
          : `${page.redirectChain.length} valid redirect Location value(s).`,
      });
    });
  },
);

const http012 = defineRuleVersion(
  {
    id: "HTTP-012",
    title: "HTML content is served with an incorrect MIME type",
    category: "http",
    defaultSeverity: "medium",
    scope: "page",
    description: "Compares an observed HTML document with its declared response content type.",
    eligibility: "A bounded prefix of the actual response body was inspected for HTML markers.",
    requiredData: ["transport"],
    explanation:
      "An incorrect MIME type can prevent consistent parsing, trigger browser protections, and cause crawlers to treat HTML as another resource type.",
    expectedValue: "HTML documents use text/html or application/xhtml+xml.",
    recommendedFix:
      "Configure the server or storage metadata to send text/html; charset=utf-8 for HTML, or application/xhtml+xml only for valid XHTML.",
    verification:
      "Request the URL and confirm its Content-Type matches the returned HTML document.",
    confidence: "high",
    impactAreas: HTTP_IMPACT,
    responsibleOwner: "developer",
  },
  3,
  (snapshot) => {
    const candidates = snapshot.pages.filter(
      (page) =>
        page.htmlDetected !== null ||
        page.htmlDetectionSource !== null ||
        page.htmlDetectionBytes !== null,
    );
    if (candidates.length === 0) {
      return pageUnavailable(
        snapshot,
        "html-mime",
        "No HTML detection observation was available.",
        ["transport"],
      );
    }
    return candidates.map((page) => {
      if (
        page.htmlDetected === null ||
        page.htmlDetectionSource !== "bounded_response_prefix" ||
        page.htmlDetectionBytes === null
      ) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason: "The HTML sniff result is missing bounded response-prefix provenance.",
          missingData: ["transport"],
          evidence: [
            pageEvidence(page, "html_detected", page.htmlDetected),
            pageEvidence(page, "html_detection_source", page.htmlDetectionSource),
            pageEvidence(page, "html_detection_bytes", page.htmlDetectionBytes),
          ],
        });
      }
      if (page.htmlDetected === false) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason:
            "The bounded response prefix did not contain a conclusive HTML marker, so the HTML MIME rule is ineligible.",
          state: "ineligible",
          missingData: [],
          evidence: [
            pageEvidence(page, "html_detected", false),
            pageEvidence(page, "html_detection_source", page.htmlDetectionSource),
            pageEvidence(page, "html_detection_bytes", page.htmlDetectionBytes),
            pageEvidence(page, "content_type", page.contentType),
          ],
        });
      }
      const failed = !isHtmlContentType(page.contentType);
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [
          pageEvidence(page, "html_detected", true),
          pageEvidence(page, "html_detection_source", page.htmlDetectionSource),
          pageEvidence(page, "html_detection_bytes", page.htmlDetectionBytes),
          pageEvidence(page, "content_type", page.contentType),
        ],
        detectedValue: `HTML detected: true; Content-Type: ${page.contentType ?? "missing"}.`,
      });
    });
  },
);

const http013 = defineRuleVersion(
  {
    id: "HTTP-013",
    title: "Page response exceeds the configured size threshold",
    category: "http",
    defaultSeverity: "high",
    scope: "page",
    description: "Compares declared and observed response sizes with the crawl snapshot limit.",
    eligibility: "A page size observation or size-limit error is available.",
    requiredData: ["pages", "transport", "configuration"],
    explanation:
      "Very large responses consume crawl budget, memory, bandwidth, and user download time, and may be truncated before analysis completes.",
    expectedValue: "The page response remains within the configured maximum response bytes.",
    recommendedFix:
      "Reduce the HTML or text payload, remove embedded data and unused markup, paginate oversized content where appropriate, and keep the final response below the configured limit.",
    verification:
      "Request the page with compression accounted for and confirm its decoded response size is below the configured threshold.",
    confidence: "high",
    impactAreas: HTTP_IMPACT,
    responsibleOwner: "developer",
  },
  3,
  (snapshot) =>
    pageResultsOrUnavailable(snapshot, "response-size", snapshot.pages, (page) => {
      const maximum = Math.max(page.responseBytes, page.transferSize, page.contentLength ?? 0);
      if (page.errorType === "response_too_large") {
        return checkedOutcome({
          target: pageTarget(page),
          failed: true,
          evidence: [
            pageEvidence(page, "error_type", page.errorType),
            pageEvidence(page, "maximum_observed_or_declared_bytes", maximum),
          ],
          detectedValue: "The safe fetcher stopped an oversized response.",
          expectedValue: `At most ${snapshot.configuration.maxResponseBytes} byte(s).`,
        });
      }
      if (page.statusCode === null || page.errorType !== null) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason:
            "The response did not complete with a conclusive final status and byte count, so its full size is unavailable.",
          missingData: ["transport"],
          evidence: [
            pageEvidence(page, "error_type", page.errorType),
            pageEvidence(page, "status_code", page.statusCode),
            pageEvidence(page, "maximum_observed_or_declared_bytes", maximum),
          ],
        });
      }
      const failed = maximum > snapshot.configuration.maxResponseBytes;
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [pageEvidence(page, "maximum_observed_or_declared_bytes", maximum)],
        detectedValue: `${maximum} byte(s).`,
        expectedValue: `At most ${snapshot.configuration.maxResponseBytes} byte(s).`,
      });
    }),
);

const http014 = defineRule(
  {
    id: "HTTP-014",
    title: "Compressible text response is not compressed",
    category: "http",
    defaultSeverity: "medium",
    scope: "page",
    description: "Checks sufficiently large text responses for a content encoding.",
    eligibility: "A successful compressible response meets the minimum compression size.",
    requiredData: ["transport"],
    explanation:
      "Uncompressed text increases transfer time and bandwidth without changing the page content.",
    expectedValue: "Eligible text responses use br or gzip compression.",
    recommendedFix:
      "Enable Brotli or gzip for HTML, CSS, JavaScript, JSON, SVG, and XML responses at the CDN or origin, and vary cached responses by Accept-Encoding.",
    verification:
      "Request the resource with Accept-Encoding: br, gzip and confirm Content-Encoding and a reduced transfer size.",
    confidence: "high",
    impactAreas: ["user-experience", "crawlability"],
    responsibleOwner: "infrastructure",
  },
  (snapshot, policy) => {
    const candidates = snapshot.pages.filter((page) => {
      const type = normalizedContentType(page.contentType);
      return (
        isSuccessful(page) &&
        type !== null &&
        TEXT_CONTENT_TYPES.has(type) &&
        page.responseBytes >= policy.minimumCompressionBytes
      );
    });
    if (candidates.length === 0) {
      return pageUnavailable(
        snapshot,
        "text-compression",
        "No sufficiently large successful compressible response was observed.",
        ["transport"],
      );
    }
    return candidates.map((page) => {
      const compression = page.compression?.toLowerCase() ?? "identity";
      const failed = compression === "identity" || compression === "none";
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [pageEvidence(page, "content_encoding", compression)],
        detectedValue: `Content encoding: ${compression}; decoded bytes: ${page.responseBytes}.`,
      });
    });
  },
);

const http015 = defineRuleVersion(
  {
    id: "HTTP-015",
    title: "HTTPS site lacks an appropriate HSTS policy",
    category: "http",
    defaultSeverity: "low",
    scope: "site",
    description: "Checks the HTTPS homepage Strict-Transport-Security max-age.",
    eligibility: "A successful HTTPS homepage response with security headers is available.",
    requiredData: ["transport", "headers"],
    explanation:
      "HSTS tells supporting browsers to use HTTPS for future visits and reduces exposure to protocol downgrade on repeat navigation.",
    expectedValue: "Strict-Transport-Security declares max-age of at least 15552000 seconds.",
    recommendedFix:
      "After confirming the whole site works over HTTPS, send Strict-Transport-Security: max-age=31536000; includeSubDomains from the canonical HTTPS host; add preload only after reviewing its long-lived requirements.",
    verification:
      "Request the canonical HTTPS homepage and confirm the Strict-Transport-Security header contains a valid max-age of at least 15552000.",
    confidence: "high",
    impactAreas: ["security", "user-experience"],
    responsibleOwner: "infrastructure",
  },
  3,
  (snapshot) => {
    if (safeUrl(snapshot.origin)?.protocol !== "https:") {
      return [
        notCheckedOutcome({
          target: siteTarget(snapshot, "hsts"),
          snapshot,
          state: "ineligible",
          reason: "HSTS applies only to an HTTPS origin.",
          missingData: [],
        }),
      ];
    }
    const homepage = snapshot.pages.find(
      (page) => page.importance === "homepage" || page.discoverySource === "seed",
    );
    if (homepage === undefined || !isSuccessful(homepage)) {
      return siteUnavailable(
        snapshot,
        "hsts",
        "A successful HTTPS homepage response was not available.",
        ["transport", "headers"],
      );
    }
    const values = headerValues(homepage.securityHeaders, "strict-transport-security");
    const assessment = assessEffectiveHstsPolicy(values);
    const adequate =
      assessment.state === "valid" && BigInt(assessment.maxAge) >= MINIMUM_HSTS_MAX_AGE;
    const effectiveHeader = values[0];
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "hsts"),
        failed: !adequate,
        evidence: [
          evidence({
            kind: "header",
            source: "transport",
            observationId: homepage.id,
            observedAt: homepage.observedAt,
            field: "strict-transport-security",
            value: [
              `header_count=${values.length}`,
              `effective_header=${
                effectiveHeader === undefined
                  ? "missing"
                  : boundedEvidenceText(effectiveHeader, 2_048)
              }`,
              `parse_state=${assessment.state}`,
              `effective_max_age=${assessment.maxAge ?? "unavailable"}`,
            ],
            url: homepage.normalizedUrl,
          }),
        ],
        detectedValue:
          assessment.state === "missing"
            ? "Strict-Transport-Security is missing."
            : assessment.state === "invalid"
              ? "The first Strict-Transport-Security header has no single valid max-age directive."
              : `The first Strict-Transport-Security header declares max-age ${assessment.maxAge}.`,
      }),
    ];
  },
);

export const HTTP_RULES: readonly AuditRuleDefinition[] = Object.freeze([
  http001,
  http002,
  http003,
  http004,
  http005,
  http006,
  http007,
  http008,
  http009,
  http010,
  http011,
  http012,
  http013,
  http014,
  http015,
]);
