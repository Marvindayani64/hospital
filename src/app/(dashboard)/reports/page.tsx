import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { todayDateString } from "@/utils/time";
import { ReportsManager } from "@/app/(dashboard)/reports/ReportsManager";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

/**
 * Reports are readable by any hospital user, but every section is computed only
 * for a caller holding the permission for its data — so this page guards on the
 * broadest relevant permission and lets the API decide what to populate.
 */
export default async function ReportsPage() {
  const { allowed, user } = await guardHospitalPage("patient.view");

  const canSeeAnything =
    allowed ||
    hasPermission(user, "invoice.view") ||
    hasPermission(user, "payment.view") ||
    hasPermission(user, "appointment.view") ||
    hasPermission(user, "visit.view");

  if (!canSeeAnything) {
    return <AccessDenied permission="patient.view" what="reports" />;
  }

  // Default range: the current month to date.
  const today = todayDateString();
  const monthStart = `${today.slice(0, 7)}-01`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Reports
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Revenue and activity over a chosen period. Figures cover this hospital
          only.
        </p>
      </div>

      <ReportsManager defaultFrom={monthStart} defaultTo={today} />
    </div>
  );
}
