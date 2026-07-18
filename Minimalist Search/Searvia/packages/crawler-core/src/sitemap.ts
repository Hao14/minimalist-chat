import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { DOMParser, type Node } from "@xmldom/xmldom";

import type { RedirectHop } from "./types.js";
import { hashNormalizedUrl, normalizeCrawlUrl } from "./url.js";

export type SitemapDiscoverySource = "default" | "index" | "robots" | "submitted";
export type SitemapDocumentKind = "sitemap_index" | "url_set" | "unknown";

export interface SitemapParseLimits {
  readonly maxCompressedBytes: number;
  readonly maxDecompressedBytes: number;
  readonly maxEntries: number;
}

export interface SitemapTraversalLimits {
  readonly maxDepth: number;
  readonly maxFiles: number;
}

export interface SitemapDocumentInput {
  readonly body: string | Uint8Array;
  readonly contentEncoding?: string | null;
  readonly contentType: string | null;
  readonly depth: number;
  readonly discoverySource: SitemapDiscoverySource;
  readonly finalUrl: string;
  readonly redirectChain: readonly RedirectHop[];
  readonly requestedUrl: string;
  readonly statusCode: number;
  readonly transferBytes?: number;
}

export interface SitemapParseIssue {
  readonly code:
    | "entry_limit"
    | "forbidden_declaration"
    | "gzip_error"
    | "invalid_lastmod"
    | "invalid_root"
    | "invalid_url"
    | "structural_limit"
    | "xml_error";
  readonly entryIndex: number | null;
  readonly message: string;
}

export interface SitemapLocationExtraction {
  readonly lastModified: string | null;
  readonly lastModifiedValid: boolean;
  readonly normalizedUrl: string | null;
  readonly rawUrl: string;
  readonly urlHash: string | null;
}

export interface SitemapDocumentExtraction {
  readonly compressedBytes: number;
  readonly compression: "gzip" | "identity";
  readonly contentDigest: string;
  readonly contentType: string | null;
  readonly decodedBytes: number;
  readonly depth: number;
  readonly discoverySource: SitemapDiscoverySource;
  readonly finalUrl: string;
  readonly issues: readonly SitemapParseIssue[];
  readonly kind: SitemapDocumentKind;
  readonly locations: readonly SitemapLocationExtraction[];
  readonly redirectChain: readonly RedirectHop[];
  readonly requestedUrl: string;
  readonly state: "invalid" | "parsed" | "unavailable";
  readonly statusCode: number;
}

export interface SitemapTraversalCandidate {
  readonly depth: number;
  readonly discoverySource: SitemapDiscoverySource;
  readonly parentSitemapUrl: string | null;
  readonly requestedUrl: string;
}

export type SitemapTraversalAddResult =
  | Readonly<{
      accepted: true;
      candidate: SitemapTraversalCandidate & {
        readonly normalizedUrl: string;
        readonly sequence: number;
        readonly urlHash: string;
      };
    }>
  | Readonly<{ accepted: false; reason: "depth" | "duplicate" | "file_limit" | "invalid_url" }>;

export const DEFAULT_SITEMAP_PARSE_LIMITS: Readonly<SitemapParseLimits> = Object.freeze({
  maxCompressedBytes: 2 * 1_024 * 1_024,
  maxDecompressedBytes: 10 * 1_024 * 1_024,
  maxEntries: 50_000,
});

function validateParseLimits(overrides: Partial<SitemapParseLimits>): Readonly<SitemapParseLimits> {
  const limits = Object.freeze({ ...DEFAULT_SITEMAP_PARSE_LIMITS, ...overrides });
  if (
    !Number.isInteger(limits.maxCompressedBytes) ||
    limits.maxCompressedBytes < 1_024 ||
    limits.maxCompressedBytes > 10 * 1_024 * 1_024
  ) {
    throw new TypeError("maxCompressedBytes must be between 1024 and 10485760.");
  }
  if (
    !Number.isInteger(limits.maxDecompressedBytes) ||
    limits.maxDecompressedBytes < limits.maxCompressedBytes ||
    limits.maxDecompressedBytes > 50 * 1_024 * 1_024
  ) {
    throw new TypeError("maxDecompressedBytes must be bounded and at least maxCompressedBytes.");
  }
  if (!Number.isInteger(limits.maxEntries) || limits.maxEntries < 1 || limits.maxEntries > 50_000) {
    throw new TypeError("maxEntries must be between 1 and 50000.");
  }
  return limits;
}

function inputBytes(body: string | Uint8Array): Uint8Array {
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}

function hasGzipMagic(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function decompress(
  body: string | Uint8Array,
  contentEncoding: string | null | undefined,
  transferBytes: number | undefined,
  limits: SitemapParseLimits,
): Readonly<{
  compressedBytes: number;
  compression: "gzip" | "identity";
  decoded: Uint8Array;
}> {
  const bytes = inputBytes(body);
  if (transferBytes !== undefined && (!Number.isSafeInteger(transferBytes) || transferBytes < 0)) {
    throw new TypeError("Sitemap transferBytes must be a nonnegative safe integer.");
  }
  if (transferBytes !== undefined && transferBytes > limits.maxCompressedBytes) {
    throw new TypeError("The sitemap exceeds the configured transfer byte limit.");
  }
  if (hasGzipMagic(bytes)) {
    if (bytes.byteLength > limits.maxCompressedBytes) {
      throw new TypeError("The compressed sitemap exceeds the configured transfer byte limit.");
    }
    try {
      const decoded = gunzipSync(bytes, { maxOutputLength: limits.maxDecompressedBytes });
      return Object.freeze({
        compressedBytes: transferBytes ?? bytes.byteLength,
        compression: "gzip",
        decoded: new Uint8Array(decoded),
      });
    } catch (error) {
      throw new SitemapGzipError(error);
    }
  }

  const declaredGzip = contentEncoding?.trim().toLowerCase().includes("gzip") === true;
  if (bytes.byteLength > limits.maxDecompressedBytes) {
    throw new TypeError("The sitemap exceeds the configured decoded byte limit.");
  }
  if (declaredGzip) {
    return Object.freeze({
      compressedBytes: transferBytes ?? bytes.byteLength,
      compression: "gzip",
      decoded: bytes,
    });
  }
  if (bytes.byteLength > limits.maxCompressedBytes) {
    throw new TypeError("The sitemap exceeds the configured transfer byte limit.");
  }
  return Object.freeze({
    compressedBytes: bytes.byteLength,
    compression: "identity",
    decoded: bytes,
  });
}

class SitemapGzipError extends Error {
  constructor(cause: unknown) {
    super("The gzip-compressed sitemap could not be decoded.", { cause });
    this.name = "SitemapGzipError";
  }
}

function decodeXml(bytes: Uint8Array): string {
  let encoding = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  else {
    const declaration = Buffer.from(bytes.subarray(0, 256)).toString("latin1");
    const declared = /<\?xml\b[^>]*\bencoding\s*=\s*["']([^"']+)["']/iu.exec(declaration)?.[1];
    if (declared !== undefined) encoding = declared.trim();
  }
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

const W3C_LAST_MODIFIED =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2})))?$/u;

function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return leapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validLastModified(value: string): boolean {
  const match = W3C_LAST_MODIFIED.exec(value);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return false;
  }

  const hourValue = match[4];
  if (hourValue === undefined) return true;
  const minuteValue = match[5];
  const zone = match[7];
  if (minuteValue === undefined || zone === undefined) return false;

  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (zone === "Z") return true;

  const offsetHour = Number(match[8]);
  const offsetMinute = Number(match[9]);
  return offsetHour <= 14 && offsetMinute <= 59 && (offsetHour !== 14 || offsetMinute === 0);
}

function parseLocation(
  rawUrl: string,
  lastModified: string | null,
  baseUrl: string,
  entryIndex: number,
  issues: SitemapParseIssue[],
): SitemapLocationExtraction {
  const trimmed = rawUrl.trim();
  let normalizedUrl: string | null = null;
  try {
    normalizedUrl = normalizeCrawlUrl(trimmed, { baseUrl });
  } catch {
    issues.push(
      Object.freeze({
        code: "invalid_url",
        entryIndex,
        message: "The sitemap entry URL is malformed or unsupported.",
      }),
    );
  }
  const normalizedLastModified = lastModified?.trim() || null;
  const lastModifiedValid =
    normalizedLastModified === null ? true : validLastModified(normalizedLastModified);
  if (!lastModifiedValid) {
    issues.push(
      Object.freeze({
        code: "invalid_lastmod",
        entryIndex,
        message: "The sitemap lastmod value is not a valid W3C date or date-time.",
      }),
    );
  }
  return Object.freeze({
    lastModified: normalizedLastModified,
    lastModifiedValid,
    normalizedUrl,
    rawUrl: trimmed,
    urlHash: normalizedUrl === null ? null : hashNormalizedUrl(normalizedUrl),
  });
}

function localName(node: Node): string {
  return (node.localName ?? node.nodeName.split(":").at(-1) ?? "").toLowerCase();
}

function childElements(node: Node): readonly Node[] {
  const elements: Node[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType === 1) elements.push(child);
  }
  return elements;
}

function childText(node: Node, name: string): string | null {
  const match = childElements(node).find((child) => localName(child) === name);
  return match?.textContent ?? null;
}

function parseXmlLocations(
  xml: string,
  baseUrl: string,
  limits: SitemapParseLimits,
): Readonly<{
  issues: readonly SitemapParseIssue[];
  kind: SitemapDocumentKind;
  locations: readonly SitemapLocationExtraction[];
}> {
  const issues: SitemapParseIssue[] = [];
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    return Object.freeze({
      issues: Object.freeze([
        Object.freeze({
          code: "forbidden_declaration" as const,
          entryIndex: null,
          message: "Sitemaps containing DTD or entity declarations are rejected.",
        }),
      ]),
      kind: "unknown",
      locations: Object.freeze([]),
    });
  }

  const maximumElements = Math.min(300_000, Math.max(128, limits.maxEntries * 6 + 32));
  let elementCount = 0;
  let entryCount = 0;
  for (const match of xml.matchAll(/<(?![!?/])([^<>\s/]+)(?:\s|\/?>)/gu)) {
    elementCount += 1;
    const name = match[1]?.split(":").at(-1)?.toLowerCase();
    if (name === "url" || name === "sitemap") entryCount += 1;
    if (entryCount > limits.maxEntries) {
      return Object.freeze({
        issues: Object.freeze([
          Object.freeze({
            code: "entry_limit" as const,
            entryIndex: limits.maxEntries,
            message: "The sitemap entry limit was exceeded before XML parsing.",
          }),
        ]),
        kind: "unknown",
        locations: Object.freeze([]),
      });
    }
    if (elementCount > maximumElements) {
      return Object.freeze({
        issues: Object.freeze([
          Object.freeze({
            code: "structural_limit" as const,
            entryIndex: null,
            message: "The sitemap exceeds the configured pre-parse structural limit.",
          }),
        ]),
        kind: "unknown",
        locations: Object.freeze([]),
      });
    }
  }

  const locations: SitemapLocationExtraction[] = [];
  let document: ReturnType<DOMParser["parseFromString"]> | null = null;
  try {
    document = new DOMParser({
      locator: false,
      onError(level, message) {
        if (issues.some((issue) => issue.code === "xml_error")) return;
        issues.push(
          Object.freeze({
            code: "xml_error",
            entryIndex: null,
            message: `${level}: ${message}`.slice(0, 512),
          }),
        );
      },
    }).parseFromString(xml, "application/xml");
  } catch (error) {
    if (!issues.some((issue) => issue.code === "xml_error")) {
      issues.push(
        Object.freeze({
          code: "xml_error",
          entryIndex: null,
          message: error instanceof Error ? error.message.slice(0, 512) : "Invalid XML.",
        }),
      );
    }
  }

  const root = document?.documentElement ?? null;
  const rootName = root === null ? null : localName(root);
  const kind: SitemapDocumentKind =
    rootName === "urlset" ? "url_set" : rootName === "sitemapindex" ? "sitemap_index" : "unknown";
  if (kind === "unknown") {
    issues.push(
      Object.freeze({
        code: "invalid_root",
        entryIndex: null,
        message: "The XML root is not urlset or sitemapindex.",
      }),
    );
  } else if (root !== null) {
    const expectedEntry = kind === "url_set" ? "url" : "sitemap";
    const entries = childElements(root).filter((child) => localName(child) === expectedEntry);
    for (const [index, entry] of entries.entries()) {
      if (locations.length >= limits.maxEntries) {
        issues.push(
          Object.freeze({
            code: "entry_limit",
            entryIndex: locations.length,
            message: "The sitemap entry limit was reached.",
          }),
        );
        break;
      }
      locations.push(
        parseLocation(
          childText(entry, "loc") ?? "",
          childText(entry, "lastmod"),
          baseUrl,
          index,
          issues,
        ),
      );
    }
  }
  return Object.freeze({
    issues: Object.freeze(issues),
    kind,
    locations: Object.freeze(locations),
  });
}

function unavailableResult(
  input: SitemapDocumentInput,
  contentDigest: string,
  compressedBytes: number,
): SitemapDocumentExtraction {
  return Object.freeze({
    compressedBytes: input.transferBytes ?? compressedBytes,
    compression:
      input.contentEncoding?.toLowerCase().includes("gzip") === true ? "gzip" : "identity",
    contentDigest,
    contentType: input.contentType,
    decodedBytes: 0,
    depth: input.depth,
    discoverySource: input.discoverySource,
    finalUrl: input.finalUrl,
    issues: Object.freeze([]),
    kind: "unknown",
    locations: Object.freeze([]),
    redirectChain: Object.freeze(input.redirectChain.map((hop) => Object.freeze({ ...hop }))),
    requestedUrl: input.requestedUrl,
    state: "unavailable",
    statusCode: input.statusCode,
  });
}

export function parseSitemapDocument(
  input: SitemapDocumentInput,
  limitOverrides: Partial<SitemapParseLimits> = {},
): SitemapDocumentExtraction {
  if (!Number.isInteger(input.depth) || input.depth < 0 || input.depth > 20) {
    throw new TypeError("Sitemap depth must be between 0 and 20.");
  }
  if (!Number.isInteger(input.statusCode) || input.statusCode < 100 || input.statusCode > 599) {
    throw new TypeError("Sitemap statusCode must be between 100 and 599.");
  }
  if (
    input.transferBytes !== undefined &&
    (!Number.isSafeInteger(input.transferBytes) || input.transferBytes < 0)
  ) {
    throw new TypeError("Sitemap transferBytes must be a nonnegative safe integer.");
  }
  normalizeCrawlUrl(input.requestedUrl);
  normalizeCrawlUrl(input.finalUrl);
  const limits = validateParseLimits(limitOverrides);
  const original = inputBytes(input.body);
  const digest = createHash("sha256").update(original).digest("hex");
  if (input.statusCode < 200 || input.statusCode >= 300) {
    return unavailableResult(input, digest, original.byteLength);
  }

  let expanded: ReturnType<typeof decompress>;
  try {
    expanded = decompress(input.body, input.contentEncoding, input.transferBytes, limits);
  } catch (error) {
    if (!(error instanceof SitemapGzipError)) throw error;
    return Object.freeze({
      ...unavailableResult(input, digest, original.byteLength),
      compression: "gzip" as const,
      issues: Object.freeze([
        Object.freeze({
          code: "gzip_error" as const,
          entryIndex: null,
          message: error.message,
        }),
      ]),
      state: "invalid" as const,
    });
  }
  const parsed = parseXmlLocations(decodeXml(expanded.decoded), input.finalUrl, limits);
  const invalid =
    parsed.kind === "unknown" ||
    parsed.issues.some(
      (issue) =>
        issue.code === "xml_error" ||
        issue.code === "forbidden_declaration" ||
        issue.code === "structural_limit" ||
        issue.code === "entry_limit",
    );
  return Object.freeze({
    compressedBytes: expanded.compressedBytes,
    compression: expanded.compression,
    contentDigest: digest,
    contentType: input.contentType,
    decodedBytes: expanded.decoded.byteLength,
    depth: input.depth,
    discoverySource: input.discoverySource,
    finalUrl: input.finalUrl,
    issues: parsed.issues,
    kind: parsed.kind,
    locations: parsed.locations,
    redirectChain: Object.freeze(input.redirectChain.map((hop) => Object.freeze({ ...hop }))),
    requestedUrl: input.requestedUrl,
    state: invalid ? "invalid" : "parsed",
    statusCode: input.statusCode,
  });
}

export class SitemapTraversal {
  readonly #limits: Readonly<SitemapTraversalLimits>;
  readonly #queued: Array<
    SitemapTraversalCandidate & {
      readonly normalizedUrl: string;
      readonly sequence: number;
      readonly urlHash: string;
    }
  > = [];
  readonly #seen = new Set<string>();
  #sequence = 0;

  constructor(limits: SitemapTraversalLimits) {
    if (!Number.isInteger(limits.maxDepth) || limits.maxDepth < 0 || limits.maxDepth > 10) {
      throw new TypeError("Sitemap maxDepth must be between 0 and 10.");
    }
    if (!Number.isInteger(limits.maxFiles) || limits.maxFiles < 1 || limits.maxFiles > 100) {
      throw new TypeError("Sitemap maxFiles must be between 1 and 100.");
    }
    this.#limits = Object.freeze({ ...limits });
  }

  get discoveredCount(): number {
    return this.#seen.size;
  }

  add(candidate: SitemapTraversalCandidate): SitemapTraversalAddResult {
    if (candidate.depth < 0 || candidate.depth > this.#limits.maxDepth) {
      return Object.freeze({ accepted: false, reason: "depth" });
    }
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeCrawlUrl(candidate.requestedUrl);
    } catch {
      return Object.freeze({ accepted: false, reason: "invalid_url" });
    }
    if (this.#seen.has(normalizedUrl)) {
      return Object.freeze({ accepted: false, reason: "duplicate" });
    }
    if (this.#seen.size >= this.#limits.maxFiles) {
      return Object.freeze({ accepted: false, reason: "file_limit" });
    }
    const accepted = Object.freeze({
      ...candidate,
      normalizedUrl,
      sequence: this.#sequence,
      urlHash: hashNormalizedUrl(normalizedUrl),
    });
    this.#sequence += 1;
    this.#seen.add(normalizedUrl);
    this.#queued.push(accepted);
    return Object.freeze({ accepted: true, candidate: accepted });
  }

  addIndex(document: SitemapDocumentExtraction): readonly SitemapTraversalAddResult[] {
    if (document.kind !== "sitemap_index" || document.state !== "parsed") return [];
    return Object.freeze(
      document.locations.map((location) =>
        this.add({
          depth: document.depth + 1,
          discoverySource: "index",
          parentSitemapUrl: document.finalUrl,
          requestedUrl: location.normalizedUrl ?? location.rawUrl,
        }),
      ),
    );
  }

  next():
    | (SitemapTraversalCandidate & {
        readonly normalizedUrl: string;
        readonly sequence: number;
        readonly urlHash: string;
      })
    | null {
    return this.#queued.shift() ?? null;
  }
}
