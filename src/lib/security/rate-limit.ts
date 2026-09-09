import type { NextRequest } from "next/server";

/**
 * Fixed-window in-memory rate limiter for the authentication endpoints.
 *
 * LIMITATION: state lives in the process, so it protects a single instance
 * only. Behind multiple replicas or on serverless, move this to Redis or an
 * edge rate limiter — the call sites do not change.
 */

type Bucket = { count: number; resetAt: number };

const globalForLimiter = globalThis as unknown as {
  __rateLimitBuckets?: Map<string, Bucket>;
};

const buckets: Map<string, Bucket> =
  globalForLimiter.__rateLimitBuckets ?? new Map();
globalForLimiter.__rateLimitBuckets = buckets;

let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitOptions = {
  /** Distinct namespace per endpoint, e.g. "auth:login". */
  key: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  /** Seconds until this bucket empties — surfaced as `X-RateLimit-Reset`. */
  resetInSeconds: number;
};

/**
 * Best-effort client identity. `x-forwarded-for` is spoofable unless a trusted
 * proxy sets it, so this is a speed bump against credential stuffing rather
 * than a hard control.
 */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function rateLimit(
  identifier: string,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const compositeKey = `${options.key}:${identifier}`;
  const existing = buckets.get(compositeKey);

  if (!existing || existing.resetAt <= now) {
    buckets.set(compositeKey, {
      count: 1,
      resetAt: now + options.windowSeconds * 1000,
    });
    return {
      allowed: true,
      remaining: options.limit - 1,
      retryAfterSeconds: 0,
      resetInSeconds: options.windowSeconds,
    };
  }

  existing.count += 1;

  const resetInSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count > options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: resetInSeconds,
      resetInSeconds,
    };
  }

  return {
    allowed: true,
    remaining: options.limit - existing.count,
    retryAfterSeconds: 0,
    resetInSeconds,
  };
}

/** Clears a bucket — called after a successful login so one user's typo streak
 *  does not keep them locked out once they get it right. */
export function resetRateLimit(identifier: string, key: string): void {
  buckets.delete(`${key}:${identifier}`);
}

export const LOGIN_RATE_LIMIT: Omit<RateLimitOptions, "key"> = {
  limit: 8,
  windowSeconds: 300,
};

export const REFRESH_RATE_LIMIT: Omit<RateLimitOptions, "key"> = {
  limit: 60,
  windowSeconds: 300,
};

export const PASSWORD_CHANGE_RATE_LIMIT: Omit<RateLimitOptions, "key"> = {
  limit: 10,
  windowSeconds: 900,
};
