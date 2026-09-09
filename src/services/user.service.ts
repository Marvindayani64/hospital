import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { RefreshToken, Role, User } from "@/models";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import { forceLogout, revokeAllUserTokens } from "@/services/auth.service";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import {
  assertBelongsToTenant,
  paginationMeta,
  paginationSkip,
  regexSearch,
  tenantScoped,
} from "@/lib/tenant/scope";
import type { CreateUserInput, UpdateUserInput } from "@/schemas/user.schema";
import type { EntityStatus, Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

export type MemberSummary = {
  id: string;
  name: string;
  email: string;
  status: EntityStatus;
  mustChangePassword: boolean;
  role: { id: string; name: string; isSystem: boolean } | null;
  lastLoginAt: string | null;
  activeSessions: number;
  createdAt: string;
};

type Actor = { userId: string; hospitalId: string };

/**
 * A member counts as an administrator if their role can manage both users and
 * roles. Defining it by capability rather than by role name means a renamed or
 * custom admin role is still recognised.
 */
const ADMIN_PERMISSIONS = ["user.create", "role.create"] as const;

function isAdminRole(permissions: readonly string[]): boolean {
  return ADMIN_PERMISSIONS.every((permission) =>
    permissions.includes(permission),
  );
}

/**
 * Guards against a hospital locking itself out.
 *
 * Called before any change that would remove administrative capability from a
 * member — deactivation, deletion, or reassignment to a non-admin role. If that
 * member is the tenant's last active administrator the change is refused; the
 * alternative is a hospital that no one can manage without platform support.
 */
async function assertNotLastAdmin(
  hospitalId: string,
  targetUserId: string,
  action: string,
): Promise<void> {
  const adminRoles = await Role.find(tenantScoped(hospitalId))
    .select("_id permissions")
    .lean();

  const adminRoleIds = adminRoles
    .filter((role) => isAdminRole(role.permissions ?? []))
    .map((role) => role._id);

  if (adminRoleIds.length === 0) return;

  const remaining = await User.countDocuments(
    tenantScoped(hospitalId, {
      // mongoose.trusted() — see regexSearch() in lib/tenant/scope.ts for why
      // every deliberate operator must be marked when sanitizeFilter is on.
      roleId: mongoose.trusted({ $in: adminRoleIds }),
      status: "active",
      _id: mongoose.trusted({ $ne: targetUserId }),
    }),
  );

  if (remaining === 0) {
    throw ApiError.conflict(
      `This is the only active administrator for this hospital. ` +
        `Give another member an administrator role before you ${action} them.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listUsers(
  hospitalId: string,
  params: {
    page: number;
    pageSize: number;
    search?: string;
    status?: EntityStatus;
    roleId?: string;
  },
): Promise<Paginated<MemberSummary>> {
  await connectToDatabase();

  const filter = tenantScoped(hospitalId, {
    ...(params.status ? { status: params.status } : {}),
    ...(params.roleId ? { roleId: params.roleId } : {}),
    ...(params.search
      ? {
          $or: [
            { name: regexSearch(params.search) },
            { email: regexSearch(params.search) },
          ],
        }
      : {}),
  });

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .populate<{ roleId: { _id: unknown; name: string; isSystem: boolean } | null }>(
        "roleId",
        "name isSystem",
      )
      .lean(),
    User.countDocuments(filter),
  ]);

  // Live session counts for the whole page in one query.
  const sessionCounts = await RefreshToken.aggregate<{
    _id: unknown;
    count: number;
  }>([
    {
      $match: {
        userId: { $in: users.map((user) => user._id) },
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      },
    },
    { $group: { _id: "$userId", count: { $sum: 1 } } },
  ]);

  const sessionsByUser = new Map(
    sessionCounts.map((row) => [String(row._id), row.count]),
  );

  return {
    items: users.map((user) => ({
      id: String(user._id),
      name: user.name,
      email: user.email,
      status: user.status as EntityStatus,
      mustChangePassword: Boolean(user.mustChangePassword),
      role: user.roleId
        ? {
            id: String(user.roleId._id),
            name: user.roleId.name,
            isSystem: Boolean(user.roleId.isSystem),
          }
        : null,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      activeSessions: sessionsByUser.get(String(user._id)) ?? 0,
      createdAt: user.createdAt.toISOString(),
    })),
    ...paginationMeta(params, total),
  };
}

export async function getUser(
  userId: string,
  hospitalId: string,
): Promise<MemberSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(User, userId, hospitalId, "Member");

  const user = await User.findOne(tenantScoped(hospitalId, { _id: userId }))
    .populate<{ roleId: { _id: unknown; name: string; isSystem: boolean } | null }>(
      "roleId",
      "name isSystem",
    )
    .lean();

  if (!user) throw ApiError.notFound("Member not found.");

  const activeSessions = await RefreshToken.countDocuments({
    userId,
    revokedAt: null,
    expiresAt: mongoose.trusted({ $gt: new Date() }),
  });

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    status: user.status as EntityStatus,
    mustChangePassword: Boolean(user.mustChangePassword),
    role: user.roleId
      ? {
          id: String(user.roleId._id),
          name: user.roleId.name,
          isSystem: Boolean(user.roleId.isSystem),
        }
      : null,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    activeSessions,
    createdAt: user.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type CreateUserResult = {
  member: MemberSummary;
  /** Shown to the administrator once, then unrecoverable. */
  temporaryPassword: string;
};

export async function createUser(
  input: CreateUserInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<CreateUserResult> {
  await connectToDatabase();

  /**
   * Cross-tenant relationship validation (Section 10): the role must belong to
   * the actor's own hospital. A roleId from another tenant resolves to nothing
   * and 404s, so a Hospital A member can never be given a Hospital B role.
   */
  const role = await assertBelongsToTenant(
    Role,
    input.roleId,
    actor.hospitalId,
    "Role",
  );

  const temporaryPassword =
    input.temporaryPassword ?? generateTemporaryPassword();

  try {
    const user = await User.create({
      // Taken from the authenticated actor, never from request input.
      hospitalId: actor.hospitalId,
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(temporaryPassword),
      roleId: role._id,
      // Not settable through the API — this is what prevents a Hospital Admin
      // from minting a Super Admin (Section 13).
      isSuperAdmin: false,
      status: input.status,
      mustChangePassword: true,
      tokenVersion: 0,
    });

    await recordAudit({
      hospitalId: actor.hospitalId,
      userId: actor.userId,
      action: "user.created",
      resource: "User",
      resourceId: String(user._id),
      // No password material of any kind is recorded.
      metadata: { email: user.email, roleId: String(role._id), roleName: role.name },
      meta,
    });

    return {
      member: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        status: user.status as EntityStatus,
        mustChangePassword: true,
        role: {
          id: String(role._id),
          name: role.name,
          isSystem: Boolean(role.isSystem),
        },
        lastLoginAt: null,
        activeSessions: 0,
        createdAt: user.createdAt.toISOString(),
      },
      temporaryPassword,
    };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict(
        "A member with that email already exists at this hospital.",
      );
    }
    throw error;
  }
}

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<MemberSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(User, userId, actor.hospitalId, "Member");

  const user = await User.findOne(
    tenantScoped(actor.hospitalId, { _id: userId }),
  );
  if (!user) throw ApiError.notFound("Member not found.");

  if (input.roleId !== undefined && String(user.roleId) !== input.roleId) {
    const role = await assertBelongsToTenant(
      Role,
      input.roleId,
      actor.hospitalId,
      "Role",
    );

    // Losing admin capability is the same risk as deactivation.
    if (!isAdminRole(role.permissions ?? [])) {
      await assertNotLastAdmin(actor.hospitalId, userId, "change the role of");
    }

    user.roleId = role._id;
  }

  if (input.name !== undefined) user.name = input.name;
  if (input.email !== undefined) user.email = input.email;

  try {
    await user.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict(
        "A member with that email already exists at this hospital.",
      );
    }
    throw error;
  }

  /**
   * No tokenVersion bump is needed for a role change: requireAuth() re-reads
   * roleId from the database and resolves permissions from the Role document on
   * every request, so the new permissions are already in force.
   */
  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: input.roleId ? "user.role_assigned" : "user.updated",
    resource: "User",
    resourceId: userId,
    metadata: { fields: Object.keys(input) },
    meta,
  });

  return getUser(userId, actor.hospitalId);
}

/**
 * Activates or deactivates a member.
 *
 * Deactivation bumps `tokenVersion` and revokes every refresh token, so the
 * member is signed out on their very next request rather than whenever their
 * access token happens to expire (Section 13).
 */
export async function changeUserStatus(
  userId: string,
  status: EntityStatus,
  actor: Actor,
  meta: RequestMeta,
): Promise<MemberSummary> {
  await connectToDatabase();

  if (userId === actor.userId) {
    throw ApiError.conflict("You cannot change your own account status.");
  }

  await assertBelongsToTenant(User, userId, actor.hospitalId, "Member");

  const user = await User.findOne(
    tenantScoped(actor.hospitalId, { _id: userId }),
  );
  if (!user) throw ApiError.notFound("Member not found.");

  if (user.status === status) return getUser(userId, actor.hospitalId);

  if (status === "inactive") {
    await assertNotLastAdmin(actor.hospitalId, userId, "deactivate");
  }

  user.status = status;
  // Bump on both directions: a token minted before deactivation must not become
  // usable again simply because the account was later reactivated.
  user.tokenVersion += 1;
  await user.save();

  await revokeAllUserTokens(userId);

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "user.status_changed",
    resource: "User",
    resourceId: userId,
    metadata: { to: status, tokenVersion: user.tokenVersion },
    meta,
  });

  return getUser(userId, actor.hospitalId);
}

export async function deleteUser(
  userId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  await connectToDatabase();

  if (userId === actor.userId) {
    throw ApiError.conflict("You cannot delete your own account.");
  }

  const user = await assertBelongsToTenant(
    User,
    userId,
    actor.hospitalId,
    "Member",
  );

  await assertNotLastAdmin(actor.hospitalId, userId, "delete");

  await User.deleteOne(tenantScoped(actor.hospitalId, { _id: userId }));
  // Leave no usable session behind for a deleted account.
  await RefreshToken.deleteMany({ userId });

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "user.deleted",
    resource: "User",
    resourceId: userId,
    metadata: { email: user.email },
    meta,
  });
}

/**
 * Administrative "sign out everywhere" for one member: bumps `tokenVersion`
 * (killing outstanding access tokens on their next request) and revokes every
 * refresh token so no new ones can be minted.
 */
export async function forceLogoutUser(
  userId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  await connectToDatabase();

  await assertBelongsToTenant(User, userId, actor.hospitalId, "Member");

  await forceLogout(userId);

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "user.force_logout",
    resource: "User",
    resourceId: userId,
    meta,
  });
}
