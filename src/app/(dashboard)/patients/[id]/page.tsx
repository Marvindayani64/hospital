import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { ApiError } from "@/lib/api/errors";
import { getPatient } from "@/services/patient.service";
import { listAppointments } from "@/services/appointment.service";
import { listVisits } from "@/services/visit.service";
import { PatientDetail } from "@/app/(dashboard)/patients/[id]/PatientDetail";

export const metadata: Metadata = { title: "Patient" };
export const dynamic = "force-dynamic";

/**
 * Patient record with appointment history.
 *
 * Both reads are tenant-scoped in the service layer, so a patient id from
 * another hospital resolves to nothing and renders a 404 — never that
 * hospital's data.
 */
export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { allowed, user } = await guardHospitalPage("patient.view");

  if (!allowed) {
    return <AccessDenied permission="patient.view" what="patient records" />;
  }

  const { id } = await params;

  let patient;
  try {
    patient = await getPatient(id, user.hospitalId);
  } catch (error) {
    // A cross-tenant or missing id both surface as NOT_FOUND, so the two are
    // indistinguishable to the caller.
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const canViewAppointments = hasPermission(user, "appointment.view");
  const canViewVisits = hasPermission(user, "visit.view");

  // Both reads are tenant-scoped in their services, and only run when the
  // caller actually holds the permission.
  const [appointments, visits] = await Promise.all([
    canViewAppointments
      ? listAppointments(user.hospitalId, {
          page: 1,
          pageSize: 50,
          patientId: id,
        })
      : null,
    canViewVisits
      ? listVisits(user.hospitalId, { page: 1, pageSize: 50, patientId: id })
      : null,
  ]);

  return (
    <PatientDetail
      patient={patient}
      appointments={appointments?.items ?? []}
      visits={visits?.items ?? []}
      canViewAppointments={canViewAppointments}
      canViewVisits={canViewVisits}
      canUpdate={hasPermission(user, "patient.update")}
    />
  );
}
