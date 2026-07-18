import type {
  AuditEvidenceItem,
  AuditEvidenceScalar,
  AuditEvidenceSource,
} from "@searvia/shared-types";

import type { AuditObservationKey, AuditRuleDefinition, AuditRuleOutcome } from "../contracts.js";
import type {
  AuditCrawlSnapshot,
  AuditPageLink,
  AuditPageObservation,
  AuditRobotsObservation,
  AuditSitemapObservation,
} from "../snapshot.js";
import {
  checkedOutcome,
  crawlEvidence,
  defineRule,
  defineRuleVersion,
  directiveSet,
  evidence,
  hasNoindex,
  importantPages,
  isHtmlContentType,
  isIndexable,
  isSuccessful,
  notCheckedOutcome,
  pageIndexabilityState,
  pageIndexabilityMissingData,
  pageEvidence as extractedPageEvidence,
  pageTarget,
  pageUnavailable,
  safeUrl,
  siteTarget,
  siteUnavailable,
  sitemapEntriesForPage,
} from "./helpers.js";

const CRAWLABILITY_IMPACTS = ["crawlability", "search-visibility", "ai-retrievability"] as const;
const INDEXABILITY_IMPACTS = ["indexability", "search-visibility", "ai-retrievability"] as const;
const AVAILABILITY_IMPACTS = [
  "crawlability",
  "search-visibility",
  "ai-retrievability",
  "user-experience",
] as const;
const NAVIGATION_LINK_TYPES = new Set<AuditPageLink["linkType"]>(["anchor", "area", "pagination"]);
const TIMEOUT_ERROR_TYPES = new Set([
  "dns_timeout",
  "connect_timeout",
  "headers_timeout",
  "idle_timeout",
  "request_timeout",
]);
const POST_DNS_ERROR_TYPES = new Set([
  "connect_timeout",
  "headers_timeout",
  "https_downgrade",
  "idle_timeout",
  "invalid_redirect",
  "network_error",
  "out_of_scope",
  "parse_error",
  "redirect_limit",
  "redirect_loop",
  "request_timeout",
  "response_too_large",
  "unsupported_content_encoding",
  "unsupported_content_type",
]);
const SOFT_404_TITLE =
  /^(?:404(?:\s+error)?|page\s+not\s+found|not\s+found|content\s+not\s+found|page\s+unavailable)(?:\s*(?:[|:\-–—])\s*.*)?$/iu;
const SOFT_404_TEXT =
  /^(?:404(?:\s+error)?|page\s+not\s+found|not\s+found|content\s+not\s+found|page\s+unavailable)\b/iu;
const PAGE_LIKE_EXTENSIONS = new Set(["", "asp", "aspx", "cfm", "htm", "html", "jsp", "php"]);

interface InternalLinkObservation {
  readonly source: AuditPageObservation;
  readonly link: AuditPageLink;
}

function configurationEvidence(
  snapshot: AuditCrawlSnapshot,
  field: string,
  value: boolean | number | string | null,
): AuditEvidenceItem {
  return evidence({
    kind: "configuration",
    source: "configuration",
    observationId: snapshot.crawlId,
    observedAt: snapshot.finishedAt,
    field,
    value,
    url: snapshot.origin,
  });
}

function pageEvidence(
  page: AuditPageObservation,
  field: string,
  value: AuditEvidenceScalar | readonly AuditEvidenceScalar[],
  source: AuditEvidenceSource = "transport",
): AuditEvidenceItem {
  if (source === "raw" || source === "rendered") {
    return extractedPageEvidence(page, field, value, source);
  }
  return evidence({
    kind: "page",
    source,
    observationId: page.id,
    observedAt: page.observedAt,
    field,
    value,
    url: page.normalizedUrl,
  });
}

function linkEvidence(observation: InternalLinkObservation, targetUrl: string): AuditEvidenceItem {
  return evidence({
    kind: "link",
    source: "graph",
    observationId: observation.link.id,
    observedAt: observation.source.extraction?.extractedAt ?? observation.source.observedAt,
    field: "internalLinkSource",
    value: observation.source.normalizedUrl,
    url: targetUrl,
  });
}

function sitemapEvidence(
  sitemap: AuditSitemapObservation,
  field: string,
  value: boolean | number | string | null | readonly (boolean | number | string | null)[],
): AuditEvidenceItem {
  return evidence({
    kind: "sitemap",
    source: "sitemap",
    observationId: sitemap.id,
    observedAt: sitemap.observedAt,
    field,
    value,
    url: sitemap.normalizedUrl,
  });
}

function robotsEvidence(
  robots: AuditRobotsObservation,
  field: string,
  value: AuditEvidenceScalar | readonly AuditEvidenceScalar[],
): AuditEvidenceItem {
  return evidence({
    kind: "robots",
    source: "robots",
    observationId: robots.id,
    observedAt: robots.fetchedAt,
    field,
    value,
    url: robots.requestedUrl,
  });
}

function robotsForPage(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
): AuditRobotsObservation | undefined {
  if (page.robotsObservationId !== undefined && page.robotsObservationId !== null) {
    return snapshot.robots.find((robots) => robots.id === page.robotsObservationId);
  }
  const pageUrl = safeUrl(page.normalizedUrl);
  return pageUrl === null
    ? undefined
    : snapshot.robots.find((robots) => robots.origin === pageUrl.origin);
}

function internalNavigationLinks(
  snapshot: AuditCrawlSnapshot,
  target: AuditPageObservation,
): readonly InternalLinkObservation[] {
  return Object.freeze(
    snapshot.pages.flatMap((source) =>
      source.links
        .filter(
          (link) =>
            link.scope === "internal" &&
            NAVIGATION_LINK_TYPES.has(link.linkType) &&
            (link.targetPageId === target.id || link.normalizedTargetUrl === target.normalizedUrl),
        )
        .map((link) => Object.freeze({ source, link })),
    ),
  );
}

function pageOutcomesOrUnavailable(
  outcomes: readonly AuditRuleOutcome[],
  snapshot: AuditCrawlSnapshot,
  key: string,
  reason: string,
  missingData: readonly AuditObservationKey[],
): readonly AuditRuleOutcome[] {
  return outcomes.length > 0
    ? Object.freeze([...outcomes])
    : pageUnavailable(snapshot, key, reason, missingData);
}

function extractionUnavailable(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
  reason: string,
): AuditRuleOutcome {
  return notCheckedOutcome({
    target: pageTarget(page),
    snapshot,
    reason,
    missingData: ["raw-extraction"],
    evidence: [pageEvidence(page, "extraction", "unavailable")],
  });
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function boundedEvidenceText(value: string, maximum = 500): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 3)}...`;
}

function soft404Signals(page: AuditPageObservation): readonly string[] {
  const extraction = page.extraction;
  if (extraction === null) return [];
  const signals: string[] = [];
  if (extraction.title !== null && SOFT_404_TITLE.test(normalizedText(extraction.title))) {
    signals.push("title");
  }
  const leadingText = normalizedText(extraction.visibleText ?? "").slice(0, 300);
  if (SOFT_404_TEXT.test(leadingText)) signals.push("visible-text");
  return Object.freeze(signals);
}

function expandedDirectives(values: readonly string[]): ReadonlySet<string> {
  const result = new Set(directiveSet(values));
  if (result.has("all")) {
    result.add("index");
    result.add("follow");
  }
  if (result.has("none")) {
    result.add("noindex");
    result.add("nofollow");
  }
  return result;
}

function directiveConflicts(
  metaValues: readonly string[],
  headerValues: readonly string[],
): readonly string[] {
  const meta = expandedDirectives(metaValues);
  const header = expandedDirectives(headerValues);
  const opposites = [
    ["index", "noindex"],
    ["follow", "nofollow"],
    ["archive", "noarchive"],
    ["snippet", "nosnippet"],
    ["imageindex", "noimageindex"],
    ["translate", "notranslate"],
  ] as const;
  return Object.freeze(
    opposites.flatMap(([positive, negative]) => {
      if (
        (meta.has(positive) && header.has(negative)) ||
        (meta.has(negative) && header.has(positive))
      ) {
        return [`${positive}/${negative}`];
      }
      return [];
    }),
  );
}

function isPageLikeUrl(value: string): boolean {
  const url = safeUrl(value);
  if (url === null) return false;
  const segment = url.pathname.split("/").at(-1) ?? "";
  if (segment === "") return true;
  const dot = segment.lastIndexOf(".");
  const extension = dot < 0 ? "" : segment.slice(dot + 1).toLowerCase();
  return PAGE_LIKE_EXTENSIONS.has(extension);
}

const crw001 = defineRuleVersion(
  {
    id: "CRW-001",
    title: "Domain DNS resolution failed",
    category: "crawlability",
    defaultSeverity: "critical",
    scope: "site",
    description: "Checks whether the configured homepage hostname resolved through public DNS.",
    eligibility:
      "The crawl contains a seed-page transport observation with a final status, an explicit DNS/post-DNS outcome, or a robots HTTP observation for the same origin.",
    requiredData: ["crawl", "pages", "transport", "robots"],
    explanation:
      "A domain that does not resolve cannot be reached by people, search crawlers, or AI retrieval systems.",
    expectedValue: "The configured hostname resolves to at least one validated public address.",
    recommendedFix:
      "Create or correct the hostname's authoritative A, AAAA, or CNAME record, remove dead targets, wait for DNS propagation, and run the crawl again.",
    verification:
      "Resolve the hostname from a public resolver, then rerun the crawl and confirm that the seed request advances beyond DNS validation.",
    confidence: "high",
    impactAreas: AVAILABILITY_IMPACTS,
    responsibleOwner: "infrastructure",
  },
  4,
  (snapshot) => {
    const seed = snapshot.pages.find((page) => page.discoverySource === "seed");
    if (seed === undefined) {
      return siteUnavailable(
        snapshot,
        "dns-resolution",
        "The crawl has no seed-page transport observation, so DNS resolution cannot be evaluated.",
        ["pages", "transport"],
      );
    }
    const robots = robotsForPage(snapshot, seed);
    const failed = seed.errorType === "dns_failure" || seed.errorType === "dns_timeout";
    const resolutionConfirmed =
      seed.statusCode !== null ||
      (seed.errorType !== null && POST_DNS_ERROR_TYPES.has(seed.errorType)) ||
      (robots !== undefined && robots.statusCode !== null);
    if (!failed && !resolutionConfirmed) {
      return [
        notCheckedOutcome({
          target: siteTarget(snapshot, "dns-resolution"),
          snapshot,
          reason:
            "The seed observation has neither a final HTTP status nor a post-DNS transport outcome, so DNS resolution cannot be concluded.",
          missingData: ["transport"],
          evidence: [
            pageEvidence(seed, "statusCode", seed.statusCode),
            pageEvidence(seed, "errorType", seed.errorType),
            pageEvidence(seed, "robotsDecision", seed.robotsDecision),
            ...(robots === undefined
              ? []
              : [robotsEvidence(robots, "statusCode", robots.statusCode)]),
          ],
        }),
      ];
    }
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "dns-resolution"),
        failed,
        evidence: [
          pageEvidence(seed, "errorType", seed.errorType ?? "none"),
          pageEvidence(seed, "statusCode", seed.statusCode),
          pageEvidence(seed, "requestedUrl", seed.requestedUrl),
          pageEvidence(seed, "robotsDecision", seed.robotsDecision),
          ...(robots === undefined
            ? []
            : [
                robotsEvidence(robots, "statusCode", robots.statusCode),
                robotsEvidence(robots, "result", robots.result),
              ]),
        ],
        detectedValue: failed
          ? `DNS resolution ended with ${seed.errorType ?? "an unknown DNS error"}.`
          : seed.statusCode !== null
            ? `DNS resolution was confirmed before the final HTTP ${seed.statusCode} response.`
            : robots !== undefined && robots.statusCode !== null
              ? `DNS resolution was confirmed by the robots.txt HTTP ${robots.statusCode} observation.`
              : `DNS resolution advanced to the post-DNS ${seed.errorType ?? "transport"} outcome.`,
      }),
    ];
  },
);

const crw002 = defineRuleVersion(
  {
    id: "CRW-002",
    title: "Homepage is unreachable",
    category: "crawlability",
    defaultSeverity: "critical",
    scope: "site",
    description: "Checks whether the configured homepage returned a usable final HTTP response.",
    eligibility:
      "The crawl contains a seed-page transport observation and its request was allowed by robots.txt.",
    requiredData: ["crawl", "pages", "transport", "robots"],
    explanation:
      "An unavailable homepage prevents discovery of the site and usually indicates a broad visitor-facing outage.",
    expectedValue: "The homepage returns a final HTTP status below 400.",
    recommendedFix:
      "Restore the configured homepage route so it returns a stable 2xx HTML response; repair the reported network, origin, firewall, robots, or application error before rerunning the crawl.",
    verification:
      "Request the configured homepage without authentication and rerun the crawl to confirm a final status below 400.",
    confidence: "high",
    impactAreas: AVAILABILITY_IMPACTS,
    responsibleOwner: "developer",
  },
  4,
  (snapshot) => {
    const seed = snapshot.pages.find((page) => page.discoverySource === "seed");
    if (seed === undefined) {
      return siteUnavailable(
        snapshot,
        "homepage-reachability",
        "The crawl has no seed-page observation, so homepage reachability cannot be evaluated.",
        ["pages", "transport"],
      );
    }
    if (seed.statusCode === null && seed.robotsDecision !== "allowed") {
      return [
        notCheckedOutcome({
          target: siteTarget(snapshot, "homepage-reachability"),
          snapshot,
          reason:
            "The homepage request was not attempted because robots evaluation did not produce an allow decision.",
          missingData: ["transport", "robots"],
          evidence: [
            pageEvidence(seed, "statusCode", seed.statusCode),
            pageEvidence(seed, "errorType", seed.errorType ?? "none"),
            pageEvidence(seed, "robotsDecision", seed.robotsDecision),
          ],
        }),
      ];
    }
    const failed = seed.statusCode === null || seed.statusCode >= 400;
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "homepage-reachability"),
        failed,
        evidence: [
          pageEvidence(seed, "statusCode", seed.statusCode),
          pageEvidence(seed, "errorType", seed.errorType ?? "none"),
        ],
        detectedValue:
          seed.statusCode === null
            ? `No final response was received (${seed.errorType ?? "transport unavailable"}).`
            : `The homepage returned HTTP ${seed.statusCode}.`,
      }),
    ];
  },
);

const crw003 = defineRuleVersion(
  {
    id: "CRW-003",
    title: "Page request timed out",
    category: "crawlability",
    defaultSeverity: "high",
    scope: "page",
    description:
      "Checks each attempted page for a bounded DNS, connection, header, idle, or request timeout.",
    eligibility:
      "A page request was allowed by robots.txt and has a final response or an explicit transport outcome.",
    requiredData: ["pages", "transport", "robots"],
    explanation:
      "A timed-out request is not reliably accessible to crawlers or visitors and leaves the page content unevaluated.",
    expectedValue: "The page completes within the configured request timeout.",
    recommendedFix:
      "Repair the timeout phase reported in the evidence by fixing DNS or connection latency, reducing origin response time, and ensuring the response body continues to make progress within the configured limit.",
    verification:
      "Rerun the crawl and confirm that the page records a final status and no DNS, connection, header, idle, or request timeout.",
    confidence: "high",
    impactAreas: AVAILABILITY_IMPACTS,
    responsibleOwner: "infrastructure",
  },
  4,
  (snapshot) => {
    if (snapshot.pages.length === 0) {
      return pageUnavailable(
        snapshot,
        "timeouts",
        "No page transport observations are available.",
        ["pages", "transport"],
      );
    }
    return Object.freeze(
      snapshot.pages.map((page) => {
        if (page.statusCode === null && page.robotsDecision !== "allowed") {
          return notCheckedOutcome({
            target: pageTarget(page),
            snapshot,
            reason:
              "The page request was not attempted because robots evaluation did not produce an allow decision.",
            missingData: ["transport", "robots"],
            evidence: [
              pageEvidence(page, "errorType", page.errorType ?? "none"),
              pageEvidence(page, "robotsDecision", page.robotsDecision),
            ],
          });
        }
        if (page.statusCode === null && page.errorType === null) {
          return notCheckedOutcome({
            target: pageTarget(page),
            snapshot,
            reason: "The page has neither a final response nor an explicit transport outcome.",
            missingData: ["transport"],
            evidence: [pageEvidence(page, "transportOutcome", "unavailable")],
          });
        }
        const failed = page.errorType !== null && TIMEOUT_ERROR_TYPES.has(page.errorType);
        return checkedOutcome({
          target: pageTarget(page),
          failed,
          evidence: [pageEvidence(page, "errorType", page.errorType ?? "none")],
          detectedValue: failed
            ? `The request ended with ${page.errorType ?? "a timeout"}.`
            : "No request-timeout outcome was recorded.",
        });
      }),
    );
  },
);

function linkedStatusRule(
  input: Readonly<{
    id: "CRW-004" | "CRW-005";
    title: string;
    defaultSeverity: "high" | "critical";
    minimum: number;
    maximum: number;
    expectedValue: string;
    explanation: string;
    recommendedFix: string;
  }>,
): AuditRuleDefinition {
  return defineRuleVersion(
    {
      id: input.id,
      title: input.title,
      category: "crawlability",
      defaultSeverity: input.defaultSeverity,
      scope: "page",
      description: `Checks fetched targets of internal navigation links for ${input.minimum}-${input.maximum} responses.`,
      eligibility: "At least one internal navigation link points to a target with a final status.",
      requiredData: ["pages", "transport", "links"],
      explanation: input.explanation,
      expectedValue: input.expectedValue,
      recommendedFix: input.recommendedFix,
      verification:
        "Request the target URL, update every sampled source link, and rerun the crawl until the target returns a non-error final status.",
      confidence: "high",
      impactAreas: AVAILABILITY_IMPACTS,
      responsibleOwner: "developer",
    },
    3,
    (snapshot) => {
      const linkedPages = snapshot.pages
        .map((page) => Object.freeze({ page, links: internalNavigationLinks(snapshot, page) }))
        .filter((candidate) => candidate.links.length > 0);
      const outcomes = linkedPages.map(({ page, links }) => {
        if (page.statusCode === null) {
          return notCheckedOutcome({
            target: pageTarget(page),
            snapshot,
            reason: "The internally linked target has no final HTTP status.",
            missingData: ["transport"],
            evidence: [
              ...links.slice(0, 3).map((link) => linkEvidence(link, page.normalizedUrl)),
              pageEvidence(page, "statusCode", null),
            ],
          });
        }
        const failed = page.statusCode >= input.minimum && page.statusCode <= input.maximum;
        return checkedOutcome({
          target: pageTarget(page),
          failed,
          evidence: [
            pageEvidence(page, "statusCode", page.statusCode),
            ...links.slice(0, 5).map((link) => linkEvidence(link, page.normalizedUrl)),
          ],
          detectedValue: `The internally linked target returned HTTP ${page.statusCode}.`,
          expectedValue: input.expectedValue,
        });
      });
      return pageOutcomesOrUnavailable(
        outcomes,
        snapshot,
        input.id.toLowerCase(),
        "No fetched page has an observed inbound internal navigation link.",
        ["links"],
      );
    },
  );
}

const crw004 = linkedStatusRule({
  id: "CRW-004",
  title: "Internally linked page returns a 4xx response",
  defaultSeverity: "high",
  minimum: 400,
  maximum: 499,
  expectedValue: "Internally linked targets return a final status outside the 4xx range.",
  explanation:
    "A 4xx target sends visitors and crawlers to a missing, forbidden, or otherwise unavailable destination.",
  recommendedFix:
    "Restore the target at the linked URL or change every internal source link to the live final URL; remove the link if no replacement exists.",
});

const crw005 = linkedStatusRule({
  id: "CRW-005",
  title: "Internally linked page returns a 5xx response",
  defaultSeverity: "critical",
  minimum: 500,
  maximum: 599,
  expectedValue: "Internally linked targets return a final status outside the 5xx range.",
  explanation:
    "A 5xx target indicates an origin or upstream failure and can make important site paths unavailable without warning.",
  recommendedFix:
    "Repair the failing application or upstream service so the target returns a stable 2xx response, or update every internal source link to a healthy replacement URL.",
});

const crw006 = defineRule(
  {
    id: "CRW-006",
    title: "Page appears to be a soft 404",
    category: "crawlability",
    defaultSeverity: "high",
    scope: "page",
    description:
      "Detects a high-confidence not-found message returned as a short HTTP 200 HTML page.",
    eligibility: "The page has a raw HTML extraction and returned HTTP 200.",
    requiredData: ["pages", "transport", "raw-extraction"],
    explanation:
      "A soft 404 returns a success status for missing content, which obscures removal signals and wastes crawl attention.",
    expectedValue:
      "Missing content returns 404 or 410; real HTTP 200 pages contain their intended content.",
    recommendedFix:
      "If the URL is missing, return HTTP 404 or 410 while keeping the helpful error template; otherwise restore substantive page content and keep HTTP 200.",
    verification:
      "Request the URL and rerun the crawl, confirming that missing content returns 404 or 410 or that the restored 200 page no longer matches the not-found signature.",
    confidence: "medium",
    impactAreas: INDEXABILITY_IMPACTS,
    responsibleOwner: "developer",
  },
  (snapshot, policy) => {
    const candidates = snapshot.pages.filter(
      (page) => page.statusCode === 200 && isHtmlContentType(page.contentType),
    );
    const outcomes = candidates.map((page) => {
      if (page.extraction === null || page.extraction.source !== "raw") {
        return extractionUnavailable(
          snapshot,
          page,
          "A raw HTML extraction is required for soft-404 detection.",
        );
      }
      const signals = soft404Signals(page);
      const failed = page.extraction.wordCount <= policy.soft404MaximumWords && signals.length > 0;
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [
          pageEvidence(page, "statusCode", page.statusCode),
          pageEvidence(page, "title", page.extraction.title ?? "missing", "raw"),
          pageEvidence(page, "wordCount", page.extraction.wordCount, "raw"),
          pageEvidence(page, "soft404Signals", signals, "raw"),
          configurationEvidence(snapshot, "soft404MaximumWords", policy.soft404MaximumWords),
        ],
        detectedValue: failed
          ? `HTTP 200 page matched ${signals.join(" and ")} not-found evidence with ${page.extraction.wordCount} words.`
          : "The HTTP 200 page did not match the bounded soft-404 signature.",
        confidence: "medium",
      });
    });
    return pageOutcomesOrUnavailable(
      outcomes,
      snapshot,
      "soft-404",
      "No HTTP 200 HTML page is available for soft-404 evaluation.",
      ["pages", "transport", "raw-extraction"],
    );
  },
);

function noindexRule(
  input: Readonly<{
    id: "CRW-007" | "CRW-008";
    title: string;
    field: "metaRobots" | "xRobotsTag";
    sourceName: string;
    recommendedFix: string;
  }>,
): AuditRuleDefinition {
  return defineRuleVersion(
    {
      id: input.id,
      title: input.title,
      category: "crawlability",
      defaultSeverity: "high",
      scope: "page",
      description: `Checks intended-indexable pages for an applicable ${input.sourceName} noindex directive.`,
      eligibility:
        "The page is explicitly classified as intended for indexing and has a raw successful HTML extraction.",
      requiredData: ["pages", "transport", "raw-extraction"],
      explanation:
        "A noindex directive conflicts with the recorded indexing intent and asks compliant search systems to exclude the page.",
      expectedValue: `An intended-indexable page has no ${input.sourceName} noindex directive.`,
      recommendedFix: input.recommendedFix,
      verification: `Fetch the page again, inspect the ${input.sourceName} directives, and confirm that no applicable noindex or none directive remains.`,
      confidence: "high",
      impactAreas: INDEXABILITY_IMPACTS,
      responsibleOwner: "seo",
    },
    3,
    (snapshot) => {
      if (snapshot.pages.length === 0) {
        return pageUnavailable(
          snapshot,
          input.id.toLowerCase(),
          "No page observations are available.",
          ["pages"],
        );
      }
      return Object.freeze(
        snapshot.pages.map((page) => {
          if (page.indexabilityIntent !== "intended") {
            const unavailable = page.indexabilityIntent === "unknown";
            return notCheckedOutcome({
              target: pageTarget(page),
              snapshot,
              reason: unavailable
                ? "The page's intended indexability is unknown."
                : "The page is explicitly not intended for indexing.",
              state: unavailable ? "unavailable" : "ineligible",
              missingData: unavailable ? ["pages"] : [],
              evidence: [pageEvidence(page, "indexabilityIntent", page.indexabilityIntent)],
            });
          }
          if (
            !isSuccessful(page) ||
            !isHtmlContentType(page.contentType) ||
            page.extraction === null ||
            page.extraction.source !== "raw"
          ) {
            return extractionUnavailable(
              snapshot,
              page,
              "The intended-indexable page lacks a successful raw HTML extraction.",
            );
          }
          const values = page.extraction[input.field];
          if (!page.extraction.directiveScopePreserved) {
            return notCheckedOutcome({
              target: pageTarget(page),
              snapshot,
              reason:
                "Crawler-specific directive ownership was not preserved, so the noindex directive cannot be attributed safely.",
              missingData: ["raw-extraction"],
              evidence: [
                pageEvidence(page, input.field, values, "raw"),
                pageEvidence(page, "directiveScopePreserved", false, "raw"),
              ],
            });
          }
          const failed = hasNoindex(values);
          return checkedOutcome({
            target: pageTarget(page),
            failed,
            evidence: [
              pageEvidence(page, "indexabilityIntent", page.indexabilityIntent),
              pageEvidence(page, input.field, values, "raw"),
            ],
            detectedValue: failed
              ? `${input.sourceName} declares noindex or none.`
              : `${input.sourceName} contains no applicable noindex directive.`,
          });
        }),
      );
    },
  );
}

const crw007 = noindexRule({
  id: "CRW-007",
  title: "Intended indexable page contains meta noindex",
  field: "metaRobots",
  sourceName: "meta robots",
  recommendedFix:
    "Remove noindex or none from the applicable robots meta element on this page, then purge any generated-page or template cache that restores it.",
});

const crw008 = noindexRule({
  id: "CRW-008",
  title: "Intended indexable page contains X-Robots-Tag noindex",
  field: "xRobotsTag",
  sourceName: "X-Robots-Tag",
  recommendedFix:
    "Remove noindex or none from the applicable X-Robots-Tag response header in the origin, reverse proxy, or CDN rule serving this URL.",
});

const crw009 = defineRuleVersion(
  {
    id: "CRW-009",
    title: "Meta robots and X-Robots directives conflict",
    category: "crawlability",
    defaultSeverity: "high",
    scope: "page",
    description: "Checks raw HTML meta robots directives against X-Robots-Tag response directives.",
    eligibility: "A successful HTML page has a raw directive extraction.",
    requiredData: ["pages", "headers", "raw-extraction"],
    explanation:
      "Conflicting indexing or following directives make crawler behavior difficult to predict and can hide an accidental exclusion.",
    expectedValue: "Meta robots and X-Robots-Tag express compatible directives.",
    recommendedFix:
      "Choose the intended indexing policy, then remove the opposite directive from the page template or the origin, proxy, or CDN X-Robots-Tag rule so both sources agree.",
    verification:
      "Fetch the URL again and compare the raw robots meta values with every X-Robots-Tag value for the same crawler scope.",
    confidence: "high",
    impactAreas: INDEXABILITY_IMPACTS,
    responsibleOwner: "developer",
  },
  3,
  (snapshot) => {
    const candidates = snapshot.pages.filter(
      (page) => isSuccessful(page) && isHtmlContentType(page.contentType),
    );
    const outcomes = candidates.map((page) => {
      if (page.extraction === null || page.extraction.source !== "raw") {
        return extractionUnavailable(
          snapshot,
          page,
          "A raw extraction is required to compare robots directive sources.",
        );
      }
      if (!page.extraction.directiveScopePreserved) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason:
            "Crawler-specific directive ownership was not preserved, so apparent cross-source conflicts cannot be attributed safely.",
          missingData: ["raw-extraction", "headers"],
          evidence: [
            pageEvidence(page, "metaRobots", page.extraction.metaRobots, "raw"),
            pageEvidence(page, "xRobotsTag", page.extraction.xRobotsTag, "raw"),
            pageEvidence(page, "directiveScopePreserved", false, "raw"),
          ],
        });
      }
      const conflicts = directiveConflicts(page.extraction.metaRobots, page.extraction.xRobotsTag);
      return checkedOutcome({
        target: pageTarget(page),
        failed: conflicts.length > 0,
        evidence: [
          pageEvidence(page, "metaRobots", page.extraction.metaRobots, "raw"),
          pageEvidence(page, "xRobotsTag", page.extraction.xRobotsTag, "raw"),
          pageEvidence(page, "conflicts", conflicts, "raw"),
        ],
        detectedValue:
          conflicts.length > 0
            ? `Conflicting directive pairs: ${conflicts.join(", ")}.`
            : "No cross-source robots directive conflict was detected.",
      });
    });
    return pageOutcomesOrUnavailable(
      outcomes,
      snapshot,
      "robots-directive-conflicts",
      "No successful HTML page is available for robots directive comparison.",
      ["pages", "headers", "raw-extraction"],
    );
  },
);

const crw010 = defineRuleVersion(
  {
    id: "CRW-010",
    title: "Important page is blocked by robots.txt",
    category: "crawlability",
    defaultSeverity: "high",
    scope: "page",
    description:
      "Checks homepage, explicitly important, and sitemap-listed pages for a robots denial.",
    eligibility: "The page has an importance signal and a recorded robots decision.",
    requiredData: ["pages", "robots", "sitemap-entries"],
    explanation:
      "Blocking an important public page prevents compliant crawlers from fetching the content even when the URL is otherwise discoverable.",
    expectedValue: "Important public pages are allowed for the configured crawler user agent.",
    recommendedFix:
      "Update the applicable robots.txt group by removing or narrowing the matching Disallow rule or adding a more specific Allow rule for this public page.",
    verification:
      "Test the URL against the deployed robots.txt with the configured user agent and rerun the crawl until the stored decision is allowed.",
    confidence: "high",
    impactAreas: CRAWLABILITY_IMPACTS,
    responsibleOwner: "seo",
  },
  4,
  (snapshot) => {
    const pages = importantPages(snapshot);
    const outcomes = pages.map((page) => {
      const robots = robotsForPage(snapshot, page);
      const importanceSources = [
        page.importance,
        ...(page.discoverySource === "seed" ? ["seed"] : []),
        ...(sitemapEntriesForPage(snapshot, page).length > 0 ? ["sitemap"] : []),
      ];
      if (page.robotsDecision === "not-checked" || robots === undefined) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason:
            page.robotsDecision === "not-checked"
              ? "The important page has no robots decision."
              : "The robots policy observation supporting this page decision is unavailable.",
          missingData: ["robots"],
          evidence: [
            pageEvidence(page, "importanceSources", importanceSources),
            pageEvidence(page, "robotsDecision", page.robotsDecision),
            pageEvidence(page, "robotsObservationId", page.robotsObservationId ?? null),
            pageEvidence(page, "robotsResult", page.robotsResult ?? null),
          ],
        });
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: page.robotsDecision === "disallowed",
        evidence: [
          pageEvidence(page, "importanceSources", importanceSources),
          pageEvidence(page, "robotsDecision", page.robotsDecision),
          pageEvidence(page, "robotsObservationId", page.robotsObservationId ?? null),
          pageEvidence(page, "robotsResult", page.robotsResult ?? null),
          robotsEvidence(robots, "result", robots.result),
          robotsEvidence(robots, "userAgent", robots.userAgent),
        ],
        detectedValue: `Robots decision for this important page: ${page.robotsDecision}.`,
      });
    });
    return pageOutcomesOrUnavailable(
      outcomes,
      snapshot,
      "important-robots",
      "No page has a supported importance signal.",
      ["pages", "sitemap-entries"],
    );
  },
);

const crw011 = defineRuleVersion(
  {
    id: "CRW-011",
    title: "Sitemap URL is blocked from crawling",
    category: "crawlability",
    defaultSeverity: "high",
    scope: "site",
    description: "Checks each attempted sitemap URL for a robots-disallowed outcome.",
    eligibility: "A sitemap fetch or explicit robots denial was recorded.",
    requiredData: ["robots", "sitemaps"],
    explanation:
      "A blocked sitemap cannot be retrieved by compliant crawlers, so its URL inventory and freshness signals are unavailable.",
    expectedValue: "Declared and submitted sitemap URLs are allowed by robots.txt.",
    recommendedFix:
      "Allow the sitemap path in the applicable robots.txt group, or remove the declaration and submit the correct accessible sitemap URL.",
    verification:
      "Request the sitemap with the configured user agent and rerun the crawl until its observation is no longer robots_disallowed.",
    confidence: "high",
    impactAreas: CRAWLABILITY_IMPACTS,
    responsibleOwner: "seo",
  },
  4,
  (snapshot) => {
    if (snapshot.sitemaps.length === 0) {
      return siteUnavailable(
        snapshot,
        "sitemap-robots",
        "No sitemap fetch observation is available.",
        ["sitemaps"],
      );
    }
    return Object.freeze(
      snapshot.sitemaps.map((sitemap) => {
        const target = siteTarget(snapshot, `sitemap-robots:${sitemap.urlHash}`);
        if (sitemap.robotsDecision === undefined || sitemap.robotsDecision === "not-checked") {
          return notCheckedOutcome({
            target,
            snapshot,
            reason: "No conclusive robots decision was recorded for the sitemap request.",
            missingData: ["robots"],
            evidence: [
              sitemapEvidence(sitemap, "status", sitemap.status),
              sitemapEvidence(sitemap, "errorType", sitemap.errorType ?? "none"),
              sitemapEvidence(sitemap, "robotsDecision", sitemap.robotsDecision ?? "not-checked"),
              sitemapEvidence(sitemap, "robotsResult", sitemap.robotsResult ?? null),
            ],
          });
        }
        const failed = sitemap.robotsDecision === "disallowed";
        return checkedOutcome({
          target,
          failed,
          evidence: [
            sitemapEvidence(sitemap, "status", sitemap.status),
            sitemapEvidence(sitemap, "errorType", sitemap.errorType ?? "none"),
            sitemapEvidence(sitemap, "robotsDecision", sitemap.robotsDecision),
            sitemapEvidence(sitemap, "robotsObservationId", sitemap.robotsObservationId ?? null),
            sitemapEvidence(sitemap, "robotsResult", sitemap.robotsResult ?? null),
          ],
          detectedValue: failed
            ? "The sitemap fetch was denied by robots.txt."
            : "The sitemap observation was not blocked by robots.txt.",
        });
      }),
    );
  },
);

const crw012 = defineRuleVersion(
  {
    id: "CRW-012",
    title: "Indexable page is orphaned from internal navigation",
    category: "crawlability",
    defaultSeverity: "medium",
    scope: "page",
    description: "Checks indexable non-homepage URLs for an inbound internal navigation edge.",
    eligibility:
      "The page is indexable and the crawl has enough successful raw extraction coverage to prove link absence.",
    requiredData: ["crawl", "pages", "transport", "raw-extraction", "links", "robots"],
    explanation:
      "An orphaned indexable page is discoverable only through an external source or sitemap and receives no internal navigation support.",
    expectedValue:
      "Every indexable non-homepage page has at least one inbound internal navigation link.",
    recommendedFix:
      "Add a crawlable HTML anchor from relevant navigation or contextual content to this exact canonical URL; do not rely only on a sitemap or JavaScript event handler.",
    verification:
      "Run a complete crawl and confirm that the page has at least one inbound internal anchor, area, or pagination edge from another page.",
    confidence: "high",
    impactAreas: INDEXABILITY_IMPACTS,
    responsibleOwner: "seo",
  },
  5,
  (snapshot) => {
    const eligibleByImportance = (page: AuditPageObservation) =>
      page.importance !== "homepage" && page.discoverySource !== "seed";
    const candidates = snapshot.pages.filter(
      (page) => isIndexable(page) && eligibleByImportance(page),
    );
    const unresolvedCandidates = snapshot.pages.filter(
      (page) => pageIndexabilityState(page) === "unknown" && eligibleByImportance(page),
    );
    const graphMissingData = new Set<AuditObservationKey>();
    const incompleteLinkSourceCount = snapshot.pages.filter(
      (page) =>
        isSuccessful(page) &&
        isHtmlContentType(page.contentType) &&
        page.extraction?.source === "raw" &&
        !page.extraction.linksComplete,
    ).length;
    if (snapshot.status !== "completed") graphMissingData.add("crawl");
    if (
      snapshot.pages.some(
        (page) =>
          isSuccessful(page) &&
          isHtmlContentType(page.contentType) &&
          (page.extraction === null ||
            page.extraction.source !== "raw" ||
            !page.extraction.linksComplete),
      )
    ) {
      if (
        snapshot.pages.some(
          (page) =>
            isSuccessful(page) &&
            isHtmlContentType(page.contentType) &&
            (page.extraction === null || page.extraction.source !== "raw"),
        )
      ) {
        graphMissingData.add("raw-extraction");
      }
      graphMissingData.add("links");
    }
    const outcomes: AuditRuleOutcome[] = candidates.map((page) => {
      const incoming = internalNavigationLinks(snapshot, page).filter(
        (observation) => observation.source.id !== page.id,
      );
      if (incoming.length === 0 && graphMissingData.size > 0) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason:
            "The crawl or raw link graph is incomplete, so absence of inbound links cannot be proven.",
          missingData: [...graphMissingData],
          evidence: [
            crawlEvidence(snapshot, "crawlStatus", snapshot.status),
            crawlEvidence(snapshot, "incompleteLinkSourceCount", incompleteLinkSourceCount),
            pageEvidence(page, "observedInboundInternalLinks", 0),
          ],
        });
      }
      return checkedOutcome({
        target: pageTarget(page),
        failed: incoming.length === 0,
        evidence: [
          pageEvidence(page, "observedInboundInternalLinks", incoming.length),
          pageEvidence(page, "discoverySource", page.discoverySource),
          ...incoming.slice(0, 5).map((link) => linkEvidence(link, page.normalizedUrl)),
        ],
        detectedValue:
          incoming.length === 0
            ? "No inbound internal navigation link was observed in the complete crawl graph."
            : `${incoming.length} inbound internal navigation link${incoming.length === 1 ? " was" : "s were"} observed.`,
      });
    });
    outcomes.push(
      ...unresolvedCandidates.map((page) =>
        notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason:
            page.extraction?.source === "raw" && !page.extraction.directiveScopePreserved
              ? "Crawler-specific directive ownership was not preserved, so page indexability cannot be established for orphan evaluation."
              : "Transport, robots, or raw directive evidence is incomplete, so page indexability cannot be established for orphan evaluation.",
          missingData: pageIndexabilityMissingData(page),
          evidence: [
            pageEvidence(page, "indexabilityCoverage", [
              page.statusCode ?? "unavailable",
              page.contentType ?? "unavailable",
              page.robotsDecision,
              page.extraction?.source ?? "missing",
              page.extraction?.directiveScopePreserved ?? false,
            ]),
          ],
        }),
      ),
    );
    return pageOutcomesOrUnavailable(
      outcomes,
      snapshot,
      "orphan-pages",
      "No indexable non-homepage page is available for orphan evaluation.",
      ["pages", "raw-extraction", "links"],
    );
  },
);

const crw013 = defineRuleVersion(
  {
    id: "CRW-013",
    title: "Important page exceeds the configured crawl-depth threshold",
    category: "crawlability",
    defaultSeverity: "medium",
    scope: "page",
    description:
      "Compares the shortest observed depth of important pages with the versioned audit threshold.",
    eligibility: "A page has a supported importance signal and a persisted crawl depth.",
    requiredData: ["pages", "configuration", "sitemap-entries"],
    explanation:
      "An important page buried behind many navigation hops is harder for visitors and crawlers to discover and prioritize.",
    expectedValue: "Important pages are discovered at or below the configured maximum depth.",
    recommendedFix:
      "Add a direct crawlable link from the homepage, primary navigation, or a shallower relevant hub so the page is reachable within the configured depth threshold.",
    verification:
      "Rerun the crawl and confirm that the page's minimum discovered depth is no greater than the configured audit threshold.",
    confidence: "high",
    impactAreas: ["crawlability", "search-visibility", "user-experience"],
    responsibleOwner: "seo",
  },
  3,
  (snapshot, policy) => {
    const pages = importantPages(snapshot);
    const outcomes = pages.map((page) => {
      const importanceSources = [
        ...(page.importance === "homepage" || page.discoverySource === "seed" ? ["homepage"] : []),
        ...(sitemapEntriesForPage(snapshot, page).length > 0 ? ["parsed-sitemap"] : []),
        ...(page.importance === "important" && sitemapEntriesForPage(snapshot, page).length === 0
          ? ["explicit-important"]
          : []),
      ];
      return checkedOutcome({
        target: pageTarget(page),
        failed: page.depth > policy.importantDepthThreshold,
        evidence: [
          pageEvidence(page, "depth", page.depth),
          pageEvidence(page, "importanceSources", importanceSources),
          configurationEvidence(
            snapshot,
            "importantDepthThreshold",
            policy.importantDepthThreshold,
          ),
        ],
        detectedValue: `Important page depth is ${page.depth}.`,
        expectedValue: `Important page depth is at most ${policy.importantDepthThreshold}.`,
      });
    });
    return pageOutcomesOrUnavailable(
      outcomes,
      snapshot,
      "important-depth",
      "No page has a supported importance signal, so this rule is not eligible.",
      ["pages", "sitemap-entries"],
    );
  },
);

function queryVariantGroups(snapshot: AuditCrawlSnapshot): readonly Readonly<{
  key: string;
  urls: readonly string[];
}>[] {
  const groups = new Map<string, Set<string>>();
  for (const page of snapshot.pages) {
    const url = safeUrl(page.normalizedUrl);
    if (url === null || url.search === "") continue;
    const key = `${url.origin}${url.pathname}`;
    const urls = groups.get(key) ?? new Set<string>();
    urls.add(url.toString());
    groups.set(key, urls);
  }
  return Object.freeze(
    [...groups.entries()]
      .map(([key, urls]) => Object.freeze({ key, urls: Object.freeze([...urls].sort()) }))
      .sort((left, right) => left.key.localeCompare(right.key)),
  );
}

const crw014 = defineRule(
  {
    id: "CRW-014",
    title: "URL pattern indicates a crawl trap or infinite URL space",
    category: "crawlability",
    defaultSeverity: "high",
    scope: "site",
    description:
      "Groups observed query-bearing URLs by origin and path to detect excessive variants.",
    eligibility:
      "At least one query-bearing URL was retained; a passing conclusion also requires a completed crawl.",
    requiredData: ["crawl", "configuration", "pages"],
    explanation:
      "A path that generates many query variants can consume crawl budgets indefinitely without exposing meaningfully different pages.",
    expectedValue: "Each path remains below the versioned query-variant threshold.",
    recommendedFix:
      "Generate links only for valid finite parameter combinations, reject invalid combinations, consolidate duplicate variants to one canonical URL, and add a crawl exclude pattern until the unbounded link source is fixed.",
    verification:
      "Run a complete crawl with query parameters retained and confirm that no origin-and-path group reaches the configured variant threshold.",
    confidence: "medium",
    impactAreas: CRAWLABILITY_IMPACTS,
    responsibleOwner: "developer",
  },
  (snapshot, policy) => {
    const groups = queryVariantGroups(snapshot);
    if (groups.length === 0) {
      return siteUnavailable(
        snapshot,
        "query-variants",
        "No retained query-bearing URL is available, so query-variant behavior cannot be evaluated.",
        ["pages", "configuration"],
      );
    }
    const excessive = groups.filter((group) => group.urls.length >= policy.queryVariantThreshold);
    const maximum = Math.max(...groups.map((group) => group.urls.length));
    const groupEvidence = groups
      .slice(0, 10)
      .map((group) => `${boundedEvidenceText(group.key)}=${group.urls.length}`);
    if (excessive.length === 0 && snapshot.status !== "completed") {
      return [
        notCheckedOutcome({
          target: siteTarget(snapshot, "query-variants"),
          snapshot,
          reason:
            "The partial crawl did not reach the threshold, but incomplete coverage cannot prove that no crawl trap exists.",
          missingData: ["crawl"],
          evidence: [
            crawlEvidence(snapshot, "queryVariantGroups", groupEvidence),
            configurationEvidence(snapshot, "queryVariantThreshold", policy.queryVariantThreshold),
          ],
        }),
      ];
    }
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "query-variants"),
        failed: excessive.length > 0,
        evidence: [
          crawlEvidence(snapshot, "queryVariantGroups", groupEvidence),
          crawlEvidence(
            snapshot,
            "sampleVariantUrls",
            excessive
              .flatMap((group) => group.urls.slice(0, 3))
              .slice(0, 9)
              .map((url) => boundedEvidenceText(url)),
          ),
          configurationEvidence(snapshot, "queryVariantThreshold", policy.queryVariantThreshold),
        ],
        detectedValue:
          excessive.length > 0
            ? `${excessive.length} path group${excessive.length === 1 ? "" : "s"} reached the threshold; the largest has ${maximum} variants.`
            : `The largest observed path group has ${maximum} query variants.`,
        confidence: "medium",
      }),
    ];
  },
);

const crw015 = defineRule(
  {
    id: "CRW-015",
    title: "Page-like internal URL returns an unexpected non-HTML content type",
    category: "crawlability",
    defaultSeverity: "medium",
    scope: "page",
    description: "Checks successful extensionless and page-extension URLs for an HTML media type.",
    eligibility:
      "The page-like internal URL has a successful final status and a known content type.",
    requiredData: ["pages", "transport"],
    explanation:
      "A navigation URL that appears to be a page but serves another media type can prevent HTML extraction and surprise visitors or crawlers.",
    expectedValue: "Page-like internal URLs serve text/html or application/xhtml+xml.",
    recommendedFix:
      "If the destination is a page, send text/html or application/xhtml+xml with the correct body; if it is a file, link to an explicit file URL and label the link as a download or resource.",
    verification:
      "Request the exact URL and rerun the crawl, confirming an HTML media type for pages or an explicit resource URL and link for files.",
    confidence: "high",
    impactAreas: ["crawlability", "search-visibility", "user-experience"],
    responsibleOwner: "developer",
  },
  (snapshot) => {
    const candidates = snapshot.pages.filter((page) => isPageLikeUrl(page.normalizedUrl));
    const outcomes = candidates.map((page) => {
      if (!isSuccessful(page)) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason: "The page-like URL has no successful final response.",
          state: page.statusCode === null ? "unavailable" : "ineligible",
          missingData: page.statusCode === null ? ["transport"] : [],
          evidence: [
            pageEvidence(page, "statusCode", page.statusCode),
            pageEvidence(page, "errorType", page.errorType ?? "none"),
          ],
        });
      }
      if (page.contentType === null) {
        return notCheckedOutcome({
          target: pageTarget(page),
          snapshot,
          reason: "The successful response has no usable content type.",
          missingData: ["transport"],
          evidence: [pageEvidence(page, "contentType", null)],
        });
      }
      const failed = !isHtmlContentType(page.contentType);
      return checkedOutcome({
        target: pageTarget(page),
        failed,
        evidence: [
          pageEvidence(page, "statusCode", page.statusCode),
          pageEvidence(page, "contentType", page.contentType),
        ],
        detectedValue: `The page-like URL returned ${page.contentType}.`,
      });
    });
    return pageOutcomesOrUnavailable(
      outcomes,
      snapshot,
      "page-like-content-type",
      "No extensionless or recognized page-extension URL is available.",
      ["pages", "transport"],
    );
  },
);

export const CRW_RULES = Object.freeze([
  crw001,
  crw002,
  crw003,
  crw004,
  crw005,
  crw006,
  crw007,
  crw008,
  crw009,
  crw010,
  crw011,
  crw012,
  crw013,
  crw014,
  crw015,
] satisfies readonly AuditRuleDefinition[]);
