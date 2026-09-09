import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { UsersManager } from "@/app/(dashboard)/users/UsersManager";

export const metadata: Metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

/**
 * Staff management for one hospital.
 *
 * The capability flags below only decide which controls are rendered. Every
 * corresponding endpoint re-checks the same permission server-side, so hiding a
 * button is a convenience and never the control itself (Section 33).
 */
export default async function UsersPage() {
  const { allowed, user } = await guardHospitalPage("user.view");

  if (!allowed) {
    return <AccessDenied permission="user.view" what="staff management" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Staff
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Members of this hospital. New members receive a one-time temporary
          password and must change it on first sign-in.
        </p>
      </div>

      <UsersManager
        currentUserId={user.userId}
        canCreate={hasPermission(user, "user.create")}
        canUpdate={hasPermission(user, "user.update")}
        canDelete={hasPermission(user, "user.delete")}
      />
    </div>
  );
}
