import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import {
  createPatientSchema,
  listPatientsSchema,
} from "@/schemas/patient.schema";
import { createPatient, listPatients } from "@/services/patient.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/patients — this hospital's patients only. */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("patient.view");

  const { searchParams } = new URL(req.url);
  const params = listPatientsSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    search: searchParams.get("search") ?? undefined,
  });

  return ok(await listPatients(user.hospitalId, params));
});

/**
 * POST /api/patients
 *
 * The patient number is allocated server-side from a per-tenant atomic counter,
 * so concurrent registrations cannot collide (Section 19).
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission("patient.create");

  const input = createPatientSchema.parse(await readJson(req));

  const patient = await createPatient(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(patient, { status: 201 });
});
