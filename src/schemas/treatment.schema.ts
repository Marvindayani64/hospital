import { z } from "zod";
import { objectIdSchema, paginationSchema, searchSchema } from "@/schemas/common";

/**
 * Price arrives in MAJOR units (19.99) and is converted to integer minor units
 * in the service, where the hospital's currency is known.
 *
 * The precision check happens there too, because how many decimal places are
 * valid depends on the currency — 100.5 is fine for USD but meaningless for JPY.
 */
const priceSchema = z
  .number({ invalid_type_error: "Price must be a number." })
  .min(0, "Price cannot be negative.")
  .max(100_000_000, "Price is unrealistically large.")
  .finite();

/**
 * Hospital-defined extra attributes. Constrained to a flat map of primitives:
 * deep or unbounded objects here would end up unvalidatable and would bloat
 * every treatment document.
 */
const metadataSchema = z
  .record(
    z.string().min(1).max(50),
    z.union([z.string().max(500), z.number().finite(), z.boolean()]),
  )
  .refine((value) => Object.keys(value).length <= 25, {
    message: "At most 25 custom attributes are allowed.",
  })
  .optional()
  .default({});

export const createTreatmentSchema = z.object({
  departmentId: objectIdSchema,
  name: z
    .string()
    .trim()
    .min(2, "Treatment name must be at least 2 characters.")
    .max(150),
  description: z.string().trim().max(1000).optional().default(""),
  price: priceSchema,
  durationMinutes: z.coerce
    .number()
    .int("Duration must be a whole number of minutes.")
    .min(1, "Duration must be at least 1 minute.")
    .max(1440, "Duration cannot exceed 24 hours.")
    .default(30),
  status: z.enum(["active", "inactive"]).default("active"),
  metadata: metadataSchema,
});

export type CreateTreatmentInput = z.infer<typeof createTreatmentSchema>;

export const updateTreatmentSchema = z
  .object({
    departmentId: objectIdSchema.optional(),
    name: z.string().trim().min(2).max(150).optional(),
    description: z.string().trim().max(1000).optional(),
    price: priceSchema.optional(),
    durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    metadata: z
      .record(
        z.string().min(1).max(50),
        z.union([z.string().max(500), z.number().finite(), z.boolean()]),
      )
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateTreatmentInput = z.infer<typeof updateTreatmentSchema>;

export const listTreatmentsSchema = paginationSchema.merge(searchSchema).extend({
  status: z.enum(["active", "inactive"]).optional(),
  departmentId: objectIdSchema.optional(),
});
