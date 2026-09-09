import { ok, route } from "@/lib/api/response";
import { requireHospitalUser } from "@/lib/auth/session";
import { getDashboardInsights } from "@/services/report.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/insights — trends, series, alerts and approvals.
 *
 * The companion to /api/dashboard/stats, kept separate so that endpoint's
 * shape is unchanged and a caller wanting only the counters does not pay for
 * the aggregations. Same authorisation rule: every figure is tenant-scoped and
 * computed only when the caller holds the permission for its underlying data.
 */
export const GET = route(async () => {
  const user = await requireHospitalUser();
  return ok(await getDashboardInsights(user));
});
