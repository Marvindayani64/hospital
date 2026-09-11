import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { createVisitSchema, listVisitsSchema } from "@/schemas/visit.schema";
import { createVisit, listVisits } from "@/services/visit.service";
import { ownDoctorId } from "@/lib/rbac/doctor-scope";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/visits — filterable by patient, doctor, date range, follow-up due. */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("visit.view");

  const { searchParams } = new URL(req.url);
  const params = listVisitsSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    patientId: searchParams.get("patientId") ?? undefined,
    doctorId: searchParams.get("doctorId") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    followUpBefore: searchParams.get("followUpBefore") ?? undefined,
  });

  // A clinician sees their own consultations only, taken from the session.
  const viewerDoctorId = await ownDoctorId(user.userId, user.hospitalId);

  return ok(await listVisits(user.hospitalId, { ...params, viewerDoctorId }));
});

/**
 * POST /api/visits
 *
 * Every reference is resolved inside the caller's tenant, and an appointment —
 * when supplied — must belong to the same patient. An appointment can produce
 * at most one visit.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission("visit.create");

  const input = createVisitSchema.parse(await readJson(req));

  const visit = await createVisit(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(visit, { status: 201 });
});
