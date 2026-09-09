import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import {
  createPaymentSchema,
  listPaymentsSchema,
} from "@/schemas/billing.schema";
import { listPayments, recordPayment } from "@/services/billing.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/payments — the ledger, filterable by invoice, patient or method. */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("payment.view");

  const { searchParams } = new URL(req.url);
  const params = listPaymentsSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    invoiceId: searchParams.get("invoiceId") ?? undefined,
    patientId: searchParams.get("patientId") ?? undefined,
    method: searchParams.get("method") ?? undefined,
  });

  return ok(await listPayments(user.hospitalId, params));
});

/**
 * POST /api/payments
 *
 * Records money received against an issued invoice. Refused for drafts and
 * cancelled invoices, and for any amount above the outstanding balance.
 *
 * There is deliberately no update or delete: payments are an append-only
 * ledger, and the permission catalogue (Section 11) grants only `payment.create`
 * and `payment.view`. A mistake is corrected with an offsetting entry.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requirePermission("payment.create");

  const input = createPaymentSchema.parse(await readJson(req));

  const payment = await recordPayment(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(payment, { status: 201 });
});
