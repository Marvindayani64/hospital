import { z } from "zod";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { paginationSchema, searchSchema } from "@/schemas/common";

/**
 * Permissions are validated against the code catalogue, so an unknown or
 * misspelled `resource.action` is rejected at the edge rather than being stored
 * and silently never matching.
 */
const permissionsSchema = z
  .array(z.enum(PERMISSIONS))
  .max(PERMISSIONS.length)
  // De-duplicate so the stored array stays canonical.
  .transform((values) => [...new Set(values)]);

export const createRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Role name must be at least 2 characters.")
    .max(100),
  description: z.string().trim().max(300).optional().default(""),
  permissions: permissionsSchema.default([]),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(300).optional(),
    permissions: permissionsSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const listRolesSchema = paginationSchema.merge(searchSchema);
