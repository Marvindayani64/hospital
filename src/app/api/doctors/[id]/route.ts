import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { updateDoctorSchema } from "@/schemas/doctor.schema";
import {
  deleteDoctor,
  getDoctor,
  updateDoctor,
} from "@/services/doctor.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function doctorId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/doctors/[id] */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("doctor.view");
  return ok(await getDoctor(await doctorId(context), user.hospitalId));
});

/** PATCH /api/doctors/[id] — details, departments, fee, availability, status. */
export const PATCH = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("doctor.update");

  const input = updateDoctorSchema.parse(await readJson(req));

  const doctor = await updateDoctor(
    await doctorId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(doctor);
});

/** DELETE /api/doctors/[id] — refused while appointment history exists. */
export const DELETE = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("doctor.delete");

  await deleteDoctor(
    await doctorId(context),
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok({ deleted: true });
});
