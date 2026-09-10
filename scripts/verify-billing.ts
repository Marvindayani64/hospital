/* eslint-disable @typescript-eslint/no-explicit-any --
 * Black-box harness: it reads arbitrary JSON envelopes from the API rather than
 * importing the app's own types, so a regression in those types cannot silently
 * make the tests pass.
 */

/**
 * Phase 7 verification — invoices, payments and billing.
 *
 * The headline claim under test is Section 51 case 15 / Section 27: invoice
 * amounts are computed server-side from the database, and a price sent by the
 * client is never honoured.
 *
 * Usage:
 *   1. npm run dev
 *   2. npm run verify:billing
 */
export {};

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

type Cookie = { value: string; path: string };

class Jar {
  private cookies = new Map<string, Cookie>();

  absorb(response: Response): void {
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split("; ");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      const pathAttr = attrs.find((a) => a.toLowerCase().startsWith("path="));
      const maxAge = attrs.find((a) => a.toLowerCase().startsWith("max-age="));
      if (value === "" || maxAge?.endsWith("=0")) this.cookies.delete(name);
      else this.cookies.set(name, { value, path: pathAttr ? pathAttr.slice(5) : "/" });
    }
  }

  header(path: string): string {
    return [...this.cookies.entries()]
      .filter(([, c]) => path.startsWith(c.path))
      .map(([n, c]) => `${n}=${c.value}`)
      .join("; ");
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)?.value;
  }
}

async function call(
  path: string,
  options: { method?: string; body?: unknown; jar?: Jar } = {},
) {
  const { method = "GET", body, jar } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (jar) {
    const cookie = jar.header(path);
    if (cookie) headers.Cookie = cookie;
    const csrf = jar.get("csrf_token");
    if (csrf && method !== "GET") headers["x-csrf-token"] = csrf;
  }

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });

  if (jar) jar.absorb(response);

  let json: any = null;
  try {
    json = await response.json();
  } catch {
    /* HTML response */
  }

  return { status: response.status, json };
}

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function signIn(email: string, password: string): Promise<Jar> {
  const jar = new Jar();
  await call("/login", { jar });
  const result = await call("/api/auth/login", {
    method: "POST",
    body: { email, password },
    jar,
  });
  if (result.status !== 200) {
    throw new Error(`Login failed for ${email}: ${result.status}`);
  }
  return jar;
}

function futureDate(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

type Tenant = {
  jar: Jar;
  patientId: string;
  treatmentId: string;
  cheapTreatmentId: string;
  departmentId: string;
  doctorId: string;
  /** The doctor's consultation fee, in minor units. */
  consultationFeeMinor: number;
};

async function buildTenant(
  superJar: Jar,
  label: string,
  stamp: number,
  taxRate: number,
): Promise<Tenant> {
  const adminEmail = `admin.${label.toLowerCase()}.${stamp}@example.test`;

  const created = await call("/api/super-admin/hospitals", {
    method: "POST",
    body: {
      name: `${label} Billing Clinic ${stamp}`,
      type: "clinic",
      email: `contact.${label.toLowerCase()}.${stamp}@example.test`,
      phone: "+15550100",
      status: "active",
      currency: "USD",
      adminName: `${label} Admin`,
      adminEmail,
    },
    jar: superJar,
  });

  if (created.status !== 201) {
    throw new Error(`Could not create ${label}: ${created.status}`);
  }

  const temp = created.json.data.temporaryPassword as string;
  const password = `Billing${label}!2024`;
  const jar = await signIn(adminEmail, temp);
  await call("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword: temp, newPassword: password, confirmPassword: password },
    jar,
  });

  // The hospital's tax rate is set by the platform admin at onboarding.
  await call(`/api/super-admin/hospitals/${created.json.data.hospital.id}`, {
    method: "PATCH",
    body: { defaultTaxRatePercent: taxRate },
    jar: superJar,
  });

  const department = await call("/api/departments", {
    method: "POST",
    body: { name: `General ${label}` },
    jar,
  });
  const treatment = await call("/api/treatments", {
    method: "POST",
    body: {
      departmentId: department.json.data.id,
      name: `Consultation ${label}`,
      price: 150,
      durationMinutes: 30,
    },
    jar,
  });
  const cheap = await call("/api/treatments", {
    method: "POST",
    body: {
      departmentId: department.json.data.id,
      name: `Dressing ${label}`,
      price: 10.1,
      durationMinutes: 10,
    },
    jar,
  });
  const patient = await call("/api/patients", {
    method: "POST",
    body: { firstName: label, lastName: "Payer", phone: "+919876500200" },
    jar,
  });

  // A doctor with a real consultation fee, so doctor fees can be billed apart
  // from treatment fees.
  const doctor = await call("/api/doctors", {
    method: "POST",
    body: {
      displayName: `Dr. ${label}`,
      departmentIds: [department.json.data.id],
      consultationFee: 40,
    },
    jar,
  });

  return {
    jar,
    patientId: patient.json.data.id,
    treatmentId: treatment.json.data.id,
    cheapTreatmentId: cheap.json.data.id,
    departmentId: department.json.data.id,
    doctorId: doctor.json.data.id,
    consultationFeeMinor: 4000,
  };
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });

  const stamp = Date.now();
  const superJar = await signIn(
    process.env.SUPER_ADMIN_EMAIL ?? "superadmin@platform.local",
    process.env.SUPER_ADMIN_PASSWORD ?? "ChangeMe!2024",
  );

  section("Setup");
  const alpha = await buildTenant(superJar, "Alpha", stamp, 10);
  const beta = await buildTenant(superJar, "Beta", stamp, 0);
  check("Two hospitals configured", Boolean(alpha.treatmentId && beta.treatmentId));

  // -------------------------------------------------------------------------
  section("Field-wise charges for a patient (doctor fees vs treatment fees)");

  /** Books an appointment and completes it, so it becomes billable care. */
  async function attendedAppointment(
    tenant: Tenant,
    date: string,
    startTime: string,
    endTime: string,
    treatmentId: string | null,
  ): Promise<string> {
    const booked = await call("/api/appointments", {
      method: "POST",
      body: {
        patientId: tenant.patientId,
        doctorId: tenant.doctorId,
        departmentId: tenant.departmentId,
        treatmentId,
        appointmentDate: date,
        startTime,
        endTime,
      },
      jar: tenant.jar,
    });
    if (booked.status !== 201) {
      throw new Error(
        `Could not book: ${booked.status} ${JSON.stringify(booked.json?.error ?? "")}`,
      );
    }
    const id = booked.json.data.id as string;

    await call(`/api/appointments/${id}`, {
      method: "PUT",
      body: { status: "checked_in" },
      jar: tenant.jar,
    });
    await call(`/api/appointments/${id}`, {
      method: "PUT",
      body: { status: "completed" },
      jar: tenant.jar,
    });
    return id;
  }

  const attendedOne = await attendedAppointment(
    alpha,
    futureDate(1),
    "09:00",
    "09:30",
    alpha.treatmentId,
  );

  /**
   * Completing an appointment auto-raises a draft invoice, so that encounter is
   * already billed. It must therefore NOT be offered again — this is the check
   * that stops a patient being charged twice for one visit.
   */
  const afterAuto = await call(
    `/api/patients/${alpha.patientId}/billable-charges`,
    { jar: alpha.jar },
  );
  check(
    "Charges readable",
    afterAuto.status === 200,
    `got ${afterAuto.status} ${JSON.stringify(afterAuto.json?.error ?? "")}`,
  );
  check(
    "An appointment already auto-invoiced is not offered for billing again",
    (afterAuto.json.data.doctorFees as any[]).length === 0 &&
      (afterAuto.json.data.treatmentFees as any[]).length === 0,
    JSON.stringify({
      doctor: afterAuto.json?.data?.doctorFees,
      treatment: afterAuto.json?.data?.treatmentFees,
    }),
  );
  check(
    "It is still reported as already invoiced, for context",
    (afterAuto.json.data.alreadyBilled as any[]).some(
      (c) => c.appointmentId === attendedOne,
    ),
    JSON.stringify(afterAuto.json?.data?.alreadyBilled),
  );
  check(
    "Already-billed charges are excluded from the billable subtotal",
    afterAuto.json.data.subtotalMinor === 0 &&
      afterAuto.json.data.alreadyBilledTotalMinor > 0,
    `subtotal ${afterAuto.json?.data?.subtotalMinor}, billed ${afterAuto.json?.data?.alreadyBilledTotalMinor}`,
  );

  /**
   * Cancelling that invoice makes the care owed again — the charge must come
   * back into the billable list rather than vanishing.
   */
  const autoInvoiceId = (afterAuto.json.data.alreadyBilled as any[])[0]
    ?.invoiceId as string;
  await call(`/api/invoices/${autoInvoiceId}`, {
    method: "PUT",
    body: { status: "cancelled", cancellationReason: "Raised in error" },
    jar: alpha.jar,
  });

  const afterCancel = await call(
    `/api/patients/${alpha.patientId}/billable-charges`,
    { jar: alpha.jar },
  );
  check(
    "Cancelling the invoice returns the charges to the billable list",
    (afterCancel.json.data.doctorFees as any[]).length === 1 &&
      (afterCancel.json.data.treatmentFees as any[]).length === 1,
    JSON.stringify({
      doctor: afterCancel.json?.data?.doctorFees,
      treatment: afterCancel.json?.data?.treatmentFees,
    }),
  );
  check(
    "Doctor fee is priced from the doctor's profile, not the catalogue",
    afterCancel.json.data.doctorFeeTotalMinor === alpha.consultationFeeMinor,
    `${afterCancel.json?.data?.doctorFeeTotalMinor} vs ${alpha.consultationFeeMinor}`,
  );
  check(
    "Treatment fee is priced from the catalogue (150.00 -> 15000)",
    afterCancel.json.data.treatmentFeeTotalMinor === 15000,
    String(afterCancel.json?.data?.treatmentFeeTotalMinor),
  );
  check(
    "The two field-wise totals add up to the subtotal",
    afterCancel.json.data.subtotalMinor ===
      afterCancel.json.data.doctorFeeTotalMinor +
        afterCancel.json.data.treatmentFeeTotalMinor,
    `${afterCancel.json?.data?.subtotalMinor}`,
  );

  /**
   * The whole point: hand those proposed charges straight back as an invoice.
   * The accountant sends references only, and the server prices them.
   */
  const fromCharges = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [
        ...(afterCancel.json.data.doctorFees as any[]).map((c) => ({
          doctorId: c.doctorId,
          quantity: 1,
        })),
        ...(afterCancel.json.data.treatmentFees as any[]).map((c) => ({
          treatmentId: c.treatmentId,
          quantity: 1,
        })),
      ],
    },
    jar: alpha.jar,
  });
  check(
    "An invoice can be raised directly from the proposed charges",
    fromCharges.status === 201,
    `got ${fromCharges.status} ${JSON.stringify(fromCharges.json?.error ?? "")}`,
  );
  check(
    "Its subtotal matches what the accountant was shown",
    fromCharges.json.data.subtotalMinor === afterCancel.json.data.subtotalMinor,
    `${fromCharges.json?.data?.subtotalMinor} vs ${afterCancel.json?.data?.subtotalMinor}`,
  );
  check(
    "The saved invoice keeps the doctor/treatment split",
    fromCharges.json.data.doctorFeeTotalMinor === alpha.consultationFeeMinor &&
      fromCharges.json.data.treatmentFeeTotalMinor === 15000,
    `doctor ${fromCharges.json?.data?.doctorFeeTotalMinor}, treatment ${fromCharges.json?.data?.treatmentFeeTotalMinor}`,
  );
  check(
    "Each line records what kind of charge it is",
    (fromCharges.json.data.items as any[]).some(
      (i) => i.kind === "consultation" && i.doctorId === alpha.doctorId,
    ) &&
      (fromCharges.json.data.items as any[]).some(
        (i) => i.kind === "treatment" && i.treatmentId === alpha.treatmentId,
      ),
    JSON.stringify(
      (fromCharges.json.data.items as any[]).map((i) => i.kind),
    ),
  );
  /**
   * The Section 27 guarantee, applied to consultation lines: a doctor's fee is
   * read from their profile, so a price in the request body is ignored exactly
   * as it is for catalogue treatments.
   */
  const spoofedFee = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [
        {
          doctorId: alpha.doctorId,
          quantity: 1,
          unitPrice: 1,
          unitPriceMinor: 1,
          lineTotalMinor: 1,
        },
      ],
    },
    jar: alpha.jar,
  });
  check(
    "A consultation line with a spoofed price is still accepted",
    spoofedFee.status === 201,
    `got ${spoofedFee.status} ${JSON.stringify(spoofedFee.json?.error ?? "")}`,
  );
  check(
    "Spoofed doctor fee IGNORED — the profile's fee is billed",
    spoofedFee.json.data.items[0].unitPriceMinor === alpha.consultationFeeMinor,
    `${spoofedFee.json?.data?.items?.[0]?.unitPriceMinor} vs ${alpha.consultationFeeMinor}`,
  );
  check(
    "That line is recorded as a consultation, not an ad-hoc charge",
    spoofedFee.json.data.items[0].kind === "consultation",
    spoofedFee.json?.data?.items?.[0]?.kind,
  );

  const crossTenantCharges = await call(
    `/api/patients/${beta.patientId}/billable-charges`,
    { jar: alpha.jar },
  );
  check(
    "Another hospital's patient has no billable charges here",
    crossTenantCharges.status === 404,
    `got ${crossTenantCharges.status}`,
  );

  // -------------------------------------------------------------------------
  section("Prices come from the database (test 15 / Section 27)");
  const invoice = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [{ treatmentId: alpha.treatmentId, quantity: 2 }],
    },
    jar: alpha.jar,
  });
  check("Invoice created", invoice.status === 201, `got ${invoice.status} ${JSON.stringify(invoice.json?.error ?? "")}`);
  const invoiceId = invoice.json?.data?.id as string;

  check(
    "Invoice number auto-assigned",
    /^INV-\d{6}$/.test(invoice.json?.data?.invoiceNumber ?? ""),
    invoice.json?.data?.invoiceNumber,
  );
  check(
    "Unit price read from the catalogue (150.00 -> 15000)",
    invoice.json.data.items[0].unitPriceMinor === 15000,
    String(invoice.json?.data?.items?.[0]?.unitPriceMinor),
  );
  check(
    "Line total is quantity x unit price",
    invoice.json.data.items[0].lineTotalMinor === 30000,
    String(invoice.json?.data?.items?.[0]?.lineTotalMinor),
  );
  check(
    "Subtotal computed server-side",
    invoice.json.data.subtotalMinor === 30000,
    String(invoice.json?.data?.subtotalMinor),
  );
  check(
    "Hospital's default tax rate applied (10%)",
    invoice.json.data.taxRatePercent === 10 &&
      invoice.json.data.taxMinor === 3000,
    `rate ${invoice.json?.data?.taxRatePercent} tax ${invoice.json?.data?.taxMinor}`,
  );
  check(
    "Total = subtotal - discount + tax",
    invoice.json.data.totalMinor === 33000,
    String(invoice.json?.data?.totalMinor),
  );
  check(
    "Description copied from the treatment",
    invoice.json.data.items[0].description === `Consultation Alpha`,
    invoice.json?.data?.items?.[0]?.description,
  );

  /**
   * THE test: a client tries to dictate the price. The schema has no field for
   * it on a catalogue line, so the smuggled values must be ignored entirely and
   * the database price used instead.
   */
  const spoofed = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [
        {
          treatmentId: alpha.treatmentId,
          quantity: 1,
          // Every plausible name an attacker might try.
          price: 1,
          unitPrice: 1,
          unitPriceMinor: 1,
          lineTotalMinor: 1,
        },
      ],
      // And an attempt to dictate the totals directly.
      subtotalMinor: 1,
      taxMinor: 0,
      totalMinor: 1,
      total: 1,
    },
    jar: alpha.jar,
  });
  check(
    "An invoice with spoofed prices is still accepted",
    spoofed.status === 201,
    `got ${spoofed.status}`,
  );
  check(
    "Spoofed unit price IGNORED — catalogue price used",
    spoofed.json.data.items[0].unitPriceMinor === 15000,
    `got ${spoofed.json?.data?.items?.[0]?.unitPriceMinor}, expected 15000`,
  );
  check(
    "Spoofed subtotal IGNORED — computed from lines",
    spoofed.json.data.subtotalMinor === 15000,
    String(spoofed.json?.data?.subtotalMinor),
  );
  check(
    "Spoofed total IGNORED — computed server-side",
    spoofed.json.data.totalMinor === 16500,
    String(spoofed.json?.data?.totalMinor),
  );

  // -------------------------------------------------------------------------
  section("Price snapshots survive catalogue changes");
  const beforeRepricing = await call(`/api/invoices/${invoiceId}`, {
    jar: alpha.jar,
  });
  const originalTotal = beforeRepricing.json.data.totalMinor;

  const reprice = await call(`/api/treatments/${alpha.treatmentId}`, {
    method: "PATCH",
    body: { price: 999 },
    jar: alpha.jar,
  });
  check("Treatment re-priced", reprice.status === 200, `got ${reprice.status}`);

  const afterRepricing = await call(`/api/invoices/${invoiceId}`, {
    jar: alpha.jar,
  });
  check(
    "An existing invoice keeps its snapshotted price",
    afterRepricing.json.data.items[0].unitPriceMinor === 15000 &&
      afterRepricing.json.data.totalMinor === originalTotal,
    `unit ${afterRepricing.json?.data?.items?.[0]?.unitPriceMinor}, total ${afterRepricing.json?.data?.totalMinor}`,
  );

  const newInvoice = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [{ treatmentId: alpha.treatmentId, quantity: 1 }],
    },
    jar: alpha.jar,
  });
  check(
    "A NEW invoice picks up the new catalogue price",
    newInvoice.json.data.items[0].unitPriceMinor === 99900,
    String(newInvoice.json?.data?.items?.[0]?.unitPriceMinor),
  );

  // Restore for later assertions.
  await call(`/api/treatments/${alpha.treatmentId}`, {
    method: "PATCH",
    body: { price: 150 },
    jar: alpha.jar,
  });

  // -------------------------------------------------------------------------
  section("Discounts and tax");
  const percentDiscount = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [{ treatmentId: alpha.treatmentId, quantity: 1 }],
      discountType: "percent",
      discountValue: 20,
      taxRatePercent: 0,
    },
    jar: alpha.jar,
  });
  check(
    "Percentage discount computed server-side (20% of 150.00 = 30.00)",
    percentDiscount.json.data.discountMinor === 3000 &&
      percentDiscount.json.data.totalMinor === 12000,
    `discount ${percentDiscount.json?.data?.discountMinor}, total ${percentDiscount.json?.data?.totalMinor}`,
  );

  const fixedDiscount = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [{ treatmentId: alpha.treatmentId, quantity: 1 }],
      discountType: "fixed",
      discountValue: 25.5,
      taxRatePercent: 0,
    },
    jar: alpha.jar,
  });
  check(
    "Fixed discount converted to minor units (25.50 -> 2550)",
    fixedDiscount.json.data.discountMinor === 2550 &&
      fixedDiscount.json.data.totalMinor === 12450,
    `discount ${fixedDiscount.json?.data?.discountMinor}`,
  );

  const overDiscount = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [{ treatmentId: alpha.treatmentId, quantity: 1 }],
      discountType: "fixed",
      discountValue: 5000,
      taxRatePercent: 0,
    },
    jar: alpha.jar,
  });
  check(
    "A discount larger than the bill floors the total at zero, never negative",
    overDiscount.json.data.totalMinor === 0 &&
      overDiscount.json.data.discountMinor === 15000,
    `total ${overDiscount.json?.data?.totalMinor}`,
  );

  const overPercent = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [{ treatmentId: alpha.treatmentId, quantity: 1 }],
      discountType: "percent",
      discountValue: 150,
    },
    jar: alpha.jar,
  });
  check(
    "A percentage discount above 100% is rejected",
    overPercent.status === 422,
    `got ${overPercent.status}`,
  );

  // Tax applies AFTER the discount, not to the gross subtotal.
  const taxAfterDiscount = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [{ treatmentId: alpha.treatmentId, quantity: 1 }],
      discountType: "percent",
      discountValue: 50,
      taxRatePercent: 10,
    },
    jar: alpha.jar,
  });
  check(
    "Tax is applied to the discounted amount (10% of 75.00 = 7.50)",
    taxAfterDiscount.json.data.taxMinor === 750 &&
      taxAfterDiscount.json.data.totalMinor === 8250,
    `tax ${taxAfterDiscount.json?.data?.taxMinor}, total ${taxAfterDiscount.json?.data?.totalMinor}`,
  );

  // Integer arithmetic: three lines that would drift as floats.
  const driftInvoice = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [{ treatmentId: alpha.cheapTreatmentId, quantity: 3 }],
      taxRatePercent: 0,
    },
    jar: alpha.jar,
  });
  check(
    "Repeated cents sum exactly (10.10 x 3 = 30.30, not 30.299999…)",
    driftInvoice.json.data.totalMinor === 3030 &&
      driftInvoice.json.data.totalFormatted === "$30.30",
    `${driftInvoice.json?.data?.totalMinor} / ${driftInvoice.json?.data?.totalFormatted}`,
  );

  // -------------------------------------------------------------------------
  section("Invoice lifecycle");
  const draftPayment = await call("/api/payments", {
    method: "POST",
    body: { invoiceId, amount: 10, method: "cash" },
    jar: alpha.jar,
  });
  check(
    "A draft invoice cannot receive payments",
    draftPayment.status === 409,
    `got ${draftPayment.status}`,
  );

  const issued = await call(`/api/invoices/${invoiceId}`, {
    method: "PUT",
    body: { status: "issued" },
    jar: alpha.jar,
  });
  check("Invoice issued", issued.status === 200, `got ${issued.status}`);
  check("Issued invoice records issuedAt", Boolean(issued.json.data.issuedAt));

  const editIssued = await call(`/api/invoices/${invoiceId}`, {
    method: "PATCH",
    body: { notes: "Trying to edit an issued invoice" },
    jar: alpha.jar,
  });
  check(
    "An issued invoice cannot be edited",
    editIssued.status === 409,
    `got ${editIssued.status}`,
  );

  const deleteIssued = await call(`/api/invoices/${invoiceId}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "An issued invoice cannot be deleted",
    deleteIssued.status === 409,
    `got ${deleteIssued.status}`,
  );

  // -------------------------------------------------------------------------
  section("Payments");
  const partial = await call("/api/payments", {
    method: "POST",
    body: {
      invoiceId,
      amount: 100,
      method: "card",
      reference: "TXN-12345",
    },
    jar: alpha.jar,
  });
  check("Partial payment recorded", partial.status === 201, `got ${partial.status}`);

  const afterPartial = await call(`/api/invoices/${invoiceId}`, {
    jar: alpha.jar,
  });
  check(
    "Amount paid derived from the ledger",
    afterPartial.json.data.amountPaidMinor === 10000,
    String(afterPartial.json?.data?.amountPaidMinor),
  );
  check(
    "Balance due = total - paid",
    afterPartial.json.data.balanceDueMinor === 23000,
    String(afterPartial.json?.data?.balanceDueMinor),
  );
  check(
    "Payment status derived as partially_paid",
    afterPartial.json.data.paymentStatus === "partially_paid",
    afterPartial.json?.data?.paymentStatus,
  );

  const overpay = await call("/api/payments", {
    method: "POST",
    body: { invoiceId, amount: 5000, method: "cash" },
    jar: alpha.jar,
  });
  check(
    "A payment above the outstanding balance is rejected",
    overpay.status === 422,
    `got ${overpay.status}`,
  );

  const editAfterPayment = await call(`/api/invoices/${invoiceId}`, {
    method: "PATCH",
    body: { taxRatePercent: 0 },
    jar: alpha.jar,
  });
  check(
    "An invoice with payments cannot be re-totalled",
    editAfterPayment.status === 409,
    `got ${editAfterPayment.status}`,
  );

  const cancelAfterPayment = await call(`/api/invoices/${invoiceId}`, {
    method: "PUT",
    body: { status: "cancelled" },
    jar: alpha.jar,
  });
  check(
    "An invoice with payments cannot be cancelled",
    cancelAfterPayment.status === 409,
    `got ${cancelAfterPayment.status}`,
  );

  const settle = await call("/api/payments", {
    method: "POST",
    body: { invoiceId, amount: 230, method: "bank_transfer" },
    jar: alpha.jar,
  });
  check("Remaining balance settled", settle.status === 201, `got ${settle.status}`);

  const afterSettle = await call(`/api/invoices/${invoiceId}`, {
    jar: alpha.jar,
  });
  check(
    "Invoice reads as fully paid with a zero balance",
    afterSettle.json.data.paymentStatus === "paid" &&
      afterSettle.json.data.balanceDueMinor === 0,
    `${afterSettle.json?.data?.paymentStatus} / ${afterSettle.json?.data?.balanceDueMinor}`,
  );

  const payAgain = await call("/api/payments", {
    method: "POST",
    body: { invoiceId, amount: 1, method: "cash" },
    jar: alpha.jar,
  });
  check(
    "A fully paid invoice takes no further payment",
    payAgain.status === 409,
    `got ${payAgain.status}`,
  );

  const ledger = await call(`/api/payments?invoiceId=${invoiceId}&pageSize=100`, {
    jar: alpha.jar,
  });
  check(
    "Both payments appear in the ledger",
    ledger.json.data.total === 2,
    String(ledger.json?.data?.total),
  );
  check(
    "Payment reference retained",
    (ledger.json.data.items as any[]).some((p) => p.reference === "TXN-12345"),
  );

  // -------------------------------------------------------------------------
  section("Cross-tenant isolation");
  const crossRead = await call(`/api/invoices/${invoiceId}`, { jar: beta.jar });
  check(
    "Hospital B cannot read a Hospital A invoice",
    crossRead.status === 404,
    `got ${crossRead.status}`,
  );

  const crossPay = await call("/api/payments", {
    method: "POST",
    body: { invoiceId, amount: 1, method: "cash" },
    jar: beta.jar,
  });
  check(
    "Hospital B cannot pay a Hospital A invoice",
    crossPay.status === 404,
    `got ${crossPay.status}`,
  );

  const crossTreatmentLine = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      // A real treatment, but it belongs to the other hospital.
      items: [{ treatmentId: beta.treatmentId, quantity: 1 }],
    },
    jar: alpha.jar,
  });
  check(
    "A treatment from another hospital cannot be billed",
    crossTreatmentLine.status === 404,
    `got ${crossTreatmentLine.status}`,
  );

  const crossPatientInvoice = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: beta.patientId,
      items: [{ treatmentId: alpha.treatmentId, quantity: 1 }],
    },
    jar: alpha.jar,
  });
  check(
    "A patient from another hospital cannot be invoiced",
    crossPatientInvoice.status === 404,
    `got ${crossPatientInvoice.status}`,
  );

  const betaLedger = await call("/api/payments?pageSize=100", { jar: beta.jar });
  check(
    "Hospital B's ledger excludes Hospital A's payments",
    (betaLedger.json.data.items as any[]).every(
      (p) => p.invoiceId !== invoiceId,
    ),
  );

  // Independent invoice numbering per tenant.
  const betaInvoice = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: beta.patientId,
      items: [{ treatmentId: beta.treatmentId, quantity: 1 }],
    },
    jar: beta.jar,
  });
  check(
    "A second hospital's numbering starts independently at INV-000001",
    betaInvoice.json.data.invoiceNumber === "INV-000001",
    betaInvoice.json?.data?.invoiceNumber,
  );
  check(
    "Hospital B's own tax rate (0%) applied, not Hospital A's",
    betaInvoice.json.data.taxMinor === 0 &&
      betaInvoice.json.data.totalMinor === 15000,
    `tax ${betaInvoice.json?.data?.taxMinor}, total ${betaInvoice.json?.data?.totalMinor}`,
  );

  // -------------------------------------------------------------------------
  section("Concurrent invoice numbering");
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () =>
      call("/api/invoices", {
        method: "POST",
        body: {
          patientId: alpha.patientId,
          items: [{ treatmentId: alpha.treatmentId, quantity: 1 }],
        },
        jar: alpha.jar,
      }),
    ),
  );
  const numbers = concurrent
    .filter((r) => r.status === 201)
    .map((r) => r.json.data.invoiceNumber as string);
  check(
    "All concurrent invoices created",
    numbers.length === 8,
    `${numbers.length}/8`,
  );
  check(
    "Every concurrent invoice number is distinct",
    new Set(numbers).size === numbers.length,
    `${new Set(numbers).size} unique of ${numbers.length}`,
  );

  // -------------------------------------------------------------------------
  section("Referential guards");
  const deleteBilledTreatment = await call(
    `/api/treatments/${alpha.treatmentId}`,
    { method: "DELETE", jar: alpha.jar },
  );
  check(
    "A treatment that has been billed cannot be deleted",
    deleteBilledTreatment.status === 409,
    `got ${deleteBilledTreatment.status}`,
  );

  const deleteBilledPatient = await call(`/api/patients/${alpha.patientId}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "A patient with invoices cannot be deleted",
    deleteBilledPatient.status === 409,
    `got ${deleteBilledPatient.status}`,
  );

  const draftToDelete = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [{ treatmentId: alpha.treatmentId, quantity: 1 }],
    },
    jar: alpha.jar,
  });
  const deleteDraft = await call(`/api/invoices/${draftToDelete.json.data.id}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "An unissued draft can be deleted",
    deleteDraft.status === 200,
    `got ${deleteDraft.status}`,
  );

  // -------------------------------------------------------------------------
  section("RBAC on billing");
  const roles = await call("/api/roles?pageSize=100", { jar: alpha.jar });
  const accountantRoleId = (roles.json.data.items as any[]).find(
    (r) => r.key === "accountant",
  ).id as string;
  const doctorRoleId = (roles.json.data.items as any[]).find(
    (r) => r.key === "doctor",
  ).id as string;

  async function staffSession(label: string, roleId: string): Promise<Jar> {
    const email = `${label}.${stamp}@billing.test`;
    const created = await call("/api/users", {
      method: "POST",
      body: { name: label, email, roleId },
      jar: alpha.jar,
    });
    const temp = created.json.data.temporaryPassword as string;
    const password = `Billing${label}!2024`;
    const jar = await signIn(email, temp);
    await call("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: temp, newPassword: password, confirmPassword: password },
      jar,
    });
    return jar;
  }

  const accountantJar = await staffSession("accountant", accountantRoleId);
  const clinicianJar = await staffSession("clinician", doctorRoleId);

  const accountantInvoices = await call("/api/invoices", { jar: accountantJar });
  check(
    "Accountant CAN view invoices",
    accountantInvoices.status === 200,
    `got ${accountantInvoices.status}`,
  );

  const accountantCreates = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [{ treatmentId: alpha.treatmentId, quantity: 1 }],
    },
    jar: accountantJar,
  });
  check(
    "Accountant CAN create invoices",
    accountantCreates.status === 201,
    `got ${accountantCreates.status}`,
  );

  const accountantDeletes = await call(
    `/api/invoices/${accountantCreates.json.data.id}`,
    { method: "DELETE", jar: accountantJar },
  );
  check(
    "Accountant CANNOT delete invoices (lacks invoice.delete)",
    accountantDeletes.status === 403,
    `got ${accountantDeletes.status}`,
  );

  const clinicianInvoices = await call("/api/invoices", { jar: clinicianJar });
  check(
    "Doctor CANNOT view invoices (lacks invoice.view)",
    clinicianInvoices.status === 403,
    `got ${clinicianInvoices.status}`,
  );

  const clinicianPays = await call("/api/payments", {
    method: "POST",
    body: { invoiceId, amount: 1, method: "cash" },
    jar: clinicianJar,
  });
  check(
    "Doctor CANNOT record payments",
    clinicianPays.status === 403,
    `got ${clinicianPays.status}`,
  );

  const superAdminInvoices = await call("/api/invoices", { jar: superJar });
  check(
    "Super Admin cannot read a hospital's invoices (Section 3)",
    superAdminInvoices.status === 403,
    `got ${superAdminInvoices.status}`,
  );

  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(52)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(52));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exitCode = 1;
});
