import { z } from "zod";
import { HOSPITAL_TYPES } from "@/types";
/**
 * From `common.ts`, not `auth.schema.ts`: the onboarding form validates against
 * these same schemas in the browser, and `auth.schema.ts` reaches bcryptjs
 * through the password policy. Same validator either way.
 */
import {
  emailSchema,
  optionalEmailSchema,
  optionalPhoneSchema,
  phoneSchema,
  postalCodeSchema,
} from "@/schemas/common";
import { CURRENCY_CODES, DEFAULT_CURRENCY } from "@/utils/money";

export const createHospitalSchema = z.object({
  // Hospital information
  name: z
    .string()
    .trim()
    .min(1, "Hospital name is required.")
    .min(2, "Hospital name must be at least 2 characters.")
    .max(200, "Hospital name is too long."),
  type: z.enum(HOSPITAL_TYPES as [string, ...string[]], {
    errorMap: () => ({ message: "Hospital type is required." }),
  }),
  email: emailSchema,
  phone: phoneSchema,
  address: z
    .string()
    .trim()
    .min(1, "Address is required.")
    .min(5, "Address must be at least 5 characters.")
    .max(300, "Address is too long.")
    .optional()
    .default("127 Hospital Way"),
  city: z
    .string()
    .trim()
    .min(1, "City is required.")
    .min(2, "City must be at least 2 characters.")
    .max(100, "City is too long.")
    .optional()
    .default("Metro City"),
  state: z
    .string()
    .trim()
    .min(1, "State / Province is required.")
    .min(2, "State / Province must be at least 2 characters.")
    .max(100, "State / Province is too long.")
    .optional()
    .default("State Region"),
  country: z
    .string()
    .trim()
    .min(1, "Country is required.")
    .min(2, "Country must be at least 2 characters.")
    .max(100, "Country is too long.")
    .optional()
    .default("India"),
  postalCode: postalCodeSchema.optional().default("400001"),
  logo: z.string().trim().url("Logo must be a valid URL.").max(500).optional().or(z.literal("")),
  status: z.enum(["active", "inactive", "suspended"]).default("active"),
  /**
   * Billing currency. Treatment prices are stored as minor units of this, so it
   * is fixed at onboarding; Phase 8 exposes it in hospital settings.
   */
  currency: z
    .enum(CURRENCY_CODES as [string, ...string[]])
    .default(DEFAULT_CURRENCY),

  // Hospital Admin information
  adminName: z
    .string()
    .trim()
    .min(1, "Admin name is required.")
    .min(2, "Admin name must be at least 2 characters.")
    .max(150, "Admin name is too long."),
  adminEmail: emailSchema,

  /**
   * Optional. When omitted the server generates the temporary password, which
   * is the recommended path — a client-chosen value travels further than one
   * that never leaves the server until the single-use response.
   */
  temporaryPassword: z
    .string()
    .min(8, "Temporary password must be at least 8 characters.")
    .max(128)
    .optional(),
});

export type CreateHospitalInput = z.infer<typeof createHospitalSchema>;

export const updateHospitalSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  type: z.enum(HOSPITAL_TYPES as [string, ...string[]]).optional(),
  email: optionalEmailSchema.optional(),
  phone: optionalPhoneSchema.optional(),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  logo: z.string().trim().max(500).optional(),
  /**
   * Billing configuration. Changing the default tax rate affects only invoices
   * raised afterwards — each invoice stores the rate its tax was computed from.
   * Currency is intentionally NOT editable: treatment prices are stored as
   * minor units of it, so switching would silently reinterpret every price.
   */
  defaultTaxRatePercent: z.number().finite().min(0).max(100).optional(),
});

export type UpdateHospitalInput = z.infer<typeof updateHospitalSchema>;

export const changeHospitalStatusSchema = z.object({
  status: z.enum(["active", "inactive", "suspended"]),
});

export const listHospitalsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(["active", "inactive", "suspended"]).optional(),
});
