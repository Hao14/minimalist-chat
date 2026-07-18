const LOWERCASE_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const AUDIT_TARGET_HASH_PARAMETER = "__searvia_detail_sha256";

/**
 * Produces the only page URL identity that may leave the audit engine.
 *
 * The caller must supply the SHA-256 already persisted for the crawl page. This
 * keeps URL secrets out of the audit layer while preserving a stable identity
 * for query/fragment variants. User-info is treated as sensitive defensively,
 * even though crawler input validation rejects it before persistence.
 */
export function privacySafeAuditPageUrl(normalizedUrl: string, precomputedUrlHash: string): string {
  if (!LOWERCASE_SHA256_PATTERN.test(precomputedUrlHash)) {
    throw new TypeError(
      "The crawl page URL hash must be a lowercase 64-character SHA-256 hex value.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    throw new TypeError("The crawl page normalized URL must be an absolute HTTP(S) URL.");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.hostname === "") {
    throw new TypeError("The crawl page normalized URL must be an absolute HTTP(S) URL.");
  }

  const hasSensitiveDetails =
    parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "";
  if (!hasSensitiveDetails) return normalizedUrl;

  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  parsed.searchParams.set(AUDIT_TARGET_HASH_PARAMETER, precomputedUrlHash);
  return parsed.href;
}
