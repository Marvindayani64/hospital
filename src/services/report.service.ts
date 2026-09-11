import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import {
  Appointment,
  Doctor,
  Hospital,
  Invoice,
  Patient,
  Payment,
  Treatment,
  User,
  Visit,
} from "@/models";
import { RELEASING_STATUSES } from "@/models/Appointment";
import { tenantScoped } from "@/lib/tenant/scope";
import { ownDoctorId } from "@/lib/rbac/doctor-scope";
import { DEFAULT_CURRENCY, formatMoney } from "@/utils/money";
import { todayDateString } from "@/utils/time";
import type { AuthContext } from "@/types";
import type { Permission } from "@/lib/rbac/permissions";

/**
 * Dashboard and reporting aggregates (Sections 34, 35).
 *
 * Every query here is tenant-scoped. Just as importantly, each metric is only
 * computed when the caller actually holds the permission for the underlying
 * data — a receptionist's dashboard must not reveal revenue totals simply
 * because the tile exists.
 */

export type DashboardStats = {
  currency: string;
  today: string;
  patients: { total: number; newThisMonth: number } | null;
  appointments: {
    today: number;
    upcoming: number;
    todayByStatus: Record<string, number>;
  } | null;
  doctors: { total: number; active: number } | null;
  treatments: { total: number; active: number } | null;
  visits: { thisMonth: number; followUpsDue: number } | null;
  billing: {
    outstandingMinor: number;
    outstandingFormatted: string;
    unpaidInvoices: number;
    collectedThisMonthMinor: number;
    collectedThisMonthFormatted: string;
  } | null;
  recentPatients: Array<{
    id: string;
    name: string;
    patientNumber: string;
    createdAt: string;
  }>;
  todaysAppointments: Array<{
    id: string;
    startTime: string;
    endTime: string;
    patientName: string;
    doctorName: string;
    status: string;
  }>;
};

function has(user: AuthContext, permission: Permission): boolean {
  return !user.isSuperAdmin && user.permissions.includes(permission);
}

/** First day of the current month as `YYYY-MM-DD`. */
function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthStartDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * The dashboard's half of the doctor-scoping rule.
 *
 * `ownDoctorId` (lib/rbac/doctor-scope.ts) is the single definition of who a
 * clinician is; this only reshapes it for the two query forms used below —
 * plain filters and aggregation `$match` stages, which need a real ObjectId.
 * The appointments and visits listings apply the identical narrowing, so no
 * screen can disagree with another about what a doctor may see.
 */
type DoctorScope = {
  filter: Record<string, never> | { doctorId: string };
  match: Record<string, never> | { doctorId: mongoose.Types.ObjectId };
};

async function doctorScopeFor(
  user: AuthContext & { hospitalId: string },
): Promise<DoctorScope> {
  const id = await ownDoctorId(user.userId, user.hospitalId);

  if (!id) return { filter: {}, match: {} };

  return {
    filter: { doctorId: id },
    match: { doctorId: new mongoose.Types.ObjectId(id) },
  };
}

export async function getDashboardStats(
  user: AuthContext & { hospitalId: string },
): Promise<DashboardStats> {
  await connectToDatabase();

  const hospitalId = user.hospitalId;
  const today = todayDateString();
  const tenantOid = new mongoose.Types.ObjectId(hospitalId);

  const hospital = await Hospital.findById(hospitalId).select("currency").lean();
  const currency = hospital?.currency ?? DEFAULT_CURRENCY;

  const canPatients = has(user, "patient.view");
  const canAppointments = has(user, "appointment.view");
  const canDoctors = has(user, "doctor.view");
  const canTreatments = has(user, "treatment.view");
  const canVisits = has(user, "visit.view");
  const canBilling = has(user, "invoice.view");

  // Narrows every appointment and visit figure below to this clinician's own.
  const scope = await doctorScopeFor(user);

  const [
    patientTotal,
    patientNew,
    appointmentsToday,
    appointmentsUpcoming,
    todayStatusRows,
    doctorTotal,
    doctorActive,
    treatmentTotal,
    treatmentActive,
    visitsThisMonth,
    followUpsDue,
    recentPatientRows,
    todayRows,
  ] = await Promise.all([
    canPatients ? Patient.countDocuments(tenantScoped(hospitalId)) : 0,
    canPatients
      ? Patient.countDocuments(
          tenantScoped(hospitalId, {
            createdAt: mongoose.trusted({ $gte: monthStartDate() }),
          }),
        )
      : 0,
    canAppointments
      ? Appointment.countDocuments(
          tenantScoped(hospitalId, { ...scope.filter, appointmentDate: today }),
        )
      : 0,
    canAppointments
      ? Appointment.countDocuments(
          tenantScoped(hospitalId, {
            ...scope.filter,
            appointmentDate: mongoose.trusted({ $gt: today }),
            status: mongoose.trusted({ $nin: [...RELEASING_STATUSES] }),
          }),
        )
      : 0,
    canAppointments
      ? Appointment.aggregate<{ _id: string; count: number }>([
          {
            $match: {
              hospitalId: tenantOid,
              ...scope.match,
              appointmentDate: today,
            },
          },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ])
      : [],
    canDoctors ? Doctor.countDocuments(tenantScoped(hospitalId)) : 0,
    canDoctors
      ? Doctor.countDocuments(tenantScoped(hospitalId, { status: "active" }))
      : 0,
    canTreatments ? Treatment.countDocuments(tenantScoped(hospitalId)) : 0,
    canTreatments
      ? Treatment.countDocuments(tenantScoped(hospitalId, { status: "active" }))
      : 0,
    canVisits
      ? Visit.countDocuments(
          tenantScoped(hospitalId, {
            ...scope.filter,
            visitDate: mongoose.trusted({ $gte: monthStart() }),
          }),
        )
      : 0,
    canVisits
      ? Visit.countDocuments(
          tenantScoped(hospitalId, {
            ...scope.filter,
            followUpDate: mongoose.trusted({ $ne: null, $lte: today }),
          }),
        )
      : 0,
    canPatients
      ? Patient.find(tenantScoped(hospitalId))
          .sort({ createdAt: -1 })
          .limit(5)
          .select("firstName lastName patientNumber createdAt")
          .lean()
      : [],
    canAppointments
      ? Appointment.find(
          tenantScoped(hospitalId, { ...scope.filter, appointmentDate: today }),
        )
          .sort({ startMinutes: 1 })
          .limit(10)
          .populate("patientId", "firstName lastName")
          .populate("doctorId", "displayName")
          .lean()
      : [],
  ]);

  /**
   * Billing needs the payment ledger, since paid-ness is derived rather than
   * stored (see Phase 7). Outstanding = issued invoice totals minus everything
   * received against them.
   */
  let billing: DashboardStats["billing"] = null;

  if (canBilling) {
    const [issuedRows, paidRows, collectedRows] = await Promise.all([
      Invoice.aggregate<{ _id: null; total: number; count: number }>([
        { $match: { hospitalId: tenantOid, status: "issued" } },
        { $group: { _id: null, total: { $sum: "$totalMinor" }, count: { $sum: 1 } } },
      ]),
      Payment.aggregate<{ _id: null; total: number }>([
        {
          $lookup: {
            from: Invoice.collection.name,
            localField: "invoiceId",
            foreignField: "_id",
            as: "invoice",
          },
        },
        { $unwind: "$invoice" },
        {
          $match: {
            hospitalId: tenantOid,
            "invoice.status": "issued",
          },
        },
        { $group: { _id: null, total: { $sum: "$amountMinor" } } },
      ]),
      Payment.aggregate<{ _id: null; total: number }>([
        {
          $match: {
            hospitalId: tenantOid,
            paidAt: { $gte: monthStartDate() },
          },
        },
        { $group: { _id: null, total: { $sum: "$amountMinor" } } },
      ]),
    ]);

    const issuedTotal = issuedRows[0]?.total ?? 0;
    const issuedCount = issuedRows[0]?.count ?? 0;
    const paidTotal = paidRows[0]?.total ?? 0;
    const collected = collectedRows[0]?.total ?? 0;
    const outstanding = Math.max(0, issuedTotal - paidTotal);

    billing = {
      outstandingMinor: outstanding,
      outstandingFormatted: formatMoney(outstanding, currency),
      unpaidInvoices: issuedCount,
      collectedThisMonthMinor: collected,
      collectedThisMonthFormatted: formatMoney(collected, currency),
    };
  }

  const todayByStatus: Record<string, number> = {};
  for (const row of todayStatusRows) todayByStatus[row._id] = row.count;

  return {
    currency,
    today,
    patients: canPatients
      ? { total: patientTotal, newThisMonth: patientNew }
      : null,
    appointments: canAppointments
      ? {
          today: appointmentsToday,
          upcoming: appointmentsUpcoming,
          todayByStatus,
        }
      : null,
    doctors: canDoctors ? { total: doctorTotal, active: doctorActive } : null,
    treatments: canTreatments
      ? { total: treatmentTotal, active: treatmentActive }
      : null,
    visits: canVisits
      ? { thisMonth: visitsThisMonth, followUpsDue }
      : null,
    billing,
    recentPatients: (recentPatientRows as never[]).map(
      (patient: {
        _id: unknown;
        firstName: string;
        lastName: string;
        patientNumber: string;
        createdAt: Date;
      }) => ({
        id: String(patient._id),
        name: `${patient.firstName} ${patient.lastName}`.trim(),
        patientNumber: patient.patientNumber,
        createdAt: patient.createdAt.toISOString(),
      }),
    ),
    todaysAppointments: (todayRows as never[]).map(
      (appointment: {
        _id: unknown;
        startMinutes: number;
        endMinutes: number;
        status: string;
        patientId: { firstName?: string; lastName?: string } | null;
        doctorId: { displayName?: string } | null;
      }) => ({
        id: String(appointment._id),
        startTime: `${String(Math.floor(appointment.startMinutes / 60)).padStart(2, "0")}:${String(appointment.startMinutes % 60).padStart(2, "0")}`,
        endTime: `${String(Math.floor(appointment.endMinutes / 60)).padStart(2, "0")}:${String(appointment.endMinutes % 60).padStart(2, "0")}`,
        patientName: appointment.patientId
          ? `${appointment.patientId.firstName ?? ""} ${appointment.patientId.lastName ?? ""}`.trim()
          : "—",
        doctorName: appointment.doctorId?.displayName ?? "—",
        status: appointment.status,
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Dashboard insights — trends, series, alerts and approvals
// ---------------------------------------------------------------------------

/**
 * A week-on-week comparison.
 *
 * `changePercent` is null when the previous window was empty. There is no
 * honest percentage change from zero, and rendering "+100%" for the first
 * patient a hospital ever registers would be a lie on the executive tile that
 * matters most.
 */
export type Trend = {
  current: number;
  previous: number;
  changePercent: number | null;
  direction: "up" | "down" | "flat";
};

export type InsightItem = {
  id: string;
  title: string;
  detail: string;
  count: number;
  href: string;
  severity: "critical" | "warning" | "info";
};

export type DashboardInsights = {
  currency: string;
  today: string;
  /** Inclusive `YYYY-MM-DD` bounds the trends were computed over. */
  window: { currentFrom: string; previousFrom: string };
  trends: {
    patients: Trend | null;
    appointments: Trend | null;
    visits: Trend | null;
    /** Minor units collected. */
    revenue: Trend | null;
  };
  revenueSeries: Array<{
    month: string;
    label: string;
    amountMinor: number;
    amountFormatted: string;
  }>;
  patientFlow: Array<{
    date: string;
    label: string;
    appointments: number;
    visits: number;
  }>;
  alerts: InsightItem[];
  approvals: InsightItem[];
};

/** `YYYY-MM-DD` shifted by whole days, without touching the server timezone. */
function addDays(dateString: string, delta: number): string {
  const [year, month, day] = dateString.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Midnight local, matching the convention `monthStartDate()` already uses. */
function startOfLocalDay(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(year, month - 1, day);
}

function trend(current: number, previous: number): Trend {
  return {
    current,
    previous,
    changePercent:
      previous === 0 ? null : Math.round(((current - previous) / previous) * 100),
    direction: current > previous ? "up" : current < previous ? "down" : "flat",
  };
}

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Everything the command dashboard shows beyond the plain counters (Section 35).
 *
 * Kept separate from `getDashboardStats` so `/api/dashboard/stats` keeps its
 * existing shape, and so a caller that only wants the counters does not pay for
 * the aggregations. The permission rule is identical: a figure the caller may
 * not see is never computed, not merely hidden.
 */
export async function getDashboardInsights(
  user: AuthContext & { hospitalId: string },
): Promise<DashboardInsights> {
  await connectToDatabase();

  const hospitalId = user.hospitalId;
  const tenantOid = new mongoose.Types.ObjectId(hospitalId);
  const today = todayDateString();

  const hospital = await Hospital.findById(hospitalId).select("currency").lean();
  const currency = hospital?.currency ?? DEFAULT_CURRENCY;

  const canPatients = has(user, "patient.view");
  const canAppointments = has(user, "appointment.view");
  const canVisits = has(user, "visit.view");
  const canInvoices = has(user, "invoice.view");
  const canPayments = has(user, "payment.view");
  const canUsers = has(user, "user.view");

  /**
   * The same narrowing the stats use. Applied here too so the two halves of the
   * dashboard cannot contradict each other — "1 appointment today" beside an
   * alert about twelve unconfirmed ones belonging to other doctors.
   */
  const scope = await doctorScopeFor(user);

  // Two adjacent seven-day windows, both inclusive of their first day.
  const currentFrom = addDays(today, -6);
  const previousFrom = addDays(today, -13);
  const currentFromDate = startOfLocalDay(currentFrom);
  const previousFromDate = startOfLocalDay(previousFrom);

  /** Twelve buckets ending with the current month. */
  const now = new Date();
  const seriesMonths: Array<{ key: string; label: string }> = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    seriesMonths.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: SHORT_MONTHS[date.getMonth()]!,
    });
  }
  const seriesStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  /** The seven days ending today, oldest first. */
  const flowDays = Array.from({ length: 7 }, (_, index) =>
    addDays(today, index - 6),
  );

  const thirtyDaysAgo = startOfLocalDay(addDays(today, -30));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  type Pair = { _id: null; current: number; previous: number };

  const [
    patientPair,
    appointmentPair,
    visitPair,
    revenuePair,
    revenueRows,
    appointmentFlowRows,
    visitFlowRows,
    runningLate,
    unconfirmedToday,
    followUpsOverdue,
    overdueInvoiceRows,
    draftInvoices,
    unconfirmedUpcoming,
    pendingStaff,
  ] = await Promise.all([
    canPatients
      ? Patient.aggregate<Pair>([
          { $match: { hospitalId: tenantOid, createdAt: { $gte: previousFromDate } } },
          {
            $group: {
              _id: null,
              current: { $sum: { $cond: [{ $gte: ["$createdAt", currentFromDate] }, 1, 0] } },
              previous: { $sum: { $cond: [{ $lt: ["$createdAt", currentFromDate] }, 1, 0] } },
            },
          },
        ])
      : [],
    canAppointments
      ? Appointment.aggregate<Pair>([
          {
            $match: {
              hospitalId: tenantOid,
              ...scope.match,
              appointmentDate: { $gte: previousFrom, $lte: today },
            },
          },
          {
            $group: {
              _id: null,
              current: { $sum: { $cond: [{ $gte: ["$appointmentDate", currentFrom] }, 1, 0] } },
              previous: { $sum: { $cond: [{ $lt: ["$appointmentDate", currentFrom] }, 1, 0] } },
            },
          },
        ])
      : [],
    canVisits
      ? Visit.aggregate<Pair>([
          {
            $match: {
              hospitalId: tenantOid,
              ...scope.match,
              visitDate: { $gte: previousFrom, $lte: today },
            },
          },
          {
            $group: {
              _id: null,
              current: { $sum: { $cond: [{ $gte: ["$visitDate", currentFrom] }, 1, 0] } },
              previous: { $sum: { $cond: [{ $lt: ["$visitDate", currentFrom] }, 1, 0] } },
            },
          },
        ])
      : [],
    canPayments
      ? Payment.aggregate<Pair>([
          { $match: { hospitalId: tenantOid, paidAt: { $gte: previousFromDate } } },
          {
            $group: {
              _id: null,
              current: {
                $sum: { $cond: [{ $gte: ["$paidAt", currentFromDate] }, "$amountMinor", 0] },
              },
              previous: {
                $sum: { $cond: [{ $lt: ["$paidAt", currentFromDate] }, "$amountMinor", 0] },
              },
            },
          },
        ])
      : [],
    /**
     * Monthly collections. `$dateToString` buckets in UTC — the hospital's own
     * timezone is not modelled yet (see utils/time.ts), so a payment taken
     * within a few hours of midnight can land in the neighbouring month. That
     * is acceptable for a trend line and wrong for an accounting report, which
     * is why the Reports page computes its figures from an explicit range.
     */
    canPayments
      ? Payment.aggregate<{ _id: string; total: number }>([
          { $match: { hospitalId: tenantOid, paidAt: { $gte: seriesStart } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m", date: "$paidAt" } },
              total: { $sum: "$amountMinor" },
            },
          },
        ])
      : [],
    canAppointments
      ? Appointment.aggregate<{ _id: string; count: number }>([
          {
            $match: {
              hospitalId: tenantOid,
              ...scope.match,
              appointmentDate: { $gte: flowDays[0]!, $lte: today },
              status: { $nin: [...RELEASING_STATUSES] },
            },
          },
          { $group: { _id: "$appointmentDate", count: { $sum: 1 } } },
        ])
      : [],
    canVisits
      ? Visit.aggregate<{ _id: string; count: number }>([
          {
            $match: {
              hospitalId: tenantOid,
              ...scope.match,
              visitDate: { $gte: flowDays[0]!, $lte: today },
            },
          },
          { $group: { _id: "$visitDate", count: { $sum: 1 } } },
        ])
      : [],
    canAppointments
      ? Appointment.countDocuments(
          tenantScoped(hospitalId, {
            ...scope.filter,
            appointmentDate: today,
            status: mongoose.trusted({ $in: ["scheduled", "confirmed", "checked_in"] }),
            startMinutes: mongoose.trusted({ $lt: nowMinutes }),
          }),
        )
      : 0,
    canAppointments
      ? Appointment.countDocuments(
          tenantScoped(hospitalId, {
            ...scope.filter,
            appointmentDate: today,
            status: "scheduled",
          }),
        )
      : 0,
    canVisits
      ? Visit.countDocuments(
          tenantScoped(hospitalId, {
            ...scope.filter,
            followUpDate: mongoose.trusted({ $ne: null, $lt: today }),
          }),
        )
      : 0,
    /**
     * Issued more than 30 days ago and still not settled. Outstanding is
     * derived from the payment ledger for the same reason paid-ness always is
     * (Phase 7): a stored flag could disagree with the money actually received.
     */
    canInvoices
      ? Invoice.aggregate<{ _id: null; count: number; outstanding: number }>([
          {
            $match: {
              hospitalId: tenantOid,
              status: "issued",
              issuedAt: { $ne: null, $lt: thirtyDaysAgo },
            },
          },
          {
            $lookup: {
              from: Payment.collection.name,
              localField: "_id",
              foreignField: "invoiceId",
              as: "ledger",
            },
          },
          { $addFields: { paidMinor: { $sum: "$ledger.amountMinor" } } },
          { $match: { $expr: { $gt: ["$totalMinor", "$paidMinor"] } } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              outstanding: { $sum: { $subtract: ["$totalMinor", "$paidMinor"] } },
            },
          },
        ])
      : [],
    canInvoices
      ? Invoice.countDocuments(tenantScoped(hospitalId, { status: "draft" }))
      : 0,
    canAppointments
      ? Appointment.countDocuments(
          tenantScoped(hospitalId, {
            ...scope.filter,
            appointmentDate: mongoose.trusted({ $gt: today }),
            status: "scheduled",
          }),
        )
      : 0,
    canUsers
      ? User.countDocuments(
          tenantScoped(hospitalId, { mustChangePassword: true, status: "active" }),
        )
      : 0,
  ]);

  const revenueByMonth = new Map(revenueRows.map((row) => [row._id, row.total]));
  const appointmentsByDay = new Map(
    appointmentFlowRows.map((row) => [row._id, row.count]),
  );
  const visitsByDay = new Map(visitFlowRows.map((row) => [row._id, row.count]));

  const alerts: InsightItem[] = [];

  if (runningLate > 0) {
    alerts.push({
      id: "running-late",
      severity: "critical",
      title: "Appointments past their start time",
      detail: `${runningLate} patient${runningLate === 1 ? " is" : "s are"} still waiting to be seen.`,
      count: runningLate,
      href: "/appointments",
    });
  }

  const overdueInvoices = overdueInvoiceRows[0];
  if (overdueInvoices && overdueInvoices.count > 0) {
    alerts.push({
      id: "overdue-invoices",
      severity: "critical",
      title: "Invoices unpaid past 30 days",
      detail: `${formatMoney(overdueInvoices.outstanding, currency)} outstanding across ${overdueInvoices.count} invoice${overdueInvoices.count === 1 ? "" : "s"}.`,
      count: overdueInvoices.count,
      href: "/billing",
    });
  }

  if (followUpsOverdue > 0) {
    alerts.push({
      id: "follow-ups-overdue",
      severity: "warning",
      title: "Follow-ups overdue",
      detail: `${followUpsOverdue} patient${followUpsOverdue === 1 ? " was" : "s were"} due back before today.`,
      count: followUpsOverdue,
      href: "/visits",
    });
  }

  if (unconfirmedToday > 0) {
    alerts.push({
      id: "unconfirmed-today",
      severity: "warning",
      title: "Today's bookings unconfirmed",
      detail: `${unconfirmedToday} appointment${unconfirmedToday === 1 ? " has" : "s have"} not been confirmed with the patient.`,
      count: unconfirmedToday,
      href: "/appointments",
    });
  }

  const approvals: InsightItem[] = [];

  if (draftInvoices > 0) {
    approvals.push({
      id: "draft-invoices",
      severity: "info",
      title: "Draft invoices awaiting issue",
      detail: "Nothing is owed by the patient until an invoice is issued.",
      count: draftInvoices,
      href: "/billing",
    });
  }

  if (unconfirmedUpcoming > 0) {
    approvals.push({
      id: "unconfirmed-upcoming",
      severity: "info",
      title: "Upcoming bookings to confirm",
      detail: "Scheduled but not yet confirmed with the patient.",
      count: unconfirmedUpcoming,
      href: "/appointments",
    });
  }

  if (pendingStaff > 0) {
    approvals.push({
      id: "pending-staff",
      severity: "info",
      title: "Staff yet to set a password",
      detail: "These accounts still hold their temporary password.",
      count: pendingStaff,
      href: "/users",
    });
  }

  return {
    currency,
    today,
    window: { currentFrom, previousFrom },
    trends: {
      patients: canPatients
        ? trend(patientPair[0]?.current ?? 0, patientPair[0]?.previous ?? 0)
        : null,
      appointments: canAppointments
        ? trend(appointmentPair[0]?.current ?? 0, appointmentPair[0]?.previous ?? 0)
        : null,
      visits: canVisits
        ? trend(visitPair[0]?.current ?? 0, visitPair[0]?.previous ?? 0)
        : null,
      revenue: canPayments
        ? trend(revenuePair[0]?.current ?? 0, revenuePair[0]?.previous ?? 0)
        : null,
    },
    revenueSeries: canPayments
      ? seriesMonths.map((month) => {
          const amountMinor = revenueByMonth.get(month.key) ?? 0;
          return {
            month: month.key,
            label: month.label,
            amountMinor,
            amountFormatted: formatMoney(amountMinor, currency),
          };
        })
      : [],
    patientFlow:
      canAppointments || canVisits
        ? flowDays.map((date) => ({
            date,
            label: SHORT_WEEKDAYS[
              new Date(`${date}T00:00:00Z`).getUTCDay()
            ]!,
            appointments: appointmentsByDay.get(date) ?? 0,
            visits: visitsByDay.get(date) ?? 0,
          }))
        : [],
    alerts,
    approvals,
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type ReportSummary = {
  from: string;
  to: string;
  currency: string;
  revenue: {
    invoicedMinor: number;
    invoicedFormatted: string;
    collectedMinor: number;
    collectedFormatted: string;
    invoiceCount: number;
    paymentCount: number;
    byMethod: Array<{ method: string; amountMinor: number; amountFormatted: string; count: number }>;
  } | null;
  activity: {
    appointments: number;
    appointmentsByStatus: Array<{ status: string; count: number }>;
    visits: number;
    newPatients: number;
  } | null;
  topTreatments: Array<{
    name: string;
    quantity: number;
    revenueMinor: number;
    revenueFormatted: string;
  }>;
};

export async function getReportSummary(
  user: AuthContext & { hospitalId: string },
  range: { from: string; to: string },
): Promise<ReportSummary> {
  await connectToDatabase();

  const hospitalId = user.hospitalId;
  const tenantOid = new mongoose.Types.ObjectId(hospitalId);

  const hospital = await Hospital.findById(hospitalId).select("currency").lean();
  const currency = hospital?.currency ?? DEFAULT_CURRENCY;

  const fromDate = new Date(`${range.from}T00:00:00.000Z`);
  const toDate = new Date(`${range.to}T23:59:59.999Z`);

  const canBilling = has(user, "invoice.view");
  const canPayments = has(user, "payment.view");
  const canAppointments = has(user, "appointment.view");
  const canVisits = has(user, "visit.view");
  const canPatients = has(user, "patient.view");

  let revenue: ReportSummary["revenue"] = null;
  let topTreatments: ReportSummary["topTreatments"] = [];

  if (canBilling || canPayments) {
    const [invoiceRows, paymentRows, methodRows, treatmentRows] = await Promise.all([
      canBilling
        ? Invoice.aggregate<{ _id: null; total: number; count: number }>([
            {
              $match: {
                hospitalId: tenantOid,
                status: "issued",
                issuedAt: { $gte: fromDate, $lte: toDate },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: "$totalMinor" },
                count: { $sum: 1 },
              },
            },
          ])
        : [],
      canPayments
        ? Payment.aggregate<{ _id: null; total: number; count: number }>([
            {
              $match: {
                hospitalId: tenantOid,
                paidAt: { $gte: fromDate, $lte: toDate },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: "$amountMinor" },
                count: { $sum: 1 },
              },
            },
          ])
        : [],
      canPayments
        ? Payment.aggregate<{ _id: string; total: number; count: number }>([
            {
              $match: {
                hospitalId: tenantOid,
                paidAt: { $gte: fromDate, $lte: toDate },
              },
            },
            {
              $group: {
                _id: "$method",
                total: { $sum: "$amountMinor" },
                count: { $sum: 1 },
              },
            },
            { $sort: { total: -1 } },
          ])
        : [],
      canBilling
        ? Invoice.aggregate<{
            _id: string;
            quantity: number;
            revenue: number;
          }>([
            {
              $match: {
                hospitalId: tenantOid,
                status: "issued",
                issuedAt: { $gte: fromDate, $lte: toDate },
              },
            },
            { $unwind: "$items" },
            {
              $group: {
                _id: "$items.description",
                quantity: { $sum: "$items.quantity" },
                revenue: { $sum: "$items.lineTotalMinor" },
              },
            },
            { $sort: { revenue: -1 } },
            { $limit: 10 },
          ])
        : [],
    ]);

    revenue = {
      invoicedMinor: invoiceRows[0]?.total ?? 0,
      invoicedFormatted: formatMoney(invoiceRows[0]?.total ?? 0, currency),
      collectedMinor: paymentRows[0]?.total ?? 0,
      collectedFormatted: formatMoney(paymentRows[0]?.total ?? 0, currency),
      invoiceCount: invoiceRows[0]?.count ?? 0,
      paymentCount: paymentRows[0]?.count ?? 0,
      byMethod: methodRows.map((row) => ({
        method: row._id,
        amountMinor: row.total,
        amountFormatted: formatMoney(row.total, currency),
        count: row.count,
      })),
    };

    topTreatments = treatmentRows.map((row) => ({
      name: row._id,
      quantity: row.quantity,
      revenueMinor: row.revenue,
      revenueFormatted: formatMoney(row.revenue, currency),
    }));
  }

  let activity: ReportSummary["activity"] = null;

  if (canAppointments || canVisits || canPatients) {
    const [appointmentTotal, statusRows, visitTotal, newPatients] =
      await Promise.all([
        canAppointments
          ? Appointment.countDocuments(
              tenantScoped(hospitalId, {
                appointmentDate: mongoose.trusted({
                  $gte: range.from,
                  $lte: range.to,
                }),
              }),
            )
          : 0,
        canAppointments
          ? Appointment.aggregate<{ _id: string; count: number }>([
              {
                $match: {
                  hospitalId: tenantOid,
                  appointmentDate: { $gte: range.from, $lte: range.to },
                },
              },
              { $group: { _id: "$status", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
            ])
          : [],
        canVisits
          ? Visit.countDocuments(
              tenantScoped(hospitalId, {
                visitDate: mongoose.trusted({
                  $gte: range.from,
                  $lte: range.to,
                }),
              }),
            )
          : 0,
        canPatients
          ? Patient.countDocuments(
              tenantScoped(hospitalId, {
                createdAt: mongoose.trusted({ $gte: fromDate, $lte: toDate }),
              }),
            )
          : 0,
      ]);

    activity = {
      appointments: appointmentTotal,
      appointmentsByStatus: statusRows.map((row) => ({
        status: row._id,
        count: row.count,
      })),
      visits: visitTotal,
      newPatients,
    };
  }

  return {
    from: range.from,
    to: range.to,
    currency,
    revenue,
    activity,
    topTreatments,
  };
}
