import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * One row per device/session. Only the SHA-256 hash of the raw refresh token is
 * stored, so a database leak does not hand an attacker usable tokens.
 */
const RefreshTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /** Denormalised so a whole tenant's sessions can be revoked in one query. */
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      default: null,
      index: true,
    },

    tokenHash: { type: String, required: true, unique: true },

    /** Links a rotated token to its predecessor, for reuse detection. */
    replacedBy: { type: String, default: null },

    deviceInfo: { type: String, default: "" },
    ipAddress: { type: String, default: "" },

    issuedAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

RefreshTokenSchema.index({ userId: 1, revokedAt: 1 });

/**
 * TTL index: Mongo purges rows once `expiresAt` passes, so the collection does
 * not grow without bound. Revoked-but-unexpired rows are deliberately retained
 * until then so refresh-token reuse can still be detected.
 */
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshTokenDoc = InferSchemaType<typeof RefreshTokenSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const RefreshToken: Model<RefreshTokenDoc> =
  (mongoose.models.RefreshToken as Model<RefreshTokenDoc>) ??
  mongoose.model<RefreshTokenDoc>("RefreshToken", RefreshTokenSchema);
