import { z } from "zod";
import { objectIdSchema, paginationSchema, searchSchema } from "@/schemas/common";
import { DATE_PATTERN, isValidDateString } from "@/utils/time";

const dateString = z
  .string()
  .trim()
  .regex(DATE_PATTERN, "Use YYYY-MM-DD format.")
  .refine(isValidDateString, { message: "That date does not exist." });

/** Empty string clears an existing follow-up date. */
const followUpBase = z.union([z.literal(""), dateString]);

export const createVisitSchema = z
  .object({
    patientId: objectIdSchema,
    doctorId: objectIdSchema,
    /** Optional: walk-ins have no booking. */
    appointmentId: objectIdSchema.nullish(),
    treatmentId: objectIdSchema.nullish(),
    visitDate: dateString,
    symptoms: z.string().trim().max(4000).optional().default(""),
    diagnosis: z.string().trim().max(4000).optional().default(""),
    notes: z.string().trim().max(8000).optional().default(""),
    recommendations: z.string().trim().max(4000).optional().default(""),
    followUpDate: followUpBase.optional().default(""),
    /**
     * Form responses captured during this encounter. This is the route by
     * which specialty-specific data joins a visit (Section 26).
     */
    formResponseIds: z.array(objectIdSchema).max(50).optional().default([]),
  })
  .refine(
    (data) =>
      data.followUpDate === "" || data.followUpDate >= data.visitDate,
    {
      message: "The follow-up date cannot be before the visit date.",
      path: ["followUpDate"],
    },
  );

export type CreateVisitInput = z.infer<typeof createVisitSchema>;

// No `.default()` on optional fields — see the note in patient.schema.ts.
export const updateVisitSchema = z
  .object({
    doctorId: objectIdSchema.optional(),
    treatmentId: objectIdSchema.nullish(),
    visitDate: dateString.optional(),
    symptoms: z.string().trim().max(4000).optional(),
    diagnosis: z.string().trim().max(4000).optional(),
    notes: z.string().trim().max(8000).optional(),
    recommendations: z.string().trim().max(4000).optional(),
    followUpDate: followUpBase.optional(),
    formResponseIds: z.array(objectIdSchema).max(50).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateVisitInput = z.infer<typeof updateVisitSchema>;

/**
 * `patientId` and `appointmentId` are absent from the update schema on purpose:
 * moving a clinical record to a different patient is never a legitimate edit,
 * and would silently corrupt two medical histories at once.
 */

export const listVisitsSchema = paginationSchema.merge(searchSchema).extend({
  patientId: objectIdSchema.optional(),
  doctorId: objectIdSchema.optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  /** Visits with a follow-up due on or before this date. */
  followUpBefore: dateString.optional(),
});
