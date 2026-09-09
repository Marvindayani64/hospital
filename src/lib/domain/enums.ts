/**
 * Domain enumerations shared between the server and the browser.
 *
 * These live here rather than in the Mongoose models because client components
 * need them too — a form builder must list the field types, a payment dialog
 * must list the methods. Importing them from `@/models/*` pulled the whole
 * model file, and therefore Mongoose itself, into the client bundle.
 *
 * This module has NO imports. The models import these and attach them to their
 * schemas, so there is still exactly one definition of each list.
 */

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "email",
  "phone",
  "date",
  "select",
  "multi_select",
  "radio",
  "checkbox",
  "boolean",
  "file",
  "image",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Types that draw their value from a fixed option list. */
export const CHOICE_TYPES: readonly FieldType[] = [
  "select",
  "multi_select",
  "radio",
  "checkbox",
] as const;

/** Types whose answer is an array rather than a scalar. */
export const MULTI_VALUE_TYPES: readonly FieldType[] = [
  "multi_select",
  "checkbox",
] as const;

export const FORM_STATUSES = ["draft", "published", "archived"] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "checked_in",
  "in_progress",
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
