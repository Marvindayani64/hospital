import type { Metadata } from "next";
import Link from "next/link";
import { requireHospitalUser } from "@/lib/auth/session";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { getDashboardStats } from "@/services/report.service";
import {
  APPOINTMENT_STATUS_TONES,
  statusLabel,
} from "@/components/ui/appointment-status";
import type { AppointmentStatus } from "@/models/Appointment";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * Tenant dashboard (Section 35).
 *
 * Every figure is scoped to `hospitalId = currentUser.hospitalId`, and each is
 * computed ONLY when the caller holds the permission for its underlying data —
 * a metric they may not see is never calculated, not merely hidden.
 */
function Tile({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}) {
  const body = (
    <div className="rounded-xl border border-ink-200 bg-white px-5 py-4 transition-colors hover:border-gold-300">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function DashboardPage() {
  const user = await requireHospitalUser();
  const stats = await getDashboardStats(user);

  const hasAnyTile =
    stats.patients || stats.appointments || stats.doctors ||
    stats.treatments || stats.visits || stats.billing;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Welcome back, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Today is {new Date(`${stats.today}T00:00:00`).toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>

      {!hasAnyTile ? (
        <Card>
          <EmptyState
            title="Nothing to show yet"
            description="Your role does not include access to any dashboard metrics. Ask a hospital administrator if you need more."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.patients ? (
            <Tile
              label="Patients"
              value={stats.patients.total}
              hint={`${stats.patients.newThisMonth} registered this month`}
              href="/patients"
            />
          ) : null}

          {stats.appointments ? (
            <>
              <Tile
                label="Today's appointments"
                value={stats.appointments.today}
                hint={`${stats.appointments.upcoming} upcoming`}
                href="/appointments"
              />
            </>
          ) : null}

          {stats.visits ? (
            <Tile
              label="Visits this month"
              value={stats.visits.thisMonth}
              hint={
                stats.visits.followUpsDue > 0
                  ? `${stats.visits.followUpsDue} follow-up${stats.visits.followUpsDue === 1 ? "" : "s"} due`
                  : "No follow-ups due"
              }
              href="/visits"
            />
          ) : null}

          {stats.billing ? (
            <Tile
              label="Outstanding"
              value={stats.billing.outstandingFormatted}
              hint={`${stats.billing.collectedThisMonthFormatted} collected this month`}
              href="/billing"
            />
          ) : null}

          {stats.doctors ? (
            <Tile
              label="Doctors"
              value={stats.doctors.active}
              hint={`${stats.doctors.total} total`}
              href="/doctors"
            />
          ) : null}

          {stats.treatments ? (
            <Tile
              label="Treatments"
              value={stats.treatments.active}
              hint={`${stats.treatments.total} in catalogue`}
              href="/treatments"
            />
          ) : null}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {stats.appointments ? (
          <Card>
            <CardHeader
              title="Today's schedule"
              description={
                stats.todaysAppointments.length === 0
                  ? "Nothing booked for today"
                  : `${stats.todaysAppointments.length} shown`
              }
            />
            {stats.todaysAppointments.length === 0 ? (
              <EmptyState
                title="No appointments today"
                description="Bookings for today will appear here."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {stats.todaysAppointments.map((appointment) => (
                  <li
                    key={appointment.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium tabular-nums text-ink-900">
                        {appointment.startTime}–{appointment.endTime}
                      </p>
                      <p className="truncate text-xs text-ink-500">
                        {appointment.patientName} · {appointment.doctorName}
                      </p>
                    </div>
                    <Badge
                      tone={
                        APPOINTMENT_STATUS_TONES[
                          appointment.status as AppointmentStatus
                        ]
                      }
                    >
                      <span className="normal-case">
                        {statusLabel(appointment.status)}
                      </span>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {stats.patients ? (
          <Card>
            <CardHeader title="Recently registered" />
            {stats.recentPatients.length === 0 ? (
              <EmptyState
                title="No patients yet"
                description="Newly registered patients will appear here."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {stats.recentPatients.map((patient) => (
                  <li key={patient.id} className="px-5 py-3">
                    <Link
                      href={`/patients/${patient.id}`}
                      className="text-sm font-medium text-ink-900 hover:text-gold-700"
                    >
                      {patient.name}
                    </Link>
                    <p className="font-mono text-xs text-ink-500">
                      {patient.patientNumber} ·{" "}
                      {new Date(patient.createdAt).toLocaleDateString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>

      {stats.appointments &&
      Object.keys(stats.appointments.todayByStatus).length > 0 ? (
        <Card>
          <CardHeader title="Today by status" />
          <CardBody className="flex flex-wrap gap-2">
            {Object.entries(stats.appointments.todayByStatus).map(
              ([status, count]) => (
                <Badge
                  key={status}
                  tone={APPOINTMENT_STATUS_TONES[status as AppointmentStatus]}
                >
                  <span className="normal-case">
                    {statusLabel(status)}: {count}
                  </span>
                </Badge>
              ),
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
