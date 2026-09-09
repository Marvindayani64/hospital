import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { connectToDatabase } from "@/lib/db/connect";
import { Hospital } from "@/models";
import { DEFAULT_CURRENCY, getCurrency } from "@/utils/money";
import { TreatmentsManager } from "@/app/(dashboard)/treatments/TreatmentsManager";

export const metadata: Metadata = { title: "Treatments" };
export const dynamic = "force-dynamic";

export default async function TreatmentsPage() {
  const { allowed, user } = await guardHospitalPage("treatment.view");

  if (!allowed) {
    return (
      <AccessDenied permission="treatment.view" what="treatments and pricing" />
    );
  }

  // The hospital's billing currency drives every price input and label.
  await connectToDatabase();
  const hospital = await Hospital.findById(user.hospitalId)
    .select("currency")
    .lean();

  const currency = getCurrency(hospital?.currency ?? DEFAULT_CURRENCY);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Treatments &amp; services
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          What this hospital offers and what it charges. Prices are yours alone —
          the same service can cost something entirely different elsewhere on the
          platform.
        </p>
      </div>

      <TreatmentsManager
        currency={currency}
        canCreate={hasPermission(user, "treatment.create")}
        canUpdate={hasPermission(user, "treatment.update")}
        canDelete={hasPermission(user, "treatment.delete")}
        canViewDepartments={hasPermission(user, "department.view")}
      />
    </div>
  );
}
