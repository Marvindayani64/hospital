import { z } from "zod";

/**
 * Common, reusable validation schemas safe to import into both server and
 * browser components.
 */

// ---------------------------------------------------------------------------
// Email Validation
// ---------------------------------------------------------------------------
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .email("Enter a valid email address.")
  .max(254, "Email address is too long.");

export const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email address is too long.")
  .refine(
    (value) => value === "" || z.string().email().safeParse(value).success,
    { message: "Enter a valid email address." },
  );

// ---------------------------------------------------------------------------
// Phone Validation
// ---------------------------------------------------------------------------
export function validatePhoneNumber(val: string): { valid: boolean; message?: string } {
  const trimmed = val.trim();
  if (!trimmed) return { valid: false, message: "Phone number is required." };

  // Remove spaces, hyphens, dots, brackets
  const cleaned = trimmed.replace(/[\s\-().]/g, "");

  // If phone number starts with '+', validate country code + subscriber digits (8-15 total digits)
  if (cleaned.startsWith("+")) {
    const digitsOnly = cleaned.slice(1);
    if (!/^\d{8,15}$/.test(digitsOnly)) {
      return {
        valid: false,
        message: "Enter a valid 10-digit mobile number",
      };
    }
    // For India country code (+91), subscriber digits must be 10 digits
    if (digitsOnly.startsWith("91")) {
      const sub = digitsOnly.slice(2);
      if (!/^[6-9]\d{9}$/.test(sub)) {
        return {
          valid: false,
          message: "Enter a valid 10-digit mobile number",
        };
      }
    }
    return { valid: true };
  }

  // Bare 10-digit Indian mobile number
  if (/^[6-9]\d{9}$/.test(cleaned) || /^\d{10}$/.test(cleaned)) {
    return { valid: true };
  }

  // Indian mobile with leading 0, 91, or 0091 followed by 10 digits
  if (/^(?:0091|91|0)\d{10}$/.test(cleaned)) {
    return { valid: true };
  }

  return {
    valid: false,
    message: "Enter a valid 10-digit mobile number",
  };
}

export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Phone number is required.")
  .max(30)
  .superRefine((val, ctx) => {
    const result = validatePhoneNumber(val);
    if (!result.valid && result.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: result.message,
      });
    }
  });

export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(30)
  .superRefine((val, ctx) => {
    if (val === "") return;
    const result = validatePhoneNumber(val);
    if (!result.valid && result.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: result.message,
      });
    }
  });

// ---------------------------------------------------------------------------
// System Identifiers, Address & Pagination
// ---------------------------------------------------------------------------
export const postalCodeSchema = z
  .string()
  .trim()
  .min(1, "Postal code is required.")
  .regex(
    /^[a-zA-Z0-9\s\-]{3,10}$/,
    "Enter a valid postal code (3-10 characters).",
  )
  .max(20, "Postal code is too long.");

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

