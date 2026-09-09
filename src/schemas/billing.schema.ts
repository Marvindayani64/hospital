import { z } from "zod";
import { objectIdSchema, paginationSchema, searchSchema } from "@/schemas/common";
import { DISCOUNT_TYPES } from "@/models/Invoice";
import { PAYMENT_METHODS } from "@/models/Payment";

/**
 * Note what an invoice line does NOT accept: a price.
 *
 * Section 27 requires the unit price to be read from the treatment in the
 * database. Leaving `price` out of the schema entirely means a client-supplied
 * amount cannot be honoured even by mistake — the field would have nowhere to
 * land.
 */
const catalogueItemSchema = z.object({
  treatmentId: objectIdSchema,
  quantity: z.coerce.number().int().min(1).max(10_000).default(1),
  /** Overrides the treatment name on this line only; never the price. */
  description: z.string().trim().max(300).optional(),
});

/**
 * The attending doctor's consultation fee.
 *
 * Like a catalogue line it carries NO price: the server reads
 * `consultationFeeMinor` from the Doctor document in the caller's own tenant.
 * The fee is already known to the database, so billing it as an ad-hoc line —
 * which would accept a client-supplied amount — would hand away the Section 27
 * guarantee for no reason.
 */
const consultationItemSchema = z.object({
  doctorId: objectIdSchema,
  quantity: z.coerce.number().int().min(1).max(10_000).default(1),
  /** Overrides the generated "Consultation — Dr X" label; never the fee. */
  description: z.string().trim().max(300).optional(),
});

/**
 * An ad-hoc line for something not in the treatment catalogue.
 *
 * This one DOES carry a price, because there is no database entry to read it
 * from — so it is gated on `invoice.create` like any other billing action and
 * recorded in the audit log. The distinction is deliberate: catalogue lines can
 * never be re-priced by a client, and ad-hoc lines are explicitly what they are.
 */
const adHocItemSchema = z.object({
  treatmentId: z.null().optional(),
  description: z.string().trim().min(1, "A description is required.").max(300),
  quantity: z.coerce.number().int().min(1).max(10_000).default(1),
  /** Major units; converted against the hospital's currency. */
  unitPrice: z.number().finite().min(0).max(100_000_000),
});

export const invoiceItemSchema = z.union([
  catalogueItemSchema,
  consultationItemSchema,
  adHocItemSchema,
]);

export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;

export const createInvoiceSchema = z
  .object({
    patientId: objectIdSchema,
    appointmentId: objectIdSchema.nullish(),
    items: z.array(invoiceItemSchema).min(1, "Add at least one line.").max(100),
    discountType: z.enum(DISCOUNT_TYPES).default("none"),
    discountValue: z.number().finite().min(0).default(0),
    /** Defaults to the hospital's configured rate when omitted. */
    taxRatePercent: z.number().finite().min(0).max(100).optional(),
    notes: z.string().trim().max(2000).optional().default(""),
  })
  .refine(
    (data) => data.discountType !== "percent" || data.discountValue <= 100,
    {
      message: "A percentage discount cannot exceed 100%.",
      path: ["discountValue"],
    },
  );

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

// No `.default()` on optional fields — see the note in patient.schema.ts.
export const updateInvoiceSchema = z
  .object({
    items: z.array(invoiceItemSchema).min(1).max(100).optional(),
    discountType: z.enum(DISCOUNT_TYPES).optional(),
    discountValue: z.number().finite().min(0).optional(),
    taxRatePercent: z.number().finite().min(0).max(100).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  })
  .refine(
    (data) =>
      data.discountType !== "percent" ||
      data.discountValue === undefined ||
      data.discountValue <= 100,
    {
      message: "A percentage discount cannot exceed 100%.",
      path: ["discountValue"],
    },
  );

export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

/** Lifecycle transitions live on their own verb so each can be policed. */
export const changeInvoiceStatusSchema = z.object({
  status: z.enum(["issued", "cancelled"]),
  cancellationReason: z.string().trim().max(500).optional().default(""),
});

export const listInvoicesSchema = paginationSchema.merge(searchSchema).extend({
  patientId: objectIdSchema.optional(),
  status: z.enum(["draft", "issued", "cancelled"]).optional(),
  /** Derived from the payment ledger, not from a stored field. */
  paymentStatus: z.enum(["unpaid", "partially_paid", "paid"]).optional(),
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const createPaymentSchema = z.object({
  invoiceId: objectIdSchema,
  /** Major units; converted against the hospital's currency. */
  amount: z
    .number({ invalid_type_error: "Amount must be a number." })
    .finite()
    .positive("Amount must be greater than zero.")
    .max(100_000_000),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(200).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const listPaymentsSchema = paginationSchema.extend({
  invoiceId: objectIdSchema.optional(),
  patientId: objectIdSchema.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
});
