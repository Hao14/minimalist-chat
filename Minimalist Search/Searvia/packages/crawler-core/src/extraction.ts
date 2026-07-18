import { createHash } from "node:crypto";

import { parse, serialize, type DefaultTreeAdapterTypes, type ParserError } from "parse5";

import { isUrlInScope, normalizeCrawlUrl } from "./url.js";
import type {
  ExtractedResponseHeader,
  FormExtraction,
  HeadingExtraction,
  HtmlDocumentExtraction,
  HtmlDocumentInput,
  HtmlEncodingExtraction,
  HtmlParseIssue,
  HtmlSniffResult,
  HreflangReference,
  IframeExtraction,
  ImageExtraction,
  ImageSourceCandidate,
  JsonLdExtraction,
  JsonValue,
  LinkExtraction,
  MetadataProperty,
  MicrodataItemExtraction,
  MicrodataProperty,
  PageExtractionInput,
  PageExtractionLimits,
  PageExtractionResult,
  RenderingDecision,
  ResolvedUrlReference,
  ResponseHeaderInput,
  ResponseMetadataExtraction,
  RobotsDirectiveExtraction,
  RobotsDirectiveSource,
  ScriptExtraction,
  StylesheetExtraction,
} from "./extraction-types.js";

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;
type HtmlParentNode = DefaultTreeAdapterTypes.ParentNode;

export const DEFAULT_PAGE_EXTRACTION_LIMITS: Readonly<PageExtractionLimits> = Object.freeze({
  maxDocumentBytes: 2 * 1_024 * 1_024,
  maxExtractedItems: 10_000,
  maxJsonLdCharacters: 512 * 1_024,
  maxNodes: 100_000,
  maxTextCharacters: 2 * 1_024 * 1_024,
});

const CACHE_HEADER_NAMES = new Set([
  "age",
  "cache-control",
  "etag",
  "expires",
  "last-modified",
  "pragma",
  "surrogate-control",
  "vary",
]);
const SECURITY_HEADER_NAMES = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "origin-agent-cluster",
  "permissions-policy",
  "referrer-policy",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "x-permitted-cross-domain-policies",
]);
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
  "www-authenticate",
]);
const HIDDEN_TEXT_ELEMENTS = new Set([
  "canvas",
  "head",
  "noscript",
  "script",
  "style",
  "svg",
  "template",
]);
const ROBOTS_CONFLICTS: readonly [string, string][] = [
  ["index", "noindex"],
  ["follow", "nofollow"],
  ["archive", "noarchive"],
  ["snippet", "nosnippet"],
];
const ROBOTS_VALUE_DIRECTIVES = new Set([
  "max-image-preview",
  "max-snippet",
  "max-video-preview",
  "unavailable_after",
]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~\dA-Za-z-]+$/u;
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const HTML_SNIFF_BYTES = 4_096;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[\s\u00A0]+/gu, " ").trim();
}

/**
 * Conservatively recognizes an HTML document from a bounded prefix of the actual
 * response body. Ambiguous markup is reported as non-HTML so consumers can keep
 * HTML-only rules ineligible instead of manufacturing a passing observation.
 */
export function sniffHtmlDocument(body: string | Uint8Array): HtmlSniffResult {
  const encoded = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  const prefix = encoded.subarray(0, HTML_SNIFF_BYTES);
  let text = new TextDecoder("utf-8", { fatal: false }).decode(prefix);
  text = text.replace(/^\uFEFF/u, "").trimStart();

  // Leading HTML comments are common before the doctype. Only remove complete
  // comments contained in the inspected prefix; an incomplete prefix is ambiguous.
  while (text.startsWith("<!--")) {
    const end = text.indexOf("-->");
    if (end < 0) break;
    text = text.slice(end + 3).trimStart();
  }

  const detected =
    /^(?:<!doctype\s+html(?:\s|>)|<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>)|<title(?:\s|>)|<meta(?:\s|\/?>))/iu.test(
      text,
    );
  return Object.freeze({
    detected,
    source: "bounded_response_prefix",
    bytesInspected: prefix.byteLength,
  });
}

function assertPreParseStructureLimit(html: string, maximumNodes: number): void {
  let structuralNodes = 0;
  const markup = /<!--|<![^<>]*>|<\?[^<>]*>|<[A-Za-z][^<>]*>/gu;
  while (markup.exec(html) !== null) {
    structuralNodes += 1;
    if (structuralNodes > maximumNodes) {
      throw new TypeError("The HTML markup exceeds the configured pre-parse structural limit.");
    }
  }
}

function boundedLimits(overrides: Partial<PageExtractionLimits>): Readonly<PageExtractionLimits> {
  const limits = Object.freeze({ ...DEFAULT_PAGE_EXTRACTION_LIMITS, ...overrides });
  if (
    !Number.isInteger(limits.maxDocumentBytes) ||
    limits.maxDocumentBytes < 1_024 ||
    limits.maxDocumentBytes > 10 * 1_024 * 1_024
  ) {
    throw new TypeError("maxDocumentBytes must be between 1024 and 10485760.");
  }
  if (
    !Number.isInteger(limits.maxExtractedItems) ||
    limits.maxExtractedItems < 1 ||
    limits.maxExtractedItems > 100_000
  ) {
    throw new TypeError("maxExtractedItems must be between 1 and 100000.");
  }
  if (
    !Number.isInteger(limits.maxJsonLdCharacters) ||
    limits.maxJsonLdCharacters < 1_024 ||
    limits.maxJsonLdCharacters > limits.maxDocumentBytes
  ) {
    throw new TypeError("maxJsonLdCharacters must be bounded by maxDocumentBytes.");
  }
  if (!Number.isInteger(limits.maxNodes) || limits.maxNodes < 100 || limits.maxNodes > 1_000_000) {
    throw new TypeError("maxNodes must be between 100 and 1000000.");
  }
  if (
    !Number.isInteger(limits.maxTextCharacters) ||
    limits.maxTextCharacters < 1_024 ||
    limits.maxTextCharacters > 10 * 1_024 * 1_024
  ) {
    throw new TypeError("maxTextCharacters must be between 1024 and 10485760.");
  }
  return limits;
}

function normalizeHeaders(input: ResponseHeaderInput): readonly ExtractedResponseHeader[] {
  const entries = Object.entries(input);
  if (entries.length > 256) throw new TypeError("A response may contain at most 256 headers.");
  const collected = new Map<string, string[]>();
  for (const [rawName, rawValues] of entries) {
    const name = rawName.trim().toLowerCase();
    if (!HEADER_NAME.test(name)) throw new TypeError("A response header name is malformed.");
    if (rawValues === undefined) continue;
    const values = typeof rawValues === "string" ? [rawValues] : rawValues;
    if (values.length > 32) throw new TypeError("A response header contains too many values.");
    const target = collected.get(name) ?? [];
    for (const value of values) {
      if (value.length > 8_192) throw new TypeError("A response header value is too long.");
      target.push(value);
    }
    collected.set(name, target);
  }
  return Object.freeze(
    [...collected.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, values]) =>
        Object.freeze({
          name,
          redacted: SENSITIVE_HEADER_NAMES.has(name),
          values: Object.freeze(SENSITIVE_HEADER_NAMES.has(name) ? [] : [...values]),
        }),
      ),
  );
}

function headerValues(
  headers: readonly ExtractedResponseHeader[],
  name: string,
): readonly string[] {
  return headers.find((header) => header.name === name)?.values ?? [];
}

function firstHeader(headers: readonly ExtractedResponseHeader[], name: string): string | null {
  return headerValues(headers, name)[0] ?? null;
}

function parseContentLength(headers: readonly ExtractedResponseHeader[]): number | null {
  const value = firstHeader(headers, "content-length");
  if (value === null || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function extractResponseMetadata(input: PageExtractionInput): ResponseMetadataExtraction {
  if (
    !Number.isSafeInteger(input.responseBytes) ||
    input.responseBytes < 0 ||
    !Number.isSafeInteger(input.transferSize) ||
    input.transferSize < 0
  ) {
    throw new TypeError("Response byte counts must be nonnegative safe integers.");
  }
  const headers = normalizeHeaders(input.headers);
  const contentEncoding = firstHeader(headers, "content-encoding")?.trim().toLowerCase() ?? null;
  const sensitive = headers.filter((header) => header.redacted).map((header) => header.name);
  return Object.freeze({
    cacheHeaders: Object.freeze(headers.filter((header) => CACHE_HEADER_NAMES.has(header.name))),
    compression:
      contentEncoding === null || contentEncoding === "" || contentEncoding === "identity"
        ? null
        : contentEncoding,
    contentLength: parseContentLength(headers),
    contentType: input.contentType,
    excludedSensitiveHeaderNames: Object.freeze(sensitive),
    headers,
    responseBytes: input.responseBytes,
    securityHeaders: Object.freeze(
      headers.filter((header) => SECURITY_HEADER_NAMES.has(header.name)),
    ),
    transferSize: input.transferSize,
  });
}

function bytesFor(input: string | Uint8Array): Uint8Array {
  return typeof input === "string" ? new TextEncoder().encode(input) : input;
}

function normalizeEncodingLabel(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/gu, "")
    .toLowerCase();
}

function encodingFromContentType(value: string | null): string | null {
  return value?.match(/(?:^|;)\s*charset\s*=\s*([^;]+)/iu)?.[1]?.trim() ?? null;
}

function encodingFromMeta(
  bytes: Uint8Array,
): Readonly<{ label: string; offsetBytes: number }> | null {
  const prefix = Buffer.from(bytes.subarray(0, 2_048)).toString("latin1");
  const directMatch = /<meta\b[^>]*\bcharset\s*=\s*(?:["']\s*)?([^\s"'/>;]+)/iu.exec(prefix);
  const direct = directMatch?.[1];
  if (direct !== undefined && directMatch?.index !== undefined) {
    return Object.freeze({
      label: direct,
      offsetBytes: directMatch.index + Buffer.byteLength(directMatch[0], "latin1"),
    });
  }
  const httpEquiv = /<meta\b[^>]*\bhttp-equiv\s*=\s*(?:["']\s*)?content-type(?:\s*["'])?[^>]*>/giu;
  for (const match of prefix.matchAll(httpEquiv)) {
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(match[0]);
    const charset = encodingFromContentType(content?.[1] ?? content?.[2] ?? content?.[3] ?? null);
    if (charset !== null && match.index !== undefined) {
      return Object.freeze({
        label: charset,
        offsetBytes: match.index + Buffer.byteLength(match[0], "latin1"),
      });
    }
  }
  return null;
}

function detectEncoding(
  bytes: Uint8Array,
  contentTypeHeader: string | null,
): HtmlEncodingExtraction {
  let declared: string | null = null;
  let declarationOffsetBytes: number | null = null;
  let source: HtmlEncodingExtraction["source"] = "default";
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    declared = "utf-8";
    source = "bom";
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    declared = "utf-16le";
    source = "bom";
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    declared = "utf-16be";
    source = "bom";
  } else {
    const headerEncoding = encodingFromContentType(contentTypeHeader);
    const metaEncoding = encodingFromMeta(bytes);
    if (headerEncoding !== null) {
      declared = normalizeEncodingLabel(headerEncoding);
      source = "http_header";
    } else if (metaEncoding !== null) {
      declared = normalizeEncodingLabel(metaEncoding.label);
      declarationOffsetBytes = metaEncoding.offsetBytes;
      source = "meta";
    }
  }

  const candidate = declared ?? "utf-8";
  try {
    const decoder = new TextDecoder(candidate);
    return Object.freeze({ declared, declarationOffsetBytes, source, used: decoder.encoding });
  } catch {
    return Object.freeze({ declared, declarationOffsetBytes, source, used: "utf-8" });
  }
}

function decodeDocument(
  input: HtmlDocumentInput,
  contentTypeHeader: string | null,
  limits: PageExtractionLimits,
): Readonly<{ encoding: HtmlEncodingExtraction; html: string }> {
  const bytes = bytesFor(input.body);
  if (bytes.byteLength > limits.maxDocumentBytes) {
    throw new TypeError("The HTML document exceeds the configured extraction byte limit.");
  }
  const encoding = detectEncoding(bytes, contentTypeHeader);
  const html =
    typeof input.body === "string"
      ? input.body
      : new TextDecoder(encoding.used, { fatal: false }).decode(input.body);
  if (html.length > limits.maxTextCharacters) {
    throw new TypeError("The decoded HTML exceeds the configured character limit.");
  }
  return Object.freeze({ encoding, html });
}

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function isTextNode(node: HtmlNode | HtmlParentNode): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === "#text" && "value" in node;
}

function children(node: HtmlNode | HtmlParentNode): readonly HtmlNode[] {
  return "childNodes" in node ? node.childNodes : [];
}

function attribute(element: HtmlElement, name: string): string | null {
  return element.attrs.find((candidate) => candidate.name === name)?.value ?? null;
}

function hasAttribute(element: HtmlElement, name: string): boolean {
  return element.attrs.some((candidate) => candidate.name === name);
}

function tokens(value: string | null): readonly string[] {
  if (value === null) return [];
  return Object.freeze([
    ...new Set(
      value
        .split(/\s+/u)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]);
}

function casePreservingTokens(value: string | null): readonly string[] {
  if (value === null) return [];
  return Object.freeze([
    ...new Set(
      value
        .split(/\s+/u)
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  ]);
}

function textContent(node: HtmlNode | HtmlParentNode): string {
  const values: string[] = [];
  const stack: Array<HtmlNode | HtmlParentNode> = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    if (isTextNode(current)) values.push(current.value);
    const nested = children(current);
    for (let index = nested.length - 1; index >= 0; index -= 1) {
      const child = nested[index];
      if (child !== undefined) stack.push(child);
    }
  }
  return normalizeWhitespace(values.join(" "));
}

function rawTextContent(node: HtmlNode | HtmlParentNode): string {
  const values: string[] = [];
  const stack: Array<HtmlNode | HtmlParentNode> = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    if (isTextNode(current)) values.push(current.value);
    const nested = children(current);
    for (let index = nested.length - 1; index >= 0; index -= 1) {
      const child = nested[index];
      if (child !== undefined) stack.push(child);
    }
  }
  return values.join("");
}

function isVisuallyHidden(element: HtmlElement): boolean {
  if (hasAttribute(element, "hidden")) return true;
  if (attribute(element, "aria-hidden")?.trim().toLowerCase() === "true") return true;
  const style = attribute(element, "style")?.toLowerCase() ?? "";
  return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/u.test(
    style,
  );
}

function visibleText(document: DefaultTreeAdapterTypes.Document): string {
  const values: string[] = [];
  const stack: Array<Readonly<{ hidden: boolean; node: HtmlNode | HtmlParentNode }>> = [
    { hidden: false, node: document },
  ];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    const { hidden, node } = current;
    if (isTextNode(node)) {
      if (!hidden) values.push(node.value);
      continue;
    }
    const nextHidden =
      hidden ||
      (isElement(node) && (HIDDEN_TEXT_ELEMENTS.has(node.tagName) || isVisuallyHidden(node)));
    const nested = children(node);
    for (let index = nested.length - 1; index >= 0; index -= 1) {
      const child = nested[index];
      if (child !== undefined) stack.push({ hidden: nextHidden, node: child });
    }
  }
  return normalizeWhitespace(values.join(" ")).normalize("NFC");
}

function wordTokens(value: string): readonly string[] {
  return Object.freeze(value.match(WORD) ?? []);
}

function simHash(value: string): string {
  const terms = wordTokens(value.toLocaleLowerCase("und"));
  if (terms.length === 0) return "0000000000000000";
  const frequencies = new Map<string, number>();
  for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  const weights = Array.from({ length: 64 }, () => 0);
  for (const [term, frequency] of frequencies) {
    const digest = createHash("sha256").update(term).digest();
    const value64 = digest.readBigUInt64BE(0);
    for (let bit = 0; bit < 64; bit += 1) {
      const mask = 1n << BigInt(bit);
      weights[bit] = (weights[bit] ?? 0) + ((value64 & mask) === 0n ? -frequency : frequency);
    }
  }
  let fingerprint = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    if ((weights[bit] ?? 0) >= 0) fingerprint |= 1n << BigInt(bit);
  }
  return fingerprint.toString(16).padStart(16, "0");
}

export function similarityFingerprintDistance(left: string, right: string): number {
  if (!/^[\da-f]{16}$/iu.test(left) || !/^[\da-f]{16}$/iu.test(right)) {
    throw new TypeError("Similarity fingerprints must be 16 hexadecimal characters.");
  }
  let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (difference !== 0n) {
    difference &= difference - 1n;
    count += 1;
  }
  return count;
}

function crawlerProductToken(userAgent: string): string | null {
  const token = userAgent.trim().toLowerCase().split(/[\s/]/u, 1)[0];
  return token === undefined || token === "" ? null : token;
}

function sourceAppliesToCrawler(
  source: RobotsDirectiveSource,
  crawlerToken: string | null,
): boolean {
  const owner = source.userAgent.trim().toLowerCase();
  return owner === "*" || owner === "robots" || (crawlerToken !== null && owner === crawlerToken);
}

/**
 * Selects only global directives and directives explicitly scoped to the configured crawler.
 * The returned values can be persisted without turning another crawler's policy into a global one.
 */
export function applicableRobotsDirectives(
  extraction: RobotsDirectiveExtraction,
  userAgent: string,
): Readonly<{ meta: readonly string[]; xRobotsTag: readonly string[] }> {
  const crawlerToken = crawlerProductToken(userAgent);
  const select = (sources: readonly RobotsDirectiveSource[]): readonly string[] =>
    Object.freeze([
      ...new Set(
        sources
          .filter((source) => sourceAppliesToCrawler(source, crawlerToken))
          .flatMap((source) => source.directives),
      ),
    ]);

  return Object.freeze({
    meta: select(extraction.meta),
    xRobotsTag: select(extraction.xRobotsTag),
  });
}

function resolveReference(rawValue: string, baseUrl: string): ResolvedUrlReference {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return Object.freeze({
      error: "empty_url",
      normalizedUrl: null,
      rawValue,
      resolvedUrl: null,
    });
  }
  let resolved: URL;
  try {
    resolved = new URL(trimmed, baseUrl);
  } catch {
    return Object.freeze({
      error: "invalid_url",
      normalizedUrl: null,
      rawValue,
      resolvedUrl: null,
    });
  }
  if (resolved.username !== "" || resolved.password !== "") {
    return Object.freeze({
      error: "userinfo_not_allowed",
      normalizedUrl: null,
      rawValue,
      resolvedUrl: null,
    });
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return Object.freeze({
      error: "unsupported_protocol",
      normalizedUrl: null,
      rawValue,
      resolvedUrl: resolved.toString(),
    });
  }
  try {
    return Object.freeze({
      error: null,
      normalizedUrl: normalizeCrawlUrl(resolved.toString()),
      rawValue,
      resolvedUrl: resolved.toString(),
    });
  } catch {
    return Object.freeze({
      error: "invalid_url",
      normalizedUrl: null,
      rawValue,
      resolvedUrl: null,
    });
  }
}

function positiveInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function groupedMetadata(
  elements: readonly HtmlElement[],
  keyAttribute: "name" | "property",
  prefix: string,
  maximum: number,
): readonly MetadataProperty[] {
  const values = new Map<string, string[]>();
  let extracted = 0;
  for (const element of elements) {
    if (extracted >= maximum) break;
    if (element.tagName !== "meta") continue;
    const key = attribute(element, keyAttribute)?.trim().toLowerCase();
    const content = attribute(element, "content");
    if (key === undefined || key === null || !key.startsWith(prefix) || content === null) continue;
    const target = values.get(key) ?? [];
    target.push(content);
    values.set(key, target);
    extracted += 1;
  }
  return Object.freeze(
    [...values.entries()].map(([key, entries]) =>
      Object.freeze({ key, values: Object.freeze(entries) }),
    ),
  );
}

function parseDirectives(value: string): readonly string[] {
  return Object.freeze([
    ...new Set(
      value
        .split(/[\s,]+/u)
        .map((directive) => directive.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]);
}

function parseXRobotsTag(value: string): RobotsDirectiveSource {
  const colon = value.indexOf(":");
  const possibleAgent = colon > 0 ? value.slice(0, colon).trim() : "";
  const normalizedAgent = possibleAgent.toLowerCase();
  const hasAgent =
    colon > 0 && /^[\w.*-]+$/u.test(possibleAgent) && !ROBOTS_VALUE_DIRECTIVES.has(normalizedAgent);
  const content = hasAgent ? value.slice(colon + 1).trim() : value;
  return Object.freeze({
    content,
    directives: parseDirectives(content),
    userAgent: hasAgent ? normalizedAgent : "*",
  });
}

function robotsDirectives(
  elements: readonly HtmlElement[],
  headers: readonly ExtractedResponseHeader[],
  maximum: number,
): RobotsDirectiveExtraction {
  const meta: RobotsDirectiveSource[] = [];
  let metaSourceCount = 0;
  for (const element of elements) {
    if (element.tagName !== "meta") continue;
    const name = attribute(element, "name")?.trim().toLowerCase();
    const content = attribute(element, "content");
    if (
      name === undefined ||
      name === null ||
      content === null ||
      (name !== "robots" && !name.endsWith("bot") && name !== "slurp")
    ) {
      continue;
    }
    metaSourceCount += 1;
    if (meta.length >= maximum) continue;
    meta.push(
      Object.freeze({
        content,
        directives: parseDirectives(content),
        userAgent: name,
      }),
    );
  }
  const xRobotsTagValues = headerValues(headers, "x-robots-tag");
  const xRobotsTag = xRobotsTagValues.slice(0, maximum).map(parseXRobotsTag);
  const effective = Object.freeze(
    [...new Set([...meta, ...xRobotsTag].flatMap((source) => source.directives))].sort(),
  );
  const effectiveSet = new Set(effective);
  const conflicts = Object.freeze(
    ROBOTS_CONFLICTS.filter(
      ([positive, negative]) => effectiveSet.has(positive) && effectiveSet.has(negative),
    ).map(([positive, negative]) => `${positive}/${negative}`),
  );
  return Object.freeze({
    complete: metaSourceCount <= maximum && xRobotsTagValues.length <= maximum,
    conflicts,
    effective,
    meta: Object.freeze(meta),
    xRobotsTag: Object.freeze(xRobotsTag),
  });
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown, depth = 0, counter = { value: 0 }): JsonValue {
  counter.value += 1;
  if (counter.value > 10_000 || depth > 50) throw new TypeError("JSON-LD is too deeply nested.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON-LD contains a non-finite number.");
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item: unknown) => toJsonValue(item, depth + 1, counter)));
  }
  if (isJsonRecord(value)) {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = toJsonValue(item, depth + 1, counter);
    }
    return Object.freeze(result);
  }
  throw new TypeError("JSON-LD contains an unsupported value.");
}

function jsonLdBlocks(
  elements: readonly HtmlElement[],
  maxCharacters: number,
  maximum: number,
): readonly JsonLdExtraction[] {
  const blocks: JsonLdExtraction[] = [];
  for (const element of elements) {
    if (blocks.length >= maximum) break;
    if (
      element.tagName !== "script" ||
      attribute(element, "type")?.trim().toLowerCase() !== "application/ld+json"
    ) {
      continue;
    }
    const raw = rawTextContent(element).trim();
    if (raw.length > maxCharacters) {
      blocks.push(
        Object.freeze({
          error: "JSON-LD exceeds the configured character limit.",
          raw: raw.slice(0, maxCharacters),
          value: null,
        }),
      );
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      blocks.push(Object.freeze({ error: null, raw, value: toJsonValue(parsed) }));
    } catch (error) {
      blocks.push(
        Object.freeze({
          error: error instanceof Error ? error.message.slice(0, 512) : "Invalid JSON-LD.",
          raw,
          value: null,
        }),
      );
    }
  }
  return Object.freeze(blocks);
}

function microdataValue(element: HtmlElement, baseUrl: string): MicrodataProperty["value"] {
  const attributeName =
    element.tagName === "meta"
      ? "content"
      : ["audio", "embed", "iframe", "img", "source", "track", "video"].includes(element.tagName)
        ? "src"
        : ["a", "area", "link"].includes(element.tagName)
          ? "href"
          : element.tagName === "object"
            ? "data"
            : ["data", "meter"].includes(element.tagName)
              ? "value"
              : element.tagName === "time"
                ? "datetime"
                : null;
  if (attributeName === null) return textContent(element);
  const raw = attribute(element, attributeName) ?? "";
  if (["href", "src", "data"].includes(attributeName)) {
    return resolveReference(raw, baseUrl).resolvedUrl ?? raw;
  }
  return raw;
}

function extractMicrodata(
  elements: readonly HtmlElement[],
  baseUrl: string,
  maximum: number,
): readonly MicrodataItemExtraction[] {
  const items: MicrodataItemExtraction[] = [];
  let propertyCount = 0;
  for (const root of elements) {
    if (!hasAttribute(root, "itemscope") || items.length >= maximum) continue;
    const properties: MicrodataProperty[] = [];
    const pending: HtmlElement[] = [root];
    while (pending.length > 0) {
      const node = pending.pop();
      if (node === undefined) continue;
      const nested = children(node);
      const descendants: HtmlElement[] = [];
      for (const child of nested) {
        if (!isElement(child)) continue;
        const propertyNames = casePreservingTokens(attribute(child, "itemprop"));
        if (propertyNames.length > 0 && propertyCount < maximum) {
          const value = microdataValue(child, baseUrl);
          const reference = ["href", "src", "data"].some((name) => attribute(child, name) !== null)
            ? resolveReference(value, baseUrl).resolvedUrl
            : null;
          properties.push(Object.freeze({ names: propertyNames, value, valueUrl: reference }));
          propertyCount += 1;
        }
        if (!hasAttribute(child, "itemscope")) descendants.push(child);
      }
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        const descendant = descendants[index];
        if (descendant !== undefined) pending.push(descendant);
      }
    }
    const itemId = attribute(root, "itemid");
    items.push(
      Object.freeze({
        identifier: itemId === null ? null : resolveReference(itemId, baseUrl).resolvedUrl,
        properties: Object.freeze(properties),
        types: casePreservingTokens(attribute(root, "itemtype")),
      }),
    );
  }
  return Object.freeze(items);
}

function extractLinks(
  elements: readonly HtmlElement[],
  baseUrl: string,
  sourceUrl: string,
  depth: number,
  scopeHostname: string,
  includeSubdomains: boolean,
  maximum: number,
): readonly LinkExtraction[] {
  const links: LinkExtraction[] = [];
  for (const element of elements) {
    if (!["a", "area"].includes(element.tagName) || links.length >= maximum) continue;
    const rawTarget = attribute(element, "href") ?? "";
    const target = resolveReference(rawTarget, baseUrl);
    const internal =
      target.normalizedUrl === null
        ? null
        : isUrlInScope(target.normalizedUrl, {
            hostname: scopeHostname,
            includeSubdomains,
          });
    links.push(
      Object.freeze({
        anchorText:
          element.tagName === "a" ? textContent(element) : (attribute(element, "alt") ?? ""),
        discoveryDepth: depth + 1,
        discoverySource: "link",
        discoveredPage: internal === true,
        internal,
        linkType: element.tagName === "area" ? "area" : "anchor",
        normalizedTargetUrl: target.normalizedUrl,
        rawTarget,
        rel: tokens(attribute(element, "rel")),
        resolvedTargetUrl: target.resolvedUrl,
        sourceUrl,
      }),
    );
  }
  return Object.freeze(links);
}

function parseSourceSet(value: string | null, baseUrl: string): readonly ImageSourceCandidate[] {
  if (value === null) return [];
  return Object.freeze(
    value
      .split(",")
      .map((candidate) => candidate.trim())
      .filter(Boolean)
      .map((candidate) => {
        const [rawUrl = "", descriptor] = candidate.split(/\s+/u, 2);
        const reference = resolveReference(rawUrl, baseUrl);
        return Object.freeze({
          descriptor: descriptor ?? null,
          normalizedUrl: reference.normalizedUrl,
          rawUrl,
          resolvedUrl: reference.resolvedUrl,
        });
      }),
  );
}

function extractImages(
  elements: readonly HtmlElement[],
  baseUrl: string,
  maximum: number,
): readonly ImageExtraction[] {
  return Object.freeze(
    elements
      .filter((element) => element.tagName === "img")
      .slice(0, maximum)
      .map((element) =>
        Object.freeze({
          alt: attribute(element, "alt"),
          height: positiveInteger(attribute(element, "height")),
          loading: attribute(element, "loading")?.trim().toLowerCase() ?? null,
          source: resolveReference(attribute(element, "src") ?? "", baseUrl),
          sourceSet: parseSourceSet(attribute(element, "srcset"), baseUrl),
          title: attribute(element, "title"),
          width: positiveInteger(attribute(element, "width")),
        }),
      ),
  );
}

function extractScripts(
  elements: readonly HtmlElement[],
  baseUrl: string,
  maximum: number,
): readonly ScriptExtraction[] {
  return Object.freeze(
    elements
      .filter((element) => element.tagName === "script")
      .slice(0, maximum)
      .map((element) => {
        const source = attribute(element, "src");
        const inline = source === null ? rawTextContent(element) : "";
        return Object.freeze({
          async: hasAttribute(element, "async"),
          contentHash: inline === "" ? null : sha256(inline),
          defer: hasAttribute(element, "defer"),
          inlineBytes: Buffer.byteLength(inline),
          module: attribute(element, "type")?.trim().toLowerCase() === "module",
          source: source === null ? null : resolveReference(source, baseUrl),
          type: attribute(element, "type")?.trim().toLowerCase() ?? null,
        });
      }),
  );
}

function extractStylesheets(
  elements: readonly HtmlElement[],
  baseUrl: string,
  maximum: number,
): readonly StylesheetExtraction[] {
  const stylesheets: StylesheetExtraction[] = [];
  for (const element of elements) {
    if (stylesheets.length >= maximum) break;
    if (element.tagName === "style") {
      const content = rawTextContent(element);
      stylesheets.push(
        Object.freeze({
          contentHash: sha256(content),
          inline: true,
          media: attribute(element, "media"),
          source: null,
        }),
      );
    } else if (
      element.tagName === "link" &&
      tokens(attribute(element, "rel")).includes("stylesheet")
    ) {
      stylesheets.push(
        Object.freeze({
          contentHash: null,
          inline: false,
          media: attribute(element, "media"),
          source: resolveReference(attribute(element, "href") ?? "", baseUrl),
        }),
      );
    }
  }
  return Object.freeze(stylesheets);
}

function extractIframes(
  elements: readonly HtmlElement[],
  baseUrl: string,
  maximum: number,
): readonly IframeExtraction[] {
  return Object.freeze(
    elements
      .filter((element) => element.tagName === "iframe")
      .slice(0, maximum)
      .map((element) =>
        Object.freeze({
          loading: attribute(element, "loading")?.trim().toLowerCase() ?? null,
          sandbox: tokens(attribute(element, "sandbox")),
          source: resolveReference(attribute(element, "src") ?? "", baseUrl),
          title: attribute(element, "title"),
        }),
      ),
  );
}

function descendantElements(root: HtmlElement): readonly HtmlElement[] {
  const found: HtmlElement[] = [];
  const pending: Array<HtmlNode | HtmlParentNode> = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    for (const child of children(node)) {
      if (isElement(child)) found.push(child);
      pending.push(child);
    }
  }
  return found;
}

function extractForms(
  elements: readonly HtmlElement[],
  baseUrl: string,
  maximum: number,
): readonly FormExtraction[] {
  return Object.freeze(
    elements
      .filter((element) => element.tagName === "form")
      .slice(0, maximum)
      .map((element) => {
        const fields = descendantElements(element).filter(
          (child) => child.tagName === "input" || child.tagName === "button",
        );
        const inputTypes = fields.map(
          (field) => attribute(field, "type")?.trim().toLowerCase() ?? "text",
        );
        return Object.freeze({
          action: resolveReference(attribute(element, "action") ?? baseUrl, baseUrl),
          enctype:
            attribute(element, "enctype")?.trim().toLowerCase() ??
            "application/x-www-form-urlencoded",
          hasFileInput: inputTypes.includes("file"),
          hasPasswordInput: inputTypes.includes("password"),
          inputCount: fields.length,
          method: attribute(element, "method")?.trim().toLowerCase() ?? "get",
        });
      }),
  );
}

function clientRenderedSignals(
  elements: readonly HtmlElement[],
  visible: string,
  wordCount: number,
): readonly string[] {
  const signals = new Set<string>();
  if (
    elements.some(
      (element) =>
        ["app", "root", "__next"].includes(attribute(element, "id")?.toLowerCase() ?? "") &&
        textContent(element) === "",
    )
  ) {
    signals.add("empty_application_root");
  }
  if (
    elements.some(
      (element) =>
        element.tagName === "script" &&
        ["__next_data__", "__nuxt_data__"].includes(attribute(element, "id")?.toLowerCase() ?? ""),
    )
  ) {
    signals.add("framework_bootstrap_payload");
  }
  const scriptCount = elements.filter((element) => element.tagName === "script").length;
  if (scriptCount >= 3 && wordCount < 10) signals.add("script_heavy_low_text");
  if (
    elements.some(
      (element) =>
        element.tagName === "noscript" &&
        /enable javascript|requires javascript/iu.test(textContent(element)),
    )
  ) {
    signals.add("javascript_required_message");
  }
  if (visible === "" && scriptCount > 0) signals.add("script_only_document");
  return Object.freeze([...signals]);
}

function resolvedRedirectSignal(rawValue: string, baseUrl: string): string | null {
  const trimmed = rawValue.trim();
  if (trimmed === "" || trimmed.length > 4_096 || trimmed.includes("\\")) return null;
  const reference = resolveReference(trimmed, baseUrl);
  return reference.error === null ? reference.normalizedUrl : null;
}

function metaRefreshRedirect(elements: readonly HtmlElement[], baseUrl: string): string | null {
  for (const element of elements) {
    if (
      element.tagName !== "meta" ||
      attribute(element, "http-equiv")?.trim().toLowerCase() !== "refresh"
    ) {
      continue;
    }
    const content = attribute(element, "content");
    if (content === null || content.length > 8_192) continue;
    const match =
      /^\s*\d+(?:\.\d+)?\s*;\s*url\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\r\n]*?))\s*$/iu.exec(content);
    const destination = match?.[1] ?? match?.[2] ?? match?.[3];
    if (destination === undefined) continue;
    const resolved = resolvedRedirectSignal(destination, baseUrl);
    if (resolved !== null) return resolved;
  }
  return null;
}

/** Marks only JavaScript code positions; quoted strings and comments remain false. */
function javascriptCodePositions(source: string): Uint8Array {
  const code = new Uint8Array(source.length);
  let state: "code" | "single" | "double" | "template" | "line-comment" | "block-comment" = "code";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (state === "line-comment") {
      if (current === "\n" || current === "\r") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        index += 1;
        state = "code";
      }
      continue;
    }
    if (state !== "code") {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === "\\") {
        escaped = true;
        continue;
      }
      if (
        (state === "single" && current === "'") ||
        (state === "double" && current === '"') ||
        (state === "template" && current === "`")
      ) {
        state = "code";
      }
      continue;
    }
    if (current === "/" && next === "/") {
      index += 1;
      state = "line-comment";
      continue;
    }
    if (current === "/" && next === "*") {
      index += 1;
      state = "block-comment";
      continue;
    }
    if (current === "'") {
      state = "single";
      continue;
    }
    if (current === '"') {
      state = "double";
      continue;
    }
    if (current === "`") {
      state = "template";
      continue;
    }
    code[index] = 1;
  }
  return code;
}

function javascriptRedirect(elements: readonly HtmlElement[], baseUrl: string): string | null {
  const patterns = [
    /(?:\bwindow\s*\.\s*)?\blocation\s*(?:\.\s*href\s*)?=\s*(["'`])([^\\"'`\r\n]{1,4096})\1/giu,
    /(?:\bwindow\s*\.\s*)?\blocation\s*\.\s*(?:assign|replace)\s*\(\s*(["'`])([^\\"'`\r\n]{1,4096})\1\s*\)/giu,
  ] as const;
  for (const element of elements) {
    if (element.tagName !== "script" || attribute(element, "src") !== null) continue;
    const scriptType = attribute(element, "type")?.trim().toLowerCase() ?? "";
    if (
      scriptType !== "" &&
      scriptType !== "module" &&
      scriptType !== "text/javascript" &&
      scriptType !== "application/javascript"
    ) {
      continue;
    }
    const source = textContent(element);
    if (source === "") continue;
    const code = javascriptCodePositions(source);
    const candidates: Array<Readonly<{ index: number; destination: string }>> = [];
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        if (match.index === undefined || code[match.index] !== 1 || match[2] === undefined)
          continue;
        candidates.push(Object.freeze({ index: match.index, destination: match[2] }));
      }
    }
    candidates.sort((left, right) => left.index - right.index);
    for (const candidate of candidates) {
      const resolved = resolvedRedirectSignal(candidate.destination, baseUrl);
      if (resolved !== null) return resolved;
    }
  }
  return null;
}

function extractionForDocument(
  input: HtmlDocumentInput,
  page: PageExtractionInput,
  responseHeaders: readonly ExtractedResponseHeader[],
  limits: PageExtractionLimits,
): HtmlDocumentExtraction {
  const contentTypeHeader = firstHeader(responseHeaders, "content-type") ?? page.contentType;
  const decoded = decodeDocument(input, contentTypeHeader, limits);
  assertPreParseStructureLimit(decoded.html, limits.maxNodes);
  const parseIssues: HtmlParseIssue[] = [];
  const document = parse(decoded.html, {
    onParseError(error: ParserError) {
      if (parseIssues.length >= 1_000) return;
      parseIssues.push(
        Object.freeze({
          code: error.code,
          column: error.startCol ?? null,
          line: error.startLine ?? null,
          message: `HTML parse issue: ${error.code}`,
        }),
      );
    },
  });
  const elements: HtmlElement[] = [];
  const pending: Array<HtmlNode | HtmlParentNode> = [document];
  let nodeCount = 0;
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    if (node !== document) {
      nodeCount += 1;
      if (isElement(node)) elements.push(node);
      if (nodeCount > limits.maxNodes) {
        throw new TypeError("The HTML document exceeds the configured DOM node limit.");
      }
    }
    const nested = children(node);
    for (let index = nested.length - 1; index >= 0; index -= 1) {
      const child = nested[index];
      if (child === undefined) continue;
      pending.push(child);
    }
  }

  let baseUrl = page.finalUrl;
  const baseHref = elements
    .find((element) => element.tagName === "base")
    ?.attrs.find((candidate) => candidate.name === "href")?.value;
  if (baseHref !== undefined) {
    const reference = resolveReference(baseHref, page.finalUrl);
    if (reference.normalizedUrl !== null) baseUrl = reference.normalizedUrl;
  }

  const allTitleElements = elements.filter((element) => element.tagName === "title");
  const titleElements = allTitleElements.slice(0, limits.maxExtractedItems).map(textContent);
  const descriptionElements = elements.filter(
    (element) =>
      element.tagName === "meta" &&
      attribute(element, "name")?.trim().toLowerCase() === "description",
  );
  const descriptions = descriptionElements.slice(0, limits.maxExtractedItems);
  const descriptionValues = descriptions.map((element) => attribute(element, "content") ?? "");
  const viewportElements = elements.filter(
    (element) =>
      element.tagName === "meta" && attribute(element, "name")?.trim().toLowerCase() === "viewport",
  );
  const viewportDeclarations = viewportElements
    .slice(0, limits.maxExtractedItems)
    .map((element) => attribute(element, "content") ?? "");
  const iconElements = elements.filter((element) => {
    if (element.tagName !== "link") return false;
    const rel = tokens(attribute(element, "rel"));
    return rel.some((value) =>
      ["icon", "apple-touch-icon", "apple-touch-icon-precomposed", "mask-icon"].includes(value),
    );
  });
  const openGraphElementCount = elements.filter((element) => {
    const property = attribute(element, "property")?.trim().toLowerCase();
    return element.tagName === "meta" && property?.startsWith("og:") === true;
  }).length;
  const socialCardElementCount = elements.filter((element) => {
    const name = attribute(element, "name")?.trim().toLowerCase();
    return element.tagName === "meta" && name?.startsWith("twitter:") === true;
  }).length;
  const canonicalElements = elements
    .filter(
      (element) =>
        element.tagName === "link" && tokens(attribute(element, "rel")).includes("canonical"),
    )
    .slice(0, limits.maxExtractedItems);
  const canonicals = canonicalElements.map((element) =>
    resolveReference(attribute(element, "href") ?? "", baseUrl),
  );
  const hreflang: HreflangReference[] = elements
    .flatMap((element): readonly HreflangReference[] => {
      if (
        element.tagName !== "link" ||
        !tokens(attribute(element, "rel")).includes("alternate") ||
        attribute(element, "hreflang") === null
      ) {
        return [];
      }
      const reference = resolveReference(attribute(element, "href") ?? "", baseUrl);
      return [
        Object.freeze({
          ...reference,
          language: attribute(element, "hreflang")?.trim().toLowerCase() ?? "",
        }),
      ];
    })
    .slice(0, limits.maxExtractedItems);
  const headingElements = elements.filter((element) => /^h[1-6]$/u.test(element.tagName));
  const headings: HeadingExtraction[] = headingElements
    .flatMap((element): readonly HeadingExtraction[] => {
      const level = Number(element.tagName.slice(1)) as HeadingExtraction["level"];
      return [Object.freeze({ level, text: textContent(element) })];
    })
    .slice(0, limits.maxExtractedItems);
  const visible = visibleText(document);
  const words = wordTokens(visible);
  const signals = clientRenderedSignals(elements, visible, words.length);
  const robots = robotsDirectives(elements, responseHeaders, limits.maxExtractedItems);
  const linkElementCount = elements.filter(
    (element) => element.tagName === "a" || element.tagName === "area",
  ).length;
  const links = extractLinks(
    elements,
    baseUrl,
    page.finalUrl,
    page.depth,
    page.scopeHostname,
    page.includeSubdomains,
    limits.maxExtractedItems,
  );

  return Object.freeze({
    baseUrl,
    canonical: canonicals[0] ?? null,
    canonicals: Object.freeze(canonicals),
    characterEncoding: decoded.encoding,
    clientRenderedSignals: signals,
    contentHash: sha256(visible.normalize("NFC")),
    decodedHtml: decoded.html,
    documentMetadataComplete:
      allTitleElements.length <= limits.maxExtractedItems &&
      descriptionElements.length <= limits.maxExtractedItems &&
      viewportElements.length <= limits.maxExtractedItems &&
      iconElements.length <= limits.maxExtractedItems &&
      openGraphElementCount <= limits.maxExtractedItems &&
      socialCardElementCount <= limits.maxExtractedItems,
    domHash: sha256(serialize(document)),
    forms: extractForms(elements, baseUrl, limits.maxExtractedItems),
    headings: Object.freeze(headings),
    headingsComplete: headingElements.length <= limits.maxExtractedItems,
    hreflang: Object.freeze(hreflang),
    htmlLanguage:
      elements
        .find((element) => element.tagName === "html")
        ?.attrs.find((candidate) => candidate.name === "lang")
        ?.value.trim() || null,
    htmlDoctypePresent: /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype\s+html(?:\s|>)/iu.test(decoded.html),
    iconDeclarationCount: Math.min(iconElements.length, limits.maxExtractedItems),
    iframes: extractIframes(elements, baseUrl, limits.maxExtractedItems),
    images: extractImages(elements, baseUrl, limits.maxExtractedItems),
    jsonLd: jsonLdBlocks(elements, limits.maxJsonLdCharacters, limits.maxExtractedItems),
    links,
    linksComplete: linkElementCount <= limits.maxExtractedItems,
    meaningfulContent: words.length >= 10 || visible.length >= 80,
    metaRefreshUrl: metaRefreshRedirect(elements, baseUrl),
    metaDescriptions: Object.freeze(descriptionValues),
    metaDescriptionTagCount: descriptionElements.length,
    microdata: extractMicrodata(elements, baseUrl, limits.maxExtractedItems),
    openGraph: groupedMetadata(elements, "property", "og:", limits.maxExtractedItems),
    parseIssues: Object.freeze(parseIssues),
    renderingErrors: Object.freeze(
      (input.renderingErrors ?? []).map((error) => Object.freeze({ ...error })),
    ),
    robots,
    javascriptRedirectUrl: javascriptRedirect(elements, baseUrl),
    scripts: extractScripts(elements, baseUrl, limits.maxExtractedItems),
    similarityFingerprint: simHash(visible),
    socialCards: groupedMetadata(elements, "name", "twitter:", limits.maxExtractedItems),
    sourceKind: input.kind,
    stylesheets: extractStylesheets(elements, baseUrl, limits.maxExtractedItems),
    title: titleElements[0] ?? null,
    titles: Object.freeze(titleElements),
    viewportDeclarations: Object.freeze(viewportDeclarations),
    visibleText: visible,
    wordCount: words.length,
  });
}

export function evaluateRenderingNeed(
  raw: HtmlDocumentExtraction,
  enabled: boolean,
): RenderingDecision {
  if (!enabled) return Object.freeze({ reasons: Object.freeze([]), render: false });
  const reasons: RenderingDecision["reasons"][number][] = [];
  if (!raw.meaningfulContent) reasons.push("no_meaningful_content");
  if (raw.title === null || raw.metaDescriptions.length === 0) {
    reasons.push("critical_metadata_absent");
  }
  if (raw.clientRenderedSignals.length > 0) reasons.push("client_rendered");
  return Object.freeze({ reasons: Object.freeze(reasons), render: reasons.length > 0 });
}

export function extractPage(
  input: PageExtractionInput,
  limitOverrides: Partial<PageExtractionLimits> = {},
): PageExtractionResult {
  if (!Number.isInteger(input.depth) || input.depth < 0 || input.depth > 100) {
    throw new TypeError("Page extraction depth must be between 0 and 100.");
  }
  if (!Number.isInteger(input.statusCode) || input.statusCode < 100 || input.statusCode > 599) {
    throw new TypeError("Page extraction statusCode must be between 100 and 599.");
  }
  normalizeCrawlUrl(input.requestedUrl);
  normalizeCrawlUrl(input.normalizedUrl);
  normalizeCrawlUrl(input.finalUrl);
  const limits = boundedLimits(limitOverrides);
  const response = extractResponseMetadata(input);
  const raw = extractionForDocument(input.raw, input, response.headers, limits);
  const rendered =
    input.rendered === undefined
      ? null
      : extractionForDocument(input.rendered, input, response.headers, limits);
  return Object.freeze({
    depth: input.depth,
    finalUrl: input.finalUrl,
    normalizedUrl: input.normalizedUrl,
    raw,
    redirectChain: Object.freeze(input.redirectChain.map((hop) => Object.freeze({ ...hop }))),
    rendered,
    requestedUrl: input.requestedUrl,
    response,
    statusCode: input.statusCode,
  });
}
