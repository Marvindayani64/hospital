import type { Permission } from "@/lib/rbac/permissions";

export type NavItem = {
  label: string;
  href: string;
  icon: NavIcon;
  /**
   * The item renders only if the user holds at least one of these. An empty
   * list means "any authenticated tenant user".
   *
   * Hiding a link is a convenience, never a control — the backend authorises
   * every request independently (Section 33).
   */
  permissions: Permission[];
  /** False until the module's pages land in a later phase. */
  available: boolean;
};

export type NavIcon =
  | "dashboard"
  | "patients"
  | "appointments"
  | "doctors"
  | "departments"
  | "treatments"
  | "forms"
  | "visits"
  | "billing"
  | "reports"
  | "users"
  | "roles"
  | "settings"
  | "hospitals";

/** Tenant (hospital) navigation. */
export const HOSPITAL_NAV: readonly NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: "dashboard",
    permissions: [],
    available: true,
  },
  // Phase 3-8 modules. Declared here so the permission mapping is settled, but
  // not rendered until their pages exist.
  {
    label: "Patients",
    href: "/patients",
    icon: "patients",
    permissions: ["patient.view"],
    available: true,
  },
  {
    label: "Appointments",
    href: "/appointments",
    icon: "appointments",
    permissions: ["appointment.view"],
    available: true,
  },
  {
    label: "Doctors",
    href: "/doctors",
    icon: "doctors",
    permissions: ["doctor.view"],
    available: true,
  },
  {
    label: "Departments",
    href: "/departments",
    icon: "departments",
    permissions: ["department.view"],
    available: true,
  },
  {
    label: "Treatments",
    href: "/treatments",
    icon: "treatments",
    permissions: ["treatment.view"],
    available: true,
  },
  {
    label: "Forms",
    href: "/forms",
    icon: "forms",
    permissions: ["form.view"],
    available: true,
  },
  {
    label: "Visits",
    href: "/visits",
    icon: "visits",
    permissions: ["visit.view"],
    available: true,
  },
  {
    label: "Billing",
    href: "/billing",
    icon: "billing",
    permissions: ["invoice.view", "payment.view"],
    available: true,
  },
  {
    /**
     * Reports draw on billing and clinical data; any of these permissions makes
     * some section of the page useful, and the API populates only what the
     * caller may see.
     */
    label: "Reports",
    href: "/reports",
    icon: "reports",
    permissions: [
      "invoice.view",
      "payment.view",
      "appointment.view",
      "visit.view",
      "patient.view",
    ],
    available: true,
  },
  {
    label: "Staff",
    href: "/users",
    icon: "users",
    permissions: ["user.view"],
    available: true,
  },
  {
    label: "Roles",
    href: "/roles",
    icon: "roles",
    permissions: ["role.view"],
    available: true,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: "settings",
    permissions: ["hospital.settings.view"],
    available: true,
  },
] as const;

/** Platform (Super Admin) navigation. */
export const SUPER_ADMIN_NAV: readonly NavItem[] = [
  {
    label: "Dashboard",
    href: "/super-admin/dashboard",
    icon: "dashboard",
    permissions: [],
    available: true,
  },
  {
    label: "Hospitals",
    href: "/super-admin/hospitals",
    icon: "hospitals",
    permissions: [],
    available: true,
  },
] as const;

export function visibleNavItems(
  items: readonly NavItem[],
  permissions: readonly Permission[],
): NavItem[] {
  return items.filter((item) => {
    if (!item.available) return false;
    if (item.permissions.length === 0) return true;
    return item.permissions.some((permission) =>
      permissions.includes(permission),
    );
  });
}
