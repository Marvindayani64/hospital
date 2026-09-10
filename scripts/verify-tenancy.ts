/* eslint-disable @typescript-eslint/no-explicit-any --
 * Black-box harness: it reads arbitrary JSON envelopes from the API rather than
 * importing the app's own types, so a regression in those types cannot silently
 * make the tests pass.
 */

/**
 * Phase 2 verification — multi-tenant isolation, RBAC and user management.
 * Covers Section 51 cases 1, 4, 5, 6, 7, 8 and 13 (relationship validation),
 * plus the last-admin lockout guards.
 *
 * Builds TWO hospitals and proves neither can see or touch the other's data.
 *
 * Usage:
 *   1. npm run dev
 *   2. npm run verify:tenancy
 */
// Marks this file as a module so its top-level declarations stay file-scoped
// and do not collide with the other verify script.
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

/** Logs a user in and returns a jar holding their session. */
async function signIn(email: string, password: string): Promise<Jar> {
  const jar = new Jar();
  await call("/login", { jar }); // middleware issues the CSRF nonce
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
 * Creates a hospital, then completes its admin's forced password change so the
 * account is usable for the rest of the run.
 */
async function onboardHospital(
  superJar: Jar,
  label: string,
  stamp: number,
): Promise<{ hospitalId: string; adminEmail: string; adminJar: Jar; password: string }> {
  // Lowercased to match what the server stores — emailSchema applies
  // .toLowerCase(), so a mixed-case literal would never compare equal.
  const adminEmail = `admin.${label.toLowerCase()}.${stamp}@example.test`;

  const created = await call("/api/super-admin/hospitals", {
    method: "POST",
    body: {
      name: `${label} Hospital ${stamp}`,
      type: "general",
      email: `contact.${label}.${stamp}@example.test`,
      phone: "+15550100",
      status: "active",
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
  const hospitalId = created.json.data.hospital.id as string;
  const password = `Tenant${label}!2024`;

  const adminJar = await signIn(adminEmail, tempPassword);
  const changed = await call("/api/auth/change-password", {
    method: "POST",
    body: {
      currentPassword: tempPassword,
      newPassword: password,
      confirmPassword: password,
    },
    jar: adminJar,
  });

  if (changed.status !== 200) {
    throw new Error(`Password change failed for ${label}: ${changed.status}`);
  }

  return { hospitalId, adminEmail, adminJar, password };
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });

  const stamp = Date.now();
  const superJar = await signIn(
    process.env.SUPER_ADMIN_EMAIL ?? "superadmin@platform.local",
    process.env.SUPER_ADMIN_PASSWORD ?? "ChangeMe!2024",
  );

  section("Setting up two tenants");
  const alpha = await onboardHospital(superJar, "Alpha", stamp);
  const beta = await onboardHospital(superJar, "Beta", stamp);
  check("Hospital A onboarded", Boolean(alpha.hospitalId));
  check("Hospital B onboarded", Boolean(beta.hospitalId));

  // -------------------------------------------------------------------------
  section("Default roles (Section 48)");
  const alphaRoles = await call("/api/roles?pageSize=100", { jar: alpha.adminJar });
  check(
    "Six system roles seeded per hospital",
    alphaRoles.json?.data?.items?.length === 6,
    `got ${alphaRoles.json?.data?.items?.length}`,
  );
  const roleNames = (alphaRoles.json.data.items as any[]).map((r) => r.name).sort();
  check(
    "Expected role names present",
    JSON.stringify(roleNames) ===
      JSON.stringify([
        "Accountant",
        "Doctor",
        "Hospital Admin",
        "Nurse",
        "Pharmacist",
        "Receptionist",
      ]),
    roleNames.join(", "),
  );
  check(
    "System roles are flagged non-deletable",
    (alphaRoles.json.data.items as any[]).every((r) => r.isSystem === true),
  );

  const alphaAdminRole = (alphaRoles.json.data.items as any[]).find(
    (r) => r.key === "hospital_admin",
  );
  const alphaReceptionist = (alphaRoles.json.data.items as any[]).find(
    (r) => r.key === "receptionist",
  );
  /**
   * The catalogue size is read from the API rather than hardcoded, so adding a
   * permission in a later phase does not break this assertion — what matters is
   * that Hospital Admin holds ALL of them, not how many there happen to be.
   */
  const catalogue = await call("/api/permissions", { jar: alpha.adminJar });
  const catalogueSize = (catalogue.json.data.groups as any[]).reduce(
    (total, group) => total + group.permissions.length,
    0,
  );

  check(
    "Hospital Admin role holds every permission in the catalogue",
    catalogueSize > 0 && alphaAdminRole.permissions.length === catalogueSize,
    `role has ${alphaAdminRole.permissions.length}, catalogue has ${catalogueSize}`,
  );
  check(
    "Receptionist role has a restricted subset",
    alphaReceptionist.permissions.length > 0 &&
      alphaReceptionist.permissions.length < catalogueSize &&
      !alphaReceptionist.permissions.includes("user.create"),
  );

  // -------------------------------------------------------------------------
  section("Hospital Admin can create and assign roles (tests 7, 8)");
  const customRole = await call("/api/roles", {
    method: "POST",
    body: {
      name: `Lab Technician ${stamp}`,
      description: "Reads patients and their consultation records.",
      permissions: ["patient.view", "visit.view", "treatment.view"],
    },
    jar: alpha.adminJar,
  });
  check("Hospital Admin can create a role", customRole.status === 201, `got ${customRole.status}`);
  const customRoleId = customRole.json?.data?.id as string;
  check(
    "Created role stores exactly the chosen permissions",
    JSON.stringify([...customRole.json.data.permissions].sort()) ===
      JSON.stringify(["patient.view", "treatment.view", "visit.view"]),
  );

  const invalidPerm = await call("/api/roles", {
    method: "POST",
    body: { name: `Bogus ${stamp}`, permissions: ["patient.explode"] },
    jar: alpha.adminJar,
  });
  check(
    "Unknown permission string is rejected",
    invalidPerm.status === 422,
    `got ${invalidPerm.status}`,
  );

  const member = await call("/api/users", {
    method: "POST",
    body: {
      name: "Lab Tech One",
      email: `lab.${stamp}@alpha.test`,
      roleId: customRoleId,
      status: "active",
    },
    jar: alpha.adminJar,
  });
  check("Hospital Admin can create a member", member.status === 201, `got ${member.status}`);
  const memberId = member.json?.data?.member?.id as string;
  const memberEmail = member.json?.data?.member?.email as string;
  const memberTempPassword = member.json?.data?.temporaryPassword as string;
  check("New member is forced to change password", member.json.data.member.mustChangePassword === true);
  check("Member role was assigned", member.json.data.member.role.id === customRoleId);
  check(
    "Response contains no password hash",
    !JSON.stringify(member.json).includes("passwordHash"),
  );

  // -------------------------------------------------------------------------
  section("Members cannot escalate their own privileges (test 13)");
  const memberPassword = "LabTech!2024";
  const memberJar = await signIn(memberEmail, memberTempPassword);
  await call("/api/auth/change-password", {
    method: "POST",
    body: {
      currentPassword: memberTempPassword,
      newPassword: memberPassword,
      confirmPassword: memberPassword,
    },
    jar: memberJar,
  });

  const memberMe = await call("/api/auth/me", { jar: memberJar });
  check(
    "Member's effective permissions match their role",
    JSON.stringify([...memberMe.json.data.user.permissions].sort()) ===
      JSON.stringify(["patient.view", "treatment.view", "visit.view"]),
    JSON.stringify(memberMe.json?.data?.user?.permissions),
  );

  const memberListUsers = await call("/api/users", { jar: memberJar });
  check(
    "Member without user.view cannot list staff (tests 5, 6)",
    memberListUsers.status === 403,
    `got ${memberListUsers.status}`,
  );

  const memberCreateUser = await call("/api/users", {
    method: "POST",
    body: { name: "Sneaky", email: `x.${stamp}@a.test`, roleId: customRoleId },
    jar: memberJar,
  });
  check(
    "Member without user.create cannot create staff",
    memberCreateUser.status === 403,
    `got ${memberCreateUser.status}`,
  );

  const memberCreateRole = await call("/api/roles", {
    method: "POST",
    body: { name: `Escalate ${stamp}`, permissions: ["user.create"] },
    jar: memberJar,
  });
  check(
    "Member without role.create cannot create roles",
    memberCreateRole.status === 403,
    `got ${memberCreateRole.status}`,
  );

  const memberSuperAdmin = await call("/api/super-admin/hospitals", { jar: memberJar });
  check(
    "Member cannot reach the platform console",
    memberSuperAdmin.status === 403,
    `got ${memberSuperAdmin.status}`,
  );

  // -------------------------------------------------------------------------
  section("Cross-tenant isolation (tests 1, 4)");
  const betaUsers = await call("/api/users", { jar: beta.adminJar });
  const betaEmails = (betaUsers.json.data.items as any[]).map((u) => u.email);
  check(
    "Hospital B's staff list excludes Hospital A's members",
    !betaEmails.includes(memberEmail) && !betaEmails.includes(alpha.adminEmail),
    betaEmails.join(", "),
  );

  const crossRead = await call(`/api/users/${memberId}`, { jar: beta.adminJar });
  check(
    "Hospital B cannot READ a Hospital A member by id",
    crossRead.status === 404,
    `got ${crossRead.status}`,
  );

  const crossUpdate = await call(`/api/users/${memberId}`, {
    method: "PATCH",
    body: { name: "Hijacked" },
    jar: beta.adminJar,
  });
  check(
    "Hospital B cannot UPDATE a Hospital A member",
    crossUpdate.status === 404,
    `got ${crossUpdate.status}`,
  );

  const crossDeactivate = await call(`/api/users/${memberId}`, {
    method: "PUT",
    body: { status: "inactive" },
    jar: beta.adminJar,
  });
  check(
    "Hospital B cannot DEACTIVATE a Hospital A member",
    crossDeactivate.status === 404,
    `got ${crossDeactivate.status}`,
  );

  const crossDelete = await call(`/api/users/${memberId}`, {
    method: "DELETE",
    jar: beta.adminJar,
  });
  check(
    "Hospital B cannot DELETE a Hospital A member",
    crossDelete.status === 404,
    `got ${crossDelete.status}`,
  );

  const crossSignOut = await call(`/api/users/${memberId}/sessions`, {
    method: "DELETE",
    jar: beta.adminJar,
  });
  check(
    "Hospital B cannot force-logout a Hospital A member",
    crossSignOut.status === 404,
    `got ${crossSignOut.status}`,
  );

  const crossRoleRead = await call(`/api/roles/${customRoleId}`, { jar: beta.adminJar });
  check(
    "Hospital B cannot read a Hospital A role",
    crossRoleRead.status === 404,
    `got ${crossRoleRead.status}`,
  );

  const crossRoleEdit = await call(`/api/roles/${customRoleId}`, {
    method: "PATCH",
    body: { permissions: ["user.create", "role.create"] },
    jar: beta.adminJar,
  });
  check(
    "Hospital B cannot grant itself permissions via a Hospital A role",
    crossRoleEdit.status === 404,
    `got ${crossRoleEdit.status}`,
  );

  // Confirm the record really was untouched by all of the above.
  const stillIntact = await call(`/api/users/${memberId}`, { jar: alpha.adminJar });
  check(
    "Hospital A's member survived every cross-tenant attempt intact",
    stillIntact.status === 200 &&
      stillIntact.json.data.name === "Lab Tech One" &&
      stillIntact.json.data.status === "active",
    JSON.stringify(stillIntact.json?.data),
  );

  // -------------------------------------------------------------------------
  section("Cross-tenant relationship validation (test 13)");
  const betaRoles = await call("/api/roles?pageSize=100", { jar: beta.adminJar });
  const betaDoctorRoleId = (betaRoles.json.data.items as any[]).find(
    (r) => r.key === "doctor",
  ).id as string;

  const crossRoleAssign = await call("/api/users", {
    method: "POST",
    body: {
      name: "Cross Tenant Hire",
      email: `cross.${stamp}@alpha.test`,
      // A real role id — but it belongs to Hospital B.
      roleId: betaDoctorRoleId,
    },
    jar: alpha.adminJar,
  });
  check(
    "Cannot create a member with another hospital's role",
    crossRoleAssign.status === 404,
    `got ${crossRoleAssign.status}`,
  );

  const crossRoleReassign = await call(`/api/users/${memberId}`, {
    method: "PATCH",
    body: { roleId: betaDoctorRoleId },
    jar: alpha.adminJar,
  });
  check(
    "Cannot reassign a member to another hospital's role",
    crossRoleReassign.status === 404,
    `got ${crossRoleReassign.status}`,
  );

  // -------------------------------------------------------------------------
  section("hospitalId from the client is ignored (test 14)");
  const spoofCreate = await call("/api/users", {
    method: "POST",
    body: {
      name: "Spoofed Tenant",
      email: `spoof.${stamp}@alpha.test`,
      roleId: customRoleId,
      // Both should be silently ignored by the schema.
      hospitalId: beta.hospitalId,
      isSuperAdmin: true,
    },
    jar: alpha.adminJar,
  });
  check("Member created despite spoofed fields", spoofCreate.status === 201, `got ${spoofCreate.status}`);

  const spoofedId = spoofCreate.json?.data?.member?.id as string;
  const inBeta = await call(`/api/users/${spoofedId}`, { jar: beta.adminJar });
  check(
    "Spoofed hospitalId did NOT place the member in Hospital B",
    inBeta.status === 404,
    `got ${inBeta.status}`,
  );

  const inAlpha = await call(`/api/users/${spoofedId}`, { jar: alpha.adminJar });
  check(
    "Member landed in the creator's own hospital",
    inAlpha.status === 200,
    `got ${inAlpha.status}`,
  );

  const spoofedLogin = await signIn(
    spoofCreate.json.data.member.email,
    spoofCreate.json.data.temporaryPassword,
  );
  const spoofedMe = await call("/api/auth/me", { jar: spoofedLogin });
  check(
    "Spoofed isSuperAdmin was ignored — no platform privileges granted",
    spoofedMe.json?.data?.user?.isSuperAdmin === false,
    JSON.stringify(spoofedMe.json?.data?.user?.isSuperAdmin),
  );

  // -------------------------------------------------------------------------
  section("Role changes take effect immediately");
  const grant = await call(`/api/roles/${customRoleId}`, {
    method: "PATCH",
    body: { permissions: ["patient.view", "visit.view", "treatment.view", "user.view"] },
    jar: alpha.adminJar,
  });
  check("Role permissions updated", grant.status === 200, `got ${grant.status}`);

  const nowAllowed = await call("/api/users", { jar: memberJar });
  check(
    "Member gains access on the very next request — no re-login needed",
    nowAllowed.status === 200,
    `got ${nowAllowed.status}`,
  );

  const revoke = await call(`/api/roles/${customRoleId}`, {
    method: "PATCH",
    body: { permissions: ["patient.view"] },
    jar: alpha.adminJar,
  });
  check("Role permissions revoked", revoke.status === 200);

  const nowDenied = await call("/api/users", { jar: memberJar });
  check(
    "Member loses access on the very next request",
    nowDenied.status === 403,
    `got ${nowDenied.status}`,
  );

  // -------------------------------------------------------------------------
  section("Deactivation revokes sessions immediately (Section 13)");
  const beforeDeactivate = await call("/api/auth/me", { jar: memberJar });
  check("Member session is live", beforeDeactivate.status === 200);

  const deactivate = await call(`/api/users/${memberId}`, {
    method: "PUT",
    body: { status: "inactive" },
    jar: alpha.adminJar,
  });
  check("Member deactivated", deactivate.status === 200, `got ${deactivate.status}`);

  const afterDeactivate = await call("/api/auth/me", { jar: memberJar });
  check(
    "Deactivated member is locked out on the next request (tokenVersion bump)",
    afterDeactivate.status === 401,
    `got ${afterDeactivate.status}`,
  );

  // A fresh jar primed with a CSRF nonce, so this genuinely exercises the
  // login path rather than being rejected by the CSRF guard first.
  const freshJar = new Jar();
  await call("/login", { jar: freshJar });
  const deactivatedLogin = await call("/api/auth/login", {
    method: "POST",
    body: { email: memberEmail, password: memberPassword },
    jar: freshJar,
  });
  check(
    "Deactivated member cannot sign in",
    deactivatedLogin.status === 401,
    `got ${deactivatedLogin.status}`,
  );

  // -------------------------------------------------------------------------
  section("Force logout (Section 8a)");
  await call(`/api/users/${memberId}`, {
    method: "PUT",
    body: { status: "active" },
    jar: alpha.adminJar,
  });
  const revived = await signIn(memberEmail, memberPassword);
  check("Reactivated member can sign in again", Boolean(revived.get("access_token")));

  const forceOut = await call(`/api/users/${memberId}/sessions`, {
    method: "DELETE",
    jar: alpha.adminJar,
  });
  check("Admin can force-logout a member", forceOut.status === 200, `got ${forceOut.status}`);

  const afterForceOut = await call("/api/auth/me", { jar: revived });
  check(
    "Force-logout takes effect within one request",
    afterForceOut.status === 401,
    `got ${afterForceOut.status}`,
  );

  // -------------------------------------------------------------------------
  section("Lockout guards");
  const alphaUsers = await call("/api/users?pageSize=100", { jar: alpha.adminJar });
  const alphaAdmin = (alphaUsers.json.data.items as any[]).find(
    (u) => u.email === alpha.adminEmail,
  );

  const selfDeactivate = await call(`/api/users/${alphaAdmin.id}`, {
    method: "PUT",
    body: { status: "inactive" },
    jar: alpha.adminJar,
  });
  check(
    "Admin cannot deactivate themselves",
    selfDeactivate.status === 409,
    `got ${selfDeactivate.status}`,
  );

  const selfDelete = await call(`/api/users/${alphaAdmin.id}`, {
    method: "DELETE",
    jar: alpha.adminJar,
  });
  check(
    "Admin cannot delete themselves",
    selfDelete.status === 409,
    `got ${selfDelete.status}`,
  );

  const demoteSelf = await call(`/api/users/${alphaAdmin.id}`, {
    method: "PATCH",
    body: { roleId: customRoleId },
    jar: alpha.adminJar,
  });
  check(
    "Sole admin cannot demote themselves to a non-admin role",
    demoteSelf.status === 409,
    `got ${demoteSelf.status}`,
  );

  const deleteSystemRole = await call(`/api/roles/${alphaAdminRole.id}`, {
    method: "DELETE",
    jar: alpha.adminJar,
  });
  check(
    "Default (system) roles cannot be deleted",
    deleteSystemRole.status === 409,
    `got ${deleteSystemRole.status}`,
  );

  const deleteRoleInUse = await call(`/api/roles/${customRoleId}`, {
    method: "DELETE",
    jar: alpha.adminJar,
  });
  check(
    "A role still assigned to members cannot be deleted",
    deleteRoleInUse.status === 409,
    `got ${deleteRoleInUse.status}`,
  );

  // -------------------------------------------------------------------------
  section("Duplicate email scoping (Section 16)");
  const duplicateSameHospital = await call("/api/users", {
    method: "POST",
    body: { name: "Duplicate", email: memberEmail, roleId: customRoleId },
    jar: alpha.adminJar,
  });
  check(
    "Duplicate email within the same hospital is rejected",
    duplicateSameHospital.status === 409,
    `got ${duplicateSameHospital.status}`,
  );

  const betaReceptionist = (betaRoles.json.data.items as any[]).find(
    (r) => r.key === "receptionist",
  ).id as string;
  const sameEmailOtherHospital = await call("/api/users", {
    method: "POST",
    body: { name: "Same Person", email: memberEmail, roleId: betaReceptionist },
    jar: beta.adminJar,
  });
  check(
    "The same email CAN be used at a different hospital (per-tenant uniqueness)",
    sameEmailOtherHospital.status === 201,
    `got ${sameEmailOtherHospital.status}`,
  );

  // -------------------------------------------------------------------------
  section("Super Admin holds no tenant permissions (Section 3)");
  const superListsUsers = await call("/api/users", { jar: superJar });
  check(
    "Super Admin cannot list a hospital's staff",
    superListsUsers.status === 403,
    `got ${superListsUsers.status}`,
  );

  const superListsRoles = await call("/api/roles", { jar: superJar });
  check(
    "Super Admin cannot list a hospital's roles",
    superListsRoles.status === 403,
    `got ${superListsRoles.status}`,
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
