import { ok, route } from "@/lib/api/response";
import { requireAuth } from "@/lib/auth/session";
import { connectToDatabase } from "@/lib/db/connect";
import { Hospital, Role } from "@/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me
 *
 * Allowed while `mustChangePassword` is set (Section 31) — the change-password
 * screen needs to know who it is talking to.
 *
 * Returns the identity, the live permission set and the tenant's public
 * details. Permissions come from requireAuth(), which resolved them from the
 * current Role document rather than from the token.
 */
export const GET = route(async () => {
  const user = await requireAuth({ allowPasswordChangePending: true });

  await connectToDatabase();

  const [role, hospital] = await Promise.all([
    user.roleId
      ? Role.findOne({ _id: user.roleId, hospitalId: user.hospitalId })
          .select("name key")
          .lean()
      : null,
    user.hospitalId
      ? Hospital.findById(user.hospitalId)
          .select("name slug type logo status")
          .lean()
      : null,
  ]);

  return ok({
    user: {
      id: user.userId,
      name: user.name,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      mustChangePassword: user.mustChangePassword,
      hospitalId: user.hospitalId,
      role: role ? { id: String(role._id), name: role.name, key: role.key } : null,
      permissions: user.permissions,
    },
    hospital: hospital
      ? {
          id: String(hospital._id),
          name: hospital.name,
          slug: hospital.slug,
          type: hospital.type,
          logo: hospital.logo,
          status: hospital.status,
        }
      : null,
  });
});
