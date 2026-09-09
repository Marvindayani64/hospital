import { z } from "zod";
import { paginationSchema, searchSchema } from "@/schemas/common";
import { GENDERS } from "@/lib/domain/enums";
import { INDIA_PHONE_MESSAGE, isIndianMobile } from "@/lib/domain/phone";
import { isValidDateString } from "@/utils/time";

/**
 * `patientNumber` is absent by design — it is generated server-side from a
 * per-tenant atomic counter and must never be client-supplied.
 *
 * GENDERS is taken from `lib/domain/enums` rather than the re-export on
 * `@/models/Patient`: the patient form validates against these same schemas in
 * the browser, and importing the model would drag Mongoose into the client
 * bundle. Same list either way — the model attaches it to its own schema.
 *
 * Note the shape of these definitions: the base validators carry NO `.default()`.
 * A default on an optional field would be materialised on every parse, so a
 * PATCH that omitted `dateOfBirth` would silently overwrite the stored value
 * with the default. Defaults are therefore applied only in the create schema,
 * where every field is genuinely being set.
 */
const dateOfBirthBase = z
  .string()
  .trim()
  .refine((value) => value === "" || isValidDateString(value), {
    message: "Enter a valid date in YYYY-MM-DD format.",
  })
  .refine(
    (value) => {
      if (value === "") return true;
      // A birth date in the future is always a typo.
      return new Date(`${value}T00:00:00Z`).getTime() <= Date.now();
    },
    { message: "Date of birth cannot be in the future." },
  );

/**
 * Patient phone numbers are Indian mobile numbers. The rule and its message
 * live in `lib/domain/phone` so the form and the API enforce one definition.
 *
 * Landlines are deliberately not accepted: a patient's contact number is what
 * appointment and billing contact hangs off, and mobile is what a clinic can
 * actually reach and message.
 */
const requiredPhone = z
  .string()
  .trim()
  .min(1, "Phone number is required.")
  .max(30)
  .refine(isIndianMobile, { message: INDIA_PHONE_MESSAGE });

const optionalPhone = z
  .string()
  .trim()
  .max(30)
  .refine((value) => value === "" || isIndianMobile(value), {
    message: INDIA_PHONE_MESSAGE,
  });

const emergencyContactBase = z.object({
  name: z.string().trim().max(150).optional().default(""),
  relationship: z.string().trim().max(80).optional().default(""),
  phone: optionalPhone.optional().default(""),
});

/**
 * Optional, but a real address when supplied.
 *
 * Expressed as a refinement on a single string rather than a union with
 * `z.literal("")`: a failing union reports itself as a bare "Invalid input",
 * which is useless as a message under a field. The accepted set is unchanged —
 * empty, or a valid address of at most 254 characters.
 */
const emailBase = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email address is too long.")
  .refine(
    (value) => value === "" || z.string().email().safeParse(value).success,
    { message: "Enter a valid email address." },
  );

export const createPatientSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  phone: requiredPhone,
  email: emailBase.optional().default(""),
  dateOfBirth: dateOfBirthBase.optional().default(""),
  gender: z.enum(GENDERS).default("prefer_not_to_say"),
  address: z.string().trim().max(300).optional().default(""),
  emergencyContact: emergencyContactBase.optional().default({}),
  notes: z.string().trim().max(2000).optional().default(""),
});

export type CreatePatientInput = z.infer<typeof createPatientSchema>;

export const updatePatientSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    phone: requiredPhone.optional(),
    email: emailBase.optional(),
    dateOfBirth: dateOfBirthBase.optional(),
    gender: z.enum(GENDERS).optional(),
    address: z.string().trim().max(300).optional(),
    emergencyContact: emergencyContactBase.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

export const listPatientsSchema = paginationSchema.merge(searchSchema);
