import "server-only";

import { randomUUID } from "node:crypto";

import { parseServerEnvironment } from "@searvia/config/server";
import {
  createOpaqueRateLimitKey,
  DatabaseDomainError,
  type OrganizationScope,
} from "@searvia/database/runtime";
import { createServiceLogger, toSafeErrorMetadata } from "@searvia/logging";

import { getSearviaCrawlRepository, getSearviaRepository } from "./database";
import { getAuthenticatedSession } from "./session";
import { trustedApplicationOrigins } from "./auth-policy";

import type { CrawlApiDependencies } from "./crawl-api-handlers";

function trustedMutationOrigins(): readonly string[] {
  const environment = parseServerEnvironment(process.env);
  const production = environment.appEnv === "production" || environment.nodeEnv === "production";
  return trustedApplicationOrigins(environment.appUrl, production);
}

export function getCrawlApiDependencies(): CrawlApiDependencies {
  const environment = parseServerEnvironment(process.env);
  const applicationRepository = getSearviaRepository();
  const crawlRepository = getSearviaCrawlRepository();
  const logger = createServiceLogger({
    service: "web",
    environment: environment.nodeEnv,
    level: environment.nodeEnv === "test" ? "silent" : "info",
  });

  return {
    trustedMutationOrigins: trustedMutationOrigins(),
    generateTraceId: randomUUID,
    getSession: getAuthenticatedSession,
    loadScope: (userId, sessionId) =>
      applicationRepository.loadActiveOrganizationScope(userId, sessionId),
    repository: {
      async createCrawl(
        scope: OrganizationScope,
        projectId: string,
        input: Readonly<{ idempotencyKey: string; traceId: string }>,
      ) {
        const rateLimit = await applicationRepository.consumeRateLimit({
          key: createOpaqueRateLimitKey([
            "crawl-start",
            scope.organization.id,
            scope.membership.id,
          ]),
          max: 20,
          windowMs: 60_000,
        });
        if (!rateLimit.allowed) {
          throw new DatabaseDomainError("RATE_LIMITED", "The crawl start rate limit was reached.");
        }
        return crawlRepository.createCrawl(scope, projectId, input);
      },
      listCrawls: (scope, projectId, limit) => crawlRepository.listCrawls(scope, projectId, limit),
      getCrawl: (scope, projectId, crawlId) => crawlRepository.getCrawl(scope, projectId, crawlId),
      listCrawlPages: (scope, projectId, crawlId, input) =>
        crawlRepository.listCrawlPages(scope, projectId, crawlId, {
          ...(input?.limit === undefined ? {} : { limit: input.limit }),
          ...(input?.cursor === undefined
            ? {}
            : {
                cursor:
                  input.cursor === null
                    ? null
                    : {
                        organizationId: scope.organization.id,
                        projectId,
                        ...input.cursor,
                      },
              }),
        }),
      getCrawlPage: (scope, projectId, crawlId, pageId) =>
        crawlRepository.getCrawlPage(scope, projectId, crawlId, pageId),
      requestCancellation: (scope, projectId, crawlId, traceId) =>
        crawlRepository.requestCancellation(scope, projectId, crawlId, traceId),
    },
    onUnexpectedError(error, traceId) {
      logger.error(
        {
          event: "crawl.api.failed",
          traceId,
          ...toSafeErrorMetadata(error),
        },
        "A crawl API request failed unexpectedly.",
      );
    },
  };
}
