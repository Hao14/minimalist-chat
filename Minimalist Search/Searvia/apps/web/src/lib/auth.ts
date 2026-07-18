import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { parseServerEnvironment } from "@searvia/config/server";
import { authenticationSchema } from "@searvia/database/runtime";
import { betterAuth } from "better-auth";

import {
  AUTH_COOKIE_PREFIX,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  authCookiePolicy,
  trustedApplicationOrigins,
} from "@/lib/auth-policy";
import { getDatabaseClient } from "@/lib/database";

type SearviaAuth = ReturnType<typeof createAuth>;

const authSingleton = globalThis as typeof globalThis & {
  __searviaAuth?: SearviaAuth;
};

function createAuth() {
  const environment = parseServerEnvironment(process.env);
  const production = environment.appEnv === "production" || environment.nodeEnv === "production";

  return betterAuth({
    appName: "Searvia",
    baseURL: environment.appUrl,
    secret: environment.authSecret,
    database: drizzleAdapter(getDatabaseClient().db, {
      provider: "pg",
      schema: authenticationSchema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: AUTH_PASSWORD_MIN_LENGTH,
      maxPasswordLength: AUTH_PASSWORD_MAX_LENGTH,
      autoSignIn: false,
    },
    session: {
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 20,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    trustedOrigins: [...trustedApplicationOrigins(environment.appUrl, production)],
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: production,
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: authCookiePolicy(production),
      database: { generateId: "uuid" },
    },
    logger: { disabled: true },
  });
}

export function getAuth(): SearviaAuth {
  authSingleton.__searviaAuth ??= createAuth();
  return authSingleton.__searviaAuth;
}

export type AuthSession = NonNullable<Awaited<ReturnType<SearviaAuth["api"]["getSession"]>>>;
