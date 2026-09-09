import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { saveFieldsSchema } from "@/schemas/form.schema";
import { getForm, saveFields } from "@/services/form.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function formId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/forms/[id]/fields — the current version's field definitions. */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("form.view");

  const form = await getForm(await formId(context), user.hospitalId);

  return ok({
    version: form.currentVersion,
    fields: form.fields,
    editWillCreateVersion: form.editWillCreateVersion,
  });
});

/**
 * PUT /api/forms/[id]/fields
 *
 * Replaces the entire field set in one call. Adding, removing and reordering
 * fields is a single coherent edit, so applying it atomically avoids ever
 * persisting a half-updated form and lets the versioning decision be made once
 * for the whole change.
 *
 * Versioning (Section 25): if the current version already has responses, the
 * new field set becomes version N+1 and version N is left untouched. Otherwise
 * the current version is edited in place, so authoring does not spawn a version
 * per keystroke.
 */
export const PUT = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("form.update");

  const input = saveFieldsSchema.parse(await readJson(req));

  const result = await saveFields(
    await formId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok({
    form: result.form,
    newVersion: result.newVersion,
    message:
      result.newVersion !== null
        ? `Saved as version ${result.newVersion}. Existing responses remain on the previous version.`
        : "Fields saved.",
  });
});
