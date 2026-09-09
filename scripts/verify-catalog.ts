/* eslint-disable @typescript-eslint/no-explicit-any --
 * Black-box harness: it reads arbitrary JSON envelopes from the API rather than
 * importing the app's own types, so a regression in those types cannot silently
 * make the tests pass.
 */

/**
 * Phase 3 verification — departments, treatments and hospital-specific pricing.
 * Covers Section 51 cases 2 and 3 (cross-tenant treatment access), plus money
 * precision, per-tenant pricing, and configuration-driven behaviour.
 *
 * Usage:
 *   1. npm run dev
 *   2. npm run verify:catalog
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

/** Creates a hospital in a chosen currency and returns a usable admin session. */
async function onboardHospital(
  superJar: Jar,
  label: string,
  stamp: number,
  currency: string,
): Promise<{ hospitalId: string; adminJar: Jar }> {
  const adminEmail = `admin.${label.toLowerCase()}.${stamp}@example.test`;

  const created = await call("/api/super-admin/hospitals", {
    method: "POST",
    body: {
      name: `${label} Clinic ${stamp}`,
      type: "clinic",
      email: `contact.${label.toLowerCase()}.${stamp}@example.test`,
      phone: "+15550100",
      status: "active",
      currency,
      adminName: `${label} Admin`,
      adminEmail,
    },
    jar: superJar,
  });

  if (created.status !== 201) {
    throw new Error(
      `Could not create ${label}: ${created.status} ${JSON.stringify(created.json?.error)}`,
    );
  }

  const tempPassword = created.json.data.temporaryPassword as string;
  const password = `Catalog${label}!2024`;

  const adminJar = await signIn(adminEmail, tempPassword);
  await call("/api/auth/change-password", {
    method: "POST",
    body: {
      currentPassword: tempPassword,
      newPassword: password,
      confirmPassword: password,
    },
    jar: adminJar,
  });

  return { hospitalId: created.json.data.hospital.id as string, adminJar };
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });

  const stamp = Date.now();
  const superJar = await signIn(
    process.env.SUPER_ADMIN_EMAIL ?? "superadmin@platform.local",
    process.env.SUPER_ADMIN_PASSWORD ?? "ChangeMe!2024",
  );

  section("Two hospitals, different currencies");
  // A hair clinic billing in USD and a dental clinic billing in JPY (which has
  // zero decimal places) — the same code must serve both.
  const usd = await onboardHospital(superJar, "Hair", stamp, "USD");
  const jpy = await onboardHospital(superJar, "Dental", stamp, "JPY");
  check("USD hospital onboarded", Boolean(usd.hospitalId));
  check("JPY hospital onboarded", Boolean(jpy.hospitalId));

  // -------------------------------------------------------------------------
  section("Departments are tenant configuration (Sections 17, 39)");
  const noDepartments = await call("/api/departments", { jar: usd.adminJar });
  check(
    "A new hospital starts with NO preset departments",
    noDepartments.json?.data?.total === 0,
    `got ${noDepartments.json?.data?.total}`,
  );

  const hairDept = await call("/api/departments", {
    method: "POST",
    body: { name: "Hair Restoration", description: "Transplants and therapy." },
    jar: usd.adminJar,
  });
  check("Department created", hairDept.status === 201, `got ${hairDept.status}`);
  const hairDeptId = hairDept.json?.data?.id as string;

  const duplicateDept = await call("/api/departments", {
    method: "POST",
    body: { name: "Hair Restoration" },
    jar: usd.adminJar,
  });
  check(
    "Duplicate department name rejected within a hospital",
    duplicateDept.status === 409,
    `got ${duplicateDept.status}`,
  );

  // The other hospital defines completely different specialties.
  const dentalDept = await call("/api/departments", {
    method: "POST",
    body: { name: "Orthodontics" },
    jar: jpy.adminJar,
  });
  check("Second hospital defines its own departments", dentalDept.status === 201);
  const dentalDeptId = dentalDept.json?.data?.id as string;

  const sameNameOtherHospital = await call("/api/departments", {
    method: "POST",
    body: { name: "Hair Restoration" },
    jar: jpy.adminJar,
  });
  check(
    "The same department name is allowed at a different hospital",
    sameNameOtherHospital.status === 201,
    `got ${sameNameOtherHospital.status}`,
  );

  // -------------------------------------------------------------------------
  section("Treatments and per-hospital pricing (Section 18)");
  const consultUsd = await call("/api/treatments", {
    method: "POST",
    body: {
      departmentId: hairDeptId,
      name: "Initial Consultation",
      description: "First assessment.",
      price: 149.99,
      durationMinutes: 45,
      metadata: { sessionsIncluded: 1, requiresFasting: false },
    },
    jar: usd.adminJar,
  });
  check("Treatment created", consultUsd.status === 201, `got ${consultUsd.status} ${JSON.stringify(consultUsd.json?.error ?? "")}`);
  const consultUsdId = consultUsd.json?.data?.id as string;

  check(
    "Price stored exactly as minor units (149.99 -> 14999)",
    consultUsd.json.data.priceMinor === 14999,
    `got ${consultUsd.json?.data?.priceMinor}`,
  );
  check(
    "Price returned in major units",
    consultUsd.json.data.price === 149.99,
    `got ${consultUsd.json?.data?.price}`,
  );
  check(
    "Price formatted with the hospital's currency",
    consultUsd.json.data.priceFormatted === "$149.99",
    consultUsd.json?.data?.priceFormatted,
  );
  check(
    "Custom metadata round-trips",
    consultUsd.json.data.metadata.sessionsIncluded === 1 &&
      consultUsd.json.data.metadata.requiresFasting === false,
    JSON.stringify(consultUsd.json?.data?.metadata),
  );

  // The SAME service name at another hospital, at a different price and in a
  // different currency — no shared or hard-coded pricing anywhere.
  const consultJpy = await call("/api/treatments", {
    method: "POST",
    body: {
      departmentId: dentalDeptId,
      name: "Initial Consultation",
      price: 8000,
      durationMinutes: 30,
    },
    jar: jpy.adminJar,
  });
  check(
    "Same treatment name allowed at another hospital",
    consultJpy.status === 201,
    `got ${consultJpy.status}`,
  );
  check(
    "Zero-decimal currency stores 1:1 (8000 JPY -> 8000)",
    consultJpy.json.data.priceMinor === 8000,
    `got ${consultJpy.json?.data?.priceMinor}`,
  );
  check(
    "Zero-decimal currency formats without decimals",
    consultJpy.json.data.priceFormatted === "¥8,000",
    consultJpy.json?.data?.priceFormatted,
  );

  // -------------------------------------------------------------------------
  section("Money precision guards");
  const tooPrecise = await call("/api/treatments", {
    method: "POST",
    body: {
      departmentId: hairDeptId,
      name: `Over-precise ${stamp}`,
      price: 10.999,
    },
    jar: usd.adminJar,
  });
  check(
    "Sub-cent precision rejected for USD",
    tooPrecise.status === 422,
    `got ${tooPrecise.status}`,
  );

  const fractionalYen = await call("/api/treatments", {
    method: "POST",
    body: {
      departmentId: dentalDeptId,
      name: `Fractional Yen ${stamp}`,
      price: 100.5,
    },
    jar: jpy.adminJar,
  });
  check(
    "Fractional amount rejected for a zero-decimal currency",
    fractionalYen.status === 422,
    `got ${fractionalYen.status}`,
  );

  const negative = await call("/api/treatments", {
    method: "POST",
    body: { departmentId: hairDeptId, name: `Negative ${stamp}`, price: -5 },
    jar: usd.adminJar,
  });
  check("Negative price rejected", negative.status === 422, `got ${negative.status}`);

  const free = await call("/api/treatments", {
    method: "POST",
    body: { departmentId: hairDeptId, name: `Free Follow-up ${stamp}`, price: 0 },
    jar: usd.adminJar,
  });
  check("Zero price accepted", free.status === 201, `got ${free.status}`);

  /**
   * The whole reason prices are stored as integers.
   *
   * Adding these three prices as binary floats gives 30.599999999999998; adding
   * them as minor units gives exactly 3060. Phase 7 sums invoice lines this
   * way, so the difference is a real billing discrepancy, not a curiosity.
   */
  const lineItems = [10.1, 20.2, 0.3];
  const stored: number[] = [];

  for (const [index, price] of lineItems.entries()) {
    const created = await call("/api/treatments", {
      method: "POST",
      body: {
        departmentId: hairDeptId,
        name: `Drift Line ${index} ${stamp}`,
        price,
      },
      jar: usd.adminJar,
    });
    stored.push(created.json.data.priceMinor as number);
  }

  const floatSum = lineItems.reduce((total, price) => total + price, 0);
  const minorSum = stored.reduce((total, minor) => total + minor, 0);

  check(
    "Each price round-trips to exact minor units",
    JSON.stringify(stored) === JSON.stringify([1010, 2020, 30]),
    JSON.stringify(stored),
  );
  check(
    "Summing stored minor units is exact where summing float majors drifts",
    minorSum === 3060 && floatSum !== 30.6,
    `minor ${minorSum} (exact) vs float ${floatSum}`,
  );

  // -------------------------------------------------------------------------
  section("Cross-tenant isolation (tests 2, 3)");
  const jpyListsTreatments = await call("/api/treatments?pageSize=100", {
    jar: jpy.adminJar,
  });
  const jpyIds = (jpyListsTreatments.json.data.items as any[]).map((t) => t.id);
  check(
    "Hospital B's treatment list excludes Hospital A's treatments",
    !jpyIds.includes(consultUsdId),
  );

  const crossRead = await call(`/api/treatments/${consultUsdId}`, {
    jar: jpy.adminJar,
  });
  check(
    "Hospital B cannot READ a Hospital A treatment",
    crossRead.status === 404,
    `got ${crossRead.status}`,
  );

  const crossRepricing = await call(`/api/treatments/${consultUsdId}`, {
    method: "PATCH",
    body: { price: 1 },
    jar: jpy.adminJar,
  });
  check(
    "Hospital B cannot RE-PRICE a Hospital A treatment",
    crossRepricing.status === 404,
    `got ${crossRepricing.status}`,
  );

  const crossDelete = await call(`/api/treatments/${consultUsdId}`, {
    method: "DELETE",
    jar: jpy.adminJar,
  });
  check(
    "Hospital B cannot DELETE a Hospital A treatment",
    crossDelete.status === 404,
    `got ${crossDelete.status}`,
  );

  const crossDeptRead = await call(`/api/departments/${hairDeptId}`, {
    jar: jpy.adminJar,
  });
  check(
    "Hospital B cannot read a Hospital A department",
    crossDeptRead.status === 404,
    `got ${crossDeptRead.status}`,
  );

  const intact = await call(`/api/treatments/${consultUsdId}`, {
    jar: usd.adminJar,
  });
  check(
    "Hospital A's treatment and price survived every attempt intact",
    intact.status === 200 && intact.json.data.priceMinor === 14999,
    JSON.stringify({ status: intact.status, price: intact.json?.data?.priceMinor }),
  );

  // -------------------------------------------------------------------------
  section("Cross-tenant relationship validation (Section 10)");
  const foreignDept = await call("/api/treatments", {
    method: "POST",
    body: {
      // A real department id — but it belongs to the other hospital.
      departmentId: dentalDeptId,
      name: `Cross Tenant Service ${stamp}`,
      price: 50,
    },
    jar: usd.adminJar,
  });
  check(
    "Cannot file a treatment under another hospital's department",
    foreignDept.status === 404,
    `got ${foreignDept.status}`,
  );

  const moveToForeign = await call(`/api/treatments/${consultUsdId}`, {
    method: "PATCH",
    body: { departmentId: dentalDeptId },
    jar: usd.adminJar,
  });
  check(
    "Cannot move a treatment into another hospital's department",
    moveToForeign.status === 404,
    `got ${moveToForeign.status}`,
  );

  // -------------------------------------------------------------------------
  section("Referential guards");
  const deleteUsedDept = await call(`/api/departments/${hairDeptId}`, {
    method: "DELETE",
    jar: usd.adminJar,
  });
  check(
    "A department with treatments cannot be deleted",
    deleteUsedDept.status === 409,
    `got ${deleteUsedDept.status}`,
  );

  const emptyDept = await call("/api/departments", {
    method: "POST",
    body: { name: `Empty Dept ${stamp}` },
    jar: usd.adminJar,
  });
  const emptyDeptDelete = await call(
    `/api/departments/${emptyDept.json.data.id}`,
    { method: "DELETE", jar: usd.adminJar },
  );
  check(
    "An empty department can be deleted",
    emptyDeptDelete.status === 200,
    `got ${emptyDeptDelete.status}`,
  );

  // -------------------------------------------------------------------------
  section("Price updates and the authoritative price (Section 27)");
  const reprice = await call(`/api/treatments/${consultUsdId}`, {
    method: "PATCH",
    body: { price: 175.5 },
    jar: usd.adminJar,
  });
  check("Price updated", reprice.status === 200, `got ${reprice.status}`);
  check(
    "New price stored exactly (175.50 -> 17550)",
    reprice.json.data.priceMinor === 17550,
    `got ${reprice.json?.data?.priceMinor}`,
  );

  const reread = await call(`/api/treatments/${consultUsdId}`, {
    jar: usd.adminJar,
  });
  check(
    "Server is the source of truth for price on re-read",
    reread.json.data.priceMinor === 17550 &&
      reread.json.data.priceFormatted === "$175.50",
    reread.json?.data?.priceFormatted,
  );

  // -------------------------------------------------------------------------
  section("RBAC on the catalogue");
  const rolesResult = await call("/api/roles?pageSize=100", { jar: usd.adminJar });
  const receptionistId = (rolesResult.json.data.items as any[]).find(
    (r) => r.key === "receptionist",
  ).id as string;

  const staffEmail = `desk.${stamp}@hair.test`;
  const staff = await call("/api/users", {
    method: "POST",
    body: { name: "Front Desk", email: staffEmail, roleId: receptionistId },
    jar: usd.adminJar,
  });
  const staffPassword = "FrontDesk!2024";
  const staffJar = await signIn(staffEmail, staff.json.data.temporaryPassword);
  await call("/api/auth/change-password", {
    method: "POST",
    body: {
      currentPassword: staff.json.data.temporaryPassword,
      newPassword: staffPassword,
      confirmPassword: staffPassword,
    },
    jar: staffJar,
  });

  const staffViews = await call("/api/treatments", { jar: staffJar });
  check(
    "Receptionist CAN view treatments (has treatment.view)",
    staffViews.status === 200,
    `got ${staffViews.status}`,
  );

  const staffCreates = await call("/api/treatments", {
    method: "POST",
    body: { departmentId: hairDeptId, name: `Sneaky ${stamp}`, price: 1 },
    jar: staffJar,
  });
  check(
    "Receptionist CANNOT create treatments (lacks treatment.create)",
    staffCreates.status === 403,
    `got ${staffCreates.status}`,
  );

  const staffReprices = await call(`/api/treatments/${consultUsdId}`, {
    method: "PATCH",
    body: { price: 0.01 },
    jar: staffJar,
  });
  check(
    "Receptionist CANNOT change prices (lacks treatment.update)",
    staffReprices.status === 403,
    `got ${staffReprices.status}`,
  );

  const staffDeletesDept = await call(`/api/departments/${hairDeptId}`, {
    method: "DELETE",
    jar: staffJar,
  });
  check(
    "Receptionist CANNOT delete departments",
    staffDeletesDept.status === 403,
    `got ${staffDeletesDept.status}`,
  );

  const priceUnchanged = await call(`/api/treatments/${consultUsdId}`, {
    jar: usd.adminJar,
  });
  check(
    "Price is unchanged after the unauthorised attempts",
    priceUnchanged.json.data.priceMinor === 17550,
    `got ${priceUnchanged.json?.data?.priceMinor}`,
  );

  // -------------------------------------------------------------------------
  section("Super Admin holds no catalogue permissions (Section 3)");
  const superTreatments = await call("/api/treatments", { jar: superJar });
  check(
    "Super Admin cannot list a hospital's treatments",
    superTreatments.status === 403,
    `got ${superTreatments.status}`,
  );

  const superDepartments = await call("/api/departments", { jar: superJar });
  check(
    "Super Admin cannot list a hospital's departments",
    superDepartments.status === 403,
    `got ${superDepartments.status}`,
  );

  // -------------------------------------------------------------------------
  section("Filtering and search");
  const byDepartment = await call(
    `/api/treatments?departmentId=${hairDeptId}&pageSize=100`,
    { jar: usd.adminJar },
  );
  check(
    "Filter by department returns only that department's treatments",
    (byDepartment.json.data.items as any[]).every(
      (t) => t.department?.id === hairDeptId,
    ),
  );

  const searchHit = await call("/api/treatments?search=Consultation", {
    jar: usd.adminJar,
  });
  check(
    "Search finds the treatment",
    (searchHit.json.data.items as any[]).some((t) => t.id === consultUsdId),
  );

  const searchRegex = await call(
    `/api/treatments?search=${encodeURIComponent(".*")}`,
    { jar: usd.adminJar },
  );
  check(
    "Regex metacharacters are matched literally, not compiled",
    searchRegex.json.data.total === 0,
    `got ${searchRegex.json?.data?.total}`,
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
