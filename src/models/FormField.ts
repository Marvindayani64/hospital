import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Field-type enumerations live in lib/domain/enums.ts (a pure, import-free
 * module) so client components can use them without pulling Mongoose into the
 * browser bundle. Re-exported here so existing server imports keep working.
 */
export {
  FIELD_TYPES,
  CHOICE_TYPES,
  MULTI_VALUE_TYPES,
  type FieldType,
} from "@/lib/domain/enums";

import { FIELD_TYPES } from "@/lib/domain/enums";

const OptionSchema = new Schema(
  {
    label: { type: String, required: true, maxlength: 200 },
    value: { type: String, required: true, maxlength: 200 },
  },
  { _id: false },
);

const ValidationSchema = new Schema(
  {
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    minLength: { type: Number, default: null },
    maxLength: { type: Number, default: null },
    /** Anchored server-side before use; see lib/forms/validate.ts. */
    pattern: { type: String, default: null, maxlength: 300 },
  },
  { _id: false },
);

/**
 * Show this field only when another field's answer satisfies the condition.
 * A hidden field is never required — see lib/forms/validate.ts.
 */
const ConditionalLogicSchema = new Schema(
  {
    fieldName: { type: String, required: true, maxlength: 80 },
    operator: {
      type: String,
      required: true,
      enum: ["equals", "not_equals", "contains", "is_empty", "is_not_empty"],
    },
    value: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const FormFieldSchema = new Schema(
  {
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },

    formId: {
      type: Schema.Types.ObjectId,
      ref: "Form",
      required: true,
      index: true,
    },

    /**
     * The form version these fields belong to.
     *
     * NOT in the spec's field list, but required for Section 25 to hold: if
     * fields were keyed by formId alone, editing a form would rewrite the very
     * definitions that historical responses were answered against. Keying by
     * (formId, version) makes a published version's fields immutable.
     */
    version: { type: Number, required: true, min: 1 },

    label: { type: String, required: true, trim: true, maxlength: 200 },

    /** Machine key used in FormResponse.responses. Stable across versions. */
    fieldName: { type: String, required: true, trim: true, maxlength: 80 },

    type: { type: String, required: true, enum: FIELD_TYPES },

    required: { type: Boolean, required: true, default: false },

    /** Only meaningful for the choice types. */
    options: { type: [OptionSchema], default: [] },

    validation: { type: ValidationSchema, default: () => ({}) },

    /** Ascending display order within the version. */
    order: { type: Number, required: true, default: 0 },

    placeholder: { type: String, default: "", maxlength: 200 },
    helpText: { type: String, default: "", maxlength: 500 },
    defaultValue: { type: Schema.Types.Mixed, default: null },

    conditionalLogic: { type: ConditionalLogicSchema, default: null },
  },
  { timestamps: true },
);

/** Primary access pattern: every field of one version, in display order. */
FormFieldSchema.index({ formId: 1, version: 1, order: 1 });

/** A field name must be unique within a version, since it keys the answers. */
FormFieldSchema.index(
  { formId: 1, version: 1, fieldName: 1 },
  { unique: true },
);

export type FormFieldDoc = InferSchemaType<typeof FormFieldSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const FormField: Model<FormFieldDoc> =
  (mongoose.models.FormField as Model<FormFieldDoc>) ??
  mongoose.model<FormFieldDoc>("FormField", FormFieldSchema);
