export const CRAWL_ERROR_CODES = [
  "invalid_url",
  "unsupported_protocol",
  "userinfo_not_allowed",
  "invalid_hostname",
  "unsafe_port",
  "blocked_hostname",
  "blocked_address",
  "dns_failure",
  "dns_timeout",
  "out_of_scope",
  "https_downgrade",
  "invalid_redirect",
  "redirect_loop",
  "redirect_limit",
  "connect_timeout",
  "headers_timeout",
  "idle_timeout",
  "request_timeout",
  "response_too_large",
  "unsupported_content_encoding",
  "unsupported_content_type",
  "network_error",
  "robots_unreachable",
  "robots_disallowed",
  "crawl_limit",
  "parse_error",
  "cancelled",
] as const;

export type CrawlErrorCode = (typeof CRAWL_ERROR_CODES)[number];

export interface CrawlErrorOptions {
  readonly cause?: unknown;
  readonly transient?: boolean;
}

export class CrawlError extends Error {
  readonly code: CrawlErrorCode;
  readonly transient: boolean;

  constructor(code: CrawlErrorCode, message: string, options: CrawlErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CrawlError";
    this.code = code;
    this.transient = options.transient ?? false;
  }
}

export function isCrawlError(error: unknown): error is CrawlError {
  return error instanceof CrawlError;
}

export function toCrawlError(error: unknown): CrawlError {
  if (isCrawlError(error)) return error;

  return new CrawlError("network_error", "The remote server could not be reached.", {
    cause: error,
    transient: true,
  });
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    if (signal.reason instanceof CrawlError) throw signal.reason;
    throw new CrawlError("cancelled", "The crawl was cancelled.", { cause: signal.reason });
  }
}
