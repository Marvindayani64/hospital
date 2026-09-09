import { z } from "zod";
import { objectIdSchema, paginationSchema, searchSchema } from "@/schemas/common";
import { FORM_STATUSES } from "@/models/Form";
import { CHOICE_TYPES, FIELD_TYPES } from "@/models/FormField";

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

export const createFormSchema = z.object({
  name: z.string().trim().min(2, "Form name must be at least 2 characters.").max(150),
  description: z.string().trim().max(1000).optional().default(""),
  category: z.string().trim().max(80).optional().default(""),
});

export type CreateFormInput = z.infer<typeof createFormSchema>;

export const updateFormSchema = z
  .object({
    name: z.string().trim().min(2).max(150).optional(),
    description: z.string().trim().max(1000).optional(),
    category: z.string().trim().max(80).optional(),
    status: z.enum(FORM_STATUSES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateFormInput = z.infer<typeof updateFormSchema>;

export const listFormsSchema = paginationSchema.merge(searchSchema).extend({
  status: z.enum(FORM_STATUSES).optional(),
  category: z.string().trim().max(80).optional(),
});

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * A machine key: lowercase, starts with a letter, no spaces. It becomes an
 * object key in FormResponse.responses, so it must be stable and predictable.
 */
const fieldNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Use lowercase letters, numbers and underscores, starting with a letter.",
  );

const optionSchema = z.object({
  label: z.string().trim().min(1, "Option label is required.").max(200),
  value: z.string().trim().min(1, "Option value is required.").max(200),
});

const validationRulesSchema = z.object({
  min: z.number().finite().nullable().optional(),
  max: z.number().finite().nullable().optional(),
  minLength: z.number().int().min(0).max(5000).nullable().optional(),
  maxLength: z.number().int().min(1).max(5000).nullable().optional(),
  pattern: z.string().trim().max(300).nullable().optional(),
});

const conditionalLogicSchema = z
  .object({
    fieldName: fieldNameSchema,
    operator: z.enum([
      "equals",
      "not_equals",
      "contains",
      "is_empty",
      "is_not_empty",
    ]),
    value: z.union([z.string().max(200), z.number(), z.boolean()]).nullable().optional(),
  })
  .nullable()
  .optional();

export const formFieldSchema = z
  .object({
    label: z.string().trim().min(1, "Label is required.").max(200),
    fieldName: fieldNameSchema,
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    options: z.array(optionSchema).max(100).default([]),
    validation: validationRulesSchema.default({}),
    placeholder: z.string().trim().max(200).default(""),
    helpText: z.string().trim().max(500).default(""),
    defaultValue: z
      .union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(200))])
      .nullable()
      .default(null),
    conditionalLogic: conditionalLogicSchema,
  })
  .refine(
    // A select with no options is unanswerable, so reject it at authoring time
    // rather than letting staff discover it when a patient cannot submit.
    (field) =>
      !CHOICE_TYPES.includes(field.type) || field.options.length > 0,
    {
      message: "Choice fields need at least one option.",
      path: ["options"],
    },
  )
  .refine(
    (field) => {
      if (!CHOICE_TYPES.includes(field.type)) return true;
      const values = field.options.map((option) => option.value);
      return new Set(values).size === values.length;
    },
    { message: "Option values must be unique.", path: ["options"] },
  );

export type FormFieldInput = z.infer<typeof formFieldSchema>;

/**
 * Fields are saved as a complete ordered set rather than one at a time.
 *
 * Reordering, adding and removing fields is a single coherent edit — applying
 * it atomically avoids ever persisting a half-updated form, and lets the
 * versioning decision be made once for the whole change.
 */
export const saveFieldsSchema = z
  .object({
    fields: z.array(formFieldSchema).max(200),
  })
  .refine(
    (data) => {
      const names = data.fields.map((field) => field.fieldName);
      return new Set(names).size === names.length;
    },
    { message: "Field names must be unique within a form.", path: ["fields"] },
  )
  .refine(
    (data) => {
      // A condition referring to a field that does not exist would leave the
      // dependent field permanently hidden or permanently shown.
      const names = new Set(data.fields.map((field) => field.fieldName));
      return data.fields.every(
        (field) =>
          !field.conditionalLogic ||
          names.has(field.conditionalLogic.fieldName),
      );
    },
    {
      message: "A conditional rule refers to a field that does not exist.",
      path: ["fields"],
    },
  )
  .refine(
    (data) =>
      data.fields.every(
        (field) => field.conditionalLogic?.fieldName !== field.fieldName,
      ),
    {
      message: "A field cannot depend on itself.",
      path: ["fields"],
    },
  );

export type SaveFieldsInput = z.infer<typeof saveFieldsSchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * The answers are validated dynamically against the form version's field
 * definitions (lib/forms/validate.ts), so Zod only checks the envelope here.
 */
export const submitResponseSchema = z.object({
  patientId: objectIdSchema,
  appointmentId: objectIdSchema.nullish(),
  responses: z.record(z.string().max(80), z.unknown()),
});

export type SubmitResponseInput = z.infer<typeof submitResponseSchema>;

export const listResponsesSchema = paginationSchema.extend({
  patientId: objectIdSchema.optional(),
});
