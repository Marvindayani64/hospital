import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { Appointment, Invoice, Patient, Prescription, Visit } from "@/models";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import { formatReference, nextSequence } from "@/services/counter.service";
import {
  assertBelongsToTenant,
  escapeRegex,
  paginationMeta,
  paginationSkip,
  tenantScoped,
} from "@/lib/tenant/scope";
import type {
  CreatePatientInput,
  UpdatePatientInput,
} from "@/schemas/patient.schema";
import type { Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

export type PatientSummary = {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  email: string;
  dateOfBirth: string | null;
  age: number | null;
  gender: string;
  address: string;
  emergencyContact: { name: string; relationship: string; phone: string };
  notes: string;
  createdAt: string;
};

type Actor = { userId: string; hospitalId: string };

/** Whole years elapsed, accounting for whether this year's birthday has passed. */
function calculateAge(dateOfBirth: Date | null): number | null {
  if (!dateOfBirth) return null;

  const now = new Date();
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();

  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }

  return age >= 0 && age < 150 ? age : null;
}

function toSummary(patient: {
  _id: unknown;
  patientNumber: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  address?: string | null;
  emergencyContact?: {
    name?: string | null;
    relationship?: string | null;
    phone?: string | null;
  } | null;
  notes?: string | null;
  createdAt: Date;
}): PatientSummary {
  const dateOfBirth = patient.dateOfBirth ?? null;

  return {
    id: String(patient._id),
    patientNumber: patient.patientNumber,
    firstName: patient.firstName,
    lastName: patient.lastName,
    fullName: `${patient.firstName} ${patient.lastName}`.trim(),
    phone: patient.phone,
    email: patient.email ?? "",
    dateOfBirth: dateOfBirth
      ? dateOfBirth.toISOString().slice(0, 10)
      : null,
    age: calculateAge(dateOfBirth),
    gender: patient.gender ?? "prefer_not_to_say",
    address: patient.address ?? "",
    emergencyContact: {
      name: patient.emergencyContact?.name ?? "",
      relationship: patient.emergencyContact?.relationship ?? "",
      phone: patient.emergencyContact?.phone ?? "",
    },
    notes: patient.notes ?? "",
    createdAt: patient.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listPatients(
  hospitalId: string,
  params: { page: number; pageSize: number; search?: string },
): Promise<Paginated<PatientSummary>> {
  await connectToDatabase();

  /**
   * Front-desk staff search by whatever they have to hand — a name, a phone
   * number, or the patient's reference from a card or letter.
   */
  const filter = tenantScoped(
    hospitalId,
    params.search
      ? {
          $or: [
            { firstName: mongoose.trusted({ $regex: escapeRegex(params.search), $options: "i" }) },
            { lastName: mongoose.trusted({ $regex: escapeRegex(params.search), $options: "i" }) },
            { phone: mongoose.trusted({ $regex: escapeRegex(params.search), $options: "i" }) },
            { patientNumber: mongoose.trusted({ $regex: escapeRegex(params.search), $options: "i" }) },
            { email: mongoose.trusted({ $regex: escapeRegex(params.search), $options: "i" }) },
          ],
        }
      : {},
  );

  const [patients, total] = await Promise.all([
    Patient.find(filter)
      .sort({ lastName: 1, firstName: 1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .lean(),
    Patient.countDocuments(filter),
  ]);

  return {
    items: patients.map(toSummary),
    ...paginationMeta(params, total),
  };
}

export async function getPatient(
  patientId: string,
  hospitalId: string,
): Promise<PatientSummary> {
  await connectToDatabase();

  const patient = await assertBelongsToTenant(
    Patient,
    patientId,
    hospitalId,
    "Patient",
  );

  return toSummary(patient);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createPatient(
  input: CreatePatientInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PatientSummary> {
  await connectToDatabase();

  /**
   * The patient number comes from a per-tenant atomic counter rather than
   * `count() + 1`, so two receptionists registering patients at the same moment
   * cannot be handed the same number (Section 19 note).
   *
   * The retry loop is belt-and-braces: the unique index is the real guarantee,
   * and a collision could only arise from numbers created before this counter
   * existed. Re-reading the sequence resolves it rather than failing the
   * registration.
   */
  for (let attempt = 0; attempt < 5; attempt++) {
    const seq = await nextSequence(actor.hospitalId, "patient");
    const patientNumber = formatReference("PAT", seq);

    try {
      const patient = await Patient.create({
        hospitalId: actor.hospitalId,
        patientNumber,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        email: input.email,
        dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00Z`) : null,
        gender: input.gender,
        address: input.address,
        emergencyContact: input.emergencyContact,
        notes: input.notes,
      });

      await recordAudit({
        hospitalId: actor.hospitalId,
        userId: actor.userId,
        action: "patient.created",
        resource: "Patient",
        resourceId: String(patient._id),
        // Deliberately minimal: an audit trail should not duplicate the medical
        // record it is describing.
        metadata: { patientNumber },
        meta,
      });

      return toSummary(patient);
    } catch (error) {
      if (isDuplicateKeyError(error)) continue;
      throw error;
    }
  }

  throw ApiError.conflict(
    "Could not allocate a patient number. Please try again.",
  );
}

export async function updatePatient(
  patientId: string,
  input: UpdatePatientInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PatientSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(Patient, patientId, actor.hospitalId, "Patient");

  const patient = await Patient.findOne(
    tenantScoped(actor.hospitalId, { _id: patientId }),
  );
  if (!patient) throw ApiError.notFound("Patient not found.");

  if (input.firstName !== undefined) patient.firstName = input.firstName;
  if (input.lastName !== undefined) patient.lastName = input.lastName;
  if (input.phone !== undefined) patient.phone = input.phone;
  if (input.email !== undefined) patient.email = input.email;
  if (input.dateOfBirth !== undefined) {
    patient.dateOfBirth = input.dateOfBirth
      ? new Date(`${input.dateOfBirth}T00:00:00Z`)
      : null;
  }
  if (input.gender !== undefined) patient.gender = input.gender;
  if (input.address !== undefined) patient.address = input.address;
  if (input.emergencyContact !== undefined) {
    patient.emergencyContact = input.emergencyContact;
  }
  if (input.notes !== undefined) patient.notes = input.notes;

  await patient.save();

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "patient.updated",
    resource: "Patient",
    resourceId: patientId,
    metadata: { fields: Object.keys(input), patientNumber: patient.patientNumber },
    meta,
  });

  return toSummary(patient);
}

/**
 * Deletes a patient, refusing while appointments still reference them.
 *
 * Medical records should very rarely be destroyed; the guard makes the
 * destructive path explicit rather than silently orphaning history.
 */
export async function deletePatient(
  patientId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  await connectToDatabase();

  const patient = await assertBelongsToTenant(
    Patient,
    patientId,
    actor.hospitalId,
    "Patient",
  );

  const [appointmentCount, visitCount, invoiceCount, prescriptionCount] =
    await Promise.all([
      Appointment.countDocuments(tenantScoped(actor.hospitalId, { patientId })),
      Visit.countDocuments(tenantScoped(actor.hospitalId, { patientId })),
      Invoice.countDocuments(tenantScoped(actor.hospitalId, { patientId })),
      /**
       * Every prescription has a visit, so the visit count above already blocks
       * this case. Counted anyway so the message names what is actually on the
       * record, and so the guard does not depend on that invariant holding.
       */
      Prescription.countDocuments(tenantScoped(actor.hospitalId, { patientId })),
    ]);

  const blockers: string[] = [];
  if (appointmentCount > 0) {
    blockers.push(
      `${appointmentCount} ${appointmentCount === 1 ? "appointment" : "appointments"}`,
    );
  }
  if (visitCount > 0) {
    blockers.push(`${visitCount} ${visitCount === 1 ? "visit" : "visits"}`);
  }
  if (invoiceCount > 0) {
    blockers.push(
      `${invoiceCount} ${invoiceCount === 1 ? "invoice" : "invoices"}`,
    );
  }
  if (prescriptionCount > 0) {
    blockers.push(
      `${prescriptionCount} ${prescriptionCount === 1 ? "prescription" : "prescriptions"}`,
    );
  }

  if (blockers.length > 0) {
    throw ApiError.conflict(
      `This patient has ${blockers.join(", ")} on record. Their clinical history must be removed before the patient can be deleted.`,
    );
  }

  await Patient.deleteOne(tenantScoped(actor.hospitalId, { _id: patientId }));

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "patient.deleted",
    resource: "Patient",
    resourceId: patientId,
    metadata: { patientNumber: patient.patientNumber },
    meta,
  });
}
