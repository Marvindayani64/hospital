import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requireSuperAdmin } from "@/lib/auth/session";
import {
  changeHospitalStatusSchema,
  updateHospitalSchema,
} from "@/schemas/hospital.schema";
import {
  changeHospitalStatus,
  getHospital,
  updateHospital,
} from "@/services/hospital.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function hospitalId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/super-admin/hospitals/[id] */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  await requireSuperAdmin();
  return ok(await getHospital(await hospitalId(context)));
});

/** PATCH /api/super-admin/hospitals/[id] — profile fields only. */
export const PATCH = route(async (req: NextRequest, context: RouteContext) => {
  const actor = await requireSuperAdmin();

  const body = await readJson(req);
  const input = updateHospitalSchema.parse(body);

  const hospital = await updateHospital(
    await hospitalId(context),
    input,
    { userId: actor.userId },
    requestMeta(req),
  );

  return ok(hospital);
});

/**
 * PUT /api/super-admin/hospitals/[id] — status transitions only.
 *
 * Status lives on its own verb because every change must also bump
 * `Hospital.tokenVersion`, which locks out every user of the tenant on their
 * next request. Routing it through the general PATCH would make it possible to
 * change status without that side effect.
 */
export const PUT = route(async (req: NextRequest, context: RouteContext) => {
  const actor = await requireSuperAdmin();

  const body = await readJson(req);
  const { status } = changeHospitalStatusSchema.parse(body);

  const hospital = await changeHospitalStatus(
    await hospitalId(context),
    status,
    { userId: actor.userId },
    requestMeta(req),
  );

  return ok(hospital);
});
