import type { RuntimeEnvironment } from "@searvia/shared-types";
import type { z } from "zod";

export interface EnvironmentIssue {
  readonly path: string;
  readonly message: string;
}

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export class EnvironmentValidationError extends Error {
  readonly service: string;
  readonly issues: readonly EnvironmentIssue[];

  constructor(service: string, issues: readonly EnvironmentIssue[]) {
    const summary = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");

    super(`Invalid environment for ${service}: ${summary}`);
    this.name = "EnvironmentValidationError";
    this.service = service;
    this.issues = Object.freeze([...issues]);
  }
}

export function environmentIssues(error: z.ZodError): readonly EnvironmentIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "environment",
    message: issue.message,
  }));
}

export function requiredProductionIssue(
  name: string,
  value: string | undefined,
): EnvironmentIssue | undefined {
  return value === undefined ? { path: name, message: "Required in production." } : undefined;
}

export function isProduction(environment: RuntimeEnvironment): boolean {
  return environment === "production";
}
