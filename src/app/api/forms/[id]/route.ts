import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { updateFormSchema } from "@/schemas/form.schema";
import { deleteForm, getForm, updateForm } from "@/services/form.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function formId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/forms/[id] — the form plus its CURRENT version's fields. */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("form.view");
  return ok(await getForm(await formId(context), user.hospitalId));
});

/** PATCH /api/forms/[id] — metadata and status (draft/published/archived). */
export const PATCH = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("form.update");

  const input = updateFormSchema.parse(await readJson(req));

  const form = await updateForm(
    await formId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(form);
});

/**
 * DELETE /api/forms/[id]
 *
 * Refused once anything has been submitted — deleting would orphan patient
 * records and destroy the field definitions needed to read them back.
 */
export const DELETE = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("form.delete");

  await deleteForm(
    await formId(context),
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok({ deleted: true });
});
