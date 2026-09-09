"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { PatientFormModal, type PatientRecord } from "@/components/ui/PatientForm";
import { APPOINTMENT_STATUS_TONES, statusLabel } from "@/components/ui/appointment-status";
import type { AppointmentSummary } from "@/services/appointment.service";
import type { VisitSummary } from "@/services/visit.service";

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  prefer_not_to_say: "Not specified",
};

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink-900">{value || "—"}</dd>
    </div>
  );
}

export function PatientDetail({
  patient,
  appointments,
  visits,
  canViewAppointments,
  canViewVisits,
  canUpdate,
}: {
  patient: PatientRecord;
  appointments: AppointmentSummary[];
  visits: VisitSummary[];
  canViewAppointments: boolean;
  canViewVisits: boolean;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const upcoming = appointments.filter(
    (appointment) =>
      !["completed", "cancelled", "no_show"].includes(appointment.status),
  );
  const past = appointments.filter((appointment) =>
    ["completed", "cancelled", "no_show"].includes(appointment.status),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">
              {patient.fullName}
            </h1>
            <Badge tone="gold">
              <span className="font-mono normal-case">
                {patient.patientNumber}
              </span>
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            Registered {new Date(patient.createdAt).toLocaleDateString()}
          </p>
        </div>

        <div className="flex gap-2">
          <Link href="/patients">
            <Button variant="secondary">Back to patients</Button>
          </Link>
          {canUpdate ? (
            <Button onClick={() => setEditing(true)}>Edit patient</Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Phone" value={patient.phone} />
              <Detail label="Email" value={patient.email} />
              <Detail
                label="Date of birth"
                value={
                  patient.dateOfBirth
                    ? `${new Date(`${patient.dateOfBirth}T00:00:00Z`).toLocaleDateString()}${
                        patient.age !== null ? ` (${patient.age})` : ""
                      }`
                    : ""
                }
              />
              <Detail
                label="Gender"
                value={GENDER_LABELS[patient.gender] ?? patient.gender}
              />
              <div className="sm:col-span-2">
                <Detail label="Address" value={patient.address} />
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Emergency contact" />
          <CardBody>
            {patient.emergencyContact.name ||
            patient.emergencyContact.phone ? (
              <dl className="flex flex-col gap-4">
                <Detail label="Name" value={patient.emergencyContact.name} />
                <Detail
                  label="Relationship"
                  value={patient.emergencyContact.relationship}
                />
                <Detail label="Phone" value={patient.emergencyContact.phone} />
              </dl>
            ) : (
              <p className="text-sm text-ink-500">No emergency contact recorded.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {patient.notes ? (
        <Card>
          <CardHeader
            title="Notes"
            description="Administrative notes. Clinical findings live on visit records."
          />
          <CardBody>
            <p className="whitespace-pre-wrap text-sm text-ink-700">
              {patient.notes}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {canViewAppointments ? (
        <Card>
          <CardHeader
            title="Appointments"
            description={`${upcoming.length} upcoming · ${past.length} past`}
          />
          {appointments.length === 0 ? (
            <EmptyState
              title="No appointments yet"
              description="This patient has no bookings on record."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th scope="col" className="px-5 py-2.5 font-semibold">Date</th>
                    <th scope="col" className="px-5 py-2.5 font-semibold">Time</th>
                    <th scope="col" className="px-5 py-2.5 font-semibold">Doctor</th>
                    <th scope="col" className="px-5 py-2.5 font-semibold">Service</th>
                    <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {appointments.map((appointment) => (
                    <tr key={appointment.id} className="hover:bg-ink-50/60">
                      <td className="px-5 py-3 tabular-nums text-ink-900">
                        {appointment.appointmentDate}
                      </td>
                      <td className="px-5 py-3 tabular-nums text-ink-600">
                        {appointment.startTime}–{appointment.endTime}
                      </td>
                      <td className="px-5 py-3 text-ink-600">
                        {appointment.doctor?.name ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-ink-600">
                        {appointment.treatment?.name ??
                          appointment.department?.name ??
                          "—"}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={APPOINTMENT_STATUS_TONES[appointment.status]}>
                          <span className="normal-case">
                            {statusLabel(appointment.status)}
                          </span>
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {canViewVisits ? (
        <Card>
          <CardHeader
            title="Consultation history"
            description={`${visits.length} recorded ${visits.length === 1 ? "visit" : "visits"}`}
          />
          {visits.length === 0 ? (
            <EmptyState
              title="No visits recorded"
              description="Clinical notes for this patient will appear here."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {visits.map((visit) => (
                <li key={visit.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium tabular-nums text-ink-900">
                        {visit.visitDate}
                        <span className="ml-2 font-normal text-ink-500">
                          {visit.doctor?.name ?? "Unknown doctor"}
                        </span>
                      </p>
                      {visit.diagnosis ? (
                        <p className="mt-1 max-w-2xl text-sm text-ink-700">
                          {visit.diagnosis}
                        </p>
                      ) : null}
                      {visit.formResponses.length > 0 ? (
                        <p className="mt-1 text-xs text-gold-700">
                          {visit.formResponses
                            .map((response) => response.formName)
                            .join(", ")}
                        </p>
                      ) : null}
                    </div>
                    {visit.followUpDate ? (
                      <Badge tone="neutral">
                        <span className="normal-case tabular-nums">
                          Follow-up {visit.followUpDate}
                        </span>
                      </Badge>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {editing ? (
        <PatientFormModal
          patient={patient}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            // Re-render the server component so the detail reflects the edit.
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
