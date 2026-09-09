import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export { GENDERS, type Gender } from "@/lib/domain/enums";

import { GENDERS } from "@/lib/domain/enums";

const EmergencyContactSchema = new Schema(
  {
    name: { type: String, default: "", maxlength: 150 },
    relationship: { type: String, default: "", maxlength: 80 },
    phone: { type: String, default: "", maxlength: 30 },
  },
  { _id: false },
);

const PatientSchema = new Schema(
  {
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },

    /**
     * Human-readable reference, e.g. `PAT-000001`. Generated from a per-tenant
     * atomic counter, so `PAT-000001` validly exists at every hospital on the
     * platform — the pair (hospitalId, patientNumber) is what is unique.
     */
    patientNumber: { type: String, required: true },

    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    lastName: { type: String, required: true, trim: true, maxlength: 100 },

    phone: { type: String, required: true, trim: true, maxlength: 30 },
    /** Optional: many patients, especially older ones, have no email. */
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 254 },

    dateOfBirth: { type: Date, default: null },
    gender: { type: String, enum: GENDERS, default: "prefer_not_to_say" },

    address: { type: String, default: "", maxlength: 300 },
    emergencyContact: { type: EmergencyContactSchema, default: () => ({}) },

    /** Free-text administrative notes. Clinical findings belong on a Visit. */
    notes: { type: String, default: "", maxlength: 2000 },
  },
  { timestamps: true },
);

/** Per-tenant uniqueness of the human-readable reference (Section 19). */
PatientSchema.index({ hospitalId: 1, patientNumber: 1 }, { unique: true });

/** Phone is the field front-desk staff search by most often. */
PatientSchema.index({ hospitalId: 1, phone: 1 });

/** Supports name search and the default alphabetical listing. */
PatientSchema.index({ hospitalId: 1, lastName: 1, firstName: 1 });

export type PatientDoc = InferSchemaType<typeof PatientSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Patient: Model<PatientDoc> =
  (mongoose.models.Patient as Model<PatientDoc>) ??
  mongoose.model<PatientDoc>("Patient", PatientSchema);
