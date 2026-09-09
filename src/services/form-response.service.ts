import { connectToDatabase } from "@/lib/db/connect";
import { Appointment, Form, FormResponse, Patient } from "@/models";
import { ApiError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import { getFieldsForVersion, type FormFieldSummary } from "@/services/form.service";
import {
  assertBelongsToTenant,
  paginationMeta,
  paginationSkip,
  tenantScoped,
} from "@/lib/tenant/scope";
import { validateResponse } from "@/lib/forms/validate";
import type { SubmitResponseInput } from "@/schemas/form.schema";
import type { Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

export type ResponseSummary = {
  id: string;
  formId: string;
  formName: string;
  formVersion: number;
  patient: { id: string; name: string; patientNumber: string } | null;
  appointmentId: string | null;
  submittedBy: { id: string; name: string } | null;
  responses: Record<string, unknown>;
  submittedAt: string;
};

/** A response together with the exact field definitions it was answered against. */
export type ResponseDetail = ResponseSummary & {
  fields: FormFieldSummary[];
  /** True when the form has moved on since this was submitted. */
  isHistoricalVersion: boolean;
  currentVersion: number;
};

type Actor = { userId: string; hospitalId: string };

function toSummary(
  response: {
    _id: unknown;
    formId: unknown;
    formVersion: number;
    patientId: unknown;
    // Optional to match the Mongoose document type, where nullable paths are
    // inferred as possibly-undefined.
    appointmentId?: unknown;
    submittedBy?: unknown;
    responses: unknown;
    submittedAt: Date;
  },
  formName: string,
): ResponseSummary {
  const ref = <T extends Record<string, unknown>>(value: unknown): T | null =>
    value && typeof value === "object" && "_id" in (value as object)
      ? (value as T)
      : null;

  const patient = ref<{
    _id: unknown;
    firstName: string;
    lastName: string;
    patientNumber: string;
  }>(response.patientId);

  const submitter = ref<{ _id: unknown; name: string }>(response.submittedBy);

  return {
    id: String(response._id),
    formId: String(
      ref<{ _id: unknown }>(response.formId)?._id ?? response.formId,
    ),
    formName,
    formVersion: response.formVersion,
    patient: patient
      ? {
          id: String(patient._id),
          name: `${patient.firstName} ${patient.lastName}`.trim(),
          patientNumber: patient.patientNumber,
        }
      : null,
    appointmentId: response.appointmentId ? String(response.appointmentId) : null,
    submittedBy: submitter
      ? { id: String(submitter._id), name: submitter.name }
      : null,
    responses: (response.responses as Record<string, unknown>) ?? {},
    submittedAt: response.submittedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Submission (Section 24)
// ---------------------------------------------------------------------------

/**
 * Records a form submission.
 *
 * Two things this deliberately does NOT do:
 *   - modify the form definition in any way;
 *   - trust the submitted keys. Answers are validated against the current
 *     version's fields, and anything not defined there is dropped rather than
 *     stored, so a crafted payload cannot smuggle data into the record.
 */
export async function submitResponse(
  formId: string,
  input: SubmitResponseInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<ResponseSummary> {
  await connectToDatabase();

  const form = await assertBelongsToTenant(Form, formId, actor.hospitalId, "Form");

  if (form.status !== "published") {
    throw ApiError.conflict(
      form.status === "draft"
        ? "This form is still a draft and cannot accept responses yet."
        : "This form has been archived and no longer accepts responses.",
    );
  }

  // Cross-tenant relationship validation (Section 10).
  const patient = await assertBelongsToTenant(
    Patient,
    input.patientId,
    actor.hospitalId,
    "Patient",
  );

  let appointmentId: string | null = null;
  if (input.appointmentId) {
    const appointment = await assertBelongsToTenant(
      Appointment,
      input.appointmentId,
      actor.hospitalId,
      "Appointment",
    );

    // Attaching a form to another patient's appointment would misfile the record.
    if (String(appointment.patientId) !== String(patient._id)) {
      throw ApiError.validation(
        "That appointment belongs to a different patient.",
        { fields: { appointmentId: "Appointment is for another patient." } },
      );
    }

    appointmentId = String(appointment._id);
  }

  const fields = await getFieldsForVersion(
    formId,
    form.currentVersion,
    actor.hospitalId,
  );

  if (fields.length === 0) {
    throw ApiError.conflict("This form has no fields to complete.");
  }

  const result = validateResponse(fields, input.responses);

  if (!result.ok) {
    throw ApiError.validation("Please correct the highlighted answers.", {
      fields: result.errors,
    });
  }

  const response = await FormResponse.create({
    hospitalId: actor.hospitalId,
    formId,
    // Pinned now and never changed, even if the form is edited tomorrow.
    formVersion: form.currentVersion,
    patientId: patient._id,
    appointmentId,
    submittedBy: actor.userId,
    responses: result.value,
    submittedAt: new Date(),
  });

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "form.submitted",
    resource: "FormResponse",
    resourceId: String(response._id),
    // Records that a submission happened, never the clinical answers themselves.
    metadata: {
      formId,
      formVersion: form.currentVersion,
      patientId: String(patient._id),
    },
    meta,
  });

  return toSummary(response, form.name);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listResponses(
  formId: string,
  hospitalId: string,
  params: { page: number; pageSize: number; patientId?: string },
): Promise<Paginated<ResponseSummary>> {
  await connectToDatabase();

  const form = await assertBelongsToTenant(Form, formId, hospitalId, "Form");

  const filter = tenantScoped(hospitalId, {
    formId,
    ...(params.patientId ? { patientId: params.patientId } : {}),
  });

  const [responses, total] = await Promise.all([
    FormResponse.find(filter)
      .sort({ submittedAt: -1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .populate("patientId", "firstName lastName patientNumber")
      .populate("submittedBy", "name")
      .lean(),
    FormResponse.countDocuments(filter),
  ]);

  return {
    items: responses.map((response) =>
      toSummary(response as never, form.name),
    ),
    ...paginationMeta(params, total),
  };
}

/**
 * Loads one response together with the field definitions of the version it was
 * answered against — NOT the current version.
 *
 * This is the read side of Section 25: a response submitted against v1 renders
 * with v1's labels, options and ordering even after the form has moved to v3.
 */
export async function getResponse(
  responseId: string,
  hospitalId: string,
): Promise<ResponseDetail> {
  await connectToDatabase();

  await assertBelongsToTenant(FormResponse, responseId, hospitalId, "Response");

  const response = await FormResponse.findOne(
    tenantScoped(hospitalId, { _id: responseId }),
  )
    .populate("patientId", "firstName lastName patientNumber")
    .populate("submittedBy", "name")
    .lean();

  if (!response) throw ApiError.notFound("Response not found.");

  const form = await Form.findOne(
    tenantScoped(hospitalId, { _id: response.formId }),
  )
    .select("name currentVersion")
    .lean();

  if (!form) throw ApiError.notFound("Form not found.");

  const fields = await getFieldsForVersion(
    String(response.formId),
    response.formVersion,
    hospitalId,
  );

  return {
    ...toSummary(response as never, form.name),
    fields,
    isHistoricalVersion: response.formVersion !== form.currentVersion,
    currentVersion: form.currentVersion,
  };
}

/** Every submission for one patient, across all forms. */
export async function listPatientResponses(
  patientId: string,
  hospitalId: string,
  params: { page: number; pageSize: number },
): Promise<Paginated<ResponseSummary>> {
  await connectToDatabase();

  const filter = tenantScoped(hospitalId, { patientId });

  const [responses, total] = await Promise.all([
    FormResponse.find(filter)
      .sort({ submittedAt: -1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .populate("formId", "name")
      .populate("patientId", "firstName lastName patientNumber")
      .populate("submittedBy", "name")
      .lean(),
    FormResponse.countDocuments(filter),
  ]);

  return {
    items: responses.map((response) => {
      const form = response.formId as unknown as { name?: string } | null;
      return toSummary(response as never, form?.name ?? "Form");
    }),
    ...paginationMeta(params, total),
  };
}
