import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { FormsManager } from "@/app/(dashboard)/forms/FormsManager";

export const metadata: Metadata = { title: "Forms" };
export const dynamic = "force-dynamic";

export default async function FormsPage() {
  const { allowed, user } = await guardHospitalPage("form.view");

  if (!allowed) {
    return <AccessDenied permission="form.view" what="forms" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Forms
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Build the questionnaires this hospital uses. Editing a form that
          already has responses creates a new version, leaving submitted records
          exactly as they were.
        </p>
      </div>

      <FormsManager
        canCreate={hasPermission(user, "form.create")}
        canUpdate={hasPermission(user, "form.update")}
        canDelete={hasPermission(user, "form.delete")}
      />
    </div>
  );
}
