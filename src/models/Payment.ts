import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// See lib/domain/enums.ts — kept there so client components can import it
// without pulling Mongoose into the browser bundle.
export { PAYMENT_METHODS, type PaymentMethod } from "@/lib/domain/enums";

import { PAYMENT_METHODS } from "@/lib/domain/enums";

/**
 * A payment received against an invoice.
 *
 * Payments are an append-only ledger: there is no update or delete path, and
 * the permission catalogue (Section 11) deliberately has only `payment.create`
 * and `payment.view`. A mistaken payment is corrected by recording an
 * offsetting entry, not by editing history.
 */
const PaymentSchema = new Schema(
  {
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },

    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
      index: true,
    },

    /** Denormalised from the invoice so a patient's payments query directly. */
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },

    /** Integer minor units of the hospital's currency. */
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "amountMinor must be a whole number of minor units.",
      },
    },

    method: { type: String, required: true, enum: PAYMENT_METHODS },

    /** Transaction id, cheque number, insurance claim reference, etc. */
    reference: { type: String, default: "", trim: true, maxlength: 200 },

    notes: { type: String, default: "", maxlength: 1000 },

    receivedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    paidAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

/** Summing an invoice's payments — the hot path for every balance calculation. */
PaymentSchema.index({ hospitalId: 1, invoiceId: 1 });
PaymentSchema.index({ hospitalId: 1, patientId: 1, paidAt: -1 });
PaymentSchema.index({ hospitalId: 1, paidAt: -1 });

export type PaymentDoc = InferSchemaType<typeof PaymentSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Payment: Model<PaymentDoc> =
  (mongoose.models.Payment as Model<PaymentDoc>) ??
  mongoose.model<PaymentDoc>("Payment", PaymentSchema);
