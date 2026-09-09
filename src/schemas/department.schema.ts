import { z } from "zod";
import { objectIdSchema, paginationSchema, searchSchema } from "@/schemas/common";

export const createDepartmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Department name must be at least 2 characters.")
    .max(120),
  description: z.string().trim().max(500).optional().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const listDepartmentsSchema = paginationSchema.merge(searchSchema).extend({
  status: z.enum(["active", "inactive"]).optional(),
});

/** Exported for the treatment schema, which references a department. */
export const departmentIdSchema = objectIdSchema;
