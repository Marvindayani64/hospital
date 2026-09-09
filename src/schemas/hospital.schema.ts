import { z } from "zod";
import { HOSPITAL_TYPES } from "@/types";
/**
 * From `common.ts`, not `auth.schema.ts`: the onboarding form validates against
 * these same schemas in the browser, and `auth.schema.ts` reaches bcryptjs
 * through the password policy. Same validator either way.
 */
import { emailSchema } from "@/schemas/common";
import { CURRENCY_CODES, DEFAULT_CURRENCY } from "@/utils/money";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().default("");

export const createHospitalSchema = z.object({
  // Hospital information
  name: z
    .string()
    .trim()
    .min(2, "Hospital name must be at least 2 characters.")
    .max(200),
  type: z.enum(HOSPITAL_TYPES as [string, ...string[]], {
    errorMap: () => ({ message: "Select a hospital type." }),
  }),
  email: emailSchema,
  phone: z
    .string()
    .trim()
    .min(5, "Enter a valid phone number.")
    .max(30),
  address: optionalText(300),
  city: optionalText(100),
  state: optionalText(100),
  country: optionalText(100),
  postalCode: optionalText(20),
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
    .min(2, "Admin name must be at least 2 characters.")
    .max(150),
  adminEmail: emailSchema,

  /**
   * Optional. When omitted the server generates the temporary password, which
   * is the recommended path — a client-chosen value travels further than one
   * that never leaves the server until the single-use response.
   */
  temporaryPassword: z.string().min(8).max(128).optional(),
});

export type CreateHospitalInput = z.infer<typeof createHospitalSchema>;

export const updateHospitalSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  type: z.enum(HOSPITAL_TYPES as [string, ...string[]]).optional(),
  email: emailSchema.optional(),
  phone: z.string().trim().min(5).max(30).optional(),
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
