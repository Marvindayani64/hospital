/**
 * Cookie and header names with NO imports.
 *
 * middleware.ts runs on the Edge runtime and must not pull in `next/headers`,
 * `crypto` or Mongoose. Keeping these constants dependency-free lets both the
 * Edge middleware and the Node route handlers share one definition.
 */
export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
export const CSRF_COOKIE = "csrf_token";
export const CSRF_HEADER = "x-csrf-token";

/**
 * The refresh cookie is scoped to the refresh endpoint only, so it is not
 * attached to every ordinary API call.
 */
export const REFRESH_COOKIE_PATH = "/api/auth/refresh";
