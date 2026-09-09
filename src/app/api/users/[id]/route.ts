import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import {
  changeUserStatusSchema,
  updateUserSchema,
} from "@/schemas/user.schema";
import {
  changeUserStatus,
  deleteUser,
  getUser,
  updateUser,
} from "@/services/user.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function memberId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/users/[id] */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("user.view");
  return ok(await getUser(await memberId(context), user.hospitalId));
});

/** PATCH /api/users/[id] — name, email and role assignment. */
export const PATCH = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("user.update");

  const input = updateUserSchema.parse(await readJson(req));

  const member = await updateUser(
    await memberId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(member);
});

/**
 * PUT /api/users/[id] — activate / deactivate.
 *
 * Separate from PATCH because a status change must also bump `tokenVersion`
 * and revoke the member's sessions; a shared handler could let that be skipped.
 */
export const PUT = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("user.update");

  const { status } = changeUserStatusSchema.parse(await readJson(req));

  const member = await changeUserStatus(
    await memberId(context),
    status,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(member);
});

/** DELETE /api/users/[id] */
export const DELETE = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("user.delete");

  await deleteUser(
    await memberId(context),
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok({ deleted: true });
});
