import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const UserSchema = new Schema(
  {
    /**
     * `null` marks a platform Super Admin. Every other user MUST carry a
     * hospitalId — this is the tenant discriminator the whole system relies on.
     * It is never editable through the normal user UI.
     */
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      default: null,
      index: true,
    },

    name: { type: String, required: true, trim: true, maxlength: 150 },
    email: { type: String, required: true, trim: true, lowercase: true },

    /** Argon2/bcrypt hash. Excluded from query results by default. */
    passwordHash: { type: String, required: true, select: false },

    /** `null` only for Super Admin, who is not governed by tenant RBAC. */
    roleId: { type: Schema.Types.ObjectId, ref: "Role", default: null },

    isSuperAdmin: { type: Boolean, required: true, default: false },

    status: {
      type: String,
      required: true,
      enum: ["active", "inactive"],
      default: "active",
    },

    mustChangePassword: { type: Boolean, required: true, default: false },

    /**
     * Bumped on password change, "logout everywhere", and admin
     * deactivation/reactivation. requireAuth() compares this against the value
     * embedded in the access token, so a bump locks the user out on their very
     * next request instead of at natural token expiry.
     */
    tokenVersion: { type: Number, required: true, default: 0 },

    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/**
 * Email uniqueness is scoped PER TENANT (Section 16 recommendation): the same
 * person may legitimately be staff at two hospitals on the platform. Super
 * Admins all share `hospitalId: null`, so this same index also enforces
 * uniqueness among platform admins as a distinct namespace.
 */
UserSchema.index({ hospitalId: 1, email: 1 }, { unique: true });

export type UserDoc = InferSchemaType<typeof UserSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ??
  mongoose.model<UserDoc>("User", UserSchema);
