import { createHash } from "node:crypto";

import { CrawlError, isCrawlError } from "./errors.js";
import type { CrawlErrorCode } from "./errors.js";
import { systemCrawlClock } from "./frontier.js";
import { isRetryableHttpStatus, SEARVIA_CRAWLER_USER_AGENT } from "./safe-http.js";
import type { CrawlClock, CrawlScope, SafeFetchResponse, SafeHttpClient } from "./types.js";
import { normalizeCrawlUrl } from "./url.js";

const MAX_ROBOTS_RULES = 10_000;
const MAX_ROBOTS_LINE_LENGTH = 8_192;
const MAX_CRAWL_DELAY_MS = 24 * 60 * 60 * 1_000;
export const MAX_PERSISTED_ROBOTS_BYTES = 500_000;
const HEX_OCTET = /^[\da-f]{2}$/iu;
const UNRESERVED_OCTET = /^[a-z\d\-._~]$/iu;

interface RobotsRule {
  readonly directive: "allow" | "disallow";
  readonly pattern: string;
  readonly precedence: number;
}

interface RobotsGroup {
  readonly agents: string[];
  readonly rules: RobotsRule[];
  crawlDelayMs: number | null;
}

function canonicalizeRobotsPath(value: string, kind: "candidate" | "rule"): string {
  let result = "";
  for (let index = 0; index < value.length;) {
    if (value[index] === "%" && HEX_OCTET.test(value.slice(index + 1, index + 3))) {
      const octet = Number.parseInt(value.slice(index + 1, index + 3), 16);
      const character = String.fromCharCode(octet);
      result += UNRESERVED_OCTET.test(character)
        ? character
        : `%${octet.toString(16).padStart(2, "0").toUpperCase()}`;
      index += 3;
      continue;
    }

    const codePoint = value.codePointAt(index) ?? 0;
    const character = String.fromCodePoint(codePoint);
    if (codePoint > 0x20 && codePoint < 0x7f) {
      const isRuleOperator =
        kind === "rule" && (character === "*" || (character === "$" && index === value.length - 1));
      result +=
        isRuleOperator || (character !== "*" && character !== "$")
          ? character
          : `%${codePoint.toString(16).padStart(2, "0").toUpperCase()}`;
    } else {
      for (const octet of new TextEncoder().encode(character)) {
        result += `%${octet.toString(16).padStart(2, "0").toUpperCase()}`;
      }
    }
    index += character.length;
  }
  return result;
}

function robotsRulePrecedence(pattern: string): number {
  const end = pattern.endsWith("$") ? pattern.length - 1 : pattern.length;
  let precedence = 0;
  for (let index = 0; index < end;) {
    if (pattern[index] === "*") {
      index += 1;
      continue;
    }
    if (pattern[index] === "%" && HEX_OCTET.test(pattern.slice(index + 1, index + 3))) {
      precedence += 1;
      index += 3;
      continue;
    }
    const character = String.fromCodePoint(pattern.codePointAt(index) ?? 0);
    precedence += 1;
    index += character.length;
  }
  return precedence;
}

export interface ParsedRobots {
  readonly crawlDelayMs: number | null;
  readonly sitemapUrls: readonly string[];
  allows(url: string | URL): boolean;
}

export interface RobotsPolicy extends ParsedRobots {
  readonly contentBytes: number;
  readonly content: string | null;
  readonly contentDigest: string | null;
  readonly contentType: string | null;
  readonly errorCode: CrawlErrorCode | null;
  readonly finalUrl: string | null;
  readonly hostname: string;
  readonly origin: string;
  readonly requestedUrl: string;
  readonly state: "parsed" | "unavailable" | "unreachable";
  readonly statusCode: number | null;
  readonly userAgent: string;
}

export interface RobotsService {
  fetchPolicy(originUrl: string, scope: CrawlScope, signal?: AbortSignal): Promise<RobotsPolicy>;
}

export interface RobotsServiceOptions {
  readonly clock?: CrawlClock;
  readonly maxRetries?: number;
  readonly random?: () => number;
}

function wildcardMatch(pattern: string, candidate: string): boolean {
  const anchored = pattern.endsWith("$");
  const value = anchored ? pattern.slice(0, -1) : `${pattern}*`;
  const compact = value.replace(/\*+/gu, "*");
  let patternIndex = 0;
  let candidateIndex = 0;
  let starIndex = -1;
  let starCandidateIndex = -1;

  while (candidateIndex < candidate.length) {
    if (
      patternIndex < compact.length &&
      compact[patternIndex] !== "*" &&
      compact[patternIndex] === candidate[candidateIndex]
    ) {
      patternIndex += 1;
      candidateIndex += 1;
      continue;
    }
    if (compact[patternIndex] === "*") {
      starIndex = patternIndex;
      starCandidateIndex = candidateIndex;
      patternIndex += 1;
      continue;
    }
    if (starIndex >= 0) {
      patternIndex = starIndex + 1;
      starCandidateIndex += 1;
      candidateIndex = starCandidateIndex;
      continue;
    }
    return false;
  }
  while (compact[patternIndex] === "*") patternIndex += 1;
  return patternIndex === compact.length;
}

function matchingSpecificity(agent: string, productToken: string): number {
  const normalizedAgent = agent.trim().toLowerCase();
  const normalizedProduct = productToken.trim().toLowerCase();
  if (normalizedAgent === "*") return 0;
  return normalizedProduct === normalizedAgent ? normalizedAgent.length : -1;
}

function freezeParsedRobots(
  rules: readonly RobotsRule[],
  crawlDelayMs: number | null,
  sitemapUrls: readonly string[],
): ParsedRobots {
  const frozenRules = Object.freeze([...rules]);
  const frozenSitemaps = Object.freeze([...sitemapUrls]);
  return Object.freeze({
    crawlDelayMs,
    sitemapUrls: frozenSitemaps,
    allows(url: string | URL): boolean {
      const parsed = typeof url === "string" ? new URL(url) : url;
      const candidate = canonicalizeRobotsPath(`${parsed.pathname}${parsed.search}`, "candidate");
      let selected: RobotsRule | undefined;
      for (const rule of frozenRules) {
        if (!wildcardMatch(rule.pattern, candidate)) continue;
        if (
          selected === undefined ||
          rule.precedence > selected.precedence ||
          (rule.precedence === selected.precedence && rule.directive === "allow")
        ) {
          selected = rule;
        }
      }
      return selected?.directive !== "disallow";
    },
  });
}

export function allowAllRobots(): ParsedRobots {
  return freezeParsedRobots([], null, []);
}

export function disallowAllRobots(): ParsedRobots {
  return freezeParsedRobots([{ directive: "disallow", pattern: "/", precedence: 1 }], null, []);
}

export function parseRobotsTxt(input: string, productToken: string): ParsedRobots {
  const text = input.replace(/^\uFEFF/u, "");
  const groups: RobotsGroup[] = [];
  const sitemaps = new Set<string>();
  let current: RobotsGroup | undefined;
  let parsedRuleCount = 0;
  let ruleLimitExceeded = false;

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.slice(0, MAX_ROBOTS_LINE_LENGTH);
    const commentIndex = line.indexOf("#");
    const withoutComment = (commentIndex < 0 ? line : line.slice(0, commentIndex)).trim();
    if (withoutComment === "") continue;
    const colon = withoutComment.indexOf(":");
    if (colon <= 0) continue;
    const key = withoutComment.slice(0, colon).trim().toLowerCase();
    const value = withoutComment.slice(colon + 1).trim();

    if (key === "sitemap") {
      if (value !== "") sitemaps.add(value);
      continue;
    }
    if (key === "user-agent") {
      if (value === "") continue;
      if (current === undefined || current.rules.length > 0 || current.crawlDelayMs !== null) {
        current = { agents: [], crawlDelayMs: null, rules: [] };
        groups.push(current);
      }
      current.agents.push(value);
      continue;
    }
    if (current === undefined || current.agents.length === 0) continue;

    if (key === "allow" || key === "disallow") {
      if (key === "disallow" && value === "") continue;
      if (value === "") continue;
      if (parsedRuleCount >= MAX_ROBOTS_RULES) {
        ruleLimitExceeded = true;
        continue;
      }
      const pattern = canonicalizeRobotsPath(value, "rule");
      current.rules.push({
        directive: key,
        pattern,
        precedence: robotsRulePrecedence(pattern),
      });
      parsedRuleCount += 1;
      continue;
    }
    if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        current.crawlDelayMs = Math.min(Math.ceil(seconds * 1_000), MAX_CRAWL_DELAY_MS);
      }
    }
  }

  if (ruleLimitExceeded) {
    return freezeParsedRobots([{ directive: "disallow", pattern: "/", precedence: 1 }], null, [
      ...sitemaps,
    ]);
  }

  let bestSpecificity = -1;
  const selectedGroups: RobotsGroup[] = [];
  for (const group of groups) {
    const specificity = Math.max(
      ...group.agents.map((agent) => matchingSpecificity(agent, productToken)),
    );
    if (specificity < 0) continue;
    if (specificity > bestSpecificity) {
      selectedGroups.length = 0;
      bestSpecificity = specificity;
    }
    if (specificity === bestSpecificity) selectedGroups.push(group);
  }

  const selectedRules = selectedGroups.flatMap((group) => group.rules);
  const delays = selectedGroups.flatMap((group) =>
    group.crawlDelayMs === null ? [] : [group.crawlDelayMs],
  );
  return freezeParsedRobots(selectedRules, delays.length === 0 ? null : Math.max(...delays), [
    ...sitemaps,
  ]);
}

function policyFromParsed(
  parsed: ParsedRobots,
  metadata: Omit<RobotsPolicy, "allows" | "crawlDelayMs" | "sitemapUrls">,
): RobotsPolicy {
  return Object.freeze({
    ...metadata,
    allows: parsed.allows,
    crawlDelayMs: parsed.crawlDelayMs,
    sitemapUrls: parsed.sitemapUrls,
  });
}

export function createRobotsService(
  client: SafeHttpClient,
  productToken = "SearviaBot",
  userAgent = SEARVIA_CRAWLER_USER_AGENT,
  options: RobotsServiceOptions = {},
): RobotsService {
  const maxRetries = options.maxRetries ?? 0;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new TypeError("Robots maxRetries must be between 0 and 5.");
  }
  const clock = options.clock ?? systemCrawlClock;
  const random = options.random ?? Math.random;

  const fetchWithRetries = async (
    requestedUrl: string,
    scope: CrawlScope,
    signal?: AbortSignal,
  ): Promise<SafeFetchResponse> => {
    let attempt = 0;
    for (;;) {
      try {
        const response = await client.fetch({
          kind: "robots",
          scope,
          ...(signal === undefined ? {} : { signal }),
          url: requestedUrl,
        });
        if (!isRetryableHttpStatus(response.statusCode) || attempt >= maxRetries) return response;
        const baseDelay = Math.min(250 * 2 ** attempt, 5_000);
        const jitter = Math.floor(baseDelay * 0.2 * Math.max(0, Math.min(1, random())));
        await clock.sleep(response.retryAfterMs ?? baseDelay + jitter, signal);
        attempt += 1;
      } catch (error) {
        if (isCrawlError(error) && error.code === "cancelled") throw error;
        if (!isCrawlError(error) || !error.transient || attempt >= maxRetries) throw error;
        const baseDelay = Math.min(250 * 2 ** attempt, 5_000);
        const jitter = Math.floor(baseDelay * 0.2 * Math.max(0, Math.min(1, random())));
        await clock.sleep(baseDelay + jitter, signal);
        attempt += 1;
      }
    }
  };

  return Object.freeze({
    async fetchPolicy(
      originUrl: string,
      scope: CrawlScope,
      signal?: AbortSignal,
    ): Promise<RobotsPolicy> {
      const origin = new URL(normalizeCrawlUrl(originUrl));
      origin.pathname = "/robots.txt";
      origin.search = "";
      origin.hash = "";
      const requestedUrl = origin.toString();
      const policyIdentity = {
        hostname: origin.hostname.replace(/^\[|\]$/gu, ""),
        origin: origin.origin,
        userAgent,
      } as const;

      try {
        const response = await fetchWithRetries(requestedUrl, scope, signal);
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (response.body === null) {
            return policyFromParsed(disallowAllRobots(), {
              contentBytes: 0,
              content: null,
              contentDigest: null,
              contentType: response.contentType,
              errorCode: "unsupported_content_type",
              finalUrl: response.finalUrl,
              requestedUrl,
              ...policyIdentity,
              state: "unreachable",
              statusCode: response.statusCode,
            });
          }
          if (response.body.byteLength > MAX_PERSISTED_ROBOTS_BYTES) {
            return policyFromParsed(disallowAllRobots(), {
              contentBytes: response.body.byteLength,
              content: null,
              contentDigest: createHash("sha256").update(response.body).digest("hex"),
              contentType: response.contentType,
              errorCode: "response_too_large",
              finalUrl: response.finalUrl,
              requestedUrl,
              ...policyIdentity,
              state: "unreachable",
              statusCode: response.statusCode,
            });
          }
          let content: string;
          try {
            content = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
          } catch {
            return policyFromParsed(disallowAllRobots(), {
              contentBytes: response.body.byteLength,
              content: null,
              contentDigest: createHash("sha256").update(response.body).digest("hex"),
              contentType: response.contentType,
              errorCode: "parse_error",
              finalUrl: response.finalUrl,
              requestedUrl,
              ...policyIdentity,
              state: "unreachable",
              statusCode: response.statusCode,
            });
          }
          if (content.includes("\0")) {
            return policyFromParsed(disallowAllRobots(), {
              contentBytes: response.body.byteLength,
              content: null,
              contentDigest: createHash("sha256").update(response.body).digest("hex"),
              contentType: response.contentType,
              errorCode: "parse_error",
              finalUrl: response.finalUrl,
              requestedUrl,
              ...policyIdentity,
              state: "unreachable",
              statusCode: response.statusCode,
            });
          }
          const parsed = parseRobotsTxt(content, productToken);
          return policyFromParsed(parsed, {
            contentBytes: response.body.byteLength,
            content,
            contentDigest: createHash("sha256").update(response.body).digest("hex"),
            contentType: response.contentType,
            errorCode: null,
            finalUrl: response.finalUrl,
            requestedUrl,
            ...policyIdentity,
            state: "parsed",
            statusCode: response.statusCode,
          });
        }
        if (
          response.statusCode >= 400 &&
          response.statusCode < 500 &&
          !isRetryableHttpStatus(response.statusCode)
        ) {
          return policyFromParsed(allowAllRobots(), {
            contentBytes: response.responseBytes,
            content: null,
            contentDigest:
              response.body === null
                ? null
                : createHash("sha256").update(response.body).digest("hex"),
            contentType: response.contentType,
            errorCode: null,
            finalUrl: response.finalUrl,
            requestedUrl,
            ...policyIdentity,
            state: "unavailable",
            statusCode: response.statusCode,
          });
        }
        return policyFromParsed(disallowAllRobots(), {
          contentBytes: response.responseBytes,
          content: null,
          contentDigest:
            response.body === null
              ? null
              : createHash("sha256").update(response.body).digest("hex"),
          contentType: response.contentType,
          errorCode: "robots_unreachable",
          finalUrl: response.finalUrl,
          requestedUrl,
          ...policyIdentity,
          state: "unreachable",
          statusCode: response.statusCode,
        });
      } catch (error) {
        if (isCrawlError(error) && error.code === "cancelled") throw error;
        const code = isCrawlError(error) ? error.code : "robots_unreachable";
        return policyFromParsed(disallowAllRobots(), {
          contentBytes: 0,
          content: null,
          contentDigest: null,
          contentType: null,
          errorCode: code,
          finalUrl: null,
          requestedUrl,
          ...policyIdentity,
          state: "unreachable",
          statusCode: null,
        });
      }
    },
  });
}

export function assertRobotsAllowed(policy: ParsedRobots, url: string): void {
  if (!policy.allows(url)) {
    throw new CrawlError("robots_disallowed", "The URL is disallowed by robots.txt.");
  }
}
