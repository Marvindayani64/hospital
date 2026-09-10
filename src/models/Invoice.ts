import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export {
  INVOICE_STATUSES,
  DISCOUNT_TYPES,
  type InvoiceStatus,
  type DiscountType,
} from "@/lib/domain/enums";

import { INVOICE_STATUSES, DISCOUNT_TYPES } from "@/lib/domain/enums";

/**
 * A single billed line.
 *
 * Embedded rather than a separate collection: items are always read with their
 * invoice and never queried independently, so embedding keeps a historical
 * invoice a single self-contained document.
 *
 * `unitPriceMinor` is a SNAPSHOT taken from the treatment when the line was
 * added. Re-pricing a treatment next month must not silently rewrite invoices
 * already issued — the same principle as form versioning in Phase 5.
 */
const InvoiceItemSchema = new Schema(
  {
    /**
     * What kind of charge this line is, so a stored invoice can still be
     * totalled field-wise — doctor fees apart from treatment fees — long after
     * the description text has been edited.
     *
     * Derived from which reference the line carries, but STORED, because that
     * is not recoverable afterwards: a consultation line and an ad-hoc line
     * both have a null `treatmentId`, and telling them apart by reading the
     * description would be guesswork.
     */
    kind: {
      type: String,
      required: true,
      enum: ["treatment", "consultation", "adhoc"],
      default: "adhoc",
    },

    /** Nullable so an ad-hoc line can be billed without a catalogue entry. */
    treatmentId: {
      type: Schema.Types.ObjectId,
      ref: "Treatment",
      default: null,
    },

    /** Set on a consultation line — which doctor's fee this is. */
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      default: null,
    },

    /** Copied from the treatment name, so the line reads correctly forever. */
    description: { type: String, required: true, trim: true, maxlength: 300 },

    quantity: { type: Number, required: true, min: 1, max: 10_000 },

    unitPriceMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "unitPriceMinor must be a whole number of minor units.",
      },
    },

    /** quantity × unitPriceMinor, stored so the document needs no arithmetic to read. */
    lineTotalMinor: { type: Number, required: true, min: 0 },
  },
  { _id: true },
);

const InvoiceSchema = new Schema(
  {
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },

    /** Per-tenant reference, e.g. `INV-000001`, from the atomic counter. */
    invoiceNumber: { type: String, required: true },

    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },

    /** Optional: not every invoice arises from a booking. */
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },

    items: { type: [InvoiceItemSchema], default: [] },

    // ---------------------------------------------------------------------
    // Every amount below is computed SERVER-SIDE from `items` and the discount
    // and tax settings. None of them is ever accepted from a client
    // (Section 27). They are stored so an issued invoice is a fixed record.
    // ---------------------------------------------------------------------

    subtotalMinor: { type: Number, required: true, default: 0, min: 0 },

    discountType: {
      type: String,
      required: true,
      enum: DISCOUNT_TYPES,
      default: "none",
    },
    /** A minor-unit amount when fixed, or a percentage when percent. */
    discountValue: { type: Number, required: true, default: 0, min: 0 },
    discountMinor: { type: Number, required: true, default: 0, min: 0 },

    taxRatePercent: { type: Number, required: true, default: 0, min: 0, max: 100 },
    taxMinor: { type: Number, required: true, default: 0, min: 0 },

    totalMinor: { type: Number, required: true, default: 0, min: 0 },

    /**
     * Lifecycle only. Paid-ness is DERIVED from the sum of payments rather than
     * stored here — keeping both would let the two disagree, and a stored
     * "paid" flag that contradicts the payment ledger is the worst possible
     * failure mode for billing.
     */
    status: {
      type: String,
      required: true,
      enum: INVOICE_STATUSES,
      default: "draft",
    },

    notes: { type: String, default: "", maxlength: 2000 },

    issuedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: "", maxlength: 500 },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

InvoiceSchema.index({ hospitalId: 1, invoiceNumber: 1 }, { unique: true });
InvoiceSchema.index({ hospitalId: 1, patientId: 1, createdAt: -1 });
InvoiceSchema.index({ hospitalId: 1, status: 1, createdAt: -1 });

export type InvoiceDoc = InferSchemaType<typeof InvoiceSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Invoice: Model<InvoiceDoc> =
  (mongoose.models.Invoice as Model<InvoiceDoc>) ??
  mongoose.model<InvoiceDoc>("Invoice", InvoiceSchema);
