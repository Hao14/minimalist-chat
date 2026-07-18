import { describe, expect, it, vi } from "vitest";

import { loadSessionContext } from "./session-context";

describe("session context", () => {
  it("loads organization scope from the authenticated user and session IDs", async () => {
    const scope = { organizationId: "organization-1", role: "owner" } as const;
    const loadActiveOrganizationScope = vi.fn(async () => scope);
    const session = {
      user: { id: "user-1", email: "person@example.com" },
      session: { id: "session-1" },
    } as const;

    const context = await loadSessionContext(session, { loadActiveOrganizationScope });

    expect(loadActiveOrganizationScope).toHaveBeenCalledWith("user-1", "session-1");
    expect(context).toEqual({ session, scope });
  });

  it("keeps a null scope for a signed-in user who still needs onboarding", async () => {
    const loadActiveOrganizationScope = vi.fn(async () => null);
    const session = { user: { id: "user-2" }, session: { id: "session-2" } } as const;

    await expect(loadSessionContext(session, { loadActiveOrganizationScope })).resolves.toEqual({
      session,
      scope: null,
    });
  });
});
