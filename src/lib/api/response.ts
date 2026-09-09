import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { verifyCsrf } from "@/lib/security/csrf";
import {
  enforceApiRateLimit,
  rateLimitHeaders,
  type ApiRateLimitBucket,
  type ApiRateLimitOutcome,
} from "@/lib/security/api-rate-limit";
import { isProduction } from "@/lib/env";
import type { ApiFailure, ApiSuccess } from "@/types";

export function ok<T>(data: T, init?: { status?: number }): NextResponse {
  return NextResponse.json<ApiSuccess<T>>(
    { success: true, data },
    { status: init?.status ?? 200 },
  );
}

export function fail(error: ApiError): NextResponse {
  const body: ApiFailure = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
  return NextResponse.json(body, {
    status: error.status,
    headers: error.headers,
  });
}

function zodToApiError(error: ZodError): ApiError {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    if (!(path in fieldErrors)) fieldErrors[path] = issue.message;
  }
  return ApiError.validation("Please correct the highlighted fields.", {
    fields: fieldErrors,
  });
}

/**
 * Normalises anything thrown inside a route handler into a safe response.
 * Unknown errors are logged server-side and reduced to a generic 500 so
 * internal details never reach the client (Section 42).
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) return zodToApiError(error);

  if (isDuplicateKeyError(error)) {
    return ApiError.conflict("A record with those details already exists.");
  }

  console.error("[api] unhandled error:", error);

  return isProduction()
    ? ApiError.internal()
    : ApiError.internal(
        error instanceof Error ? error.message : "Unknown server error.",
      );
}

export type RouteContext = { params: Promise<Record<string, string>> };

type Handler = (
  req: NextRequest,
  context: RouteContext,
) => Promise<NextResponse> | NextResponse;

export type RouteOptions = {
  /**
   * Enforce the double-submit CSRF check. Defaults to true for state-changing
   * methods; only endpoints that are genuinely unauthenticated and side-effect
   * free should opt out.
   */
  csrf?: boolean;
  /**
   * Override the blanket API rate limit for this route — a tighter bucket for
   * something expensive, or `false` to waive it where an endpoint carries its
   * own limiter and double counting would be misleading.
   */
  rateLimit?: ApiRateLimitBucket | false;
};

function withRateLimitHeaders(
  res: NextResponse,
  outcome: ApiRateLimitOutcome | null,
): NextResponse {
  if (!outcome) return res;
  for (const [name, value] of Object.entries(rateLimitHeaders(outcome))) {
    res.headers.set(name, value);
  }
  return res;
}

/**
 * Wraps a route handler with rate limiting, CSRF validation and uniform error
 * handling.
 *
 *   export const POST = route(async (req) => { ... });
 *
 * The rate limit runs BEFORE the CSRF check on purpose: a flood of requests
 * with a missing or wrong CSRF token is exactly the traffic worth throttling,
 * and checking CSRF first would let it through the limiter for free.
 */
export function route(handler: Handler, options: RouteOptions = {}) {
  const csrfEnabled = options.csrf ?? true;

  return async function wrapped(
    req: NextRequest,
    context: RouteContext,
  ): Promise<NextResponse> {
    let limit: ApiRateLimitOutcome | null = null;

    try {
      limit = await enforceApiRateLimit(req, options.rateLimit);

      if (limit && !limit.result.allowed) {
        throw ApiError.rateLimited(
          limit.result.retryAfterSeconds,
          rateLimitHeaders(limit),
        );
      }

      if (csrfEnabled) {
        const csrf = verifyCsrf(req);
        if (!csrf.ok) throw ApiError.csrf(csrf.reason);
      }

      return withRateLimitHeaders(await handler(req, context), limit);
    } catch (error) {
      return withRateLimitHeaders(fail(toApiError(error)), limit);
    }
  };
}

/** Parses and validates a JSON body, converting malformed JSON into a 422. */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw ApiError.validation("Request body must be valid JSON.");
  }
}
