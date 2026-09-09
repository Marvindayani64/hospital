import { z } from "zod";
import { checkPasswordPolicy, PASSWORD_POLICY } from "@/lib/auth/password";
import { emailSchema } from "@/schemas/common";

/** Re-exported so existing importers keep working; defined in `common.ts`, which
 *  is import-free and therefore safe for client components. */
export { emailSchema };

/** Applied to NEW passwords only — never to the password being verified. */
export const strongPasswordSchema = z
  .string()
  .min(1, "Password is required.")
  .max(PASSWORD_POLICY.maxLength)
  .superRefine((value, ctx) => {
    for (const issue of checkPasswordPolicy(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
    }
  });

export const loginSchema = z.object({
  email: emailSchema,
  // No policy check here: it must be possible to log in with a password that
  // predates a policy change, and rejecting early would leak policy details.
  password: z.string().min(1, "Password is required.").max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: strongPasswordSchema,
    confirmPassword: z.string().min(1, "Please confirm your new password."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ["newPassword"],
    message: "New password must be different from your current password.",
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
