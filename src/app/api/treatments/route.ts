import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import {
  createTreatmentSchema,
  listTreatmentsSchema,
} from "@/schemas/treatment.schema";
import { createTreatment, listTreatments } from "@/services/treatment.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/treatments — this hospital's service catalogue and its prices. */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("treatment.view");

  const { searchParams } = new URL(req.url);
  const params = listTreatmentsSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    departmentId: searchParams.get("departmentId") ?? undefined,
  });

  return ok(await listTreatments(user.hospitalId, params));
});

/**
 * POST /api/treatments
 *
 * Price arrives in major units and is stored as integer minor units of the
 * hospital's own currency. The same treatment name can carry an entirely
 * different price at another hospital — pricing is tenant configuration, never
 * application logic (Section 18).
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission("treatment.create");

  const input = createTreatmentSchema.parse(await readJson(req));

  const treatment = await createTreatment(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(treatment, { status: 201 });
});
