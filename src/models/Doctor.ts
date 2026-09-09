import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * A recurring weekly availability window, in the hospital's local wall-clock
 * time. Stored as minutes from midnight for the same reason appointments are —
 * see utils/time.ts.
 */
const AvailabilityWindowSchema = new Schema(
  {
    /** 0 = Sunday … 6 = Saturday. */
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    startMinutes: { type: Number, required: true, min: 0, max: 1439 },
    endMinutes: { type: Number, required: true, min: 1, max: 1440 },
  },
  { _id: false },
);

const DoctorSchema = new Schema(
  {
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },

    /**
     * Optional link to a login account.
     *
     * Nullable on purpose: a visiting consultant may need to be bookable
     * without ever signing in. When set, the User must belong to the same
     * hospital, and one User maps to at most one Doctor profile.
     */
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /** Used when a doctor has no linked account to take a name from. */
    displayName: { type: String, required: true, trim: true, maxlength: 150 },

    specialization: { type: String, default: "", trim: true, maxlength: 150 },

    /** A doctor may work across several departments (Section 20). */
    departmentIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Department" }],
      default: [],
    },

    /**
     * Consultation fee in INTEGER MINOR UNITS of the hospital's currency, for
     * the same precision reasons as Treatment.priceMinor.
     */
    consultationFeeMinor: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "consultationFeeMinor must be a whole number of minor units.",
      },
    },

    availability: { type: [AvailabilityWindowSchema], default: [] },

    status: {
      type: String,
      required: true,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  { timestamps: true },
);

/**
 * One staff account can back at most one doctor profile.
 *
 * This uses a PARTIAL index, not a sparse one. A sparse index only skips
 * documents where the field is absent — but `userId` is explicitly stored as
 * `null` for unlinked doctors, so the field is present and every unlinked
 * doctor would collide on `null` with every other. Filtering on the type
 * indexes only rows that actually carry an account reference.
 */
DoctorSchema.index(
  { hospitalId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { userId: { $type: "objectId" } },
  },
);

DoctorSchema.index({ hospitalId: 1, departmentIds: 1 });

export type DoctorDoc = InferSchemaType<typeof DoctorSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Doctor: Model<DoctorDoc> =
  (mongoose.models.Doctor as Model<DoctorDoc>) ??
  mongoose.model<DoctorDoc>("Doctor", DoctorSchema);
