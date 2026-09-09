import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { HOSPITAL_TYPES } from "@/types";
import { CURRENCY_CODES, DEFAULT_CURRENCY } from "@/utils/money";

const HospitalSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    type: { type: String, required: true, enum: HOSPITAL_TYPES, default: "general" },

    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    logo: { type: String, default: null },

    address: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    country: { type: String, default: "" },
    postalCode: { type: String, default: "" },

    status: {
      type: String,
      required: true,
      enum: ["active", "inactive", "suspended"],
      default: "active",
      index: true,
    },

    /**
     * Billing currency for this tenant. Treatment prices are stored as minor
     * units of THIS currency, so it lives here rather than on each treatment —
     * one hospital bills in one currency, and duplicating it per record would
     * let the two drift apart.
     */
    currency: {
      type: String,
      required: true,
      enum: CURRENCY_CODES,
      default: DEFAULT_CURRENCY,
    },

    /**
     * Default tax rate applied to new invoices, as a percentage. An invoice can
     * override it, and the stored rate on each invoice is what its tax was
     * actually computed from — changing this default never re-taxes history.
     *
     * Phase 8 exposes this in hospital settings; it lives here now because an
     * invoice needs a sensible default without staff retyping it every time.
     */
    defaultTaxRatePercent: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: 100,
    },

    /**
     * Tenant-owned configuration (Section 36).
     *
     * Distinct from the platform-owned fields above: these are edited by the
     * Hospital Admin through /api/hospital/settings, whereas name, status and
     * currency remain the platform administrator's to set.
     */
    settings: {
      type: new Schema(
        {
          /** Reference prefix for generated invoice numbers, e.g. "INV". */
          invoicePrefix: {
            type: String,
            default: "INV",
            trim: true,
            uppercase: true,
            maxlength: 8,
          },
          /** Footer text printed on every invoice — payment terms, bank details. */
          invoiceFooter: { type: String, default: "", maxlength: 1000 },

          /** Default appointment length offered in the booking form. */
          appointmentSlotMinutes: {
            type: Number,
            default: 30,
            min: 5,
            max: 480,
          },

          /**
           * Notification preferences.
           *
           * Stored and honoured by the settings API, but nothing DELIVERS on
           * them yet — that needs an email/SMS provider, which is the first
           * external dependency this project would take on. Recording the
           * preference now means the delivery layer has something to read when
           * it is added, rather than the toggle being invented later.
           */
          notifications: {
            type: new Schema(
              {
                appointmentReminders: { type: Boolean, default: false },
                invoiceIssued: { type: Boolean, default: false },
                followUpReminders: { type: Boolean, default: false },
              },
              { _id: false },
            ),
            default: () => ({}),
          },
        },
        { _id: false },
      ),
      default: () => ({}),
    },

    /**
     * Bumped whenever the hospital is suspended, deactivated or reactivated.
     * Every access token carries the value that was current at issue time, so a
     * single write here invalidates every token belonging to every user of this
     * hospital — no bulk update of the User collection required.
     */
    tokenVersion: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export type HospitalDoc = InferSchemaType<typeof HospitalSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Hospital: Model<HospitalDoc> =
  (mongoose.models.Hospital as Model<HospitalDoc>) ??
  mongoose.model<HospitalDoc>("Hospital", HospitalSchema);
