import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import {
  createPrescriptionSchema,
  listPrescriptionsSchema,
} from "@/schemas/prescription.schema";
import {
  createPrescription,
  listPrescriptions,
} from "@/services/prescription.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/prescriptions — the pharmacy queue.
 *
 * Filterable by status, patient, prescriber and date range; the search term
 * matches drug names.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("prescription.view");

  const { searchParams } = new URL(req.url);
  const params = listPrescriptionsSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    patientId: searchParams.get("patientId") ?? undefined,
    doctorId: searchParams.get("doctorId") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });

  return ok(await listPrescriptions(user.hospitalId, params));
});

/**
 * POST /api/prescriptions
 *
 * Writing a prescription also records the consultation it came out of, reusing
 * that day's visit when the doctor has already written one — see
 * prescription.service.ts. That is why this requires `visit.create` as well:
 * the caller is creating a clinical record, so they must be entitled to.
 */
export const POST = route(async (req: NextRequest) => {
  await requirePermission("visit.create");
  const user = await requirePermission("prescription.create");

  const input = createPrescriptionSchema.parse(await readJson(req));

  const prescription = await createPrescription(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(prescription, { status: 201 });
});
