import { PERMISSIONS, type Permission } from "@/lib/rbac/permissions";

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

/** Every hospital-scoped permission in the catalogue. */
const ALL_HOSPITAL_PERMISSIONS: Permission[] = [...PERMISSIONS];

export const DEFAULT_ROLE_TEMPLATES: readonly DefaultRoleTemplate[] = [
  {
    key: "hospital_admin",
    name: "Hospital Admin",
    description:
      "Full administrative control over this hospital's data, staff and configuration.",
    permissions: ALL_HOSPITAL_PERMISSIONS,
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
