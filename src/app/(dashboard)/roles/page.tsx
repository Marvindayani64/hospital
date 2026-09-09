import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { groupPermissions } from "@/lib/rbac/permissions";
import { RolesManager } from "@/app/(dashboard)/roles/RolesManager";

export const metadata: Metadata = { title: "Roles" };
export const dynamic = "force-dynamic";

/**
 * Role management.
 *
 * The permission catalogue is rendered on the server and handed to the client
 * as a prop — it is static data, so fetching it separately would only add a
 * round trip.
 */
export default async function RolesPage() {
  const { allowed, user } = await guardHospitalPage("role.view");

  if (!allowed) {
    return <AccessDenied permission="role.view" what="role management" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Roles &amp; permissions
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Control what each group of staff can do. Changes apply immediately —
          permissions are re-read from the role on every request.
        </p>
      </div>

      <RolesManager
        groups={groupPermissions()}
        canCreate={hasPermission(user, "role.create")}
        canUpdate={hasPermission(user, "role.update")}
        canDelete={hasPermission(user, "role.delete")}
      />
    </div>
  );
}
