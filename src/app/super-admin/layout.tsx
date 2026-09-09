import { redirect } from "next/navigation";
import { getAuthOutcome } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/AppShell";
import { SUPER_ADMIN_NAV } from "@/components/layout/nav-config";

export const dynamic = "force-dynamic";

/** Platform administration shell. Restricted to Super Admins. */
export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const outcome = await getAuthOutcome();

  if (!outcome.ok) redirect("/login");

  const user = outcome.user;

  if (user.mustChangePassword) redirect("/change-password");

  // Hospital users have no business in the platform console. The API enforces
  // the same rule via requireSuperAdmin().
  if (!user.isSuperAdmin) redirect("/dashboard");

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        roleName: "Super Admin",
        permissions: user.permissions,
      }}
      workspace={{ title: "Hospital CRM", subtitle: "Platform console" }}
      navItems={SUPER_ADMIN_NAV}
    >
      {children}
    </AppShell>
  );
}
