import type { Permission } from "@/lib/rbac/permissions";

/**
 * Stable machine keys for the roles every hospital is seeded with. `isSystem`
 * roles cannot be deleted by a Hospital Admin, but their permission sets remain
 * editable — hospitals differ in how much a nurse or receptionist may do.
 */
export const SYSTEM_ROLE_KEYS = [
  "hospital_admin",
  "doctor",
  "receptionist",
  "nurse",
  "accountant",
  "pharmacist",
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export type DefaultRoleTemplate = {
  key: SystemRoleKey;
  name: string;
  description: string;
  permissions: Permission[];
};

export const DEFAULT_ROLE_TEMPLATES: readonly DefaultRoleTemplate[] = [
  {
    key: "hospital_admin",
    name: "Hospital Admin",
    description:
      "Runs the hospital: staff, roles, settings and the catalogue. Sees all clinical and financial records, but does not enter them.",
    /**
     * Deliberately NOT every permission in the catalogue.
     *
     * The split is between running the hospital and working in it. An admin
     * configures the place — its staff, roles, departments, treatments,
     * doctors — and can read everything that happens there. The day-to-day
     * records are entered by the people who do the work: the front desk books
     * patients in, a doctor writes the consultation and the prescription, the
     * pharmacy dispenses, an accountant raises the invoice.
     *
     * So every operational resource below is `.view` only. That is not a
     * limit on trust: permissions on a system role stay editable, so an admin
     * who also needs to do the work can grant it back on the Roles screen.
     * It is the default that matters — an admin panel that reports rather than
     * one that quietly becomes a second way to enter clinical data.
     */
    permissions: [
      // Operational records — read-only.
      "patient.view",
      "appointment.view",
      "visit.view",
      "prescription.view",
      "invoice.view",
      "payment.view",

      // The catalogue and the practice — the admin's to configure.
      "doctor.create",
      "doctor.view",
      "doctor.update",
      "doctor.delete",
      "treatment.create",
      "treatment.view",
      "treatment.update",
      "treatment.delete",
      "department.create",
      "department.view",
      "department.update",
      "department.delete",

      // Tenant administration.
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
      "audit.view",
    ],
  },
  {
    key: "doctor",
    name: "Doctor",
    description: "Clinical access: patients, appointments and visits.",
    permissions: [
      "patient.view",
      "appointment.view",
      "appointment.update",
      "treatment.view",
      "department.view",
      "visit.create",
      "visit.view",
      "visit.update",
      "prescription.create",
      "prescription.view",
    ],
  },
  {
    key: "receptionist",
    name: "Receptionist",
    description: "Front-desk access: patient registration and appointment scheduling.",
    permissions: [
      "patient.create",
      "patient.view",
      "patient.update",
      "appointment.create",
      "appointment.view",
      "appointment.update",
      "appointment.cancel",
      "doctor.view",
      "department.view",
      "treatment.view",
    ],
  },
  {
    key: "nurse",
    name: "Nurse",
    description: "Ward access: patient records and appointments.",
    permissions: [
      "patient.view",
      "patient.update",
      "appointment.view",
      "visit.view",
      "treatment.view",
      "department.view",
      "prescription.view",
    ],
  },
  {
    key: "accountant",
    name: "Accountant",
    description: "Billing access: invoices and payments.",
    permissions: [
      "patient.view",
      "invoice.create",
      "invoice.view",
      "invoice.update",
      "payment.create",
      "payment.view",
      "treatment.view",
    ],
  },
  {
    key: "pharmacist",
    name: "Pharmacist",
    description:
      "Pharmacy access: the prescription queue, and dispensing against it.",
    /**
     * Deliberately NOT granted `visit.view`. The pharmacy needs to know what
     * was prescribed and to whom, not to read the consultation notes behind it
     * — so the queue carries the prescriber's note to the pharmacy, and the
     * clinical record stays with clinical staff.
     */
    permissions: [
      "patient.view",
      "prescription.view",
      "prescription.dispense",
      "doctor.view",
      "department.view",
      "treatment.view",
    ],
  },
] as const;

export const HOSPITAL_ADMIN_ROLE_KEY: SystemRoleKey = "hospital_admin";
