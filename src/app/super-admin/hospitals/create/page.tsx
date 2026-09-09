import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/auth/session";
import { CreateHospitalForm } from "@/app/super-admin/hospitals/create/CreateHospitalForm";

export const metadata: Metadata = { title: "Create hospital" };
export const dynamic = "force-dynamic";

export default async function CreateHospitalPage() {
  await requireSuperAdmin();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Create hospital
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Creates the hospital, its five default roles and its administrator
          account in a single operation.
        </p>
      </div>

      <CreateHospitalForm />
    </div>
  );
}
