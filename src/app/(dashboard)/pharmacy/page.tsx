import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { PharmacyManager } from "@/app/(dashboard)/pharmacy/PharmacyManager";

export const metadata: Metadata = { title: "Pharmacy" };
export const dynamic = "force-dynamic";

export default async function PharmacyPage() {
  const { allowed, user } = await guardHospitalPage("prescription.view");

  if (!allowed) {
    return <AccessDenied permission="prescription.view" what="prescriptions" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Pharmacy
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Prescriptions written by the hospital&apos;s doctors, oldest first.
          Dispensing is recorded against the person who did it.
        </p>
      </div>

      <PharmacyManager
        canDispense={hasPermission(user, "prescription.dispense")}
        canViewPatients={hasPermission(user, "patient.view")}
        canViewDoctors={hasPermission(user, "doctor.view")}
      />
    </div>
  );
}
