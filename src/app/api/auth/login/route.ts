import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { ApiError } from "@/lib/api/errors";
import { loginSchema } from "@/schemas/auth.schema";
import { authenticate } from "@/services/auth.service";
import { recordAudit } from "@/services/audit.service";
import { setAuthCookies } from "@/lib/auth/cookies";
import {
  LOGIN_RATE_LIMIT,
  clientIp,
  rateLimit,
  resetRateLimit,
} from "@/lib/security/rate-limit";
import { deviceLabel, requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login
 *
 * Public. Verifies credentials and sets the access + refresh cookies. Tokens
 * are never included in the JSON body, so no client script can copy them into
 * localStorage.
 */
export const POST = route(async (req: NextRequest) => {
  const ip = clientIp(req);

  const limit = rateLimit(ip, { key: "auth:login", ...LOGIN_RATE_LIMIT });
  if (!limit.allowed) throw ApiError.rateLimited(limit.retryAfterSeconds);

  const body = await readJson(req);
  const input = loginSchema.parse(body);

  const meta = requestMeta(req);

  const { user, tokens } = await authenticate(input.email, input.password, {
    deviceInfo: deviceLabel(req),
    ipAddress: meta.ipAddress,
  });

  resetRateLimit(ip, "auth:login");

  await recordAudit({
    hospitalId: user.hospitalId ? String(user.hospitalId) : null,
    userId: String(user._id),
    action: "auth.login",
    resource: "User",
    resourceId: String(user._id),
    metadata: { isSuperAdmin: user.isSuperAdmin },
    meta,
  });

  const response = ok({
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      hospitalId: user.hospitalId ? String(user.hospitalId) : null,
      mustChangePassword: user.mustChangePassword,
    },
    // Tells the client where to go next; the server enforces the same rule
    // independently in requireAuth(), so this is a convenience, not a control.
    redirectTo: user.mustChangePassword
      ? "/change-password"
      : user.isSuperAdmin
        ? "/super-admin/dashboard"
        : "/dashboard",
  });

  setAuthCookies(response, tokens);
  return response;
});
