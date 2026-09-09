import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { Role, User } from "@/models";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import {
  assertBelongsToTenant,
  paginationMeta,
  paginationSkip,
  regexSearch,
  tenantScoped,
} from "@/lib/tenant/scope";
import { sanitizePermissions, type Permission } from "@/lib/rbac/permissions";
import type { CreateRoleInput, UpdateRoleInput } from "@/schemas/role.schema";
import type { Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

export type RoleSummary = {
  id: string;
  name: string;
  description: string;
  key: string | null;
  isSystem: boolean;
  permissions: Permission[];
  /** How many members currently hold this role. */
  memberCount: number;
  createdAt: string;
};

type Actor = { userId: string; hospitalId: string };

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listRoles(
  hospitalId: string,
  params: { page: number; pageSize: number; search?: string },
): Promise<Paginated<RoleSummary>> {
  await connectToDatabase();

  const filter = tenantScoped(hospitalId, {
    ...(params.search ? { name: regexSearch(params.search) } : {}),
  });

  const [roles, total] = await Promise.all([
    Role.find(filter)
      .sort({ isSystem: -1, name: 1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .lean(),
    Role.countDocuments(filter),
  ]);

  /**
   * One grouped count for the whole page instead of a query per role — this
   * list is rendered on every visit to the Roles screen.
   *
   * The aggregation pipeline bypasses Mongoose casting, so hospitalId must be
   * an explicit ObjectId here; a string would silently match nothing.
   */
  const counts = roles.length
    ? await User.aggregate<{ _id: unknown; count: number }>([
        {
          $match: {
            hospitalId: new mongoose.Types.ObjectId(hospitalId),
            roleId: { $in: roles.map((role) => role._id) },
          },
        },
        { $group: { _id: "$roleId", count: { $sum: 1 } } },
      ])
    : [];

  const countByRole = new Map(counts.map((row) => [String(row._id), row.count]));

  return {
    items: roles.map((role) => ({
      id: String(role._id),
      name: role.name,
      description: role.description ?? "",
      key: role.key ?? null,
      isSystem: Boolean(role.isSystem),
      permissions: sanitizePermissions(role.permissions ?? []),
      memberCount: countByRole.get(String(role._id)) ?? 0,
      createdAt: role.createdAt.toISOString(),
    })),
    ...paginationMeta(params, total),
  };
}

export async function getRole(
  roleId: string,
  hospitalId: string,
): Promise<RoleSummary> {
  await connectToDatabase();

  const role = await assertBelongsToTenant(Role, roleId, hospitalId, "Role");

  const memberCount = await User.countDocuments(
    tenantScoped(hospitalId, { roleId }),
  );

  return {
    id: String(role._id),
    name: role.name,
    description: role.description ?? "",
    key: role.key ?? null,
    isSystem: Boolean(role.isSystem),
    permissions: sanitizePermissions(role.permissions ?? []),
    memberCount,
    createdAt: role.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createRole(
  input: CreateRoleInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<RoleSummary> {
  await connectToDatabase();

  try {
    const role = await Role.create({
      hospitalId: actor.hospitalId,
      name: input.name,
      description: input.description,
      permissions: input.permissions,
      // Custom roles never carry a system key and are always deletable.
      key: null,
      isSystem: false,
    });

    await recordAudit({
      hospitalId: actor.hospitalId,
      userId: actor.userId,
      action: "role.created",
      resource: "Role",
      resourceId: String(role._id),
      metadata: { name: role.name, permissionCount: input.permissions.length },
      meta,
    });

    return {
      id: String(role._id),
      name: role.name,
      description: role.description ?? "",
      key: null,
      isSystem: false,
      permissions: sanitizePermissions(role.permissions ?? []),
      memberCount: 0,
      createdAt: role.createdAt.toISOString(),
    };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict("A role with that name already exists.");
    }
    throw error;
  }
}

export async function updateRole(
  roleId: string,
  input: UpdateRoleInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<RoleSummary> {
  await connectToDatabase();

  // Scoped lookup: a role id from another hospital resolves to nothing.
  await assertBelongsToTenant(Role, roleId, actor.hospitalId, "Role");

  const role = await Role.findOne(tenantScoped(actor.hospitalId, { _id: roleId }));
  if (!role) throw ApiError.notFound("Role not found.");

  /**
   * System roles stay renameable and their permissions stay editable — Section
   * 12 expects hospitals to tune what a nurse or receptionist may do. Only the
   * `key` and `isSystem` flags are immutable, and neither is accepted as input.
   */
  if (input.name !== undefined) role.name = input.name;
  if (input.description !== undefined) role.description = input.description;
  if (input.permissions !== undefined) role.permissions = input.permissions;

  try {
    await role.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict("A role with that name already exists.");
    }
    throw error;
  }

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "role.updated",
    resource: "Role",
    resourceId: roleId,
    metadata: { fields: Object.keys(input), name: role.name },
    meta,
  });

  const memberCount = await User.countDocuments(
    tenantScoped(actor.hospitalId, { roleId }),
  );

  return {
    id: String(role._id),
    name: role.name,
    description: role.description ?? "",
    key: role.key ?? null,
    isSystem: Boolean(role.isSystem),
    permissions: sanitizePermissions(role.permissions ?? []),
    memberCount,
    createdAt: role.createdAt.toISOString(),
  };
}

export async function deleteRole(
  roleId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  await connectToDatabase();

  const role = await assertBelongsToTenant(Role, roleId, actor.hospitalId, "Role");

  if (role.isSystem) {
    throw ApiError.conflict(
      "Default roles cannot be deleted. You can rename one or change its permissions instead.",
    );
  }

  /**
   * A user whose role no longer exists would fail authorisation on every
   * request (requireAuth cannot resolve their permissions), so the role must be
   * vacated before it can be removed.
   */
  const memberCount = await User.countDocuments(
    tenantScoped(actor.hospitalId, { roleId }),
  );

  if (memberCount > 0) {
    throw ApiError.conflict(
      `This role is assigned to ${memberCount} ${
        memberCount === 1 ? "member" : "members"
      }. Reassign them before deleting it.`,
    );
  }

  await Role.deleteOne(tenantScoped(actor.hospitalId, { _id: roleId }));

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "role.deleted",
    resource: "Role",
    resourceId: roleId,
    metadata: { name: role.name },
    meta,
  });
}
