import type { NextRequest } from "next/server";
import { ok, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { getResponse } from "@/services/form-response.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/form-responses/[id]
 *
 * Returns a submitted response together with the field definitions of the
 * version it was answered against — not the current ones. A response submitted
 * against v1 renders with v1's labels, options and ordering even after the form
 * has moved on to v3 (Section 25).
 *
 * Addressed at the top level rather than nested under the form, since a
 * response id is globally unique and callers rarely know its form up front.
 */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("form.view");

  const params = await context.params;

  return ok(await getResponse(params.id ?? "", user.hospitalId));
});
