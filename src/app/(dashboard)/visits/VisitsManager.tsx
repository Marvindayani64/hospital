"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { VisitFormModal, type VisitRecord } from "@/components/ui/VisitForm";
import { ApiClientError, api } from "@/lib/client/api";
import type { Paginated } from "@/types";

type Visit = VisitRecord;

type Option = { id: string; name: string };
type PatientOption = { id: string; fullName: string; patientNumber: string };

const PAGE_SIZE = 20;

export function VisitsManager({
  today,
  canCreate,
  canUpdate,
  canViewPatients,
  canViewDoctors,
  canViewTreatments,
}: {
  today: string;
  canCreate: boolean;
  canUpdate: boolean;
  canViewPatients: boolean;
  canViewDoctors: boolean;
  canViewTreatments: boolean;
}) {
  const [data, setData] = useState<Paginated<Visit> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [doctors, setDoctors] = useState<Option[]>([]);
  const [treatments, setTreatments] = useState<Option[]>([]);

  const [editing, setEditing] = useState<Visit | "new" | null>(null);
  const [viewing, setViewing] = useState<Visit | null>(null);

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
      if (doctorFilter) params.set("doctorId", doctorFilter);
      if (followUpOnly) params.set("followUpBefore", today);

      try {
        setData(
          await api.get<Paginated<Visit>>(`/api/visits?${params}`, signal),
        );
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError ? err.message : "Could not load visits.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, debouncedSearch, doctorFilter, followUpOnly, today],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();

    if (canViewPatients) {
      api
        .get<Paginated<PatientOption>>(
          "/api/patients?pageSize=100",
          controller.signal,
        )
        .then((result) => setPatients(result.items))
        .catch(() => setPatients([]));
    }

    if (canViewDoctors) {
      api
        .get<Paginated<{ id: string; displayName: string }>>(
          "/api/doctors?pageSize=100&status=active",
          controller.signal,
        )
        .then((result) =>
          setDoctors(
            result.items.map((d) => ({ id: d.id, name: d.displayName })),
          ),
        )
        .catch(() => setDoctors([]));
    }

    if (canViewTreatments) {
      api
        .get<Paginated<Option>>(
          "/api/treatments?pageSize=100&status=active",
          controller.signal,
        )
        .then((result) => setTreatments(result.items))
        .catch(() => setTreatments([]));
    }

    return () => controller.abort();
  }, [canViewPatients, canViewDoctors, canViewTreatments]);

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 px-5 py-3.5">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <label htmlFor="visit-search" className="sr-only">
              Search visits
            </label>
            <input
              id="visit-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search diagnosis or symptoms"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm placeholder:text-ink-400 hover:border-ink-300 focus:border-gold-500"
            />
          </div>

          {doctors.length > 0 ? (
            <div>
              <label htmlFor="visit-doctor" className="sr-only">
                Filter by doctor
              </label>
              <select
                id="visit-doctor"
                value={doctorFilter}
                onChange={(event) => {
                  setDoctorFilter(event.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
              >
                <option value="">All doctors</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={followUpOnly}
              onChange={(event) => {
                setFollowUpOnly(event.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-ink-300 accent-gold-500"
            />
            Follow-up due
          </label>

          <div className="ml-auto flex items-center gap-3">
            {data ? (
              <p className="text-xs text-ink-500">
                {data.total} {data.total === 1 ? "visit" : "visits"}
              </p>
            ) : null}
            {canCreate ? (
              <Button size="sm" onClick={() => setEditing("new")}>
                Record visit
              </Button>
            ) : null}
          </div>
        </div>

        {loading && !data ? (
          <TableSkeleton rows={5} columns={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No visits found"
            description={
              debouncedSearch || doctorFilter || followUpOnly
                ? "Try adjusting your search or filters."
                : "Record a consultation to start building clinical history."
            }
            action={
              canCreate && !debouncedSearch && !doctorFilter && !followUpOnly ? (
                <Button size="sm" onClick={() => setEditing("new")}>
                  Record visit
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[54rem] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Date</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Patient</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Doctor</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Diagnosis</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Follow-up</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((visit) => (
                  <tr key={visit.id} className="hover:bg-ink-50/60">
                    <td className="px-5 py-3 tabular-nums text-ink-900">
                      {visit.visitDate}
                    </td>
                    <td className="px-5 py-3">
                      {visit.patient ? (
                        <>
                          <Link
                            href={`/patients/${visit.patient.id}`}
                            className="text-ink-900 hover:text-gold-700"
                          >
                            {visit.patient.name}
                          </Link>
                          <p className="font-mono text-xs text-ink-500">
                            {visit.patient.patientNumber}
                          </p>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      {visit.doctor?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <p className="max-w-xs truncate text-ink-700">
                        {visit.diagnosis || (
                          <span className="text-xs text-ink-400">
                            Not recorded
                          </span>
                        )}
                      </p>
                      {visit.formResponses.length > 0 ? (
                        <p className="mt-0.5 text-xs text-gold-700">
                          {visit.formResponses.length} attached{" "}
                          {visit.formResponses.length === 1 ? "form" : "forms"}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3">
                      {visit.followUpDate ? (
                        <Badge
                          tone={visit.followUpDate <= today ? "warning" : "neutral"}
                        >
                          <span className="normal-case tabular-nums">
                            {visit.followUpDate}
                          </span>
                        </Badge>
                      ) : (
                        <span className="text-xs text-ink-400">None</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setViewing(visit)}
                        >
                          View
                        </Button>
                        {canUpdate ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(visit)}
                          >
                            Edit
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

      {/* Read-only clinical record */}
      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? `${viewing.patient?.name ?? "Visit"}` : ""}
        description={
          viewing
            ? `${viewing.visitDate} · ${viewing.doctor?.name ?? "Unknown doctor"}`
            : ""
        }
      >
        {viewing ? (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            {(
              [
                ["Symptoms", viewing.symptoms],
                ["Diagnosis", viewing.diagnosis],
                ["Recommendations", viewing.recommendations],
                ["Notes", viewing.notes],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  {label}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-900">
                  {value || "—"}
                </p>
              </div>
            ))}

            {viewing.treatment ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Treatment
                </p>
                <p className="mt-0.5 text-sm text-ink-900">
                  {viewing.treatment.name}
                </p>
              </div>
            ) : null}

            {viewing.followUpDate ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Follow-up
                </p>
                <p className="mt-0.5 text-sm tabular-nums text-ink-900">
                  {viewing.followUpDate}
                </p>
              </div>
            ) : null}

            {viewing.formResponses.length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">
                  Attached forms
                </p>
                <ul className="flex flex-col gap-1.5">
                  {viewing.formResponses.map((response) => (
                    <li
                      key={response.id}
                      className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2 text-sm"
                    >
                      <span className="text-ink-900">{response.formName}</span>
                      <span className="text-xs text-ink-500">
                        v{response.formVersion} ·{" "}
                        {new Date(response.submittedAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {editing ? (
        <VisitFormModal
          visit={editing === "new" ? null : editing}
          patients={patients.map((patient) => ({
            id: patient.id,
            name: patient.fullName,
            patientNumber: patient.patientNumber,
          }))}
          doctors={doctors}
          treatments={treatments}
          defaultDate={today}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </>
  );
}
