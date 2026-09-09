import type { Metadata } from "next";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { getSettings } from "@/services/settings.service";
import { SettingsManager } from "@/app/(dashboard)/settings/SettingsManager";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { allowed, user } = await guardHospitalPage("hospital.settings.view");

  if (!allowed) {
    return (
      <AccessDenied permission="hospital.settings.view" what="hospital settings" />
    );
  }

  const settings = await getSettings(user.hospitalId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Settings
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Configuration for {settings.name}. Departments, treatments and roles
          are managed on their own pages.
        </p>
      </div>

      <SettingsManager
        settings={settings}
        canUpdate={hasPermission(user, "hospital.settings.update")}
        canViewAudit={hasPermission(user, "audit.view")}
      />
    </div>
  );
}
