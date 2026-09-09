import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * A clinical encounter (Section 26).
 *
 * Note what is NOT here: no specialty-specific fields. A dental clinic's tooth
 * chart and a hair clinic's density grading are captured through that
 * hospital's own FormResponses, linked to the visit — so supporting a new
 * specialty is configuration, never a schema change (Sections 26, 39).
 */
const VisitSchema = new Schema(
  {
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },

    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    /**
     * Optional: walk-ins and unscheduled reviews have no booking. When present,
     * the appointment must belong to the same patient, and an appointment can
     * produce at most one visit (see the index below).
     */
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },

    /** Optional: not every consultation maps to a priced treatment. */
    treatmentId: {
      type: Schema.Types.ObjectId,
      ref: "Treatment",
      default: null,
    },

    /**
     * The clinical date, as `YYYY-MM-DD` in hospital-local time — the same
     * wall-clock convention as appointments (see utils/time.ts).
     *
     * Not in the spec's field list, which has only `createdAt`. They are not
     * the same thing: a consultation is frequently written up hours or days
     * after it happened, and every clinical listing is ordered by when care was
     * given, not when the note was typed.
     */
    visitDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    symptoms: { type: String, default: "", maxlength: 4000 },
    diagnosis: { type: String, default: "", maxlength: 4000 },
    notes: { type: String, default: "", maxlength: 8000 },
    recommendations: { type: String, default: "", maxlength: 4000 },

    /** `YYYY-MM-DD`, or null when no follow-up is planned. */
    followUpDate: {
      type: String,
      default: null,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

/** A patient's clinical history, most recent first. */
VisitSchema.index({ hospitalId: 1, patientId: 1, visitDate: -1 });

/** A doctor's caseload, and the default date-ordered listing. */
VisitSchema.index({ hospitalId: 1, doctorId: 1, visitDate: -1 });
VisitSchema.index({ hospitalId: 1, visitDate: -1 });

/**
 * One visit per appointment.
 *
 * PARTIAL, not sparse: `appointmentId` is stored as an explicit `null` for
 * walk-ins, so a sparse index would still index those rows and every walk-in
 * would collide on `null`. (The same trap as Doctor.userId — see that model.)
 */
VisitSchema.index(
  { hospitalId: 1, appointmentId: 1 },
  {
    unique: true,
    partialFilterExpression: { appointmentId: { $type: "objectId" } },
  },
);

export type VisitDoc = InferSchemaType<typeof VisitSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Visit: Model<VisitDoc> =
  (mongoose.models.Visit as Model<VisitDoc>) ??
  mongoose.model<VisitDoc>("Visit", VisitSchema);
