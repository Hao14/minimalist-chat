import { describe, expect, it } from "vitest";

import {
  canManageRole,
  ORGANIZATION_ROLES,
  roleHasCapability,
  roleRequiresProjectScope,
} from "../src/index.js";

describe("organization role authorization", () => {
  it("defines all five required roles", () => {
    expect(ORGANIZATION_ROLES).toEqual(["owner", "admin", "analyst", "viewer", "client"]);
  });

  it("applies least-privilege project and team capabilities", () => {
    expect(roleHasCapability("owner", "ownership:transfer")).toBe(true);
    expect(roleHasCapability("admin", "team:invite")).toBe(true);
    expect(roleHasCapability("analyst", "project:create")).toBe(true);
    expect(roleHasCapability("viewer", "project:create")).toBe(false);
    expect(roleHasCapability("client", "project:read")).toBe(true);
    expect(roleHasCapability("client", "organization:read")).toBe(false);
    expect(roleHasCapability("owner", "crawl:start")).toBe(true);
    expect(roleHasCapability("admin", "crawl:cancel")).toBe(true);
    expect(roleHasCapability("analyst", "crawl:start")).toBe(true);
    expect(roleHasCapability("viewer", "crawl:read")).toBe(true);
    expect(roleHasCapability("viewer", "crawl:start")).toBe(false);
    expect(roleHasCapability("client", "crawl:read")).toBe(true);
    expect(roleHasCapability("client", "crawl:cancel")).toBe(false);
  });

  it("marks Client access as requiring a project scope", () => {
    expect(roleRequiresProjectScope("client")).toBe(true);
    expect(roleRequiresProjectScope("viewer")).toBe(false);
  });

  it("prevents admins from managing owners or peer admins", () => {
    expect(canManageRole("admin", "analyst", "viewer")).toBe(true);
    expect(canManageRole("admin", "admin", "viewer")).toBe(false);
    expect(canManageRole("admin", "viewer", "admin")).toBe(false);
    expect(canManageRole("owner", "admin", "analyst")).toBe(true);
    expect(canManageRole("owner", "owner", "admin")).toBe(false);
  });
});
