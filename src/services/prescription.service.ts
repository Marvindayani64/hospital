import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import {
  Appointment,
  Doctor,
  Patient,
  Prescription,
  Visit,
  type PrescriptionStatus,
} from "@/models";
import { SETTLED_PRESCRIPTION_STATUSES } from "@/models/Prescription";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import {
  assertBelongsToTenant,
  paginationMeta,
  paginationSkip,
  regexSearch,
  tenantScoped,
} from "@/lib/tenant/scope";
import type {
  CreatePrescriptionInput,
  DispensePrescriptionInput,
} from "@/schemas/prescription.schema";
import type { Paginated } from "@/types";
import { minutesToTime } from "@/utils/time";
import type { RequestMeta } from "@/utils/request";

export type PrescriptionItem = {
  drugName: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
};

export type PrescriptionSummary = {
  id: string;
  patient: { id: string; name: string; patientNumber: string; phone: string } | null;
  doctor: { id: string; name: string } | null;
  visitId: string;
  prescribedDate: string;
  items: PrescriptionItem[];
  notes: string;
  status: PrescriptionStatus;
  dispensedBy: { id: string; name: string } | null;
  dispensedAt: string | null;
  dispensingNotes: string;
  createdAt: string;
  updatedAt: string;
};

type Actor = { userId: string; hospitalId: string };

function ref<T extends Record<string, unknown>>(value: unknown): T | null {
  return value && typeof value === "object" && "_id" in (value as object)
    ? (value as T)
    : null;
}

function toSummary(prescription: {
  _id: unknown;
  patientId: unknown;
  doctorId: unknown;
  visitId: unknown;
  prescribedDate: string;
  items?: Array<Partial<PrescriptionItem>> | null;
  notes?: string | null;
  status: string;
  dispensedBy?: unknown;
  dispensedAt?: Date | null;
  dispensingNotes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PrescriptionSummary {
  const patient = ref<{
    _id: unknown;
    firstName: string;
    lastName: string;
    patientNumber: string;
    phone: string;
  }>(prescription.patientId);

  const doctor = ref<{ _id: unknown; displayName: string }>(prescription.doctorId);
  const dispensedBy = ref<{ _id: unknown; name?: string; email?: string }>(
    prescription.dispensedBy,
  );

  return {
    id: String(prescription._id),
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
    visitId: String(prescription.visitId),
    prescribedDate: prescription.prescribedDate,
    items: (prescription.items ?? []).map((item) => ({
      drugName: item.drugName ?? "",
      dosage: item.dosage ?? "",
      frequency: item.frequency ?? "",
      duration: item.duration ?? "",
      instructions: item.instructions ?? "",
    })),
    notes: prescription.notes ?? "",
    status: prescription.status as PrescriptionStatus,
    dispensedBy: dispensedBy
      ? {
          id: String(dispensedBy._id),
          name: dispensedBy.name || dispensedBy.email || "Unknown",
        }
      : null,
    dispensedAt: prescription.dispensedAt
      ? prescription.dispensedAt.toISOString()
      : null,
    dispensingNotes: prescription.dispensingNotes ?? "",
    createdAt: prescription.createdAt.toISOString(),
    updatedAt: prescription.updatedAt.toISOString(),
  };
}

const POPULATE = [
  { path: "patientId", select: "firstName lastName patientNumber phone" },
  { path: "doctorId", select: "displayName" },
  { path: "dispensedBy", select: "name email" },
] as const;

// ---------------------------------------------------------------------------
// Recording the consultation (the "automatic visit")
// ---------------------------------------------------------------------------

/**
 * Returns the visit this prescription belongs on, creating it if the doctor has
 * not already written one up.
 *
 * A prescription is a clinical act, so it must sit on a clinical record — but
 * making the doctor record the visit first and then prescribe would be two
 * screens for one encounter. Instead the visit is recorded here, as part of
 * writing the prescription.
 *
 * It REUSES rather than always creating, because the doctor who has already
 * written up the consultation and then prescribes must not end up with two
 * visits for one encounter:
 *
 *   - with an appointment: the visit for that booking, if any. A booking can
 *     only ever have one visit (a partial unique index enforces it), so this is
 *     exact.
 *   - without one: that day's visit for the same patient AND the same doctor.
 *     Same patient with a different doctor is a different encounter and gets
 *     its own visit.
 *
 * The diagnosis is written only into an empty field. If the doctor already
 * recorded one, theirs stands — silently overwriting a clinical finding from a
 * prescription dialog would be worse than ignoring the second entry.
 */
async function recordVisitFor(
  refs: {
    patientId: string;
    doctorId: string;
    appointmentId: string | null;
    treatmentId: string | null;
  },
  prescribedDate: string,
  diagnosis: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<{ visitId: string; created: boolean }> {
  const existing = await Visit.findOne(
    tenantScoped(
      actor.hospitalId,
      refs.appointmentId
        ? { appointmentId: refs.appointmentId }
        : {
            patientId: refs.patientId,
            doctorId: refs.doctorId,
            visitDate: prescribedDate,
          },
    ),
  ).sort({ createdAt: -1 });

  if (existing) {
    if (diagnosis && !existing.diagnosis) {
      existing.diagnosis = diagnosis;
      await existing.save();
    }
    return { visitId: String(existing._id), created: false };
  }

  let visit;
  try {
    visit = await Visit.create({
      hospitalId: actor.hospitalId,
      patientId: refs.patientId,
      doctorId: refs.doctorId,
      appointmentId: refs.appointmentId,
      treatmentId: refs.treatmentId,
      visitDate: prescribedDate,
      diagnosis,
      createdBy: actor.userId,
    });
  } catch (error) {
    /**
     * Two prescriptions written against one booking at the same moment: both
     * saw no visit, both inserted, and the partial unique index let one win.
     * The loser wants the winner's visit, not an error — the encounter is the
     * same one either way.
     *
     * Only reachable on the appointment path; a walk-in has no such index, so
     * a genuine tie there produces two visits. That needs a transaction, and
     * therefore a replica set — the same limitation noted on the appointment
     * double-booking index.
     */
    if (isDuplicateKeyError(error) && refs.appointmentId) {
      const winner = await Visit.findOne(
        tenantScoped(actor.hospitalId, { appointmentId: refs.appointmentId }),
      );
      if (winner) return { visitId: String(winner._id), created: false };
    }
    throw error;
  }

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "visit.created",
    resource: "Visit",
    resourceId: String(visit._id),
    // Records that a consultation was written, never its clinical content.
    metadata: {
      patientId: refs.patientId,
      doctorId: refs.doctorId,
      visitDate: prescribedDate,
      // Distinguishes this from a visit typed on the visits screen.
      source: "prescription",
    },
    meta,
  });

  return { visitId: String(visit._id), created: true };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listPrescriptions(
  hospitalId: string,
  params: {
    page: number;
    pageSize: number;
    search?: string;
    status?: PrescriptionStatus;
    patientId?: string;
    doctorId?: string;
    from?: string;
    to?: string;
  },
): Promise<Paginated<PrescriptionSummary>> {
  await connectToDatabase();

  const dateRange: Record<string, string> = {};
  if (params.from) dateRange.$gte = params.from;
  if (params.to) dateRange.$lte = params.to;

  const filter = tenantScoped(hospitalId, {
    ...(params.status ? { status: params.status } : {}),
    ...(params.patientId ? { patientId: params.patientId } : {}),
    ...(params.doctorId ? { doctorId: params.doctorId } : {}),
    ...(Object.keys(dateRange).length > 0
      ? { prescribedDate: mongoose.trusted(dateRange) }
      : {}),
    // Searching the drug name is what the pharmacy actually needs — "who is
    // waiting on amoxicillin".
    ...(params.search ? { "items.drugName": regexSearch(params.search) } : {}),
  });

  const [prescriptions, total] = await Promise.all([
    Prescription.find(filter)
      /**
       * Oldest first: the queue is a queue. `createdAt` breaks ties within a
       * day so two prescriptions written the same morning keep their order.
       */
      .sort({ prescribedDate: 1, createdAt: 1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .populate(POPULATE as never)
      .lean(),
    Prescription.countDocuments(filter),
  ]);

  return {
    items: prescriptions.map((prescription) => toSummary(prescription as never)),
    ...paginationMeta(params, total),
  };
}

export async function getPrescription(
  prescriptionId: string,
  hospitalId: string,
): Promise<PrescriptionSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(
    Prescription,
    prescriptionId,
    hospitalId,
    "Prescription",
  );

  const prescription = await Prescription.findOne(
    tenantScoped(hospitalId, { _id: prescriptionId }),
  )
    .populate(POPULATE as never)
    .lean();

  if (!prescription) throw ApiError.notFound("Prescription not found.");

  return toSummary(prescription as never);
}

// ---------------------------------------------------------------------------
// Who signs the prescription
// ---------------------------------------------------------------------------

type ResolvedPrescriber = { id: string; name: string; status: string };

/**
 * Works out which doctor a prescription is signed by.
 *
 * Never taken from the request body: putting another clinician's name on a
 * prescription must not be a free choice. But it does not demand that every
 * prescriber have a login either — a patient already has a doctor through their
 * bookings, so the system can nearly always tell.
 *
 * In order:
 *   1. The caller's OWN doctor profile, when their account is linked to one.
 *      They are literally the author, so this must win — otherwise a doctor
 *      covering someone else's patient would sign in that colleague's name.
 *   2. The doctor on the booking being prescribed against.
 *   3. The patient's assigned doctor — whoever they last had an appointment
 *      with.
 *
 * Only a patient who has never been booked with anyone, written by an account
 * with no doctor profile, has no answer.
 */
async function resolvePrescriber(
  patientId: string,
  userId: string,
  hospitalId: string,
  appointmentDoctorId: string | null,
): Promise<ResolvedPrescriber | null> {
  const own = await Doctor.findOne(tenantScoped(hospitalId, { userId }))
    .select("displayName status")
    .lean();

  if (own) {
    return {
      id: String(own._id),
      name: own.displayName,
      status: own.status,
    };
  }

  const fallbackDoctorId =
    appointmentDoctorId ??
    (
      await Appointment.findOne(tenantScoped(hospitalId, { patientId }))
        // The most recent booking is the one that says who is treating them.
        .sort({ appointmentDate: -1, startMinutes: -1 })
        .select("doctorId")
        .lean()
    )?.doctorId;

  if (!fallbackDoctorId) return null;

  const doctor = await Doctor.findOne(
    tenantScoped(hospitalId, { _id: fallbackDoctorId }),
  )
    .select("displayName status")
    .lean();

  return doctor
    ? { id: String(doctor._id), name: doctor.displayName, status: doctor.status }
    : null;
}

/** Statuses that mean the patient is still expected — a live booking. */
const OPEN_APPOINTMENT_STATUSES = ["checked_in", "confirmed", "scheduled"];

export type PrescriptionContext = {
  /** Who a prescription written now would be signed by; null if nobody can. */
  prescriber: { id: string; name: string } | null;
  /** Today's live bookings, as options for the encounter being prescribed for. */
  appointments: Array<{ id: string; label: string }>;
};

/**
 * Everything the prescribe dialog needs before it can be opened, for one
 * patient.
 *
 * Both the patient record and the patients list open the same dialog, so this
 * is the single place that answers "who signs it" and "which encounter is it
 * for" — the form cannot promise one name while the server stores another.
 */
export async function getPrescriptionContext(
  patientId: string,
  userId: string,
  hospitalId: string,
  today: string,
): Promise<PrescriptionContext> {
  await connectToDatabase();

  await assertBelongsToTenant(Patient, patientId, hospitalId, "Patient");

  const [prescriber, appointments] = await Promise.all([
    resolvePrescriber(patientId, userId, hospitalId, null),
    Appointment.find(
      tenantScoped(hospitalId, {
        patientId,
        appointmentDate: today,
        status: mongoose.trusted({ $in: OPEN_APPOINTMENT_STATUSES }),
      }),
    )
      .select("startMinutes endMinutes status doctorId")
      .populate<{ doctorId: { _id: unknown; displayName: string } | null }>(
        "doctorId",
        "displayName",
      )
      .sort({ startMinutes: 1 })
      .limit(20)
      .lean(),
  ]);

  return {
    prescriber:
      prescriber && prescriber.status === "active"
        ? { id: prescriber.id, name: prescriber.name }
        : null,
    appointments: appointments
      // A checked-in patient is the one actually in front of the doctor, so
      // they lead and become the default.
      .sort((a, b) =>
        a.status === b.status
          ? 0
          : a.status === "checked_in"
            ? -1
            : b.status === "checked_in"
              ? 1
              : 0,
      )
      .map((appointment) => ({
        id: String(appointment._id),
        label: `${minutesToTime(appointment.startMinutes)}–${minutesToTime(
          appointment.endMinutes,
        )} · ${appointment.doctorId?.displayName ?? "Unknown doctor"} · ${appointment.status.replace(/_/g, " ")}`,
      })),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Writes a prescription, recording the consultation it came out of.
 *
 * Every reference is resolved inside the caller's tenant, and an appointment —
 * when supplied — must belong to the same patient, so a prescription can never
 * be written against another hospital's patient or misfiled onto someone
 * else's booking.
 */
export async function createPrescription(
  input: CreatePrescriptionInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PrescriptionSummary> {
  await connectToDatabase();

  const patient = await assertBelongsToTenant(
    Patient,
    input.patientId,
    actor.hospitalId,
    "Patient",
  );

  let appointmentId: string | null = null;
  let treatmentId: string | null = null;
  let appointmentDoctorId: string | null = null;

  if (input.appointmentId) {
    const appointment = await assertBelongsToTenant(
      Appointment,
      input.appointmentId,
      actor.hospitalId,
      "Appointment",
    );

    if (String(appointment.patientId) !== String(patient._id)) {
      throw ApiError.validation(
        "That appointment belongs to a different patient.",
        { fields: { appointmentId: "Appointment is for another patient." } },
      );
    }

    appointmentId = String(appointment._id);
    // Carried onto the visit so the encounter keeps what was booked.
    treatmentId = appointment.treatmentId ? String(appointment.treatmentId) : null;
    appointmentDoctorId = String(appointment.doctorId);
  }

  const prescriber = await resolvePrescriber(
    String(patient._id),
    actor.userId,
    actor.hospitalId,
    appointmentDoctorId,
  );

  if (!prescriber) {
    throw ApiError.validation(
      "There is no doctor to sign this prescription: this patient has no appointments, and your account is not linked to a doctor profile.",
    );
  }

  if (prescriber.status !== "active") {
    throw ApiError.validation(
      `${prescriber.name} is inactive and cannot prescribe.`,
    );
  }

  const { visitId, created } = await recordVisitFor(
    {
      patientId: String(patient._id),
      doctorId: prescriber.id,
      appointmentId,
      treatmentId,
    },
    input.prescribedDate,
    input.diagnosis,
    actor,
    meta,
  );

  const prescription = await Prescription.create({
    hospitalId: actor.hospitalId,
    patientId: String(patient._id),
    doctorId: prescriber.id,
    visitId,
    prescribedDate: input.prescribedDate,
    items: input.items,
    notes: input.notes,
    status: "pending",
    createdBy: actor.userId,
  });

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "prescription.created",
    resource: "Prescription",
    resourceId: String(prescription._id),
    /**
     * The drug count, never the drug names. An audit trail must not become a
     * second, unsecured copy of what a patient was prescribed.
     */
    metadata: {
      patientId: String(patient._id),
      doctorId: prescriber.id,
      visitId,
      visitCreated: created,
      itemCount: input.items.length,
    },
    meta,
  });

  return getPrescription(String(prescription._id), actor.hospitalId);
}

/**
 * The pharmacy acting on a queued prescription: handing it over, or refusing
 * it. Both are terminal, so this is the only transition there is.
 */
export async function dispensePrescription(
  prescriptionId: string,
  input: DispensePrescriptionInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PrescriptionSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(
    Prescription,
    prescriptionId,
    actor.hospitalId,
    "Prescription",
  );

  const prescription = await Prescription.findOne(
    tenantScoped(actor.hospitalId, { _id: prescriptionId }),
  );
  if (!prescription) throw ApiError.notFound("Prescription not found.");

  const current = prescription.status as PrescriptionStatus;
  if (SETTLED_PRESCRIPTION_STATUSES.includes(current)) {
    throw ApiError.conflict(
      current === "dispensed"
        ? "This prescription has already been dispensed."
        : "This prescription was cancelled and can no longer be dispensed.",
    );
  }

  prescription.status = input.status;
  prescription.dispensedBy = new mongoose.Types.ObjectId(actor.userId);
  prescription.dispensedAt = new Date();
  prescription.dispensingNotes = input.dispensingNotes;

  await prescription.save();

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action:
      input.status === "dispensed"
        ? "prescription.dispensed"
        : "prescription.cancelled",
    resource: "Prescription",
    resourceId: prescriptionId,
    metadata: {
      patientId: String(prescription.patientId),
      from: current,
      to: input.status,
    },
    meta,
  });

  return getPrescription(prescriptionId, actor.hospitalId);
}
