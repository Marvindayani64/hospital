"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark, NavIconGlyph } from "@/components/layout/Icons";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { navSections, type NavItem } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/client/api";
import { cn } from "@/utils/cn";
import type { Permission } from "@/lib/rbac/permissions";

export type ShellUser = {
  name: string;
  email: string;
  roleName: string | null;
  permissions: Permission[];
};

export type ShellWorkspace = {
  /** Hospital name, or the platform name for a Super Admin. */
  title: string;
  subtitle: string;
};

/** Remembers the collapsed sidebar between visits. Presentation only. */
const COLLAPSE_KEY = "hcrm.sidebar.collapsed";

/** Any one of these makes the header omnibox worth showing. */
const SEARCHABLE: readonly Permission[] = [
  "patient.view",
  "doctor.view",
  "invoice.view",
];

export function AppShell({
  user,
  workspace,
  navItems,
  searchable = false,
  children,
}: {
  user: ShellUser;
  workspace: ShellWorkspace;
  navItems: readonly NavItem[];
  /**
   * Whether this workspace has a searchable record set. False for the platform
   * console, whose Super Admin has no tenant data to search.
   */
  searchable?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const sections = navSections(navItems, user.permissions);

  const showSearch =
    searchable &&
    SEARCHABLE.some((permission) => user.permissions.includes(permission));

  // Close the drawer on navigation so it does not cover the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  /**
   * Restored after mount rather than during render: the server has no access
   * to localStorage, so reading it in the initial render would produce markup
   * the client disagrees with and hydration would fail.
   */
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* Storage disabled — the default expanded state is correct. */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* Nothing to persist to; the choice still applies to this session. */
      }
      return next;
    });
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.post("/api/auth/logout");
      // A full navigation, not router.push: it discards all client state and
      // guarantees the cleared cookies take effect.
      window.location.href = "/login";
    } catch {
      toast.error("Could not log out. Please try again.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-ink-200 bg-white transition-all lg:translate-x-0",
          collapsed ? "w-64 lg:w-19" : "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center gap-2.5 border-b border-ink-200",
            collapsed ? "px-4 lg:justify-center lg:px-0" : "px-5",
          )}
        >
          <BrandMark className="shrink-0 text-gold-500" />
          <div className={cn("min-w-0", collapsed && "lg:hidden")}>
            <p className="truncate text-sm font-semibold text-ink-900">
              {workspace.title}
            </p>
            <p className="truncate text-xs text-ink-500">{workspace.subtitle}</p>
          </div>

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            className={cn(
              "ml-auto hidden rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 lg:block",
              collapsed && "lg:hidden",
            )}
          >
            <PanelGlyph />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3" aria-label="Main">
          {sections.map((section) => (
            <div key={section.group ?? "primary"} className="mb-1">
              {section.group ? (
                <p
                  className={cn(
                    "px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400",
                    collapsed && "lg:sr-only",
                  )}
                >
                  {section.group}
                </p>
              ) : null}

              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const active =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                          collapsed && "lg:justify-center lg:px-0",
                          active
                            ? "bg-gold-50 text-gold-800"
                            : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
                        )}
                      >
                        <NavIconGlyph
                          name={item.icon}
                          className={cn(
                            "shrink-0",
                            active ? "text-gold-600" : "text-ink-400",
                          )}
                        />
                        <span className={cn(collapsed && "lg:hidden")}>
                          {item.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-ink-200 p-3">
          {collapsed ? (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Expand sidebar"
              className="mb-2 hidden w-full justify-center rounded-lg p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-700 lg:flex"
            >
              <PanelGlyph />
            </button>
          ) : null}

          <div
            className={cn(
              "rounded-lg bg-ink-50 px-3 py-2.5",
              collapsed && "lg:hidden",
            )}
          >
            <p className="truncate text-sm font-medium text-ink-900">
              {user.name}
            </p>
            <p className="truncate text-xs text-ink-500">{user.email}</p>
            {user.roleName ? (
              <p className="mt-1 truncate text-xs font-medium text-gold-700">
                {user.roleName}
              </p>
            ) : null}
          </div>

          <Button
            variant="ghost"
            size="sm"
            fullWidth
            className={cn("mt-2 justify-start", collapsed && "lg:justify-center")}
            onClick={handleLogout}
            loading={loggingOut}
            title={collapsed ? "Sign out" : undefined}
          >
            <span className={cn(collapsed && "lg:sr-only")}>Sign out</span>
            <SignOutGlyph className={cn("hidden", collapsed && "lg:block")} />
          </Button>
        </div>
      </aside>

      {/* Backdrop for the mobile drawer */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-ink-900/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* Content column */}
      <div className={cn(collapsed ? "lg:pl-19" : "lg:pl-64")}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
            className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>

          {/* Hidden on small screens, where the omnibox needs the whole row. */}
          <div className={cn("min-w-0", showSearch && "hidden lg:block")}>
            <Breadcrumbs pathname={pathname} />
          </div>

          {showSearch ? (
            <div className="min-w-0 flex-1">
              <GlobalSearch />
            </div>
          ) : null}

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.refresh()}
            >
              Refresh
            </Button>
          </div>
        </header>

        <main className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

/** The sidebar collapse control — a panel with its left rail highlighted. */
function PanelGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3.5"
        y="4.5"
        width="17"
        height="15"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M10 4.5v15" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function SignOutGlyph({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M14 20H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 4h8M17 8l4 4-4 4M21 12H10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SEGMENT_LABELS: Record<string, string> = {
  "super-admin": "Platform",
  dashboard: "Dashboard",
  hospitals: "Hospitals",
  create: "Create",
  users: "Staff",
  roles: "Roles",
  departments: "Departments",
  treatments: "Treatments",
  patients: "Patients",
  doctors: "Doctors",
  appointments: "Appointments",
  visits: "Visits",
  pharmacy: "Pharmacy",
  billing: "Billing",
  reports: "Reports",
  settings: "Settings",
};

function Breadcrumbs({ pathname }: { pathname: string }) {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-sm">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          const href = `/${segments.slice(0, index + 1).join("/")}`;
          const label =
            SEGMENT_LABELS[segment] ??
            segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");

          return (
            <li key={href} className="flex items-center gap-1.5">
              {index > 0 ? (
                <span className="text-ink-300" aria-hidden="true">
                  /
                </span>
              ) : null}
              {isLast ? (
                <span className="truncate font-medium text-ink-900">{label}</span>
              ) : (
                <span className="truncate text-ink-500">{label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
