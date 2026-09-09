import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/session";
import { getPlatformStats } from "@/services/hospital.service";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Platform dashboard" };
export const dynamic = "force-dynamic";

/**
 * Platform overview. Shows hospital counts and the most recent tenants —
 * deliberately no patient or clinical data (Sections 3 and 34).
 */
export default async function SuperAdminDashboardPage() {
  await requireSuperAdmin();

  const stats = await getPlatformStats();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">
            Platform overview
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Tenants registered on this installation.
          </p>
        </div>
        <Link href="/super-admin/hospitals/create">
          <Button>Create hospital</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total hospitals" value={stats.total} accent />
        <StatCard label="Active" value={stats.active} />
        <StatCard label="Inactive" value={stats.inactive} />
        <StatCard label="Suspended" value={stats.suspended} />
      </div>

      <Card>
        <CardHeader
          title="Recently created"
          description="The five most recently onboarded hospitals."
          action={
            <Link href="/super-admin/hospitals">
              <Button variant="secondary" size="sm">
                View all
              </Button>
            </Link>
          }
        />
        {stats.recent.length === 0 ? (
          <EmptyState
            title="No hospitals yet"
            description="Create the first hospital to onboard a tenant onto the platform."
            action={
              <Link href="/super-admin/hospitals/create">
                <Button size="sm">Create hospital</Button>
              </Link>
            }
          />
        ) : (
          <CardBody className="p-0">
            <ul className="divide-y divide-ink-100">
              {stats.recent.map((hospital) => (
                <li
                  key={hospital.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {hospital.name}
                    </p>
                    <p className="truncate text-xs text-ink-500">
                      {hospital.type.replace(/_/g, " ")} · {hospital.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={hospital.status} />
                    <time
                      dateTime={hospital.createdAt}
                      className="text-xs text-ink-400"
                    >
                      {new Date(hospital.createdAt).toLocaleDateString()}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
