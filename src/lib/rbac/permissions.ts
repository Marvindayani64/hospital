/**
 * The platform permission catalogue.
 *
 * Permissions are `resource.action` strings held as a plain array on the Role
 * document. Keeping the catalogue in code (rather than a Permission collection
 * seeded per hospital) means adding a permission never requires a data
 * migration across every tenant, while roles stay tenant-owned and editable.
 *
 * A Role only ever stores strings from this list; anything unknown is rejected
 * at validation time.
 */
export const PERMISSIONS = [
  // Patients
  "patient.create",
  "patient.view",
  "patient.update",
  "patient.delete",

  // Appointments
  "appointment.create",
  "appointment.view",
  "appointment.update",
  "appointment.cancel",

  // Doctors
  "doctor.create",
  "doctor.view",
  "doctor.update",
  "doctor.delete",

  // Treatments
  "treatment.create",
  "treatment.view",
  "treatment.update",
  "treatment.delete",

  // Departments
  "department.create",
  "department.view",
  "department.update",
  "department.delete",

  // Visits
  "visit.create",
  "visit.view",
  "visit.update",

  /**
   * Prescriptions.
   *
   * `prescription.dispense` is the pharmacy's authority over the queue: it
   * covers both handing a prescription over and withdrawing one. The two are
   * the same act of judgement at the counter, and splitting them would leave a
   * pharmacist able to dispense but not to refuse.
   *
   * Writing a prescription implies `visit.create`, because doing so records the
   * consultation — see prescription.service.ts.
   */
  "prescription.create",
  "prescription.view",
  "prescription.dispense",

  // Billing
  "invoice.create",
  "invoice.view",
  "invoice.update",
  "invoice.delete",
  "payment.create",
  "payment.view",

  // Tenant administration
  "user.create",
  "user.view",
  "user.update",
  "user.delete",
  "role.create",
  "role.view",
  "role.update",
  "role.delete",
  "hospital.settings.view",
  "hospital.settings.update",

  /**
   * Viewing the tenant's audit trail.
   *
   * EXTENSION to the spec's Section 11 catalogue: Phase 8 requires audit logs
   * (Sections 28, 49, 50) but the permission list omits an entry for reading
   * them. Gating them behind `hospital.settings.view` would have conflated two
   * genuinely different things — an audit trail records who did what, and is
   * more sensitive than a settings screen. Granted to Hospital Admin only by
   * default.
   */
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && PERMISSION_SET.has(value);
}

/** Filters an arbitrary stored array down to permissions still in the catalogue. */
export function sanitizePermissions(values: readonly unknown[]): Permission[] {
  const seen = new Set<Permission>();
  for (const value of values) {
    if (isPermission(value)) seen.add(value);
  }
  return [...seen];
}

export type PermissionGroup = {
  resource: string;
  label: string;
  permissions: Permission[];
};

/** Grouped view used by the role editor UI in Phase 2. */
export function groupPermissions(): PermissionGroup[] {
  const labels: Record<string, string> = {
    patient: "Patients",
    appointment: "Appointments",
    doctor: "Doctors",
    treatment: "Treatments",
    department: "Departments",
    visit: "Visits",
    prescription: "Prescriptions",
    invoice: "Invoices",
    payment: "Payments",
    user: "Users",
    role: "Roles",
    hospital: "Hospital Settings",
    audit: "Audit Log",
  };

  const groups = new Map<string, Permission[]>();
  for (const permission of PERMISSIONS) {
    const resource = permission.split(".")[0] ?? "other";
    const bucket = groups.get(resource) ?? [];
    bucket.push(permission);
    groups.set(resource, bucket);
  }

  return [...groups.entries()].map(([resource, permissions]) => ({
    resource,
    label: labels[resource] ?? resource,
    permissions,
  }));
}
