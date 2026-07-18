export interface SessionIdentity {
  readonly user: Readonly<{ id: string }>;
  readonly session: Readonly<{ id: string }>;
}

export interface OrganizationScopeLoader<TScope> {
  loadActiveOrganizationScope(userId: string, sessionId: string): Promise<TScope | null>;
}

export async function loadSessionContext<TSession extends SessionIdentity, TScope>(
  session: TSession,
  repository: OrganizationScopeLoader<TScope>,
): Promise<Readonly<{ session: TSession; scope: TScope | null }>> {
  const scope = await repository.loadActiveOrganizationScope(session.user.id, session.session.id);
  return Object.freeze({ session, scope });
}
