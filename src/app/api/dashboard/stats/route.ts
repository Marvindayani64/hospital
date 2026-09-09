import { ok, route } from "@/lib/api/response";
import { requireHospitalUser } from "@/lib/auth/session";
import { getDashboardStats } from "@/services/report.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/stats — tenant-scoped metrics (Section 35).
 *
 * Requires only an authenticated hospital user: each metric is computed ONLY
 * when the caller holds the permission for its underlying data, and comes back
 * as `null` otherwise. A receptionist therefore gets patient and appointment
 * tiles but no revenue figure — the number is never computed, not merely
 * hidden by the UI.
 */
export const GET = route(async () => {
  const user = await requireHospitalUser();
  return ok(await getDashboardStats(user));
});
