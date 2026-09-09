import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { PatientsManager } from "@/app/(dashboard)/patients/PatientsManager";

export const metadata: Metadata = { title: "Patients" };
export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  const { allowed, user } = await guardHospitalPage("patient.view");

  if (!allowed) {
    return <AccessDenied permission="patient.view" what="patient records" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Patients
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Everyone registered at this hospital. Search by name, phone or patient
          number.
        </p>
      </div>

      <PatientsManager
        canCreate={hasPermission(user, "patient.create")}
        canUpdate={hasPermission(user, "patient.update")}
        canDelete={hasPermission(user, "patient.delete")}
      />
    </div>
  );
}
