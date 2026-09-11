import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { ApiError } from "@/lib/api/errors";
import { getPatient } from "@/services/patient.service";
import { listAppointments } from "@/services/appointment.service";
import { listVisits } from "@/services/visit.service";
import {
  getPrescriptionContext,
  listPrescriptions,
} from "@/services/prescription.service";
import { ownDoctorId } from "@/lib/rbac/doctor-scope";
import { todayDateString } from "@/utils/time";
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
  const canViewPrescriptions = hasPermission(user, "prescription.view");
  /**
   * Writing a prescription records the consultation, so it takes both rights —
   * the same pair the POST route enforces. Hiding the button without that check
   * would offer an action the server then refuses.
   */
  const canPrescribe =
    hasPermission(user, "prescription.create") &&
    hasPermission(user, "visit.create");

  // Every read is tenant-scoped in its service, and only runs when the caller
  // actually holds the permission.
  const today = todayDateString();

  /**
   * A clinician's own bookings and consultations only, matching the
   * appointments and visits screens. A patient's record therefore shows the
   * care THIS doctor gave them, not a colleague's.
   */
  const viewerDoctorId = await ownDoctorId(user.userId, user.hospitalId);

  const [appointments, visits, prescriptions, prescription] =
    await Promise.all([
      canViewAppointments
        ? listAppointments(user.hospitalId, {
            page: 1,
            pageSize: 50,
            patientId: id,
            viewerDoctorId,
          })
        : null,
      canViewVisits
        ? listVisits(user.hospitalId, {
            page: 1,
            pageSize: 50,
            patientId: id,
            viewerDoctorId,
          })
        : null,
      canViewPrescriptions
        ? listPrescriptions(user.hospitalId, {
            page: 1,
            pageSize: 50,
            patientId: id,
          })
        : null,
      // Who would sign a prescription written now, and which of today's
      // bookings it could attach to. The same call the patients list makes
      // through /api/patients/[id]/prescription-context.
      canPrescribe
        ? getPrescriptionContext(id, user.userId, user.hospitalId, today)
        : null,
    ]);

  return (
    <PatientDetail
      patient={patient}
      appointments={appointments?.items ?? []}
      visits={visits?.items ?? []}
      prescriptions={prescriptions?.items ?? []}
      today={today}
      prescriber={prescription?.prescriber ?? null}
      prescribableAppointments={prescription?.appointments ?? []}
      canViewAppointments={canViewAppointments}
      canViewVisits={canViewVisits}
      canViewPrescriptions={canViewPrescriptions}
      canPrescribe={canPrescribe}
      canUpdate={hasPermission(user, "patient.update")}
    />
  );
}
