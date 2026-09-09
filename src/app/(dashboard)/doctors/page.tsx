import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { connectToDatabase } from "@/lib/db/connect";
import { Hospital } from "@/models";
import { DEFAULT_CURRENCY, getCurrency } from "@/utils/money";
import { DoctorsManager } from "@/app/(dashboard)/doctors/DoctorsManager";

export const metadata: Metadata = { title: "Doctors" };
export const dynamic = "force-dynamic";

export default async function DoctorsPage() {
  const { allowed, user } = await guardHospitalPage("doctor.view");

  if (!allowed) {
    return <AccessDenied permission="doctor.view" what="doctors" />;
  }

  await connectToDatabase();
  const hospital = await Hospital.findById(user.hospitalId)
    .select("currency")
    .lean();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Doctors
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Practitioners who can be booked, the departments they work in, and
          their weekly availability.
        </p>
      </div>

      <DoctorsManager
        currency={getCurrency(hospital?.currency ?? DEFAULT_CURRENCY)}
        canCreate={hasPermission(user, "doctor.create")}
        canUpdate={hasPermission(user, "doctor.update")}
        canDelete={hasPermission(user, "doctor.delete")}
        canViewDepartments={hasPermission(user, "department.view")}
        canViewUsers={hasPermission(user, "user.view")}
      />
    </div>
  );
}
