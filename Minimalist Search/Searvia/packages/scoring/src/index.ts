import type { AuditResultStatus } from "@searvia/shared-types";

export interface WeightedAuditResult {
  readonly status: AuditResultStatus;
  readonly weight: number;
}

export interface ScoreCoverage {
  readonly observedWeight: number;
  readonly excludedNotCheckedWeight: number;
  readonly excludedManualReviewWeight: number;
  readonly totalWeight: number;
}

/**
 * Establishes the denominator rule without inventing a Phase 1 scoring formula.
 * Not-checked and manual-review results are excluded from objective score denominators. Neither is
 * evidence of a pass, and a human-review request cannot improve or reduce the objective score.
 */
export function calculateScoreCoverage(results: readonly WeightedAuditResult[]): ScoreCoverage {
  let observedWeight = 0;
  let excludedNotCheckedWeight = 0;
  let excludedManualReviewWeight = 0;

  for (const result of results) {
    if (!Number.isFinite(result.weight) || result.weight < 0) {
      throw new RangeError("Audit result weights must be finite and non-negative.");
    }

    if (result.status === "not-checked") {
      excludedNotCheckedWeight += result.weight;
    } else if (result.status === "manual-review") {
      excludedManualReviewWeight += result.weight;
    } else {
      observedWeight += result.weight;
    }
  }

  return Object.freeze({
    observedWeight,
    excludedNotCheckedWeight,
    excludedManualReviewWeight,
    totalWeight: observedWeight + excludedNotCheckedWeight + excludedManualReviewWeight,
  });
}

export const scoringFoundation = Object.freeze({
  milestone: "M5-partial",
  scoreFormulaState: "not-defined",
  reason:
    "Objective-score coverage excludes Not Checked and Manual Review; the scoring formula and aggregates are not implemented.",
});
