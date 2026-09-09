import { ok, route } from "@/lib/api/response";
import { requireSuperAdmin } from "@/lib/auth/session";
import { getPlatformStats } from "@/services/hospital.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/super-admin/stats
 *
 * Platform-level counts only. Deliberately exposes no patient or clinical data
 * — platform administration stays separate from tenant medical data
 * (Sections 3 and 34).
 */
export const GET = route(async () => {
  await requireSuperAdmin();
  return ok(await getPlatformStats());
});
