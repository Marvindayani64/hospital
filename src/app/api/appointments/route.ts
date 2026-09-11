import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import {
  createAppointmentSchema,
  listAppointmentsSchema,
} from "@/schemas/appointment.schema";
import {
  createAppointment,
  listAppointments,
} from "@/services/appointment.service";
import { ownDoctorId } from "@/lib/rbac/doctor-scope";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/appointments — filterable by date range, doctor, patient, status. */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("appointment.view");

  const { searchParams } = new URL(req.url);
  const params = listAppointmentsSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    doctorId: searchParams.get("doctorId") ?? undefined,
    patientId: searchParams.get("patientId") ?? undefined,
    departmentId: searchParams.get("departmentId") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });

  /**
   * A clinician sees their own bookings only. Resolved here from the session
   * rather than trusted from the query string, so it cannot be lifted by
   * editing the URL.
   */
  const viewerDoctorId = await ownDoctorId(user.userId, user.hospitalId);

  return ok(
    await listAppointments(user.hospitalId, { ...params, viewerDoctorId }),
  );
});

/**
 * POST /api/appointments
 *
 * All four references (patient, doctor, department, treatment) are resolved
 * within the caller's tenant before anything is written, so a Hospital A
 * patient can never be booked with a Hospital B doctor (Sections 10, 21).
 *
 * The doctor's calendar is also checked for overlap — the same doctor cannot be
 * booked twice at once.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission("appointment.create");

  const input = createAppointmentSchema.parse(await readJson(req));

  const appointment = await createAppointment(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(appointment, { status: 201 });
});
