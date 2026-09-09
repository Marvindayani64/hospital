import { z } from "zod";
import { objectIdSchema, paginationSchema } from "@/schemas/common";
import { APPOINTMENT_STATUSES } from "@/models/Appointment";
import { DATE_PATTERN, TIME_PATTERN, isValidDateString, timeToMinutes } from "@/utils/time";

const dateString = z
  .string()
  .trim()
  .regex(DATE_PATTERN, "Use YYYY-MM-DD format.")
  .refine(isValidDateString, { message: "That date does not exist." });

const timeString = z
  .string()
  .trim()
  .regex(TIME_PATTERN, "Use 24-hour HH:mm format.");

/**
 * Every id here is validated for SHAPE only. Whether each record actually
 * belongs to the caller's hospital is checked in the service against the
 * authenticated tenant — a schema can never establish ownership.
 */
export const createAppointmentSchema = z
  .object({
    patientId: objectIdSchema,
    doctorId: objectIdSchema,
    departmentId: objectIdSchema,
    /** Optional: a plain consultation need not map to a priced treatment. */
    treatmentId: objectIdSchema.nullish(),
    appointmentDate: dateString,
    startTime: timeString,
    endTime: timeString,
    status: z.enum(APPOINTMENT_STATUSES).default("scheduled"),
    notes: z.string().trim().max(2000).optional().default(""),
  })
  .refine(
    (data) => {
      const start = timeToMinutes(data.startTime);
      const end = timeToMinutes(data.endTime);
      return start !== null && end !== null && end > start;
    },
    { message: "End time must be after start time.", path: ["endTime"] },
  );

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

/**
 * Rescheduling accepts date and times together. Supplying only one half would
 * leave the pair inconsistent, so the refine below requires both times whenever
 * either is present.
 */
export const updateAppointmentSchema = z
  .object({
    patientId: objectIdSchema.optional(),
    doctorId: objectIdSchema.optional(),
    departmentId: objectIdSchema.optional(),
    treatmentId: objectIdSchema.nullish(),
    appointmentDate: dateString.optional(),
    startTime: timeString.optional(),
    endTime: timeString.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  })
  .refine(
    (data) =>
      (data.startTime === undefined) === (data.endTime === undefined),
    {
      message: "Provide both a start and an end time when rescheduling.",
      path: ["endTime"],
    },
  )
  .refine(
    (data) => {
      if (data.startTime === undefined || data.endTime === undefined) return true;
      const start = timeToMinutes(data.startTime);
      const end = timeToMinutes(data.endTime);
      return start !== null && end !== null && end > start;
    },
    { message: "End time must be after start time.", path: ["endTime"] },
  );

export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

/** Status changes go through their own endpoint so transitions can be policed. */
export const changeAppointmentStatusSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES),
  cancellationReason: z.string().trim().max(500).optional().default(""),
});

export const listAppointmentsSchema = paginationSchema.extend({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  doctorId: objectIdSchema.optional(),
  patientId: objectIdSchema.optional(),
  departmentId: objectIdSchema.optional(),
  /** Inclusive date range. */
  from: dateString.optional(),
  to: dateString.optional(),
});
