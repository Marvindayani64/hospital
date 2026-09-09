"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { PatientFormModal, type PatientRecord } from "@/components/ui/PatientForm";
import { ApiClientError, api } from "@/lib/client/api";
import type { Paginated } from "@/types";

const PAGE_SIZE = 20;

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  prefer_not_to_say: "—",
};

export function PatientsManager({
  canCreate,
  canUpdate,
  canDelete,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const toast = useToast();

  const [data, setData] = useState<Paginated<PatientRecord> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<PatientRecord | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PatientRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

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

      try {
        setData(
          await api.get<Paginated<PatientRecord>>(
            `/api/patients?${params}`,
            signal,
          ),
        );
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load patients.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, debouncedSearch],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/patients/${pendingDelete.id}`);
      toast.success(`${pendingDelete.fullName} removed.`);
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Could not delete the patient.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 px-5 py-3.5">
          <div className="min-w-0 flex-1 sm:max-w-sm">
            <label htmlFor="patient-search" className="sr-only">
              Search patients
            </label>
            <input
              id="patient-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, phone or patient number"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm placeholder:text-ink-400 hover:border-ink-300 focus:border-gold-500"
            />
          </div>

          <div className="ml-auto flex items-center gap-3">
            {data ? (
              <p className="text-xs text-ink-500">
                {data.total} {data.total === 1 ? "patient" : "patients"}
              </p>
            ) : null}
            {canCreate ? (
              <Button size="sm" onClick={() => setEditing("new")}>
                Register patient
              </Button>
            ) : null}
          </div>
        </div>

        {loading && !data ? (
          <TableSkeleton rows={6} columns={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No patients found"
            description={
              debouncedSearch
                ? "No one matches that search."
                : "Register your first patient to get started."
            }
            action={
              canCreate && !debouncedSearch ? (
                <Button size="sm" onClick={() => setEditing("new")}>
                  Register patient
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Patient</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Number</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Contact</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Age</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((patient) => (
                  <tr key={patient.id} className="hover:bg-ink-50/60">
                    <td className="px-5 py-3">
                      <Link
                        href={`/patients/${patient.id}`}
                        className="font-medium text-ink-900 hover:text-gold-700"
                      >
                        {patient.fullName}
                      </Link>
                      <p className="text-xs text-ink-500">
                        {GENDER_LABELS[patient.gender] ?? patient.gender}
                      </p>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-600">
                      {patient.patientNumber}
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      <p>{patient.phone}</p>
                      {patient.email ? (
                        <p className="text-xs text-ink-500">{patient.email}</p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-ink-600">
                      {patient.age ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Link href={`/patients/${patient.id}`}>
                          <Button size="sm" variant="secondary">
                            View
                          </Button>
                        </Link>
                        {canUpdate ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(patient)}
                          >
                            Edit
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-700 hover:bg-red-50"
                            onClick={() => setPendingDelete(patient)}
                          >
                            Delete
                          </Button>
                        ) : null}
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

      {editing ? (
        <PatientFormModal
          patient={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete this patient?"
        description={
          pendingDelete
            ? `${pendingDelete.fullName} (${pendingDelete.patientNumber}) will be removed permanently. Patients with appointment history cannot be deleted.`
            : ""
        }
        confirmLabel="Delete patient"
        tone="danger"
        loading={deleting}
      />
    </>
  );
}
