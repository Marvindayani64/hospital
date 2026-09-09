import type { NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth/cookie-names";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { getEnv } from "@/lib/env";
import { isStateChanging } from "@/lib/security/csrf";
import {
  clientIp,
  rateLimit,
  type RateLimitOptions,
  type RateLimitResult,
} from "@/lib/security/rate-limit";

/**
 * The blanket rate limit applied to every API route through the `route()`
 * wrapper in lib/api/response.ts.
 *
 * `rate-limit.ts` is the mechanism (fixed-window counters); this file decides
 * *who* is being counted and *which* bucket a given request falls into. The
 * endpoint-specific limiters on login, refresh and change-password remain in
 * place and are deliberately tighter — this is a floor, not a replacement.
 */

export type ApiRateLimitBucket = Omit<RateLimitOptions, "key">;

export type ApiRateLimitOutcome = {
  limit: number;
  result: RateLimitResult;
};

type CallerIdentity =
  /** A verified session. Counted per user, so one tenant's staff cannot
   *  exhaust another's allowance by sharing an office IP. */
  | { scope: "user"; id: string }
  /** No usable session — counted per client IP. */
  | { scope: "ip"; id: string };

/**
 * The access token is *verified*, never merely decoded.
 *
 * An unverified decode would let anyone mint a payload naming another user and
 * either drain that user's bucket (denial of service) or rotate through
 * fabricated ids to evade the limit entirely. Verification is a single HS256
 * check with no database read, and requests arriving without the cookie skip it
 * altogether — so a flood of anonymous traffic costs nothing to classify.
 */
async function callerIdentity(req: NextRequest): Promise<CallerIdentity> {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;

  if (token) {
    const claims = await verifyAccessToken(token);
    if (claims) return { scope: "user", id: claims.userId };
  }

  return { scope: "ip", id: clientIp(req) };
}

/**
 * Applies the limit for this request, or returns `null` when limiting is
 * switched off for the deployment or waived for the route.
 *
 * Note the split: reads are far more numerous than writes in normal use, and a
 * write costs the database more, so they get separate allowances rather than
 * one pooled figure that has to be loose enough for the read traffic.
 */
export async function enforceApiRateLimit(
  req: NextRequest,
  override?: ApiRateLimitBucket | false,
): Promise<ApiRateLimitOutcome | null> {
  const env = getEnv();
  if (override === false || !env.RATE_LIMIT_ENABLED) return null;

  const identity = await callerIdentity(req);
  const writing = isStateChanging(req.method);

  const key =
    identity.scope === "ip" ? "api:unauth"
    : writing ? "api:write"
    : "api:read";

  const bucket: ApiRateLimitBucket = override ?? {
    windowSeconds: env.RATE_LIMIT_WINDOW,
    limit:
      identity.scope === "ip" ? env.RATE_LIMIT_UNAUTH
      : writing ? env.RATE_LIMIT_WRITE
      : env.RATE_LIMIT_READ,
  };

  const result = rateLimit(`${identity.scope}:${identity.id}`, {
    key,
    ...bucket,
  });

  return { limit: bucket.limit, result };
}

/** Advertises the caller's remaining allowance so a client can back off before
 *  it is refused, rather than discovering the limit by hitting a 429. */
export function rateLimitHeaders(
  outcome: ApiRateLimitOutcome,
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(outcome.limit),
    "X-RateLimit-Remaining": String(Math.max(0, outcome.result.remaining)),
    "X-RateLimit-Reset": String(outcome.result.resetInSeconds),
  };
}
