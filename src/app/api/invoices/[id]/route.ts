import type { NextRequest } from "next/server";
import { ok, readJson, route, type RouteContext } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import {
  changeInvoiceStatusSchema,
  updateInvoiceSchema,
} from "@/schemas/billing.schema";
import {
  changeInvoiceStatus,
  deleteInvoice,
  getInvoice,
  updateInvoice,
} from "@/services/billing.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function invoiceId(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.id ?? "";
}

/** GET /api/invoices/[id] — with its lines, totals and live balance. */
export const GET = route(async (_req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("invoice.view");
  return ok(await getInvoice(await invoiceId(context), user.hospitalId));
});

/**
 * PATCH /api/invoices/[id]
 *
 * Drafts only. Any change to lines, discount or tax triggers a full server-side
 * recalculation with prices re-read from the database — no path mutates a
 * total directly.
 */
export const PATCH = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("invoice.update");

  const input = updateInvoiceSchema.parse(await readJson(req));

  const invoice = await updateInvoice(
    await invoiceId(context),
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(invoice);
});

/**
 * PUT /api/invoices/[id] — issue or cancel.
 *
 * Separate from PATCH so each transition can be policed: issuing freezes the
 * document, and cancelling is refused once money has been received.
 */
export const PUT = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("invoice.update");

  const { status, cancellationReason } = changeInvoiceStatusSchema.parse(
    await readJson(req),
  );

  const invoice = await changeInvoiceStatus(
    await invoiceId(context),
    status,
    cancellationReason,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(invoice);
});

/** DELETE /api/invoices/[id] — unissued, unpaid drafts only. */
export const DELETE = route(async (req: NextRequest, context: RouteContext) => {
  const user = await requirePermission("invoice.delete");

  await deleteInvoice(
    await invoiceId(context),
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok({ deleted: true });
});
