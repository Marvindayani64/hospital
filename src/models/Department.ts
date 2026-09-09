import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Departments are pure tenant configuration — Hair, Skin, Dental, Cardiology,
 * whatever a given hospital runs. Nothing is hard-coded anywhere in the
 * application (Sections 17 and 39): adding a specialty is a data change made by
 * the Hospital Admin, never a code change.
 */
const DepartmentSchema = new Schema(
  {
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "", maxlength: 500 },

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
 * Unique per tenant: two departments called "Dental" in one hospital is a data
 * entry mistake, but the same name in a different hospital is expected.
 */
DepartmentSchema.index({ hospitalId: 1, name: 1 }, { unique: true });

export type DepartmentDoc = InferSchemaType<typeof DepartmentSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Department: Model<DepartmentDoc> =
  (mongoose.models.Department as Model<DepartmentDoc>) ??
  mongoose.model<DepartmentDoc>("Department", DepartmentSchema);
