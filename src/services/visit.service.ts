import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import {
  Appointment,
  Doctor,
  FormResponse,
  Patient,
  Treatment,
  Visit,
} from "@/models";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import {
  assertBelongsToTenant,
  escapeRegex,
  paginationMeta,
  paginationSkip,
  tenantScoped,
} from "@/lib/tenant/scope";
import type { CreateVisitInput, UpdateVisitInput } from "@/schemas/visit.schema";
import type { Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

export type AttachedResponse = {
  id: string;
  formId: string;
  formName: string;
  formVersion: number;
  submittedAt: string;
};

export type VisitSummary = {
  id: string;
  patient: { id: string; name: string; patientNumber: string } | null;
  doctor: { id: string; name: string } | null;
  appointmentId: string | null;
  treatment: { id: string; name: string } | null;
  visitDate: string;
  symptoms: string;
  diagnosis: string;
  notes: string;
  recommendations: string;
  followUpDate: string | null;
  /** Specialty data captured during this encounter (Section 26). */
  formResponses: AttachedResponse[];
  createdAt: string;
  updatedAt: string;
};

type Actor = { userId: string; hospitalId: string };

function ref<T extends Record<string, unknown>>(value: unknown): T | null {
  return value && typeof value === "object" && "_id" in (value as object)
    ? (value as T)
    : null;
}

function toSummary(
  visit: {
    _id: unknown;
    patientId: unknown;
    doctorId: unknown;
    appointmentId?: unknown;
    treatmentId?: unknown;
    visitDate: string;
    symptoms?: string | null;
    diagnosis?: string | null;
    notes?: string | null;
    recommendations?: string | null;
    followUpDate?: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  formResponses: AttachedResponse[],
): VisitSummary {
  const patient = ref<{
    _id: unknown;
    firstName: string;
    lastName: string;
    patientNumber: string;
  }>(visit.patientId);

  const doctor = ref<{ _id: unknown; displayName: string }>(visit.doctorId);
  const treatment = ref<{ _id: unknown; name: string }>(visit.treatmentId);

  return {
    id: String(visit._id),
    patient: patient
      ? {
          id: String(patient._id),
          name: `${patient.firstName} ${patient.lastName}`.trim(),
          patientNumber: patient.patientNumber,
        }
      : null,
    doctor: doctor
      ? { id: String(doctor._id), name: doctor.displayName }
      : null,
    appointmentId: visit.appointmentId ? String(visit.appointmentId) : null,
    treatment: treatment
      ? { id: String(treatment._id), name: treatment.name }
      : null,
    visitDate: visit.visitDate,
    symptoms: visit.symptoms ?? "",
    diagnosis: visit.diagnosis ?? "",
    notes: visit.notes ?? "",
    recommendations: visit.recommendations ?? "",
    followUpDate: visit.followUpDate ?? null,
    formResponses,
    createdAt: visit.createdAt.toISOString(),
    updatedAt: visit.updatedAt.toISOString(),
  };
}

const POPULATE = [
  { path: "patientId", select: "firstName lastName patientNumber" },
  { path: "doctorId", select: "displayName" },
  { path: "treatmentId", select: "name" },
] as const;

/** Loads the responses linked to a set of visits, in one query. */
async function loadAttachedResponses(
  visitIds: readonly unknown[],
  hospitalId: string,
): Promise<Map<string, AttachedResponse[]>> {
  if (visitIds.length === 0) return new Map();

  const responses = await FormResponse.find(
    tenantScoped(hospitalId, {
      visitId: mongoose.trusted({ $in: [...visitIds] }),
    }),
  )
    .select("visitId formId formVersion submittedAt")
    .populate<{ formId: { _id: unknown; name: string } | null }>("formId", "name")
    .sort({ submittedAt: -1 })
    .lean();

  const byVisit = new Map<string, AttachedResponse[]>();

  for (const response of responses) {
    const key = String(response.visitId);
    const bucket = byVisit.get(key) ?? [];
    bucket.push({
      id: String(response._id),
      formId: String(response.formId?._id ?? ""),
      formName: response.formId?.name ?? "Form",
      formVersion: response.formVersion,
      submittedAt: response.submittedAt.toISOString(),
    });
    byVisit.set(key, bucket);
  }

  return byVisit;
}

// ---------------------------------------------------------------------------
// Relationship validation (Section 10)
// ---------------------------------------------------------------------------

type ResolvedRefs = {
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  treatmentId: string | null;
};

/**
 * Resolves every reference within the caller's tenant, and checks that the
 * appointment (when given) belongs to the SAME patient — attaching a
 * consultation to someone else's booking would misfile a clinical record.
 */
async function resolveReferences(
  refs: {
    patientId: string;
    doctorId: string;
    appointmentId?: string | null;
    treatmentId?: string | null;
  },
  hospitalId: string,
): Promise<ResolvedRefs> {
  const [patient, doctor] = await Promise.all([
    assertBelongsToTenant(Patient, refs.patientId, hospitalId, "Patient"),
    assertBelongsToTenant(Doctor, refs.doctorId, hospitalId, "Doctor"),
  ]);

  let appointmentId: string | null = null;
  if (refs.appointmentId) {
    const appointment = await assertBelongsToTenant(
      Appointment,
      refs.appointmentId,
      hospitalId,
      "Appointment",
    );

    if (String(appointment.patientId) !== String(patient._id)) {
      throw ApiError.validation(
        "That appointment belongs to a different patient.",
        { fields: { appointmentId: "Appointment is for another patient." } },
      );
    }

    appointmentId = String(appointment._id);
  }

  let treatmentId: string | null = null;
  if (refs.treatmentId) {
    const treatment = await assertBelongsToTenant(
      Treatment,
      refs.treatmentId,
      hospitalId,
      "Treatment",
    );
    treatmentId = String(treatment._id);
  }

  return {
    patientId: String(patient._id),
    doctorId: String(doctor._id),
    appointmentId,
    treatmentId,
  };
}

/**
 * Links form responses to a visit, and unlinks any that were removed.
 *
 * Each response must belong to the same tenant AND the same patient — a form
 * filled in for one patient must never end up on another's clinical record.
 */
async function syncAttachedResponses(
  visitId: string,
  patientId: string,
  responseIds: readonly string[],
  hospitalId: string,
): Promise<void> {
  for (const responseId of responseIds) {
    const response = await assertBelongsToTenant(
      FormResponse,
      responseId,
      hospitalId,
      "Form response",
    );

    if (String(response.patientId) !== patientId) {
      throw ApiError.validation(
        "A selected form response belongs to a different patient.",
        {
          fields: {
            formResponseIds: "One response is for another patient.",
          },
        },
      );
    }

    // Already on another visit — moving it would silently strip it from that
    // record, so refuse rather than reassign.
    if (response.visitId && String(response.visitId) !== visitId) {
      throw ApiError.conflict(
        "One of those form responses is already attached to another visit.",
      );
    }
  }

  // Detach anything previously linked that is no longer selected.
  await FormResponse.updateMany(
    tenantScoped(hospitalId, {
      visitId,
      ...(responseIds.length > 0
        ? { _id: mongoose.trusted({ $nin: responseIds.map((id) => new mongoose.Types.ObjectId(id)) }) }
        : {}),
    }),
    { $set: { visitId: null } },
  );

  if (responseIds.length > 0) {
    await FormResponse.updateMany(
      tenantScoped(hospitalId, {
        _id: mongoose.trusted({
          $in: responseIds.map((id) => new mongoose.Types.ObjectId(id)),
        }),
      }),
      { $set: { visitId } },
    );
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listVisits(
  hospitalId: string,
  params: {
    page: number;
    pageSize: number;
    search?: string;
    patientId?: string;
    doctorId?: string;
    from?: string;
    to?: string;
    followUpBefore?: string;
  },
): Promise<Paginated<VisitSummary>> {
  await connectToDatabase();

  const dateRange: Record<string, string> = {};
  if (params.from) dateRange.$gte = params.from;
  if (params.to) dateRange.$lte = params.to;

  const filter = tenantScoped(hospitalId, {
    ...(params.patientId ? { patientId: params.patientId } : {}),
    ...(params.doctorId ? { doctorId: params.doctorId } : {}),
    ...(Object.keys(dateRange).length > 0
      ? { visitDate: mongoose.trusted(dateRange) }
      : {}),
    ...(params.followUpBefore
      ? {
          followUpDate: mongoose.trusted({
            $ne: null,
            $lte: params.followUpBefore,
          }),
        }
      : {}),
    ...(params.search
      ? {
          $or: [
            { diagnosis: mongoose.trusted({ $regex: escapeRegex(params.search), $options: "i" }) },
            { symptoms: mongoose.trusted({ $regex: escapeRegex(params.search), $options: "i" }) },
          ],
        }
      : {}),
  });

  const [visits, total] = await Promise.all([
    Visit.find(filter)
      .sort({ visitDate: -1, createdAt: -1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .populate(POPULATE as never)
      .lean(),
    Visit.countDocuments(filter),
  ]);

  const attached = await loadAttachedResponses(
    visits.map((visit) => visit._id),
    hospitalId,
  );

  return {
    items: visits.map((visit) =>
      toSummary(visit as never, attached.get(String(visit._id)) ?? []),
    ),
    ...paginationMeta(params, total),
  };
}

export async function getVisit(
  visitId: string,
  hospitalId: string,
): Promise<VisitSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(Visit, visitId, hospitalId, "Visit");

  const visit = await Visit.findOne(tenantScoped(hospitalId, { _id: visitId }))
    .populate(POPULATE as never)
    .lean();

  if (!visit) throw ApiError.notFound("Visit not found.");

  const attached = await loadAttachedResponses([visit._id], hospitalId);

  return toSummary(visit as never, attached.get(String(visit._id)) ?? []);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createVisit(
  input: CreateVisitInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<VisitSummary> {
  await connectToDatabase();

  const refs = await resolveReferences(input, actor.hospitalId);

  let visit;
  try {
    visit = await Visit.create({
      hospitalId: actor.hospitalId,
      patientId: refs.patientId,
      doctorId: refs.doctorId,
      appointmentId: refs.appointmentId,
      treatmentId: refs.treatmentId,
      visitDate: input.visitDate,
      symptoms: input.symptoms,
      diagnosis: input.diagnosis,
      notes: input.notes,
      recommendations: input.recommendations,
      followUpDate: input.followUpDate || null,
      createdBy: actor.userId,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict(
        "A visit has already been recorded for that appointment.",
      );
    }
    throw error;
  }

  if (input.formResponseIds.length > 0) {
    await syncAttachedResponses(
      String(visit._id),
      refs.patientId,
      input.formResponseIds,
      actor.hospitalId,
    );
  }

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "visit.created",
    resource: "Visit",
    resourceId: String(visit._id),
    /**
     * Records that a consultation was written, never its clinical content —
     * an audit trail must not become a second, unsecured copy of the record.
     */
    metadata: {
      patientId: refs.patientId,
      doctorId: refs.doctorId,
      visitDate: input.visitDate,
    },
    meta,
  });

  return getVisit(String(visit._id), actor.hospitalId);
}

export async function updateVisit(
  visitId: string,
  input: UpdateVisitInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<VisitSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(Visit, visitId, actor.hospitalId, "Visit");

  const visit = await Visit.findOne(
    tenantScoped(actor.hospitalId, { _id: visitId }),
  );
  if (!visit) throw ApiError.notFound("Visit not found.");

  /**
   * `patientId` and `appointmentId` are not accepted by the update schema, so
   * a clinical record can never be moved onto a different patient.
   */
  if (input.doctorId !== undefined || input.treatmentId !== undefined) {
    const refs = await resolveReferences(
      {
        patientId: String(visit.patientId),
        doctorId: input.doctorId ?? String(visit.doctorId),
        treatmentId:
          input.treatmentId === undefined
            ? visit.treatmentId
              ? String(visit.treatmentId)
              : null
            : input.treatmentId,
      },
      actor.hospitalId,
    );

    visit.doctorId = new mongoose.Types.ObjectId(refs.doctorId);
    visit.treatmentId = refs.treatmentId
      ? new mongoose.Types.ObjectId(refs.treatmentId)
      : null;
  }

  if (input.visitDate !== undefined) visit.visitDate = input.visitDate;
  if (input.symptoms !== undefined) visit.symptoms = input.symptoms;
  if (input.diagnosis !== undefined) visit.diagnosis = input.diagnosis;
  if (input.notes !== undefined) visit.notes = input.notes;
  if (input.recommendations !== undefined) {
    visit.recommendations = input.recommendations;
  }
  if (input.followUpDate !== undefined) {
    visit.followUpDate = input.followUpDate || null;
  }

  // Re-check after applying whichever of the two fields changed.
  if (visit.followUpDate && visit.followUpDate < visit.visitDate) {
    throw ApiError.validation(
      "The follow-up date cannot be before the visit date.",
      { fields: { followUpDate: "Must be on or after the visit date." } },
    );
  }

  await visit.save();

  if (input.formResponseIds !== undefined) {
    await syncAttachedResponses(
      visitId,
      String(visit.patientId),
      input.formResponseIds,
      actor.hospitalId,
    );
  }

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "visit.updated",
    resource: "Visit",
    resourceId: visitId,
    // Field names only — never the amended clinical text itself.
    metadata: { fields: Object.keys(input) },
    meta,
  });

  return getVisit(visitId, actor.hospitalId);
}

/**
 * Form responses for a patient that are available to attach to a visit —
 * i.e. not already linked to a different one.
 */
export async function listAttachableResponses(
  patientId: string,
  hospitalId: string,
  visitId?: string,
): Promise<AttachedResponse[]> {
  await connectToDatabase();

  await assertBelongsToTenant(Patient, patientId, hospitalId, "Patient");

  const responses = await FormResponse.find(
    tenantScoped(hospitalId, {
      patientId,
      $or: [
        { visitId: null },
        ...(visitId ? [{ visitId }] : []),
      ],
    }),
  )
    .select("formId formVersion submittedAt")
    .populate<{ formId: { _id: unknown; name: string } | null }>("formId", "name")
    .sort({ submittedAt: -1 })
    .limit(100)
    .lean();

  return responses.map((response) => ({
    id: String(response._id),
    formId: String(response.formId?._id ?? ""),
    formName: response.formId?.name ?? "Form",
    formVersion: response.formVersion,
    submittedAt: response.submittedAt.toISOString(),
  }));
}
