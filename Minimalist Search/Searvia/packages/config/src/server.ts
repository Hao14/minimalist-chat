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
export const LOCAL_DEVELOPMENT_AUTH_SECRET =
  "searvia-local-development-only-auth-secret-not-for-production-2026";
const LOCAL_DATABASE_URL =
  "postgresql://searvia:searvia_postgres_local_only@localhost:5432/searvia";
const LOCAL_OBJECT_STORAGE = {
  endpoint: "http://localhost:9000",
  region: "us-west-2",
  bucket: "searvia-local",
  accessKey: "searvia",
  secretKey: "searvia_minio_local_only",
} as const;

const httpUrlSchema = z
  .url()
  .refine((value) => /^https?:$/.test(new URL(value).protocol), "Must use HTTP or HTTPS.");

const httpOriginSchema = httpUrlSchema
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

const booleanStringSchema = z.enum(["true", "false"]).transform((value) => value === "true");

const databaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, context) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
        context.addIssue({
          code: "custom",
          message: "Must use the postgres:// or postgresql:// protocol.",
        });
      }
    } catch {
      context.addIssue({ code: "custom", message: "Must be a valid database URL." });
    }
  });

const serverEnvironmentInputSchema = z
  .object({
    NODE_ENV: runtimeEnvironmentSchema.default("development"),
    APP_ENV: runtimeEnvironmentSchema.optional(),
    APP_URL: httpOriginSchema.optional(),
    BETTER_AUTH_SECRET: z.string().min(32).max(256).optional(),
    DATABASE_URL: databaseUrlSchema.optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(10_000),
    DATABASE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(15_000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(15_000),
    OBJECT_STORAGE_ENDPOINT: httpUrlSchema.optional(),
    OBJECT_STORAGE_REGION: z.string().trim().min(1).optional(),
    OBJECT_STORAGE_BUCKET: z.string().trim().min(1).optional(),
    OBJECT_STORAGE_ACCESS_KEY: z.string().trim().min(1).optional(),
    OBJECT_STORAGE_SECRET_KEY: z.string().trim().min(1).optional(),
    OBJECT_STORAGE_FORCE_PATH_STYLE: booleanStringSchema.default(true),
    SEARVIA_ENABLE_DEV_SEED: booleanStringSchema.default(false),
    SEARVIA_DEV_SEED_EMAIL: z
      .email()
      .transform((value) => value.toLowerCase())
      .optional(),
    SEARVIA_DEV_SEED_PASSWORD: z.string().min(12).max(128).optional(),
  })
  .superRefine((value, context) => {
    const appEnvironment = value.APP_ENV ?? value.NODE_ENV;

    if (value.SEARVIA_ENABLE_DEV_SEED && appEnvironment === "production") {
      context.addIssue({
        code: "custom",
        path: ["SEARVIA_ENABLE_DEV_SEED"],
        message: "Development seed data cannot be enabled in production.",
      });
    }

    if (value.SEARVIA_ENABLE_DEV_SEED && value.SEARVIA_DEV_SEED_PASSWORD === undefined) {
      context.addIssue({
        code: "custom",
        path: ["SEARVIA_DEV_SEED_PASSWORD"],
        message: "Required when the development seed is enabled.",
      });
    }
  });

export interface ServerEnvironment {
  readonly nodeEnv: RuntimeEnvironment;
  readonly appEnv: RuntimeEnvironment;
  readonly appUrl: string;
  readonly authSecret: string;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly databaseConnectionTimeoutMs: number;
  readonly databaseIdleTimeoutMs: number;
  readonly databaseQueryTimeoutMs: number;
  readonly databaseStatementTimeoutMs: number;
  readonly objectStorageEndpoint: string;
  readonly objectStorageRegion: string;
  readonly objectStorageBucket: string;
  readonly objectStorageAccessKey: string;
  readonly objectStorageSecretKey: string;
  readonly objectStorageForcePathStyle: boolean;
  readonly developmentSeedEnabled: boolean;
  readonly developmentSeedEmail: string;
  readonly developmentSeedPassword: string | undefined;
}

export function parseServerEnvironment(source: EnvironmentSource = process.env): ServerEnvironment {
  const result = serverEnvironmentInputSchema.safeParse(source);

  if (!result.success) {
    throw new EnvironmentValidationError("web-server", environmentIssues(result.error));
  }

  const appEnv = result.data.APP_ENV ?? result.data.NODE_ENV;

  if (isProduction(result.data.NODE_ENV) || isProduction(appEnv)) {
    const issues = [
      requiredProductionIssue("APP_URL", result.data.APP_URL),
      requiredProductionIssue("BETTER_AUTH_SECRET", result.data.BETTER_AUTH_SECRET),
      requiredProductionIssue("DATABASE_URL", result.data.DATABASE_URL),
      requiredProductionIssue("OBJECT_STORAGE_ENDPOINT", result.data.OBJECT_STORAGE_ENDPOINT),
      requiredProductionIssue("OBJECT_STORAGE_REGION", result.data.OBJECT_STORAGE_REGION),
      requiredProductionIssue("OBJECT_STORAGE_BUCKET", result.data.OBJECT_STORAGE_BUCKET),
      requiredProductionIssue("OBJECT_STORAGE_ACCESS_KEY", result.data.OBJECT_STORAGE_ACCESS_KEY),
      requiredProductionIssue("OBJECT_STORAGE_SECRET_KEY", result.data.OBJECT_STORAGE_SECRET_KEY),
    ].filter((issue) => issue !== undefined);

    if (result.data.BETTER_AUTH_SECRET === LOCAL_DEVELOPMENT_AUTH_SECRET) {
      issues.push({
        path: "BETTER_AUTH_SECRET",
        message: "The local development auth secret cannot be used in production.",
      });
    }

    if (issues.length > 0) {
      throw new EnvironmentValidationError("web-server", issues);
    }
  }

  return Object.freeze({
    nodeEnv: result.data.NODE_ENV,
    appEnv,
    appUrl: result.data.APP_URL ?? LOCAL_APP_URL,
    authSecret: result.data.BETTER_AUTH_SECRET ?? LOCAL_DEVELOPMENT_AUTH_SECRET,
    databaseUrl: result.data.DATABASE_URL ?? LOCAL_DATABASE_URL,
    databasePoolMax: result.data.DATABASE_POOL_MAX,
    databaseConnectionTimeoutMs: result.data.DATABASE_CONNECTION_TIMEOUT_MS,
    databaseIdleTimeoutMs: result.data.DATABASE_IDLE_TIMEOUT_MS,
    databaseQueryTimeoutMs: result.data.DATABASE_QUERY_TIMEOUT_MS,
    databaseStatementTimeoutMs: result.data.DATABASE_STATEMENT_TIMEOUT_MS,
    objectStorageEndpoint: result.data.OBJECT_STORAGE_ENDPOINT ?? LOCAL_OBJECT_STORAGE.endpoint,
    objectStorageRegion: result.data.OBJECT_STORAGE_REGION ?? LOCAL_OBJECT_STORAGE.region,
    objectStorageBucket: result.data.OBJECT_STORAGE_BUCKET ?? LOCAL_OBJECT_STORAGE.bucket,
    objectStorageAccessKey: result.data.OBJECT_STORAGE_ACCESS_KEY ?? LOCAL_OBJECT_STORAGE.accessKey,
    objectStorageSecretKey: result.data.OBJECT_STORAGE_SECRET_KEY ?? LOCAL_OBJECT_STORAGE.secretKey,
    objectStorageForcePathStyle: result.data.OBJECT_STORAGE_FORCE_PATH_STYLE,
    developmentSeedEnabled: result.data.SEARVIA_ENABLE_DEV_SEED,
    developmentSeedEmail: result.data.SEARVIA_DEV_SEED_EMAIL ?? "developer@searvia.local",
    developmentSeedPassword: result.data.SEARVIA_DEV_SEED_PASSWORD,
  });
}
