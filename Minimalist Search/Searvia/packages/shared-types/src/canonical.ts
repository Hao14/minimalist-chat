export const CANONICAL_NORMALIZATION_FAILURE_CODES = [
  "empty_url",
  "invalid_url",
  "userinfo_not_allowed",
  "unsupported_protocol",
] as const;

export type CanonicalNormalizationFailureCode =
  (typeof CANONICAL_NORMALIZATION_FAILURE_CODES)[number];

export interface CanonicalNormalizationFailure {
  readonly code: CanonicalNormalizationFailureCode;
}
