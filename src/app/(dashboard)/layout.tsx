import { redirect } from "next/navigation";
import { getAuthOutcome } from "@/lib/auth/session";
import { connectToDatabase } from "@/lib/db/connect";
import { Hospital, Role } from "@/models";
import { AppShell } from "@/components/layout/AppShell";
import { HOSPITAL_NAV } from "@/components/layout/nav-config";

export const dynamic = "force-dynamic";

/**
 * Tenant workspace shell.
 *
 * Auth is resolved here on the server and passed down as props, so the shell
 * renders with the user already known — no client-side /api/auth/me waterfall
 * and no flash of an empty sidebar.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const outcome = await getAuthOutcome();

  if (!outcome.ok) redirect("/login");

  const user = outcome.user;

  // Enforced independently by requireAuth() on every API call; this redirect
  // is the page-level equivalent.
  if (user.mustChangePassword) redirect("/change-password");

  // A Super Admin has no tenant workspace to show.
  if (user.isSuperAdmin) redirect("/super-admin/dashboard");

  await connectToDatabase();

  const [hospital, role] = await Promise.all([
    Hospital.findById(user.hospitalId).select("name type").lean(),
    user.roleId
      ? Role.findOne({ _id: user.roleId, hospitalId: user.hospitalId })
          .select("name")
          .lean()
      : null,
  ]);

  if (!hospital) redirect("/login");

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        roleName: role?.name ?? null,
        permissions: user.permissions,
      }}
      workspace={{
        title: hospital.name,
        subtitle: hospital.type.replace(/_/g, " "),
      }}
      navItems={HOSPITAL_NAV}
      searchable
    >
      {children}
    </AppShell>
  );
}
