import { DatabaseDomainError, type OnboardingResult } from "@searvia/database/runtime";
import { describe, expect, it, vi } from "vitest";

import { executeOnboardingAction } from "./project-action-service";

function validForm(): FormData {
  const formData = new FormData();
  formData.set("organizationName", "Acme Search");
  formData.set("projectName", "Main site");
  formData.set("website", "example.com/path");
  formData.set("pageLimit", "50");
  formData.set("maxDepth", "3");
  formData.set("queryPolicy", "ignore_tracking");
  return formData;
}

describe("onboarding action service", () => {
  it("passes authenticated IDs and normalized input to the repository", async () => {
    const create = vi.fn(async (): Promise<OnboardingResult> => ({
      organizationId: "organization-1",
      membershipId: "membership-1",
      projectId: "project-1",
    }));

    const result = await executeOnboardingAction(validForm(), {
      userId: "user-1",
      sessionId: "session-1",
      traceId: () => "trace-12345678",
      create,
    });

    expect(result).toEqual({ success: true, projectId: "project-1" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: "session-1",
        traceId: "trace-12345678",
        organizationName: "Acme Search",
        target: expect.objectContaining({ origin: "https://example.com" }),
      }),
    );
  });

  it("does not call the repository when validation fails", async () => {
    const formData = validForm();
    formData.set("website", "file:///etc/passwd");
    const create = vi.fn(async (): Promise<OnboardingResult> => {
      throw new Error("must not run");
    });

    const result = await executeOnboardingAction(formData, {
      userId: "user-1",
      sessionId: "session-1",
      traceId: () => "trace-12345678",
      create,
    });

    expect(result).toMatchObject({
      success: false,
      state: { fieldErrors: { website: expect.any(String) } },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns a permission-safe error for a rejected tenant action", async () => {
    const create = vi.fn(async (): Promise<OnboardingResult> => {
      throw new DatabaseDomainError("FORBIDDEN", "internal role detail");
    });

    const result = await executeOnboardingAction(validForm(), {
      userId: "user-1",
      sessionId: "session-1",
      traceId: () => "trace-12345678",
      create,
    });

    expect(result).toEqual({
      success: false,
      state: {
        status: "error",
        message: "You do not have permission to create a project.",
        fieldErrors: {},
      },
    });
  });
});
