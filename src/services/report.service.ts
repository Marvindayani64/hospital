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
  Visit,
} from "@/models";
import { RELEASING_STATUSES } from "@/models/Appointment";
import { tenantScoped } from "@/lib/tenant/scope";
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
          tenantScoped(hospitalId, { appointmentDate: today }),
        )
      : 0,
    canAppointments
      ? Appointment.countDocuments(
          tenantScoped(hospitalId, {
            appointmentDate: mongoose.trusted({ $gt: today }),
            status: mongoose.trusted({ $nin: [...RELEASING_STATUSES] }),
          }),
        )
      : 0,
    canAppointments
      ? Appointment.aggregate<{ _id: string; count: number }>([
          { $match: { hospitalId: tenantOid, appointmentDate: today } },
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
            visitDate: mongoose.trusted({ $gte: monthStart() }),
          }),
        )
      : 0,
    canVisits
      ? Visit.countDocuments(
          tenantScoped(hospitalId, {
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
      ? Appointment.find(tenantScoped(hospitalId, { appointmentDate: today }))
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
