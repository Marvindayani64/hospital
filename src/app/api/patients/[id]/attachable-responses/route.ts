import type { NextRequest } from "next/server";
import { ok, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { listAttachableResponses } from "@/services/visit.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/patients/[id]/attachable-responses?visitId=…
 *
 * Form responses for this patient that can be linked to a visit — those not
 * already attached elsewhere, plus any already on the visit being edited.
 *
 * Gated on `visit.create` because this exists to serve the visit editor; the
 * response content is not returned, only enough to identify each submission.
 */
export const GET = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("visit.create");

  const params = await context.params;
  const { searchParams } = new URL(req.url);

  return ok({
    responses: await listAttachableResponses(
      params.id ?? "",
      user.hospitalId,
      searchParams.get("visitId") ?? undefined,
    ),
  });
});
