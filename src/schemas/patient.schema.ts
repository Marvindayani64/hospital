import { z } from "zod";
import {
  emailSchema,
  optionalEmailSchema,
  optionalPhoneSchema,
  paginationSchema,
  phoneSchema,
  searchSchema,
} from "@/schemas/common";
import { GENDERS } from "@/lib/domain/enums";
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

const emergencyContactBase = z.object({
  name: z.string().trim().max(150).optional().default(""),
  relationship: z.string().trim().max(80).optional().default(""),
  phone: optionalPhoneSchema.optional().default(""),
});

export const createPatientSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  phone: phoneSchema,
  email: emailSchema,
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
    phone: optionalPhoneSchema.optional(),
    email: optionalEmailSchema.optional(),
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
