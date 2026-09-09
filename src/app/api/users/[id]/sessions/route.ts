import type { NextRequest } from "next/server";
import { ok, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { forceLogoutUser } from "@/services/user.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/users/[id]/sessions
 *
 * Administrative "sign out everywhere" for one member (Section 8a).
 *
 * Increments the member's `tokenVersion`, which invalidates every outstanding
 * access token on its next use, and revokes all their refresh tokens so none
 * can be renewed. Takes effect within one request — not at token expiry.
 */
export const DELETE = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("user.update");

  const params = await context.params;

  await forceLogoutUser(
    params.id ?? "",
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok({ signedOut: true });
});
