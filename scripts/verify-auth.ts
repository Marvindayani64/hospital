/* eslint-disable @typescript-eslint/no-explicit-any --
 * This is a black-box test harness: it deliberately reads arbitrary JSON
 * envelopes from the API rather than importing the app's own types, so a
 * regression in those types cannot silently make the tests pass.
 */

/**
 * End-to-end verification of the Phase 1 authentication + multi-tenancy
 * foundation. Covers the applicable cases from Section 51 of the spec.
 *
 * Usage:
 *   1. npm run dev        (in another terminal)
 *   2. npm run verify:auth
 *
 * It creates a throwaway hospital on each run and leaves it in place, so the
 * results can be inspected afterwards.
 */
// Marks this file as a module so its top-level declarations stay file-scoped
// and do not collide with the other verify script.
export {};

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Minimal cookie jar that respects the Path attribute, so the path-scoped
// refresh cookie behaves exactly as it does in a browser.
// ---------------------------------------------------------------------------
type Cookie = { value: string; path: string };

class Jar {
  private cookies = new Map<string, Cookie>();

  absorb(response: Response): void {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair, ...attrs] = line.split("; ");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      const pathAttr = attrs.find((a) => a.toLowerCase().startsWith("path="));
      const path = pathAttr ? pathAttr.slice(5) : "/";
      const maxAge = attrs.find((a) => a.toLowerCase().startsWith("max-age="));

      if (value === "" || maxAge?.endsWith("=0")) this.cookies.delete(name);
      else this.cookies.set(name, { value, path });
    }
  }

  header(requestPath: string): string {
    return [...this.cookies.entries()]
      .filter(([, c]) => requestPath.startsWith(c.path))
      .map(([name, c]) => `${name}=${c.value}`)
      .join("; ");
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)?.value;
  }

  set(name: string, value: string, path = "/"): void {
    this.cookies.set(name, { value, path });
  }

  clone(): Jar {
    const copy = new Jar();
    for (const [name, cookie] of this.cookies) copy.set(name, cookie.value, cookie.path);
    return copy;
  }
}

type CallOptions = {
  method?: string;
  body?: unknown;
  jar?: Jar;
  csrf?: boolean;
};

async function call(path: string, options: CallOptions = {}) {
  const { method = "GET", body, jar, csrf = true } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (jar) {
    const cookieHeader = jar.header(path);
    if (cookieHeader) headers.Cookie = cookieHeader;
    if (csrf && method !== "GET") {
      const token = jar.get("csrf_token");
      if (token) headers["x-csrf-token"] = token;
    }
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
    /* non-JSON (HTML page) */
  }

  return { status: response.status, json, response };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
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

async function primeCsrf(jar: Jar): Promise<void> {
  // The middleware issues the CSRF nonce on a page request.
  await call("/login", { jar });
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });

  // Matches whatever the seed script created.
  const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? "superadmin@platform.local";
  const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? "ChangeMe!2024";
  const stamp = Date.now();
  const adminEmail = `admin.${stamp}@testclinic.example`;

  // -------------------------------------------------------------------------
  section("CSRF protection (test 21)");
  const superJar = new Jar();
  await primeCsrf(superJar);
  check("Middleware issued a csrf_token cookie", Boolean(superJar.get("csrf_token")));

  const noCsrf = await call("/api/auth/login", {
    method: "POST",
    body: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
    jar: superJar,
    csrf: false,
  });
  check(
    "State-changing request without CSRF header is rejected",
    noCsrf.status === 403 && noCsrf.json?.error?.code === "CSRF_FAILED",
    `got ${noCsrf.status} ${noCsrf.json?.error?.code}`,
  );

  const badCsrfJar = superJar.clone();
  badCsrfJar.set("csrf_token", "not-the-right-token");
  const mismatched = await call("/api/auth/login", {
    method: "POST",
    body: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
    jar: badCsrfJar,
  });
  // The header is taken from the tampered jar, so cookie and header now agree;
  // re-send with the ORIGINAL cookie but the wrong header instead.
  const mismatch2 = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `csrf_token=${superJar.get("csrf_token")}`,
      "x-csrf-token": "wrong-value",
    },
    body: JSON.stringify({ email: SUPER_EMAIL, password: SUPER_PASSWORD }),
  });
  check(
    "CSRF cookie/header mismatch is rejected",
    mismatch2.status === 403,
    `got ${mismatch2.status}`,
  );
  void mismatched;

  // -------------------------------------------------------------------------
  section("Super Admin login (test 11)");
  const wrongPassword = await call("/api/auth/login", {
    method: "POST",
    body: { email: SUPER_EMAIL, password: "TotallyWrong!1" },
    jar: superJar,
  });
  check(
    "Wrong password is rejected with 401",
    wrongPassword.status === 401,
    `got ${wrongPassword.status}`,
  );

  const unknownEmail = await call("/api/auth/login", {
    method: "POST",
    body: { email: `nobody.${stamp}@nowhere.example`, password: "Whatever!1" },
    jar: superJar,
  });
  check(
    "Unknown email returns the same generic 401 (no user enumeration)",
    unknownEmail.status === 401 &&
      unknownEmail.json?.error?.message === wrongPassword.json?.error?.message,
    `got ${unknownEmail.status}`,
  );

  const login = await call("/api/auth/login", {
    method: "POST",
    body: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
    jar: superJar,
  });
  check("Super Admin can log in", login.status === 200, `got ${login.status}`);
  check("Access token cookie set", Boolean(superJar.get("access_token")));
  check("Refresh token cookie set", Boolean(superJar.get("refresh_token")));
  check(
    "Tokens are NOT present in the response body",
    !JSON.stringify(login.json).includes(superJar.get("access_token") ?? "@@"),
  );

  const setCookies = login.response.headers.getSetCookie();
  check(
    "access_token cookie is HttpOnly + SameSite",
    setCookies.some(
      (c) =>
        c.startsWith("access_token=") &&
        /HttpOnly/i.test(c) &&
        /SameSite/i.test(c),
    ),
  );
  check(
    "refresh_token cookie is path-scoped to /api/auth/refresh",
    setCookies.some(
      (c) => c.startsWith("refresh_token=") && /Path=\/api\/auth\/refresh/i.test(c),
    ),
  );

  const me = await call("/api/auth/me", { jar: superJar });
  check(
    "GET /api/auth/me identifies the Super Admin",
    me.status === 200 && me.json?.data?.user?.isSuperAdmin === true,
    `got ${me.status}`,
  );
  check(
    "Super Admin has hospitalId = null",
    me.json?.data?.user?.hospitalId === null,
  );

  // -------------------------------------------------------------------------
  section("Hospital creation (tests 11, 12)");
  const create = await call("/api/super-admin/hospitals", {
    method: "POST",
    body: {
      name: `Test Clinic ${stamp}`,
      type: "dental",
      email: `contact.${stamp}@testclinic.example`,
      phone: "+15550100",
      city: "Lagos",
      country: "Nigeria",
      status: "active",
      adminName: "Test Administrator",
      adminEmail,
    },
    jar: superJar,
  });
  check("Hospital created", create.status === 201, `got ${create.status} ${JSON.stringify(create.json?.error ?? "")}`);

  const tempPassword: string = create.json?.data?.temporaryPassword ?? "";
  const hospitalId: string = create.json?.data?.hospital?.id ?? "";
  check("Temporary password returned exactly once", tempPassword.length >= 8);
  check(
    "Response contains no password hash",
    !JSON.stringify(create.json).includes("passwordHash"),
  );

  const fetched = await call(`/api/super-admin/hospitals/${hospitalId}`, {
    jar: superJar,
  });
  check(
    "Hospital Admin was created automatically",
    fetched.json?.data?.admin?.email === adminEmail,
    JSON.stringify(fetched.json?.data?.admin),
  );

  // -------------------------------------------------------------------------
  section("Temporary password forces a change (tests 9, 10)");
  const adminJar = new Jar();
  await primeCsrf(adminJar);

  const adminLogin = await call("/api/auth/login", {
    method: "POST",
    body: { email: adminEmail, password: tempPassword },
    jar: adminJar,
  });
  check(
    "Hospital Admin can log in with the temporary password",
    adminLogin.status === 200,
    `got ${adminLogin.status}`,
  );
  check(
    "mustChangePassword is true",
    adminLogin.json?.data?.user?.mustChangePassword === true,
  );
  check(
    "Login response redirects to /change-password",
    adminLogin.json?.data?.redirectTo === "/change-password",
  );

  const staleAccessToken = adminJar.get("access_token")!;

  const blocked = await call("/api/permissions", { jar: adminJar });
  check(
    "Protected endpoint is blocked before the password change",
    blocked.status === 403 &&
      blocked.json?.error?.code === "PASSWORD_CHANGE_REQUIRED",
    `got ${blocked.status} ${blocked.json?.error?.code}`,
  );

  const meAllowed = await call("/api/auth/me", { jar: adminJar });
  check(
    "GET /api/auth/me is still allowed (whitelisted)",
    meAllowed.status === 200,
    `got ${meAllowed.status}`,
  );

  // -------------------------------------------------------------------------
  section("Tenant isolation of the platform console");
  const forbidden = await call("/api/super-admin/hospitals", { jar: adminJar });
  check(
    "Hospital user cannot reach Super Admin endpoints",
    forbidden.status === 403,
    `got ${forbidden.status}`,
  );

  // -------------------------------------------------------------------------
  section("Password change + tokenVersion revocation (tests 9, 16)");
  const weak = await call("/api/auth/change-password", {
    method: "POST",
    body: {
      currentPassword: tempPassword,
      newPassword: "weak",
      confirmPassword: "weak",
    },
    jar: adminJar,
  });
  check(
    "Weak password rejected by policy",
    weak.status === 422,
    `got ${weak.status}`,
  );

  const mismatchPw = await call("/api/auth/change-password", {
    method: "POST",
    body: {
      currentPassword: tempPassword,
      newPassword: "StrongPass!23",
      confirmPassword: "DifferentPass!23",
    },
    jar: adminJar,
  });
  check(
    "Mismatched confirmation rejected",
    mismatchPw.status === 422,
    `got ${mismatchPw.status}`,
  );

  const wrongCurrent = await call("/api/auth/change-password", {
    method: "POST",
    body: {
      currentPassword: "NotTheTempPassword!9",
      newPassword: "StrongPass!23",
      confirmPassword: "StrongPass!23",
    },
    jar: adminJar,
  });
  check(
    "Incorrect current password rejected",
    wrongCurrent.status === 422,
    `got ${wrongCurrent.status}`,
  );

  const newPassword = "StrongPass!23";
  const changed = await call("/api/auth/change-password", {
    method: "POST",
    body: {
      currentPassword: tempPassword,
      newPassword,
      confirmPassword: newPassword,
    },
    jar: adminJar,
  });
  check(
    "Password changed successfully",
    changed.status === 200,
    `got ${changed.status} ${JSON.stringify(changed.json?.error ?? "")}`,
  );
  check(
    "A fresh access token was issued",
    adminJar.get("access_token") !== staleAccessToken,
  );

  // Test 16: the pre-change token must now be dead.
  const staleCall = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: `access_token=${staleAccessToken}` },
  });
  check(
    "Pre-change access token is rejected within one request (tokenVersion bump)",
    staleCall.status === 401,
    `got ${staleCall.status}`,
  );

  const nowAllowed = await call("/api/permissions", { jar: adminJar });
  check(
    "Protected endpoint accessible after the password change",
    nowAllowed.status === 200,
    `got ${nowAllowed.status}`,
  );

  // -------------------------------------------------------------------------
  section("JWT integrity (test 20)");
  const goodToken = adminJar.get("access_token")!;
  const parts = goodToken.split(".");
  const tamperedPayload = Buffer.from(
    JSON.stringify({
      userId: "000000000000000000000000",
      hospitalId: null,
      roleId: null,
      isSuperAdmin: true,
      tokenVersion: 0,
      hospitalTokenVersion: 0,
      iss: "hospital-crm",
      aud: "hospital-crm-app",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  const forged = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

  const forgedCall = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: `access_token=${forged}` },
  });
  check(
    "Token with a tampered payload is rejected",
    forgedCall.status === 401,
    `got ${forgedCall.status}`,
  );

  const garbage = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: "access_token=not.a.jwt" },
  });
  check("Malformed token is rejected", garbage.status === 401);

  const noToken = await fetch(`${BASE}/api/auth/me`);
  check("Missing token is rejected", noToken.status === 401);

  // -------------------------------------------------------------------------
  section("Refresh rotation (tests 18, 19)");
  const oldRefresh = adminJar.get("refresh_token")!;

  const refreshed = await call("/api/auth/refresh", {
    method: "POST",
    jar: adminJar,
  });
  check("Refresh succeeds", refreshed.status === 200, `got ${refreshed.status}`);
  check(
    "Refresh token was rotated",
    adminJar.get("refresh_token") !== oldRefresh,
  );
  check(
    "A new access token was issued by refresh",
    Boolean(adminJar.get("access_token")),
  );

  // Test 19: replaying the rotated token must fail AND revoke the family.
  const replay = await fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Cookie: `refresh_token=${oldRefresh}; csrf_token=${adminJar.get("csrf_token")}`,
      "x-csrf-token": adminJar.get("csrf_token") ?? "",
    },
  });
  check(
    "Replaying a rotated refresh token is rejected",
    replay.status === 401,
    `got ${replay.status}`,
  );

  const afterReuse = await call("/api/auth/refresh", {
    method: "POST",
    jar: adminJar,
  });
  check(
    "Reuse detection revoked the whole session family",
    afterReuse.status === 401,
    `got ${afterReuse.status}`,
  );

  // -------------------------------------------------------------------------
  section("Hospital suspension revokes every tenant token (test 17)");
  const adminJar2 = new Jar();
  await primeCsrf(adminJar2);
  const relogin = await call("/api/auth/login", {
    method: "POST",
    body: { email: adminEmail, password: newPassword },
    jar: adminJar2,
  });
  check("Hospital Admin logged back in", relogin.status === 200, `got ${relogin.status}`);

  const beforeSuspend = await call("/api/auth/me", { jar: adminJar2 });
  check("Session is live before suspension", beforeSuspend.status === 200);

  const suspend = await call(`/api/super-admin/hospitals/${hospitalId}`, {
    method: "PUT",
    body: { status: "suspended" },
    jar: superJar,
  });
  check("Super Admin suspended the hospital", suspend.status === 200, `got ${suspend.status}`);

  const afterSuspend = await call("/api/auth/me", { jar: adminJar2 });
  check(
    "Tenant user is locked out on the very next request",
    afterSuspend.status === 403 || afterSuspend.status === 401,
    `got ${afterSuspend.status}`,
  );

  const loginWhileSuspended = await call("/api/auth/login", {
    method: "POST",
    body: { email: adminEmail, password: newPassword },
    jar: new Jar(),
    csrf: false,
  });
  check(
    "Cannot log in to a suspended hospital",
    loginWhileSuspended.status !== 200,
    `got ${loginWhileSuspended.status}`,
  );

  // Reactivate, then confirm login works again.
  const reactivate = await call(`/api/super-admin/hospitals/${hospitalId}`, {
    method: "PUT",
    body: { status: "active" },
    jar: superJar,
  });
  check("Hospital reactivated", reactivate.status === 200);

  const adminJar3 = new Jar();
  await primeCsrf(adminJar3);
  const reloginAfter = await call("/api/auth/login", {
    method: "POST",
    body: { email: adminEmail, password: newPassword },
    jar: adminJar3,
  });
  check(
    "Login works again after reactivation",
    reloginAfter.status === 200,
    `got ${reloginAfter.status}`,
  );

  // -------------------------------------------------------------------------
  section("Client-supplied hospitalId cannot override the token (test 14)");
  const spoof = await call("/api/auth/me?hospitalId=000000000000000000000000", {
    jar: adminJar3,
  });
  const realHospitalId = spoof.json?.data?.user?.hospitalId;
  check(
    "hospitalId comes from the authenticated user, not the query string",
    realHospitalId === hospitalId,
    `got ${realHospitalId}, expected ${hospitalId}`,
  );

  // -------------------------------------------------------------------------
  section("Logout (test: refresh revocation)");
  const logoutRefresh = adminJar3.get("refresh_token")!;
  const logout = await call("/api/auth/logout", {
    method: "POST",
    jar: adminJar3,
  });
  check("Logout succeeds", logout.status === 200, `got ${logout.status}`);
  check("Cookies cleared", !adminJar3.get("access_token"));

  const refreshAfterLogout = await fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Cookie: `refresh_token=${logoutRefresh}; csrf_token=${adminJar3.get("csrf_token")}`,
      "x-csrf-token": adminJar3.get("csrf_token") ?? "",
    },
  });
  check(
    "Revoked refresh token cannot mint a new access token",
    refreshAfterLogout.status === 401,
    `got ${refreshAfterLogout.status}`,
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
