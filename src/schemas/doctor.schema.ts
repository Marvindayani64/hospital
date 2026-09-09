import { z } from "zod";
import { objectIdSchema, paginationSchema, searchSchema } from "@/schemas/common";
import { TIME_PATTERN, timeToMinutes } from "@/utils/time";

const timeString = z
  .string()
  .trim()
  .regex(TIME_PATTERN, "Use 24-hour HH:mm format.");

/**
 * A weekly availability window. Accepted as `HH:mm` strings and converted to
 * minutes-from-midnight in the service.
 */
const availabilityWindowSchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    startTime: timeString,
    endTime: timeString,
  })
  .refine(
    (window) => {
      const start = timeToMinutes(window.startTime);
      const end = timeToMinutes(window.endTime);
      return start !== null && end !== null && end > start;
    },
    { message: "End time must be after start time.", path: ["endTime"] },
  );

const availabilityBase = z
  .array(availabilityWindowSchema)
  .max(21, "At most three windows per day.");

const feeBase = z
  .number({ invalid_type_error: "Consultation fee must be a number." })
  .min(0, "Consultation fee cannot be negative.")
  .max(100_000_000)
  .finite();

export const createDoctorSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Doctor name must be at least 2 characters.")
    .max(150),
  /** Optional link to a staff login account; must belong to the same hospital. */
  userId: objectIdSchema.nullish(),
  specialization: z.string().trim().max(150).optional().default(""),
  departmentIds: z
    .array(objectIdSchema)
    .max(20)
    .optional()
    .default([])
    .transform((values) => [...new Set(values)]),
  /** Major units; converted to minor units against the hospital's currency. */
  consultationFee: feeBase.optional().default(0),
  availability: availabilityBase.optional().default([]),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;

// No `.default()` on optional fields here — see the note in patient.schema.ts.
export const updateDoctorSchema = z
  .object({
    displayName: z.string().trim().min(2).max(150).optional(),
    userId: objectIdSchema.nullish(),
    specialization: z.string().trim().max(150).optional(),
    departmentIds: z
      .array(objectIdSchema)
      .max(20)
      .optional()
      .transform((values) => (values ? [...new Set(values)] : values)),
    consultationFee: feeBase.optional(),
    availability: availabilityBase.optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;

export const listDoctorsSchema = paginationSchema.merge(searchSchema).extend({
  status: z.enum(["active", "inactive"]).optional(),
  departmentId: objectIdSchema.optional(),
});
