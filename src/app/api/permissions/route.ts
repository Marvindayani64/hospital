import { ok, route } from "@/lib/api/response";
import { requireHospitalUser } from "@/lib/auth/session";
import { groupPermissions, PERMISSIONS } from "@/lib/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/permissions
 *
 * The permission catalogue, for the role editor. Static data, but still
 * authenticated: there is no reason to publish the platform's authorisation
 * surface to anonymous callers.
 */
export const GET = route(async () => {
  await requireHospitalUser();
  return ok({ permissions: PERMISSIONS, groups: groupPermissions() });
});
