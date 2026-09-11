/* eslint-disable @typescript-eslint/no-explicit-any --
 * Black-box harness: it reads arbitrary JSON envelopes from the API rather than
 * importing the app's own types, so a regression in those types cannot silently
 * make the tests pass.
 */

/**
 * Verification — prescriptions and the pharmacy queue.
 *
 * Covers the three things this module claims to do:
 *   1. a doctor writes a prescription against a patient;
 *   2. it appears in the pharmacy's queue and can be dispensed there;
 *   3. writing it records the consultation, reusing that day's visit rather
 *      than creating a second one for the same encounter.
 *
 * Plus the usual guarantees: tenant isolation, RBAC, and the transition rules.
 *
 * The prescriber is NOT a request field. It resolves to the caller's own doctor
 * profile when their account is linked, and otherwise to the doctor the patient
 * is assigned to through their bookings. Several tests below exist only to
 * prove that order holds: a `doctorId` in the body is ignored rather than
 * honoured, an unlinked account signs with the patient's assigned doctor, and a
 * linked one always signs with its own name even when treating someone else's
 * patient.
 *
 * Usage:
 *   1. npm run build && npm run start
 *   2. npm run verify:pharmacy
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

/**
 * The Hospital Admin role is read-only over operational records by default —
 * the front desk books patients in, a doctor writes the consultation, an
 * accountant raises the invoice (see lib/rbac/default-roles.ts).
 *
 * These suites use the admin account as a fixture to set that data up, so they
 * grant the operational permissions back first, exactly as a hospital would
 * from the Roles screen. The read-only DEFAULT is asserted in verify-admin
 * rather than here.
 */
async function grantOperationalPermissions(jar: Jar): Promise<void> {
  const roles = await call("/api/roles?pageSize=100", { jar });
  const admin = (roles.json?.data?.items as any[])?.find(
    (role) => role.key === "hospital_admin",
  );
  if (!admin) throw new Error("No hospital_admin role to grant from.");

  const granted = await call(`/api/roles/${admin.id}`, {
    method: "PATCH",
    body: {
      permissions: [
        ...new Set([
          ...(admin.permissions as string[]),
          "patient.create",
          "patient.update",
          "patient.delete",
          "appointment.create",
          "appointment.update",
          "appointment.cancel",
          "visit.create",
          "visit.update",
          "prescription.create",
          "prescription.dispense",
          "invoice.create",
          "invoice.update",
          "invoice.delete",
          "payment.create",
        ]),
      ],
    },
    jar,
  });

  if (granted.status !== 200) {
    throw new Error(
      `Could not grant operational permissions: ${granted.status} ${JSON.stringify(granted.json?.error ?? "")}`,
    );
  }
}

const TODAY = new Date().toISOString().slice(0, 10);

function futureDate(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

type Tenant = {
  jar: Jar;
  adminUserId: string;
  patientId: string;
  otherPatientId: string;
  /** The admin's own doctor profile — the prescriber for `jar`. */
  doctorId: string;
  departmentId: string;
  treatmentId: string;
};

async function buildTenant(
  superJar: Jar,
  label: string,
  stamp: number,
): Promise<Tenant> {
  const adminEmail = `admin.${label.toLowerCase()}.${stamp}@pharmacy.test`;

  const created = await call("/api/super-admin/hospitals", {
    method: "POST",
    body: {
      name: `${label} Pharmacy Clinic ${stamp}`,
      type: "clinic",
      email: `contact.${label.toLowerCase()}.${stamp}@pharmacy.test`,
      phone: "+15550100",
      status: "active",
      adminName: `${label} Admin`,
      adminEmail,
    },
    jar: superJar,
  });

  if (created.status !== 201) {
    throw new Error(`Could not create ${label}: ${created.status}`);
  }

  const temp = created.json.data.temporaryPassword as string;
  const password = `Pharm${label}!2024`;
  const jar = await signIn(adminEmail, temp);
  await call("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword: temp, newPassword: password, confirmPassword: password },
    jar,
  });

  // Fixture setup runs as the admin, which is read-only by default.
  await grantOperationalPermissions(jar);

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
      price: 80,
      durationMinutes: 30,
    },
    jar,
  });
  /**
   * The prescriber comes from the session, so the account doing the prescribing
   * must have a doctor profile linked to it. The admin's is linked here so this
   * tenant's `jar` can write prescriptions.
   */
  const me = await call("/api/auth/me", { jar });
  const adminUserId = me.json.data.user.id as string;

  const doctor = await call("/api/doctors", {
    method: "POST",
    body: {
      displayName: `Dr. ${label}`,
      userId: adminUserId,
      departmentIds: [department.json.data.id],
    },
    jar,
  });
  const patient = await call("/api/patients", {
    method: "POST",
    body: {
      firstName: label,
      lastName: "Patient",
      phone: "+919876500300",
      email: `patient.${label.toLowerCase()}.${stamp}@pharmacy.test`,
    },
    jar,
  });
  const otherPatient = await call("/api/patients", {
    method: "POST",
    body: {
      firstName: `${label}Other`,
      lastName: "Patient",
      phone: "+919876500301",
      email: `other.${label.toLowerCase()}.${stamp}@pharmacy.test`,
    },
    jar,
  });

  // Fail loudly here rather than letting `undefined.id` surface 200 lines later
  // as an unexplained TypeError.
  for (const [what, response] of [
    ["department", department],
    ["treatment", treatment],
    ["doctor", doctor],
    ["patient", patient],
    ["other patient", otherPatient],
  ] as const) {
    if (response.status !== 201) {
      throw new Error(
        `Could not create ${what} for ${label}: ${response.status} ${JSON.stringify(response.json?.error ?? response.json)}`,
      );
    }
  }

  return {
    jar,
    adminUserId,
    patientId: patient.json.data.id,
    otherPatientId: otherPatient.json.data.id,
    doctorId: doctor.json.data.id,
    departmentId: department.json.data.id,
    treatmentId: treatment.json.data.id,
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
  check("Two hospitals configured", Boolean(alpha.doctorId && beta.doctorId));

  // -------------------------------------------------------------------------
  section("Writing a prescription");
  const written = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      prescribedDate: TODAY,
      items: [
        {
          drugName: "Amoxicillin",
          dosage: "500mg",
          frequency: "Three times daily",
          duration: "7 days",
          instructions: "After food",
        },
        { drugName: "Paracetamol", dosage: "500mg" },
      ],
      diagnosis: "Acute bacterial tonsillitis",
      notes: "Patient reports a mild penicillin sensitivity — confirm before handing over.",
    },
    jar: alpha.jar,
  });
  check(
    "Prescription written",
    written.status === 201,
    `got ${written.status} ${JSON.stringify(written.json?.error ?? "")}`,
  );
  const prescriptionId = written.json?.data?.id as string;
  const visitId = written.json?.data?.visitId as string;

  check(
    "Both drugs stored, in order",
    written.json?.data?.items?.length === 2 &&
      written.json.data.items[0].drugName === "Amoxicillin" &&
      written.json.data.items[1].drugName === "Paracetamol",
  );
  check(
    "Optional item fields default to empty rather than being dropped",
    written.json?.data?.items?.[1]?.frequency === "" &&
      written.json?.data?.items?.[1]?.duration === "",
  );
  check(
    "Starts pending, awaiting the pharmacy",
    written.json?.data?.status === "pending",
    written.json?.data?.status,
  );
  check("Note to pharmacy stored", written.json?.data?.notes?.includes("penicillin"));

  const noDrugs = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      prescribedDate: TODAY,
      items: [],
    },
    jar: alpha.jar,
  });
  check(
    "A prescription with no drugs is rejected",
    noDrugs.status === 422,
    `got ${noDrugs.status}`,
  );

  // -------------------------------------------------------------------------
  section("The consultation is recorded automatically");
  check("Prescription carries a visit", Boolean(visitId));

  const visit = await call(`/api/visits/${visitId}`, { jar: alpha.jar });
  check(
    "That visit exists and is for the same patient",
    visit.status === 200 && visit.json?.data?.patient?.id === alpha.patientId,
    `got ${visit.status}`,
  );
  check(
    "Diagnosis from the prescription reached the visit",
    visit.json?.data?.diagnosis === "Acute bacterial tonsillitis",
    visit.json?.data?.diagnosis,
  );
  check(
    "Visit is dated the day of the prescription",
    visit.json?.data?.visitDate === TODAY,
    visit.json?.data?.visitDate,
  );

  // A second prescription for the same patient, doctor and day is the same
  // encounter — it must not open a second consultation record.
  const sameDay = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      prescribedDate: TODAY,
      items: [{ drugName: "Ibuprofen", dosage: "400mg" }],
      diagnosis: "A different diagnosis that must not overwrite the first",
    },
    jar: alpha.jar,
  });
  check("Second prescription written", sameDay.status === 201, `got ${sameDay.status}`);
  check(
    "Same patient, doctor and day reuses the visit — no duplicate consultation",
    sameDay.json?.data?.visitId === visitId,
    `${sameDay.json?.data?.visitId} vs ${visitId}`,
  );

  const visitAfter = await call(`/api/visits/${visitId}`, { jar: alpha.jar });
  check(
    "An existing diagnosis is never overwritten by a later prescription",
    visitAfter.json?.data?.diagnosis === "Acute bacterial tonsillitis",
    visitAfter.json?.data?.diagnosis,
  );

  const otherPatientSameDay = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: alpha.otherPatientId,
      prescribedDate: TODAY,
      items: [{ drugName: "Loratadine" }],
    },
    jar: alpha.jar,
  });
  check(
    "A different patient the same day gets its own visit",
    otherPatientSameDay.status === 201 &&
      otherPatientSameDay.json?.data?.visitId !== visitId,
  );

  const patientVisits = await call(
    `/api/visits?patientId=${alpha.patientId}&pageSize=100`,
    { jar: alpha.jar },
  );
  check(
    "Two prescriptions for one encounter produced exactly one visit",
    (patientVisits.json?.data?.items as any[]).length === 1,
    `${(patientVisits.json?.data?.items as any[])?.length} visits`,
  );

  // -------------------------------------------------------------------------
  section("Prescribing against an appointment");
  // Appointments DO take an explicit doctorId — the front desk books a
  // clinician other than themselves. It is prescriptions that do not.
  const appointment = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alpha.otherPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      treatmentId: alpha.treatmentId,
      appointmentDate: futureDate(1),
      startTime: "09:00",
      endTime: "09:30",
    },
    jar: alpha.jar,
  });
  check(
    "Appointment booked",
    appointment.status === 201,
    `got ${appointment.status} ${JSON.stringify(appointment.json?.error ?? "")}`,
  );
  const appointmentId = appointment.json?.data?.id as string;

  const fromAppointment = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: alpha.otherPatientId,
      appointmentId,
      prescribedDate: futureDate(1),
      items: [{ drugName: "Cetirizine", dosage: "10mg" }],
    },
    jar: alpha.jar,
  });
  check(
    "Prescription written against a booking",
    fromAppointment.status === 201,
    `got ${fromAppointment.status}`,
  );

  const bookingVisit = await call(
    `/api/visits/${fromAppointment.json?.data?.visitId}`,
    { jar: alpha.jar },
  );
  check(
    "The recorded visit is linked to that appointment",
    bookingVisit.json?.data?.appointmentId === appointmentId,
    bookingVisit.json?.data?.appointmentId,
  );
  check(
    "The booked treatment is carried onto the visit",
    bookingVisit.json?.data?.treatment?.id === alpha.treatmentId,
  );

  const secondOnBooking = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: alpha.otherPatientId,
      appointmentId,
      prescribedDate: futureDate(1),
      items: [{ drugName: "Salbutamol" }],
    },
    jar: alpha.jar,
  });
  check(
    "A second prescription on one booking reuses its visit (one visit per appointment)",
    secondOnBooking.status === 201 &&
      secondOnBooking.json?.data?.visitId ===
        fromAppointment.json?.data?.visitId,
  );

  const wrongPatient = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      appointmentId,
      prescribedDate: TODAY,
      items: [{ drugName: "Anything" }],
    },
    jar: alpha.jar,
  });
  check(
    "An appointment belonging to another patient is rejected",
    wrongPatient.status === 422,
    `got ${wrongPatient.status}`,
  );

  // -------------------------------------------------------------------------
  section("Prescription context (what the prescribe dialog opens with)");
  const ctx = await call(
    `/api/patients/${alpha.patientId}/prescription-context`,
    { jar: alpha.jar },
  );
  check("Context readable", ctx.status === 200, `got ${ctx.status}`);
  check(
    "It names who would sign the prescription",
    ctx.json?.data?.prescriber?.id === alpha.doctorId,
    JSON.stringify(ctx.json?.data?.prescriber),
  );
  check(
    "Appointment options are a list",
    Array.isArray(ctx.json?.data?.appointments),
  );

  const ctxCrossTenant = await call(
    `/api/patients/${beta.patientId}/prescription-context`,
    { jar: alpha.jar },
  );
  check(
    "Another hospital's patient has no context",
    ctxCrossTenant.status === 404,
    `got ${ctxCrossTenant.status}`,
  );

  // -------------------------------------------------------------------------
  section("The pharmacy queue");
  const queue = await call("/api/prescriptions?status=pending&pageSize=100", {
    jar: alpha.jar,
  });
  check("Queue readable", queue.status === 200, `got ${queue.status}`);
  check(
    "The written prescription is in it",
    (queue.json?.data?.items as any[]).some((p) => p.id === prescriptionId),
  );
  check(
    "The queue carries the patient and prescriber for the counter",
    (queue.json?.data?.items as any[]).every(
      (p) => p.patient?.name && p.patient?.patientNumber && p.doctor?.name,
    ),
  );

  const byDrug = await call("/api/prescriptions?search=amoxicillin", {
    jar: alpha.jar,
  });
  check(
    "Search finds a prescription by drug name, case-insensitively",
    (byDrug.json?.data?.items as any[]).some((p) => p.id === prescriptionId),
  );

  const byDrugRegex = await call("/api/prescriptions?search=amoxi.*llin", {
    jar: alpha.jar,
  });
  check(
    "Regex metacharacters in the search are matched literally",
    (byDrugRegex.json?.data?.items as any[]).length === 0,
  );

  const byDoctor = await call(
    `/api/prescriptions?doctorId=${alpha.doctorId}&pageSize=100`,
    { jar: alpha.jar },
  );
  check(
    "Filter by prescriber works",
    (byDoctor.json?.data?.items as any[]).every(
      (p) => p.doctor?.id === alpha.doctorId,
    ),
  );

  // -------------------------------------------------------------------------
  section("Dispensing");
  const dispensed = await call(`/api/prescriptions/${prescriptionId}`, {
    method: "PUT",
    body: { status: "dispensed", dispensingNotes: "Counselled on the course." },
    jar: alpha.jar,
  });
  check("Prescription dispensed", dispensed.status === 200, `got ${dispensed.status}`);
  check(
    "Dispensing is attributed to whoever did it",
    Boolean(dispensed.json?.data?.dispensedBy?.name) &&
      Boolean(dispensed.json?.data?.dispensedAt),
  );
  check(
    "Dispensing note stored",
    dispensed.json?.data?.dispensingNotes === "Counselled on the course.",
  );

  const dispensedTwice = await call(`/api/prescriptions/${prescriptionId}`, {
    method: "PUT",
    body: { status: "dispensed" },
    jar: alpha.jar,
  });
  check(
    "A dispensed prescription cannot be dispensed again",
    dispensedTwice.status === 409,
    `got ${dispensedTwice.status}`,
  );

  const reopen = await call(`/api/prescriptions/${prescriptionId}`, {
    method: "PUT",
    body: { status: "pending" },
    jar: alpha.jar,
  });
  check(
    "A settled prescription cannot be returned to the queue",
    reopen.status === 422,
    `got ${reopen.status}`,
  );

  const toCancel = sameDay.json?.data?.id as string;
  const cancelled = await call(`/api/prescriptions/${toCancel}`, {
    method: "PUT",
    body: { status: "cancelled", dispensingNotes: "Out of stock." },
    jar: alpha.jar,
  });
  check("Prescription can be withdrawn", cancelled.status === 200, `got ${cancelled.status}`);

  const cancelledThenDispensed = await call(`/api/prescriptions/${toCancel}`, {
    method: "PUT",
    body: { status: "dispensed" },
    jar: alpha.jar,
  });
  check(
    "A cancelled prescription cannot then be dispensed",
    cancelledThenDispensed.status === 409,
    `got ${cancelledThenDispensed.status}`,
  );

  const pendingNow = await call("/api/prescriptions?status=pending&pageSize=100", {
    jar: alpha.jar,
  });
  check(
    "Settled prescriptions leave the pending queue",
    !(pendingNow.json?.data?.items as any[]).some(
      (p) => p.id === prescriptionId || p.id === toCancel,
    ),
  );

  // -------------------------------------------------------------------------
  section("Tenant isolation (Section 10)");
  const crossTenantPatient = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: beta.patientId,
      prescribedDate: TODAY,
      items: [{ drugName: "Anything" }],
    },
    jar: alpha.jar,
  });
  check(
    "Cannot prescribe for another hospital's patient",
    crossTenantPatient.status === 404,
    `got ${crossTenantPatient.status}`,
  );

  /**
   * The prescriber is taken from the session, so a `doctorId` in the body is
   * not merely rejected — it is not read at all. Sending another hospital's
   * doctor must still produce a prescription signed by the caller's own
   * profile, never by the injected one.
   */
  const injectedPrescriber = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      doctorId: beta.doctorId,
      prescribedDate: TODAY,
      items: [{ drugName: "Injected" }],
    },
    jar: alpha.jar,
  });
  check(
    "A doctorId in the request body cannot set the prescriber",
    injectedPrescriber.status === 201 &&
      injectedPrescriber.json?.data?.doctor?.id === alpha.doctorId,
    `got ${injectedPrescriber.status}, prescriber ${injectedPrescriber.json?.data?.doctor?.id}`,
  );

  const betaReads = await call(`/api/prescriptions/${prescriptionId}`, {
    jar: beta.jar,
  });
  check(
    "Another hospital cannot read this prescription",
    betaReads.status === 404,
    `got ${betaReads.status}`,
  );

  const betaDispenses = await call(`/api/prescriptions/${toCancel}`, {
    method: "PUT",
    body: { status: "dispensed" },
    jar: beta.jar,
  });
  check(
    "Another hospital cannot dispense this prescription",
    betaDispenses.status === 404,
    `got ${betaDispenses.status}`,
  );

  const betaQueue = await call("/api/prescriptions?pageSize=100", {
    jar: beta.jar,
  });
  check(
    "Hospital B's queue contains none of Hospital A's prescriptions",
    (betaQueue.json?.data?.items as any[]).length === 0,
  );

  // -------------------------------------------------------------------------
  section("Referential guards");
  const deletePatient = await call(`/api/patients/${alpha.patientId}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "A patient with prescriptions cannot be deleted",
    deletePatient.status === 409,
    `got ${deletePatient.status}`,
  );
  check(
    "The refusal names the prescriptions on record",
    String(deletePatient.json?.error?.message ?? "").includes("prescription"),
    deletePatient.json?.error?.message,
  );

  const deleteDoctor = await call(`/api/doctors/${alpha.doctorId}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "A doctor who has prescribed cannot be deleted",
    deleteDoctor.status === 409,
    `got ${deleteDoctor.status}`,
  );

  // -------------------------------------------------------------------------
  section("RBAC");
  const roles = await call("/api/roles?pageSize=100", { jar: alpha.jar });
  const roleId = (key: string) =>
    (roles.json.data.items as any[]).find((r) => r.key === key)?.id as string;

  check("A Pharmacist role is seeded", Boolean(roleId("pharmacist")));

  async function staffSession(
    label: string,
    key: string,
  ): Promise<{ jar: Jar; userId: string }> {
    const email = `${label}.${stamp}@pharmacy.test`;
    const created = await call("/api/users", {
      method: "POST",
      body: { name: label, email, roleId: roleId(key) },
      jar: alpha.jar,
    });
    const temp = created.json.data.temporaryPassword as string;
    const password = `Pharm${label}!2024`;
    const jar = await signIn(email, temp);
    await call("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: temp, newPassword: password, confirmPassword: password },
      jar,
    });
    const me = await call("/api/auth/me", { jar });
    return { jar, userId: me.json.data.user.id as string };
  }

  const clinician = await staffSession("clinician", "doctor");
  const { jar: doctorJar } = clinician;
  const { jar: pharmacistJar } = await staffSession("dispenser", "pharmacist");
  const { jar: receptionJar } = await staffSession("frontdesk", "receptionist");

  /**
   * An unlinked account is NOT blocked: the patient already has a doctor
   * through their bookings, so the prescription is signed by that assigned
   * doctor rather than refused.
   */
  const unlinkedWrites = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: alpha.otherPatientId,
      prescribedDate: TODAY,
      items: [{ drugName: "Metformin", dosage: "500mg" }],
    },
    jar: doctorJar,
  });
  check(
    "An account with no doctor profile CAN prescribe for a patient who has one",
    unlinkedWrites.status === 201,
    `got ${unlinkedWrites.status} ${JSON.stringify(unlinkedWrites.json?.error ?? "")}`,
  );
  check(
    "It is signed by the patient's assigned doctor",
    unlinkedWrites.json?.data?.doctor?.id === alpha.doctorId,
    `${unlinkedWrites.json?.data?.doctor?.id} vs ${alpha.doctorId}`,
  );

  // A patient nobody has ever booked, written by an unlinked account: there is
  // genuinely no one to sign it.
  const strangerPatient = await call("/api/patients", {
    method: "POST",
    body: {
      firstName: "Never",
      lastName: "Booked",
      phone: "+919876500399",
      email: `never.booked.${stamp}@pharmacy.test`,
    },
    jar: alpha.jar,
  });
  const noSigner = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: strangerPatient.json.data.id,
      prescribedDate: TODAY,
      items: [{ drugName: "Anything" }],
    },
    jar: doctorJar,
  });
  check(
    "No appointments and no linked profile leaves nobody to sign",
    noSigner.status === 422,
    `got ${noSigner.status}`,
  );
  check(
    "That refusal explains both ways out",
    String(noSigner.json?.error?.message ?? "").includes("no appointments"),
    noSigner.json?.error?.message,
  );

  const clinicianProfile = await call("/api/doctors", {
    method: "POST",
    body: {
      displayName: "Dr. Clinician",
      userId: clinician.userId,
      departmentIds: [alpha.departmentId],
    },
    jar: alpha.jar,
  });

  const doctorWrites = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: alpha.otherPatientId,
      prescribedDate: TODAY,
      items: [{ drugName: "Metformin", dosage: "500mg" }],
    },
    jar: doctorJar,
  });
  check(
    "Doctor CAN write a prescription once their account is linked",
    doctorWrites.status === 201,
    `got ${doctorWrites.status} ${JSON.stringify(doctorWrites.json?.error ?? "")}`,
  );
  check(
    "It is signed by their OWN profile, taken from the session",
    doctorWrites.json?.data?.doctor?.id === clinicianProfile.json?.data?.id,
    `${doctorWrites.json?.data?.doctor?.id} vs ${clinicianProfile.json?.data?.id}`,
  );
  /**
   * The safety property behind the resolution order: a linked doctor writing
   * for someone else's patient signs as THEMSELVES, never as the colleague the
   * patient is assigned to.
   */
  check(
    "Their own name wins over the patient's assigned doctor",
    doctorWrites.json?.data?.doctor?.id !== alpha.doctorId,
    `signed by ${doctorWrites.json?.data?.doctor?.id}, assigned doctor is ${alpha.doctorId}`,
  );
  const doctorWritten = doctorWrites.json?.data?.id as string;

  const doctorDispenses = await call(`/api/prescriptions/${doctorWritten}`, {
    method: "PUT",
    body: { status: "dispensed" },
    jar: doctorJar,
  });
  check(
    "Doctor CANNOT dispense (lacks prescription.dispense)",
    doctorDispenses.status === 403,
    `got ${doctorDispenses.status}`,
  );

  const pharmacistReads = await call("/api/prescriptions", { jar: pharmacistJar });
  check(
    "Pharmacist CAN read the queue",
    pharmacistReads.status === 200,
    `got ${pharmacistReads.status}`,
  );

  const pharmacistDispenses = await call(`/api/prescriptions/${doctorWritten}`, {
    method: "PUT",
    body: { status: "dispensed" },
    jar: pharmacistJar,
  });
  check(
    "Pharmacist CAN dispense",
    pharmacistDispenses.status === 200,
    `got ${pharmacistDispenses.status}`,
  );

  const pharmacistWrites = await call("/api/prescriptions", {
    method: "POST",
    body: {
      patientId: alpha.otherPatientId,
      prescribedDate: TODAY,
      items: [{ drugName: "Anything" }],
    },
    jar: pharmacistJar,
  });
  check(
    "Pharmacist CANNOT write a prescription",
    pharmacistWrites.status === 403,
    `got ${pharmacistWrites.status}`,
  );

  const pharmacistReadsVisits = await call("/api/visits", { jar: pharmacistJar });
  check(
    "Pharmacist CANNOT read consultation notes (holds no visit.view)",
    pharmacistReadsVisits.status === 403,
    `got ${pharmacistReadsVisits.status}`,
  );

  const receptionReads = await call("/api/prescriptions", { jar: receptionJar });
  check(
    "Receptionist CANNOT read prescriptions",
    receptionReads.status === 403,
    `got ${receptionReads.status}`,
  );

  const receptionContext = await call(
    `/api/patients/${alpha.patientId}/prescription-context`,
    { jar: receptionJar },
  );
  check(
    "Receptionist CANNOT open the prescribe dialog (it names a clinician)",
    receptionContext.status === 403,
    `got ${receptionContext.status}`,
  );

  const superAdminReads = await call("/api/prescriptions", { jar: superJar });
  check(
    "Super Admin cannot read a hospital's prescriptions (Section 3)",
    superAdminReads.status === 403,
    `got ${superAdminReads.status}`,
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
