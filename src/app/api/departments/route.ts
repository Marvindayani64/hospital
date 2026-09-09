import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import {
  createDepartmentSchema,
  listDepartmentsSchema,
} from "@/schemas/department.schema";
import {
  createDepartment,
  listDepartments,
} from "@/services/department.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/departments — this hospital's departments only. */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("department.view");

  const { searchParams } = new URL(req.url);
  const params = listDepartmentsSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? undefined,
  });

  return ok(await listDepartments(user.hospitalId, params));
});

/**
 * POST /api/departments
 *
 * Departments are tenant configuration — nothing about "Dental" or "Cardiology"
 * exists in the code (Sections 17, 39). A hospital defines whatever specialties
 * it runs.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission("department.create");

  const input = createDepartmentSchema.parse(await readJson(req));

  const department = await createDepartment(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(department, { status: 201 });
});
