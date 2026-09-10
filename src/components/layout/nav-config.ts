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
  /**
   * Sidebar section heading. Items sharing a group are rendered under one
   * heading, in the order they appear here. Omit for a top-level item.
   *
   * Purely presentational — grouping never affects what a user may reach.
   */
  group?: string;
};

export type NavIcon =
  | "dashboard"
  | "patients"
  | "appointments"
  | "doctors"
  | "departments"
  | "treatments"
  | "visits"
  | "pharmacy"
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
    group: "Clinical",
  },
  {
    label: "Appointments",
    href: "/appointments",
    icon: "appointments",
    permissions: ["appointment.view"],
    available: true,
    group: "Clinical",
  },
  {
    label: "Visits",
    href: "/visits",
    icon: "visits",
    permissions: ["visit.view"],
    available: true,
    group: "Clinical",
  },
  {
    label: "Pharmacy",
    href: "/pharmacy",
    icon: "pharmacy",
    permissions: ["prescription.view"],
    available: true,
    group: "Clinical",
  },
  {
    label: "Doctors",
    href: "/doctors",
    icon: "doctors",
    permissions: ["doctor.view"],
    available: true,
    group: "Practice",
  },
  {
    label: "Departments",
    href: "/departments",
    icon: "departments",
    permissions: ["department.view"],
    available: true,
    group: "Practice",
  },
  {
    label: "Treatments",
    href: "/treatments",
    icon: "treatments",
    permissions: ["treatment.view"],
    available: true,
    group: "Practice",
  },
  {
    label: "Billing",
    href: "/billing",
    icon: "billing",
    permissions: ["invoice.view", "payment.view"],
    available: true,
    group: "Finance & Insights",
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
    group: "Finance & Insights",
  },
  {
    label: "Staff",
    href: "/users",
    icon: "users",
    permissions: ["user.view"],
    available: true,
    group: "Administration",
  },
  {
    label: "Roles",
    href: "/roles",
    icon: "roles",
    permissions: ["role.view"],
    available: true,
    group: "Administration",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: "settings",
    permissions: ["hospital.settings.view"],
    available: true,
    group: "Administration",
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

export type NavSection = { group: string | null; items: NavItem[] };

/**
 * Splits the visible items into sidebar sections, preserving declaration order.
 *
 * A heading only appears when something under it survived the permission
 * filter, so a receptionist never sees an empty "Finance & Insights" label.
 */
export function navSections(
  items: readonly NavItem[],
  permissions: readonly Permission[],
): NavSection[] {
  const sections: NavSection[] = [];

  for (const item of visibleNavItems(items, permissions)) {
    const group = item.group ?? null;
    const last = sections[sections.length - 1];

    if (last && last.group === group) last.items.push(item);
    else sections.push({ group, items: [item] });
  }

  return sections;
}
