import { z } from "zod";
import {
  optionalEmailSchema,
  optionalPhoneSchema,
  paginationSchema,
} from "@/schemas/common";
import { DATE_PATTERN, isValidDateString } from "@/utils/time";

/**
 * Hospital settings editable by the TENANT (Section 36).
 *
 * Deliberately absent: `status`, `currency`, `slug` and `tokenVersion`.
 * Status is a platform control, currency would reinterpret every stored price,
 * and the other two are internal. A Hospital Admin editing their own settings
 * must not be able to reach any of them, so they have no field here.
 */
export const updateSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    email: optionalEmailSchema.optional(),
    phone: optionalPhoneSchema.optional(),
    logo: z
      .union([z.literal(""), z.string().trim().url("Logo must be a valid URL.").max(500)])
      .optional(),
    address: z.string().trim().max(300).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    country: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(20).optional(),

    defaultTaxRatePercent: z.number().finite().min(0).max(100).optional(),

    invoicePrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9]{0,7}$/, "Use 1–8 letters or digits, starting with a letter.")
      .optional(),
    invoiceFooter: z.string().trim().max(1000).optional(),

    appointmentSlotMinutes: z.coerce.number().int().min(5).max(480).optional(),

    notifications: z
      .object({
        appointmentReminders: z.boolean().optional(),
        invoiceIssued: z.boolean().optional(),
        followUpReminders: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

const dateString = z
  .string()
  .trim()
  .regex(DATE_PATTERN, "Use YYYY-MM-DD format.")
  .refine(isValidDateString, { message: "That date does not exist." });

export const listAuditLogsSchema = paginationSchema.extend({
  action: z.string().trim().max(80).optional(),
  resource: z.string().trim().max(60).optional(),
  userId: z.string().trim().max(40).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const reportRangeSchema = z.object({
  from: dateString,
  to: dateString,
});

export type ReportRangeInput = z.infer<typeof reportRangeSchema>;
