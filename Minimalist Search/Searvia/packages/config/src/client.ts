import { runtimeEnvironmentSchema, type RuntimeEnvironment } from "@searvia/shared-types";
import { z } from "zod";

import {
  EnvironmentValidationError,
  environmentIssues,
  type EnvironmentSource,
  isProduction,
  requiredProductionIssue,
} from "./environment.js";

const LOCAL_APP_URL = "http://localhost:3000";

const publicUrlSchema = z
  .url()
  .refine((value) => /^https?:$/.test(new URL(value).protocol), "Must use HTTP or HTTPS.")
  .refine((value) => {
    const parsed = new URL(value);
    return (
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.username === "" &&
      parsed.password === ""
    );
  }, "Must be an origin without a path, credentials, query, or fragment.")
  .transform((value) => new URL(value).origin);

const clientEnvironmentInputSchema = z.object({
  NODE_ENV: runtimeEnvironmentSchema.default("development"),
  NEXT_PUBLIC_APP_URL: publicUrlSchema.optional(),
  NEXT_PUBLIC_SITE_URL: publicUrlSchema.optional(),
});

export interface ClientEnvironment {
  readonly nodeEnv: RuntimeEnvironment;
  readonly appUrl: string;
  readonly siteUrl: string;
}

/**
 * Parse only values deliberately exposed to browser bundles. Callers should pass
 * an object containing explicit NEXT_PUBLIC_* properties so bundlers can replace
 * them statically; this module never reads process.env.
 */
export function parseClientEnvironment(source: EnvironmentSource): ClientEnvironment {
  const result = clientEnvironmentInputSchema.safeParse(source);

  if (!result.success) {
    throw new EnvironmentValidationError("web-client", environmentIssues(result.error));
  }

  if (isProduction(result.data.NODE_ENV)) {
    const issues = [
      requiredProductionIssue("NEXT_PUBLIC_APP_URL", result.data.NEXT_PUBLIC_APP_URL),
      requiredProductionIssue("NEXT_PUBLIC_SITE_URL", result.data.NEXT_PUBLIC_SITE_URL),
    ].filter((issue) => issue !== undefined);

    if (issues.length > 0) {
      throw new EnvironmentValidationError("web-client", issues);
    }
  }

  return Object.freeze({
    nodeEnv: result.data.NODE_ENV,
    appUrl: result.data.NEXT_PUBLIC_APP_URL ?? LOCAL_APP_URL,
    siteUrl: result.data.NEXT_PUBLIC_SITE_URL ?? LOCAL_APP_URL,
  });
}
