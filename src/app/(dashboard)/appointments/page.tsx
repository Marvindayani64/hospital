import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { todayDateString } from "@/utils/time";
import { AppointmentsManager } from "@/app/(dashboard)/appointments/AppointmentsManager";

export const metadata: Metadata = { title: "Appointments" };
export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
  const { allowed, user } = await guardHospitalPage("appointment.view");

  if (!allowed) {
    return <AccessDenied permission="appointment.view" what="appointments" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Appointments
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          The booking schedule. A doctor cannot be booked into two appointments
          at the same time.
        </p>
      </div>

      <AppointmentsManager
        today={todayDateString()}
        canCreate={hasPermission(user, "appointment.create")}
        canUpdate={hasPermission(user, "appointment.update")}
        canCancel={hasPermission(user, "appointment.cancel")}
        canCreateVisits={hasPermission(user, "visit.create")}
        canViewPatients={hasPermission(user, "patient.view")}
        canViewDoctors={hasPermission(user, "doctor.view")}
        canViewDepartments={hasPermission(user, "department.view")}
        canViewTreatments={hasPermission(user, "treatment.view")}
      />
    </div>
  );
}
