import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { updateRoleSchema } from "@/schemas/role.schema";
import { deleteRole, getRole, updateRole } from "@/services/role.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function roleId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/roles/[id] */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("role.view");
  return ok(await getRole(await roleId(context), user.hospitalId));
});

/** PATCH /api/roles/[id] — rename, re-describe, or change the permission set. */
export const PATCH = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("role.update");

  const input = updateRoleSchema.parse(await readJson(req));

  const role = await updateRole(
    await roleId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(role);
});

/**
 * DELETE /api/roles/[id]
 *
 * Refuses to delete a system role, or any role still assigned to a member —
 * a member whose role vanished could not be authorised on any request.
 */
export const DELETE = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("role.delete");

  await deleteRole(
    await roleId(context),
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok({ deleted: true });
});
