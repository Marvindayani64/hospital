import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { todayDateString } from "@/utils/time";
import { VisitsManager } from "@/app/(dashboard)/visits/VisitsManager";

export const metadata: Metadata = { title: "Visits" };
export const dynamic = "force-dynamic";

export default async function VisitsPage() {
  const { allowed, user } = await guardHospitalPage("visit.view");

  if (!allowed) {
    return <AccessDenied permission="visit.view" what="consultation records" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Visits
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Consultation records. Specialty-specific findings are captured through
          this hospital&apos;s own forms and attached here.
        </p>
      </div>

      <VisitsManager
        today={todayDateString()}
        canCreate={hasPermission(user, "visit.create")}
        canUpdate={hasPermission(user, "visit.update")}
        canViewPatients={hasPermission(user, "patient.view")}
        canViewDoctors={hasPermission(user, "doctor.view")}
        canViewTreatments={hasPermission(user, "treatment.view")}
      />
    </div>
  );
}
