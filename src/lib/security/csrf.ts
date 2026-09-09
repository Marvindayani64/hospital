import { randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/cookie-names";

export { CSRF_HEADER };

/**
 * Double-submit CSRF protection.
 *
 * An HTTP-only JWT cookie is attached by the browser automatically on
 * cross-site requests exactly like a session cookie, so moving from sessions to
 * JWT removes none of the CSRF risk (Section 43). The defence: a random nonce
 * is stored in a readable cookie AND must be echoed in a custom request header.
 * A cross-origin attacker can cause the cookie to be sent but cannot read it to
 * populate the header, and cannot set custom headers on a simple form post.
 */

export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isStateChanging(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export type CsrfResult = { ok: true } | { ok: false; reason: string };

/**
 * Validates a state-changing request. Safe methods pass through untouched.
 */
export function verifyCsrf(req: NextRequest): CsrfResult {
  if (!isStateChanging(req.method)) return { ok: true };

  const cookieToken = req.cookies.get(CSRF_COOKIE)?.value;
  const headerToken = req.headers.get(CSRF_HEADER);

  if (!cookieToken) {
    return { ok: false, reason: "Missing CSRF cookie." };
  }
  if (!headerToken) {
    return { ok: false, reason: `Missing ${CSRF_HEADER} header.` };
  }
  if (!constantTimeEquals(cookieToken, headerToken)) {
    return { ok: false, reason: "CSRF token mismatch." };
  }

  return { ok: true };
}
