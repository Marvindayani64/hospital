import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { dispensePrescriptionSchema } from "@/schemas/prescription.schema";
import {
  dispensePrescription,
  getPrescription,
} from "@/services/prescription.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function prescriptionId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/prescriptions/[id] */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("prescription.view");
  return ok(
    await getPrescription(await prescriptionId(context), user.hospitalId),
  );
});

/**
 * PUT /api/prescriptions/[id] — the pharmacy dispensing or withdrawing it.
 *
 * PUT rather than PATCH, matching appointments: this is a lifecycle transition
 * enforced in one place, not a field edit. A prescription's drugs are never
 * editable — a mistake is withdrawn and rewritten, so the record of what was
 * originally prescribed survives.
 */
export const PUT = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("prescription.dispense");

  const input = dispensePrescriptionSchema.parse(await readJson(req));

  const prescription = await dispensePrescription(
    await prescriptionId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(prescription);
});
