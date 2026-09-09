import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { createDoctorSchema, listDoctorsSchema } from "@/schemas/doctor.schema";
import { createDoctor, listDoctors } from "@/services/doctor.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/doctors */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("doctor.view");

  const { searchParams } = new URL(req.url);
  const params = listDoctorsSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    departmentId: searchParams.get("departmentId") ?? undefined,
  });

  return ok(await listDoctors(user.hospitalId, params));
});

/**
 * POST /api/doctors
 *
 * Every referenced department, and the optional linked staff account, must
 * belong to the caller's hospital (Section 10).
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission("doctor.create");

  const input = createDoctorSchema.parse(await readJson(req));

  const doctor = await createDoctor(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(doctor, { status: 201 });
});
