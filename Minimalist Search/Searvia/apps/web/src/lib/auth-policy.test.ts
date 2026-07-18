import { describe, expect, it } from "vitest";

import {
  AUTH_GENERIC_ERROR,
  authCookiePolicy,
  isProtectedApplicationPath,
  loginRedirectPath,
  safeApplicationReturnTo,
  trustedApplicationOrigins,
} from "./auth-policy";

describe("authentication policy", () => {
  it("uses host-only secure production cookie attributes", () => {
    expect(authCookiePolicy(true)).toEqual({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
    expect(authCookiePolicy(true)).not.toHaveProperty("domain");
  });

  it("allows insecure cookies only for non-production HTTP development", () => {
    expect(authCookiePolicy(false).secure).toBe(false);
  });

  it("uses one generic client-visible authentication failure", () => {
    expect(AUTH_GENERIC_ERROR).not.toMatch(/email exists|account found|not registered/iu);
  });

  it("accepts equivalent loopback origins only outside production", () => {
    expect(trustedApplicationOrigins("http://localhost:3000", false)).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]);
    expect(trustedApplicationOrigins("https://searvia.online", true)).toEqual([
      "https://searvia.online",
    ]);
  });
});

describe("protected application routing", () => {
  it.each(["/app", "/app/projects", "/app/settings/team"])("protects %s", (pathname) => {
    expect(isProtectedApplicationPath(pathname)).toBe(true);
  });

  it.each(["/", "/login", "/application", "/api/auth/get-session"])(
    "does not classify %s as an application page",
    (pathname) => {
      expect(isProtectedApplicationPath(pathname)).toBe(false);
    },
  );

  it("preserves a protected return path in the login redirect", () => {
    expect(loginRedirectPath("/app/projects", "?sort=new")).toBe(
      "/login?returnTo=%2Fapp%2Fprojects%3Fsort%3Dnew",
    );
  });

  it.each(["https://attacker.example/app", "//attacker.example/app", "/login", "/app\\projects"])(
    "rejects unsafe return destination %s",
    (destination) => {
      expect(safeApplicationReturnTo(destination)).toBe("/app");
    },
  );

  it("accepts a same-origin application destination", () => {
    expect(safeApplicationReturnTo("/app/projects?view=all")).toBe("/app/projects?view=all");
  });
});
