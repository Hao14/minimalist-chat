import {
  request as httpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from "node:http";
import { request as httpsRequest } from "node:https";
import type { Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import { CrawlError, isCrawlError, throwIfAborted, toCrawlError } from "./errors.js";
import { createPinnedLookup, systemDnsResolver, validateDestination } from "./network.js";
import type { TestNetworkCapability } from "./test-access.js";
import type {
  CrawlFetchLimits,
  DnsResolver,
  FetchKind,
  RedirectHop,
  SafeFetchRequest,
  SafeFetchResponse,
  SafeHttpClient,
} from "./types.js";
import { assertUrlInScope, normalizeCrawlUrl } from "./url.js";

export const SEARVIA_CRAWLER_USER_AGENT = "SearviaBot/1.0 (+https://searvia.online/crawler)";

export const DEFAULT_FETCH_LIMITS: CrawlFetchLimits = Object.freeze({
  connectTimeoutMs: 5_000,
  dnsTimeoutMs: 5_000,
  headersTimeoutMs: 10_000,
  idleTimeoutMs: 10_000,
  maxEncodedBytes: 4 * 1_024 * 1_024,
  maxResponseBytes: 2 * 1_024 * 1_024,
  maxResponseHeaderBytes: 32 * 1_024,
  redirectLimit: 5,
  requestTimeoutMs: 20_000,
});

const DEFAULT_PAGE_CONTENT_TYPES = Object.freeze([
  "application/xhtml+xml",
  "application/xml",
  "text/html",
  "text/xml",
] as const);
const FETCHABLE_PAGE_CONTENT_TYPES: ReadonlySet<string> = new Set(DEFAULT_PAGE_CONTENT_TYPES);
const CONTENT_TYPES_BY_KIND: Readonly<Record<Exclude<FetchKind, "page">, ReadonlySet<string>>> =
  Object.freeze({
    robots: new Set(["text/plain", "text/x-robots"]),
    sitemap: new Set([
      "application/atom+xml",
      "application/gzip",
      "application/octet-stream",
      "application/rss+xml",
      "application/x-gzip",
      "application/xml",
      "text/xml",
    ]),
  });

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TRANSIENT_NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);

export interface SafeHttpClientOptions {
  readonly fetchLimits?: Partial<CrawlFetchLimits>;
  readonly pageContentTypes?: readonly string[];
  readonly resolver?: DnsResolver;
  readonly userAgent?: string;
}

interface InternalResponse {
  readonly body: Uint8Array | null;
  readonly contentEncoding: string | null;
  readonly contentLength: number | null;
  readonly contentType: string | null;
  readonly dnsMs: number;
  readonly downloadMs: number;
  readonly location: string | null;
  readonly omittedResponseHeaders: readonly string[];
  readonly retryAfterMs: number | null;
  readonly responseHeaders: Readonly<Record<string, readonly string[]>>;
  readonly responseBytes: number;
  readonly statusCode: number;
  readonly ttfbMs: number;
  readonly transferBytes: number;
}

interface RequestResources {
  clientRequest: ClientRequest | undefined;
  connectTimer: NodeJS.Timeout | undefined;
  decoder: Transform | undefined;
  headersTimer: NodeJS.Timeout | undefined;
  idleTimer: NodeJS.Timeout | undefined;
  requestTimer: NodeJS.Timeout | undefined;
  response: IncomingMessage | undefined;
}

function timer(callback: () => void, milliseconds: number): NodeJS.Timeout {
  const handle = setTimeout(callback, milliseconds);
  handle.unref();
  return handle;
}

function normalizeContentType(value: string | undefined): string | null {
  if (value === undefined) return null;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "" ? null : mediaType;
}

const OMITTED_RESPONSE_HEADERS = new Set([
  "authorization",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
  "www-authenticate",
]);

function normalizeContentEncoding(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "" || normalized === "identity" ? null : normalized;
}

function declaredContentLength(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function safeResponseHeaders(headers: IncomingHttpHeaders): Readonly<{
  headers: Readonly<Record<string, readonly string[]>>;
  omitted: readonly string[];
}> {
  const persisted: Record<string, readonly string[]> = {};
  const omitted: string[] = [];
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (OMITTED_RESPONSE_HEADERS.has(name)) {
      omitted.push(name);
      continue;
    }
    const values = (Array.isArray(rawValue) ? rawValue : [rawValue])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.slice(0, 8_192));
    if (values.length > 0) persisted[name] = Object.freeze(values);
  }
  return Object.freeze({
    headers: Object.freeze(persisted),
    omitted: Object.freeze([...new Set(omitted)].sort()),
  });
}

function retryAfterMilliseconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 60_000);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.min(timestamp - Date.now(), 60_000));
}

function classifyRequestError(error: unknown): CrawlError {
  if (isCrawlError(error)) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { readonly code?: unknown }).code)
      : "";
  return new CrawlError("network_error", "The remote server could not be reached.", {
    cause: error,
    transient: TRANSIENT_NETWORK_CODES.has(code),
  });
}

function createDecoder(contentEncoding: string | undefined): Transform | null | "unsupported" {
  const normalized = contentEncoding?.trim().toLowerCase();
  if (normalized === undefined || normalized === "" || normalized === "identity") return null;
  if (normalized === "gzip" || normalized === "x-gzip") return createGunzip();
  if (normalized === "deflate") return createInflate();
  if (normalized === "br") return createBrotliDecompress();
  return "unsupported";
}

function validateOptions(options: SafeHttpClientOptions): Readonly<{
  fetchLimits: CrawlFetchLimits;
  pageContentTypes: ReadonlySet<string>;
  resolver: DnsResolver;
  userAgent: string;
}> {
  const fetchLimits = Object.freeze({ ...DEFAULT_FETCH_LIMITS, ...options.fetchLimits });
  const boundedTimeouts = [
    fetchLimits.connectTimeoutMs,
    fetchLimits.dnsTimeoutMs,
    fetchLimits.headersTimeoutMs,
    fetchLimits.idleTimeoutMs,
    fetchLimits.requestTimeoutMs,
  ];
  if (boundedTimeouts.some((value) => !Number.isInteger(value) || value < 100 || value > 60_000)) {
    throw new TypeError("Crawler network timeouts must be integers between 100 and 60000 ms.");
  }
  if (
    !Number.isInteger(fetchLimits.redirectLimit) ||
    fetchLimits.redirectLimit < 0 ||
    fetchLimits.redirectLimit > 10
  ) {
    throw new TypeError("Crawler redirectLimit must be between 0 and 10.");
  }
  if (
    !Number.isInteger(fetchLimits.maxResponseBytes) ||
    fetchLimits.maxResponseBytes < 1_024 ||
    fetchLimits.maxResponseBytes > 10 * 1_024 * 1_024 ||
    !Number.isInteger(fetchLimits.maxEncodedBytes) ||
    fetchLimits.maxEncodedBytes < 1_024 ||
    fetchLimits.maxEncodedBytes > 10 * 1_024 * 1_024 ||
    !Number.isInteger(fetchLimits.maxResponseHeaderBytes) ||
    fetchLimits.maxResponseHeaderBytes < 1_024 ||
    fetchLimits.maxResponseHeaderBytes > 64 * 1_024
  ) {
    throw new TypeError("Crawler response limits are outside the supported safety bounds.");
  }
  const userAgent = options.userAgent ?? SEARVIA_CRAWLER_USER_AGENT;
  const hasControl = [...userAgent].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (userAgent.length < 1 || userAgent.length > 256 || hasControl) {
    throw new TypeError("The crawler user agent is invalid.");
  }
  const requestedPageContentTypes = options.pageContentTypes ?? DEFAULT_PAGE_CONTENT_TYPES;
  const pageContentTypes = new Set(requestedPageContentTypes.map((value) => value.toLowerCase()));
  if (
    pageContentTypes.size === 0 ||
    pageContentTypes.size !== requestedPageContentTypes.length ||
    [...pageContentTypes].some((value) => !FETCHABLE_PAGE_CONTENT_TYPES.has(value))
  ) {
    throw new TypeError("The page content-type allowlist is invalid or unsupported.");
  }
  return Object.freeze({
    fetchLimits,
    pageContentTypes: Object.freeze(pageContentTypes),
    resolver: options.resolver ?? systemDnsResolver,
    userAgent,
  });
}

async function requestOnce(
  url: URL,
  kind: FetchKind,
  config: ReturnType<typeof validateOptions>,
  signal: AbortSignal | undefined,
  testCapability: TestNetworkCapability | undefined,
): Promise<InternalResponse> {
  const destination = await validateDestination(
    url,
    config.resolver,
    config.fetchLimits.dnsTimeoutMs,
    signal,
    testCapability,
  );
  throwIfAborted(signal);

  return new Promise<InternalResponse>((resolve, reject) => {
    const resources: RequestResources = {
      clientRequest: undefined,
      connectTimer: undefined,
      decoder: undefined,
      headersTimer: undefined,
      idleTimer: undefined,
      requestTimer: undefined,
      response: undefined,
    };
    let settled = false;
    const startedAt = performance.now();

    const clearTimers = (): void => {
      if (resources.connectTimer !== undefined) clearTimeout(resources.connectTimer);
      if (resources.headersTimer !== undefined) clearTimeout(resources.headersTimer);
      if (resources.idleTimer !== undefined) clearTimeout(resources.idleTimer);
      if (resources.requestTimer !== undefined) clearTimeout(resources.requestTimer);
    };
    const cleanup = (): void => {
      clearTimers();
      if (signal !== undefined) {
        signal.removeEventListener("abort", abortListener);
      }
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      const crawlError = classifyRequestError(error);
      resources.response?.destroy();
      resources.decoder?.destroy();
      if (resources.clientRequest?.destroyed !== true) {
        resources.clientRequest?.destroy(crawlError);
      }
      reject(crawlError);
    };
    const succeed = (value: InternalResponse): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Object.freeze(value));
    };

    const abortListener = (): void =>
      fail(
        signal?.reason instanceof CrawlError
          ? signal.reason
          : new CrawlError("cancelled", "The crawl was cancelled.", { cause: signal?.reason }),
      );
    signal?.addEventListener("abort", abortListener, { once: true });

    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    resources.clientRequest = transport(
      url,
      {
        agent: false,
        headers: {
          accept:
            kind === "page"
              ? "text/html,application/xhtml+xml;q=0.9"
              : kind === "robots"
                ? "text/plain;q=1.0,*/*;q=0.1"
                : "application/xml,text/xml;q=0.9,*/*;q=0.1",
          "accept-encoding": "gzip, deflate, br",
          "user-agent": config.userAgent,
        },
        lookup: createPinnedLookup(destination.addresses),
        maxHeaderSize: config.fetchLimits.maxResponseHeaderBytes,
        method: "GET",
        rejectUnauthorized: true,
        setHost: true,
        signal,
      },
      (incoming) => {
        resources.response = incoming;
        if (resources.headersTimer !== undefined) clearTimeout(resources.headersTimer);
        if (resources.connectTimer !== undefined) clearTimeout(resources.connectTimer);
        const ttfbMs = performance.now() - startedAt;
        const statusCode = incoming.statusCode ?? 0;
        const location =
          typeof incoming.headers.location === "string" ? incoming.headers.location : null;
        const headerEvidence = safeResponseHeaders(incoming.headers);
        const contentEncoding = normalizeContentEncoding(
          typeof incoming.headers["content-encoding"] === "string"
            ? incoming.headers["content-encoding"]
            : undefined,
        );
        const contentLength = declaredContentLength(
          typeof incoming.headers["content-length"] === "string"
            ? incoming.headers["content-length"]
            : undefined,
        );
        const contentType = normalizeContentType(incoming.headers["content-type"]);
        const retryAfterMs = retryAfterMilliseconds(
          typeof incoming.headers["retry-after"] === "string"
            ? incoming.headers["retry-after"]
            : undefined,
        );

        if (REDIRECT_STATUSES.has(statusCode)) {
          incoming.destroy();
          succeed({
            body: null,
            contentEncoding,
            contentLength,
            contentType,
            dnsMs: destination.dnsMs,
            downloadMs: 0,
            location,
            omittedResponseHeaders: headerEvidence.omitted,
            retryAfterMs,
            responseHeaders: headerEvidence.headers,
            responseBytes: 0,
            statusCode,
            ttfbMs,
            transferBytes: 0,
          });
          return;
        }

        const acceptedTypes =
          kind === "page" ? config.pageContentTypes : CONTENT_TYPES_BY_KIND[kind];
        const accepted = contentType !== null && acceptedTypes.has(contentType);
        if (!accepted) {
          incoming.destroy();
          succeed({
            body: null,
            contentEncoding,
            contentLength,
            contentType,
            dnsMs: destination.dnsMs,
            downloadMs: 0,
            location,
            omittedResponseHeaders: headerEvidence.omitted,
            retryAfterMs,
            responseHeaders: headerEvidence.headers,
            responseBytes: 0,
            statusCode,
            ttfbMs,
            transferBytes: 0,
          });
          return;
        }

        if (contentLength !== null && contentLength > config.fetchLimits.maxEncodedBytes) {
          fail(
            new CrawlError("response_too_large", "The response exceeded the encoded byte limit."),
          );
          return;
        }

        const selectedDecoder = createDecoder(
          typeof incoming.headers["content-encoding"] === "string"
            ? incoming.headers["content-encoding"]
            : undefined,
        );
        if (selectedDecoder === "unsupported") {
          fail(
            new CrawlError(
              "unsupported_content_encoding",
              "The response uses an unsupported content encoding.",
            ),
          );
          return;
        }

        let encodedBytes = 0;
        let decodedBytes = 0;
        const chunks: Buffer[] = [];
        const downloadStartedAt = performance.now();
        const resetIdleTimer = (): void => {
          if (resources.idleTimer !== undefined) clearTimeout(resources.idleTimer);
          resources.idleTimer = timer(
            () =>
              fail(
                new CrawlError("idle_timeout", "The response body became idle.", {
                  transient: true,
                }),
              ),
            config.fetchLimits.idleTimeoutMs,
          );
        };

        incoming.on("data", (chunk: Buffer) => {
          encodedBytes += chunk.byteLength;
          resetIdleTimer();
          if (encodedBytes > config.fetchLimits.maxEncodedBytes) {
            fail(
              new CrawlError("response_too_large", "The response exceeded the encoded byte limit."),
            );
          }
        });
        incoming.once("aborted", () => {
          fail(
            new CrawlError("network_error", "The remote server aborted the response.", {
              transient: true,
            }),
          );
        });
        incoming.once("error", fail);

        const bodyStream = selectedDecoder ?? incoming;
        if (selectedDecoder !== null) {
          resources.decoder = selectedDecoder;
          selectedDecoder.once("error", (error) => {
            fail(
              new CrawlError(
                "unsupported_content_encoding",
                "The compressed response could not be decoded.",
                { cause: error },
              ),
            );
          });
          incoming.pipe(selectedDecoder);
        }
        bodyStream.on("data", (chunk: Buffer) => {
          decodedBytes += chunk.byteLength;
          if (decodedBytes > config.fetchLimits.maxResponseBytes) {
            fail(
              new CrawlError("response_too_large", "The response exceeded the decoded byte limit."),
            );
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        bodyStream.once("end", () => {
          succeed({
            body: new Uint8Array(Buffer.concat(chunks, decodedBytes)),
            contentEncoding,
            contentLength,
            contentType,
            dnsMs: destination.dnsMs,
            downloadMs: performance.now() - downloadStartedAt,
            location,
            omittedResponseHeaders: headerEvidence.omitted,
            retryAfterMs,
            responseHeaders: headerEvidence.headers,
            responseBytes: decodedBytes,
            statusCode,
            ttfbMs,
            transferBytes: encodedBytes,
          });
        });
        resetIdleTimer();
      },
    );

    resources.connectTimer = timer(
      () =>
        fail(
          new CrawlError("connect_timeout", "Connecting to the remote server timed out.", {
            transient: true,
          }),
        ),
      config.fetchLimits.connectTimeoutMs,
    );
    resources.headersTimer = timer(
      () =>
        fail(
          new CrawlError("headers_timeout", "Waiting for response headers timed out.", {
            transient: true,
          }),
        ),
      config.fetchLimits.headersTimeoutMs,
    );
    resources.requestTimer = timer(
      () =>
        fail(
          new CrawlError("request_timeout", "The request deadline was exceeded.", {
            transient: true,
          }),
        ),
      config.fetchLimits.requestTimeoutMs,
    );
    resources.clientRequest.once("socket", (socket) => {
      if (!socket.connecting && resources.connectTimer !== undefined) {
        clearTimeout(resources.connectTimer);
      }
      socket.once("connect", () => {
        if (resources.connectTimer !== undefined) clearTimeout(resources.connectTimer);
      });
    });
    resources.clientRequest.once("error", fail);
    resources.clientRequest.end();
  });
}

export function createSafeHttpClientInternal(
  options: SafeHttpClientOptions = {},
  testCapability?: TestNetworkCapability,
): SafeHttpClient {
  const config = validateOptions(options);

  return Object.freeze({
    async fetch(request: SafeFetchRequest): Promise<SafeFetchResponse> {
      throwIfAborted(request.signal);
      const requestedUrl = request.url;
      const normalizedUrl = normalizeCrawlUrl(request.url);
      assertUrlInScope(normalizedUrl, request.scope);
      const redirects: RedirectHop[] = [];
      const seen = new Set([normalizedUrl]);
      let currentUrl = normalizedUrl;
      let currentRedirect: RedirectHop | null = null;
      let totalDnsMs = 0;
      let totalDownloadMs = 0;
      let totalTtfbMs = 0;
      const startedAtDate = new Date();
      const startedAt = performance.now();

      for (;;) {
        throwIfAborted(request.signal);
        const current = new URL(currentUrl);
        const operation = (): Promise<InternalResponse> =>
          requestOnce(current, request.kind, config, request.signal, testCapability);
        const response: InternalResponse =
          request.scheduleRequest === undefined
            ? await operation()
            : await request.scheduleRequest(
                Object.freeze({ redirect: currentRedirect, url: currentUrl }),
                operation,
              );
        totalDnsMs += response.dnsMs;
        totalDownloadMs += response.downloadMs;
        totalTtfbMs += response.ttfbMs;

        if (!REDIRECT_STATUSES.has(response.statusCode)) {
          return Object.freeze({
            body: response.body,
            contentEncoding: response.contentEncoding,
            contentLength: response.contentLength,
            contentType: response.contentType,
            finalUrl: currentUrl,
            normalizedUrl,
            omittedResponseHeaders: response.omittedResponseHeaders,
            redirectChain: Object.freeze([...redirects]),
            responseHeaders: response.responseHeaders,
            requestedUrl,
            responseBytes: response.responseBytes,
            retryAfterMs: response.retryAfterMs,
            statusCode: response.statusCode,
            timing: Object.freeze({
              dnsMs: totalDnsMs,
              downloadMs: totalDownloadMs,
              startedAt: startedAtDate.toISOString(),
              totalMs: performance.now() - startedAt,
              ttfbMs: totalTtfbMs,
            }),
            transferBytes: response.transferBytes,
          });
        }

        if (response.location === null) {
          throw new CrawlError(
            "invalid_redirect",
            "The redirect response did not include a Location header.",
          );
        }
        if (redirects.length >= config.fetchLimits.redirectLimit) {
          throw new CrawlError("redirect_limit", "The redirect limit was exceeded.");
        }

        let nextUrl: string;
        try {
          nextUrl = normalizeCrawlUrl(response.location, { baseUrl: currentUrl });
        } catch (error) {
          throw new CrawlError("invalid_redirect", "The redirect target is invalid.", {
            cause: error,
          });
        }
        assertUrlInScope(nextUrl, request.scope);
        const next = new URL(nextUrl);
        if (current.protocol === "https:" && next.protocol === "http:") {
          throw new CrawlError("https_downgrade", "HTTPS redirects cannot downgrade to HTTP.");
        }
        if (seen.has(nextUrl)) {
          throw new CrawlError("redirect_loop", "The redirect chain contains a loop.");
        }
        seen.add(nextUrl);
        const redirect: RedirectHop = Object.freeze({
          fromUrl: currentUrl,
          statusCode: response.statusCode,
          toUrl: nextUrl,
        });
        await request.authorizeRedirect?.(redirect);
        redirects.push(redirect);
        currentUrl = nextUrl;
        currentRedirect = redirect;
      }
    },
  });
}

export function createSafeHttpClient(options: SafeHttpClientOptions = {}): SafeHttpClient {
  return createSafeHttpClientInternal(options);
}

export function isRetryableHttpStatus(statusCode: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(statusCode);
}

export function normalizeSafeHttpError(error: unknown): CrawlError {
  return toCrawlError(error);
}
