import type { NextRequest } from "next/server";
import { fail, ok, route, toApiError } from "@/lib/api/response";
import { ApiError } from "@/lib/api/errors";
import { refreshSession } from "@/services/auth.service";
import {
  clearAuthCookies,
  readRefreshToken,
  setAuthCookies,
} from "@/lib/auth/cookies";
import {
  REFRESH_RATE_LIMIT,
  clientIp,
  rateLimit,
} from "@/lib/security/rate-limit";
import { deviceLabel, requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/refresh
 *
 * Exchanges a valid refresh token for a new access token, rotating the refresh
 * token in the process (single-use). Presenting an already-rotated token is
 * treated as theft and revokes the user's whole session family.
 *
 * The refresh cookie is path-scoped to this endpoint, so it is not transmitted
 * on any other request.
 *
 * On any failure the auth cookies are cleared, so the browser stops presenting
 * a dead token on every subsequent request.
 */
export const POST = route(async (req: NextRequest) => {
  const ip = clientIp(req);

  const limit = rateLimit(ip, { key: "auth:refresh", ...REFRESH_RATE_LIMIT });
  if (!limit.allowed) throw ApiError.rateLimited(limit.retryAfterSeconds);

  const rawToken = await readRefreshToken();

  if (!rawToken) {
    const response = fail(ApiError.unauthenticated("No active session."));
    clearAuthCookies(response);
    return response;
  }

  const meta = requestMeta(req);

  try {
    const { tokens } = await refreshSession(rawToken, {
      deviceInfo: deviceLabel(req),
      ipAddress: meta.ipAddress,
    });

    const response = ok({ refreshed: true });
    setAuthCookies(response, tokens);
    return response;
  } catch (error) {
    const response = fail(toApiError(error));
    clearAuthCookies(response);
    return response;
  }
});
