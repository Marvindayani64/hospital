import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { updatePatientSchema } from "@/schemas/patient.schema";
import {
  deletePatient,
  getPatient,
  updatePatient,
} from "@/services/patient.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function patientId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/patients/[id] */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("patient.view");
  return ok(await getPatient(await patientId(context), user.hospitalId));
});

/** PATCH /api/patients/[id] */
export const PATCH = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("patient.update");

  const input = updatePatientSchema.parse(await readJson(req));

  const patient = await updatePatient(
    await patientId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(patient);
});

/** DELETE /api/patients/[id] — refused while appointment history exists. */
export const DELETE = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("patient.delete");

  await deletePatient(
    await patientId(context),
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok({ deleted: true });
});
