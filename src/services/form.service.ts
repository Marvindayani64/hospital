import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { Form, FormField, FormResponse } from "@/models";
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
  ConditionalLogic,
  FieldDefinition,
  FieldOption,
  FieldValidationRules,
} from "@/lib/forms/validate";
import type {
  CreateFormInput,
  SaveFieldsInput,
  UpdateFormInput,
} from "@/schemas/form.schema";
import type { FormStatus } from "@/models/Form";
import type { Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

/**
 * `options` and `validation` are optional on FieldDefinition (a validator does
 * not care whether they were supplied), but this summary always populates them,
 * so they are narrowed here — the builder UI can then rely on them existing.
 */
export type FormFieldSummary = FieldDefinition & {
  id: string;
  options: FieldOption[];
  validation: FieldValidationRules;
  conditionalLogic: ConditionalLogic | null;
  order: number;
  placeholder: string;
  helpText: string;
  defaultValue: unknown;
};

export type FormSummary = {
  id: string;
  name: string;
  description: string;
  category: string;
  status: FormStatus;
  currentVersion: number;
  fieldCount: number;
  responseCount: number;
  createdAt: string;
  updatedAt: string;
};

export type FormDetail = FormSummary & {
  fields: FormFieldSummary[];
  /** True when the next field edit will fork a new version. */
  editWillCreateVersion: boolean;
};

type Actor = { userId: string; hospitalId: string };

function toFieldSummary(field: {
  _id: unknown;
  label: string;
  fieldName: string;
  type: string;
  required: boolean;
  options?: Array<{ label: string; value: string }>;
  validation?: Record<string, unknown> | null;
  order: number;
  placeholder?: string | null;
  helpText?: string | null;
  defaultValue?: unknown;
  conditionalLogic?: {
    fieldName: string;
    operator: string;
    value?: unknown;
  } | null;
}): FormFieldSummary {
  return {
    id: String(field._id),
    label: field.label,
    fieldName: field.fieldName,
    type: field.type as FormFieldSummary["type"],
    required: field.required,
    options: (field.options ?? []).map((option) => ({
      label: option.label,
      value: option.value,
    })),
    validation: (field.validation ?? {}) as FormFieldSummary["validation"],
    order: field.order,
    placeholder: field.placeholder ?? "",
    helpText: field.helpText ?? "",
    defaultValue: field.defaultValue ?? null,
    conditionalLogic: field.conditionalLogic
      ? {
          fieldName: field.conditionalLogic.fieldName,
          operator: field.conditionalLogic
            .operator as NonNullable<FormFieldSummary["conditionalLogic"]>["operator"],
          value: field.conditionalLogic.value,
        }
      : null,
  };
}

/**
 * Loads the field definitions for one specific version.
 *
 * Every read of a form's structure goes through this, including when rendering
 * a historical response — which is what makes Section 25 hold in practice
 * rather than only in the schema.
 */
export async function getFieldsForVersion(
  formId: string,
  version: number,
  hospitalId: string,
): Promise<FormFieldSummary[]> {
  const fields = await FormField.find(
    tenantScoped(hospitalId, { formId, version }),
  )
    .sort({ order: 1 })
    .lean();

  return fields.map(toFieldSummary);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listForms(
  hospitalId: string,
  params: {
    page: number;
    pageSize: number;
    search?: string;
    status?: FormStatus;
    category?: string;
  },
): Promise<Paginated<FormSummary>> {
  await connectToDatabase();

  const filter = tenantScoped(hospitalId, {
    ...(params.status ? { status: params.status } : {}),
    ...(params.category ? { category: params.category } : {}),
    ...(params.search ? { name: regexSearch(params.search) } : {}),
  });

  const [forms, total] = await Promise.all([
    Form.find(filter)
      .sort({ updatedAt: -1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .lean(),
    Form.countDocuments(filter),
  ]);

  if (forms.length === 0) {
    return { items: [], ...paginationMeta(params, total) };
  }

  const formIds = forms.map((form) => form._id);
  const tenantObjectId = new mongoose.Types.ObjectId(hospitalId);

  /**
   * Two grouped counts for the whole page rather than two queries per form.
   *
   * Field counts are grouped by (formId, version) because each form is on its
   * own current version; the matching entry is picked out below.
   */
  const [fieldCounts, responseCounts] = await Promise.all([
    FormField.aggregate<{ _id: { formId: unknown; version: number }; count: number }>([
      { $match: { hospitalId: tenantObjectId, formId: { $in: formIds } } },
      {
        $group: {
          _id: { formId: "$formId", version: "$version" },
          count: { $sum: 1 },
        },
      },
    ]),
    FormResponse.aggregate<{ _id: unknown; count: number }>([
      { $match: { hospitalId: tenantObjectId, formId: { $in: formIds } } },
      { $group: { _id: "$formId", count: { $sum: 1 } } },
    ]),
  ]);

  const fieldCountByFormVersion = new Map(
    fieldCounts.map((row) => [
      `${String(row._id.formId)}:${row._id.version}`,
      row.count,
    ]),
  );
  const responseCountByForm = new Map(
    responseCounts.map((row) => [String(row._id), row.count]),
  );

  return {
    items: forms.map((form) => ({
      id: String(form._id),
      name: form.name,
      description: form.description ?? "",
      category: form.category ?? "",
      status: form.status as FormStatus,
      currentVersion: form.currentVersion,
      fieldCount:
        fieldCountByFormVersion.get(
          `${String(form._id)}:${form.currentVersion}`,
        ) ?? 0,
      responseCount: responseCountByForm.get(String(form._id)) ?? 0,
      createdAt: form.createdAt.toISOString(),
      updatedAt: form.updatedAt.toISOString(),
    })),
    ...paginationMeta(params, total),
  };
}

export async function getForm(
  formId: string,
  hospitalId: string,
): Promise<FormDetail> {
  await connectToDatabase();

  const form = await assertBelongsToTenant(Form, formId, hospitalId, "Form");

  const [fields, responseCount, responsesAtCurrentVersion] = await Promise.all([
    getFieldsForVersion(formId, form.currentVersion, hospitalId),
    FormResponse.countDocuments(tenantScoped(hospitalId, { formId })),
    FormResponse.countDocuments(
      tenantScoped(hospitalId, { formId, formVersion: form.currentVersion }),
    ),
  ]);

  return {
    id: String(form._id),
    name: form.name,
    description: form.description ?? "",
    category: form.category ?? "",
    status: form.status as FormStatus,
    currentVersion: form.currentVersion,
    fieldCount: fields.length,
    responseCount,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
    fields,
    editWillCreateVersion: responsesAtCurrentVersion > 0,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createForm(
  input: CreateFormInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<FormDetail> {
  await connectToDatabase();

  try {
    const form = await Form.create({
      hospitalId: actor.hospitalId,
      name: input.name,
      description: input.description,
      category: input.category,
      // New forms start as drafts so they cannot receive responses before the
      // fields exist.
      status: "draft",
      currentVersion: 1,
      createdBy: actor.userId,
    });

    await recordAudit({
      hospitalId: actor.hospitalId,
      userId: actor.userId,
      action: "form.created",
      resource: "Form",
      resourceId: String(form._id),
      metadata: { name: form.name, category: form.category },
      meta,
    });

    return getForm(String(form._id), actor.hospitalId);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict("A form with that name already exists.");
    }
    throw error;
  }
}

export async function updateForm(
  formId: string,
  input: UpdateFormInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<FormDetail> {
  await connectToDatabase();

  await assertBelongsToTenant(Form, formId, actor.hospitalId, "Form");

  const form = await Form.findOne(
    tenantScoped(actor.hospitalId, { _id: formId }),
  );
  if (!form) throw ApiError.notFound("Form not found.");

  if (input.status === "published" && form.status !== "published") {
    // Publishing an empty form would present patients with a blank page.
    const fieldCount = await FormField.countDocuments(
      tenantScoped(actor.hospitalId, { formId, version: form.currentVersion }),
    );
    if (fieldCount === 0) {
      throw ApiError.conflict(
        "Add at least one field before publishing this form.",
      );
    }
  }

  if (input.name !== undefined) form.name = input.name;
  if (input.description !== undefined) form.description = input.description;
  if (input.category !== undefined) form.category = input.category;
  if (input.status !== undefined) form.status = input.status;

  try {
    await form.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict("A form with that name already exists.");
    }
    throw error;
  }

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: input.status ? "form.status_changed" : "form.updated",
    resource: "Form",
    resourceId: formId,
    metadata: { fields: Object.keys(input), status: form.status },
    meta,
  });

  return getForm(formId, actor.hospitalId);
}

export type SaveFieldsResult = {
  form: FormDetail;
  /** Set when the edit forked a new version. */
  newVersion: number | null;
};

/**
 * Replaces a form's field set, applying copy-on-write versioning.
 *
 * The rule (Section 25):
 *
 *   - No responses exist against the current version → edit it in place.
 *     Authoring a form would otherwise spawn a new version on every keystroke
 *     of progress.
 *   - Responses DO exist → write the new field set as version N+1 and leave
 *     version N's rows untouched. Historical responses continue to resolve to
 *     exactly the fields they were answered against.
 *
 * Old versions are never mutated and never deleted.
 */
export async function saveFields(
  formId: string,
  input: SaveFieldsInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<SaveFieldsResult> {
  await connectToDatabase();

  await assertBelongsToTenant(Form, formId, actor.hospitalId, "Form");

  const form = await Form.findOne(
    tenantScoped(actor.hospitalId, { _id: formId }),
  );
  if (!form) throw ApiError.notFound("Form not found.");

  if (form.status === "archived") {
    throw ApiError.conflict(
      "An archived form cannot be edited. Restore it to draft first.",
    );
  }

  const responsesAtCurrentVersion = await FormResponse.countDocuments(
    tenantScoped(actor.hospitalId, {
      formId,
      formVersion: form.currentVersion,
    }),
  );

  const forkVersion = responsesAtCurrentVersion > 0;
  const targetVersion = forkVersion ? form.currentVersion + 1 : form.currentVersion;

  const documents = input.fields.map((field, index) => ({
    hospitalId: actor.hospitalId,
    formId,
    version: targetVersion,
    label: field.label,
    fieldName: field.fieldName,
    type: field.type,
    required: field.required,
    options: field.options,
    validation: field.validation,
    // Order is derived from array position, so the client never has to send
    // consistent order numbers.
    order: index,
    placeholder: field.placeholder,
    helpText: field.helpText,
    defaultValue: field.defaultValue,
    conditionalLogic: field.conditionalLogic ?? null,
  }));

  if (forkVersion) {
    // Nothing is deleted: version N's rows stay exactly as they were.
    if (documents.length > 0) await FormField.insertMany(documents);
    form.currentVersion = targetVersion;
    await form.save();
  } else {
    /**
     * In-place edit. The delete-then-insert is not transactional on a
     * standalone mongod, but it only ever touches a version with NO responses,
     * so a failure between the two steps can lose in-progress authoring — never
     * submitted patient data.
     */
    await FormField.deleteMany(
      tenantScoped(actor.hospitalId, { formId, version: targetVersion }),
    );
    if (documents.length > 0) await FormField.insertMany(documents);
    /**
     * `save()` on an unchanged document is a no-op, so `updatedAt` is set
     * explicitly to keep the list's "recently updated" ordering honest after a
     * fields-only edit.
     */
    await Form.updateOne(
      tenantScoped(actor.hospitalId, { _id: formId }),
      { $set: { updatedAt: new Date() } },
      { timestamps: false },
    );
  }

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: forkVersion ? "form.version_created" : "form.fields_updated",
    resource: "Form",
    resourceId: formId,
    metadata: {
      version: targetVersion,
      fieldCount: documents.length,
      forked: forkVersion,
    },
    meta,
  });

  return {
    form: await getForm(formId, actor.hospitalId),
    newVersion: forkVersion ? targetVersion : null,
  };
}

export async function deleteForm(
  formId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  await connectToDatabase();

  const form = await assertBelongsToTenant(Form, formId, actor.hospitalId, "Form");

  /**
   * Submitted responses are patient records. Deleting the form would orphan
   * them and destroy the field definitions needed to read them back, so
   * archiving is the only option once anything has been submitted.
   */
  const responseCount = await FormResponse.countDocuments(
    tenantScoped(actor.hospitalId, { formId }),
  );

  if (responseCount > 0) {
    throw ApiError.conflict(
      `This form has ${responseCount} submitted ${
        responseCount === 1 ? "response" : "responses"
      }. Archive it instead — deleting it would destroy those patient records.`,
    );
  }

  await FormField.deleteMany(tenantScoped(actor.hospitalId, { formId }));
  await Form.deleteOne(tenantScoped(actor.hospitalId, { _id: formId }));

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "form.deleted",
    resource: "Form",
    resourceId: formId,
    metadata: { name: form.name },
    meta,
  });
}
