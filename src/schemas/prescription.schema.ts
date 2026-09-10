import { z } from "zod";
import { objectIdSchema, paginationSchema, searchSchema } from "@/schemas/common";
import { PRESCRIPTION_STATUSES } from "@/lib/domain/enums";
import { DATE_PATTERN, isValidDateString } from "@/utils/time";

const dateString = z
  .string()
  .trim()
  .regex(DATE_PATTERN, "Use YYYY-MM-DD format.")
  .refine(isValidDateString, { message: "That date does not exist." });

/**
 * One drug line.
 *
 * Only the name is required — see the note on PrescriptionItemSchema in
 * models/Prescription.ts.
 */
export const prescriptionItemSchema = z.object({
  drugName: z.string().trim().min(1, "Enter the drug name.").max(200),
  dosage: z.string().trim().max(100).optional().default(""),
  frequency: z.string().trim().max(100).optional().default(""),
  duration: z.string().trim().max(100).optional().default(""),
  instructions: z.string().trim().max(500).optional().default(""),
});

export type PrescriptionItemInput = z.infer<typeof prescriptionItemSchema>;

export const createPrescriptionSchema = z.object({
  patientId: objectIdSchema,
  /**
   * NOTE: there is no `doctorId`. The prescriber is the signed-in user's own
   * doctor profile, resolved from the auth context in the service — the same
   * rule `hospitalId` follows, and for the same reason. Whoever writes a
   * prescription IS the prescriber, so accepting it from the request body would
   * let one clinician put another's name on a controlled document.
   */
  /**
   * The booking this consultation is for, when there is one. It is not stored
   * on the prescription: it goes onto the visit the service records, which is
   * what links a prescription back to its appointment.
   */
  appointmentId: objectIdSchema.nullish(),
  prescribedDate: dateString,
  items: z
    .array(prescriptionItemSchema)
    .min(1, "Add at least one drug.")
    .max(30, "A single prescription cannot hold more than 30 drugs."),
  /** Note to the pharmacy. */
  notes: z.string().trim().max(2000).optional().default(""),
  /**
   * Clinical finding for the consultation. Written to the visit, not to the
   * prescription — the pharmacy has no business reading it, and duplicating it
   * would create a second copy of the clinical record.
   */
  diagnosis: z.string().trim().max(4000).optional().default(""),
});

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;

/**
 * The pharmacy acting on a queued prescription. `pending` is absent on
 * purpose: a settled prescription cannot be returned to the queue.
 */
export const dispensePrescriptionSchema = z.object({
  status: z.enum(["dispensed", "cancelled"]),
  dispensingNotes: z.string().trim().max(1000).optional().default(""),
});

export type DispensePrescriptionInput = z.infer<
  typeof dispensePrescriptionSchema
>;

export const listPrescriptionsSchema = paginationSchema
  .merge(searchSchema)
  .extend({
    status: z.enum(PRESCRIPTION_STATUSES).optional(),
    patientId: objectIdSchema.optional(),
    doctorId: objectIdSchema.optional(),
    from: dateString.optional(),
    to: dateString.optional(),
  });

export type ListPrescriptionsInput = z.infer<typeof listPrescriptionsSchema>;
