/**
 * Domain enumerations shared between the server and the browser.
 *
 * These live here rather than in the Mongoose models because client components
 * need them too — a payment dialog must list the methods, an appointments board
 * must list the statuses. Importing them from `@/models/*` pulled the whole
 * model file, and therefore Mongoose itself, into the client bundle.
 *
 * This module has NO imports. The models import these and attach them to their
 * schemas, so there is still exactly one definition of each list.
 */

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

/**
 * The front desk works one progression: confirmed → checked in → completed.
 * `scheduled` is the state a booking starts in, and cancelled/no-show are the
 * two ways it ends without being delivered.
 */
export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "checked_in",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that no longer occupy the doctor's calendar. */
export const RELEASING_STATUSES: readonly AppointmentStatus[] = [
  "cancelled",
  "no_show",
] as const;

/** Terminal statuses — an appointment here cannot move again. */
export const TERMINAL_STATUSES: readonly AppointmentStatus[] = [
  "completed",
  "cancelled",
  "no_show",
] as const;

// ---------------------------------------------------------------------------
// Prescriptions
// ---------------------------------------------------------------------------

/**
 * A prescription is written once and then acted on by the pharmacy: it is
 * either handed over (`dispensed`) or withdrawn (`cancelled`). Both are
 * terminal — a dispensed prescription must not silently return to the queue,
 * because the drugs have already left the counter. Correcting one means writing
 * a new prescription, exactly as with appointments.
 */
export const PRESCRIPTION_STATUSES = [
  "pending",
  "dispensed",
  "cancelled",
] as const;

export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

/** Statuses the pharmacy can no longer act on. */
export const SETTLED_PRESCRIPTION_STATUSES: readonly PrescriptionStatus[] = [
  "dispensed",
  "cancelled",
] as const;

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const PAYMENT_METHODS = [
  "cash",
  "card",
  "bank_transfer",
  "insurance",
  "cheque",
  "other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const INVOICE_STATUSES = ["draft", "issued", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const DISCOUNT_TYPES = ["none", "fixed", "percent"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

export const GENDERS = [
  "male",
  "female",
  "other",
  "prefer_not_to_say",
] as const;

export type Gender = (typeof GENDERS)[number];
