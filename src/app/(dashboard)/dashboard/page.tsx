import type { Metadata } from "next";
import Link from "next/link";
import { requireHospitalUser } from "@/lib/auth/session";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { InsightList } from "@/components/dashboard/InsightList";
import { PatientFlowChart } from "@/components/dashboard/PatientFlowChart";
import { RevenueTrendChart } from "@/components/dashboard/RevenueTrendChart";
import {
  getDashboardInsights,
  getDashboardStats,
} from "@/services/report.service";
import {
  APPOINTMENT_STATUS_TONES,
  statusLabel,
} from "@/components/ui/appointment-status";
import { formatMoney } from "@/utils/money";
import type { AppointmentStatus } from "@/models/Appointment";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * Tenant command dashboard (Section 35).
 *
 * Every figure is scoped to `hospitalId = currentUser.hospitalId`, and each is
 * computed ONLY when the caller holds the permission for its underlying data —
 * a metric they may not see is never calculated, not merely hidden.
 *
 * The headline tiles all report the same seven-day window their trend compares,
 * so the number and the "vs last week" beneath it always describe one thing.
 * Cumulative totals sit in the hint line, where they cannot be misread as the
 * quantity that moved.
 */
export default async function DashboardPage() {
  const user = await requireHospitalUser();

  const [stats, insights] = await Promise.all([
    getDashboardStats(user),
    getDashboardInsights(user),
  ]);

  const hasAnyTile =
    stats.patients || stats.appointments || stats.doctors ||
    stats.treatments || stats.visits || stats.billing;

  const { trends } = insights;

  const showFlow = insights.patientFlow.length > 0;
  const showRevenue = insights.revenueSeries.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Hospital Command Dashboard
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Welcome back, {user.name.split(" ")[0]} ·{" "}
          {new Date(`${stats.today}T00:00:00`).toLocaleDateString(undefined, {
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
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {trends.patients && stats.patients ? (
              <KpiCard
                label="New patients"
                icon="patients"
                value={trends.patients.current}
                trend={trends.patients}
                hint={`${stats.patients.total} registered in total`}
                href="/patients"
              />
            ) : null}

            {trends.appointments && stats.appointments ? (
              <KpiCard
                label="Appointments"
                icon="appointments"
                value={trends.appointments.current}
                trend={trends.appointments}
                hint={`${stats.appointments.today} today · ${stats.appointments.upcoming} upcoming`}
                href="/appointments"
              />
            ) : null}

            {trends.visits && stats.visits ? (
              <KpiCard
                label="Consultations"
                icon="visits"
                value={trends.visits.current}
                trend={trends.visits}
                hint={`${stats.visits.thisMonth} this month`}
                href="/visits"
              />
            ) : null}

            {trends.revenue ? (
              <KpiCard
                label="Collected"
                icon="billing"
                value={formatMoney(trends.revenue.current, insights.currency)}
                trend={trends.revenue}
                hint={
                  stats.billing
                    ? `${stats.billing.outstandingFormatted} outstanding`
                    : undefined
                }
                href="/billing"
              />
            ) : null}
          </div>

          {/* Configuration counts: useful context, but nothing that trends. */}
          {stats.doctors || stats.treatments || stats.billing ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-ink-200 bg-white px-5 py-3 text-sm shadow-sm">
              {stats.doctors ? (
                <Link href="/doctors" className="text-ink-600 hover:text-gold-700">
                  <span className="font-semibold tabular-nums text-ink-900">
                    {stats.doctors.active}
                  </span>{" "}
                  active doctors
                  <span className="text-ink-400"> of {stats.doctors.total}</span>
                </Link>
              ) : null}
              {stats.treatments ? (
                <Link href="/treatments" className="text-ink-600 hover:text-gold-700">
                  <span className="font-semibold tabular-nums text-ink-900">
                    {stats.treatments.active}
                  </span>{" "}
                  treatments offered
                  <span className="text-ink-400"> of {stats.treatments.total}</span>
                </Link>
              ) : null}
              {stats.billing ? (
                <Link href="/billing" className="text-ink-600 hover:text-gold-700">
                  <span className="font-semibold tabular-nums text-ink-900">
                    {stats.billing.unpaidInvoices}
                  </span>{" "}
                  issued invoices
                </Link>
              ) : null}
              {stats.visits && stats.visits.followUpsDue > 0 ? (
                <Link href="/visits" className="text-ink-600 hover:text-gold-700">
                  <span className="font-semibold tabular-nums text-ink-900">
                    {stats.visits.followUpsDue}
                  </span>{" "}
                  follow-ups due
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {showRevenue || showFlow ? (
        <div className="grid gap-6 xl:grid-cols-3">
          {showRevenue ? (
            <Card className="xl:col-span-2">
              <CardHeader
                title="Revenue trend"
                description="Payments received, by month"
              />
              <RevenueTrendChart
                points={insights.revenueSeries}
                currency={insights.currency}
              />
            </Card>
          ) : null}

          {showFlow ? (
            <Card className={showRevenue ? undefined : "xl:col-span-3"}>
              <CardHeader
                title="Patient flow"
                description="The last seven days"
              />
              <PatientFlowChart
                points={insights.patientFlow}
                showAppointments={stats.appointments !== null}
                showVisits={stats.visits !== null}
              />
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Critical alerts"
            action={
              insights.alerts.length > 0 ? (
                <Badge tone="danger">
                  <span className="normal-case">{insights.alerts.length}</span>
                </Badge>
              ) : null
            }
          />
          <InsightList
            items={insights.alerts}
            emptyTitle="Nothing needs attention"
            emptyDescription="No overdue follow-ups, unpaid invoices or patients left waiting."
          />
        </Card>

        <Card>
          <CardHeader
            title="Pending approvals"
            action={
              insights.approvals.length > 0 ? (
                <Badge tone="warning">
                  <span className="normal-case">
                    {insights.approvals.length}
                  </span>
                </Badge>
              ) : null
            }
          />
          <InsightList
            items={insights.approvals}
            emptyTitle="Nothing waiting on you"
            emptyDescription="No draft invoices, unconfirmed bookings or unclaimed staff accounts."
          />
        </Card>
      </div>

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
