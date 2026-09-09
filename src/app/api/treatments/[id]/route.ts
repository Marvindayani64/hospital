import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { updateTreatmentSchema } from "@/schemas/treatment.schema";
import {
  deleteTreatment,
  getTreatment,
  updateTreatment,
} from "@/services/treatment.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function treatmentId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/treatments/[id] */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("treatment.view");
  return ok(await getTreatment(await treatmentId(context), user.hospitalId));
});

/** PATCH /api/treatments/[id] — including price changes and moving department. */
export const PATCH = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("treatment.update");

  const input = updateTreatmentSchema.parse(await readJson(req));

  const treatment = await updateTreatment(
    await treatmentId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(treatment);
});

/** DELETE /api/treatments/[id] */
export const DELETE = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("treatment.delete");

  await deleteTreatment(
    await treatmentId(context),
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok({ deleted: true });
});
