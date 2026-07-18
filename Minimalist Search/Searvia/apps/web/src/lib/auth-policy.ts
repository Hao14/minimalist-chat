export const AUTH_COOKIE_PREFIX = "searvia";
export const AUTH_PASSWORD_MIN_LENGTH = 12;
export const AUTH_PASSWORD_MAX_LENGTH = 128;
export const AUTH_GENERIC_ERROR =
  "We could not complete that request. Check your details and try again.";

export interface AuthCookiePolicy {
  readonly httpOnly: true;
  readonly path: "/";
  readonly sameSite: "lax";
  readonly secure: boolean;
}

export function authCookiePolicy(isProduction: boolean): AuthCookiePolicy {
  return Object.freeze({
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isProduction,
  });
}

export function trustedApplicationOrigins(
  appUrl: string,
  isProduction: boolean,
): readonly string[] {
  const configured = new URL(appUrl);
  const origins = new Set([configured.origin]);
  const loopbackHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);

  if (!isProduction && loopbackHostnames.has(configured.hostname)) {
    const port = configured.port === "" ? "" : `:${configured.port}`;
    origins.add(`${configured.protocol}//localhost${port}`);
    origins.add(`${configured.protocol}//127.0.0.1${port}`);
    origins.add(`${configured.protocol}//[::1]${port}`);
  }

  return Object.freeze([...origins]);
}

export function isProtectedApplicationPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export function loginRedirectPath(pathname: string, search: string): string {
  const returnTo = `${pathname}${search}`;
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function safeApplicationReturnTo(value: string | null | undefined): string {
  if (value === null || value === undefined || /[\u0000-\u001f\\]/u.test(value)) {
    return "/app";
  }

  try {
    const base = new URL("https://searvia.invalid");
    const target = new URL(value, base);
    if (target.origin !== base.origin || !isProtectedApplicationPath(target.pathname)) {
      return "/app";
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/app";
  }
}
