import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/session";
import { Button } from "@/components/ui/Button";
import { HospitalsTable } from "@/app/super-admin/hospitals/HospitalsTable";

export const metadata: Metadata = { title: "Hospitals" };
export const dynamic = "force-dynamic";

export default async function HospitalsPage() {
  await requireSuperAdmin();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">
            Hospitals
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Every tenant on the platform, with its administrator and status.
          </p>
        </div>
        <Link href="/super-admin/hospitals/create">
          <Button>Create hospital</Button>
        </Link>
      </div>

      {/* Data is fetched client-side so search, filtering and status changes
          update without a full page round-trip. */}
      <HospitalsTable />
    </div>
  );
}
