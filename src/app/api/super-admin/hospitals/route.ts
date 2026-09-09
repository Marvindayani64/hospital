import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requireSuperAdmin } from "@/lib/auth/session";
import {
  createHospitalSchema,
  listHospitalsSchema,
} from "@/schemas/hospital.schema";
import {
  createHospitalWithAdmin,
  listHospitals,
} from "@/services/hospital.service";
import { requestMeta } from "@/utils/request";
import type { CreateHospitalInput } from "@/schemas/hospital.schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/super-admin/hospitals — paginated hospital list. */
export const GET = route(async (req: NextRequest) => {
  await requireSuperAdmin();

  const { searchParams } = new URL(req.url);
  const params = listHospitalsSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? undefined,
  });

  return ok(await listHospitals(params));
});

/**
 * POST /api/super-admin/hospitals
 *
 * Creates the hospital, its five default roles and its Hospital Admin in one
 * atomic operation (Sections 46, 47).
 *
 * The generated temporary password is returned in THIS response only. It is
 * stored as a hash and no endpoint can ever retrieve it again.
 */
export const POST = route(async (req: NextRequest) => {
  const actor = await requireSuperAdmin();

  const body = await readJson(req);
  const input = createHospitalSchema.parse(body) as CreateHospitalInput;

  const result = await createHospitalWithAdmin(
    input,
    { userId: actor.userId },
    requestMeta(req),
  );

  return ok(
    {
      hospital: result.hospital,
      temporaryPassword: result.temporaryPassword,
      warning:
        "This temporary password is shown once and cannot be retrieved again. Share it with the hospital administrator now.",
    },
    { status: 201 },
  );
});
