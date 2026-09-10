import type { PrescriptionStatus } from "@/lib/domain/enums";

/**
 * Shared status presentation, so the pharmacy queue and the patient record
 * render a prescription's state identically.
 *
 * Imported from `@/lib/domain/enums`, not `@/models/Prescription`: this module
 * is pulled into client components, and the model file would drag Mongoose into
 * the browser bundle with it.
 */
export const PRESCRIPTION_STATUS_TONES: Record<
  PrescriptionStatus,
  "neutral" | "success" | "warning" | "danger" | "gold"
> = {
  pending: "warning",
  dispensed: "success",
  cancelled: "danger",
};

export const PRESCRIPTION_STATUS_LABELS: Record<PrescriptionStatus, string> = {
  pending: "Awaiting pharmacy",
  dispensed: "Dispensed",
  cancelled: "Cancelled",
};

/** One line summarising what was prescribed, for a table cell. */
export function summariseItems(
  items: ReadonlyArray<{ drugName: string; dosage: string }>,
): string {
  return items
    .map((item) =>
      item.dosage ? `${item.drugName} ${item.dosage}` : item.drugName,
    )
    .join(", ");
}
