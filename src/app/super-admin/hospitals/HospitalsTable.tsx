"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardBody } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import type { Paginated } from "@/types";

type HospitalRow = {
  id: string;
  name: string;
  slug: string;
  type: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  status: "active" | "inactive" | "suspended";
  admin: { id: string; name: string; email: string } | null;
  createdAt: string;
};

type StatusFilter = "" | "active" | "inactive" | "suspended";
type PendingAction = { hospital: HospitalRow; status: HospitalRow["status"] };

const PAGE_SIZE = 20;

const ACTION_COPY: Record<
  HospitalRow["status"],
  { label: string; title: string; description: string; danger: boolean }
> = {
  active: {
    label: "Activate",
    title: "Activate this hospital?",
    description:
      "Staff will be able to sign in again. Everyone must re-authenticate, because reactivation invalidates all existing tokens.",
    danger: false,
  },
  inactive: {
    label: "Deactivate",
    title: "Deactivate this hospital?",
    description:
      "Every user of this hospital is signed out immediately and cannot sign in until it is reactivated.",
    danger: true,
  },
  suspended: {
    label: "Suspend",
    title: "Suspend this hospital?",
    description:
      "Every user of this hospital is signed out immediately and all active sessions are revoked.",
    danger: true,
  },
};

export function HospitalsTable() {
  const toast = useToast();

  const [data, setData] = useState<Paginated<HospitalRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [updating, setUpdating] = useState(false);

  // Debounce so a query is not issued on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (status) params.set("status", status);

      try {
        const result = await api.get<Paginated<HospitalRow>>(
          `/api/super-admin/hospitals?${params}`,
          signal,
        );
        setData(result);
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load hospitals.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, debouncedSearch, status],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function applyStatusChange() {
    if (!pending) return;
    setUpdating(true);

    try {
      await api.put(`/api/super-admin/hospitals/${pending.hospital.id}`, {
        status: pending.status,
      });
      toast.success(`${pending.hospital.name} is now ${pending.status}.`);
      setPending(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Could not update the hospital status.",
      );
    } finally {
      setUpdating(false);
    }
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 px-5 py-3.5">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <label htmlFor="hospital-search" className="sr-only">
              Search hospitals
            </label>
            <input
              id="hospital-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, email or city"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm placeholder:text-ink-400 hover:border-ink-300 focus:border-gold-500"
            />
          </div>

          <div>
            <label htmlFor="status-filter" className="sr-only">
              Filter by status
            </label>
            <select
              id="status-filter"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as StatusFilter);
                setPage(1);
              }}
              className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          {data ? (
            <p className="ml-auto text-xs text-ink-500">
              {data.total} {data.total === 1 ? "hospital" : "hospitals"}
            </p>
          ) : null}
        </div>

        {loading && !data ? (
          <TableSkeleton rows={5} columns={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No hospitals found"
            description={
              debouncedSearch || status
                ? "Try adjusting your search or filter."
                : "Create the first hospital to onboard a tenant."
            }
            action={
              debouncedSearch || status ? undefined : (
                <Link href="/super-admin/hospitals/create">
                  <Button size="sm">Create hospital</Button>
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Hospital</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Type</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Administrator</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Created</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((hospital) => (
                  <tr key={hospital.id} className="hover:bg-ink-50/60">
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">{hospital.name}</p>
                      <p className="text-xs text-ink-500">
                        {[hospital.city, hospital.country]
                          .filter(Boolean)
                          .join(", ") || hospital.email}
                      </p>
                    </td>
                    <td className="px-5 py-3 capitalize text-ink-600">
                      {hospital.type.replace(/_/g, " ")}
                    </td>
                    <td className="px-5 py-3">
                      {hospital.admin ? (
                        <>
                          <p className="text-ink-900">{hospital.admin.name}</p>
                          <p className="text-xs text-ink-500">
                            {hospital.admin.email}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-ink-400">Not assigned</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={hospital.status} />
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      {new Date(hospital.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        {hospital.status !== "active" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setPending({ hospital, status: "active" })
                            }
                          >
                            Activate
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                setPending({ hospital, status: "inactive" })
                              }
                            >
                              Deactivate
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() =>
                                setPending({ hospital, status: "suspended" })
                              }
                            >
                              Suspend
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.totalPages > 1 ? (
          <CardBody className="flex items-center justify-between border-t border-ink-200">
            <p className="text-xs text-ink-500">
              Page {data.page} of {data.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= data.totalPages || loading}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </CardBody>
        ) : null}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => void applyStatusChange()}
        title={pending ? ACTION_COPY[pending.status].title : ""}
        description={pending ? ACTION_COPY[pending.status].description : ""}
        confirmLabel={pending ? ACTION_COPY[pending.status].label : "Confirm"}
        tone={pending && ACTION_COPY[pending.status].danger ? "danger" : "primary"}
        loading={updating}
      />
    </>
  );
}
