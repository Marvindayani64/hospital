/* eslint-disable @typescript-eslint/no-explicit-any --
 * Black-box harness: it reads arbitrary JSON envelopes from the API rather than
 * importing the app's own types, so a regression in those types cannot silently
 * make the tests pass.
 */

/**
 * Phase 8 verification — dashboard, hospital settings, audit log and reports.
 *
 * Covers Sections 28, 34, 35, 36 and 49. The recurring theme under test: every
 * figure is tenant-scoped, and each is computed only for a caller who holds the
 * permission for its underlying data.
 *
 * Usage:
 *   1. npm run dev
 *   2. npm run verify:admin
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

const TODAY = new Date().toISOString().slice(0, 10);
const MONTH_START = `${TODAY.slice(0, 7)}-01`;

type Tenant = {
  hospitalId: string;
  jar: Jar;
  patientId: string;
  treatmentId: string;
  doctorId: string;
  departmentId: string;
};

/** A hospital with a full data set: patient, doctor, appointment, invoice, payment. */
async function buildTenant(
  superJar: Jar,
  label: string,
  stamp: number,
): Promise<Tenant> {
  const adminEmail = `admin.${label.toLowerCase()}.${stamp}@example.test`;

  const created = await call("/api/super-admin/hospitals", {
    method: "POST",
    body: {
      name: `${label} Admin Clinic ${stamp}`,
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
  const password = `Admin${label}!2024`;
  const jar = await signIn(adminEmail, temp);
  await call("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword: temp, newPassword: password, confirmPassword: password },
    jar,
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
      price: 200,
      durationMinutes: 30,
    },
    jar,
  });
  const doctor = await call("/api/doctors", {
    method: "POST",
    body: {
      displayName: `Dr. ${label}`,
      departmentIds: [department.json.data.id],
    },
    jar,
  });
  const patient = await call("/api/patients", {
    method: "POST",
    body: { firstName: label, lastName: "Subject", phone: "+919876500200" },
    jar,
  });

  // Today's appointment, a visit, and an issued+paid invoice.
  await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: patient.json.data.id,
      doctorId: doctor.json.data.id,
      departmentId: department.json.data.id,
      appointmentDate: TODAY,
      startTime: "09:00",
      endTime: "09:30",
    },
    jar,
  });

  await call("/api/visits", {
    method: "POST",
    body: {
      patientId: patient.json.data.id,
      doctorId: doctor.json.data.id,
      visitDate: TODAY,
      diagnosis: `${label} diagnosis`,
    },
    jar,
  });

  const invoice = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: patient.json.data.id,
      items: [{ treatmentId: treatment.json.data.id, quantity: 1 }],
      taxRatePercent: 0,
    },
    jar,
  });
  await call(`/api/invoices/${invoice.json.data.id}`, {
    method: "PUT",
    body: { status: "issued" },
    jar,
  });
  await call("/api/payments", {
    method: "POST",
    body: { invoiceId: invoice.json.data.id, amount: 50, method: "cash" },
    jar,
  });

  return {
    hospitalId: created.json.data.hospital.id,
    jar,
    patientId: patient.json.data.id,
    treatmentId: treatment.json.data.id,
    doctorId: doctor.json.data.id,
    departmentId: department.json.data.id,
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
  const alpha = await buildTenant(superJar, "Alpha", stamp);
  const beta = await buildTenant(superJar, "Beta", stamp);
  check("Two hospitals with full data sets", Boolean(alpha.patientId && beta.patientId));

  // -------------------------------------------------------------------------
  section("Dashboard statistics (Section 35)");
  const stats = await call("/api/dashboard/stats", { jar: alpha.jar });
  check("Dashboard stats returned", stats.status === 200, `got ${stats.status}`);

  check(
    "Patient count is tenant-scoped (1, not both hospitals')",
    stats.json.data.patients?.total === 1,
    String(stats.json?.data?.patients?.total),
  );
  check(
    "Today's appointment counted",
    stats.json.data.appointments?.today === 1,
    String(stats.json?.data?.appointments?.today),
  );
  check(
    "Doctors counted",
    stats.json.data.doctors?.total === 1,
    String(stats.json?.data?.doctors?.total),
  );
  check(
    "Visits this month counted",
    stats.json.data.visits?.thisMonth === 1,
    String(stats.json?.data?.visits?.thisMonth),
  );
  check(
    "Outstanding balance derived from the ledger ($200 - $50 = $150)",
    stats.json.data.billing?.outstandingMinor === 15000,
    String(stats.json?.data?.billing?.outstandingMinor),
  );
  check(
    "Collected this month reflects the payment",
    stats.json.data.billing?.collectedThisMonthMinor === 5000,
    String(stats.json?.data?.billing?.collectedThisMonthMinor),
  );
  check(
    "Recent patients listed",
    (stats.json.data.recentPatients as any[]).length === 1 &&
      stats.json.data.recentPatients[0].name === "Alpha Subject",
    JSON.stringify(stats.json?.data?.recentPatients),
  );
  check(
    "Today's schedule lists the booking",
    (stats.json.data.todaysAppointments as any[]).length === 1 &&
      stats.json.data.todaysAppointments[0].startTime === "09:00",
    JSON.stringify(stats.json?.data?.todaysAppointments),
  );

  // The other hospital's identical data must not bleed in.
  const betaStats = await call("/api/dashboard/stats", { jar: beta.jar });
  check(
    "Hospital B's dashboard shows only its own patient",
    betaStats.json.data.patients?.total === 1 &&
      betaStats.json.data.recentPatients[0].name === "Beta Subject",
    JSON.stringify(betaStats.json?.data?.recentPatients),
  );

  // -------------------------------------------------------------------------
  section("Dashboard metrics are permission-gated");
  const roles = await call("/api/roles?pageSize=100", { jar: alpha.jar });
  const receptionistRoleId = (roles.json.data.items as any[]).find(
    (r) => r.key === "receptionist",
  ).id as string;
  const accountantRoleId = (roles.json.data.items as any[]).find(
    (r) => r.key === "accountant",
  ).id as string;

  async function staffSession(label: string, roleId: string): Promise<Jar> {
    const email = `${label}.${stamp}@admin.test`;
    const created = await call("/api/users", {
      method: "POST",
      body: { name: label, email, roleId },
      jar: alpha.jar,
    });
    const temp = created.json.data.temporaryPassword as string;
    const password = `Admin${label}!2024`;
    const jar = await signIn(email, temp);
    await call("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: temp, newPassword: password, confirmPassword: password },
      jar,
    });
    return jar;
  }

  const receptionJar = await staffSession("reception", receptionistRoleId);
  const accountantJar = await staffSession("accountant", accountantRoleId);

  const receptionStats = await call("/api/dashboard/stats", { jar: receptionJar });
  check(
    "Receptionist gets patient and appointment tiles",
    receptionStats.json.data.patients !== null &&
      receptionStats.json.data.appointments !== null,
  );
  check(
    "Receptionist gets NO billing figure (never computed)",
    receptionStats.json.data.billing === null,
    JSON.stringify(receptionStats.json?.data?.billing),
  );
  check(
    "Receptionist gets NO visit figure",
    receptionStats.json.data.visits === null,
    JSON.stringify(receptionStats.json?.data?.visits),
  );

  const accountantStats = await call("/api/dashboard/stats", { jar: accountantJar });
  check(
    "Accountant DOES get the billing figure",
    accountantStats.json.data.billing !== null,
  );
  check(
    "Accountant gets no appointment figure (lacks appointment.view)",
    accountantStats.json.data.appointments === null,
    JSON.stringify(accountantStats.json?.data?.appointments),
  );

  // -------------------------------------------------------------------------
  section("Hospital settings (Section 36)");
  const settings = await call("/api/hospital/settings", { jar: alpha.jar });
  check("Settings readable", settings.status === 200, `got ${settings.status}`);
  check(
    "Defaults present",
    settings.json.data.invoicePrefix === "INV" &&
      settings.json.data.appointmentSlotMinutes === 30,
    JSON.stringify({
      prefix: settings.json?.data?.invoicePrefix,
      slot: settings.json?.data?.appointmentSlotMinutes,
    }),
  );

  const updated = await call("/api/hospital/settings", {
    method: "PATCH",
    body: {
      name: `Alpha Renamed ${stamp}`,
      phone: "+15559999",
      defaultTaxRatePercent: 5,
      invoicePrefix: "ACME",
      invoiceFooter: "Payment due within 30 days.",
      appointmentSlotMinutes: 45,
      notifications: { appointmentReminders: true },
    },
    jar: alpha.jar,
  });
  check("Settings updated", updated.status === 200, `got ${updated.status}`);
  check(
    "Profile and billing settings persisted",
    updated.json.data.name === `Alpha Renamed ${stamp}` &&
      updated.json.data.defaultTaxRatePercent === 5 &&
      updated.json.data.invoicePrefix === "ACME" &&
      updated.json.data.appointmentSlotMinutes === 45,
    JSON.stringify(updated.json?.data),
  );
  check(
    "Notification preference persisted",
    updated.json.data.notifications.appointmentReminders === true,
  );
  check(
    "Untouched notification preferences left alone",
    updated.json.data.notifications.invoiceIssued === false,
  );

  /**
   * A tenant must not be able to change platform-controlled fields through
   * their own settings screen.
   */
  const escalation = await call("/api/hospital/settings", {
    method: "PATCH",
    body: {
      phone: "+15558888",
      status: "suspended",
      currency: "JPY",
      slug: "hijacked",
      tokenVersion: 99,
    },
    jar: alpha.jar,
  });
  check(
    "Request with platform fields still succeeds",
    escalation.status === 200,
    `got ${escalation.status}`,
  );
  check(
    "status IGNORED — hospital not suspended",
    escalation.json.data.status === "active",
    escalation.json?.data?.status,
  );
  check(
    "currency IGNORED — prices not reinterpreted",
    escalation.json.data.currency === "USD",
    escalation.json?.data?.currency,
  );
  check(
    "slug IGNORED",
    escalation.json.data.slug !== "hijacked",
    escalation.json?.data?.slug,
  );

  // The configured prefix must actually drive invoice numbering.
  const prefixedInvoice = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      items: [{ treatmentId: alpha.treatmentId, quantity: 1 }],
    },
    jar: alpha.jar,
  });
  check(
    "New invoices use the configured prefix",
    (prefixedInvoice.json.data.invoiceNumber as string).startsWith("ACME-"),
    prefixedInvoice.json?.data?.invoiceNumber,
  );
  check(
    "New invoices use the configured default tax rate",
    prefixedInvoice.json.data.taxRatePercent === 5,
    String(prefixedInvoice.json?.data?.taxRatePercent),
  );

  const crossSettings = await call("/api/hospital/settings", { jar: beta.jar });
  check(
    "Hospital B's settings are its own, not Hospital A's",
    crossSettings.json.data.id === beta.hospitalId &&
      crossSettings.json.data.invoicePrefix === "INV",
    crossSettings.json?.data?.invoicePrefix,
  );

  const receptionSettings = await call("/api/hospital/settings", {
    jar: receptionJar,
  });
  check(
    "Receptionist cannot read hospital settings",
    receptionSettings.status === 403,
    `got ${receptionSettings.status}`,
  );

  const receptionUpdate = await call("/api/hospital/settings", {
    method: "PATCH",
    body: { name: "Hijacked" },
    jar: receptionJar,
  });
  check(
    "Receptionist cannot update hospital settings",
    receptionUpdate.status === 403,
    `got ${receptionUpdate.status}`,
  );

  // -------------------------------------------------------------------------
  section("Audit log (Sections 28, 49)");
  const auditLog = await call("/api/audit-logs?pageSize=100", { jar: alpha.jar });
  check("Audit log readable by admin", auditLog.status === 200, `got ${auditLog.status}`);
  check(
    "Entries were recorded for this tenant's activity",
    auditLog.json.data.total > 5,
    String(auditLog.json?.data?.total),
  );

  const actions = (auditLog.json.data.items as any[]).map((e) => e.action);
  check(
    "Patient creation recorded",
    actions.includes("patient.created"),
    actions.slice(0, 8).join(", "),
  );
  check(
    "Invoice creation recorded",
    actions.includes("invoice.created"),
  );
  check(
    "Settings change recorded",
    actions.includes("hospital.settings_updated"),
  );

  /** Nothing sensitive may ever appear, whatever a call site passed. */
  const serialised = JSON.stringify(auditLog.json.data.items);
  check(
    "No password material anywhere in the log",
    !/passwordHash|temporaryPassword|"password"/i.test(serialised),
  );
  check(
    "No token material anywhere in the log",
    !/refreshToken|tokenHash|accessToken/i.test(serialised),
  );

  const filtered = await call(
    "/api/audit-logs?action=patient.created&pageSize=100",
    { jar: alpha.jar },
  );
  check(
    "Filtering by action works",
    (filtered.json.data.items as any[]).every(
      (e) => e.action === "patient.created",
    ) && filtered.json.data.total > 0,
    String(filtered.json?.data?.total),
  );

  const dateFiltered = await call(
    `/api/audit-logs?from=${TODAY}&to=${TODAY}&pageSize=100`,
    { jar: alpha.jar },
  );
  check(
    "Filtering by date returns today's entries",
    dateFiltered.json.data.total > 0,
    String(dateFiltered.json?.data?.total),
  );

  const oldRange = await call(
    "/api/audit-logs?from=2020-01-01&to=2020-01-02&pageSize=100",
    { jar: alpha.jar },
  );
  check(
    "A range with no activity returns nothing",
    oldRange.json.data.total === 0,
    String(oldRange.json?.data?.total),
  );

  const filterVocab = await call("/api/audit-logs?filters=1", { jar: alpha.jar });
  check(
    "Filter vocabulary lists this tenant's actions and staff",
    (filterVocab.json.data.actions as string[]).length > 0 &&
      (filterVocab.json.data.actors as any[]).length > 0,
  );

  // Cross-tenant: Hospital B must see only its own trail.
  const betaAudit = await call("/api/audit-logs?pageSize=100", { jar: beta.jar });
  const betaActorEmails = (betaAudit.json.data.items as any[])
    .map((e) => e.actor?.email)
    .filter(Boolean);
  check(
    "Hospital B's audit log contains none of Hospital A's actors",
    !betaActorEmails.some((email: string) =>
      email.startsWith("admin.alpha."),
    ),
    betaActorEmails.slice(0, 3).join(", "),
  );
  check(
    "Hospital B's log has no settings change (it made none)",
    !(betaAudit.json.data.items as any[]).some(
      (e) => e.action === "hospital.settings_updated",
    ),
  );

  const receptionAudit = await call("/api/audit-logs", { jar: receptionJar });
  check(
    "Receptionist cannot read the audit log (lacks audit.view)",
    receptionAudit.status === 403,
    `got ${receptionAudit.status}`,
  );

  const accountantAudit = await call("/api/audit-logs", { jar: accountantJar });
  check(
    "Accountant cannot read the audit log either",
    accountantAudit.status === 403,
    `got ${accountantAudit.status}`,
  );

  const superAudit = await call("/api/audit-logs", { jar: superJar });
  check(
    "Super Admin cannot read a hospital's audit log (Section 3)",
    superAudit.status === 403,
    `got ${superAudit.status}`,
  );

  // -------------------------------------------------------------------------
  section("Reports");
  const report = await call(
    `/api/reports/summary?from=${MONTH_START}&to=${TODAY}`,
    { jar: alpha.jar },
  );
  check("Report returned", report.status === 200, `got ${report.status}`);
  check(
    "Invoiced total covers the issued invoice",
    report.json.data.revenue?.invoicedMinor === 20000,
    String(report.json?.data?.revenue?.invoicedMinor),
  );
  check(
    "Collected total matches the payment",
    report.json.data.revenue?.collectedMinor === 5000,
    String(report.json?.data?.revenue?.collectedMinor),
  );
  check(
    "Payment breakdown by method",
    (report.json.data.revenue?.byMethod as any[]).some(
      (row) => row.method === "cash" && row.amountMinor === 5000,
    ),
    JSON.stringify(report.json?.data?.revenue?.byMethod),
  );
  check(
    "Activity counts this period's appointments and visits",
    report.json.data.activity?.appointments === 1 &&
      report.json.data.activity?.visits === 1,
    JSON.stringify(report.json?.data?.activity),
  );
  check(
    "New patients counted",
    report.json.data.activity?.newPatients === 1,
    String(report.json?.data?.activity?.newPatients),
  );
  check(
    "Top treatments derived from invoice lines",
    (report.json.data.topTreatments as any[]).some(
      (row) => row.name === "Consultation Alpha" && row.revenueMinor === 20000,
    ),
    JSON.stringify(report.json?.data?.topTreatments),
  );

  const emptyRange = await call(
    "/api/reports/summary?from=2020-01-01&to=2020-01-31",
    { jar: alpha.jar },
  );
  check(
    "A period with no activity reports zero, not an error",
    emptyRange.status === 200 &&
      emptyRange.json.data.revenue.invoicedMinor === 0 &&
      emptyRange.json.data.activity.appointments === 0,
    `got ${emptyRange.status}`,
  );

  const backwardsRange = await call(
    `/api/reports/summary?from=${TODAY}&to=${MONTH_START}`,
    { jar: alpha.jar },
  );
  check(
    "An inverted date range is rejected",
    backwardsRange.status === 422,
    `got ${backwardsRange.status}`,
  );

  const receptionReport = await call(
    `/api/reports/summary?from=${MONTH_START}&to=${TODAY}`,
    { jar: receptionJar },
  );
  check(
    "Receptionist's report omits revenue entirely",
    receptionReport.status === 200 && receptionReport.json.data.revenue === null,
    JSON.stringify(receptionReport.json?.data?.revenue),
  );
  check(
    "Receptionist's report still includes activity they may see",
    receptionReport.json.data.activity !== null,
  );

  const betaReport = await call(
    `/api/reports/summary?from=${MONTH_START}&to=${TODAY}`,
    { jar: beta.jar },
  );
  check(
    "Hospital B's revenue excludes Hospital A's invoices",
    betaReport.json.data.revenue?.invoicedMinor === 20000 &&
      betaReport.json.data.revenue?.collectedMinor === 5000,
    JSON.stringify(betaReport.json?.data?.revenue),
  );
  check(
    "Hospital B's top treatments are its own",
    (betaReport.json.data.topTreatments as any[]).every(
      (row) => row.name === "Consultation Beta",
    ),
    JSON.stringify(betaReport.json?.data?.topTreatments),
  );

  // -------------------------------------------------------------------------
  section("Platform separation");
  const superStats = await call("/api/dashboard/stats", { jar: superJar });
  check(
    "Super Admin has no tenant dashboard",
    superStats.status === 403,
    `got ${superStats.status}`,
  );

  const superSettings = await call("/api/hospital/settings", { jar: superJar });
  check(
    "Super Admin cannot read tenant settings through the tenant endpoint",
    superSettings.status === 403,
    `got ${superSettings.status}`,
  );

  const platformStats = await call("/api/super-admin/stats", { jar: superJar });
  check(
    "Super Admin DOES get platform statistics (Section 34)",
    platformStats.status === 200 && platformStats.json.data.total >= 2,
    `got ${platformStats.status}`,
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
