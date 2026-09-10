import { z } from "zod";
import {
  emailSchema,
  objectIdSchema,
  optionalEmailSchema,
  paginationSchema,
  searchSchema,
} from "@/schemas/common";

/**
 * Note what is ABSENT from every schema here: `hospitalId`, `isSuperAdmin`,
 * `tokenVersion`, `passwordHash` and `mustChangePassword`.
 *
 * Those are server-owned. `hospitalId` always comes from the authenticated
 * context, and omitting `isSuperAdmin` is what makes "a Hospital Admin cannot
 * create a Super Admin" (Section 13) structurally true rather than a check
 * someone has to remember to write.
 */
export const createUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(150),
  email: emailSchema,
  roleId: objectIdSchema,
  status: z.enum(["active", "inactive"]).default("active"),
  /** Optional — the server generates one when omitted. */
  temporaryPassword: z.string().min(8).max(128).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(150).optional(),
    email: optionalEmailSchema.optional(),
    roleId: objectIdSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const changeUserStatusSchema = z.object({
  status: z.enum(["active", "inactive"]),
});

export const listUsersSchema = paginationSchema.merge(searchSchema).extend({
  status: z.enum(["active", "inactive"]).optional(),
  roleId: objectIdSchema.optional(),
});
