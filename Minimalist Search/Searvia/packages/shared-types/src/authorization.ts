import { z } from "zod";

export const ORGANIZATION_ROLES = ["owner", "admin", "analyst", "viewer", "client"] as const;

export const organizationRoleSchema = z.enum(ORGANIZATION_ROLES);

export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const ORGANIZATION_CAPABILITIES = [
  "organization:read",
  "organization:update",
  "organization:delete",
  "team:read",
  "team:invite",
  "team:manage",
  "ownership:transfer",
  "project:list",
  "project:read",
  "project:create",
  "project:update",
  "crawl-config:update",
  "crawl:read",
  "crawl:start",
  "crawl:cancel",
  "audit:read",
] as const;

export const organizationCapabilitySchema = z.enum(ORGANIZATION_CAPABILITIES);

export type OrganizationCapability = z.infer<typeof organizationCapabilitySchema>;

const CAPABILITIES_BY_ROLE = {
  owner: new Set<OrganizationCapability>(ORGANIZATION_CAPABILITIES),
  admin: new Set<OrganizationCapability>([
    "organization:read",
    "organization:update",
    "team:read",
    "team:invite",
    "team:manage",
    "project:list",
    "project:read",
    "project:create",
    "project:update",
    "crawl-config:update",
    "crawl:read",
    "crawl:start",
    "crawl:cancel",
    "audit:read",
  ]),
  analyst: new Set<OrganizationCapability>([
    "organization:read",
    "project:list",
    "project:read",
    "project:create",
    "project:update",
    "crawl-config:update",
    "crawl:read",
    "crawl:start",
    "crawl:cancel",
  ]),
  viewer: new Set<OrganizationCapability>([
    "organization:read",
    "project:list",
    "project:read",
    "crawl:read",
  ]),
  client: new Set<OrganizationCapability>(["project:list", "project:read", "crawl:read"]),
} satisfies Record<OrganizationRole, ReadonlySet<OrganizationCapability>>;

/**
 * Returns only the coarse role grant. Client project reads must additionally
 * prove a row in membership_project_scopes.
 */
export function roleHasCapability(
  role: OrganizationRole,
  capability: OrganizationCapability,
): boolean {
  return CAPABILITIES_BY_ROLE[role].has(capability);
}

export function roleRequiresProjectScope(role: OrganizationRole): boolean {
  return role === "client";
}

export function canManageRole(
  actorRole: OrganizationRole,
  targetRole: OrganizationRole,
  nextRole: OrganizationRole,
): boolean {
  if (actorRole === "owner") {
    return nextRole !== "owner" && targetRole !== "owner";
  }

  if (actorRole === "admin") {
    return (
      targetRole !== "owner" &&
      targetRole !== "admin" &&
      nextRole !== "owner" &&
      nextRole !== "admin"
    );
  }

  return false;
}
