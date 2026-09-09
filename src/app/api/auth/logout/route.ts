import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/api/response";
import { clearAuthCookies, readRefreshToken } from "@/lib/auth/cookies";
import { revokeRefreshToken, revokeSession } from "@/services/auth.service";
import { getCurrentUser } from "@/lib/auth/session";
import { recordAudit } from "@/services/audit.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 *
 * Allowed while `mustChangePassword` is set (Section 31).
 *
 * Revokes THIS device's refresh token and clears both cookies. The device is
 * identified by the `sid` claim on the access token rather than by the refresh
 * cookie, because that cookie is path-scoped to /api/auth/refresh and is
 * therefore never sent here.
 *
 * The access token itself is not blacklisted — impractical for a stateless JWT
 * — but it expires within the access TTL and cannot be renewed, since its
 * refresh token is now revoked.
 *
 * Always returns 200: logging out must succeed even if the session was already
 * dead, so the client can clear its state unconditionally.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await getCurrentUser().catch(() => null);

  if (user) {
    await revokeSession(user.sessionId, user.userId);

    await recordAudit({
      hospitalId: user.hospitalId,
      userId: user.userId,
      action: "auth.logout",
      resource: "User",
      resourceId: user.userId,
      meta: requestMeta(req),
    });
  } else {
    /**
     * Fallback for an expired access token: if the caller happens to reach
     * this endpoint with a readable refresh cookie, revoke by its value.
     */
    const rawToken = await readRefreshToken();
    if (rawToken) await revokeRefreshToken(rawToken);
  }

  const response = ok({ loggedOut: true });
  clearAuthCookies(response);
  return response;
});
