import type { NextRequest } from "next/server";
import { ok, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { getBillableChargesForPatient } from "@/services/billing.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/patients/[id]/billable-charges
 *
 * The doctor fees and treatment fees this patient has run up and not yet been
 * billed for, split field-wise with a total for each. Feeds the invoice
 * composer so that choosing a patient is enough to raise their bill.
 *
 * Gated on `invoice.create`: it exists to raise an invoice, and it prices
 * doctors and treatments for a role (Accountant) that holds neither
 * `doctor.view` nor, necessarily, any clinical permission.
 */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("invoice.create");

  const params = await context.params;

  return ok(
    await getBillableChargesForPatient(params.id ?? "", user.hospitalId),
  );
});
