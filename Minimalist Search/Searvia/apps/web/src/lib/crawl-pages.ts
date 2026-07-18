import type {
  CrawlPageCursor,
  CrawlPageDetailRecord,
  CrawlPageRecord,
  StoredHeaderMap,
} from "@searvia/database/runtime";
import { z } from "zod";

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 4_096;
const SENSITIVE_RESPONSE_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
  "www-authenticate",
  "x-api-key",
]);

const cursorPayloadSchema = z
  .object({
    v: z.literal(CURSOR_VERSION),
    crawlId: z.uuid(),
    depth: z.number().int().min(0).max(10),
    normalizedUrl: z.url().max(4_096),
    pageId: z.uuid(),
  })
  .strict();

export interface CrawlPageApiCursor {
  readonly crawlId: string;
  readonly depth: number;
  readonly normalizedUrl: string;
  readonly pageId: string;
}

export interface CrawlPageDto {
  readonly id: string;
  readonly crawlId: string;
  readonly requestedUrl: string;
  readonly normalizedUrl: string;
  readonly finalUrl: string | null;
  readonly statusCode: number | null;
  readonly contentType: string | null;
  readonly responseHeaders: StoredHeaderMap;
  readonly omittedResponseHeaders: readonly string[];
  readonly contentLength: number | null;
  readonly responseBytes: number;
  readonly transferSize: number;
  readonly compression: string | null;
  readonly cacheHeaders: StoredHeaderMap;
  readonly securityHeaders: StoredHeaderMap;
  readonly depth: number;
  readonly redirectChain: CrawlPageRecord["redirectChain"];
  readonly robotsDecision: CrawlPageRecord["robotsDecision"];
  readonly timing: CrawlPageRecord["timing"];
  readonly errorType: string | null;
  readonly errorMessage: string | null;
  readonly discoverySource: CrawlPageRecord["discoverySource"];
  readonly fetchedAt: string | null;
}

function serializeHeaders(headers: StoredHeaderMap): StoredHeaderMap {
  const safeEntries = Object.entries(headers)
    .filter(([name]) => !SENSITIVE_RESPONSE_HEADERS.has(name.toLowerCase()))
    .map(([name, values]) => [name, Object.freeze([...values])] as const);
  return Object.freeze(Object.fromEntries(safeEntries));
}

export function serializeCrawlPage(page: CrawlPageRecord): CrawlPageDto {
  return Object.freeze({
    id: page.id,
    crawlId: page.crawlId,
    requestedUrl: page.requestedUrl,
    normalizedUrl: page.normalizedUrl,
    finalUrl: page.finalUrl,
    statusCode: page.statusCode,
    contentType: page.contentType,
    responseHeaders: serializeHeaders(page.responseHeaders),
    omittedResponseHeaders: Object.freeze([...page.omittedResponseHeaders]),
    contentLength: page.contentLength,
    responseBytes: page.responseBytes,
    transferSize: page.transferSize,
    compression: page.compression,
    cacheHeaders: serializeHeaders(page.cacheHeaders),
    securityHeaders: serializeHeaders(page.securityHeaders),
    depth: page.depth,
    redirectChain: Object.freeze(page.redirectChain.map((hop) => Object.freeze({ ...hop }))),
    robotsDecision: page.robotsDecision,
    timing: page.timing === null ? null : Object.freeze({ ...page.timing }),
    errorType: page.errorType,
    errorMessage: page.errorMessage,
    discoverySource: page.discoverySource,
    fetchedAt: page.fetchedAt?.toISOString() ?? null,
  });
}

function iso(value: Date): string {
  return value.toISOString();
}

export function serializeCrawlPageDetail(detail: CrawlPageDetailRecord) {
  return Object.freeze({
    page: serializeCrawlPage(detail.page),
    extractions: Object.freeze(
      detail.extractions.map((extraction) =>
        Object.freeze({
          id: extraction.id,
          source: extraction.source,
          title: extraction.title,
          metaDescription: extraction.metaDescription,
          metaRobots: Object.freeze([...extraction.metaRobots]),
          xRobotsTag: Object.freeze([...extraction.xRobotsTag]),
          canonicalUrl: extraction.canonicalUrl,
          canonicalTagCount: extraction.canonicalTagCount,
          visibleText: extraction.visibleText,
          visibleTextTruncated: extraction.visibleTextTruncated,
          wordCount: extraction.wordCount,
          htmlLanguage: extraction.htmlLanguage,
          characterEncoding: extraction.characterEncoding,
          openGraph: serializeHeaders(extraction.openGraph),
          socialCards: serializeHeaders(extraction.socialCards),
          contentHash: extraction.contentHash,
          domHash: extraction.domHash,
          similarityFingerprint: extraction.similarityFingerprint,
          meaningfulContent: extraction.meaningfulContent,
          clientRendered: extraction.clientRendered,
          renderingErrorType: extraction.renderingErrorType,
          renderingErrorMessage: extraction.renderingErrorMessage,
          extractedAt: iso(extraction.extractedAt),
        }),
      ),
    ),
    artifacts: Object.freeze(
      detail.artifacts.map((artifact) =>
        Object.freeze({
          id: artifact.id,
          kind: artifact.kind,
          contentType: artifact.contentType,
          contentEncoding: artifact.contentEncoding,
          uncompressedBytes: artifact.uncompressedBytes,
          storedBytes: artifact.storedBytes,
          contentSha256: artifact.contentSha256,
          storageSha256: artifact.storageSha256,
          storedAt: iso(artifact.storedAt),
        }),
      ),
    ),
    headings: Object.freeze(
      detail.headings.map((heading) =>
        Object.freeze({
          id: heading.id,
          extractionId: heading.extractionId,
          level: heading.level,
          ordinal: heading.ordinal,
          text: heading.text,
        }),
      ),
    ),
    links: Object.freeze(
      detail.links.map((link) =>
        Object.freeze({
          id: link.id,
          extractionId: link.extractionId,
          targetPageId: link.targetPageId,
          targetUrl: link.targetUrl,
          normalizedTargetUrl: link.normalizedTargetUrl,
          scope: link.scope,
          anchorText: link.anchorText,
          relValues: Object.freeze([...link.relValues]),
          linkType: link.linkType,
          hreflang: link.hreflang,
          discovered: link.discovered,
          crawlDepth: link.crawlDepth,
          discoverySource: link.discoverySource,
          ordinal: link.ordinal,
        }),
      ),
    ),
    images: Object.freeze(
      detail.images.map((image) =>
        Object.freeze({
          id: image.id,
          extractionId: image.extractionId,
          sourceUrl: image.sourceUrl,
          normalizedUrl: image.normalizedUrl,
          scope: image.scope,
          altText: image.altText,
          title: image.title,
          width: image.width,
          height: image.height,
          loading: image.loading,
          srcset: image.srcset,
          ordinal: image.ordinal,
        }),
      ),
    ),
    resources: Object.freeze(
      detail.resources.map((resource) =>
        Object.freeze({
          id: resource.id,
          extractionId: resource.extractionId,
          resourceType: resource.resourceType,
          sourceUrl: resource.sourceUrl,
          normalizedUrl: resource.normalizedUrl,
          scope: resource.scope,
          attributes: Object.freeze({ ...resource.attributes }),
          ordinal: resource.ordinal,
        }),
      ),
    ),
    structuredData: Object.freeze(
      detail.structuredData.map((entry) =>
        Object.freeze({
          id: entry.id,
          extractionId: entry.extractionId,
          kind: entry.kind,
          parseStatus: entry.parseStatus,
          schemaTypes: Object.freeze([...entry.schemaTypes]),
          rawValue: entry.rawValue,
          parsedValue: entry.parsedValue,
          errorMessage: entry.errorMessage,
          ordinal: entry.ordinal,
        }),
      ),
    ),
    collectionTruncated: Object.freeze({ ...detail.collectionTruncated }),
  });
}

export function encodeCrawlPageCursor(cursor: CrawlPageCursor | null): string | null {
  if (cursor === null) return null;
  return Buffer.from(
    JSON.stringify({
      v: CURSOR_VERSION,
      crawlId: cursor.crawlId,
      depth: cursor.depth,
      normalizedUrl: cursor.normalizedUrl,
      pageId: cursor.pageId,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeCrawlPageCursor(value: string, crawlId: string): CrawlPageApiCursor | null {
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z\d_-]+$/u.test(value)) {
    return null;
  }

  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = cursorPayloadSchema.safeParse(JSON.parse(decoded));
    if (!parsed.success || parsed.data.crawlId !== crawlId) return null;
    return Object.freeze({
      crawlId: parsed.data.crawlId,
      depth: parsed.data.depth,
      normalizedUrl: parsed.data.normalizedUrl,
      pageId: parsed.data.pageId,
    });
  } catch {
    return null;
  }
}
