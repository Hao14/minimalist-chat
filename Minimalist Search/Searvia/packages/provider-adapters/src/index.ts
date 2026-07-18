import type { IntegrationAvailability } from "@searvia/shared-types";

export type ProviderCapability =
  "search-console" | "rank-tracking" | "backlinks" | "ai-answer-monitoring";

export interface ProviderAdapterDescriptor {
  readonly id: string;
  readonly capability: ProviderCapability;
  readonly availability: IntegrationAvailability;
}

export function unavailableProviderAdapter(
  id: string,
  capability: ProviderCapability,
  reason: string,
  setupAction?: string,
): ProviderAdapterDescriptor {
  return Object.freeze({
    id,
    capability,
    availability: Object.freeze({
      state: "not-implemented" as const,
      reason,
      ...(setupAction === undefined ? {} : { setupAction }),
    }),
  });
}

export const providerAdaptersFoundation = Object.freeze({
  milestone: "M0",
  liveAdapters: 0,
  reason: "Provider integrations are not part of the repository foundation.",
});
