import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { connectToDatabase } from "@/lib/db/connect";
import { Hospital } from "@/models";
import { DEFAULT_CURRENCY, getCurrency } from "@/utils/money";
import { BillingManager } from "@/app/(dashboard)/billing/BillingManager";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  // Either permission grants access to the screen; each tab is gated
  // individually below, and every endpoint re-checks server-side.
  const { allowed, user } = await guardHospitalPage("invoice.view");

  const canViewPayments = hasPermission(user, "payment.view");

  if (!allowed && !canViewPayments) {
    return <AccessDenied permission="invoice.view" what="billing" />;
  }

  await connectToDatabase();
  const hospital = await Hospital.findById(user.hospitalId)
    .select("currency defaultTaxRatePercent")
    .lean();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Billing
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Invoices and payments. Line prices always come from your treatment
          catalogue — they are never taken from the browser.
        </p>
      </div>

      <BillingManager
        currency={getCurrency(hospital?.currency ?? DEFAULT_CURRENCY)}
        defaultTaxRatePercent={hospital?.defaultTaxRatePercent ?? 0}
        canViewInvoices={allowed}
        canCreate={hasPermission(user, "invoice.create")}
        canUpdate={hasPermission(user, "invoice.update")}
        canDelete={hasPermission(user, "invoice.delete")}
        canViewPayments={canViewPayments}
        canRecordPayment={hasPermission(user, "payment.create")}
        canViewPatients={hasPermission(user, "patient.view")}
        canViewTreatments={hasPermission(user, "treatment.view")}
      />
    </div>
  );
}
