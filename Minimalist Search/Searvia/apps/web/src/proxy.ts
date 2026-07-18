import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import {
  AUTH_COOKIE_PREFIX,
  isProtectedApplicationPath,
  loginRedirectPath,
} from "@/lib/auth-policy";

export function proxy(request: NextRequest) {
  if (!isProtectedApplicationPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const sessionToken = getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX });
  if (sessionToken !== null) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = new URL(
    loginRedirectPath(request.nextUrl.pathname, request.nextUrl.search),
    request.url,
  ).search;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/app/:path*"],
};
