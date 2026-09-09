import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export {
  APPOINTMENT_STATUSES,
  RELEASING_STATUSES,
  TERMINAL_STATUSES,
  type AppointmentStatus,
} from "@/lib/domain/enums";

import { APPOINTMENT_STATUSES } from "@/lib/domain/enums";

const AppointmentSchema = new Schema(
  {
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },

    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "Department",
      required: true,
    },
    /** Optional: a plain consultation need not map to a priced treatment. */
    treatmentId: {
      type: Schema.Types.ObjectId,
      ref: "Treatment",
      default: null,
    },

    /**
     * Calendar date as `YYYY-MM-DD` and times as minutes from midnight, both in
     * the hospital's local wall-clock time (see utils/time.ts). Keeping them as
     * a string and two integers makes overlap detection exact and immune to
     * timezone and daylight-saving shifts.
     */
    appointmentDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    startMinutes: { type: Number, required: true, min: 0, max: 1439 },
    endMinutes: { type: Number, required: true, min: 1, max: 1440 },

    status: {
      type: String,
      required: true,
      enum: APPOINTMENT_STATUSES,
      default: "scheduled",
    },

    notes: { type: String, default: "", maxlength: 2000 },

    /** Who booked it — kept for the audit trail and front-desk accountability. */
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    /** Set when the appointment moves to cancelled. */
    cancellationReason: { type: String, default: "", maxlength: 500 },

    /**
     * True while this appointment holds the doctor's slot — i.e. every status
     * except cancelled and no_show.
     *
     * Derived from `status`, but stored, because a unique partial index needs a
     * simple equality to filter on: `partialFilterExpression` does not support
     * `$nin`, so it cannot test the status enum directly. Kept in step by
     * appointment.service.ts, which is the only writer.
     */
    occupiesSlot: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

/** Day-view and date-range listing — the most common query. */
AppointmentSchema.index({ hospitalId: 1, appointmentDate: 1 });

/** Double-booking detection and per-doctor calendars. */
AppointmentSchema.index({ hospitalId: 1, doctorId: 1, appointmentDate: 1 });

/** A patient's appointment history. */
AppointmentSchema.index({ hospitalId: 1, patientId: 1, appointmentDate: -1 });

/**
 * Makes an exact double-booking impossible at the database level.
 *
 * The overlap check in appointment.service.ts reads before it writes, so under
 * true concurrency several requests can all see a free slot and all insert —
 * which is exactly what happened when the test suite fired five identical
 * bookings at a production server (a dev server was slow enough to serialise
 * them and hide it). A unique index is evaluated by MongoDB atomically, so only
 * one insert can win.
 *
 * LIMITATION: this catches identical start times, which is the collision that
 * actually happens (two receptionists clicking the same slot). A partial
 * overlap — 09:15 against an existing 09:00–09:30 — is still caught only by the
 * read-check, because no index can express range intersection. Closing that
 * fully needs a transaction, and therefore a replica set.
 */
AppointmentSchema.index(
  { hospitalId: 1, doctorId: 1, appointmentDate: 1, startMinutes: 1 },
  {
    unique: true,
    partialFilterExpression: { occupiesSlot: true },
  },
);

export type AppointmentDoc = InferSchemaType<typeof AppointmentSchema> & {
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const Appointment: Model<AppointmentDoc> =
  (mongoose.models.Appointment as Model<AppointmentDoc>) ??
  mongoose.model<AppointmentDoc>("Appointment", AppointmentSchema);
