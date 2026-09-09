import type { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isProduction } from "@/lib/env";
import { accessTokenTtlSeconds, refreshTokenTtlSeconds } from "@/lib/auth/jwt";

/**
 * Names are defined in cookie-names.ts (import-free) so the Edge middleware can
 * share them; they are re-exported here for convenience.
 *
 * Scoping the refresh cookie to the refresh endpoint shrinks its exposure: an
 * XSS-driven request against `/api/patients` cannot cause the long-lived token
 * to be transmitted at all.
 */
export {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE_PATH,
} from "@/lib/auth/cookie-names";

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE_PATH,
} from "@/lib/auth/cookie-names";

type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "strict" | "lax";
  path: string;
  maxAge: number;
};

function baseOptions(): Omit<CookieOptions, "path" | "maxAge" | "httpOnly"> {
  return {
    // Secure is skipped in development so cookies work over http://localhost.
    secure: isProduction(),
    /**
     * SameSite=Lax rather than Strict: Strict would drop the cookie on ordinary
     * top-level navigations into the app from an external link or email, so a
     * logged-in user would land on the login page. Lax still blocks the
     * cross-site POST that CSRF depends on, and the double-submit token in
     * lib/security/csrf.ts is the primary defence regardless.
     */
    sameSite: "lax",
  };
}

export function setAccessCookie(res: NextResponse, token: string): void {
  res.cookies.set(ACCESS_COOKIE, token, {
    ...baseOptions(),
    httpOnly: true,
    path: "/",
    maxAge: accessTokenTtlSeconds(),
  });
}

export function setRefreshCookie(res: NextResponse, token: string): void {
  res.cookies.set(REFRESH_COOKIE, token, {
    ...baseOptions(),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshTokenTtlSeconds(),
  });
}

/**
 * The CSRF token is deliberately NOT httpOnly — the client script has to read
 * it to echo it back in the `x-csrf-token` header. That is safe: it is a random
 * nonce with no authority of its own, and an attacker on another origin cannot
 * read it because of the same-origin policy.
 */
export function setCsrfCookie(res: NextResponse, token: string): void {
  res.cookies.set(CSRF_COOKIE, token, {
    ...baseOptions(),
    httpOnly: false,
    path: "/",
    maxAge: refreshTokenTtlSeconds(),
  });
}

export function setAuthCookies(
  res: NextResponse,
  tokens: { accessToken: string; refreshToken: string },
): void {
  setAccessCookie(res, tokens.accessToken);
  setRefreshCookie(res, tokens.refreshToken);
}

export function clearAuthCookies(res: NextResponse): void {
  res.cookies.set(ACCESS_COOKIE, "", {
    ...baseOptions(),
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  res.cookies.set(REFRESH_COOKIE, "", {
    ...baseOptions(),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  });
}

/** Reads the access token from the incoming request's cookie jar. */
export async function readAccessToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACCESS_COOKIE)?.value ?? null;
}

export async function readRefreshToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(REFRESH_COOKIE)?.value ?? null;
}
