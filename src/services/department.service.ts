import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { Appointment, Department, Doctor, Treatment } from "@/models";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import {
  assertBelongsToTenant,
  paginationMeta,
  paginationSkip,
  regexSearch,
  tenantScoped,
} from "@/lib/tenant/scope";
import type {
  CreateDepartmentInput,
  UpdateDepartmentInput,
} from "@/schemas/department.schema";
import type { EntityStatus, Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

export type DepartmentSummary = {
  id: string;
  name: string;
  description: string;
  status: EntityStatus;
  /** How many treatments reference this department. */
  treatmentCount: number;
  createdAt: string;
};

type Actor = { userId: string; hospitalId: string };

function toSummary(
  department: {
    _id: unknown;
    name: string;
    description?: string | null;
    status: string;
    createdAt: Date;
  },
  treatmentCount: number,
): DepartmentSummary {
  return {
    id: String(department._id),
    name: department.name,
    description: department.description ?? "",
    status: department.status as EntityStatus,
    treatmentCount,
    createdAt: department.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listDepartments(
  hospitalId: string,
  params: {
    page: number;
    pageSize: number;
    search?: string;
    status?: EntityStatus;
  },
): Promise<Paginated<DepartmentSummary>> {
  await connectToDatabase();

  const filter = tenantScoped(hospitalId, {
    ...(params.status ? { status: params.status } : {}),
    ...(params.search ? { name: regexSearch(params.search) } : {}),
  });

  const [departments, total] = await Promise.all([
    Department.find(filter)
      .sort({ name: 1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .lean(),
    Department.countDocuments(filter),
  ]);

  /**
   * One grouped count for the page rather than a query per department.
   * Aggregation pipelines bypass Mongoose casting, so the ObjectIds must be
   * passed through as-is from the documents we already loaded.
   */
  const counts = departments.length
    ? await Treatment.aggregate<{ _id: unknown; count: number }>([
        {
          $match: {
            // Redundant given the ids already came from a tenant-scoped query,
            // but keeps the tenant filter visible on every pipeline.
            hospitalId: new mongoose.Types.ObjectId(hospitalId),
            departmentId: { $in: departments.map((d) => d._id) },
          },
        },
        { $group: { _id: "$departmentId", count: { $sum: 1 } } },
      ])
    : [];

  const countByDepartment = new Map(
    counts.map((row) => [String(row._id), row.count]),
  );

  return {
    items: departments.map((department) =>
      toSummary(department, countByDepartment.get(String(department._id)) ?? 0),
    ),
    ...paginationMeta(params, total),
  };
}

export async function getDepartment(
  departmentId: string,
  hospitalId: string,
): Promise<DepartmentSummary> {
  await connectToDatabase();

  const department = await assertBelongsToTenant(
    Department,
    departmentId,
    hospitalId,
    "Department",
  );

  const treatmentCount = await Treatment.countDocuments(
    tenantScoped(hospitalId, { departmentId }),
  );

  return toSummary(department, treatmentCount);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createDepartment(
  input: CreateDepartmentInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<DepartmentSummary> {
  await connectToDatabase();

  try {
    const department = await Department.create({
      // From the authenticated context, never from request input.
      hospitalId: actor.hospitalId,
      name: input.name,
      description: input.description,
      status: input.status,
    });

    await recordAudit({
      hospitalId: actor.hospitalId,
      userId: actor.userId,
      action: "department.created",
      resource: "Department",
      resourceId: String(department._id),
      metadata: { name: department.name },
      meta,
    });

    return toSummary(department, 0);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict(
        "A department with that name already exists at this hospital.",
      );
    }
    throw error;
  }
}

export async function updateDepartment(
  departmentId: string,
  input: UpdateDepartmentInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<DepartmentSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(
    Department,
    departmentId,
    actor.hospitalId,
    "Department",
  );

  const department = await Department.findOne(
    tenantScoped(actor.hospitalId, { _id: departmentId }),
  );
  if (!department) throw ApiError.notFound("Department not found.");

  if (input.name !== undefined) department.name = input.name;
  if (input.description !== undefined) department.description = input.description;
  if (input.status !== undefined) department.status = input.status;

  try {
    await department.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict(
        "A department with that name already exists at this hospital.",
      );
    }
    throw error;
  }

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "department.updated",
    resource: "Department",
    resourceId: departmentId,
    metadata: { fields: Object.keys(input), name: department.name },
    meta,
  });

  return getDepartment(departmentId, actor.hospitalId);
}

/**
 * Deletes a department, refusing while treatments still reference it.
 *
 * A treatment whose department vanished would be unreachable through the
 * department filter and would break the appointment flows added in Phase 4.
 * Deactivating is offered as the non-destructive alternative.
 */
export async function deleteDepartment(
  departmentId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  await connectToDatabase();

  const department = await assertBelongsToTenant(
    Department,
    departmentId,
    actor.hospitalId,
    "Department",
  );

  const treatmentCount = await Treatment.countDocuments(
    tenantScoped(actor.hospitalId, { departmentId }),
  );

  if (treatmentCount > 0) {
    throw ApiError.conflict(
      `This department still has ${treatmentCount} ${
        treatmentCount === 1 ? "treatment" : "treatments"
      }. Move or delete them first, or deactivate the department instead.`,
    );
  }

  // Doctors and appointments also reference departments.
  const [doctorCount, appointmentCount] = await Promise.all([
    Doctor.countDocuments(
      tenantScoped(actor.hospitalId, { departmentIds: departmentId }),
    ),
    Appointment.countDocuments(
      tenantScoped(actor.hospitalId, { departmentId }),
    ),
  ]);

  if (doctorCount > 0) {
    throw ApiError.conflict(
      `${doctorCount} ${doctorCount === 1 ? "doctor is" : "doctors are"} assigned to this department. Reassign them first, or deactivate the department instead.`,
    );
  }

  if (appointmentCount > 0) {
    throw ApiError.conflict(
      `This department has ${appointmentCount} ${
        appointmentCount === 1 ? "appointment" : "appointments"
      } on record. Deactivate it instead to remove it from new bookings.`,
    );
  }

  await Department.deleteOne(
    tenantScoped(actor.hospitalId, { _id: departmentId }),
  );

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "department.deleted",
    resource: "Department",
    resourceId: departmentId,
    metadata: { name: department.name },
    meta,
  });
}
