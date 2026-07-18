import "server-only";

import type { OrganizationScope } from "@searvia/database/runtime";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuth, type AuthSession } from "@/lib/auth";
import { getSearviaRepository } from "@/lib/database";
import { loadSessionContext } from "@/lib/session-context";

export const getAuthenticatedSession = cache(async (): Promise<AuthSession | null> => {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

export async function requireAuthenticatedSession(): Promise<AuthSession> {
  const session = await getAuthenticatedSession();

  if (session === null) {
    redirect("/login");
  }

  return session;
}

export const getSessionContext = cache(async () => {
  const session = await requireAuthenticatedSession();
  return loadSessionContext(session, getSearviaRepository());
});

export async function requireOrganizationScope(): Promise<{
  readonly session: AuthSession;
  readonly scope: OrganizationScope;
}> {
  const context = await getSessionContext();

  if (context.scope === null) {
    redirect("/app/onboarding");
  }

  return { session: context.session, scope: context.scope };
}
