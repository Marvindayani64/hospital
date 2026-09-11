import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import {
  Appointment,
  Department,
  Doctor,
  Patient,
  Treatment,
  Visit,
  type AppointmentStatus,
} from "@/models";
import { RELEASING_STATUSES, TERMINAL_STATUSES } from "@/models/Appointment";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import { generateInvoiceForCompletedAppointment } from "@/services/billing.service";
import {
  assertBelongsToTenant,
  paginationMeta,
  paginationSkip,
  tenantScoped,
} from "@/lib/tenant/scope";
import {
  WEEKDAY_NAMES,
  dayOfWeek,
  minutesToTime,
  timeToMinutes,
} from "@/utils/time";
import type {
  CreateAppointmentInput,
  UpdateAppointmentInput,
} from "@/schemas/appointment.schema";
import type { Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

export type AppointmentSummary = {
  id: string;
  patient: { id: string; name: string; patientNumber: string; phone: string } | null;
  doctor: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  treatment: { id: string; name: string } | null;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  status: AppointmentStatus;
  notes: string;
  cancellationReason: string;
  createdAt: string;
};

type Actor = { userId: string; hospitalId: string };

/**
 * Legal status transitions (Section 21).
 *
 * Modelling this explicitly stops nonsense sequences — a completed appointment
 * cannot be moved back to scheduled, and a cancelled one cannot be checked in.
 * Rescheduling a cancelled appointment means creating a new one.
 */
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ["confirmed", "checked_in", "cancelled", "no_show"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

function toSummary(appointment: {
  _id: unknown;
  patientId: unknown;
  doctorId: unknown;
  departmentId: unknown;
  treatmentId: unknown;
  appointmentDate: string;
  startMinutes: number;
  endMinutes: number;
  status: string;
  notes?: string | null;
  cancellationReason?: string | null;
  createdAt: Date;
}): AppointmentSummary {
  /**
   * Populated refs arrive as objects; unpopulated ones as ObjectIds. Reading
   * them defensively keeps this usable from both query shapes.
   */
  const ref = <T extends Record<string, unknown>>(value: unknown): T | null =>
    value && typeof value === "object" && "_id" in (value as object)
      ? (value as T)
      : null;

  const patient = ref<{
    _id: unknown;
    firstName: string;
    lastName: string;
    patientNumber: string;
    phone: string;
  }>(appointment.patientId);

  const doctor = ref<{ _id: unknown; displayName: string }>(appointment.doctorId);
  const department = ref<{ _id: unknown; name: string }>(appointment.departmentId);
  const treatment = ref<{ _id: unknown; name: string }>(appointment.treatmentId);

  return {
    id: String(appointment._id),
    patient: patient
      ? {
          id: String(patient._id),
          name: `${patient.firstName} ${patient.lastName}`.trim(),
          patientNumber: patient.patientNumber,
          phone: patient.phone,
        }
      : null,
    doctor: doctor
      ? { id: String(doctor._id), name: doctor.displayName }
      : null,
    department: department
      ? { id: String(department._id), name: department.name }
      : null,
    treatment: treatment
      ? { id: String(treatment._id), name: treatment.name }
      : null,
    appointmentDate: appointment.appointmentDate,
    startTime: minutesToTime(appointment.startMinutes),
    endTime: minutesToTime(appointment.endMinutes),
    durationMinutes: appointment.endMinutes - appointment.startMinutes,
    status: appointment.status as AppointmentStatus,
    notes: appointment.notes ?? "",
    cancellationReason: appointment.cancellationReason ?? "",
    createdAt: appointment.createdAt.toISOString(),
  };
}

const POPULATE = [
  { path: "patientId", select: "firstName lastName patientNumber phone" },
  { path: "doctorId", select: "displayName" },
  { path: "departmentId", select: "name" },
  { path: "treatmentId", select: "name" },
] as const;

// ---------------------------------------------------------------------------
// Relationship validation (Sections 10, 21)
// ---------------------------------------------------------------------------

type ResolvedRefs = {
  patientId: string;
  doctorId: string;
  departmentId: string;
  treatmentId: string | null;
  doctor: {
    availability: Array<{ dayOfWeek: number; startMinutes: number; endMinutes: number }>;
    status: string;
    departmentIds: unknown[];
  };
};

/**
 * Resolves all four references WITHIN the caller's tenant.
 *
 * This is the check Section 21 calls for: a Hospital A patient with a Hospital B
 * doctor must be impossible. Each lookup is scoped by hospitalId, so a foreign
 * id simply finds nothing and 404s — which also avoids confirming that the
 * other tenant's record exists.
 */
async function resolveReferences(
  refs: {
    patientId: string;
    doctorId: string;
    departmentId: string;
    treatmentId?: string | null;
  },
  hospitalId: string,
): Promise<ResolvedRefs> {
  const [patient, doctor, department] = await Promise.all([
    assertBelongsToTenant(Patient, refs.patientId, hospitalId, "Patient"),
    assertBelongsToTenant(Doctor, refs.doctorId, hospitalId, "Doctor"),
    assertBelongsToTenant(Department, refs.departmentId, hospitalId, "Department"),
  ]);

  let treatmentId: string | null = null;
  if (refs.treatmentId) {
    const treatment = await assertBelongsToTenant(
      Treatment,
      refs.treatmentId,
      hospitalId,
      "Treatment",
    );

    /**
     * A treatment belongs to exactly one department, so booking it under a
     * different one would produce an internally inconsistent record.
     */
    if (String(treatment.departmentId) !== String(department._id)) {
      throw ApiError.validation(
        "That treatment belongs to a different department.",
        { fields: { treatmentId: "Treatment is not offered by this department." } },
      );
    }

    if (treatment.status !== "active") {
      throw ApiError.validation("That treatment is not currently offered.", {
        fields: { treatmentId: "This treatment is inactive." },
      });
    }

    treatmentId = String(treatment._id);
  }

  if (doctor.status !== "active") {
    throw ApiError.validation("That doctor is not currently available.", {
      fields: { doctorId: "This doctor is inactive." },
    });
  }

  if (department.status !== "active") {
    throw ApiError.validation("That department is not currently active.", {
      fields: { departmentId: "This department is inactive." },
    });
  }

  return {
    patientId: String(patient._id),
    doctorId: String(doctor._id),
    departmentId: String(department._id),
    treatmentId,
    doctor: {
      availability: doctor.availability ?? [],
      status: doctor.status,
      departmentIds: doctor.departmentIds ?? [],
    },
  };
}

/**
 * Rejects a booking that falls outside the doctor's configured working hours.
 *
 * Only enforced when the doctor HAS availability configured — an empty schedule
 * means "no constraint recorded", not "never available", so hospitals that do
 * not track rotas are unaffected.
 */
function assertWithinAvailability(
  availability: ResolvedRefs["doctor"]["availability"],
  date: string,
  startMinutes: number,
  endMinutes: number,
): void {
  if (availability.length === 0) return;

  const weekday = dayOfWeek(date);
  const windows = availability.filter((window) => window.dayOfWeek === weekday);

  if (windows.length === 0) {
    throw ApiError.validation(
      `That doctor does not work on ${WEEKDAY_NAMES[weekday]}s.`,
      { fields: { appointmentDate: "Outside the doctor's working days." } },
    );
  }

  const fits = windows.some(
    (window) =>
      startMinutes >= window.startMinutes && endMinutes <= window.endMinutes,
  );

  if (!fits) {
    const hours = windows
      .map((w) => `${minutesToTime(w.startMinutes)}–${minutesToTime(w.endMinutes)}`)
      .join(", ");
    throw ApiError.validation(
      `That time is outside the doctor's hours on ${WEEKDAY_NAMES[weekday]} (${hours}).`,
      { fields: { startTime: "Outside the doctor's working hours." } },
    );
  }
}

/**
 * Prevents double-booking a doctor.
 *
 * Cancelled and no-show appointments release their slot, so the same time can
 * legitimately be rebooked. Overlap uses half-open intervals, which means a
 * 09:00–10:00 booking does not collide with 10:00–11:00.
 */
async function assertNoConflict(
  hospitalId: string,
  doctorId: string,
  date: string,
  startMinutes: number,
  endMinutes: number,
  excludeAppointmentId?: string,
): Promise<void> {
  const filter = tenantScoped(hospitalId, {
    doctorId,
    appointmentDate: date,
    status: mongoose.trusted({ $nin: [...RELEASING_STATUSES] }),
    // Overlap in a single indexed query rather than loading the whole day.
    startMinutes: mongoose.trusted({ $lt: endMinutes }),
    endMinutes: mongoose.trusted({ $gt: startMinutes }),
    ...(excludeAppointmentId
      ? { _id: mongoose.trusted({ $ne: new mongoose.Types.ObjectId(excludeAppointmentId) }) }
      : {}),
  });

  const clash = await Appointment.findOne(filter)
    .select("startMinutes endMinutes")
    .lean();

  if (clash) {
    throw ApiError.conflict(
      `That doctor already has an appointment from ${minutesToTime(
        clash.startMinutes,
      )} to ${minutesToTime(clash.endMinutes)} on this date.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listAppointments(
  hospitalId: string,
  params: {
    page: number;
    pageSize: number;
    status?: AppointmentStatus;
    doctorId?: string;
    patientId?: string;
    departmentId?: string;
    from?: string;
    to?: string;
    /**
     * The caller's own doctor profile, when they are a clinician. Narrows the
     * list to their own bookings — see lib/rbac/doctor-scope.ts.
     */
    viewerDoctorId?: string | null;
  },
): Promise<Paginated<AppointmentSummary>> {
  await connectToDatabase();

  const dateRange: Record<string, string> = {};
  if (params.from) dateRange.$gte = params.from;
  if (params.to) dateRange.$lte = params.to;

  const filter = tenantScoped(hospitalId, {
    ...(params.status ? { status: params.status } : {}),
    ...(params.doctorId ? { doctorId: params.doctorId } : {}),
    ...(params.patientId ? { patientId: params.patientId } : {}),
    ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    // `YYYY-MM-DD` sorts and compares correctly as a plain string.
    ...(Object.keys(dateRange).length > 0
      ? { appointmentDate: mongoose.trusted(dateRange) }
      : {}),
    /**
     * Applied LAST so it overrides any `doctorId` the caller asked for. A
     * clinician filtering by a colleague must still see only their own —
     * otherwise the narrowing would be a UI default rather than a rule.
     */
    ...(params.viewerDoctorId ? { doctorId: params.viewerDoctorId } : {}),
  });

  const [appointments, total] = await Promise.all([
    Appointment.find(filter)
      .sort({ appointmentDate: 1, startMinutes: 1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .populate(POPULATE as never)
      .lean(),
    Appointment.countDocuments(filter),
  ]);

  return {
    items: appointments.map((appointment) =>
      toSummary(appointment as never),
    ),
    ...paginationMeta(params, total),
  };
}

export async function getAppointment(
  appointmentId: string,
  hospitalId: string,
): Promise<AppointmentSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(
    Appointment,
    appointmentId,
    hospitalId,
    "Appointment",
  );

  const appointment = await Appointment.findOne(
    tenantScoped(hospitalId, { _id: appointmentId }),
  )
    .populate(POPULATE as never)
    .lean();

  if (!appointment) throw ApiError.notFound("Appointment not found.");

  return toSummary(appointment as never);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createAppointment(
  input: CreateAppointmentInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<AppointmentSummary> {
  await connectToDatabase();

  const refs = await resolveReferences(input, actor.hospitalId);

  // Non-null: the schema already validated the HH:mm format.
  const startMinutes = timeToMinutes(input.startTime)!;
  const endMinutes = timeToMinutes(input.endTime)!;

  assertWithinAvailability(
    refs.doctor.availability,
    input.appointmentDate,
    startMinutes,
    endMinutes,
  );

  await assertNoConflict(
    actor.hospitalId,
    refs.doctorId,
    input.appointmentDate,
    startMinutes,
    endMinutes,
  );

  let appointment;
  try {
    appointment = await Appointment.create({
      hospitalId: actor.hospitalId,
      patientId: refs.patientId,
      doctorId: refs.doctorId,
      departmentId: refs.departmentId,
      treatmentId: refs.treatmentId,
      appointmentDate: input.appointmentDate,
      startMinutes,
      endMinutes,
      status: input.status,
      notes: input.notes,
      createdBy: actor.userId,
      occupiesSlot: !RELEASING_STATUSES.includes(input.status),
    });
  } catch (error) {
    /**
     * The unique index rejected an identical slot. That means a concurrent
     * request won the race between our overlap check and this insert — the
     * caller should see the same conflict either way.
     */
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict(
        "That doctor was just booked for this time by someone else.",
      );
    }
    throw error;
  }

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "appointment.created",
    resource: "Appointment",
    resourceId: String(appointment._id),
    metadata: {
      appointmentDate: input.appointmentDate,
      startTime: input.startTime,
      doctorId: refs.doctorId,
    },
    meta,
  });

  return getAppointment(String(appointment._id), actor.hospitalId);
}

export async function updateAppointment(
  appointmentId: string,
  input: UpdateAppointmentInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<AppointmentSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(
    Appointment,
    appointmentId,
    actor.hospitalId,
    "Appointment",
  );

  const appointment = await Appointment.findOne(
    tenantScoped(actor.hospitalId, { _id: appointmentId }),
  );
  if (!appointment) throw ApiError.notFound("Appointment not found.");

  if (TERMINAL_STATUSES.includes(appointment.status as AppointmentStatus)) {
    throw ApiError.conflict(
      `A ${appointment.status.replace("_", " ")} appointment cannot be changed. Create a new one instead.`,
    );
  }

  // Every reference is re-validated against the tenant on every edit, so an
  // appointment can never be walked across a tenant boundary field by field.
  const refs = await resolveReferences(
    {
      patientId: input.patientId ?? String(appointment.patientId),
      doctorId: input.doctorId ?? String(appointment.doctorId),
      departmentId: input.departmentId ?? String(appointment.departmentId),
      treatmentId:
        input.treatmentId === undefined
          ? appointment.treatmentId
            ? String(appointment.treatmentId)
            : null
          : input.treatmentId,
    },
    actor.hospitalId,
  );

  const startMinutes =
    input.startTime !== undefined
      ? timeToMinutes(input.startTime)!
      : appointment.startMinutes;
  const endMinutes =
    input.endTime !== undefined
      ? timeToMinutes(input.endTime)!
      : appointment.endMinutes;
  const appointmentDate = input.appointmentDate ?? appointment.appointmentDate;

  assertWithinAvailability(
    refs.doctor.availability,
    appointmentDate,
    startMinutes,
    endMinutes,
  );

  // Excludes itself, so saving an unchanged appointment does not self-conflict.
  await assertNoConflict(
    actor.hospitalId,
    refs.doctorId,
    appointmentDate,
    startMinutes,
    endMinutes,
    appointmentId,
  );

  appointment.patientId = new mongoose.Types.ObjectId(refs.patientId);
  appointment.doctorId = new mongoose.Types.ObjectId(refs.doctorId);
  appointment.departmentId = new mongoose.Types.ObjectId(refs.departmentId);
  appointment.treatmentId = refs.treatmentId
    ? new mongoose.Types.ObjectId(refs.treatmentId)
    : null;
  appointment.appointmentDate = appointmentDate;
  appointment.startMinutes = startMinutes;
  appointment.endMinutes = endMinutes;
  if (input.notes !== undefined) appointment.notes = input.notes;

  await appointment.save();

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "appointment.updated",
    resource: "Appointment",
    resourceId: appointmentId,
    metadata: { fields: Object.keys(input), appointmentDate },
    meta,
  });

  return getAppointment(appointmentId, actor.hospitalId);
}

/**
 * Moves an appointment through its lifecycle, enforcing the transition table.
 */
export async function changeAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
  cancellationReason: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<AppointmentSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(
    Appointment,
    appointmentId,
    actor.hospitalId,
    "Appointment",
  );

  const appointment = await Appointment.findOne(
    tenantScoped(actor.hospitalId, { _id: appointmentId }),
  );
  if (!appointment) throw ApiError.notFound("Appointment not found.");

  const current = appointment.status as AppointmentStatus;
  if (current === status) return getAppointment(appointmentId, actor.hospitalId);

  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed.includes(status)) {
    throw ApiError.conflict(
      allowed.length === 0
        ? `This appointment is ${current.replace("_", " ")} and can no longer change.`
        : `Cannot move an appointment from ${current.replace("_", " ")} to ${status.replace("_", " ")}.`,
    );
  }

  appointment.status = status;
  // Cancelled and no-show release the slot, freeing it for rebooking.
  appointment.occupiesSlot = !RELEASING_STATUSES.includes(status);
  if (status === "cancelled") {
    appointment.cancellationReason = cancellationReason;
  }

  await appointment.save();

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action:
      status === "cancelled" ? "appointment.cancelled" : "appointment.status_changed",
    resource: "Appointment",
    resourceId: appointmentId,
    metadata: { from: current, to: status },
    meta,
  });

  /**
   * Completing an appointment raises its draft invoice — the consultation fee
   * plus whatever treatment was booked.
   *
   * Deliberately non-fatal. The appointment is already saved by this point, and
   * a billing problem (a deleted treatment, a counter collision) must not make
   * a clinician unable to record that care was delivered. A failure here leaves
   * the appointment correctly completed and no invoice, which staff can raise
   * by hand; the alternative — refusing the status change — would be worse.
   */
  if (status === "completed") {
    try {
      await generateInvoiceForCompletedAppointment(appointmentId, actor, meta);
    } catch (error) {
      console.error(
        `[appointment] could not auto-generate an invoice for ${appointmentId}:`,
        error,
      );
    }
  }

  return getAppointment(appointmentId, actor.hospitalId);
}

export async function deleteAppointment(
  appointmentId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  await connectToDatabase();

  const appointment = await assertBelongsToTenant(
    Appointment,
    appointmentId,
    actor.hospitalId,
    "Appointment",
  );

  // A consultation record must not be orphaned from the booking it came from.
  const visitCount = await Visit.countDocuments(
    tenantScoped(actor.hospitalId, { appointmentId }),
  );

  if (visitCount > 0) {
    throw ApiError.conflict(
      "A visit has been recorded for this appointment. Cancel it instead of deleting it.",
    );
  }

  await Appointment.deleteOne(
    tenantScoped(actor.hospitalId, { _id: appointmentId }),
  );

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "appointment.deleted",
    resource: "Appointment",
    resourceId: appointmentId,
    metadata: { appointmentDate: appointment.appointmentDate },
    meta,
  });
}
