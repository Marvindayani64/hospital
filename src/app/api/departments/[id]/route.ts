import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { updateDepartmentSchema } from "@/schemas/department.schema";
import {
  deleteDepartment,
  getDepartment,
  updateDepartment,
} from "@/services/department.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function departmentId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/departments/[id] */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("department.view");
  return ok(await getDepartment(await departmentId(context), user.hospitalId));
});

/**
 * PATCH /api/departments/[id]
 *
 * Status is included here rather than split onto its own verb: unlike a user or
 * hospital, deactivating a department revokes no sessions and invalidates no
 * tokens, so there is no side effect that a shared handler could skip.
 */
export const PATCH = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("department.update");

  const input = updateDepartmentSchema.parse(await readJson(req));

  const department = await updateDepartment(
    await departmentId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(department);
});

/** DELETE /api/departments/[id] — refused while treatments still reference it. */
export const DELETE = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("department.delete");

  await deleteDepartment(
    await departmentId(context),
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok({ deleted: true });
});
