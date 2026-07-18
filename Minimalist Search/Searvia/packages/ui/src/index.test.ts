import { describe, expect, it } from "vitest";

import { FoundationStatus } from "./index.js";

describe("@searvia/ui", () => {
  it("exports the accessible foundation status primitive", () => {
    expect(FoundationStatus).toBeTypeOf("function");
  });
});
