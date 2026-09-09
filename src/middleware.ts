import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE,
} from "@/lib/auth/cookie-names";

/**
 * Edge middleware. It does three things, none of which is authorisation:
 *
 *  1. Applies security headers to every response.
 *  2. Ensures a CSRF nonce cookie exists, so the login page can echo it back.
 *  3. Performs a COARSE redirect for page routes based on cookie presence.
 *
 * Step 3 is a user-experience optimisation only. The middleware cannot reach
 * MongoDB, so it cannot verify tokenVersion, account status or hospital status.
 * Real enforcement happens in requireAuth() inside each route handler and
 * server component — a forged or stale cookie gets past middleware and is
 * rejected there.
 */

const PUBLIC_PAGES = new Set(["/login"]);

function securityHeaders(response: NextResponse): NextResponse {
  const headers = response.headers;

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-DNS-Prefetch-Control", "off");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  /**
   * React Fast Refresh evaluates code as strings, so the dev server cannot run
   * without 'unsafe-eval'. Omitting it does not merely disable hot reloading —
   * the refresh runtime throws inside `main-app.js`, which aborts the whole
   * client bundle, so React never hydrates and no event handler is ever
   * attached. The page still renders (that is the server's work) and every API
   * call still succeeds from outside the browser, which makes it look like an
   * application bug rather than a header problem.
   *
   * Production builds contain no `eval`, so the directive is added ONLY in
   * development and the shipped policy stays strict.
   */
  const isDevelopment = process.env.NODE_ENV === "development";

  const scriptSrc = isDevelopment
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  /**
   * The dev server pushes rebuilds over a WebSocket. Some browsers do not treat
   * ws:// as covered by 'self', so it is listed explicitly — in development
   * only.
   */
  const connectSrc = isDevelopment
    ? "connect-src 'self' ws: wss:"
    : "connect-src 'self'";

  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // Next.js injects inline bootstrap scripts and styles.
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      connectSrc,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  );

  return response;
}

/** Web Crypto — `node:crypto` is unavailable on the Edge runtime. */
function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function ensureCsrfCookie(req: NextRequest, response: NextResponse): void {
  if (req.cookies.get(CSRF_COOKIE)) return;

  response.cookies.set(CSRF_COOKIE, generateNonce(), {
    httpOnly: false, // the client script must read it to set the header
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // API routes handle their own auth and CSRF; only add headers.
  if (pathname.startsWith("/api/")) {
    return securityHeaders(NextResponse.next());
  }

  const hasAccessCookie = Boolean(req.cookies.get(ACCESS_COOKIE));
  const hasRefreshCookie = Boolean(req.cookies.get(REFRESH_COOKIE));
  // An expired access token with a live refresh token is a normal state; let
  // the page load so the client can silently refresh.
  const looksAuthenticated = hasAccessCookie || hasRefreshCookie;

  const isPublicPage = PUBLIC_PAGES.has(pathname);

  if (!looksAuthenticated && !isPublicPage && pathname !== "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // Preserve the destination so login can return the user to it.
    url.searchParams.set("next", pathname);
    const response = securityHeaders(NextResponse.redirect(url));
    ensureCsrfCookie(req, response);
    return response;
  }

  /**
   * A signed-in user landing on /login is deliberately NOT redirected here.
   * Middleware only sees that a cookie exists, not that it is still valid, so
   * bouncing them to "/" could ping-pong against the root page's real auth
   * check. The login page performs that check itself, server-side.
   */

  const response = securityHeaders(NextResponse.next());
  ensureCsrfCookie(req, response);
  return response;
}

export const config = {
  matcher: [
    /**
     * Everything except Next.js internals and static assets. The negative
     * lookahead keeps the middleware off `/_next/static`, which would otherwise
     * add measurable latency to every asset.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
