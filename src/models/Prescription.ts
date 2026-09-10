import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export {
  PRESCRIPTION_STATUSES,
  SETTLED_PRESCRIPTION_STATUSES,
  type PrescriptionStatus,
} from "@/lib/domain/enums";

import { PRESCRIPTION_STATUSES } from "@/lib/domain/enums";

/**
 * One drug on a prescription.
 *
 * Free text rather than a reference to a drug catalogue: this system has no
 * formulary, and inventing one would make prescribing depend on a hospital
 * having populated it first. Only the name is required — a doctor writing
 * "Paracetamol 500mg, as needed" in one line must not be blocked by five
 * mandatory fields.
 */
const PrescriptionItemSchema = new Schema(
  {
    drugName: { type: String, required: true, trim: true, maxlength: 200 },
    /** e.g. "500mg", "10ml". */
    dosage: { type: String, default: "", trim: true, maxlength: 100 },
    /** e.g. "Twice daily", "Every 8 hours". */
    frequency: { type: String, default: "", trim: true, maxlength: 100 },
    /** e.g. "5 days", "2 weeks". */
    duration: { type: String, default: "", trim: true, maxlength: 100 },
    /** e.g. "After food", "Do not drive". */
    instructions: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { _id: false },
);

const PrescriptionSchema = new Schema(
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
     * The consultation this prescription came out of.
     *
     * REQUIRED, unlike Visit.appointmentId. A prescription is a clinical act
     * and must sit on a clinical record, so prescription.service.ts records the
     * visit as part of writing one — reusing that day's visit when the doctor
     * has already written it up, and creating it otherwise. There is therefore
     * no such thing as a prescription without a visit, which is also why
     * deleting a patient or doctor is already blocked by their visits.
     */
    visitId: {
      type: Schema.Types.ObjectId,
      ref: "Visit",
      required: true,
    },

    /**
     * Clinical date as `YYYY-MM-DD` in hospital-local time — the same
     * wall-clock convention as visits and appointments (see utils/time.ts), and
     * always equal to the visit's own date.
     */
    prescribedDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    items: {
      type: [PrescriptionItemSchema],
      default: [],
      validate: {
        // A prescription with no drugs on it is not a prescription.
        validator: (items: unknown[]) => items.length > 0,
        message: "A prescription must list at least one drug.",
      },
    },

    /** Note from the prescriber to the pharmacy. Not clinical findings. */
    notes: { type: String, default: "", maxlength: 2000 },

    status: {
      type: String,
      required: true,
      enum: PRESCRIPTION_STATUSES,
      default: "pending",
    },

    /** Set when the pharmacy dispenses or withdraws it. */
    dispensedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    dispensedAt: { type: Date, default: null },
    dispensingNotes: { type: String, default: "", maxlength: 1000 },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

/**
 * The pharmacy queue: pending work, oldest first.
 *
 * Status leads because the queue is almost always filtered to one status, and
 * the date orders within it.
 */
PrescriptionSchema.index({ hospitalId: 1, status: 1, prescribedDate: 1 });

/** A patient's prescription history, most recent first. */
PrescriptionSchema.index({ hospitalId: 1, patientId: 1, prescribedDate: -1 });

/** Prescriptions written during one consultation. */
PrescriptionSchema.index({ hospitalId: 1, visitId: 1 });

/** A prescriber's own output, for the doctor filter on the queue. */
PrescriptionSchema.index({ hospitalId: 1, doctorId: 1, prescribedDate: -1 });

export type PrescriptionDoc = InferSchemaType<typeof PrescriptionSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Prescription: Model<PrescriptionDoc> =
  (mongoose.models.Prescription as Model<PrescriptionDoc>) ??
  mongoose.model<PrescriptionDoc>("Prescription", PrescriptionSchema);
