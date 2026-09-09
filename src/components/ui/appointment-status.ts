import type { AppointmentStatus } from "@/models/Appointment";

/**
 * Shared status presentation, so the appointments board, the patient record and
 * any future view all render a status identically.
 */
export const APPOINTMENT_STATUS_TONES: Record<
  AppointmentStatus,
  "neutral" | "success" | "warning" | "danger" | "gold"
> = {
  scheduled: "neutral",
  confirmed: "gold",
  checked_in: "gold",
  in_progress: "warning",
  completed: "success",
  cancelled: "danger",
  no_show: "danger",
};

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

/** Transitions offered in the UI, mirroring the service's transition table. */
export const NEXT_STATUSES: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ["confirmed", "checked_in", "cancelled", "no_show"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_progress", "completed", "cancelled", "no_show"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};
