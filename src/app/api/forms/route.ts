import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { createFormSchema, listFormsSchema } from "@/schemas/form.schema";
import { createForm, listForms } from "@/services/form.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/forms — this hospital's forms only. */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("form.view");

  const { searchParams } = new URL(req.url);
  const params = listFormsSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    category: searchParams.get("category") ?? undefined,
  });

  return ok(await listForms(user.hospitalId, params));
});

/**
 * POST /api/forms
 *
 * Creates an empty draft. Fields are added separately, which keeps the
 * versioning decision in one place (see PUT /api/forms/[id]/fields).
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission("form.create");

  const input = createFormSchema.parse(await readJson(req));

  const form = await createForm(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(form, { status: 201 });
});
