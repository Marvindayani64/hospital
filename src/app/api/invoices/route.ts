import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import {
  createInvoiceSchema,
  listInvoicesSchema,
} from "@/schemas/billing.schema";
import { createInvoice, listInvoices } from "@/services/billing.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/invoices
 *
 * NOTE on `paymentStatus`: it is derived from the payment ledger rather than
 * stored, so it filters the returned page rather than the query. `total` and
 * the page count therefore reflect the other filters only. Denormalising a paid
 * flag would make it queryable but could drift from the ledger — the wrong
 * trade for billing.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("invoice.view");

  const { searchParams } = new URL(req.url);
  const params = listInvoicesSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    patientId: searchParams.get("patientId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    paymentStatus: searchParams.get("paymentStatus") ?? undefined,
  });

  return ok(await listInvoices(user.hospitalId, params));
});

/**
 * POST /api/invoices
 *
 * Section 27: every line's unit price is read from the Treatment document in
 * this hospital's own catalogue. The request schema has no field for a
 * catalogue line's price, so a client-supplied amount cannot be honoured even
 * by accident. Subtotal, discount, tax and total are all computed server-side.
 *
 * Created as a draft — issuing is a separate, deliberate step.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission("invoice.create");

  const input = createInvoiceSchema.parse(await readJson(req));

  const invoice = await createInvoice(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(invoice, { status: 201 });
});
