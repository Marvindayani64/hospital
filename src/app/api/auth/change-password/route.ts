import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { ApiError } from "@/lib/api/errors";
import { changePasswordSchema } from "@/schemas/auth.schema";
import { changePassword } from "@/services/auth.service";
import { recordAudit } from "@/services/audit.service";
import { requireAuth } from "@/lib/auth/session";
import { setAuthCookies } from "@/lib/auth/cookies";
import {
  PASSWORD_CHANGE_RATE_LIMIT,
  clientIp,
  rateLimit,
} from "@/lib/security/rate-limit";
import { deviceLabel, requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/change-password
 *
 * Allowed while `mustChangePassword` is set — this is the endpoint that clears
 * the flag (Sections 6, 7, 31).
 *
 * On success the user's `tokenVersion` is incremented, which immediately
 * invalidates the temp-password-era access token and every other device's
 * tokens. A fresh pair is issued for the calling device so this session
 * survives the rotation.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireAuth({ allowPasswordChangePending: true });

  const limit = rateLimit(user.userId, {
    key: "auth:change-password",
    ...PASSWORD_CHANGE_RATE_LIMIT,
  });
  if (!limit.allowed) throw ApiError.rateLimited(limit.retryAfterSeconds);

  const body = await readJson(req);
  const input = changePasswordSchema.parse(body);

  const meta = requestMeta(req);

  const { tokens } = await changePassword(
    user.userId,
    input.currentPassword,
    input.newPassword,
    { deviceInfo: deviceLabel(req), ipAddress: clientIp(req) },
  );

  await recordAudit({
    hospitalId: user.hospitalId,
    userId: user.userId,
    action: "user.password_changed",
    resource: "User",
    resourceId: user.userId,
    // Deliberately records no password material of any kind.
    metadata: { wasForced: user.mustChangePassword },
    meta,
  });

  const response = ok({
    changed: true,
    redirectTo: user.isSuperAdmin ? "/super-admin/dashboard" : "/dashboard",
  });

  setAuthCookies(response, tokens);
  return response;
});
