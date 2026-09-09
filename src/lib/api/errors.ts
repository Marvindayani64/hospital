/**
 * Application-level errors. Every one carries a stable machine `code` the
 * frontend can branch on, plus a message that is safe to show a user — no
 * stack traces, no driver errors, no schema details (Section 42).
 */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "CSRF_FAILED"
  | "PASSWORD_CHANGE_REQUIRED"
  | "HOSPITAL_INACTIVE"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Extra response headers, e.g. Retry-After on a rate limit. */
  readonly headers?: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    options: { details?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = options.details;
    this.headers = options.headers;
  }

  static validation(message: string, details?: unknown): ApiError {
    return new ApiError("VALIDATION_ERROR", 422, message, { details });
  }

  static unauthenticated(message = "Authentication required."): ApiError {
    return new ApiError("UNAUTHENTICATED", 401, message);
  }

  static forbidden(message = "You do not have permission to do that."): ApiError {
    return new ApiError("FORBIDDEN", 403, message);
  }

  /**
   * Used for cross-tenant access attempts as well as genuinely missing records.
   * Returning 404 rather than 403 avoids confirming that another hospital's
   * record ID exists (Section 10).
   */
  static notFound(message = "Resource not found."): ApiError {
    return new ApiError("NOT_FOUND", 404, message);
  }

  static conflict(message: string): ApiError {
    return new ApiError("CONFLICT", 409, message);
  }

  static rateLimited(
    retryAfterSeconds: number,
    headers: Record<string, string> = {},
  ): ApiError {
    return new ApiError(
      "RATE_LIMITED",
      429,
      "Too many attempts. Please try again shortly.",
      { headers: { "Retry-After": String(retryAfterSeconds), ...headers } },
    );
  }

  static csrf(reason: string): ApiError {
    return new ApiError("CSRF_FAILED", 403, `Request rejected: ${reason}`);
  }

  static passwordChangeRequired(): ApiError {
    return new ApiError(
      "PASSWORD_CHANGE_REQUIRED",
      403,
      "You must change your password before continuing.",
    );
  }

  static hospitalInactive(status: string): ApiError {
    return new ApiError(
      "HOSPITAL_INACTIVE",
      403,
      `This hospital account is ${status}. Contact the platform administrator.`,
    );
  }

  static internal(message = "Something went wrong. Please try again."): ApiError {
    return new ApiError("INTERNAL_ERROR", 500, message);
  }
}

/** Mongo duplicate-key errors surface as code 11000. */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}
