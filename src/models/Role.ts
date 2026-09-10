import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { SYSTEM_ROLE_KEYS } from "@/lib/rbac/default-roles";

const RoleSchema = new Schema(
  {
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: "" },

    /**
     * Stable machine key for the seeded roles, so code can find "the
     * hospital admin role of this hospital" without matching on a display name
     * the admin is free to rename. `null` for custom roles.
     */
    key: { type: String, enum: [...SYSTEM_ROLE_KEYS, null], default: null },

    /** `resource.action` strings, validated against the code catalogue. */
    permissions: {
      type: [{ type: String, enum: PERMISSIONS }],
      default: [],
    },

    /** System roles are seeded on hospital creation and cannot be deleted. */
    isSystem: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

RoleSchema.index({ hospitalId: 1, name: 1 }, { unique: true });

export type RoleDoc = InferSchemaType<typeof RoleSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Role: Model<RoleDoc> =
  (mongoose.models.Role as Model<RoleDoc>) ??
  mongoose.model<RoleDoc>("Role", RoleSchema);
