export const PROJECT_ORIGIN_ERROR_CODES = [
  "empty",
  "too-long",
  "unsupported-protocol",
  "userinfo-not-allowed",
  "invalid-url",
  "invalid-hostname",
] as const;

export type ProjectOriginErrorCode = (typeof PROJECT_ORIGIN_ERROR_CODES)[number];

export class ProjectOriginValidationError extends Error {
  readonly code: ProjectOriginErrorCode;

  constructor(code: ProjectOriginErrorCode, message: string) {
    super(message);
    this.name = "ProjectOriginValidationError";
    this.code = code;
  }
}

export interface NormalizedProjectOrigin {
  readonly hostname: string;
  readonly origin: string;
  readonly port: string | null;
  readonly protocol: "http:" | "https:";
}

export interface ProjectOriginNormalizer {
  normalize(input: string): NormalizedProjectOrigin;
}

/**
 * M2 will implement this network-aware boundary. M1 deliberately returns only
 * a syntactically normalized candidate and performs no DNS or HTTP operation.
 */
export interface CrawlTargetValidator {
  validate(target: NormalizedProjectOrigin): Promise<NormalizedProjectOrigin>;
}

const MAX_PROJECT_ORIGIN_INPUT_LENGTH = 2_048;
const EXPLICIT_SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const HTTP_SCHEME_WITH_AUTHORITY = /^https?:\/\//iu;
const CONTROL_OR_AMBIGUOUS_CHARACTER = /[\p{Cc}\\\s]/u;
const IPV4_HOSTNAME = /^(?:\d{1,3}\.){3}\d{1,3}$/u;

function isIpv6Hostname(hostname: string): boolean {
  return hostname.startsWith("[") && hostname.endsWith("]");
}

function normalizeDnsHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");

  if (normalized.length === 0 || normalized.length > 253) {
    throw new ProjectOriginValidationError(
      "invalid-hostname",
      "Enter a URL with a valid hostname.",
    );
  }

  if (IPV4_HOSTNAME.test(normalized)) {
    throw new ProjectOriginValidationError(
      "invalid-hostname",
      "Enter a website domain rather than an IP address.",
    );
  }

  const labels = normalized.split(".");

  if (labels.length < 2) {
    throw new ProjectOriginValidationError(
      "invalid-hostname",
      "Enter a complete website hostname, such as example.com.",
    );
  }

  const labelPattern = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/u;

  if (labels.some((label) => !labelPattern.test(label))) {
    throw new ProjectOriginValidationError(
      "invalid-hostname",
      "Enter a URL with a valid hostname.",
    );
  }

  return normalized;
}

export function normalizeProjectOrigin(input: string): NormalizedProjectOrigin {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    throw new ProjectOriginValidationError("empty", "Enter a website domain or URL.");
  }

  if (trimmed.length > MAX_PROJECT_ORIGIN_INPUT_LENGTH) {
    throw new ProjectOriginValidationError("too-long", "The website URL is too long.");
  }

  if (CONTROL_OR_AMBIGUOUS_CHARACTER.test(trimmed) || trimmed.startsWith("//")) {
    throw new ProjectOriginValidationError("invalid-url", "Enter a valid website URL.");
  }

  const hasExplicitScheme = EXPLICIT_SCHEME.test(trimmed);

  if (hasExplicitScheme && !HTTP_SCHEME_WITH_AUTHORITY.test(trimmed)) {
    const protocol = trimmed.slice(0, trimmed.indexOf(":") + 1).toLowerCase();

    if (protocol !== "http:" && protocol !== "https:") {
      throw new ProjectOriginValidationError(
        "unsupported-protocol",
        "Website URLs must use HTTP or HTTPS.",
      );
    }

    throw new ProjectOriginValidationError("invalid-url", "Enter a valid website URL.");
  }

  const candidate = hasExplicitScheme ? trimmed : `https://${trimmed}`;
  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new ProjectOriginValidationError("invalid-url", "Enter a valid website URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProjectOriginValidationError(
      "unsupported-protocol",
      "Website URLs must use HTTP or HTTPS.",
    );
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new ProjectOriginValidationError(
      "userinfo-not-allowed",
      "Website URLs cannot contain a username or password.",
    );
  }

  if (parsed.hostname === "") {
    throw new ProjectOriginValidationError(
      "invalid-hostname",
      "Enter a URL with a valid hostname.",
    );
  }

  if (isIpv6Hostname(parsed.hostname)) {
    throw new ProjectOriginValidationError(
      "invalid-hostname",
      "Enter a website domain rather than an IP address.",
    );
  }

  const hostname = normalizeDnsHostname(parsed.hostname);
  const protocol = parsed.protocol;
  const port = parsed.port === "" ? null : parsed.port;
  const authority = `${hostname}${port === null ? "" : `:${port}`}`;
  const origin = `${protocol}//${authority}`;

  return Object.freeze({ hostname, origin, port, protocol });
}
