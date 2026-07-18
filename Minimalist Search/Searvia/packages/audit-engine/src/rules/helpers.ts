import { createHash } from "node:crypto";

import type {
  AuditConfidence,
  AuditEvidenceItem,
  AuditEvidenceKind,
  AuditEvidenceScalar,
  AuditEvidenceSource,
  AuditResultStatus,
} from "@searvia/shared-types";

import type {
  AuditEnginePolicy,
  AuditObservationKey,
  AuditRuleDefinition,
  AuditRuleOutcome,
  AuditRuleTarget,
} from "../contracts.js";
import type { AuditCrawlSnapshot, AuditPageObservation, AuditSitemapEntry } from "../snapshot.js";

const DEFAULT_EVIDENCE_ITEM_BYTES = 2_048;
const DEFAULT_EVIDENCE_SAMPLE_BYTES = 16_384;
const DEFAULT_EVIDENCE_SAMPLE_ITEMS = 20;

type RuleMetadata = Omit<
  AuditRuleDefinition,
  "deterministic" | "evaluate" | "firstSupportedVersion" | "version"
>;

export function defineRule(
  metadata: RuleMetadata,
  evaluate: (
    snapshot: AuditCrawlSnapshot,
    policy: AuditEnginePolicy,
  ) => readonly AuditRuleOutcome[],
): AuditRuleDefinition {
  return defineRuleVersion(metadata, 2, evaluate);
}

/** Defines the first immutable version of a rule introduced by the M5 catalog expansion. */
export function defineM5Rule(
  metadata: RuleMetadata,
  evaluate: (
    snapshot: AuditCrawlSnapshot,
    policy: AuditEnginePolicy,
  ) => readonly AuditRuleOutcome[],
): AuditRuleDefinition {
  return defineM5RuleVersion(metadata, 1, evaluate);
}

/** Defines a later immutable version of a rule introduced by the M5 catalog expansion. */
export function defineM5RuleVersion(
  metadata: RuleMetadata,
  version: number,
  evaluate: (
    snapshot: AuditCrawlSnapshot,
    policy: AuditEnginePolicy,
  ) => readonly AuditRuleOutcome[],
): AuditRuleDefinition {
  return defineRuleVersionWithSupport(metadata, version, "M5", evaluate);
}

export function defineRuleVersion(
  metadata: RuleMetadata,
  version: number,
  evaluate: (
    snapshot: AuditCrawlSnapshot,
    policy: AuditEnginePolicy,
  ) => readonly AuditRuleOutcome[],
): AuditRuleDefinition {
  return defineRuleVersionWithSupport(metadata, version, "M4A", evaluate);
}

function defineRuleVersionWithSupport(
  metadata: RuleMetadata,
  version: number,
  firstSupportedVersion: "M4A" | "M5",
  evaluate: (
    snapshot: AuditCrawlSnapshot,
    policy: AuditEnginePolicy,
  ) => readonly AuditRuleOutcome[],
): AuditRuleDefinition {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError("Rule version must be a positive safe integer.");
  }
  return Object.freeze({
    ...metadata,
    version,
    deterministic: true,
    firstSupportedVersion,
    requiredData: Object.freeze([...metadata.requiredData]),
    impactAreas: Object.freeze([...metadata.impactAreas]),
    evaluate,
  });
}

function digestEvidenceValues(values: readonly string[]): string {
  const hash = createHash("sha256");
  for (const value of values) {
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update(":");
    hash.update(value);
    hash.update("\n");
  }
  return hash.digest("hex");
}

/**
 * Bounds untrusted evidence text by UTF-8 bytes without splitting a code point. Truncated values
 * retain a deterministic digest so two long values with the same visible prefix remain distinct.
 */
export function boundedEvidenceText(
  value: string,
  maximumBytes = DEFAULT_EVIDENCE_ITEM_BYTES,
): string {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 96) {
    throw new RangeError("Evidence text byte limits must be safe integers of at least 96 bytes.");
  }
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return value;

  const suffix = `… [sha256:${digestEvidenceValues([value])}]`;
  const prefixBudget = maximumBytes - Buffer.byteLength(suffix, "utf8");
  let prefix = "";
  let prefixBytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (prefixBytes + characterBytes > prefixBudget) break;
    prefix += character;
    prefixBytes += characterBytes;
  }
  return `${prefix}${suffix}`;
}

export interface EvidenceStringSampleOptions {
  readonly maximumItems?: number;
  readonly maximumItemBytes?: number;
  readonly maximumTotalBytes?: number;
}

/**
 * Samples high-cardinality string evidence in stable input order. The serialized string array is
 * kept within the requested byte budget and an omission marker hashes every value left out.
 */
export function sampleEvidenceStrings(
  values: readonly string[],
  options: EvidenceStringSampleOptions = {},
): readonly string[] {
  const maximumItems = options.maximumItems ?? DEFAULT_EVIDENCE_SAMPLE_ITEMS;
  const maximumItemBytes = options.maximumItemBytes ?? DEFAULT_EVIDENCE_ITEM_BYTES;
  const maximumTotalBytes = options.maximumTotalBytes ?? DEFAULT_EVIDENCE_SAMPLE_BYTES;
  if (!Number.isSafeInteger(maximumItems) || maximumItems < 1 || maximumItems > 25) {
    throw new RangeError("Evidence samples must contain between 1 and 25 items.");
  }
  if (!Number.isSafeInteger(maximumTotalBytes) || maximumTotalBytes < 256) {
    throw new RangeError(
      "Evidence sample byte limits must be safe integers of at least 256 bytes.",
    );
  }
  if (!Number.isSafeInteger(maximumItemBytes) || maximumItemBytes < 96) {
    throw new RangeError("Evidence item byte limits must be safe integers of at least 96 bytes.");
  }

  const sampled: string[] = [];
  let consumed = 0;
  const appendLimit = Math.max(0, maximumItems - (values.length > maximumItems ? 1 : 0));
  while (consumed < values.length && sampled.length < appendLimit) {
    const candidate = boundedEvidenceText(values[consumed] ?? "", maximumItemBytes);
    if (Buffer.byteLength(JSON.stringify([...sampled, candidate]), "utf8") > maximumTotalBytes) {
      break;
    }
    sampled.push(candidate);
    consumed += 1;
  }

  if (consumed < values.length) {
    while (sampled.length > 0) {
      const omitted = values.slice(consumed);
      const marker = `omitted=${omitted.length}; sha256:${digestEvidenceValues(omitted)}`;
      if (Buffer.byteLength(JSON.stringify([...sampled, marker]), "utf8") <= maximumTotalBytes) {
        break;
      }
      consumed -= 1;
      sampled.pop();
    }
    const omitted = values.slice(consumed);
    sampled.push(`omitted=${omitted.length}; sha256:${digestEvidenceValues(omitted)}`);
  }

  return Object.freeze(sampled);
}

/** Bounds and masks a URL before it is copied into a multi-observation evidence object. */
export function boundedEvidenceUrl(value: string, maximumBytes = 1_024): string {
  const absolute = safeUrl(value);
  let parsed = absolute;
  let relative = false;
  if (parsed === null && value.startsWith("/")) {
    try {
      parsed = new URL(value, "https://evidence.invalid");
      relative = true;
    } catch {
      // Preserve the non-URL value below; the general evidence boundary will still validate it.
    }
  }
  if (parsed === null) return boundedEvidenceText(value, maximumBytes);

  if (parsed.username !== "" || parsed.password !== "") {
    parsed.username = "redacted";
    parsed.password = "";
  }
  const names = [...new Set(parsed.searchParams.keys())].sort();
  parsed.search = "";
  for (const name of names) parsed.searchParams.append(name, "[redacted]");
  if (parsed.hash !== "") parsed.hash = "#[redacted]";
  const privacySafe = relative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
  return boundedEvidenceText(privacySafe, maximumBytes);
}

/** Stable source identity for persisted observations that predate explicit observation IDs. */
export function evidenceObservationDigest(values: readonly string[]): string {
  return digestEvidenceValues(values);
}

export function siteTarget(snapshot: AuditCrawlSnapshot, key = "site"): AuditRuleTarget {
  return Object.freeze({
    scope: "site",
    key: `${snapshot.origin}#${key}`,
    pageId: null,
    normalizedUrl: null,
  });
}

export function pageTarget(page: AuditPageObservation): AuditRuleTarget {
  return Object.freeze({
    scope: "page",
    key: page.normalizedUrl,
    pageId: page.id,
    normalizedUrl: page.normalizedUrl,
  });
}

export function unavailablePageTarget(snapshot: AuditCrawlSnapshot, key: string): AuditRuleTarget {
  return Object.freeze({
    scope: "page",
    key: `${snapshot.origin}#${key}`,
    pageId: null,
    normalizedUrl: null,
  });
}

export interface EvidenceInput {
  readonly kind: AuditEvidenceKind;
  readonly source: AuditEvidenceSource;
  readonly observationId: string;
  readonly observedAt: string;
  readonly field: string;
  readonly value: AuditEvidenceScalar | readonly AuditEvidenceScalar[];
  readonly url?: string;
  readonly excerpt?: string;
}

export function evidence(input: EvidenceInput): AuditEvidenceItem {
  return Object.freeze({
    kind: input.kind,
    source: input.source,
    observationId: input.observationId,
    observedAt: input.observedAt,
    field: input.field,
    value: input.value,
    ...(input.url === undefined ? {} : { url: maskedUrlForEvidence(input.url) }),
    ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt.slice(0, 1_000) }),
  });
}

export function crawlEvidence(
  snapshot: AuditCrawlSnapshot,
  field: string,
  value: AuditEvidenceScalar | readonly AuditEvidenceScalar[],
): AuditEvidenceItem {
  return evidence({
    kind: "crawl",
    source: "crawl",
    observationId: snapshot.crawlId,
    observedAt: snapshot.finishedAt,
    field,
    value,
    url: snapshot.origin,
  });
}

export function pageEvidence(
  page: AuditPageObservation,
  field: string,
  value: AuditEvidenceScalar | readonly AuditEvidenceScalar[],
  source: AuditEvidenceSource = "transport",
): AuditEvidenceItem {
  const extraction =
    source === "raw" ? page.extraction : source === "rendered" ? page.renderedExtraction : null;
  return evidence({
    kind: source === "raw" || source === "rendered" ? "extraction" : "page",
    source,
    observationId: extraction?.id ?? page.id,
    observedAt: extraction?.extractedAt ?? page.observedAt,
    field,
    value,
    url: maskedUrlForEvidence(page.normalizedUrl),
  });
}

/** Page/extraction evidence variant for aggregate rules that may emit many long page URLs. */
export function boundedPageEvidence(
  page: AuditPageObservation,
  field: string,
  value: AuditEvidenceScalar | readonly AuditEvidenceScalar[],
  source: AuditEvidenceSource = "transport",
): AuditEvidenceItem {
  const extraction =
    source === "raw" ? page.extraction : source === "rendered" ? page.renderedExtraction : null;
  return evidence({
    kind: source === "raw" || source === "rendered" ? "extraction" : "page",
    source,
    observationId: extraction?.id ?? page.id,
    observedAt: extraction?.extractedAt ?? page.observedAt,
    field,
    value,
    url: boundedEvidenceUrl(page.normalizedUrl),
  });
}

export function eligibleOutcome(
  input: Readonly<{
    target: AuditRuleTarget;
    status: Exclude<AuditResultStatus, "not-checked">;
    evidence: readonly AuditEvidenceItem[];
    detectedValue: string;
    expectedValue?: string;
    confidence?: AuditConfidence;
    reason?: string;
  }>,
): AuditRuleOutcome {
  return Object.freeze({
    target: input.target,
    eligibility: Object.freeze({
      state: "eligible",
      reason: input.reason ?? "All required observations are available.",
    }),
    status: input.status,
    evidence: Object.freeze([...input.evidence]),
    detectedValue: input.detectedValue,
    ...(input.expectedValue === undefined ? {} : { expectedValue: input.expectedValue }),
    ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
  });
}

export function checkedOutcome(
  input: Readonly<{
    target: AuditRuleTarget;
    failed: boolean;
    evidence: readonly AuditEvidenceItem[];
    detectedValue: string;
    expectedValue?: string;
    confidence?: AuditConfidence;
    reason?: string;
    failureStatus?: "failed" | "warning";
  }>,
): AuditRuleOutcome {
  return eligibleOutcome({
    target: input.target,
    status: input.failed ? (input.failureStatus ?? "failed") : "passed",
    evidence: input.evidence,
    detectedValue: input.detectedValue,
    ...(input.expectedValue === undefined ? {} : { expectedValue: input.expectedValue }),
    ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });
}

export function notCheckedOutcome(
  input: Readonly<{
    target: AuditRuleTarget;
    snapshot: AuditCrawlSnapshot;
    reason: string;
    state?: "ineligible" | "unavailable";
    missingData: readonly AuditObservationKey[];
    evidence?: readonly AuditEvidenceItem[];
  }>,
): AuditRuleOutcome {
  return Object.freeze({
    target: input.target,
    eligibility: Object.freeze({
      state: input.state ?? "unavailable",
      reason: input.reason,
      missingData: Object.freeze([...input.missingData]),
    }),
    status: "not-checked",
    evidence: Object.freeze(
      input.evidence === undefined
        ? [crawlEvidence(input.snapshot, "eligibility", input.reason)]
        : [...input.evidence],
    ),
    detectedValue: input.reason,
  });
}

export function headerValues(headers: Readonly<Record<string, readonly string[]>>, name: string) {
  return headers[name.toLowerCase()] ?? [];
}

export function normalizedContentType(value: string | null): string | null {
  if (value === null) return null;
  const type = value.split(";", 1)[0]?.trim().toLowerCase();
  return type === "" || type === undefined ? null : type;
}

export function isHtmlContentType(value: string | null): boolean {
  const type = normalizedContentType(value);
  return type === "text/html" || type === "application/xhtml+xml";
}

export function isSuccessful(page: AuditPageObservation): boolean {
  return page.statusCode !== null && page.statusCode >= 200 && page.statusCode < 300;
}

export function directiveSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values.flatMap((value) => value.toLowerCase().split(/\s*,\s*/u)));
}

export function hasNoindex(values: readonly string[]): boolean {
  const directives = directiveSet(values);
  return directives.has("noindex") || directives.has("none");
}

export type PageIndexabilityState = "indexable" | "not-indexable" | "unknown";

/**
 * Classifies effective page indexability without collapsing unavailable policy evidence into a
 * negative answer. A conclusive blocking signal wins, while a successful HTML response needs raw,
 * crawler-scoped directives before it can be called indexable.
 */
export function pageIndexabilityState(page: AuditPageObservation): PageIndexabilityState {
  if (page.robotsDecision === "disallowed") return "not-indexable";
  if (page.statusCode === null) return "unknown";
  if (!isSuccessful(page)) return "not-indexable";
  if (page.contentType === null) return "unknown";
  if (!isHtmlContentType(page.contentType)) return "not-indexable";
  if (page.robotsDecision === "not-checked") return "unknown";
  if (page.extraction === null || page.extraction.source !== "raw") return "unknown";
  if (!page.extraction.directiveScopePreserved) return "unknown";
  return hasNoindex(page.extraction.metaRobots) || hasNoindex(page.extraction.xRobotsTag)
    ? "not-indexable"
    : "indexable";
}

/**
 * Classifies the requested crawl URL rather than the final response document. A requested URL
 * that redirected is not itself an indexable page even when the final destination returned HTML.
 */
export function requestedPageIndexabilityState(page: AuditPageObservation): PageIndexabilityState {
  return page.redirectChain.length > 0 ? "not-indexable" : pageIndexabilityState(page);
}

export function pageIndexabilityMissingData(
  page: AuditPageObservation,
): readonly AuditObservationKey[] {
  if (pageIndexabilityState(page) !== "unknown") return Object.freeze([]);
  if (page.statusCode === null || (isSuccessful(page) && page.contentType === null)) {
    return Object.freeze(["transport"]);
  }
  if (page.robotsDecision === "not-checked") return Object.freeze(["robots"]);
  return Object.freeze(["raw-extraction"]);
}

export function isIndexable(page: AuditPageObservation): boolean {
  return pageIndexabilityState(page) === "indexable";
}

export function pagesById(snapshot: AuditCrawlSnapshot): ReadonlyMap<string, AuditPageObservation> {
  return new Map(snapshot.pages.map((page) => [page.id, page]));
}

export function pagesByUrl(
  snapshot: AuditCrawlSnapshot,
): ReadonlyMap<string, AuditPageObservation> {
  const pages = new Map<string, AuditPageObservation>();
  const ambiguous = new Set<string>();
  for (const page of [...snapshot.pages].sort((left, right) => left.id.localeCompare(right.id))) {
    if (ambiguous.has(page.normalizedUrl)) continue;
    if (pages.has(page.normalizedUrl)) {
      pages.delete(page.normalizedUrl);
      ambiguous.add(page.normalizedUrl);
      continue;
    }
    pages.set(page.normalizedUrl, page);
  }
  return pages;
}

export function maskedUrlForEvidence(value: string): string {
  const parsed = safeUrl(value);
  if (parsed === null) return value;
  if (parsed.username !== "" || parsed.password !== "") {
    parsed.username = "redacted";
    parsed.password = "";
  }
  const names = [...new Set(parsed.searchParams.keys())].sort();
  parsed.search = "";
  for (const name of names) parsed.searchParams.append(name, "[redacted]");
  if (parsed.hash !== "") parsed.hash = "#[redacted]";
  return parsed.href;
}

export function inboundInternalLinks(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
): readonly Readonly<{ source: AuditPageObservation; linkId: string }>[] {
  return Object.freeze(
    snapshot.pages.flatMap((source) =>
      source.links
        .filter(
          (link) =>
            link.scope === "internal" &&
            (link.targetPageId === page.id || link.normalizedTargetUrl === page.normalizedUrl),
        )
        .map((link) => Object.freeze({ source, linkId: link.id })),
    ),
  );
}

export function sitemapEntriesForPage(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
): readonly AuditSitemapEntry[] {
  return Object.freeze(
    snapshot.sitemaps.flatMap((sitemap) =>
      sitemap.entries.filter(
        (entry) =>
          entry.entryType === "url" &&
          (entry.targetPageId === page.id || entry.normalizedLoc === page.normalizedUrl),
      ),
    ),
  );
}

export function importantPages(snapshot: AuditCrawlSnapshot): readonly AuditPageObservation[] {
  return Object.freeze(
    snapshot.pages.filter(
      (page) =>
        page.importance !== "standard" ||
        page.discoverySource === "seed" ||
        sitemapEntriesForPage(snapshot, page).length > 0,
    ),
  );
}

export function canonicalTarget(
  snapshot: AuditCrawlSnapshot,
  page: AuditPageObservation,
): AuditPageObservation | null {
  const canonical = page.extraction?.canonicalUrl;
  return canonical === null || canonical === undefined
    ? null
    : (pagesByUrl(snapshot).get(canonical) ?? null);
}

export function fingerprintDistance(left: string, right: string): number | null {
  if (!/^[0-9a-f]+$/iu.test(left) || !/^[0-9a-f]+$/iu.test(right) || left.length !== right.length) {
    return null;
  }
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftNibble = Number.parseInt(left[index] ?? "", 16);
    const rightNibble = Number.parseInt(right[index] ?? "", 16);
    let value = leftNibble ^ rightNibble;
    while (value > 0) {
      distance += value & 1;
      value >>>= 1;
    }
  }
  return distance;
}

export function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function siteUnavailable(
  snapshot: AuditCrawlSnapshot,
  key: string,
  reason: string,
  missingData: readonly AuditObservationKey[],
): readonly AuditRuleOutcome[] {
  return [
    notCheckedOutcome({
      target: siteTarget(snapshot, key),
      snapshot,
      reason,
      missingData,
    }),
  ];
}

export function pageUnavailable(
  snapshot: AuditCrawlSnapshot,
  key: string,
  reason: string,
  missingData: readonly AuditObservationKey[],
): readonly AuditRuleOutcome[] {
  return [
    notCheckedOutcome({
      target: unavailablePageTarget(snapshot, key),
      snapshot,
      reason,
      missingData,
    }),
  ];
}
