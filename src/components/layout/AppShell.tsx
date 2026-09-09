"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark, NavIconGlyph } from "@/components/layout/Icons";
import {
  visibleNavItems,
  type NavItem,
} from "@/components/layout/nav-config";
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

export function AppShell({
  user,
  workspace,
  navItems,
  children,
}: {
  user: ShellUser;
  workspace: ShellWorkspace;
  navItems: readonly NavItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const items = visibleNavItems(navItems, user.permissions);

  // Close the drawer on navigation so it does not cover the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-ink-200 bg-white transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-ink-200 px-5">
          <BrandMark className="text-gold-500" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-900">
              {workspace.title}
            </p>
            <p className="truncate text-xs text-ink-500">{workspace.subtitle}</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3" aria-label="Main">
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-gold-50 text-gold-800"
                        : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
                    )}
                  >
                    <NavIconGlyph
                      name={item.icon}
                      className={active ? "text-gold-600" : "text-ink-400"}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-ink-200 p-3">
          <div className="rounded-lg bg-ink-50 px-3 py-2.5">
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
            className="mt-2 justify-start"
            onClick={handleLogout}
            loading={loggingOut}
          >
            Sign out
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
      <div className="lg:pl-64">
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

          <Breadcrumbs pathname={pathname} />

          <div className="ml-auto flex items-center gap-2">
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
  forms: "Forms",
  visits: "Visits",
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
