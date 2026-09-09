import { ApiError } from "@/lib/api/errors";
import { requireAuth, type RequireAuthOptions } from "@/lib/auth/session";
import type { Permission } from "@/lib/rbac/permissions";
import type { AuthContext } from "@/types";

/**
 * Permission checks operate on the AuthContext, whose `permissions` array was
 * resolved from the current Role document during requireAuth() — never from
 * the JWT payload. A role edited a second ago is already in force.
 */

export function hasPermission(
  user: AuthContext,
  permission: Permission,
): boolean {
  // A Super Admin is a platform operator, not a tenant member. They are
  // deliberately NOT granted tenant permissions (Section 3): platform
  // administration stays separate from hospital medical data.
  if (user.isSuperAdmin) return false;
  return user.permissions.includes(permission);
}

export function hasAnyPermission(
  user: AuthContext,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(user, permission));
}

export function hasAllPermissions(
  user: AuthContext,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => hasPermission(user, permission));
}

export function assertPermission(
  user: AuthContext,
  permission: Permission,
): void {
  if (!hasPermission(user, permission)) {
    throw ApiError.forbidden(
      `You do not have the "${permission}" permission.`,
    );
  }
}

/**
 * Convenience guard for route handlers:
 *
 *   const user = await requirePermission("patient.create");
 *   const hospitalId = getTenantId(user);
 */
export async function requirePermission(
  permission: Permission,
  options: RequireAuthOptions = {},
): Promise<AuthContext & { hospitalId: string }> {
  const user = await requireAuth(options);
  assertPermission(user, permission);

  if (!user.hospitalId) {
    throw ApiError.forbidden("No hospital is associated with this account.");
  }

  return { ...user, hospitalId: user.hospitalId };
}
