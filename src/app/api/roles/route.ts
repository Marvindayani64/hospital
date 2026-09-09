import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { createRoleSchema, listRolesSchema } from "@/schemas/role.schema";
import { createRole, listRoles } from "@/services/role.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/roles — roles belonging to the caller's hospital.
 *
 * `requirePermission` returns a context whose `hospitalId` is a non-null
 * string, and every query in the service is built through `tenantScoped`, so
 * another hospital's roles are unreachable regardless of what is requested.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("role.view");

  const { searchParams } = new URL(req.url);
  const params = listRolesSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    search: searchParams.get("search") ?? undefined,
  });

  return ok(await listRoles(user.hospitalId, params));
});

/** POST /api/roles — create a custom role for this hospital. */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission("role.create");

  const input = createRoleSchema.parse(await readJson(req));

  const role = await createRole(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(role, { status: 201 });
});
