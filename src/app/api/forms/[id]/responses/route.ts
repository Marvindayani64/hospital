import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { listResponsesSchema, submitResponseSchema } from "@/schemas/form.schema";
import {
  listResponses,
  submitResponse,
} from "@/services/form-response.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function formId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/forms/[id]/responses — submissions for this form. */
export const GET = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("form.view");

  const { searchParams } = new URL(req.url);
  const params = listResponsesSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    patientId: searchParams.get("patientId") ?? undefined,
  });

  return ok(await listResponses(await formId(context), user.hospitalId, params));
});

/**
 * POST /api/forms/[id]/responses
 *
 * Gated on `form.submit` rather than `form.update`: clinical staff fill forms
 * in but must not be able to redesign them.
 *
 * Answers are validated against the form's current field definitions, and the
 * version is pinned onto the response so it stays readable after future edits.
 */
export const POST = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("form.submit");

  const input = submitResponseSchema.parse(await readJson(req));

  const response = await submitResponse(
    await formId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(response, { status: 201 });
});
