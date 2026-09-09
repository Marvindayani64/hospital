import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Treatments / services offered by one hospital, with that hospital's own
 * pricing (Section 18).
 *
 * The same treatment name may exist in many hospitals at completely different
 * prices — price belongs to the tenant's configuration, and no business logic
 * anywhere contains a hard-coded amount.
 */
const TreatmentSchema = new Schema(
  {
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },

    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "Department",
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, default: "", maxlength: 1000 },

    /**
     * Price in INTEGER MINOR UNITS of the hospital's currency (see
     * utils/money.ts). Storing major-unit floats would make invoice totals in
     * Phase 7 drift by fractions of a unit as lines are summed.
     *
     * The currency itself lives on the Hospital, not here — a hospital bills in
     * one currency, and duplicating it per treatment invites inconsistency.
     */
    priceMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "priceMinor must be a whole number of minor currency units.",
      },
    },

    /** Typical duration in minutes; used for appointment slotting in Phase 4. */
    durationMinutes: {
      type: Number,
      required: true,
      min: 1,
      max: 1440,
      default: 30,
    },

    status: {
      type: String,
      required: true,
      enum: ["active", "inactive"],
      default: "active",
    },

    /**
     * Free-form, hospital-defined attributes (Section 18). This is what lets a
     * hair clinic record "sessions" and a dental clinic record "tooth surfaces"
     * without either concept entering the schema or the code.
     */
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

// Primary listing access pattern: this hospital's treatments, by department.
TreatmentSchema.index({ hospitalId: 1, departmentId: 1 });

/** Guards against the same service being entered twice in one department. */
TreatmentSchema.index({ hospitalId: 1, departmentId: 1, name: 1 }, { unique: true });

export type TreatmentDoc = InferSchemaType<typeof TreatmentSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Treatment: Model<TreatmentDoc> =
  (mongoose.models.Treatment as Model<TreatmentDoc>) ??
  mongoose.model<TreatmentDoc>("Treatment", TreatmentSchema);
