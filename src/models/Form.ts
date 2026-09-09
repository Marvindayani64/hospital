import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * A hospital-defined form (Section 22).
 *
 * There is deliberately no HairForm, SkinForm or DentalForm model anywhere in
 * this codebase. A hair clinic's "Hair Assessment" and a dental clinic's
 * "Orthodontic Intake" are the same Form model with different FormField rows —
 * adding a new kind of form is configuration, never code.
 */
export { FORM_STATUSES, type FormStatus } from "@/lib/domain/enums";

import { FORM_STATUSES } from "@/lib/domain/enums";

const FormSchema = new Schema(
  {
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, default: "", maxlength: 1000 },

    /** Free-text grouping, e.g. "intake", "consent", "assessment". */
    category: { type: String, default: "", trim: true, maxlength: 80 },

    /**
     * draft     — still being built; cannot receive responses, edits are free.
     * published — accepting responses; edits fork a new version.
     * archived  — no longer accepting responses, history retained.
     */
    status: {
      type: String,
      required: true,
      enum: FORM_STATUSES,
      default: "draft",
    },

    /**
     * The version currently being served. FormField rows are keyed by
     * (formId, version), and every FormResponse records the version it was
     * answered against, so historical responses always resolve to the exact
     * field definitions the patient actually saw (Section 25).
     */
    currentVersion: { type: Number, required: true, default: 1, min: 1 },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

/** Unique per tenant: two forms with the same name would be ambiguous to staff. */
FormSchema.index({ hospitalId: 1, name: 1 }, { unique: true });

export type FormDoc = InferSchemaType<typeof FormSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Form: Model<FormDoc> =
  (mongoose.models.Form as Model<FormDoc>) ??
  mongoose.model<FormDoc>("Form", FormSchema);
