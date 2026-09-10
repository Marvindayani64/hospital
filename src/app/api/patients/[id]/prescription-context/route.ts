import type { NextRequest } from "next/server";
import { ok, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { getPrescriptionContext } from "@/services/prescription.service";
import { todayDateString } from "@/utils/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/patients/[id]/prescription-context
 *
 * Who a prescription for this patient would be signed by, and which of today's
 * bookings it could attach to. Exists so the patients LIST can open the same
 * prescribe dialog as the patient record without loading either for every row.
 *
 * Gated on `prescription.create` — it only serves the prescribe dialog, and it
 * names a clinician, so it is not a general read.
 */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("prescription.create");

  const params = await context.params;

  return ok(
    await getPrescriptionContext(
      params.id ?? "",
      user.userId,
      user.hospitalId,
      todayDateString(),
    ),
  );
});
