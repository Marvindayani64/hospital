import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const AuditLogSchema = new Schema(
  {
    /** `null` for platform-level actions performed by a Super Admin. */
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      default: null,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },

    /** e.g. "hospital.created", "auth.login", "user.password_changed". */
    action: { type: String, required: true, index: true },
    resource: { type: String, required: true },
    resourceId: { type: String, default: null },

    /**
     * Free-form context. Callers must never place credentials, password hashes
     * or raw tokens in here — see audit.service.ts, which strips known-sensitive
     * keys as a second line of defence.
     */
    metadata: { type: Schema.Types.Mixed, default: {} },

    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AuditLogSchema.index({ hospitalId: 1, createdAt: -1 });

export type AuditLogDoc = InferSchemaType<typeof AuditLogSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
};

export const AuditLog: Model<AuditLogDoc> =
  (mongoose.models.AuditLog as Model<AuditLogDoc>) ??
  mongoose.model<AuditLogDoc>("AuditLog", AuditLogSchema);
