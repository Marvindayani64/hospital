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
} from "@/models";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import { formatReference, nextSequence } from "@/services/counter.service";
import {
  assertBelongsToTenant,
  paginationMeta,
  paginationSkip,
  regexSearch,
  tenantScoped,
} from "@/lib/tenant/scope";
import {
  DEFAULT_CURRENCY,
  formatMoney,
  hasValidPrecision,
  percentOfMinor,
  toMajorUnits,
  toMinorUnits,
} from "@/utils/money";
import type {
  CreateInvoiceInput,
  CreatePaymentInput,
  InvoiceItemInput,
  UpdateInvoiceInput,
} from "@/schemas/billing.schema";
import type { DiscountType, InvoiceStatus, PaymentMethod } from "@/models";
import type { Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

export type PaymentStatus = "unpaid" | "partially_paid" | "paid";

/** What a billed line is, so totals can be broken out field-wise. */
export type InvoiceLineKind = "treatment" | "consultation" | "adhoc";

export type InvoiceLine = {
  id: string;
  kind: InvoiceLineKind;
  treatmentId: string | null;
  doctorId: string | null;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  unitPrice: number;
  unitPriceFormatted: string;
  lineTotalMinor: number;
  lineTotalFormatted: string;
};

export type InvoiceSummary = {
  id: string;
  invoiceNumber: string;
  patient: { id: string; name: string; patientNumber: string } | null;
  appointmentId: string | null;
  items: InvoiceLine[];
  currency: string;

  subtotalMinor: number;
  discountType: DiscountType;
  discountValue: number;
  discountMinor: number;
  taxRatePercent: number;
  taxMinor: number;
  totalMinor: number;

  subtotalFormatted: string;
  discountFormatted: string;
  taxFormatted: string;
  totalFormatted: string;

  /**
   * The subtotal split by what was billed. Derived from the lines on read
   * rather than stored: they must always add up to `subtotalMinor`, and two
   * stored numbers that are supposed to agree eventually will not.
   */
  doctorFeeTotalMinor: number;
  doctorFeeTotalFormatted: string;
  treatmentFeeTotalMinor: number;
  treatmentFeeTotalFormatted: string;
  otherTotalMinor: number;
  otherTotalFormatted: string;

  /** Derived from the payment ledger, never stored. */
  amountPaidMinor: number;
  amountPaidFormatted: string;
  balanceDueMinor: number;
  balanceDueFormatted: string;
  paymentStatus: PaymentStatus;

  status: InvoiceStatus;
  notes: string;
  issuedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string;
  createdAt: string;
};

export type PaymentSummary = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  patient: { id: string; name: string; patientNumber: string } | null;
  amountMinor: number;
  amount: number;
  amountFormatted: string;
  currency: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
  receivedBy: { id: string; name: string } | null;
  paidAt: string;
};

type Actor = { userId: string; hospitalId: string };

async function hospitalBillingSettings(hospitalId: string): Promise<{
  currency: string;
  defaultTaxRatePercent: number;
  invoicePrefix: string;
}> {
  const hospital = await Hospital.findById(hospitalId)
    .select("currency defaultTaxRatePercent settings.invoicePrefix")
    .lean();

  return {
    currency: hospital?.currency ?? DEFAULT_CURRENCY,
    defaultTaxRatePercent: hospital?.defaultTaxRatePercent ?? 0,
    // Tenant-configurable via hospital settings (Section 36). The counter is
    // shared regardless of prefix, so changing it cannot produce a collision.
    invoicePrefix: hospital?.settings?.invoicePrefix || "INV",
  };
}

function ref<T extends Record<string, unknown>>(value: unknown): T | null {
  return value && typeof value === "object" && "_id" in (value as object)
    ? (value as T)
    : null;
}

function paymentStatusOf(totalMinor: number, paidMinor: number): PaymentStatus {
  if (paidMinor <= 0) return "unpaid";
  if (paidMinor >= totalMinor) return "paid";
  return "partially_paid";
}

// ---------------------------------------------------------------------------
// Totals — the Section 27 calculation
// ---------------------------------------------------------------------------

type ResolvedItem = {
  kind: InvoiceLineKind;
  treatmentId: string | null;
  doctorId: string | null;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

type ComputedTotals = {
  items: ResolvedItem[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
};

/**
 * Resolves each line and computes every amount SERVER-SIDE (Section 27).
 *
 * For a catalogue line the unit price is read from the Treatment document
 * inside the caller's tenant — the request has no field to supply one, so a
 * client can neither set nor influence it. Ad-hoc lines carry an explicit price
 * because there is no catalogue entry to read, and are recorded as such.
 *
 * The resolved `unitPriceMinor` is then SNAPSHOTTED onto the invoice, so
 * re-pricing a treatment tomorrow leaves today's invoices untouched.
 */
async function computeTotals(
  items: readonly InvoiceItemInput[],
  options: {
    discountType: DiscountType;
    discountValue: number;
    taxRatePercent: number;
    currency: string;
  },
  hospitalId: string,
): Promise<ComputedTotals> {
  const resolved: ResolvedItem[] = [];

  for (const item of items) {
    if ("unitPrice" in item && item.treatmentId == null) {
      // Ad-hoc line.
      if (!hasValidPrecision(item.unitPrice, options.currency)) {
        throw ApiError.validation("That price has too many decimal places.", {
          fields: { items: `Price must match the precision of ${options.currency}.` },
        });
      }

      const unitPriceMinor = toMinorUnits(item.unitPrice, options.currency);

      resolved.push({
        kind: "adhoc",
        treatmentId: null,
        doctorId: null,
        description: item.description,
        quantity: item.quantity,
        unitPriceMinor,
        lineTotalMinor: unitPriceMinor * item.quantity,
      });
      continue;
    }

    if ("doctorId" in item && item.doctorId) {
      /**
       * The consultation fee, read from the Doctor document in this tenant —
       * never from the request. Already stored in minor units, so there is no
       * conversion and no precision question.
       */
      const doctor = await assertBelongsToTenant(
        Doctor,
        item.doctorId,
        hospitalId,
        "Doctor",
      );

      const unitPriceMinor = doctor.consultationFeeMinor;

      resolved.push({
        kind: "consultation",
        treatmentId: null,
        doctorId: String(doctor._id),
        description:
          item.description?.trim() || `Consultation — ${doctor.displayName}`,
        quantity: item.quantity,
        unitPriceMinor,
        lineTotalMinor: unitPriceMinor * item.quantity,
      });
      continue;
    }

    if (!("treatmentId" in item) || !item.treatmentId) {
      throw ApiError.validation("Each line needs a treatment or a price.", {
        fields: { items: "Invalid line." },
      });
    }

    /**
     * The authoritative price lookup. Scoped by tenant, so a treatment id from
     * another hospital resolves to nothing and 404s.
     */
    const treatment = await assertBelongsToTenant(
      Treatment,
      item.treatmentId,
      hospitalId,
      "Treatment",
    );

    const unitPriceMinor = treatment.priceMinor;

    resolved.push({
      kind: "treatment",
      treatmentId: String(treatment._id),
      doctorId: null,
      description: item.description?.trim() || treatment.name,
      quantity: item.quantity,
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor * item.quantity,
    });
  }

  const subtotalMinor = resolved.reduce(
    (total, item) => total + item.lineTotalMinor,
    0,
  );

  let discountMinor = 0;
  if (options.discountType === "fixed") {
    if (!hasValidPrecision(options.discountValue, options.currency)) {
      throw ApiError.validation("That discount has too many decimal places.", {
        fields: {
          discountValue: `Discount must match the precision of ${options.currency}.`,
        },
      });
    }
    discountMinor = toMinorUnits(options.discountValue, options.currency);
  } else if (options.discountType === "percent") {
    discountMinor = percentOfMinor(subtotalMinor, options.discountValue);
  }

  // A discount can reduce a bill to zero but never below it.
  discountMinor = Math.min(discountMinor, subtotalMinor);

  const taxableMinor = subtotalMinor - discountMinor;
  const taxMinor = percentOfMinor(taxableMinor, options.taxRatePercent);
  const totalMinor = taxableMinor + taxMinor;

  return {
    items: resolved,
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor,
  };
}

// ---------------------------------------------------------------------------
// Payment aggregation
// ---------------------------------------------------------------------------

/** Sums payments for a set of invoices in one query. */
async function sumPayments(
  invoiceIds: readonly unknown[],
  hospitalId: string,
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();

  const rows = await Payment.aggregate<{ _id: unknown; total: number }>([
    {
      $match: {
        hospitalId: new mongoose.Types.ObjectId(hospitalId),
        invoiceId: { $in: [...invoiceIds] },
      },
    },
    { $group: { _id: "$invoiceId", total: { $sum: "$amountMinor" } } },
  ]);

  return new Map(rows.map((row) => [String(row._id), row.total]));
}

function toInvoiceSummary(
  invoice: Record<string, unknown> & {
    _id: unknown;
    invoiceNumber: string;
    patientId: unknown;
    items: Array<{
      _id: unknown;
      kind?: string | null;
      treatmentId?: unknown;
      doctorId?: unknown;
      description: string;
      quantity: number;
      unitPriceMinor: number;
      lineTotalMinor: number;
    }>;
    subtotalMinor: number;
    discountType: string;
    discountValue: number;
    discountMinor: number;
    taxRatePercent: number;
    taxMinor: number;
    totalMinor: number;
    status: string;
    createdAt: Date;
  },
  currency: string,
  amountPaidMinor: number,
): InvoiceSummary {
  const patient = ref<{
    _id: unknown;
    firstName: string;
    lastName: string;
    patientNumber: string;
  }>(invoice.patientId);

  const balanceDueMinor = Math.max(0, invoice.totalMinor - amountPaidMinor);

  const items: InvoiceLine[] = invoice.items.map((item) => ({
    id: String(item._id),
    /**
     * Falls back for lines written before `kind` existed. A treatment line is
     * recoverable from its reference; anything else is called ad-hoc rather
     * than guessed at from the description text.
     */
    kind: (item.kind as InvoiceLineKind | undefined) ??
      (item.treatmentId ? "treatment" : "adhoc"),
    treatmentId: item.treatmentId ? String(item.treatmentId) : null,
    doctorId: item.doctorId ? String(item.doctorId) : null,
    description: item.description,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    unitPrice: toMajorUnits(item.unitPriceMinor, currency),
    unitPriceFormatted: formatMoney(item.unitPriceMinor, currency),
    lineTotalMinor: item.lineTotalMinor,
    lineTotalFormatted: formatMoney(item.lineTotalMinor, currency),
  }));

  const totalOf = (kind: InvoiceLineKind): number =>
    items
      .filter((item) => item.kind === kind)
      .reduce((sum, item) => sum + item.lineTotalMinor, 0);

  const doctorFeeTotalMinor = totalOf("consultation");
  const treatmentFeeTotalMinor = totalOf("treatment");
  const otherTotalMinor = totalOf("adhoc");

  return {
    id: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    patient: patient
      ? {
          id: String(patient._id),
          name: `${patient.firstName} ${patient.lastName}`.trim(),
          patientNumber: patient.patientNumber,
        }
      : null,
    appointmentId: invoice.appointmentId ? String(invoice.appointmentId) : null,
    items,
    currency,

    subtotalMinor: invoice.subtotalMinor,
    discountType: invoice.discountType as DiscountType,
    discountValue: invoice.discountValue,
    discountMinor: invoice.discountMinor,
    taxRatePercent: invoice.taxRatePercent,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,

    subtotalFormatted: formatMoney(invoice.subtotalMinor, currency),
    discountFormatted: formatMoney(invoice.discountMinor, currency),
    taxFormatted: formatMoney(invoice.taxMinor, currency),
    totalFormatted: formatMoney(invoice.totalMinor, currency),

    doctorFeeTotalMinor,
    doctorFeeTotalFormatted: formatMoney(doctorFeeTotalMinor, currency),
    treatmentFeeTotalMinor,
    treatmentFeeTotalFormatted: formatMoney(treatmentFeeTotalMinor, currency),
    otherTotalMinor,
    otherTotalFormatted: formatMoney(otherTotalMinor, currency),

    amountPaidMinor,
    amountPaidFormatted: formatMoney(amountPaidMinor, currency),
    balanceDueMinor,
    balanceDueFormatted: formatMoney(balanceDueMinor, currency),
    paymentStatus: paymentStatusOf(invoice.totalMinor, amountPaidMinor),

    status: invoice.status as InvoiceStatus,
    notes: (invoice.notes as string) ?? "",
    issuedAt: invoice.issuedAt ? (invoice.issuedAt as Date).toISOString() : null,
    cancelledAt: invoice.cancelledAt
      ? (invoice.cancelledAt as Date).toISOString()
      : null,
    cancellationReason: (invoice.cancellationReason as string) ?? "",
    createdAt: invoice.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Invoice reads
// ---------------------------------------------------------------------------

export async function listInvoices(
  hospitalId: string,
  params: {
    page: number;
    pageSize: number;
    search?: string;
    patientId?: string;
    status?: InvoiceStatus;
    paymentStatus?: PaymentStatus;
  },
): Promise<Paginated<InvoiceSummary>> {
  await connectToDatabase();

  const filter = tenantScoped(hospitalId, {
    ...(params.status ? { status: params.status } : {}),
    ...(params.patientId ? { patientId: params.patientId } : {}),
    ...(params.search ? { invoiceNumber: regexSearch(params.search) } : {}),
  });

  const [invoices, total, settings] = await Promise.all([
    Invoice.find(filter)
      .sort({ createdAt: -1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .populate("patientId", "firstName lastName patientNumber")
      .lean(),
    Invoice.countDocuments(filter),
    hospitalBillingSettings(hospitalId),
  ]);

  const paid = await sumPayments(
    invoices.map((invoice) => invoice._id),
    hospitalId,
  );

  let items = invoices.map((invoice) =>
    toInvoiceSummary(
      invoice as never,
      settings.currency,
      paid.get(String(invoice._id)) ?? 0,
    ),
  );

  /**
   * Payment status is derived, so it cannot be a database filter without
   * denormalising it — which is precisely the drift this design avoids. It is
   * applied to the page instead, and the caveat is documented on the endpoint.
   */
  if (params.paymentStatus) {
    items = items.filter(
      (invoice) => invoice.paymentStatus === params.paymentStatus,
    );
  }

  return { items, ...paginationMeta(params, total) };
}

export async function getInvoice(
  invoiceId: string,
  hospitalId: string,
): Promise<InvoiceSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(Invoice, invoiceId, hospitalId, "Invoice");

  const [invoice, settings] = await Promise.all([
    Invoice.findOne(tenantScoped(hospitalId, { _id: invoiceId }))
      .populate("patientId", "firstName lastName patientNumber")
      .lean(),
    hospitalBillingSettings(hospitalId),
  ]);

  if (!invoice) throw ApiError.notFound("Invoice not found.");

  const paid = await sumPayments([invoice._id], hospitalId);

  return toInvoiceSummary(
    invoice as never,
    settings.currency,
    paid.get(String(invoice._id)) ?? 0,
  );
}

// ---------------------------------------------------------------------------
// What a patient currently owes but has not been billed for
// ---------------------------------------------------------------------------

/** One proposed line, priced from the database. */
export type BillableCharge = {
  /** The encounter it came from, so the accountant can see what it is for. */
  appointmentId: string;
  appointmentDate: string;
  kind: Extract<InvoiceLineKind, "treatment" | "consultation">;
  /** Exactly one of these is set, matching `kind`. */
  treatmentId: string | null;
  doctorId: string | null;
  description: string;
  unitPriceMinor: number;
  unitPriceFormatted: string;
};

/** A charge that is already on an invoice, shown for context but not billed. */
export type BilledCharge = BillableCharge & {
  invoiceId: string;
  invoiceNumber: string;
};

export type PatientBillableCharges = {
  patient: { id: string; name: string; patientNumber: string };
  currency: string;
  defaultTaxRatePercent: number;
  /** Consultation fees, one per attended appointment. */
  doctorFees: BillableCharge[];
  /** Catalogue treatments booked on those appointments. */
  treatmentFees: BillableCharge[];
  doctorFeeTotalMinor: number;
  doctorFeeTotalFormatted: string;
  treatmentFeeTotalMinor: number;
  treatmentFeeTotalFormatted: string;
  subtotalMinor: number;
  subtotalFormatted: string;
  /**
   * The rest of the patient's history — charges already on an invoice.
   *
   * Returned so the accountant sees the patient's whole picture and can tell
   * "there is nothing else to bill" from "the data is missing". Deliberately
   * NOT part of any total above: adding them would bill the patient twice.
   */
  alreadyBilled: BilledCharge[];
  alreadyBilledTotalMinor: number;
  alreadyBilledTotalFormatted: string;
};

/**
 * Everything a patient has been treated for and NOT yet billed.
 *
 * This is what turns "select the patient" into a finished invoice: the
 * accountant should not have to read the patient's history and retype it, nor
 * know which doctor saw them or what a consultation costs.
 *
 * Scope is deliberately narrow in two ways:
 *
 *   - COMPLETED appointments only. Billing for care that has not been delivered
 *     — a booking still scheduled, or cancelled, or a no-show — is wrong.
 *   - Appointments with NO invoice against them. An appointment already carries
 *     at most one invoice (auto-raised on completion, see
 *     generateInvoiceForCompletedAppointment), so excluding those is what stops
 *     a patient being billed twice for the same visit.
 *
 * Prices come from the Doctor and Treatment documents, exactly as
 * `computeTotals` reads them when the invoice is actually written — so the
 * figures previewed here are the figures billed.
 */
export async function getBillableChargesForPatient(
  patientId: string,
  hospitalId: string,
): Promise<PatientBillableCharges> {
  await connectToDatabase();

  const patient = await assertBelongsToTenant(
    Patient,
    patientId,
    hospitalId,
    "Patient",
  );

  const settings = await hospitalBillingSettings(hospitalId);

  const appointments = await Appointment.find(
    tenantScoped(hospitalId, { patientId, status: "completed" }),
  )
    .select("appointmentDate startMinutes doctorId treatmentId")
    .sort({ appointmentDate: 1, startMinutes: 1 })
    .limit(200)
    .lean();

  if (appointments.length === 0) {
    return emptyCharges(patient, settings);
  }

  // One query rather than one per appointment: which of these are billed already.
  const invoiced = await Invoice.find(
    tenantScoped(hospitalId, {
      appointmentId: mongoose.trusted({
        $in: appointments.map((appointment) => appointment._id),
      }),
      // A cancelled invoice does not count as billed — the charge is owed again.
      status: mongoose.trusted({ $ne: "cancelled" }),
    }),
  )
    .select("appointmentId invoiceNumber")
    .lean();

  const invoiceByAppointment = new Map(
    invoiced.map((invoice) => [String(invoice.appointmentId), invoice]),
  );

  // Batch the two price lookups, still scoped to this tenant.
  const [doctors, treatments] = await Promise.all([
    Doctor.find(
      tenantScoped(hospitalId, {
        _id: mongoose.trusted({
          $in: appointments.map((a) => a.doctorId).filter(Boolean),
        }),
      }),
    )
      .select("displayName consultationFeeMinor")
      .lean(),
    Treatment.find(
      tenantScoped(hospitalId, {
        _id: mongoose.trusted({
          $in: appointments.map((a) => a.treatmentId).filter(Boolean),
        }),
      }),
    )
      .select("name priceMinor")
      .lean(),
  ]);

  const doctorById = new Map(doctors.map((d) => [String(d._id), d]));
  const treatmentById = new Map(treatments.map((t) => [String(t._id), t]));

  const doctorFees: BillableCharge[] = [];
  const treatmentFees: BillableCharge[] = [];
  const alreadyBilled: BilledCharge[] = [];

  for (const appointment of appointments) {
    const invoice = invoiceByAppointment.get(String(appointment._id));

    /** Routes a charge to the bill, or to the "already invoiced" list. */
    const record = (charge: BillableCharge): void => {
      if (invoice) {
        alreadyBilled.push({
          ...charge,
          invoiceId: String(invoice._id),
          invoiceNumber: invoice.invoiceNumber,
        });
      } else if (charge.kind === "consultation") {
        doctorFees.push(charge);
      } else {
        treatmentFees.push(charge);
      }
    };

    const doctor = doctorById.get(String(appointment.doctorId));
    /**
     * A zero consultation fee is a legitimate configuration, not a missing
     * one — the same rule the auto-generated invoice follows. Proposing a ₹0
     * line would just be noise on the invoice.
     */
    if (doctor && doctor.consultationFeeMinor > 0) {
      record({
        appointmentId: String(appointment._id),
        appointmentDate: appointment.appointmentDate,
        kind: "consultation",
        treatmentId: null,
        doctorId: String(doctor._id),
        description: `Consultation — ${doctor.displayName}`,
        unitPriceMinor: doctor.consultationFeeMinor,
        unitPriceFormatted: formatMoney(
          doctor.consultationFeeMinor,
          settings.currency,
        ),
      });
    }

    const treatment = appointment.treatmentId
      ? treatmentById.get(String(appointment.treatmentId))
      : undefined;

    if (treatment) {
      record({
        appointmentId: String(appointment._id),
        appointmentDate: appointment.appointmentDate,
        kind: "treatment",
        treatmentId: String(treatment._id),
        doctorId: null,
        description: treatment.name,
        unitPriceMinor: treatment.priceMinor,
        unitPriceFormatted: formatMoney(treatment.priceMinor, settings.currency),
      });
    }
  }

  const sum = (charges: readonly BillableCharge[]): number =>
    charges.reduce((total, charge) => total + charge.unitPriceMinor, 0);

  const doctorFeeTotalMinor = sum(doctorFees);
  const treatmentFeeTotalMinor = sum(treatmentFees);
  const subtotalMinor = doctorFeeTotalMinor + treatmentFeeTotalMinor;
  const alreadyBilledTotalMinor = sum(alreadyBilled);

  return {
    patient: {
      id: String(patient._id),
      name: `${patient.firstName} ${patient.lastName}`.trim(),
      patientNumber: patient.patientNumber,
    },
    currency: settings.currency,
    defaultTaxRatePercent: settings.defaultTaxRatePercent,
    doctorFees,
    treatmentFees,
    doctorFeeTotalMinor,
    doctorFeeTotalFormatted: formatMoney(doctorFeeTotalMinor, settings.currency),
    treatmentFeeTotalMinor,
    treatmentFeeTotalFormatted: formatMoney(
      treatmentFeeTotalMinor,
      settings.currency,
    ),
    subtotalMinor,
    subtotalFormatted: formatMoney(subtotalMinor, settings.currency),
    alreadyBilled,
    alreadyBilledTotalMinor,
    alreadyBilledTotalFormatted: formatMoney(
      alreadyBilledTotalMinor,
      settings.currency,
    ),
  };
}

function emptyCharges(
  patient: { _id: unknown; firstName: string; lastName: string; patientNumber: string },
  settings: { currency: string; defaultTaxRatePercent: number },
): PatientBillableCharges {
  const zero = formatMoney(0, settings.currency);
  return {
    patient: {
      id: String(patient._id),
      name: `${patient.firstName} ${patient.lastName}`.trim(),
      patientNumber: patient.patientNumber,
    },
    currency: settings.currency,
    defaultTaxRatePercent: settings.defaultTaxRatePercent,
    doctorFees: [],
    treatmentFees: [],
    doctorFeeTotalMinor: 0,
    doctorFeeTotalFormatted: zero,
    treatmentFeeTotalMinor: 0,
    treatmentFeeTotalFormatted: zero,
    subtotalMinor: 0,
    subtotalFormatted: zero,
    alreadyBilled: [],
    alreadyBilledTotalMinor: 0,
    alreadyBilledTotalFormatted: zero,
  };
}

// ---------------------------------------------------------------------------
// Invoice writes
// ---------------------------------------------------------------------------

export async function createInvoice(
  input: CreateInvoiceInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<InvoiceSummary> {
  await connectToDatabase();

  const patient = await assertBelongsToTenant(
    Patient,
    input.patientId,
    actor.hospitalId,
    "Patient",
  );

  let appointmentId: string | null = null;
  if (input.appointmentId) {
    const appointment = await assertBelongsToTenant(
      Appointment,
      input.appointmentId,
      actor.hospitalId,
      "Appointment",
    );

    if (String(appointment.patientId) !== String(patient._id)) {
      throw ApiError.validation(
        "That appointment belongs to a different patient.",
        { fields: { appointmentId: "Appointment is for another patient." } },
      );
    }
    appointmentId = String(appointment._id);
  }

  const settings = await hospitalBillingSettings(actor.hospitalId);
  const taxRatePercent = input.taxRatePercent ?? settings.defaultTaxRatePercent;

  const totals = await computeTotals(
    input.items,
    {
      discountType: input.discountType,
      discountValue: input.discountValue,
      taxRatePercent,
      currency: settings.currency,
    },
    actor.hospitalId,
  );

  // Same atomic counter that backs patient numbers, so concurrent invoicing
  // cannot produce a duplicate reference.
  for (let attempt = 0; attempt < 5; attempt++) {
    const seq = await nextSequence(actor.hospitalId, "invoice");
    const invoiceNumber = formatReference(settings.invoicePrefix, seq);

    try {
      const invoice = await Invoice.create({
        hospitalId: actor.hospitalId,
        invoiceNumber,
        patientId: patient._id,
        appointmentId,
        items: totals.items,
        subtotalMinor: totals.subtotalMinor,
        discountType: input.discountType,
        discountValue: input.discountValue,
        discountMinor: totals.discountMinor,
        taxRatePercent,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        status: "draft",
        notes: input.notes,
        createdBy: actor.userId,
      });

      await recordAudit({
        hospitalId: actor.hospitalId,
        userId: actor.userId,
        action: "invoice.created",
        resource: "Invoice",
        resourceId: String(invoice._id),
        metadata: {
          invoiceNumber,
          totalMinor: totals.totalMinor,
          currency: settings.currency,
          lineCount: totals.items.length,
        },
        meta,
      });

      return getInvoice(String(invoice._id), actor.hospitalId);
    } catch (error) {
      if (isDuplicateKeyError(error)) continue;
      throw error;
    }
  }

  throw ApiError.conflict("Could not allocate an invoice number. Please try again.");
}

/**
 * Raises a DRAFT invoice for an appointment that has just been completed,
 * covering the attending doctor's consultation fee and the booked treatment.
 *
 * Returns `null` — rather than throwing — when there is nothing to bill:
 *   - an invoice already exists for this appointment (this is idempotent, so a
 *     repeated completion can never mint a second one);
 *   - the doctor has no consultation fee AND no treatment was booked, which
 *     would otherwise produce an empty invoice.
 *
 * DRAFT, deliberately. Issuing is a financial act with its own permission and
 * its own guards — an issued invoice cannot be edited or deleted, only
 * cancelled. Generating a draft leaves a human to check the lines, apply any
 * discount, and issue it.
 *
 * Note on authority: this runs as a consequence of a clinical status change, so
 * the actor is whoever completed the appointment — who may not hold
 * `invoice.create`. That is intentional. Nothing here is issued and no money
 * moves; the draft is a convenience, and every downstream financial step still
 * enforces its own permission. The audit entry records how it came about.
 */
export async function generateInvoiceForCompletedAppointment(
  appointmentId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<InvoiceSummary | null> {
  await connectToDatabase();

  const appointment = await assertBelongsToTenant(
    Appointment,
    appointmentId,
    actor.hospitalId,
    "Appointment",
  );

  const existing = await Invoice.findOne(
    tenantScoped(actor.hospitalId, { appointmentId: appointment._id }),
  )
    .select("_id")
    .lean();

  if (existing) return null;

  const items: InvoiceItemInput[] = [];

  if (appointment.doctorId) {
    const doctor = await Doctor.findOne(
      tenantScoped(actor.hospitalId, { _id: appointment.doctorId }),
    )
      .select("consultationFeeMinor")
      .lean();

    // A zero fee is a legitimate configuration — do not bill a ₹0 line for it.
    if (doctor && doctor.consultationFeeMinor > 0) {
      items.push({ doctorId: String(appointment.doctorId), quantity: 1 });
    }
  }

  if (appointment.treatmentId) {
    items.push({ treatmentId: String(appointment.treatmentId), quantity: 1 });
  }

  if (items.length === 0) return null;

  const invoice = await createInvoice(
    {
      patientId: String(appointment.patientId),
      appointmentId: String(appointment._id),
      items,
      discountType: "none",
      discountValue: 0,
      // Omitted so the hospital's own default tax rate applies.
      notes: "",
    },
    actor,
    meta,
  );

  /**
   * A second entry alongside `invoice.created`, so the trail distinguishes an
   * invoice a person chose to raise from one the system derived.
   */
  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "invoice.auto_generated",
    resource: "Invoice",
    resourceId: invoice.id,
    metadata: {
      appointmentId: String(appointment._id),
      invoiceNumber: invoice.invoiceNumber,
      totalMinor: invoice.totalMinor,
      lineCount: invoice.items.length,
    },
    meta,
  });

  return invoice;
}

/**
 * Loads a draft invoice for editing, refusing when it may no longer change.
 *
 * An issued invoice is a financial document that has left the building, and one
 * with payments against it must never be re-totalled — the ledger would no
 * longer reconcile.
 */
async function loadEditableInvoice(invoiceId: string, hospitalId: string) {
  const invoice = await Invoice.findOne(
    tenantScoped(hospitalId, { _id: invoiceId }),
  );
  if (!invoice) throw ApiError.notFound("Invoice not found.");

  if (invoice.status === "cancelled") {
    throw ApiError.conflict("A cancelled invoice cannot be edited.");
  }

  const paid = await Payment.countDocuments(
    tenantScoped(hospitalId, { invoiceId }),
  );
  if (paid > 0) {
    throw ApiError.conflict(
      "This invoice has payments recorded against it and can no longer be changed.",
    );
  }

  if (invoice.status === "issued") {
    throw ApiError.conflict(
      "This invoice has been issued. Cancel it and raise a new one instead of editing it.",
    );
  }

  return invoice;
}

export async function updateInvoice(
  invoiceId: string,
  input: UpdateInvoiceInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<InvoiceSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(Invoice, invoiceId, actor.hospitalId, "Invoice");

  const invoice = await loadEditableInvoice(invoiceId, actor.hospitalId);
  const settings = await hospitalBillingSettings(actor.hospitalId);

  const discountType = input.discountType ?? (invoice.discountType as DiscountType);
  const discountValue = input.discountValue ?? invoice.discountValue;
  const taxRatePercent = input.taxRatePercent ?? invoice.taxRatePercent;

  /**
   * Whenever anything affecting money changes, every amount is recomputed from
   * scratch — prices re-read from the database, not carried over. There is no
   * path that mutates a total directly.
   */
  if (
    input.items !== undefined ||
    input.discountType !== undefined ||
    input.discountValue !== undefined ||
    input.taxRatePercent !== undefined
  ) {
    const items: InvoiceItemInput[] =
      input.items ??
      invoice.items.map((item) =>
        item.treatmentId
          ? {
              treatmentId: String(item.treatmentId),
              quantity: item.quantity,
              description: item.description,
            }
          : {
              treatmentId: null,
              description: item.description,
              quantity: item.quantity,
              unitPrice: toMajorUnits(item.unitPriceMinor, settings.currency),
            },
      );

    const totals = await computeTotals(
      items,
      { discountType, discountValue, taxRatePercent, currency: settings.currency },
      actor.hospitalId,
    );

    invoice.set("items", totals.items);
    invoice.subtotalMinor = totals.subtotalMinor;
    invoice.discountType = discountType;
    invoice.discountValue = discountValue;
    invoice.discountMinor = totals.discountMinor;
    invoice.taxRatePercent = taxRatePercent;
    invoice.taxMinor = totals.taxMinor;
    invoice.totalMinor = totals.totalMinor;
  }

  if (input.notes !== undefined) invoice.notes = input.notes;

  await invoice.save();

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "invoice.updated",
    resource: "Invoice",
    resourceId: invoiceId,
    metadata: {
      fields: Object.keys(input),
      invoiceNumber: invoice.invoiceNumber,
      totalMinor: invoice.totalMinor,
    },
    meta,
  });

  return getInvoice(invoiceId, actor.hospitalId);
}

export async function changeInvoiceStatus(
  invoiceId: string,
  status: "issued" | "cancelled",
  cancellationReason: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<InvoiceSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(Invoice, invoiceId, actor.hospitalId, "Invoice");

  const invoice = await Invoice.findOne(
    tenantScoped(actor.hospitalId, { _id: invoiceId }),
  );
  if (!invoice) throw ApiError.notFound("Invoice not found.");

  const current = invoice.status as InvoiceStatus;

  if (current === status) return getInvoice(invoiceId, actor.hospitalId);

  if (current === "cancelled") {
    throw ApiError.conflict("A cancelled invoice cannot be reinstated.");
  }

  if (status === "issued") {
    if (invoice.items.length === 0) {
      throw ApiError.conflict("Add at least one line before issuing.");
    }
    invoice.status = "issued";
    invoice.issuedAt = new Date();
  } else {
    // Cancelling an invoice with money against it would strand those payments.
    const paid = await Payment.countDocuments(
      tenantScoped(actor.hospitalId, { invoiceId }),
    );
    if (paid > 0) {
      throw ApiError.conflict(
        "This invoice has payments recorded against it and cannot be cancelled. Record a refund instead.",
      );
    }
    invoice.status = "cancelled";
    invoice.cancelledAt = new Date();
    invoice.cancellationReason = cancellationReason;
  }

  await invoice.save();

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: `invoice.${status}`,
    resource: "Invoice",
    resourceId: invoiceId,
    metadata: { from: current, to: status, invoiceNumber: invoice.invoiceNumber },
    meta,
  });

  return getInvoice(invoiceId, actor.hospitalId);
}

export async function deleteInvoice(
  invoiceId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  await connectToDatabase();

  const invoice = await assertBelongsToTenant(
    Invoice,
    invoiceId,
    actor.hospitalId,
    "Invoice",
  );

  /**
   * Only an unissued draft may be destroyed. Once an invoice has been issued it
   * is a financial record — cancelling voids it while keeping the trail.
   */
  if (invoice.status !== "draft") {
    throw ApiError.conflict(
      "Only a draft invoice can be deleted. Cancel an issued invoice instead.",
    );
  }

  const paid = await Payment.countDocuments(
    tenantScoped(actor.hospitalId, { invoiceId }),
  );
  if (paid > 0) {
    throw ApiError.conflict(
      "This invoice has payments recorded against it and cannot be deleted.",
    );
  }

  await Invoice.deleteOne(tenantScoped(actor.hospitalId, { _id: invoiceId }));

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "invoice.deleted",
    resource: "Invoice",
    resourceId: invoiceId,
    metadata: { invoiceNumber: invoice.invoiceNumber },
    meta,
  });
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export async function recordPayment(
  input: CreatePaymentInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<PaymentSummary> {
  await connectToDatabase();

  const invoice = await assertBelongsToTenant(
    Invoice,
    input.invoiceId,
    actor.hospitalId,
    "Invoice",
  );

  if (invoice.status === "draft") {
    throw ApiError.conflict(
      "This invoice is still a draft. Issue it before recording a payment.",
    );
  }
  if (invoice.status === "cancelled") {
    throw ApiError.conflict("This invoice has been cancelled.");
  }

  const settings = await hospitalBillingSettings(actor.hospitalId);

  if (!hasValidPrecision(input.amount, settings.currency)) {
    throw ApiError.validation("That amount has too many decimal places.", {
      fields: {
        amount: `Amount must match the precision of ${settings.currency}.`,
      },
    });
  }

  const amountMinor = toMinorUnits(input.amount, settings.currency);

  /**
   * Overpayment guard.
   *
   * Computed from the ledger immediately before writing. Two simultaneous
   * payments could still both pass this check — MongoDB gives no cross-document
   * transaction here without a replica set — so the balance is re-derived on
   * every read and can legitimately show an overpayment. Reconciling that is a
   * finance decision, not something to hide.
   */
  const paidSoFar = await sumPayments([invoice._id], actor.hospitalId);
  const alreadyPaid = paidSoFar.get(String(invoice._id)) ?? 0;
  const outstanding = invoice.totalMinor - alreadyPaid;

  if (outstanding <= 0) {
    throw ApiError.conflict("This invoice is already paid in full.");
  }

  if (amountMinor > outstanding) {
    throw ApiError.validation(
      `That is more than the outstanding balance of ${formatMoney(outstanding, settings.currency)}.`,
      { fields: { amount: "Exceeds the outstanding balance." } },
    );
  }

  const payment = await Payment.create({
    hospitalId: actor.hospitalId,
    invoiceId: invoice._id,
    patientId: invoice.patientId,
    amountMinor,
    method: input.method,
    reference: input.reference,
    notes: input.notes,
    receivedBy: actor.userId,
    paidAt: new Date(),
  });

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "payment.created",
    resource: "Payment",
    resourceId: String(payment._id),
    metadata: {
      invoiceId: String(invoice._id),
      invoiceNumber: invoice.invoiceNumber,
      amountMinor,
      method: input.method,
      currency: settings.currency,
    },
    meta,
  });

  return {
    id: String(payment._id),
    invoiceId: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    patient: null,
    amountMinor,
    amount: toMajorUnits(amountMinor, settings.currency),
    amountFormatted: formatMoney(amountMinor, settings.currency),
    currency: settings.currency,
    method: input.method,
    reference: input.reference,
    notes: input.notes,
    receivedBy: null,
    paidAt: payment.paidAt.toISOString(),
  };
}

export async function listPayments(
  hospitalId: string,
  params: {
    page: number;
    pageSize: number;
    invoiceId?: string;
    patientId?: string;
    method?: PaymentMethod;
  },
): Promise<Paginated<PaymentSummary>> {
  await connectToDatabase();

  const filter = tenantScoped(hospitalId, {
    ...(params.invoiceId ? { invoiceId: params.invoiceId } : {}),
    ...(params.patientId ? { patientId: params.patientId } : {}),
    ...(params.method ? { method: params.method } : {}),
  });

  const [payments, total, settings] = await Promise.all([
    Payment.find(filter)
      .sort({ paidAt: -1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .populate("invoiceId", "invoiceNumber")
      .populate("patientId", "firstName lastName patientNumber")
      .populate("receivedBy", "name")
      .lean(),
    Payment.countDocuments(filter),
    hospitalBillingSettings(hospitalId),
  ]);

  return {
    items: payments.map((payment) => {
      const invoice = ref<{ _id: unknown; invoiceNumber: string }>(
        payment.invoiceId,
      );
      const patient = ref<{
        _id: unknown;
        firstName: string;
        lastName: string;
        patientNumber: string;
      }>(payment.patientId);
      const receiver = ref<{ _id: unknown; name: string }>(payment.receivedBy);

      return {
        id: String(payment._id),
        invoiceId: String(invoice?._id ?? payment.invoiceId),
        invoiceNumber: invoice?.invoiceNumber ?? "",
        patient: patient
          ? {
              id: String(patient._id),
              name: `${patient.firstName} ${patient.lastName}`.trim(),
              patientNumber: patient.patientNumber,
            }
          : null,
        amountMinor: payment.amountMinor,
        amount: toMajorUnits(payment.amountMinor, settings.currency),
        amountFormatted: formatMoney(payment.amountMinor, settings.currency),
        currency: settings.currency,
        method: payment.method as PaymentMethod,
        reference: payment.reference ?? "",
        notes: payment.notes ?? "",
        receivedBy: receiver
          ? { id: String(receiver._id), name: receiver.name }
          : null,
        paidAt: payment.paidAt.toISOString(),
      };
    }),
    ...paginationMeta(params, total),
  };
}
