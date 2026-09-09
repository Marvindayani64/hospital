import { z } from "zod";

/**
 * This module has no imports beyond zod, so any schema built only from these
 * pieces is safe to import into a client component and validate with in the
 * browser. `emailSchema` lives here rather than in `auth.schema.ts` for exactly
 * that reason: that file reaches `lib/auth/password.ts`, which pulls in bcryptjs
 * and node:crypto — neither of which belongs in a browser bundle.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .email("Enter a valid email address.")
  .max(254);

/** A 24-character hex MongoDB ObjectId. */
export const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Not a valid identifier.");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const searchSchema = z.object({
  search: z.string().trim().max(200).optional(),
});
