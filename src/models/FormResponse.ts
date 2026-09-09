import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * A submitted form (Section 24).
 *
 * Submitting NEVER touches the form definition. The response records the
 * version it was answered against, so it always resolves to the exact fields
 * the patient saw — even after the form is edited many times (Section 25).
 */
const FormResponseSchema = new Schema(
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
     * Pinned at submission time and never updated. This is what makes
     * historical responses stable: FormField rows for (formId, formVersion)
     * are immutable once any response references them.
     */
    formVersion: { type: Number, required: true, min: 1 },

    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },

    /** Optional: a form may be filled outside the context of a booking. */
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },

    /**
     * Optional link to the clinical encounter this was captured during.
     *
     * This is how specialty-specific data reaches a Visit without any of it
     * entering the Visit schema (Section 26). Holding the link HERE rather than
     * as an array on Visit means a response structurally cannot be attached to
     * two visits at once.
     */
    visitId: {
      type: Schema.Types.ObjectId,
      ref: "Visit",
      default: null,
      index: true,
    },

    submittedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    /**
     * `{ [fieldName]: value }`, validated against the version's field
     * definitions before it is written. Stored as Mixed because the shape is
     * defined by tenant configuration, not by this schema — which is the entire
     * point of a generic form builder.
     */
    responses: { type: Schema.Types.Mixed, required: true, default: {} },

    submittedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

/** A patient's submissions, newest first. */
FormResponseSchema.index({ hospitalId: 1, patientId: 1, submittedAt: -1 });

/** All submissions of one form, for review and export. */
FormResponseSchema.index({ hospitalId: 1, formId: 1, submittedAt: -1 });

export type FormResponseDoc = InferSchemaType<typeof FormResponseSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const FormResponse: Model<FormResponseDoc> =
  (mongoose.models.FormResponse as Model<FormResponseDoc>) ??
  mongoose.model<FormResponseDoc>("FormResponse", FormResponseSchema);
