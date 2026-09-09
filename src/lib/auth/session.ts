import { connectToDatabase } from "@/lib/db/connect";
import { readAccessToken } from "@/lib/auth/cookies";
import { verifyAccessToken, type AccessTokenClaims } from "@/lib/auth/jwt";
import { ApiError } from "@/lib/api/errors";
import { Hospital, Role, User } from "@/models";
import { sanitizePermissions, type Permission } from "@/lib/rbac/permissions";
import type { AuthContext } from "@/types";

/**
 * The authorisation pipeline described in Section 8a.
 *
 * Verifying the JWT signature is only step one. Because a stateless token
 * cannot be revoked, every request re-reads the User (and Hospital) from the
 * database and compares the stored `tokenVersion` values against the ones
 * embedded in the token. A single increment therefore locks a user — or an
 * entire hospital — out on their very next request, not at token expiry.
 */

export type AuthFailureReason =
  | "no_token"
  | "invalid_token"
  | "user_missing"
  | "user_inactive"
  | "token_version_mismatch"
  | "hospital_missing"
  | "hospital_inactive"
  | "hospital_token_version_mismatch"
  | "role_missing";

export type AuthOutcome =
  | { ok: true; user: AuthContext }
  | { ok: false; reason: AuthFailureReason; hospitalStatus?: string };

async function resolvePermissions(
  roleId: string | null,
  hospitalId: string | null,
): Promise<Permission[] | null> {
  if (!roleId || !hospitalId) return [];

  /**
   * The role is looked up scoped to the user's own hospital. Even if a token
   * carried a roleId belonging to another tenant, this query would not match.
   * Permissions are read fresh here rather than trusted from the token, so an
   * admin editing a role takes effect immediately.
   */
  const role = await Role.findOne({ _id: roleId, hospitalId })
    .select("permissions")
    .lean();

  if (!role) return null;

  return sanitizePermissions(role.permissions ?? []);
}

async function buildContext(
  claims: AccessTokenClaims,
): Promise<AuthOutcome> {
  await connectToDatabase();

  const user = await User.findById(claims.userId)
    .select(
      "hospitalId name email roleId isSuperAdmin status mustChangePassword tokenVersion",
    )
    .lean();

  if (!user) return { ok: false, reason: "user_missing" };
  if (user.status !== "active") return { ok: false, reason: "user_inactive" };

  // Password change / forced logout / deactivation since the token was issued.
  if (user.tokenVersion !== claims.tokenVersion) {
    return { ok: false, reason: "token_version_mismatch" };
  }

  const hospitalId = user.hospitalId ? String(user.hospitalId) : null;

  /**
   * The token's own hospitalId is never used to scope data — the DB record is
   * the authority. Mismatch means the user was moved between tenants, which
   * invalidates the token.
   */
  if (hospitalId !== claims.hospitalId) {
    return { ok: false, reason: "token_version_mismatch" };
  }

  if (hospitalId) {
    const hospital = await Hospital.findById(hospitalId)
      .select("status tokenVersion")
      .lean();

    if (!hospital) return { ok: false, reason: "hospital_missing" };

    if (hospital.status !== "active") {
      return {
        ok: false,
        reason: "hospital_inactive",
        hospitalStatus: hospital.status,
      };
    }

    // One write on the Hospital document logs out every user of that tenant.
    if (hospital.tokenVersion !== claims.hospitalTokenVersion) {
      return { ok: false, reason: "hospital_token_version_mismatch" };
    }
  }

  const roleId = user.roleId ? String(user.roleId) : null;
  const permissions = user.isSuperAdmin
    ? []
    : await resolvePermissions(roleId, hospitalId);

  if (permissions === null) return { ok: false, reason: "role_missing" };

  return {
    ok: true,
    user: {
      userId: String(user._id),
      sessionId: claims.sid,
      hospitalId,
      roleId,
      isSuperAdmin: Boolean(user.isSuperAdmin),
      mustChangePassword: Boolean(user.mustChangePassword),
      name: user.name,
      email: user.email,
      permissions,
    },
  };
}

/**
 * Resolves the current principal, or an explanation of why not.
 * Never throws for an unauthenticated caller — use `requireAuth` for that.
 */
export async function getAuthOutcome(): Promise<AuthOutcome> {
  const token = await readAccessToken();
  if (!token) return { ok: false, reason: "no_token" };

  const claims = await verifyAccessToken(token);
  if (!claims) return { ok: false, reason: "invalid_token" };

  return buildContext(claims);
}

/** Returns the current user, or `null` when not authenticated. */
export async function getCurrentUser(): Promise<AuthContext | null> {
  const outcome = await getAuthOutcome();
  return outcome.ok ? outcome.user : null;
}

export type RequireAuthOptions = {
  /**
   * Set on the three endpoints a user with `mustChangePassword` may still call
   * (Section 31): GET /api/auth/me, POST /api/auth/change-password,
   * POST /api/auth/logout. Everything else stays blocked server-side, so a
   * frontend that skips the redirect gains nothing.
   */
  allowPasswordChangePending?: boolean;
};

export async function requireAuth(
  options: RequireAuthOptions = {},
): Promise<AuthContext> {
  const outcome = await getAuthOutcome();

  if (!outcome.ok) {
    if (outcome.reason === "hospital_inactive") {
      throw ApiError.hospitalInactive(outcome.hospitalStatus ?? "unavailable");
    }
    // Every other failure is deliberately reported as a plain 401 so the
    // response does not disclose why (deactivated vs deleted vs stale token).
    throw ApiError.unauthenticated();
  }

  if (outcome.user.mustChangePassword && !options.allowPasswordChangePending) {
    throw ApiError.passwordChangeRequired();
  }

  return outcome.user;
}

export async function requireSuperAdmin(
  options: RequireAuthOptions = {},
): Promise<AuthContext> {
  const user = await requireAuth(options);
  if (!user.isSuperAdmin) {
    throw ApiError.forbidden("This action is restricted to platform administrators.");
  }
  return user;
}

/**
 * Guarantees a tenant-scoped principal. Returns a narrowed type whose
 * `hospitalId` is a non-null string, so downstream queries cannot forget it.
 */
export async function requireHospitalUser(
  options: RequireAuthOptions = {},
): Promise<AuthContext & { hospitalId: string }> {
  const user = await requireAuth(options);

  if (user.isSuperAdmin || !user.hospitalId) {
    throw ApiError.forbidden(
      "This endpoint is only available to hospital users.",
    );
  }

  return { ...user, hospitalId: user.hospitalId };
}

export async function requireHospitalAdmin(
  options: RequireAuthOptions = {},
): Promise<AuthContext & { hospitalId: string }> {
  const user = await requireHospitalUser(options);

  /**
   * "Hospital Admin" is defined by holding the tenant-administration
   * permissions, not by a role name — a renamed or custom role with the same
   * authority works identically.
   */
  const isAdmin =
    user.permissions.includes("user.create") &&
    user.permissions.includes("role.create");

  if (!isAdmin) {
    throw ApiError.forbidden("Hospital administrator access required.");
  }

  return user;
}

/**
 * The only sanctioned way to obtain a tenant id. It always comes from the
 * database-backed auth context — never from the request body or query string
 * (Sections 8 and 9).
 */
export function getTenantId(user: AuthContext): string {
  if (!user.hospitalId) {
    throw ApiError.forbidden("No hospital is associated with this account.");
  }
  return user.hospitalId;
}
