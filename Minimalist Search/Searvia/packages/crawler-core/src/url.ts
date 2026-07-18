import { createHash } from "node:crypto";
import { domainToASCII, domainToUnicode } from "node:url";

import { CrawlError } from "./errors.js";
import type { CrawlScope, QueryParameterPolicy } from "./types.js";

// Durable crawl URL columns are intentionally bounded to 4,096 characters.
// Reject longer values before they can turn a hostile link into a persistence
// error and retry loop.
const MAX_URL_LENGTH = 4_096;
const PERCENT_ESCAPE = /%[\da-f]{2}/giu;
const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|ref_src)$/iu;

export const SAFE_WEB_PORTS = Object.freeze(new Set([80, 443, 8080, 8443]));

function hasControlWhitespaceOrBackslash(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x20 || codePoint === 0x7f || character === "\\";
  });
}

function canonicalizePercentEncoding(value: string): string {
  return value.replace(PERCENT_ESCAPE, (escape) => {
    const byte = Number.parseInt(escape.slice(1), 16);
    const character = String.fromCharCode(byte);
    return /^[a-z\d\-._~]$/iu.test(character) ? character : `%${escape.slice(1).toUpperCase()}`;
  });
}

function normalizeHostname(parsed: URL): string {
  const rawHostname = parsed.hostname
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase();
  if (rawHostname.length === 0 || rawHostname.length > 253 || rawHostname.includes("%")) {
    throw new CrawlError("invalid_hostname", "The crawl URL has an invalid hostname.");
  }

  if (rawHostname.includes(":")) return rawHostname;

  const ascii = domainToASCII(rawHostname).toLowerCase();
  if (ascii.length === 0 || ascii.length > 253 || domainToUnicode(ascii).length === 0) {
    throw new CrawlError("invalid_hostname", "The crawl URL has an invalid hostname.");
  }

  const labels = ascii.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 || label.length > 63 || !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/u.test(label),
    )
  ) {
    throw new CrawlError("invalid_hostname", "The crawl URL has an invalid hostname.");
  }

  return ascii;
}

function normalizeQuery(parsed: URL, policy: QueryParameterPolicy): string {
  if (policy === "ignore_all") return "";
  if (policy === "keep") return canonicalizePercentEncoding(parsed.search);

  const kept = new URLSearchParams();
  for (const [name, value] of parsed.searchParams) {
    if (!TRACKING_PARAMETER.test(name)) kept.append(name, value);
  }
  const query = kept.toString();
  return query === "" ? "" : `?${canonicalizePercentEncoding(query)}`;
}

export interface NormalizeCrawlUrlOptions {
  readonly baseUrl?: string;
  readonly queryPolicy?: QueryParameterPolicy;
}

export function normalizeCrawlUrl(input: string, options: NormalizeCrawlUrlOptions = {}): string {
  const trimmed = input.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_URL_LENGTH ||
    hasControlWhitespaceOrBackslash(trimmed)
  ) {
    throw new CrawlError("invalid_url", "The crawl URL is malformed or too long.");
  }

  let parsed: URL;
  try {
    parsed = options.baseUrl === undefined ? new URL(trimmed) : new URL(trimmed, options.baseUrl);
  } catch (error) {
    throw new CrawlError("invalid_url", "The crawl URL is malformed.", { cause: error });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CrawlError("unsupported_protocol", "Crawl URLs must use HTTP or HTTPS.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new CrawlError("userinfo_not_allowed", "Crawl URLs cannot contain credentials.");
  }

  const hostname = normalizeHostname(parsed);
  const port = parsed.port === "" ? "" : `:${Number.parseInt(parsed.port, 10)}`;
  const pathname = canonicalizePercentEncoding(parsed.pathname === "" ? "/" : parsed.pathname);
  const search = normalizeQuery(parsed, options.queryPolicy ?? "keep");
  return `${parsed.protocol}//${hostname.includes(":") ? `[${hostname}]` : hostname}${port}${pathname}${search}`;
}

export function effectivePort(url: URL): number {
  if (url.port !== "") return Number.parseInt(url.port, 10);
  return url.protocol === "https:" ? 443 : 80;
}

export function assertSafeWebPort(url: URL): void {
  const port = effectivePort(url);
  if (!SAFE_WEB_PORTS.has(port)) {
    throw new CrawlError("unsafe_port", "The crawl URL uses a port that is not permitted.");
  }
}

export function isUrlInScope(url: string | URL, scope: CrawlScope): boolean {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const candidate = parsed.hostname
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase();
  const root = scope.hostname
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase();
  return candidate === root || (scope.includeSubdomains && candidate.endsWith(`.${root}`));
}

export function assertUrlInScope(url: string | URL, scope: CrawlScope): void {
  if (!isUrlInScope(url, scope)) {
    throw new CrawlError("out_of_scope", "The crawl URL is outside the configured project scope.");
  }
}

export function hashNormalizedUrl(normalizedUrl: string): string {
  return createHash("sha256").update(normalizedUrl).digest("hex");
}

export function urlVariantKey(normalizedUrl: string): string {
  const url = new URL(normalizedUrl);
  return `${url.origin}${url.pathname}`;
}
