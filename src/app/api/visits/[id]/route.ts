import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { updateVisitSchema } from "@/schemas/visit.schema";
import { getVisit, updateVisit } from "@/services/visit.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function visitId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/visits/[id] */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("visit.view");
  return ok(await getVisit(await visitId(context), user.hospitalId));
});

/**
 * PATCH /api/visits/[id]
 *
 * Amends the clinical content. The patient and the originating appointment are
 * deliberately not editable — reassigning a consultation to another patient is
 * never a legitimate correction and would corrupt two medical histories.
 *
 * There is intentionally no DELETE: the permission catalogue (Section 11) has
 * no `visit.delete`, and destroying a clinical record is not something this
 * system should offer.
 */
export const PATCH = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("visit.update");

  const input = updateVisitSchema.parse(await readJson(req));

  const visit = await updateVisit(
    await visitId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(visit);
});
