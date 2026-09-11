/* eslint-disable @typescript-eslint/no-explicit-any --
 * Black-box harness: it reads arbitrary JSON envelopes from the API rather than
 * importing the app's own types, so a regression in those types cannot silently
 * make the tests pass.
 */

/**
 * Phase 6 verification — visits and consultations.
 *
 * Covers Section 26 (clinical records), cross-tenant relationship validation,
 * and the referential guards that visits add to earlier modules.
 *
 * Usage:
 *   1. npm run dev
 *   2. npm run verify:visits
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

function futureDate(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

type Tenant = {
  jar: Jar;
  patientId: string;
  doctorId: string;
  departmentId: string;
  treatmentId: string;
};

/** A hospital configured end to end: department, treatment, doctor, patient. */
async function buildTenant(
  superJar: Jar,
  label: string,
  stamp: number,
): Promise<Tenant> {
  const adminEmail = `admin.${label.toLowerCase()}.${stamp}@example.test`;

  const created = await call("/api/super-admin/hospitals", {
    method: "POST",
    body: {
      name: `${label} Visits Clinic ${stamp}`,
      type: "clinic",
      email: `contact.${label.toLowerCase()}.${stamp}@example.test`,
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
  const password = `Visits${label}!2024`;
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
    body: {
      firstName: label,
      lastName: "Patient",
      phone: "+919876500200",
      email: `patient.${label.toLowerCase()}.${stamp}@visits.test`,
    },
    jar,
  });

  return {
    jar,
    patientId: patient.json.data.id,
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
  section("Recording a visit (Section 26)");
  const walkIn = await call("/api/visits", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      doctorId: alpha.doctorId,
      visitDate: TODAY,
      symptoms: "Persistent headache for two weeks.",
      diagnosis: "Tension-type headache",
      recommendations: "Hydration, sleep hygiene, review in one month.",
      notes: "No red flags on examination.",
      followUpDate: futureDate(30),
    },
    jar: alpha.jar,
  });
  check("Walk-in visit recorded without an appointment", walkIn.status === 201, `got ${walkIn.status} ${JSON.stringify(walkIn.json?.error ?? "")}`);
  const walkInId = walkIn.json?.data?.id as string;
  check(
    "Clinical fields round-trip",
    walkIn.json.data.diagnosis === "Tension-type headache" &&
      walkIn.json.data.symptoms.startsWith("Persistent headache"),
  );
  check(
    "Follow-up date stored",
    walkIn.json.data.followUpDate === futureDate(30),
    walkIn.json?.data?.followUpDate,
  );

  const secondWalkIn = await call("/api/visits", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      doctorId: alpha.doctorId,
      visitDate: TODAY,
      diagnosis: "Review",
    },
    jar: alpha.jar,
  });
  check(
    "Multiple walk-in visits are allowed (null appointment does not collide)",
    secondWalkIn.status === 201,
    `got ${secondWalkIn.status}`,
  );

  const backwardsFollowUp = await call("/api/visits", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      doctorId: alpha.doctorId,
      visitDate: TODAY,
      followUpDate: "2020-01-01",
    },
    jar: alpha.jar,
  });
  check(
    "A follow-up date before the visit date is rejected",
    backwardsFollowUp.status === 422,
    `got ${backwardsFollowUp.status}`,
  );

  // -------------------------------------------------------------------------
  section("Visits from appointments");
  const appointment = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      treatmentId: alpha.treatmentId,
      appointmentDate: futureDate(1),
      startTime: "09:00",
      endTime: "09:30",
    },
    jar: alpha.jar,
  });
  const appointmentId = appointment.json.data.id as string;

  const fromAppointment = await call("/api/visits", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      doctorId: alpha.doctorId,
      appointmentId,
      treatmentId: alpha.treatmentId,
      visitDate: futureDate(1),
      diagnosis: "Seen as scheduled",
    },
    jar: alpha.jar,
  });
  check(
    "Visit recorded against an appointment",
    fromAppointment.status === 201,
    `got ${fromAppointment.status}`,
  );
  const appointmentVisitId = fromAppointment.json.data.id as string;

  const duplicateVisit = await call("/api/visits", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      doctorId: alpha.doctorId,
      appointmentId,
      visitDate: futureDate(1),
    },
    jar: alpha.jar,
  });
  check(
    "An appointment yields at most one visit",
    duplicateVisit.status === 409,
    `got ${duplicateVisit.status}`,
  );

  // Another patient's appointment must not accept this patient's visit.
  const otherPatient = await call("/api/patients", {
    method: "POST",
    body: {
      firstName: "Other",
      lastName: "Person",
      phone: "+919876500999",
      email: `other.person.${stamp}@visits.test`,
    },
    jar: alpha.jar,
  });
  const mismatchedAppointment = await call("/api/visits", {
    method: "POST",
    body: {
      patientId: otherPatient.json.data.id,
      doctorId: alpha.doctorId,
      appointmentId,
      visitDate: futureDate(1),
    },
    jar: alpha.jar,
  });
  check(
    "An appointment belonging to another patient is rejected",
    mismatchedAppointment.status === 422,
    `got ${mismatchedAppointment.status}`,
  );

  // -------------------------------------------------------------------------
  section("Clinical records cannot be reassigned");
  const reassign = await call(`/api/visits/${walkInId}`, {
    method: "PATCH",
    body: { patientId: otherPatient.json.data.id },
    jar: alpha.jar,
  });
  const afterReassign = await call(`/api/visits/${walkInId}`, {
    jar: alpha.jar,
  });
  check(
    "patientId is ignored by the update schema, not applied",
    afterReassign.json.data.patient.id === alpha.patientId,
    `patient is now ${afterReassign.json?.data?.patient?.id}`,
  );
  void reassign;

  const reassignAppointment = await call(`/api/visits/${appointmentVisitId}`, {
    method: "PATCH",
    body: { appointmentId: null },
    jar: alpha.jar,
  });
  const afterAppointmentEdit = await call(`/api/visits/${appointmentVisitId}`, {
    jar: alpha.jar,
  });
  check(
    "appointmentId is likewise not editable",
    afterAppointmentEdit.json.data.appointmentId === appointmentId,
    `appointment is now ${afterAppointmentEdit.json?.data?.appointmentId}`,
  );
  void reassignAppointment;

  const noDelete = await call(`/api/visits/${walkInId}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "There is no DELETE for a clinical record",
    noDelete.status === 405 || noDelete.status === 404,
    `got ${noDelete.status}`,
  );

  // -------------------------------------------------------------------------
  section("Cross-tenant isolation");
  const crossRead = await call(`/api/visits/${walkInId}`, { jar: beta.jar });
  check(
    "Hospital B cannot read a Hospital A visit",
    crossRead.status === 404,
    `got ${crossRead.status}`,
  );

  const crossUpdate = await call(`/api/visits/${walkInId}`, {
    method: "PATCH",
    body: { diagnosis: "Tampered" },
    jar: beta.jar,
  });
  check(
    "Hospital B cannot amend a Hospital A visit",
    crossUpdate.status === 404,
    `got ${crossUpdate.status}`,
  );

  const crossPatientVisit = await call("/api/visits", {
    method: "POST",
    body: {
      // Hospital B's patient with Hospital A's doctor.
      patientId: beta.patientId,
      doctorId: alpha.doctorId,
      visitDate: TODAY,
    },
    jar: alpha.jar,
  });
  check(
    "A patient from another hospital is rejected",
    crossPatientVisit.status === 404,
    `got ${crossPatientVisit.status}`,
  );

  const crossDoctorVisit = await call("/api/visits", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      doctorId: beta.doctorId,
      visitDate: TODAY,
    },
    jar: alpha.jar,
  });
  check(
    "A doctor from another hospital is rejected",
    crossDoctorVisit.status === 404,
    `got ${crossDoctorVisit.status}`,
  );

  const crossTreatmentVisit = await call("/api/visits", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      doctorId: alpha.doctorId,
      treatmentId: beta.treatmentId,
      visitDate: TODAY,
    },
    jar: alpha.jar,
  });
  check(
    "A treatment from another hospital is rejected",
    crossTreatmentVisit.status === 404,
    `got ${crossTreatmentVisit.status}`,
  );

  const betaVisits = await call("/api/visits?pageSize=100", { jar: beta.jar });
  check(
    "Hospital B's visit list excludes Hospital A's records",
    !(betaVisits.json.data.items as any[]).some((v) => v.id === walkInId),
  );

  const intact = await call(`/api/visits/${walkInId}`, { jar: alpha.jar });
  check(
    "Hospital A's record survived every cross-tenant attempt",
    intact.json.data.diagnosis === "Tension-type headache",
    intact.json?.data?.diagnosis,
  );

  // -------------------------------------------------------------------------
  section("Referential guards added by visits");
  const deleteAppointment = await call(`/api/appointments/${appointmentId}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "An appointment with a recorded visit cannot be deleted",
    deleteAppointment.status === 409,
    `got ${deleteAppointment.status}`,
  );

  const deleteDoctor = await call(`/api/doctors/${alpha.doctorId}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "A doctor with visits cannot be deleted",
    deleteDoctor.status === 409,
    `got ${deleteDoctor.status}`,
  );

  const deletePatient = await call(`/api/patients/${alpha.patientId}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "A patient with clinical history cannot be deleted",
    deletePatient.status === 409,
    `got ${deletePatient.status}`,
  );

  const deleteTreatment = await call(`/api/treatments/${alpha.treatmentId}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "A treatment used by a visit cannot be deleted",
    deleteTreatment.status === 409,
    `got ${deleteTreatment.status}`,
  );

  // -------------------------------------------------------------------------
  section("Filtering");
  const byPatient = await call(
    `/api/visits?patientId=${alpha.patientId}&pageSize=100`,
    { jar: alpha.jar },
  );
  check(
    "Filter by patient returns only that patient's visits",
    (byPatient.json.data.items as any[]).every(
      (v) => v.patient?.id === alpha.patientId,
    ),
  );

  const byDoctor = await call(
    `/api/visits?doctorId=${alpha.doctorId}&pageSize=100`,
    { jar: alpha.jar },
  );
  check(
    "Filter by doctor returns only that doctor's visits",
    (byDoctor.json.data.items as any[]).every(
      (v) => v.doctor?.id === alpha.doctorId,
    ),
  );

  const followUps = await call(
    `/api/visits?followUpBefore=${futureDate(60)}&pageSize=100`,
    { jar: alpha.jar },
  );
  check(
    "Follow-up filter returns only visits with a due follow-up",
    (followUps.json.data.items as any[]).every((v) => v.followUpDate !== null),
    `${(followUps.json.data.items as any[]).length} results`,
  );

  const searchDiagnosis = await call("/api/visits?search=Tension", {
    jar: alpha.jar,
  });
  check(
    "Search matches on diagnosis",
    (searchDiagnosis.json.data.items as any[]).some((v) => v.id === walkInId),
  );

  // -------------------------------------------------------------------------
  section("RBAC on clinical records");
  const roles = await call("/api/roles?pageSize=100", { jar: alpha.jar });
  const doctorRoleId = (roles.json.data.items as any[]).find(
    (r) => r.key === "doctor",
  ).id as string;
  const receptionistRoleId = (roles.json.data.items as any[]).find(
    (r) => r.key === "receptionist",
  ).id as string;

  async function staffSession(label: string, roleId: string): Promise<Jar> {
    const email = `${label}.${stamp}@visits.test`;
    const created = await call("/api/users", {
      method: "POST",
      body: { name: label, email, roleId },
      jar: alpha.jar,
    });
    const temp = created.json.data.temporaryPassword as string;
    const password = `Visits${label}!2024`;
    const jar = await signIn(email, temp);
    await call("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: temp, newPassword: password, confirmPassword: password },
      jar,
    });
    return jar;
  }

  const doctorJar = await staffSession("clinician", doctorRoleId);
  const receptionJar = await staffSession("frontdesk", receptionistRoleId);

  const doctorRecords = await call("/api/visits", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      doctorId: alpha.doctorId,
      visitDate: TODAY,
      diagnosis: "Recorded by the treating clinician",
    },
    jar: doctorJar,
  });
  check(
    "Doctor CAN record a visit",
    doctorRecords.status === 201,
    `got ${doctorRecords.status}`,
  );

  const doctorAmends = await call(`/api/visits/${walkInId}`, {
    method: "PATCH",
    body: { notes: "Amended by clinician" },
    jar: doctorJar,
  });
  check(
    "Doctor CAN amend a visit",
    doctorAmends.status === 200,
    `got ${doctorAmends.status}`,
  );

  const receptionReads = await call("/api/visits", { jar: receptionJar });
  check(
    "Receptionist CANNOT read clinical records (lacks visit.view)",
    receptionReads.status === 403,
    `got ${receptionReads.status}`,
  );

  const receptionRecords = await call("/api/visits", {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      doctorId: alpha.doctorId,
      visitDate: TODAY,
    },
    jar: receptionJar,
  });
  check(
    "Receptionist CANNOT record a visit",
    receptionRecords.status === 403,
    `got ${receptionRecords.status}`,
  );

  const superAdminVisits = await call("/api/visits", { jar: superJar });
  check(
    "Super Admin cannot read clinical records (Section 3)",
    superAdminVisits.status === 403,
    `got ${superAdminVisits.status}`,
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
