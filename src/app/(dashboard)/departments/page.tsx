import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { DepartmentsManager } from "@/app/(dashboard)/departments/DepartmentsManager";

export const metadata: Metadata = { title: "Departments" };
export const dynamic = "force-dynamic";

export default async function DepartmentsPage() {
  const { allowed, user } = await guardHospitalPage("department.view");

  if (!allowed) {
    return <AccessDenied permission="department.view" what="departments" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Departments
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          The specialties this hospital runs. Nothing here is preset — define
          whatever fits your practice.
        </p>
      </div>

      <DepartmentsManager
        canCreate={hasPermission(user, "department.create")}
        canUpdate={hasPermission(user, "department.update")}
        canDelete={hasPermission(user, "department.delete")}
      />
    </div>
  );
}
