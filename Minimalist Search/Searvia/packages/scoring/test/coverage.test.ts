import { describe, expect, it } from "vitest";

import { calculateScoreCoverage } from "../src/index.js";

describe("score coverage", () => {
  it("excludes not-checked and manual-review weight without treating either as passed", () => {
    expect(
      calculateScoreCoverage([
        { status: "passed", weight: 2 },
        { status: "failed", weight: 3 },
        { status: "not-checked", weight: 5 },
        { status: "manual-review", weight: 7 },
      ]),
    ).toEqual({
      observedWeight: 5,
      excludedNotCheckedWeight: 5,
      excludedManualReviewWeight: 7,
      totalWeight: 17,
    });
  });

  it("rejects invalid weights", () => {
    expect(() => calculateScoreCoverage([{ status: "passed", weight: -1 }])).toThrowError(
      RangeError,
    );
  });
});
