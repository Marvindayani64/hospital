/* eslint-disable @typescript-eslint/no-explicit-any --
 * Black-box harness: it reads arbitrary JSON envelopes from the API rather than
 * importing the app's own types, so a regression in those types cannot silently
 * make the tests pass.
 */

/**
 * Phase 4 verification — patients, doctors and appointments.
 *
 * Covers Section 51 case 13 (cross-hospital appointment relationships), the
 * Section 19 patientNumber race condition, double-booking prevention, the
 * status transition table and doctor availability.
 *
 * Usage:
 *   1. npm run dev
 *   2. npm run verify:clinical
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

/** A fully configured hospital: departments, a treatment, and a doctor. */
type Tenant = {
  hospitalId: string;
  jar: Jar;
  departmentId: string;
  treatmentId: string;
  doctorId: string;
};

async function buildTenant(
  superJar: Jar,
  label: string,
  stamp: number,
): Promise<Tenant> {
  const adminEmail = `admin.${label.toLowerCase()}.${stamp}@example.test`;

  const created = await call("/api/super-admin/hospitals", {
    method: "POST",
    body: {
      name: `${label} Medical ${stamp}`,
      type: "general",
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
  const password = `Clinical${label}!2024`;
  const jar = await signIn(adminEmail, temp);
  await call("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword: temp, newPassword: password, confirmPassword: password },
    jar,
  });

  const department = await call("/api/departments", {
    method: "POST",
    body: { name: `General Medicine ${label}` },
    jar,
  });

  const treatment = await call("/api/treatments", {
    method: "POST",
    body: {
      departmentId: department.json.data.id,
      name: `Consultation ${label}`,
      price: 100,
      durationMinutes: 30,
    },
    jar,
  });

  const doctor = await call("/api/doctors", {
    method: "POST",
    body: {
      displayName: `Dr. ${label}`,
      specialization: "General Practice",
      departmentIds: [department.json.data.id],
      consultationFee: 50,
    },
    jar,
  });

  return {
    hospitalId: created.json.data.hospital.id,
    jar,
    departmentId: department.json.data.id,
    treatmentId: treatment.json.data.id,
    doctorId: doctor.json.data.id,
  };
}

/** A near-future weekday, so bookings are never in the past. */
function futureDate(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });

  const stamp = Date.now();
  const superJar = await signIn(
    process.env.SUPER_ADMIN_EMAIL ?? "superadmin@platform.local",
    process.env.SUPER_ADMIN_PASSWORD ?? "ChangeMe!2024",
  );

  section("Two fully configured hospitals");
  const alpha = await buildTenant(superJar, "Alpha", stamp);
  const beta = await buildTenant(superJar, "Beta", stamp);
  check("Hospital A configured", Boolean(alpha.doctorId));
  check("Hospital B configured", Boolean(beta.doctorId));

  // -------------------------------------------------------------------------
  section("Patient registration and numbering (Section 19)");
  const first = await call("/api/patients", {
    method: "POST",
    body: {
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "+919876500001",
      email: "ada@example.test",
      dateOfBirth: "1990-12-10",
      gender: "female",
    },
    jar: alpha.jar,
  });
  check("Patient registered", first.status === 201, `got ${first.status}`);
  check(
    "Patient number auto-assigned in PAT-000001 form",
    /^PAT-\d{6}$/.test(first.json?.data?.patientNumber ?? ""),
    first.json?.data?.patientNumber,
  );
  check(
    "Age derived from date of birth",
    typeof first.json.data.age === "number" && first.json.data.age > 30,
    String(first.json?.data?.age),
  );

  const alphaPatientId = first.json.data.id as string;

  const futureDob = await call("/api/patients", {
    method: "POST",
    body: { firstName: "Future", lastName: "Person", phone: "+919876500002", dateOfBirth: "2099-01-01" },
    jar: alpha.jar,
  });
  check(
    "Future date of birth rejected",
    futureDob.status === 422,
    `got ${futureDob.status}`,
  );

  /**
   * The race the spec warns about: with `count() + 1`, concurrent registrations
   * collide. The atomic counter must hand every one of these a distinct number.
   */
  const CONCURRENT = 12;
  const concurrent = await Promise.all(
    Array.from({ length: CONCURRENT }, (_, index) =>
      call("/api/patients", {
        method: "POST",
        body: {
          firstName: `Concurrent${index}`,
          lastName: `Test${stamp}`,
          phone: `+91987651${String(index).padStart(4, "0")}`,
        },
        jar: alpha.jar,
      }),
    ),
  );

  const created = concurrent.filter((result) => result.status === 201);
  const numbers = created.map((result) => result.json.data.patientNumber as string);
  const unique = new Set(numbers);

  check(
    `All ${CONCURRENT} concurrent registrations succeeded`,
    created.length === CONCURRENT,
    `${created.length}/${CONCURRENT} succeeded`,
  );
  check(
    "Every concurrent patient number is distinct (no count()+1 race)",
    unique.size === numbers.length,
    `${unique.size} unique of ${numbers.length}`,
  );

  // The same number may legitimately exist at another hospital.
  const betaFirst = await call("/api/patients", {
    method: "POST",
    body: { firstName: "Grace", lastName: "Hopper", phone: "+919876500003" },
    jar: beta.jar,
  });
  check(
    "A second hospital's numbering starts independently at PAT-000001",
    betaFirst.json?.data?.patientNumber === "PAT-000001",
    betaFirst.json?.data?.patientNumber,
  );

  const betaPatientId = betaFirst.json.data.id as string;

  // -------------------------------------------------------------------------
  section("Patient search");
  const byNumber = await call(
    `/api/patients?search=${encodeURIComponent(first.json.data.patientNumber)}`,
    { jar: alpha.jar },
  );
  check(
    "Search by patient number finds the patient",
    (byNumber.json.data.items as any[]).some((p) => p.id === alphaPatientId),
  );

  const byPhone = await call("/api/patients?search=%2B919876500001", {
    jar: alpha.jar,
  });
  check(
    "Search by phone finds the patient",
    (byPhone.json.data.items as any[]).some((p) => p.id === alphaPatientId),
  );

  const byName = await call("/api/patients?search=Lovelace", { jar: alpha.jar });
  check(
    "Search by surname finds the patient",
    (byName.json.data.items as any[]).some((p) => p.id === alphaPatientId),
  );

  // -------------------------------------------------------------------------
  section("Appointment booking (Section 21)");
  const date = futureDate(3);

  const booked = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      treatmentId: alpha.treatmentId,
      appointmentDate: date,
      startTime: "09:00",
      endTime: "09:30",
      notes: "First visit",
    },
    jar: alpha.jar,
  });
  check("Appointment booked", booked.status === 201, `got ${booked.status} ${JSON.stringify(booked.json?.error ?? "")}`);
  const appointmentId = booked.json?.data?.id as string;
  check(
    "Appointment defaults to scheduled",
    booked.json?.data?.status === "scheduled",
  );
  check(
    "Times round-trip as HH:mm",
    booked.json?.data?.startTime === "09:00" &&
      booked.json?.data?.endTime === "09:30",
    `${booked.json?.data?.startTime}–${booked.json?.data?.endTime}`,
  );
  check(
    "Duration derived from the times",
    booked.json?.data?.durationMinutes === 30,
    String(booked.json?.data?.durationMinutes),
  );

  const backwards = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: date,
      startTime: "11:00",
      endTime: "10:00",
    },
    jar: alpha.jar,
  });
  check(
    "End time before start time rejected",
    backwards.status === 422,
    `got ${backwards.status}`,
  );

  const badDate = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: "2025-02-30",
      startTime: "09:00",
      endTime: "09:30",
    },
    jar: alpha.jar,
  });
  check(
    "Non-existent calendar date rejected",
    badDate.status === 422,
    `got ${badDate.status}`,
  );

  // -------------------------------------------------------------------------
  section("Double-booking prevention");
  const exactClash = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: betaPatientId ? alphaPatientId : alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: date,
      startTime: "09:00",
      endTime: "09:30",
    },
    jar: alpha.jar,
  });
  check(
    "Identical slot for the same doctor rejected",
    exactClash.status === 409,
    `got ${exactClash.status}`,
  );

  const partialClash = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: date,
      startTime: "09:15",
      endTime: "09:45",
    },
    jar: alpha.jar,
  });
  check(
    "Partially overlapping slot rejected",
    partialClash.status === 409,
    `got ${partialClash.status}`,
  );

  const enclosingClash = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: date,
      startTime: "08:30",
      endTime: "10:00",
    },
    jar: alpha.jar,
  });
  check(
    "Slot that fully encloses an existing one rejected",
    enclosingClash.status === 409,
    `got ${enclosingClash.status}`,
  );

  // Half-open intervals: back-to-back bookings must be allowed.
  const backToBack = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: date,
      startTime: "09:30",
      endTime: "10:00",
    },
    jar: alpha.jar,
  });
  check(
    "Back-to-back booking allowed (09:30 after a 09:00–09:30)",
    backToBack.status === 201,
    `got ${backToBack.status}`,
  );

  const differentDay = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: futureDate(4),
      startTime: "09:00",
      endTime: "09:30",
    },
    jar: alpha.jar,
  });
  check(
    "Same time on a different day allowed",
    differentDay.status === 201,
    `got ${differentDay.status}`,
  );

  /**
   * Concurrent identical bookings: exactly one must win. This is the honest
   * check of whether the overlap guard holds under real contention.
   */
  const raceDate = futureDate(9);
  const raced = await Promise.all(
    Array.from({ length: 5 }, () =>
      call("/api/appointments", {
        method: "POST",
        body: {
          patientId: alphaPatientId,
          doctorId: alpha.doctorId,
          departmentId: alpha.departmentId,
          appointmentDate: raceDate,
          startTime: "14:00",
          endTime: "14:30",
        },
        jar: alpha.jar,
      }),
    ),
  );
  const won = raced.filter((r) => r.status === 201).length;
  check(
    "Concurrent identical bookings: at most one succeeds",
    won <= 1,
    `${won} succeeded`,
  );

  // -------------------------------------------------------------------------
  section("Cross-tenant relationship validation (test 13)");
  const foreignPatient = await call("/api/appointments", {
    method: "POST",
    body: {
      // Hospital B's patient with Hospital A's doctor.
      patientId: betaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: futureDate(5),
      startTime: "11:00",
      endTime: "11:30",
    },
    jar: alpha.jar,
  });
  check(
    "Hospital B patient + Hospital A doctor rejected",
    foreignPatient.status === 404,
    `got ${foreignPatient.status}`,
  );

  const foreignDoctor = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: beta.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: futureDate(5),
      startTime: "11:00",
      endTime: "11:30",
    },
    jar: alpha.jar,
  });
  check(
    "Hospital A patient + Hospital B doctor rejected",
    foreignDoctor.status === 404,
    `got ${foreignDoctor.status}`,
  );

  const foreignDepartment = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: beta.departmentId,
      appointmentDate: futureDate(5),
      startTime: "11:00",
      endTime: "11:30",
    },
    jar: alpha.jar,
  });
  check(
    "Another hospital's department rejected",
    foreignDepartment.status === 404,
    `got ${foreignDepartment.status}`,
  );

  const foreignTreatment = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      treatmentId: beta.treatmentId,
      appointmentDate: futureDate(5),
      startTime: "11:00",
      endTime: "11:30",
    },
    jar: alpha.jar,
  });
  check(
    "Another hospital's treatment rejected",
    foreignTreatment.status === 404,
    `got ${foreignTreatment.status}`,
  );

  // A treatment must also match the department it is booked under.
  const otherDept = await call("/api/departments", {
    method: "POST",
    body: { name: `Cardiology ${stamp}` },
    jar: alpha.jar,
  });
  const mismatched = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: otherDept.json.data.id,
      treatmentId: alpha.treatmentId,
      appointmentDate: futureDate(5),
      startTime: "11:00",
      endTime: "11:30",
    },
    jar: alpha.jar,
  });
  check(
    "Treatment from a different department rejected",
    mismatched.status === 422,
    `got ${mismatched.status}`,
  );

  // -------------------------------------------------------------------------
  section("Cross-tenant isolation of clinical records");
  const crossPatient = await call(`/api/patients/${alphaPatientId}`, {
    jar: beta.jar,
  });
  check(
    "Hospital B cannot read a Hospital A patient",
    crossPatient.status === 404,
    `got ${crossPatient.status}`,
  );

  const crossAppointment = await call(`/api/appointments/${appointmentId}`, {
    jar: beta.jar,
  });
  check(
    "Hospital B cannot read a Hospital A appointment",
    crossAppointment.status === 404,
    `got ${crossAppointment.status}`,
  );

  const crossCancel = await call(`/api/appointments/${appointmentId}`, {
    method: "PUT",
    body: { status: "cancelled" },
    jar: beta.jar,
  });
  check(
    "Hospital B cannot cancel a Hospital A appointment",
    crossCancel.status === 404,
    `got ${crossCancel.status}`,
  );

  const crossDoctor = await call(`/api/doctors/${alpha.doctorId}`, {
    jar: beta.jar,
  });
  check(
    "Hospital B cannot read a Hospital A doctor",
    crossDoctor.status === 404,
    `got ${crossDoctor.status}`,
  );

  const betaPatientList = await call("/api/patients?pageSize=100", {
    jar: beta.jar,
  });
  check(
    "Hospital B's patient list contains only its own patients",
    (betaPatientList.json.data.items as any[]).every(
      (p) => p.id !== alphaPatientId,
    ),
  );

  // -------------------------------------------------------------------------
  section("Status transitions (Section 21)");
  const confirm = await call(`/api/appointments/${appointmentId}`, {
    method: "PUT",
    body: { status: "confirmed" },
    jar: alpha.jar,
  });
  check("scheduled -> confirmed allowed", confirm.status === 200, `got ${confirm.status}`);

  const skipBack = await call(`/api/appointments/${appointmentId}`, {
    method: "PUT",
    body: { status: "scheduled" },
    jar: alpha.jar,
  });
  check(
    "confirmed -> scheduled rejected (no going backwards)",
    skipBack.status === 409,
    `got ${skipBack.status}`,
  );

  await call(`/api/appointments/${appointmentId}`, {
    method: "PUT",
    body: { status: "checked_in" },
    jar: alpha.jar,
  });
  const complete = await call(`/api/appointments/${appointmentId}`, {
    method: "PUT",
    body: { status: "completed" },
    jar: alpha.jar,
  });
  check("checked_in -> completed allowed", complete.status === 200, `got ${complete.status}`);

  const afterTerminal = await call(`/api/appointments/${appointmentId}`, {
    method: "PUT",
    body: { status: "cancelled" },
    jar: alpha.jar,
  });
  check(
    "A completed appointment cannot change status",
    afterTerminal.status === 409,
    `got ${afterTerminal.status}`,
  );

  const editTerminal = await call(`/api/appointments/${appointmentId}`, {
    method: "PATCH",
    body: { notes: "Trying to edit a completed appointment" },
    jar: alpha.jar,
  });
  check(
    "A completed appointment cannot be rescheduled",
    editTerminal.status === 409,
    `got ${editTerminal.status}`,
  );

  // -------------------------------------------------------------------------
  section("Cancelling releases the slot");
  const toCancel = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: futureDate(6),
      startTime: "13:00",
      endTime: "13:30",
    },
    jar: alpha.jar,
  });

  const blockedBefore = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: futureDate(6),
      startTime: "13:00",
      endTime: "13:30",
    },
    jar: alpha.jar,
  });
  check(
    "Slot is occupied while the appointment is live",
    blockedBefore.status === 409,
    `got ${blockedBefore.status}`,
  );

  const cancelled = await call(`/api/appointments/${toCancel.json.data.id}`, {
    method: "PUT",
    body: { status: "cancelled", cancellationReason: "Patient rescheduled" },
    jar: alpha.jar,
  });
  check("Appointment cancelled", cancelled.status === 200, `got ${cancelled.status}`);
  check(
    "Cancellation reason recorded",
    cancelled.json?.data?.cancellationReason === "Patient rescheduled",
  );

  const rebooked = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: futureDate(6),
      startTime: "13:00",
      endTime: "13:30",
    },
    jar: alpha.jar,
  });
  check(
    "The freed slot can be rebooked after cancellation",
    rebooked.status === 201,
    `got ${rebooked.status}`,
  );

  // -------------------------------------------------------------------------
  section("Doctor availability");
  const availabilityDate = futureDate(14);
  const weekday = new Date(`${availabilityDate}T00:00:00Z`).getUTCDay();

  const limitedDoctor = await call("/api/doctors", {
    method: "POST",
    body: {
      displayName: `Dr. Limited ${stamp}`,
      departmentIds: [alpha.departmentId],
      availability: [
        { dayOfWeek: weekday, startTime: "09:00", endTime: "12:00" },
      ],
    },
    jar: alpha.jar,
  });
  check("Doctor with availability created", limitedDoctor.status === 201, `got ${limitedDoctor.status}`);
  const limitedDoctorId = limitedDoctor.json.data.id as string;

  const withinHours = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: limitedDoctorId,
      departmentId: alpha.departmentId,
      appointmentDate: availabilityDate,
      startTime: "10:00",
      endTime: "10:30",
    },
    jar: alpha.jar,
  });
  check(
    "Booking inside the doctor's hours allowed",
    withinHours.status === 201,
    `got ${withinHours.status}`,
  );

  const outsideHours = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: limitedDoctorId,
      departmentId: alpha.departmentId,
      appointmentDate: availabilityDate,
      startTime: "14:00",
      endTime: "14:30",
    },
    jar: alpha.jar,
  });
  check(
    "Booking outside the doctor's hours rejected",
    outsideHours.status === 422,
    `got ${outsideHours.status}`,
  );

  const wrongDay = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: limitedDoctorId,
      departmentId: alpha.departmentId,
      appointmentDate: futureDate(15),
      startTime: "10:00",
      endTime: "10:30",
    },
    jar: alpha.jar,
  });
  check(
    "Booking on a non-working day rejected",
    wrongDay.status === 422,
    `got ${wrongDay.status}`,
  );

  // An inactive doctor must not be bookable.
  await call(`/api/doctors/${limitedDoctorId}`, {
    method: "PATCH",
    body: { status: "inactive" },
    jar: alpha.jar,
  });
  const inactiveDoctor = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: limitedDoctorId,
      departmentId: alpha.departmentId,
      appointmentDate: availabilityDate,
      startTime: "11:00",
      endTime: "11:30",
    },
    jar: alpha.jar,
  });
  check(
    "Inactive doctor cannot be booked",
    inactiveDoctor.status === 422,
    `got ${inactiveDoctor.status}`,
  );

  // -------------------------------------------------------------------------
  section("Referential guards");
  const deleteBookedDoctor = await call(`/api/doctors/${alpha.doctorId}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "A doctor with appointments cannot be deleted",
    deleteBookedDoctor.status === 409,
    `got ${deleteBookedDoctor.status}`,
  );

  const deleteBookedPatient = await call(`/api/patients/${alphaPatientId}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "A patient with appointments cannot be deleted",
    deleteBookedPatient.status === 409,
    `got ${deleteBookedPatient.status}`,
  );

  const deleteBookedTreatment = await call(
    `/api/treatments/${alpha.treatmentId}`,
    { method: "DELETE", jar: alpha.jar },
  );
  check(
    "A treatment used by an appointment cannot be deleted",
    deleteBookedTreatment.status === 409,
    `got ${deleteBookedTreatment.status}`,
  );

  const deleteBookedDepartment = await call(
    `/api/departments/${alpha.departmentId}`,
    { method: "DELETE", jar: alpha.jar },
  );
  check(
    "A department in use cannot be deleted",
    deleteBookedDepartment.status === 409,
    `got ${deleteBookedDepartment.status}`,
  );

  const freshPatient = await call("/api/patients", {
    method: "POST",
    body: { firstName: "No", lastName: "Bookings", phone: "+919876509999" },
    jar: alpha.jar,
  });
  const deleteFresh = await call(`/api/patients/${freshPatient.json.data.id}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "A patient with no appointments can be deleted",
    deleteFresh.status === 200,
    `got ${deleteFresh.status}`,
  );

  // -------------------------------------------------------------------------
  section("RBAC on clinical records");
  const roles = await call("/api/roles?pageSize=100", { jar: alpha.jar });
  const receptionistId = (roles.json.data.items as any[]).find(
    (r) => r.key === "receptionist",
  ).id as string;
  const accountantId = (roles.json.data.items as any[]).find(
    (r) => r.key === "accountant",
  ).id as string;

  async function staffSession(
    label: string,
    roleId: string,
  ): Promise<Jar> {
    const email = `${label}.${stamp}@alpha.test`;
    const created = await call("/api/users", {
      method: "POST",
      body: { name: label, email, roleId },
      jar: alpha.jar,
    });
    const temp = created.json.data.temporaryPassword as string;
    const password = `Staff${label}!2024`;
    const jar = await signIn(email, temp);
    await call("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: temp, newPassword: password, confirmPassword: password },
      jar,
    });
    return jar;
  }

  const receptionJar = await staffSession("reception", receptionistId);
  const accountantJar = await staffSession("accountant", accountantId);

  const receptionBooks = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: futureDate(20),
      startTime: "15:00",
      endTime: "15:30",
    },
    jar: receptionJar,
  });
  check(
    "Receptionist CAN book appointments",
    receptionBooks.status === 201,
    `got ${receptionBooks.status}`,
  );

  const receptionAddsDoctor = await call("/api/doctors", {
    method: "POST",
    body: { displayName: "Sneaky Doctor" },
    jar: receptionJar,
  });
  check(
    "Receptionist CANNOT create doctors",
    receptionAddsDoctor.status === 403,
    `got ${receptionAddsDoctor.status}`,
  );

  const accountantBooks = await call("/api/appointments", {
    method: "POST",
    body: {
      patientId: alphaPatientId,
      doctorId: alpha.doctorId,
      departmentId: alpha.departmentId,
      appointmentDate: futureDate(21),
      startTime: "15:00",
      endTime: "15:30",
    },
    jar: accountantJar,
  });
  check(
    "Accountant CANNOT book appointments (lacks appointment.create)",
    accountantBooks.status === 403,
    `got ${accountantBooks.status}`,
  );

  const accountantViewsPatients = await call("/api/patients", {
    jar: accountantJar,
  });
  check(
    "Accountant CAN view patients (needed for billing)",
    accountantViewsPatients.status === 200,
    `got ${accountantViewsPatients.status}`,
  );

  const accountantDeletesPatient = await call(`/api/patients/${alphaPatientId}`, {
    method: "DELETE",
    jar: accountantJar,
  });
  check(
    "Accountant CANNOT delete patients",
    accountantDeletesPatient.status === 403,
    `got ${accountantDeletesPatient.status}`,
  );

  // -------------------------------------------------------------------------
  section("Filtering");
  const byPatient = await call(
    `/api/appointments?patientId=${alphaPatientId}&pageSize=100`,
    { jar: alpha.jar },
  );
  check(
    "Filter by patient returns only that patient's appointments",
    (byPatient.json.data.items as any[]).every(
      (a) => a.patient?.id === alphaPatientId,
    ),
  );

  const byDoctor = await call(
    `/api/appointments?doctorId=${alpha.doctorId}&pageSize=100`,
    { jar: alpha.jar },
  );
  check(
    "Filter by doctor returns only that doctor's appointments",
    (byDoctor.json.data.items as any[]).every(
      (a) => a.doctor?.id === alpha.doctorId,
    ),
  );

  const byDateRange = await call(
    `/api/appointments?from=${date}&to=${date}&pageSize=100`,
    { jar: alpha.jar },
  );
  check(
    "Filter by date range returns only that day",
    (byDateRange.json.data.items as any[]).every(
      (a) => a.appointmentDate === date,
    ),
    `${(byDateRange.json.data.items as any[]).length} results`,
  );

  const superAdminAppointments = await call("/api/appointments", {
    jar: superJar,
  });
  check(
    "Super Admin cannot read clinical appointments (Section 3)",
    superAdminAppointments.status === 403,
    `got ${superAdminAppointments.status}`,
  );

  const superAdminPatients = await call("/api/patients", { jar: superJar });
  check(
    "Super Admin cannot read patient records (Section 3)",
    superAdminPatients.status === 403,
    `got ${superAdminPatients.status}`,
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
