import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import {
  changeAppointmentStatusSchema,
  updateAppointmentSchema,
} from "@/schemas/appointment.schema";
import {
  changeAppointmentStatus,
  deleteAppointment,
  getAppointment,
  updateAppointment,
} from "@/services/appointment.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function appointmentId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/appointments/[id] */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("appointment.view");
  return ok(await getAppointment(await appointmentId(context), user.hospitalId));
});

/** PATCH /api/appointments/[id] — rescheduling and re-assignment. */
export const PATCH = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("appointment.update");

  const input = updateAppointmentSchema.parse(await readJson(req));

  const appointment = await updateAppointment(
    await appointmentId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(appointment);
});

/**
 * PUT /api/appointments/[id] — lifecycle transitions.
 *
 * Separate from PATCH so the transition table is enforced in one place, and so
 * cancelling can require `appointment.cancel` rather than general update rights.
 */
export const PUT = route(async (req: NextRequest, context: RouteContext) => {
  const body = await readJson(req);
  const { status, cancellationReason } =
    changeAppointmentStatusSchema.parse(body);

  // Cancelling is its own permission in the catalogue (Section 11), so a role
  // may be allowed to progress an appointment without being able to cancel it.
  const user = await requirePermission(
    status === "cancelled" ? "appointment.cancel" : "appointment.update",
  );

  const appointment = await changeAppointmentStatus(
    await appointmentId(context),
    status,
    cancellationReason,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(appointment);
});

/**
 * DELETE /api/appointments/[id]
 *
 * Hard delete, gated on `appointment.cancel`. Cancelling is almost always the
 * right action — it preserves the record; deletion is for genuine mistakes.
 */
export const DELETE = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("appointment.cancel");

  await deleteAppointment(
    await appointmentId(context),
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok({ deleted: true });
});
