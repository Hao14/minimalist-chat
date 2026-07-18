import type { AuditEvidenceItem, AuditEvidenceScalar } from "@searvia/shared-types";

import type { AuditObservationKey, AuditRuleDefinition, AuditRuleOutcome } from "../contracts.js";
import type {
  AuditCrawlSnapshot,
  AuditPageObservation,
  AuditRobotsObservation,
  AuditSitemapEntry,
  AuditSitemapObservation,
} from "../snapshot.js";
import {
  boundedEvidenceText,
  boundedEvidenceUrl,
  boundedPageEvidence,
  checkedOutcome,
  crawlEvidence,
  defineRule,
  defineRuleVersion,
  evidence,
  hasNoindex,
  isHtmlContentType,
  isSuccessful,
  notCheckedOutcome,
  pageIndexabilityState,
  pageIndexabilityMissingData,
  pageEvidence,
  sampleEvidenceStrings,
  siteTarget,
  siteUnavailable,
} from "./helpers.js";

const ROBOTS_IMPACTS = ["crawlability", "search-visibility", "ai-retrievability"] as const;
const SITEMAP_IMPACTS = ["indexability", "search-visibility", "ai-retrievability"] as const;
const FATAL_SITEMAP_PARSE_ISSUES = new Set([
  "forbidden_declaration",
  "gzip_error",
  "invalid_root",
  "xml_error",
]);
const SITEMAP_LIMIT_ISSUES = new Set(["entry_limit", "structural_limit"]);
const SITEMAP_LIMIT_MESSAGE = /(?:exceeds?.*(?:byte|size|limit)|response too large|entry limit)/iu;

interface RobotsDiagnostic {
  readonly line: number;
  readonly directive: string;
  readonly code: "invalid-value" | "missing-colon" | "orphan-directive" | "unrecognized";
}

interface RobotsGroup {
  readonly agents: readonly string[];
  readonly allows: readonly string[];
  readonly disallows: readonly string[];
  readonly hasDirective: boolean;
}

interface MutableRobotsGroup {
  readonly agents: string[];
  readonly allows: string[];
  readonly disallows: string[];
  hasDirective: boolean;
}

interface RobotsAnalysis {
  readonly diagnostics: readonly RobotsDiagnostic[];
  readonly groups: readonly RobotsGroup[];
}

interface SitemapEntryObservation {
  readonly sitemap: AuditSitemapObservation;
  readonly entry: AuditSitemapEntry;
  readonly page: AuditPageObservation | null;
}

function prioritySample<T>(...groups: (readonly T[])[]): readonly T[] {
  return Object.freeze(groups.flatMap((group) => group).slice(0, 25));
}

function hasSitemapLimitSignal(sitemap: AuditSitemapObservation): boolean {
  return (
    sitemap.errorType === "response_too_large" ||
    SITEMAP_LIMIT_MESSAGE.test(sitemap.errorMessage ?? "") ||
    sitemap.parseIssues.some((issue) => SITEMAP_LIMIT_ISSUES.has(issue.code))
  );
}

function robotsEvidence(
  robots: AuditRobotsObservation,
  field: string,
  value: AuditEvidenceScalar | readonly AuditEvidenceScalar[],
  excerpt?: string,
): AuditEvidenceItem {
  return evidence({
    kind: "robots",
    source: "robots",
    observationId: robots.id,
    observedAt: robots.fetchedAt,
    field,
    value,
    url: robots.requestedUrl,
    ...(excerpt === undefined ? {} : { excerpt }),
  });
}

function sitemapEvidence(
  sitemap: AuditSitemapObservation,
  field: string,
  value: AuditEvidenceScalar | readonly AuditEvidenceScalar[],
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

function boundedSitemapEvidence(
  sitemap: AuditSitemapObservation,
  field: string,
  value: AuditEvidenceScalar | readonly AuditEvidenceScalar[],
): AuditEvidenceItem {
  return evidence({
    kind: "sitemap",
    source: "sitemap",
    observationId: sitemap.id,
    observedAt: sitemap.observedAt,
    field,
    value,
    url: boundedEvidenceUrl(sitemap.normalizedUrl),
  });
}

function boundedSitemapAggregateEvidence(
  snapshot: AuditCrawlSnapshot,
  summaryField: string,
  sitemaps: readonly AuditSitemapObservation[],
  describe: (sitemap: AuditSitemapObservation) => string,
  detail: (sitemap: AuditSitemapObservation) => AuditEvidenceItem,
): readonly AuditEvidenceItem[] {
  return Object.freeze([
    ...sitemaps.slice(0, 12).map(detail),
    crawlEvidence(snapshot, summaryField, [
      `observations=${sitemaps.length}`,
      ...sampleEvidenceStrings(
        sitemaps.map(
          (sitemap) =>
            `sitemap=${sitemap.id};url=${boundedEvidenceUrl(sitemap.normalizedUrl)};${describe(sitemap)}`,
        ),
        { maximumItems: 8, maximumItemBytes: 1_024, maximumTotalBytes: 8_192 },
      ),
    ]),
  ]);
}

function boundedSitemapEntryEvidence(
  observation: SitemapEntryObservation,
  field: string,
  value: AuditEvidenceScalar | readonly AuditEvidenceScalar[],
): AuditEvidenceItem {
  return evidence({
    kind: "sitemap",
    source: "sitemap",
    observationId: observation.entry.id,
    observedAt: observation.sitemap.observedAt,
    field,
    value,
    url: boundedEvidenceUrl(observation.entry.normalizedLoc),
  });
}

function parseRobots(content: string): RobotsAnalysis {
  const diagnostics: RobotsDiagnostic[] = [];
  const groups: MutableRobotsGroup[] = [];
  let current: MutableRobotsGroup | null = null;

  for (const [index, rawLine] of content
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .entries()) {
    const lineNumber = index + 1;
    const comment = rawLine.indexOf("#");
    const line = (comment < 0 ? rawLine : rawLine.slice(0, comment)).trim();
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon <= 0) {
      diagnostics.push({ line: lineNumber, directive: line.slice(0, 80), code: "missing-colon" });
      continue;
    }

    const directive = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (directive === "sitemap") {
      let parsed: URL | null = null;
      try {
        parsed = new URL(value);
      } catch {
        // The diagnostic below records the safely bounded conclusion.
      }
      if (
        parsed === null ||
        (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        parsed.username !== "" ||
        parsed.password !== ""
      ) {
        diagnostics.push({ line: lineNumber, directive, code: "invalid-value" });
      }
      continue;
    }

    if (directive === "user-agent") {
      if (value === "") {
        diagnostics.push({ line: lineNumber, directive, code: "invalid-value" });
        continue;
      }
      if (current === null || current.hasDirective) {
        current = { agents: [], allows: [], disallows: [], hasDirective: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (directive === "allow" || directive === "disallow" || directive === "crawl-delay") {
      if (current === null || current.agents.length === 0) {
        diagnostics.push({ line: lineNumber, directive, code: "orphan-directive" });
        continue;
      }
      current.hasDirective = true;
      if (directive === "crawl-delay") {
        const delay = Number(value);
        if (!Number.isFinite(delay) || delay < 0) {
          diagnostics.push({ line: lineNumber, directive, code: "invalid-value" });
        }
        continue;
      }
      if (value !== "" && !value.startsWith("/") && !value.startsWith("*")) {
        diagnostics.push({ line: lineNumber, directive, code: "invalid-value" });
        continue;
      }
      if (value !== "") {
        (directive === "allow" ? current.allows : current.disallows).push(value);
      }
      continue;
    }

    diagnostics.push({ line: lineNumber, directive: directive.slice(0, 80), code: "unrecognized" });
  }

  return Object.freeze({
    diagnostics: Object.freeze(diagnostics.map((item) => Object.freeze({ ...item }))),
    groups: Object.freeze(
      groups.map((group) =>
        Object.freeze({
          agents: Object.freeze([...group.agents]),
          allows: Object.freeze([...group.allows]),
          disallows: Object.freeze([...group.disallows]),
          hasDirective: group.hasDirective,
        }),
      ),
    ),
  });
}

function productToken(userAgent: string): string {
  return userAgent.trim().split(/[\s/]/u, 1)[0]?.toLowerCase() ?? "";
}

function selectedRobotsGroups(analysis: RobotsAnalysis, userAgent: string): readonly RobotsGroup[] {
  const token = productToken(userAgent);
  const exact = analysis.groups.filter((group) => group.agents.includes(token));
  return exact.length > 0
    ? Object.freeze(exact)
    : Object.freeze(analysis.groups.filter((group) => group.agents.includes("*")));
}

interface WholeSiteRobotsAssessment {
  readonly productToken: string;
  readonly selectedGroups: readonly RobotsGroup[];
  readonly wholeSiteDisallows: readonly string[];
  readonly allowExceptions: readonly string[];
  readonly blocked: boolean;
}

function wholeSiteRobotsAssessment(
  analysis: RobotsAnalysis,
  userAgent: string,
): WholeSiteRobotsAssessment {
  const selected = selectedRobotsGroups(analysis, userAgent);
  const wholeSiteDisallows = selected.flatMap((group) =>
    group.disallows.filter((pattern) => pattern === "/" || pattern === "/*"),
  );
  const allowExceptions = selected.flatMap((group) =>
    group.allows.filter((pattern) => pattern !== ""),
  );
  return Object.freeze({
    productToken: productToken(userAgent),
    selectedGroups: selected,
    wholeSiteDisallows: Object.freeze(wholeSiteDisallows),
    allowExceptions: Object.freeze(allowExceptions),
    blocked: wholeSiteDisallows.length > 0 && allowExceptions.length === 0,
  });
}

function targetPage(
  snapshot: AuditCrawlSnapshot,
  entry: AuditSitemapEntry,
): AuditPageObservation | null {
  if (entry.targetPageId !== null) {
    const byId = snapshot.pages.filter((page) => page.id === entry.targetPageId);
    return byId.length === 1 ? (byId[0] ?? null) : null;
  }
  const byUrl = snapshot.pages.filter((page) => page.normalizedUrl === entry.normalizedLoc);
  return byUrl.length === 1 ? (byUrl[0] ?? null) : null;
}

function sitemapEntryObservations(
  snapshot: AuditCrawlSnapshot,
): readonly SitemapEntryObservation[] {
  return Object.freeze(
    snapshot.sitemaps.flatMap((sitemap) =>
      sitemap.entries
        .filter((entry) => entry.entryType === "url")
        .map((entry) => Object.freeze({ sitemap, entry, page: targetPage(snapshot, entry) })),
    ),
  );
}

function importantPageIndexability(
  page: AuditPageObservation,
): "indexable" | "not-indexable" | "unknown" {
  return pageIndexabilityState(page);
}

function incompleteSiteCoverage(
  snapshot: AuditCrawlSnapshot,
  key: string,
  reason: string,
  missingData: readonly AuditObservationKey[],
  evidenceItems?: readonly AuditEvidenceItem[],
): readonly AuditRuleOutcome[] {
  return [
    notCheckedOutcome({
      target: siteTarget(snapshot, key),
      snapshot,
      reason,
      missingData,
      ...(evidenceItems === undefined ? {} : { evidence: evidenceItems }),
    }),
  ];
}

const rsm001 = defineRule(
  {
    id: "RSM-001",
    title: "robots.txt is missing",
    category: "robots-sitemaps",
    defaultSeverity: "low",
    scope: "site",
    description: "Checks each observed origin for a definitive missing robots.txt response.",
    eligibility: "At least one robots.txt request must have a conclusive result.",
    requiredData: ["robots"],
    explanation:
      "A missing robots.txt prevents the site from publishing explicit crawler guidance and sitemap declarations, even though standards-compliant crawlers may otherwise allow access.",
    expectedValue: "Every observed public origin has an accessible robots.txt resource.",
    recommendedFix:
      "Publish a credential-free /robots.txt resource that returns a stable HTTP 200 text response and includes the intended crawler policy.",
    verification:
      "Request /robots.txt on every crawled origin and confirm that each request returns the intended public file instead of HTTP 404 or 410.",
    confidence: "high",
    impactAreas: ROBOTS_IMPACTS,
    responsibleOwner: "infrastructure",
  },
  (snapshot) => {
    if (snapshot.robots.length === 0) {
      return siteUnavailable(snapshot, "robots-missing", "No robots.txt request was observed.", [
        "robots",
      ]);
    }
    const missing = snapshot.robots.filter((robot) => robot.result === "not_found");
    const unknown = snapshot.robots.filter((robot) => robot.result === "unavailable");
    const healthy = snapshot.robots.filter(
      (robot) => robot.result !== "not_found" && robot.result !== "unavailable",
    );
    if (missing.length === 0 && unknown.length > 0) {
      return incompleteSiteCoverage(
        snapshot,
        "robots-missing",
        "robots.txt availability was inconclusive, so absence cannot be established.",
        ["robots"],
        unknown.slice(0, 25).map((robot) => robotsEvidence(robot, "result", robot.result)),
      );
    }
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "robots-missing"),
        failed: missing.length > 0,
        evidence: prioritySample(missing, unknown, healthy).map((robot) =>
          robotsEvidence(robot, "result", robot.result),
        ),
        detectedValue:
          missing.length === 0
            ? `${snapshot.robots.length} observed origin(s) returned a robots.txt resource.`
            : `${missing.length} observed origin(s) returned HTTP 404 or 410 for robots.txt.`,
      }),
    ];
  },
);

const rsm002 = defineRule(
  {
    id: "RSM-002",
    title: "robots.txt is inaccessible or returns a server error",
    category: "robots-sitemaps",
    defaultSeverity: "high",
    scope: "site",
    description:
      "Detects robots.txt requests that failed because of access, network, or server errors.",
    eligibility: "At least one robots.txt transport result must be available.",
    requiredData: ["robots", "transport"],
    explanation:
      "An inaccessible robots policy leaves crawlers without dependable instructions and may cause conservative crawlers to postpone or stop fetching the site.",
    expectedValue: "robots.txt is reachable without access, network, rate-limit, or server errors.",
    recommendedFix:
      "Allow anonymous access to /robots.txt and configure the edge and origin to return a stable non-5xx response without authentication or rate-limit failures.",
    verification:
      "Request /robots.txt without credentials from each origin and confirm a stable successful or intentional not-found response with no server error.",
    confidence: "high",
    impactAreas: ROBOTS_IMPACTS,
    responsibleOwner: "infrastructure",
  },
  (snapshot) => {
    if (snapshot.robots.length === 0) {
      return siteUnavailable(
        snapshot,
        "robots-access",
        "No robots.txt transport result was available.",
        ["robots", "transport"],
      );
    }
    const failures = snapshot.robots.filter((robot) => robot.result === "unavailable");
    const healthy = snapshot.robots.filter((robot) => robot.result !== "unavailable");
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "robots-access"),
        failed: failures.length > 0,
        evidence: prioritySample(failures, healthy).map((robot) =>
          robotsEvidence(robot, "status", robot.statusCode),
        ),
        detectedValue:
          failures.length === 0
            ? "Every robots.txt transport request reached a conclusive response."
            : `${failures.length} robots.txt request(s) were inaccessible or unavailable.`,
      }),
    ];
  },
);

const rsm003 = defineRule(
  {
    id: "RSM-003",
    title: "robots.txt contains invalid or unrecognized syntax",
    category: "robots-sitemaps",
    defaultSeverity: "medium",
    scope: "site",
    description: "Parses bounded robots.txt content and reports invalid or unsupported directives.",
    eligibility: "Fetched robots.txt source content must be available for deterministic parsing.",
    requiredData: ["robots"],
    explanation:
      "Invalid or unrecognized robots syntax can be ignored differently by crawlers, producing policy behavior that differs from the site owner's intent.",
    expectedValue: "robots.txt contains only recognized directives with valid values and grouping.",
    recommendedFix:
      "Correct malformed lines, move crawler directives under a User-agent group, and remove or replace unrecognized directives with supported robots syntax.",
    verification:
      "Parse the deployed file for the configured Searvia product token and confirm that no syntax or directive diagnostics remain.",
    confidence: "high",
    impactAreas: ROBOTS_IMPACTS,
    responsibleOwner: "seo",
  },
  (snapshot) => {
    const invalid = snapshot.robots.filter((robot) => robot.result === "invalid");
    if (invalid.length > 0) {
      return [
        checkedOutcome({
          target: siteTarget(snapshot, "robots-syntax"),
          failed: true,
          evidence: invalid
            .slice(0, 25)
            .map((robot) => robotsEvidence(robot, "result", robot.result)),
          detectedValue: `${invalid.length} robots.txt observation(s) were explicitly classified as invalid.`,
        }),
      ];
    }
    const fetched = snapshot.robots.filter((robot) => robot.result === "fetched");
    if (fetched.length === 0 || fetched.some((robot) => robot.content === null)) {
      return siteUnavailable(
        snapshot,
        "robots-syntax",
        "Fetched robots.txt source or normalized parser diagnostics were not persisted.",
        ["robots"],
      );
    }
    const analyses = fetched.map((robot) => ({
      robot,
      analysis: parseRobots(robot.content ?? ""),
    }));
    const diagnostics = analyses.flatMap(({ robot, analysis }) =>
      analysis.diagnostics.map((diagnostic) => ({ robot, diagnostic })),
    );
    if (diagnostics.length === 0 && fetched.length !== snapshot.robots.length) {
      return siteUnavailable(
        snapshot,
        "robots-syntax",
        "One or more robots policies were unavailable, so syntax coverage is incomplete.",
        ["robots"],
      );
    }
    const evidenceItems =
      diagnostics.length === 0
        ? fetched.slice(0, 25).map((robot) => robotsEvidence(robot, "syntaxDiagnostics", 0))
        : diagnostics
            .slice(0, 25)
            .map(({ robot, diagnostic }) =>
              robotsEvidence(
                robot,
                "syntaxDiagnostic",
                `${diagnostic.code}:line-${diagnostic.line}:${diagnostic.directive}`,
              ),
            );
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "robots-syntax"),
        failed: diagnostics.length > 0,
        evidence: evidenceItems,
        detectedValue:
          diagnostics.length === 0
            ? "No invalid or unrecognized robots directives were detected."
            : `${diagnostics.length} invalid or unrecognized robots directive(s) were detected.`,
      }),
    ];
  },
);

const rsm004 = defineRuleVersion(
  {
    id: "RSM-004",
    title: "robots.txt appears to block the entire public site unintentionally",
    category: "robots-sitemaps",
    defaultSeverity: "critical",
    scope: "site",
    description:
      "Evaluates the configured crawler group for a conservative whole-site disallow policy.",
    eligibility: "Fetched, syntactically valid robots source must be available.",
    requiredData: ["robots"],
    explanation:
      "A whole-site disallow can remove all public pages from crawler access and sharply reduce search and AI retrieval visibility if deployed accidentally.",
    expectedValue: "The configured crawler policy does not disallow the entire public site.",
    recommendedFix:
      "Remove the whole-site Disallow rule or add the precise Allow exceptions required for public pages before deploying the robots.txt file.",
    verification:
      "Evaluate the deployed robots policy for the configured crawler product token and confirm that representative public URLs are allowed.",
    confidence: "medium",
    impactAreas: ROBOTS_IMPACTS,
    responsibleOwner: "seo",
  },
  3,
  (snapshot) => {
    const fetched = snapshot.robots.filter((robot) => robot.result === "fetched");
    if (fetched.length === 0 || fetched.some((robot) => robot.content === null)) {
      return siteUnavailable(
        snapshot,
        "robots-site-block",
        "Effective robots rules were not persisted, so a whole-site block cannot be concluded.",
        ["robots"],
      );
    }
    const analyses = fetched.map((robot) => ({
      robot,
      analysis: parseRobots(robot.content ?? ""),
    }));
    if (analyses.some(({ analysis }) => analysis.diagnostics.length > 0)) {
      return siteUnavailable(
        snapshot,
        "robots-site-block",
        "Invalid robots syntax prevents a reliable whole-site policy conclusion.",
        ["robots"],
      );
    }
    const assessed = analyses.map(({ robot, analysis }) => ({
      robot,
      assessment: wholeSiteRobotsAssessment(analysis, robot.userAgent),
    }));
    const blocked = assessed.filter(({ assessment }) => assessment.blocked);
    const allowed = assessed.filter(({ assessment }) => !assessment.blocked);
    if (blocked.length === 0 && fetched.length !== snapshot.robots.length) {
      return siteUnavailable(
        snapshot,
        "robots-site-block",
        "One or more effective robots policies were unavailable, so whole-site coverage is incomplete.",
        ["robots"],
      );
    }
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "robots-site-block"),
        failed: blocked.length > 0,
        evidence: [
          crawlEvidence(snapshot, "robots_whole_site_policy_sample", [
            `evaluated=${assessed.length}`,
            `blocked=${blocked.length}`,
            ...sampleEvidenceStrings(
              [...blocked, ...allowed].map(
                ({ robot, assessment }) =>
                  `robots=${robot.id};url=${boundedEvidenceUrl(robot.requestedUrl)};blocked=${assessment.blocked}`,
              ),
              { maximumItems: 8, maximumItemBytes: 1_024, maximumTotalBytes: 8_192 },
            ),
          ]),
          ...prioritySample(blocked, allowed)
            .slice(0, 12)
            .map(({ robot, assessment }) =>
              evidence({
                kind: "robots",
                source: "robots",
                observationId: robot.id,
                observedAt: robot.fetchedAt,
                field: "whole_site_policy_resolution",
                value: sampleEvidenceStrings(
                  [
                    `configured_user_agent=${boundedEvidenceText(robot.userAgent, 512)}`,
                    `product_token=${boundedEvidenceText(assessment.productToken, 512)}`,
                    `selected_groups=${assessment.selectedGroups.length}`,
                    ...assessment.selectedGroups.flatMap((group, index) => [
                      `group_${index + 1}_agents=${group.agents.map((agent) => boundedEvidenceText(agent, 256)).join(",")}`,
                      ...group.disallows.map(
                        (pattern) =>
                          `group_${index + 1}_disallow=${boundedEvidenceText(pattern, 512)}`,
                      ),
                      ...group.allows.map(
                        (pattern) =>
                          `group_${index + 1}_allow=${boundedEvidenceText(pattern, 512)}`,
                      ),
                    ]),
                    `matched_whole_site_disallows=${assessment.wholeSiteDisallows.length}`,
                    `matched_allow_exceptions=${assessment.allowExceptions.length}`,
                    `blocks_entire_site=${assessment.blocked}`,
                  ],
                  { maximumItems: 16, maximumItemBytes: 1_024, maximumTotalBytes: 8_192 },
                ),
                url: boundedEvidenceUrl(robot.requestedUrl),
              }),
            ),
        ],
        detectedValue:
          blocked.length === 0
            ? "No conservative whole-site disallow was detected."
            : `${blocked.length} origin policy or policies disallow the entire public site.`,
      }),
    ];
  },
);

const rsm005 = defineRuleVersion(
  {
    id: "RSM-005",
    title: "robots.txt blocks critical CSS or JavaScript resources",
    category: "robots-sitemaps",
    defaultSeverity: "medium",
    scope: "site",
    description:
      "Checks internal page-rendering stylesheet and script resources against persisted robots decisions.",
    eligibility:
      "Every successful HTML page must have a successful raw extraction, and each observed internal rendering resource must have an effective robots decision.",
    requiredData: ["pages", "transport", "raw-extraction", "resources", "robots"],
    explanation:
      "Blocking stylesheets or scripts can prevent crawlers from rendering and understanding the same primary content and layout that visitors receive.",
    expectedValue:
      "Every observed first-party stylesheet and script needed for rendering is robots-allowed.",
    recommendedFix:
      "Update robots.txt to allow the affected first-party CSS and JavaScript paths while keeping genuinely private or nonpublic paths restricted.",
    verification:
      "Re-evaluate every observed internal script and stylesheet URL against the deployed policy and confirm that each critical resource is allowed.",
    confidence: "high",
    impactAreas: [...ROBOTS_IMPACTS, "user-experience"],
    responsibleOwner: "developer",
  },
  3,
  (snapshot) => {
    const applicablePages = snapshot.pages.filter(
      (page) => isSuccessful(page) && isHtmlContentType(page.contentType),
    );
    if (applicablePages.length === 0) {
      return incompleteSiteCoverage(
        snapshot,
        "robots-resources",
        "No successful HTML page transport was available for resource-policy evaluation.",
        ["pages", "transport"],
      );
    }
    const unavailablePages = applicablePages.filter(
      (page) =>
        page.extraction === null ||
        page.extraction.source !== "raw" ||
        page.extraction.linksComplete !== true,
    );
    const parsedPages = applicablePages.filter(
      (page) => page.extraction !== null && page.extraction.source === "raw",
    );
    const resources = parsedPages.flatMap((page) =>
      page.resources
        .filter(
          (resource) =>
            resource.scope === "internal" &&
            (resource.resourceType === "script" || resource.resourceType === "stylesheet"),
        )
        .map((resource) => ({ page, resource })),
    );
    const blocked = resources.filter(({ resource }) => resource.robotsDecision === "disallowed");
    const unknown = resources.filter(
      ({ resource }) =>
        resource.robotsDecision === undefined || resource.robotsDecision === "not-checked",
    );
    const allowed = resources.filter(({ resource }) => resource.robotsDecision === "allowed");
    if (blocked.length > 0) {
      return [
        checkedOutcome({
          target: siteTarget(snapshot, "robots-resources"),
          failed: true,
          evidence: prioritySample(blocked, unknown, allowed).map(({ page, resource }) =>
            evidence({
              kind: "page",
              source: "raw",
              observationId: resource.id,
              observedAt: page.extraction?.extractedAt ?? page.observedAt,
              field: "resourceRobotsDecision",
              value: `decision=${resource.robotsDecision ?? "not-checked"}; robotsResult=${resource.robotsResult ?? "unavailable"}; robotsObservationId=${resource.robotsObservationId ?? "unavailable"}`,
              url: resource.normalizedUrl ?? page.normalizedUrl,
            }),
          ),
          detectedValue: `${blocked.length} internal stylesheet or script resource(s) were robots-blocked.`,
        }),
      ];
    }
    if (unavailablePages.length > 0) {
      return incompleteSiteCoverage(
        snapshot,
        "robots-resources",
        "One or more successful HTML pages lacked a complete successful raw extraction, so complete rendering-resource coverage is unavailable.",
        unknown.length > 0
          ? ["raw-extraction", "resources", "robots"]
          : ["raw-extraction", "resources"],
        prioritySample(unavailablePages).map((page) =>
          pageEvidence(
            page,
            "renderingResourceExtractionCoverage",
            `source=${page.extraction?.source ?? "unavailable"}; links_complete=${page.extraction?.linksComplete ?? false}`,
          ),
        ),
      );
    }
    if (blocked.length === 0 && unknown.length > 0) {
      return incompleteSiteCoverage(
        snapshot,
        "robots-resources",
        "Resource URLs were extracted, but their effective robots decisions were not persisted.",
        ["robots"],
        unknown.slice(0, 25).map(({ page, resource }) =>
          evidence({
            kind: "page",
            source: "raw",
            observationId: resource.id,
            observedAt: page.extraction?.extractedAt ?? page.observedAt,
            field: "resourceRobotsDecision",
            value: `decision=not-checked; robotsResult=${resource.robotsResult ?? "unavailable"}; robotsObservationId=${resource.robotsObservationId ?? "unavailable"}`,
            url: resource.normalizedUrl ?? page.normalizedUrl,
          }),
        ),
      );
    }
    const evidenceItems =
      resources.length === 0
        ? [crawlEvidence(snapshot, "internalRenderingResourceCount", 0)]
        : prioritySample(blocked, unknown, allowed).map(({ page, resource }) =>
            evidence({
              kind: "page",
              source: "raw",
              observationId: resource.id,
              observedAt: page.extraction?.extractedAt ?? page.observedAt,
              field: "resourceRobotsDecision",
              value: `decision=${resource.robotsDecision ?? "not-checked"}; robotsResult=${resource.robotsResult ?? "unavailable"}; robotsObservationId=${resource.robotsObservationId ?? "unavailable"}`,
              url: resource.normalizedUrl ?? page.normalizedUrl,
            }),
          );
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "robots-resources"),
        failed: false,
        evidence: evidenceItems,
        detectedValue: `${resources.length} observed internal rendering resource(s) were allowed.`,
      }),
    ];
  },
);

const rsm006 = defineRule(
  {
    id: "RSM-006",
    title: "robots.txt contains no sitemap declaration",
    category: "robots-sitemaps",
    defaultSeverity: "low",
    scope: "site",
    description: "Checks fetched robots policies for at least one persisted Sitemap declaration.",
    eligibility: "Every observed robots policy must have been fetched and parsed conclusively.",
    requiredData: ["robots"],
    explanation:
      "A Sitemap declaration gives crawlers a direct, repeatable path to the site's submitted URL inventory and recursive sitemap indexes.",
    expectedValue: "Each fetched robots.txt policy declares at least one absolute sitemap URL.",
    recommendedFix:
      "Add an absolute Sitemap directive for the canonical XML sitemap or sitemap index to each applicable robots.txt file.",
    verification:
      "Fetch robots.txt and confirm that its parsed Sitemap declarations contain the canonical in-scope sitemap URL.",
    confidence: "high",
    impactAreas: SITEMAP_IMPACTS,
    responsibleOwner: "seo",
  },
  (snapshot) => {
    if (snapshot.robots.length === 0) {
      return siteUnavailable(
        snapshot,
        "robots-sitemap-declaration",
        "No robots policy was observed.",
        ["robots"],
      );
    }
    const fetched = snapshot.robots.filter((robot) => robot.result === "fetched");
    const missing = fetched.filter((robot) => robot.sitemapUrls.length === 0);
    const unknown = snapshot.robots.filter((robot) => robot.result !== "fetched");
    const declared = fetched.filter((robot) => robot.sitemapUrls.length > 0);
    if (missing.length === 0 && unknown.length > 0) {
      return incompleteSiteCoverage(
        snapshot,
        "robots-sitemap-declaration",
        "One or more robots policies were unavailable, missing, or invalid.",
        ["robots"],
        unknown.slice(0, 25).map((robot) => robotsEvidence(robot, "result", robot.result)),
      );
    }
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "robots-sitemap-declaration"),
        failed: missing.length > 0,
        evidence: prioritySample(missing, unknown, declared).map((robot) =>
          robotsEvidence(robot, "sitemapDeclarations", robot.sitemapUrls),
        ),
        detectedValue:
          missing.length === 0
            ? "Every fetched robots policy declares at least one sitemap."
            : `${missing.length} fetched robots policy or policies contain no Sitemap declaration.`,
      }),
    ];
  },
);

const rsm007 = defineRuleVersion(
  {
    id: "RSM-007",
    title: "No XML sitemap was discovered",
    category: "robots-sitemaps",
    defaultSeverity: "medium",
    scope: "site",
    description:
      "Checks whether robots or submitted discovery produced any durable sitemap observation.",
    eligibility: "Sitemap discovery must be conclusive for the completed crawl.",
    requiredData: ["crawl", "robots", "sitemaps"],
    explanation:
      "Without a discovered sitemap, crawlers have no explicit XML inventory to complement link discovery and identify important or newly published URLs.",
    expectedValue: "At least one XML sitemap or sitemap index is discovered and recorded.",
    recommendedFix:
      "Publish an in-scope XML sitemap or sitemap index, declare it in robots.txt, and submit the same canonical URL in project crawl settings.",
    verification:
      "Run a completed crawl and confirm that at least one robots-declared or submitted sitemap observation is persisted.",
    confidence: "high",
    impactAreas: SITEMAP_IMPACTS,
    responsibleOwner: "seo",
  },
  3,
  (snapshot) => {
    if (snapshot.sitemaps.length > 0) {
      return [
        checkedOutcome({
          target: siteTarget(snapshot, "sitemap-discovery"),
          failed: false,
          evidence: snapshot.sitemaps
            .slice(0, 25)
            .map((item) => sitemapEvidence(item, "discoverySource", item.source)),
          detectedValue: `${snapshot.sitemaps.length} sitemap observation(s) were discovered.`,
        }),
      ];
    }
    if (snapshot.status !== "completed") {
      return siteUnavailable(
        snapshot,
        "sitemap-discovery",
        "The partial crawl did not discover a sitemap, but incomplete discovery cannot prove absence.",
        ["crawl", "sitemaps"],
      );
    }
    if (
      snapshot.robots.length === 0 ||
      snapshot.robots.some((robot) => robot.result === "unavailable" || robot.result === "invalid")
    ) {
      return siteUnavailable(
        snapshot,
        "sitemap-discovery",
        "Robots-based sitemap discovery was incomplete, so absence cannot be concluded.",
        ["robots", "sitemaps"],
      );
    }
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "sitemap-discovery"),
        failed: true,
        evidence: [crawlEvidence(snapshot, "sitemapCount", 0)],
        detectedValue: "No robots-declared or submitted sitemap was discovered.",
      }),
    ];
  },
);

const rsm008 = defineRuleVersion(
  {
    id: "RSM-008",
    title: "Submitted or declared sitemap is inaccessible",
    category: "robots-sitemaps",
    defaultSeverity: "high",
    scope: "site",
    description: "Checks top-level submitted and robots-declared sitemap transport availability.",
    eligibility: "At least one submitted or robots-declared sitemap transport result must exist.",
    requiredData: ["sitemaps", "transport"],
    explanation:
      "An inaccessible declared sitemap advertises an inventory that crawlers cannot retrieve, delaying discovery and obscuring the intended canonical URL set.",
    expectedValue:
      "Every submitted or robots-declared sitemap is reachable through a conclusive HTTP response.",
    recommendedFix:
      "Restore anonymous access to the sitemap URL, remove authentication and server errors, and update stale declarations to the live canonical sitemap location.",
    verification:
      "Request every submitted and robots-declared sitemap without credentials and confirm that each reaches a successful response body.",
    confidence: "high",
    impactAreas: SITEMAP_IMPACTS,
    responsibleOwner: "infrastructure",
  },
  3,
  (snapshot) => {
    const candidates = snapshot.sitemaps.filter(
      (item) => item.source === "robots" || item.source === "submitted",
    );
    if (candidates.length === 0) {
      return siteUnavailable(
        snapshot,
        "sitemap-access",
        "No submitted or robots-declared sitemap transport result was available.",
        ["sitemaps", "transport"],
      );
    }
    const sizeFailures = candidates.filter(hasSitemapLimitSignal);
    const inaccessible = candidates.filter(
      (item) =>
        !sizeFailures.includes(item) &&
        item.status !== "skipped" &&
        (item.statusCode === null ||
          item.statusCode < 200 ||
          item.statusCode >= 300 ||
          (item.errorType !== null && item.errorType !== "parse_error")),
    );
    const healthy = candidates.filter(
      (item) =>
        item.status === "parsed" &&
        item.statusCode !== null &&
        item.statusCode >= 200 &&
        item.statusCode < 300 &&
        item.errorType === null,
    );
    const unknown = candidates.filter(
      (item) =>
        !sizeFailures.includes(item) && !inaccessible.includes(item) && !healthy.includes(item),
    );
    if (inaccessible.length === 0 && unknown.length > 0) {
      return incompleteSiteCoverage(
        snapshot,
        "sitemap-access",
        "A sitemap did not complete a conclusive transport and parsing lifecycle, so accessibility was not passed.",
        ["transport"],
        boundedSitemapAggregateEvidence(
          snapshot,
          "sitemap_transport_unknown_sample",
          unknown,
          (item) =>
            `status=${item.status};status_code=${item.statusCode ?? "unavailable"};error_type=${item.errorType ?? "none"}`,
          (item) =>
            boundedSitemapEvidence(item, "transportState", [
              item.status,
              item.statusCode,
              item.errorType,
            ]),
        ),
      );
    }
    if (inaccessible.length === 0 && sizeFailures.length > 0) {
      return incompleteSiteCoverage(
        snapshot,
        "sitemap-access",
        "Sitemap transport stopped at a configured size limit; RSM-010 owns that conclusion.",
        ["transport"],
        boundedSitemapAggregateEvidence(
          snapshot,
          "sitemap_transport_limit_sample",
          sizeFailures,
          (item) => `error_type=${item.errorType ?? "none"}`,
          (item) => boundedSitemapEvidence(item, "errorType", item.errorType),
        ),
      );
    }
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "sitemap-access"),
        failed: inaccessible.length > 0,
        evidence: boundedSitemapAggregateEvidence(
          snapshot,
          "sitemap_transport_sample",
          [...inaccessible, ...unknown, ...sizeFailures, ...healthy],
          (item) =>
            `status=${item.status};status_code=${item.statusCode ?? "unavailable"};error_type=${item.errorType ?? "none"}`,
          (item) =>
            boundedSitemapEvidence(item, "transportState", [
              item.status,
              item.statusCode,
              item.errorType,
            ]),
        ),
        detectedValue:
          inaccessible.length === 0
            ? "Every submitted or robots-declared sitemap reached an HTTP response body."
            : `${inaccessible.length} submitted or declared sitemap(s) were inaccessible.`,
      }),
    ];
  },
);

const rsm009 = defineRuleVersion(
  {
    id: "RSM-009",
    title: "Sitemap XML is invalid or cannot be parsed",
    category: "robots-sitemaps",
    defaultSeverity: "high",
    scope: "site",
    description: "Checks persisted sitemap parsing state and fatal XML diagnostics.",
    eligibility: "At least one sitemap body must have reached deterministic XML parsing.",
    requiredData: ["sitemaps"],
    explanation:
      "Malformed XML, an invalid root, forbidden declarations, or broken gzip content prevents crawlers from reading the advertised URL inventory.",
    expectedValue:
      "Every fetched sitemap parses as a supported URL set or sitemap index without fatal diagnostics.",
    recommendedFix:
      "Regenerate the sitemap as well-formed XML with a supported urlset or sitemapindex root, safe encoding, and valid gzip compression when used.",
    verification:
      "Fetch and parse each sitemap again and confirm a supported format with no fatal XML, declaration, root, or gzip issue.",
    confidence: "high",
    impactAreas: SITEMAP_IMPACTS,
    responsibleOwner: "developer",
  },
  3,
  (snapshot) => {
    if (snapshot.sitemaps.length === 0) {
      return siteUnavailable(snapshot, "sitemap-xml", "No sitemap observation was available.", [
        "sitemaps",
      ]);
    }
    const failures = snapshot.sitemaps.filter((item) => {
      const fatalIssue = item.parseIssues.some((issue) =>
        FATAL_SITEMAP_PARSE_ISSUES.has(issue.code),
      );
      const unclassifiedParseFailure =
        item.status === "failed" &&
        item.statusCode !== null &&
        item.statusCode >= 200 &&
        item.statusCode < 300 &&
        (item.errorType === null || item.errorType === "parse_error") &&
        !hasSitemapLimitSignal(item);
      return fatalIssue || unclassifiedParseFailure;
    });
    const healthy = snapshot.sitemaps.filter(
      (item) =>
        item.status === "parsed" &&
        item.statusCode !== null &&
        item.statusCode >= 200 &&
        item.statusCode < 300 &&
        item.errorType === null &&
        item.format !== "unknown" &&
        !item.parseIssues.some((issue) => FATAL_SITEMAP_PARSE_ISSUES.has(issue.code)),
    );
    const unknown = snapshot.sitemaps.filter(
      (item) => !failures.includes(item) && !healthy.includes(item),
    );
    if (failures.length === 0 && unknown.length > 0) {
      return incompleteSiteCoverage(
        snapshot,
        "sitemap-xml",
        "One or more sitemap bodies did not complete XML parsing, so syntax coverage is incomplete.",
        ["sitemaps"],
        boundedSitemapAggregateEvidence(
          snapshot,
          "sitemap_parse_unknown_sample",
          unknown,
          (item) =>
            `status=${item.status};format=${item.format};error_type=${item.errorType ?? "none"}`,
          (item) =>
            boundedSitemapEvidence(item, "parseState", [
              item.status,
              item.statusCode,
              item.errorType,
              item.format,
              ...item.parseIssues.slice(0, 10).map((issue) => issue.code),
            ]),
        ),
      );
    }
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "sitemap-xml"),
        failed: failures.length > 0,
        evidence: boundedSitemapAggregateEvidence(
          snapshot,
          "sitemap_parse_sample",
          [...failures, ...unknown, ...healthy],
          (item) =>
            `status=${item.status};format=${item.format};error_type=${item.errorType ?? "none"}`,
          (item) =>
            boundedSitemapEvidence(item, "parseState", [
              item.status,
              item.statusCode,
              item.errorType,
              item.format,
              ...item.parseIssues.slice(0, 10).map((issue) => issue.code),
            ]),
        ),
        detectedValue:
          failures.length === 0
            ? "Every fetched sitemap body parsed without a fatal XML diagnostic."
            : `${failures.length} sitemap(s) contained fatal or unclassified XML parse errors.`,
      }),
    ];
  },
);

const rsm010 = defineRuleVersion(
  {
    id: "RSM-010",
    title: "Sitemap exceeds supported URL or file-size limits",
    category: "robots-sitemaps",
    defaultSeverity: "high",
    scope: "site",
    description: "Checks explicit sitemap byte-limit and entry-limit observations.",
    eligibility: "Sitemap sizes, entries, or structured limit diagnostics must be available.",
    requiredData: ["configuration", "sitemaps", "sitemap-entries"],
    explanation:
      "Oversized sitemap files can be truncated or rejected, leaving a portion of the site's submitted URL inventory undiscovered and unevaluated.",
    expectedValue:
      "Every sitemap remains within the configured byte bound and the supported 50,000-entry limit.",
    recommendedFix:
      "Split oversized URL sets into smaller sitemap files, place them in a sitemap index, and keep each compressed and decoded document within configured limits.",
    verification:
      "Measure each sitemap response and parsed entry count and confirm that no size, structural, or entry-limit diagnostic is produced.",
    confidence: "high",
    impactAreas: SITEMAP_IMPACTS,
    responsibleOwner: "developer",
  },
  3,
  (snapshot) => {
    if (snapshot.sitemaps.length === 0) {
      return siteUnavailable(
        snapshot,
        "sitemap-limits",
        "No sitemap size observation was available.",
        ["sitemaps"],
      );
    }
    const failures = snapshot.sitemaps.filter(
      (item) =>
        hasSitemapLimitSignal(item) ||
        (item.contentLength !== null &&
          item.contentLength > snapshot.configuration.maxResponseBytes) ||
        item.transferSize > snapshot.configuration.maxResponseBytes ||
        item.entries.length > 50_000,
    );
    const unavailable = snapshot.sitemaps.filter(
      (item) => item.status !== "parsed" && !failures.includes(item),
    );
    const healthy = snapshot.sitemaps.filter(
      (item) => !failures.includes(item) && !unavailable.includes(item),
    );
    if (failures.length === 0 && unavailable.length > 0) {
      return incompleteSiteCoverage(
        snapshot,
        "sitemap-limits",
        "Sitemap transport failed before size and entry limits could be evaluated.",
        ["sitemaps", "sitemap-entries"],
      );
    }
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "sitemap-limits"),
        failed: failures.length > 0,
        evidence: boundedSitemapAggregateEvidence(
          snapshot,
          "sitemap_limit_sample",
          [...failures, ...unavailable, ...healthy],
          (item) =>
            `transfer_bytes=${item.transferSize};content_length_bytes=${item.contentLength ?? "unavailable"};parsed_entry_count=${item.entries.length}`,
          (item) =>
            boundedSitemapEvidence(item, "limit_observations", [
              `transfer_bytes=${item.transferSize}`,
              `content_length_bytes=${item.contentLength ?? "unavailable"}`,
              `parsed_entry_count=${item.entries.length}`,
              `configured_max_response_bytes=${snapshot.configuration.maxResponseBytes}`,
              "supported_max_entries=50000",
              `error_type=${item.errorType ?? "none"}`,
              ...item.parseIssues
                .filter(
                  (issue) =>
                    SITEMAP_LIMIT_ISSUES.has(issue.code) ||
                    SITEMAP_LIMIT_MESSAGE.test(issue.message),
                )
                .map((issue) => `diagnostic=${issue.code}`),
            ]),
        ),
        detectedValue:
          failures.length === 0
            ? "Every observed sitemap remained within the supported limits."
            : `${failures.length} sitemap(s) exceeded an explicit byte, structure, or URL-entry limit.`,
      }),
    ];
  },
);

function sitemapTargetRule(
  input: Readonly<{
    id: "RSM-011" | "RSM-012" | "RSM-013" | "RSM-014";
    title: string;
    defaultSeverity: "medium" | "high";
    description: string;
    explanation: string;
    expectedValue: string;
    recommendedFix: string;
    verification: string;
    version: 3 | 4 | 5;
    missingData: readonly AuditObservationKey[];
    assess(observation: SitemapEntryObservation): "fail" | "pass" | "unknown";
    evidenceItems(observation: SitemapEntryObservation): readonly AuditEvidenceItem[];
  }>,
): AuditRuleDefinition {
  return defineRuleVersion(
    {
      id: input.id,
      title: input.title,
      category: "robots-sitemaps",
      defaultSeverity: input.defaultSeverity,
      scope: "site",
      description: input.description,
      eligibility:
        "Every sitemap URL under evaluation must have its required target-page observation.",
      requiredData: ["sitemaps", "sitemap-entries", ...input.missingData],
      explanation: input.explanation,
      expectedValue: input.expectedValue,
      recommendedFix: input.recommendedFix,
      verification: input.verification,
      confidence: "high",
      impactAreas: SITEMAP_IMPACTS,
      responsibleOwner: "seo",
    },
    input.version,
    (snapshot) => {
      const observations = sitemapEntryObservations(snapshot);
      if (observations.length === 0) {
        return siteUnavailable(
          snapshot,
          input.id.toLowerCase(),
          "No sitemap URL entry was available for target evaluation.",
          ["sitemap-entries"],
        );
      }
      const assessed = observations.map((observation) => ({
        observation,
        assessment: input.assess(observation),
      }));
      const failures = assessed.filter((item) => item.assessment === "fail");
      const unknown = assessed.filter((item) => item.assessment === "unknown");
      const passing = assessed.filter((item) => item.assessment === "pass");
      const prioritized = [...failures, ...unknown, ...passing];
      const aggregateEvidence = crawlEvidence(snapshot, `${input.id.toLowerCase()}_target_sample`, [
        `evaluated=${assessed.length}`,
        `failed=${failures.length}`,
        `unknown=${unknown.length}`,
        `passed=${passing.length}`,
        ...sampleEvidenceStrings(
          prioritized.map(
            ({ observation, assessment }) =>
              `entry=${observation.entry.id};target_page=${observation.page?.id ?? "unavailable"};assessment=${assessment};url=${boundedEvidenceUrl(observation.entry.normalizedLoc)}`,
          ),
          { maximumItems: 8, maximumItemBytes: 1_024, maximumTotalBytes: 8_192 },
        ),
      ]);
      const detailedEvidence = prioritized
        .slice(0, 8)
        .flatMap(({ observation }) => input.evidenceItems(observation).slice(0, 3));
      if (failures.length === 0 && unknown.length > 0) {
        return incompleteSiteCoverage(
          snapshot,
          input.id.toLowerCase(),
          "One or more sitemap targets lacked the observations required for this conclusion.",
          input.missingData,
          [aggregateEvidence, ...detailedEvidence],
        );
      }
      return [
        checkedOutcome({
          target: siteTarget(snapshot, input.id.toLowerCase()),
          failed: failures.length > 0,
          evidence: [aggregateEvidence, ...detailedEvidence],
          detectedValue:
            failures.length === 0
              ? `${assessed.length} sitemap URL target(s) met the expected condition.`
              : `${failures.length} of ${assessed.length} sitemap URL target(s) violated the expected condition.`,
        }),
      ];
    },
  );
}

const rsm011 = sitemapTargetRule({
  id: "RSM-011",
  title: "Sitemap contains noncanonical URLs",
  defaultSeverity: "medium",
  description: "Compares each observed sitemap URL with its page's explicit canonical target.",
  explanation:
    "Submitting a URL that canonicalizes elsewhere sends conflicting inventory and canonicalization signals and wastes sitemap crawl attention.",
  expectedValue: "Every evaluated sitemap URL is its page's canonical URL.",
  recommendedFix:
    "Replace each noncanonical sitemap entry with the preferred canonical URL and update internal links to use that same URL directly.",
  verification:
    "Fetch each sitemap URL and confirm that any single canonical declaration matches the submitted normalized URL exactly.",
  version: 3,
  missingData: ["pages", "raw-extraction"],
  assess: ({ entry, page }) => {
    if (page?.extraction === null || page === null || page.extraction.source !== "raw") {
      return "unknown";
    }
    if (page.extraction.canonicalTagCount !== 1) return "unknown";
    if (page.extraction.canonicalNormalizationFailure !== null) return "fail";
    const canonical = page.extraction.canonicalUrl;
    return canonical === null ? "unknown" : canonical === entry.normalizedLoc ? "pass" : "fail";
  },
  evidenceItems: (observation) => {
    const mapping = boundedSitemapEntryEvidence(observation, "sitemap_target_mapping", [
      `target_page_id=${observation.page?.id ?? "unavailable"}`,
      `entry_url=${boundedEvidenceUrl(observation.entry.normalizedLoc)}`,
    ]);
    const targetPage = observation.page;
    const extraction = targetPage?.extraction;
    return targetPage !== null && extraction?.source === "raw"
      ? [
          mapping,
          boundedPageEvidence(
            targetPage,
            "canonical_resolution",
            [
              `canonical_tag_count=${extraction.canonicalTagCount}`,
              `canonical_url=${
                extraction.canonicalUrl === null
                  ? "unavailable"
                  : boundedEvidenceUrl(extraction.canonicalUrl)
              }`,
              `normalization_failure=${extraction.canonicalNormalizationFailure?.code ?? "none"}`,
            ],
            "raw",
          ),
        ]
      : [
          mapping,
          ...(targetPage === null
            ? []
            : [
                boundedPageEvidence(
                  targetPage,
                  "canonical_resolution",
                  "raw-extraction-unavailable",
                ),
              ]),
        ];
  },
});

const rsm012 = sitemapTargetRule({
  id: "RSM-012",
  title: "Sitemap contains redirected URLs",
  defaultSeverity: "medium",
  description: "Checks direct sitemap URL observations for one or more HTTP redirect hops.",
  explanation:
    "Redirecting sitemap entries require extra requests and advertise obsolete locations instead of the final URLs crawlers should index.",
  expectedValue: "Every sitemap URL resolves directly without a redirect hop.",
  recommendedFix:
    "Replace every redirected sitemap entry with its final nonredirecting destination and regenerate the sitemap from canonical URLs.",
  verification:
    "Request each sitemap URL directly and confirm an empty redirect chain and a successful final response.",
  version: 3,
  missingData: ["pages", "transport", "redirects"],
  assess: ({ page }) => {
    if (page === null || page.statusCode === null) return "unknown";
    return page.redirectChain.length > 0 ? "fail" : "pass";
  },
  evidenceItems: (observation) => [
    boundedSitemapEntryEvidence(observation, "sitemap_target_mapping", [
      `target_page_id=${observation.page?.id ?? "unavailable"}`,
      `entry_url=${boundedEvidenceUrl(observation.entry.normalizedLoc)}`,
    ]),
    ...(observation.page === null
      ? []
      : [
          boundedPageEvidence(observation.page, "redirect_resolution", [
            `status_code=${observation.page.statusCode ?? "unavailable"}`,
            `redirect_hops=${observation.page.redirectChain.length}`,
            `final_url=${
              observation.page.finalUrl === null
                ? "unavailable"
                : boundedEvidenceUrl(observation.page.finalUrl)
            }`,
          ]),
        ]),
  ],
});

const rsm013 = sitemapTargetRule({
  id: "RSM-013",
  title: "Sitemap contains 4xx or 5xx URLs",
  defaultSeverity: "high",
  description: "Checks direct sitemap URL observations for client and server error responses.",
  explanation:
    "Erroring sitemap entries advertise unavailable pages, waste crawl requests, and reduce confidence in the submitted inventory.",
  expectedValue: "Every evaluated sitemap URL returns a non-error response.",
  recommendedFix:
    "Restore each submitted URL to a successful response or remove it and replace it with the correct live canonical URL.",
  verification:
    "Request every submitted URL and confirm that none returns an HTTP status from 400 through 599.",
  version: 3,
  missingData: ["pages", "transport"],
  assess: ({ page }) => {
    if (page === null || page.statusCode === null) return "unknown";
    return page.statusCode >= 400 ? "fail" : "pass";
  },
  evidenceItems: (observation) => [
    boundedSitemapEntryEvidence(observation, "sitemap_target_mapping", [
      `target_page_id=${observation.page?.id ?? "unavailable"}`,
      `entry_url=${boundedEvidenceUrl(observation.entry.normalizedLoc)}`,
    ]),
    ...(observation.page === null
      ? []
      : [
          boundedPageEvidence(observation.page, "target_response", [
            `status_code=${observation.page.statusCode ?? "unavailable"}`,
            `error_type=${observation.page.errorType ?? "none"}`,
          ]),
        ]),
  ],
});

const rsm014 = sitemapTargetRule({
  id: "RSM-014",
  title: "Sitemap contains noindex or robots-blocked URLs",
  defaultSeverity: "high",
  description:
    "Checks sitemap targets for effective robots blocking and raw noindex directives applicable to the configured crawler.",
  explanation:
    "A sitemap should advertise crawlable index candidates; blocked or noindex entries send directly contradictory discovery and indexability signals.",
  expectedValue:
    "Every sitemap URL is robots-allowed and does not declare noindex for the configured crawler.",
  recommendedFix:
    "Remove the blocking or noindex directive when the page belongs in search, otherwise remove the URL from every submitted sitemap.",
  verification:
    "Re-crawl each sitemap entry and confirm an allowed robots decision and no applicable meta or X-Robots noindex directive for the configured crawler.",
  version: 5,
  missingData: ["pages", "transport", "raw-extraction", "robots"],
  assess: ({ page }) => {
    if (page === null || page.robotsDecision === "not-checked") return "unknown";
    if (page.robotsDecision === "disallowed") return "fail";
    if (page.extraction === null || page.extraction.source !== "raw") return "unknown";
    if (!page.extraction.directiveScopePreserved) return "unknown";
    return hasNoindex(page.extraction.metaRobots) || hasNoindex(page.extraction.xRobotsTag)
      ? "fail"
      : "pass";
  },
  evidenceItems: (observation) => [
    boundedSitemapEntryEvidence(observation, "sitemap_target_mapping", [
      `target_page_id=${observation.page?.id ?? "unavailable"}`,
      `entry_url=${boundedEvidenceUrl(observation.entry.normalizedLoc)}`,
    ]),
    ...(observation.page === null
      ? []
      : [
          boundedPageEvidence(
            observation.page,
            "target_robots_decision",
            observation.page.robotsDecision,
          ),
          ...(observation.page.extraction?.source === "raw"
            ? [
                boundedPageEvidence(
                  observation.page,
                  "target_index_directives",
                  [
                    `directive_scope_preserved=${observation.page.extraction.directiveScopePreserved}`,
                    ...sampleEvidenceStrings(
                      [
                        ...observation.page.extraction.metaRobots.map(
                          (directive) => `meta=${directive}`,
                        ),
                        ...observation.page.extraction.xRobotsTag.map(
                          (directive) => `x_robots_tag=${directive}`,
                        ),
                      ],
                      { maximumItems: 8, maximumItemBytes: 512, maximumTotalBytes: 4_096 },
                    ),
                  ],
                  "raw",
                ),
              ]
            : []),
        ]),
  ],
});

const rsm015 = defineRuleVersion(
  {
    id: "RSM-015",
    title: "Sitemap inventory does not align with important crawlable pages",
    category: "robots-sitemaps",
    defaultSeverity: "medium",
    scope: "site",
    description:
      "Compares parsed sitemap entries with the completed crawl's explicit important-page set.",
    eligibility:
      "The crawl must be complete, and important indexable pages plus parsed sitemap entries must be available.",
    requiredData: [
      "crawl",
      "pages",
      "transport",
      "raw-extraction",
      "robots",
      "sitemaps",
      "sitemap-entries",
    ],
    explanation:
      "When important crawlable pages are missing from the sitemap, the submitted inventory no longer represents the pages the site most needs crawlers to discover.",
    expectedValue: "At least 90% of important indexable pages appear in a parsed sitemap.",
    recommendedFix:
      "Add every missing important canonical and crawlable URL to the appropriate XML sitemap, then regenerate and resubmit its sitemap index.",
    verification:
      "Run a complete crawl and confirm that the missing-important-page ratio does not exceed the versioned policy threshold.",
    confidence: "medium",
    impactAreas: SITEMAP_IMPACTS,
    responsibleOwner: "seo",
  },
  5,
  (snapshot, policy) => {
    if (snapshot.status !== "completed") {
      return siteUnavailable(
        snapshot,
        "sitemap-important-coverage",
        "A partial crawl cannot prove site-wide sitemap inventory alignment.",
        ["crawl"],
      );
    }
    const importantCandidates = snapshot.pages.filter(
      (page) => page.importance !== "standard" || page.discoverySource === "seed",
    );
    if (importantCandidates.length === 0) {
      return [
        notCheckedOutcome({
          target: siteTarget(snapshot, "sitemap-important-coverage"),
          snapshot,
          state: "ineligible",
          reason: "No page has a supported importance signal for sitemap inventory comparison.",
          missingData: [],
        }),
      ];
    }
    const classified = importantCandidates.map((page) => ({
      page,
      state: importantPageIndexability(page),
    }));
    const unknown = classified.filter((item) => item.state === "unknown");
    if (unknown.length > 0) {
      return incompleteSiteCoverage(
        snapshot,
        "sitemap-important-coverage",
        "Important-page transport, robots, raw extraction, or directive-scope coverage is incomplete, so the sitemap inventory denominator is unknown.",
        [...new Set(unknown.flatMap(({ page }) => pageIndexabilityMissingData(page)))],
        unknown
          .slice(0, 25)
          .map(({ page }) =>
            pageEvidence(page, "indexabilityCoverage", [
              page.statusCode,
              page.contentType,
              page.robotsDecision,
              page.extraction?.source ?? "missing",
              page.extraction?.directiveScopePreserved ?? false,
            ]),
          ),
      );
    }
    const important = classified
      .filter((item) => item.state === "indexable")
      .map((item) => item.page);
    const parsedSitemaps = snapshot.sitemaps.filter((item) => item.status === "parsed");
    if (important.length === 0) {
      return [
        notCheckedOutcome({
          target: siteTarget(snapshot, "sitemap-important-coverage"),
          snapshot,
          state: "ineligible",
          reason: "No important page was conclusively indexable for sitemap inventory comparison.",
          missingData: [],
          evidence: [crawlEvidence(snapshot, "importantIndexablePageCount", 0)],
        }),
      ];
    }
    if (parsedSitemaps.length === 0) {
      return siteUnavailable(
        snapshot,
        "sitemap-important-coverage",
        "Parsed sitemap entries were unavailable.",
        ["sitemaps", "sitemap-entries"],
      );
    }
    const submittedUrls = new Set(
      parsedSitemaps.flatMap((item) =>
        item.entries
          .filter((entry) => entry.entryType === "url")
          .map((entry) => entry.normalizedLoc),
      ),
    );
    const missing = important.filter((page) => {
      const preferred = page.extraction?.canonicalUrl ?? page.finalUrl ?? page.normalizedUrl;
      return !submittedUrls.has(preferred);
    });
    if (missing.length > 0 && snapshot.sitemaps.some((item) => item.status !== "parsed")) {
      return incompleteSiteCoverage(
        snapshot,
        "sitemap-important-coverage",
        "An unavailable sitemap could contain the apparently missing important pages.",
        ["sitemaps", "sitemap-entries"],
      );
    }
    const ratio = missing.length / important.length;
    const evidenceItems =
      missing.length === 0
        ? [crawlEvidence(snapshot, "importantSitemapCoverage", 1)]
        : missing.slice(0, 25).map((page) => pageEvidence(page, "sitemapMembership", false, "raw"));
    return [
      checkedOutcome({
        target: siteTarget(snapshot, "sitemap-important-coverage"),
        failed: ratio > policy.sitemapMismatchRatio,
        evidence: evidenceItems,
        detectedValue: `${missing.length} of ${important.length} important indexable page(s) were missing from parsed sitemaps (${ratio.toFixed(3)}).`,
        expectedValue: `Missing ratio at or below ${policy.sitemapMismatchRatio.toFixed(3)}.`,
      }),
    ];
  },
);

export const RSM_RULES: readonly AuditRuleDefinition[] = Object.freeze([
  rsm001,
  rsm002,
  rsm003,
  rsm004,
  rsm005,
  rsm006,
  rsm007,
  rsm008,
  rsm009,
  rsm010,
  rsm011,
  rsm012,
  rsm013,
  rsm014,
  rsm015,
]);
