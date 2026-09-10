import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import {
  Appointment,
  Department,
  Doctor,
  Hospital,
  Prescription,
  User,
  Visit,
} from "@/models";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import {
  assertBelongsToTenant,
  paginationMeta,
  paginationSkip,
  regexSearch,
  tenantScoped,
} from "@/lib/tenant/scope";
import {
  DEFAULT_CURRENCY,
  formatMoney,
  hasValidPrecision,
  toMajorUnits,
  toMinorUnits,
} from "@/utils/money";
import { minutesToTime, timeToMinutes } from "@/utils/time";
import type {
  CreateDoctorInput,
  UpdateDoctorInput,
} from "@/schemas/doctor.schema";
import type { EntityStatus, Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

export type AvailabilityWindow = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

export type DoctorSummary = {
  id: string;
  displayName: string;
  specialization: string;
  userId: string | null;
  linkedAccount: { id: string; name: string; email: string } | null;
  departments: Array<{ id: string; name: string }>;
  consultationFee: number;
  consultationFeeMinor: number;
  currency: string;
  consultationFeeFormatted: string;
  availability: AvailabilityWindow[];
  status: EntityStatus;
  createdAt: string;
};

type Actor = { userId: string; hospitalId: string };

async function hospitalCurrency(hospitalId: string): Promise<string> {
  const hospital = await Hospital.findById(hospitalId).select("currency").lean();
  return hospital?.currency ?? DEFAULT_CURRENCY;
}

function toSummary(
  doctor: {
    _id: unknown;
    displayName: string;
    specialization?: string | null;
    userId?: unknown;
    departmentIds?: unknown[];
    consultationFeeMinor: number;
    availability?: Array<{
      dayOfWeek: number;
      startMinutes: number;
      endMinutes: number;
    }>;
    status: string;
    createdAt: Date;
  },
  currency: string,
  departments: Array<{ id: string; name: string }>,
  linkedAccount: { id: string; name: string; email: string } | null,
): DoctorSummary {
  return {
    id: String(doctor._id),
    displayName: doctor.displayName,
    specialization: doctor.specialization ?? "",
    userId: doctor.userId ? String(doctor.userId) : null,
    linkedAccount,
    departments,
    consultationFee: toMajorUnits(doctor.consultationFeeMinor, currency),
    consultationFeeMinor: doctor.consultationFeeMinor,
    currency,
    consultationFeeFormatted: formatMoney(doctor.consultationFeeMinor, currency),
    availability: (doctor.availability ?? []).map((window) => ({
      dayOfWeek: window.dayOfWeek,
      startTime: minutesToTime(window.startMinutes),
      endTime: minutesToTime(window.endMinutes),
    })),
    status: doctor.status as EntityStatus,
    createdAt: doctor.createdAt.toISOString(),
  };
}

function feeToMinor(fee: number, currency: string): number {
  if (!hasValidPrecision(fee, currency)) {
    throw ApiError.validation("That fee has too many decimal places.", {
      fields: { consultationFee: `Fee must match the precision of ${currency}.` },
    });
  }
  return toMinorUnits(fee, currency);
}

function availabilityToStored(
  availability: Array<{ dayOfWeek: number; startTime: string; endTime: string }>,
) {
  return availability.map((window) => ({
    dayOfWeek: window.dayOfWeek,
    // The schema already validated the format, so these cannot be null.
    startMinutes: timeToMinutes(window.startTime)!,
    endMinutes: timeToMinutes(window.endTime)!,
  }));
}

/**
 * Cross-tenant relationship validation for every department a doctor is
 * assigned to (Section 10). One id from another hospital fails the whole
 * operation rather than being silently dropped.
 */
async function resolveDepartments(
  departmentIds: readonly string[],
  hospitalId: string,
): Promise<Array<{ id: string; name: string }>> {
  const resolved: Array<{ id: string; name: string }> = [];

  for (const departmentId of departmentIds) {
    const department = await assertBelongsToTenant(
      Department,
      departmentId,
      hospitalId,
      "Department",
    );
    resolved.push({ id: String(department._id), name: department.name });
  }

  return resolved;
}

/** The linked staff account must belong to the same hospital. */
async function resolveLinkedAccount(
  userId: string | null | undefined,
  hospitalId: string,
): Promise<{ id: string; name: string; email: string } | null> {
  if (!userId) return null;

  const user = await assertBelongsToTenant(User, userId, hospitalId, "Staff account");

  return { id: String(user._id), name: user.name, email: user.email };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listDoctors(
  hospitalId: string,
  params: {
    page: number;
    pageSize: number;
    search?: string;
    status?: EntityStatus;
    departmentId?: string;
  },
): Promise<Paginated<DoctorSummary>> {
  await connectToDatabase();

  const filter = tenantScoped(hospitalId, {
    ...(params.status ? { status: params.status } : {}),
    // Matches against the array — a doctor in several departments is found by
    // any one of them.
    ...(params.departmentId ? { departmentIds: params.departmentId } : {}),
    ...(params.search
      ? {
          $or: [
            { displayName: regexSearch(params.search) },
            { specialization: regexSearch(params.search) },
          ],
        }
      : {}),
  });

  const [doctors, total, currency] = await Promise.all([
    Doctor.find(filter)
      .sort({ displayName: 1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .populate<{ departmentIds: Array<{ _id: unknown; name: string }> }>(
        "departmentIds",
        "name",
      )
      .populate<{ userId: { _id: unknown; name: string; email: string } | null }>(
        "userId",
        "name email",
      )
      .lean(),
    Doctor.countDocuments(filter),
    hospitalCurrency(hospitalId),
  ]);

  return {
    items: doctors.map((doctor) =>
      toSummary(
        doctor,
        currency,
        (doctor.departmentIds ?? []).map((department) => ({
          id: String(department._id),
          name: department.name,
        })),
        doctor.userId
          ? {
              id: String(doctor.userId._id),
              name: doctor.userId.name,
              email: doctor.userId.email,
            }
          : null,
      ),
    ),
    ...paginationMeta(params, total),
  };
}

export async function getDoctor(
  doctorId: string,
  hospitalId: string,
): Promise<DoctorSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(Doctor, doctorId, hospitalId, "Doctor");

  const [doctor, currency] = await Promise.all([
    Doctor.findOne(tenantScoped(hospitalId, { _id: doctorId }))
      .populate<{ departmentIds: Array<{ _id: unknown; name: string }> }>(
        "departmentIds",
        "name",
      )
      .populate<{ userId: { _id: unknown; name: string; email: string } | null }>(
        "userId",
        "name email",
      )
      .lean(),
    hospitalCurrency(hospitalId),
  ]);

  if (!doctor) throw ApiError.notFound("Doctor not found.");

  return toSummary(
    doctor,
    currency,
    (doctor.departmentIds ?? []).map((department) => ({
      id: String(department._id),
      name: department.name,
    })),
    doctor.userId
      ? {
          id: String(doctor.userId._id),
          name: doctor.userId.name,
          email: doctor.userId.email,
        }
      : null,
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createDoctor(
  input: CreateDoctorInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<DoctorSummary> {
  await connectToDatabase();

  const departments = await resolveDepartments(
    input.departmentIds,
    actor.hospitalId,
  );
  const linkedAccount = await resolveLinkedAccount(
    input.userId,
    actor.hospitalId,
  );

  const currency = await hospitalCurrency(actor.hospitalId);

  try {
    const doctor = await Doctor.create({
      hospitalId: actor.hospitalId,
      userId: linkedAccount ? linkedAccount.id : null,
      displayName: input.displayName,
      specialization: input.specialization,
      departmentIds: departments.map((department) => department.id),
      consultationFeeMinor: feeToMinor(input.consultationFee, currency),
      availability: availabilityToStored(input.availability),
      status: input.status,
    });

    await recordAudit({
      hospitalId: actor.hospitalId,
      userId: actor.userId,
      action: "doctor.created",
      resource: "Doctor",
      resourceId: String(doctor._id),
      metadata: {
        displayName: doctor.displayName,
        departmentCount: departments.length,
      },
      meta,
    });

    return toSummary(doctor, currency, departments, linkedAccount);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict(
        "That staff account is already linked to another doctor profile.",
      );
    }
    throw error;
  }
}

export async function updateDoctor(
  doctorId: string,
  input: UpdateDoctorInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<DoctorSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(Doctor, doctorId, actor.hospitalId, "Doctor");

  const doctor = await Doctor.findOne(
    tenantScoped(actor.hospitalId, { _id: doctorId }),
  );
  if (!doctor) throw ApiError.notFound("Doctor not found.");

  const currency = await hospitalCurrency(actor.hospitalId);

  if (input.departmentIds !== undefined) {
    const departments = await resolveDepartments(
      input.departmentIds,
      actor.hospitalId,
    );
    doctor.departmentIds = departments.map(
      (department) => new mongoose.Types.ObjectId(department.id),
    );
  }

  if (input.userId !== undefined) {
    const linkedAccount = await resolveLinkedAccount(
      input.userId,
      actor.hospitalId,
    );
    doctor.userId = linkedAccount
      ? new mongoose.Types.ObjectId(linkedAccount.id)
      : null;
  }

  if (input.displayName !== undefined) doctor.displayName = input.displayName;
  if (input.specialization !== undefined) {
    doctor.specialization = input.specialization;
  }
  if (input.consultationFee !== undefined) {
    doctor.consultationFeeMinor = feeToMinor(input.consultationFee, currency);
  }
  if (input.availability !== undefined) {
    // `set` rather than direct assignment: `availability` is a Mongoose
    // DocumentArray, and assigning a plain array bypasses its casting.
    doctor.set("availability", availabilityToStored(input.availability));
  }
  if (input.status !== undefined) doctor.status = input.status;

  try {
    await doctor.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict(
        "That staff account is already linked to another doctor profile.",
      );
    }
    throw error;
  }

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "doctor.updated",
    resource: "Doctor",
    resourceId: doctorId,
    metadata: { fields: Object.keys(input), displayName: doctor.displayName },
    meta,
  });

  return getDoctor(doctorId, actor.hospitalId);
}

export async function deleteDoctor(
  doctorId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  await connectToDatabase();

  const doctor = await assertBelongsToTenant(
    Doctor,
    doctorId,
    actor.hospitalId,
    "Doctor",
  );

  const [appointmentCount, visitCount, prescriptionCount] = await Promise.all([
    Appointment.countDocuments(tenantScoped(actor.hospitalId, { doctorId })),
    Visit.countDocuments(tenantScoped(actor.hospitalId, { doctorId })),
    // Already implied by the visit count — every prescription has a visit —
    // but named separately so the message says what is on the record.
    Prescription.countDocuments(tenantScoped(actor.hospitalId, { doctorId })),
  ]);

  if (appointmentCount > 0 || visitCount > 0 || prescriptionCount > 0) {
    const parts = [
      appointmentCount > 0
        ? `${appointmentCount} ${appointmentCount === 1 ? "appointment" : "appointments"}`
        : null,
      visitCount > 0
        ? `${visitCount} ${visitCount === 1 ? "visit" : "visits"}`
        : null,
      prescriptionCount > 0
        ? `${prescriptionCount} ${prescriptionCount === 1 ? "prescription" : "prescriptions"}`
        : null,
    ].filter(Boolean);

    throw ApiError.conflict(
      `This doctor has ${parts.join(" and ")} on record. Deactivate the doctor instead to remove them from new bookings.`,
    );
  }

  await Doctor.deleteOne(tenantScoped(actor.hospitalId, { _id: doctorId }));

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "doctor.deleted",
    resource: "Doctor",
    resourceId: doctorId,
    metadata: { displayName: doctor.displayName },
    meta,
  });
}
