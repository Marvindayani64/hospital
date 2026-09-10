/**
 * Seeds a fully-populated demo hospital for manual testing.
 *
 *   npm run dev          (in one terminal)
 *   npm run seed:demo    (in another)
 *
 * Creates a hospital with staff, patients, appointments, visits and
 * billing already in place, so every screen has something on it. All accounts
 * use known passwords and have their forced password change already completed.
 *
 * Safe to run repeatedly — each run creates a fresh, separate hospital.
 */
export {};

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

type Cookie = { value: string; path: string };

class Jar {
  private cookies = new Map<string, Cookie>();
  absorb(r: Response) {
    for (const line of r.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split("; ");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      const p = attrs.find((a) => a.toLowerCase().startsWith("path="));
      const m = attrs.find((a) => a.toLowerCase().startsWith("max-age="));
      if (value === "" || m?.endsWith("=0")) this.cookies.delete(name);
      else this.cookies.set(name, { value, path: p ? p.slice(5) : "/" });
    }
  }
  header(path: string) {
    return [...this.cookies.entries()]
      .filter(([, c]) => path.startsWith(c.path))
      .map(([n, c]) => `${n}=${c.value}`)
      .join("; ");
  }
  get(n: string) {
    return this.cookies.get(n)?.value;
  }
}

async function call(
  path: string,
  o: { method?: string; body?: unknown; jar?: Jar } = {},
) {
  const { method = "GET", body, jar } = o;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (jar) {
    const c = jar.header(path);
    if (c) headers.Cookie = c;
    const csrf = jar.get("csrf_token");
    if (csrf && method !== "GET") headers["x-csrf-token"] = csrf;
  }
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (jar) jar.absorb(r);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  try {
    json = await r.json();
  } catch {
    /* HTML */
  }
  return { status: r.status, json };
}

async function signIn(email: string, password: string) {
  const jar = new Jar();
  await call("/login", { jar });
  const r = await call("/api/auth/login", {
    method: "POST",
    body: { email, password },
    jar,
  });
  return { jar, status: r.status };
}

/** Signs in with a temporary password and completes the forced change. */
async function activate(email: string, temp: string, password: string) {
  const { jar, status } = await signIn(email, temp);
  if (status !== 200) throw new Error(`Login failed for ${email}: ${status}`);
  await call("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword: temp, newPassword: password, confirmPassword: password },
    jar,
  });
  return jar;
}

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

async function main() {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });

  const superEmail = process.env.SUPER_ADMIN_EMAIL ?? "superadmin@platform.local";
  const superPassword = process.env.SUPER_ADMIN_PASSWORD ?? "ChangeMe!2024";

  const health = await fetch(BASE).catch(() => null);
  if (!health) {
    console.error(`Cannot reach ${BASE}. Start the app first:  npm run dev`);
    process.exitCode = 1;
    return;
  }

  const superIn = await signIn(superEmail, superPassword);
  if (superIn.status !== 200) {
    console.error(
      `Super Admin login failed (${superIn.status}). Run:  npm run seed`,
    );
    process.exitCode = 1;
    return;
  }
  const superJar = superIn.jar;

  // A short suffix keeps repeat runs from colliding on unique names/emails.
  const tag = Date.now().toString(36).slice(-4);
  const domain = `demo${tag}.test`;
  const PASSWORD = "Demo!2024Pass";

  console.log("Creating demo hospital…");

  const hospital = await call("/api/super-admin/hospitals", {
    method: "POST",
    body: {
      name: `Riverside Hospital ${tag}`,
      type: "multi_specialty",
      email: `contact@${domain}`,
      phone: "+1 555 0100",
      address: "42 Riverside Avenue",
      city: "Springfield",
      state: "IL",
      country: "USA",
      postalCode: "62701",
      status: "active",
      currency: "USD",
      adminName: "Dr. Alice Morgan",
      adminEmail: `admin@${domain}`,
    },
    jar: superJar,
  });

  if (hospital.status !== 201) {
    console.error("Could not create the hospital:", hospital.status, hospital.json?.error);
    process.exitCode = 1;
    return;
  }

  const jar = await activate(
    `admin@${domain}`,
    hospital.json.data.temporaryPassword,
    PASSWORD,
  );

  // ---- Departments & treatments -------------------------------------------
  console.log("Adding departments and treatments…");

  const departments: Record<string, string> = {};
  for (const name of ["General Practice", "Dermatology", "Dentistry"]) {
    const d = await call("/api/departments", {
      method: "POST",
      body: { name, description: `${name} services and consultations.` },
      jar,
    });
    departments[name] = d.json.data.id;
  }

  const treatments: Record<string, string> = {};
  const catalogue: Array<[string, string, number, number]> = [
    ["General Practice", "Standard Consultation", 120, 30],
    ["General Practice", "Extended Consultation", 195.5, 60],
    ["Dermatology", "Skin Assessment", 250, 45],
    ["Dermatology", "Mole Removal", 480, 60],
    ["Dentistry", "Dental Check-up", 95, 30],
    ["Dentistry", "Scale and Polish", 140.75, 45],
  ];
  for (const [dept, name, price, durationMinutes] of catalogue) {
    const t = await call("/api/treatments", {
      method: "POST",
      body: { departmentId: departments[dept], name, price, durationMinutes },
      jar,
    });
    treatments[name] = t.json.data.id;
  }

  // ---- Doctors -------------------------------------------------------------
  console.log("Adding doctors…");

  const doctors: Record<string, string> = {};
  const doctorSpecs: Array<[string, string, string[], number]> = [
    ["Dr. Alice Morgan", "General Practice", ["General Practice"], 120],
    ["Dr. Ben Okafor", "Dermatology", ["Dermatology"], 250],
    ["Dr. Chloe Reyes", "Dentistry", ["Dentistry", "General Practice"], 95],
  ];
  for (const [displayName, specialization, depts, fee] of doctorSpecs) {
    const d = await call("/api/doctors", {
      method: "POST",
      body: {
        displayName,
        specialization,
        departmentIds: depts.map((name) => departments[name]),
        consultationFee: fee,
        // Weekdays, 09:00–17:00.
        availability: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: "09:00",
          endTime: "17:00",
        })),
      },
      jar,
    });
    doctors[displayName] = d.json.data.id;
  }

  // ---- Staff ---------------------------------------------------------------
  console.log("Adding staff…");

  const roles = await call("/api/roles?pageSize=100", { jar });
  const roleByKey = new Map<string, string>(
    (roles.json.data.items as Array<{ key: string; id: string }>).map((r) => [
      r.key,
      r.id,
    ]),
  );

  const staffAccounts: Array<[string, string, string]> = [
    ["Rita Fernandez", "reception", "receptionist"],
    ["Dr. Ben Okafor", "doctor", "doctor"],
    ["Sam Whitfield", "accounts", "accountant"],
    ["Nadia Hassan", "nurse", "nurse"],
  ];

  const created: Array<[string, string, string]> = [];
  for (const [name, local, roleKey] of staffAccounts) {
    const email = `${local}@${domain}`;
    const u = await call("/api/users", {
      method: "POST",
      body: { name, email, roleId: roleByKey.get(roleKey) },
      jar,
    });
    if (u.status === 201) {
      await activate(email, u.json.data.temporaryPassword, PASSWORD);
      created.push([name, email, roleKey]);
    }
  }

  // ---- Patients ------------------------------------------------------------
  console.log("Registering patients…");

  const patients: string[] = [];
  const people: Array<[string, string, string, string, string]> = [
    ["Jane", "Doe", "+91 98765 40111", "1988-04-12", "female"],
    ["Michael", "Chen", "+91 98765 40112", "1975-11-03", "male"],
    ["Priya", "Sharma", "+91 98765 40113", "1994-07-22", "female"],
    ["Tom", "Baker", "+91 98765 40114", "1962-01-30", "male"],
    ["Aisha", "Bello", "+91 98765 40115", "2001-09-08", "female"],
  ];
  for (const [firstName, lastName, phone, dateOfBirth, gender] of people) {
    const p = await call("/api/patients", {
      method: "POST",
      body: {
        firstName,
        lastName,
        phone,
        email: `${firstName.toLowerCase()}@${domain}`,
        dateOfBirth,
        gender,
        address: "12 Elm Street, Springfield",
        emergencyContact: {
          name: "Next of Kin",
          relationship: "Spouse",
          phone: "+91 98765 40199",
        },
      },
      jar,
    });
    if (p.status === 201) patients.push(p.json.data.id);
  }

  // ---- Appointments --------------------------------------------------------
  console.log("Booking appointments…");

  const bookings: Array<[number, string, string, string, string, string]> = [
    [0, "09:00", "09:30", "Dr. Alice Morgan", "General Practice", "Standard Consultation"],
    [0, "10:00", "10:45", "Dr. Ben Okafor", "Dermatology", "Skin Assessment"],
    [0, "11:00", "11:30", "Dr. Chloe Reyes", "Dentistry", "Dental Check-up"],
    [1, "09:30", "10:30", "Dr. Alice Morgan", "General Practice", "Extended Consultation"],
    [2, "14:00", "14:45", "Dr. Ben Okafor", "Dermatology", "Mole Removal"],
  ];

  const appointmentIds: string[] = [];
  for (const [i, [dayOffset, startTime, endTime, doctor, dept, treatment]] of
    bookings.entries()) {
    const a = await call("/api/appointments", {
      method: "POST",
      body: {
        patientId: patients[i % patients.length],
        doctorId: doctors[doctor],
        departmentId: departments[dept],
        treatmentId: treatments[treatment],
        appointmentDate: dateOffset(dayOffset),
        startTime,
        endTime,
        notes: "Booked via demo seed.",
      },
      jar,
    });
    if (a.status === 201) appointmentIds.push(a.json.data.id);
  }

  // Move today's first appointment along the lifecycle so statuses vary.
  if (appointmentIds[0]) {
    await call(`/api/appointments/${appointmentIds[0]}`, {
      method: "PUT",
      body: { status: "confirmed" },
      jar,
    });
  }

  // ---- Visits --------------------------------------------------------------
  console.log("Recording visits…");

  await call("/api/visits", {
    method: "POST",
    body: {
      patientId: patients[0],
      doctorId: doctors["Dr. Alice Morgan"],
      appointmentId: appointmentIds[0],
      treatmentId: treatments["Standard Consultation"],
      visitDate: TODAY,
      symptoms: "Persistent headaches for two weeks, worse in the afternoon.",
      diagnosis: "Tension-type headache",
      recommendations: "Hydration, regular breaks from screens, review in one month.",
      notes: "No neurological red flags on examination.",
      followUpDate: dateOffset(30),
    },
    jar,
  });

  await call("/api/visits", {
    method: "POST",
    body: {
      patientId: patients[1],
      doctorId: doctors["Dr. Ben Okafor"],
      visitDate: TODAY,
      symptoms: "Irregular mole on left shoulder.",
      diagnosis: "Benign naevus — monitoring advised",
      recommendations: "Photograph and review in three months.",
      followUpDate: dateOffset(90),
    },
    jar,
  });

  // ---- Billing -------------------------------------------------------------
  console.log("Raising invoices…");

  // Paid in full.
  const inv1 = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: patients[0],
      items: [{ treatmentId: treatments["Standard Consultation"], quantity: 1 }],
      taxRatePercent: 8.5,
      notes: "Consultation on " + TODAY,
    },
    jar,
  });
  await call(`/api/invoices/${inv1.json.data.id}`, {
    method: "PUT",
    body: { status: "issued" },
    jar,
  });
  await call("/api/payments", {
    method: "POST",
    body: {
      invoiceId: inv1.json.data.id,
      amount: inv1.json.data.totalMinor / 100,
      method: "card",
      reference: "TXN-88213",
    },
    jar,
  });

  // Part-paid, so a balance shows on the dashboard.
  const inv2 = await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: patients[1],
      items: [
        { treatmentId: treatments["Skin Assessment"], quantity: 1 },
        { treatmentId: treatments["Mole Removal"], quantity: 1 },
      ],
      discountType: "percent",
      discountValue: 10,
      taxRatePercent: 8.5,
    },
    jar,
  });
  await call(`/api/invoices/${inv2.json.data.id}`, {
    method: "PUT",
    body: { status: "issued" },
    jar,
  });
  await call("/api/payments", {
    method: "POST",
    body: { invoiceId: inv2.json.data.id, amount: 200, method: "cash" },
    jar,
  });

  // Left as a draft, so the draft controls are visible too.
  await call("/api/invoices", {
    method: "POST",
    body: {
      patientId: patients[2],
      items: [{ treatmentId: treatments["Dental Check-up"], quantity: 1 }],
      taxRatePercent: 8.5,
    },
    jar,
  });

  // ---- Settings ------------------------------------------------------------
  await call("/api/hospital/settings", {
    method: "PATCH",
    body: {
      defaultTaxRatePercent: 8.5,
      invoiceFooter: "Payment due within 30 days. Thank you for choosing Riverside.",
      appointmentSlotMinutes: 30,
    },
    jar,
  });

  // ==========================================================================
  const line = "=".repeat(64);
  console.log(`\n${line}`);
  console.log("  DEMO HOSPITAL READY");
  console.log(line);
  console.log(`\n  Open:  ${BASE}/login\n`);

  console.log("  PLATFORM (Super Admin)");
  console.log("  ─────────────────────────────────────────────────────────");
  console.log(`  Email     ${superEmail}`);
  console.log(`  Password  ${superPassword}`);
  console.log("  Sees      Hospitals list, create hospital, platform stats");
  console.log("            (deliberately NO access to patient data)\n");

  console.log(`  HOSPITAL: Riverside Hospital ${tag}`);
  console.log("  ─────────────────────────────────────────────────────────");
  console.log(`  Password for ALL accounts below:  ${PASSWORD}\n`);
  console.log(`  Hospital Admin   admin@${domain}`);
  console.log("                   Full access to every screen");
  for (const [name, email, roleKey] of created) {
    const label = roleKey.charAt(0).toUpperCase() + roleKey.slice(1);
    console.log(`  ${label.padEnd(16)} ${email}`);
    console.log(`                   ${name}`);
  }

  console.log("\n  WHAT TO TRY");
  console.log("  ─────────────────────────────────────────────────────────");
  console.log("  1. Sign in as the Hospital Admin — the dashboard shows live");
  console.log("     figures, today's schedule and recent patients.");
  console.log("  2. Sign in as the Receptionist instead: no Billing, Visits,");
  console.log("     Staff or Settings in the sidebar, and the dashboard has");
  console.log("     no revenue tile (the figure is never even calculated).");
  console.log("  3. Patients → any patient → Write prescription. The");
  console.log("     consultation is recorded for you, and it lands in Pharmacy.");
  console.log("  4. Pharmacy → dispense it. A dispensed prescription cannot be");
  console.log("     dispensed twice, and leaves the pending queue.");
  console.log("  5. Billing → the draft invoice → Edit. Prices come from the");
  console.log("     treatment catalogue; you cannot type one in.");
  console.log("  6. Appointments → book Dr. Alice Morgan at a time she is");
  console.log("     already busy today — it is refused.");
  console.log("  7. Settings → Audit log — every action above is recorded.");
  console.log(`\n${line}\n`);
}

main().catch((e) => {
  console.error("Demo seed failed:", e);
  process.exitCode = 1;
});
