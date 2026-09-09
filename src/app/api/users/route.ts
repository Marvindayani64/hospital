import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { createUserSchema, listUsersSchema } from "@/schemas/user.schema";
import { createUser, listUsers } from "@/services/user.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/users — members of the caller's hospital only. */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("user.view");

  const { searchParams } = new URL(req.url);
  const params = listUsersSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    roleId: searchParams.get("roleId") ?? undefined,
  });

  return ok(await listUsers(user.hospitalId, params));
});

/**
 * POST /api/users — add a member to this hospital.
 *
 * The new member is created with `mustChangePassword: true` and a temporary
 * password that is returned in this response only, mirroring the hospital
 * onboarding flow. The schema accepts no `hospitalId` or `isSuperAdmin`, so
 * neither can be injected.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission("user.create");

  const input = createUserSchema.parse(await readJson(req));

  const result = await createUser(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(
    {
      member: result.member,
      temporaryPassword: result.temporaryPassword,
      warning:
        "This temporary password is shown once and cannot be retrieved again. Share it with the member now.",
    },
    { status: 201 },
  );
});
