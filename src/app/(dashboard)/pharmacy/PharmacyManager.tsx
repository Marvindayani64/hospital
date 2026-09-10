"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextAreaField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import {
  PRESCRIPTION_STATUS_LABELS,
  PRESCRIPTION_STATUS_TONES,
} from "@/components/ui/prescription-status";
import type { PrescriptionRecord } from "@/components/ui/PrescriptionForm";
import { ApiClientError, api } from "@/lib/client/api";
import { PRESCRIPTION_STATUSES } from "@/lib/domain/enums";
import type { Paginated } from "@/types";

type Option = { id: string; name: string };

const PAGE_SIZE = 20;

/**
 * The pharmacy's work queue.
 *
 * Defaults to `pending` rather than everything: this screen exists to answer
 * "what is waiting", and a queue that opens on months of dispensed history
 * answers a question nobody asked.
 */
export function PharmacyManager({
  canDispense,
  canViewPatients,
  canViewDoctors,
}: {
  canDispense: boolean;
  canViewPatients: boolean;
  canViewDoctors: boolean;
}) {
  const toast = useToast();

  const [data, setData] = useState<Paginated<PrescriptionRecord> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<string>("pending");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [page, setPage] = useState(1);

  const [doctors, setDoctors] = useState<Option[]>([]);

  const [viewing, setViewing] = useState<PrescriptionRecord | null>(null);
  /** The prescription being acted on, and which way. */
  const [acting, setActing] = useState<{
    prescription: PrescriptionRecord;
    status: "dispensed" | "cancelled";
  } | null>(null);
  const [dispensingNotes, setDispensingNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
      if (doctorFilter) params.set("doctorId", doctorFilter);

      try {
        setData(
          await api.get<Paginated<PrescriptionRecord>>(
            `/api/prescriptions?${params}`,
            signal,
          ),
        );
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load prescriptions.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, debouncedSearch, status, doctorFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!canViewDoctors) return;

    const controller = new AbortController();
    api
      .get<Paginated<{ id: string; displayName: string }>>(
        "/api/doctors?pageSize=100&status=active",
        controller.signal,
      )
      .then((result) =>
        setDoctors(result.items.map((d) => ({ id: d.id, name: d.displayName }))),
      )
      .catch(() => setDoctors([]));

    return () => controller.abort();
  }, [canViewDoctors]);

  async function submitAction() {
    if (!acting) return;

    setSubmitting(true);
    setActionError(null);

    try {
      await api.put(`/api/prescriptions/${acting.prescription.id}`, {
        status: acting.status,
        dispensingNotes,
      });
      toast.success(
        acting.status === "dispensed"
          ? "Prescription dispensed."
          : "Prescription cancelled.",
      );
      setActing(null);
      setDispensingNotes("");
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiClientError
          ? err.message
          : "Could not update the prescription.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 px-5 py-3.5">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <label htmlFor="prescription-search" className="sr-only">
              Search prescriptions
            </label>
            <input
              id="prescription-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by drug name"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm placeholder:text-ink-400 hover:border-ink-300 focus:border-gold-500"
            />
          </div>

          <div>
            <label htmlFor="prescription-status" className="sr-only">
              Filter by status
            </label>
            <select
              id="prescription-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
            >
              <option value="">All statuses</option>
              {PRESCRIPTION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {PRESCRIPTION_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          {doctors.length > 0 ? (
            <div>
              <label htmlFor="prescription-doctor" className="sr-only">
                Filter by prescriber
              </label>
              <select
                id="prescription-doctor"
                value={doctorFilter}
                onChange={(event) => {
                  setDoctorFilter(event.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
              >
                <option value="">All prescribers</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {data ? (
            <p className="ml-auto text-xs text-ink-500">
              {data.total}{" "}
              {data.total === 1 ? "prescription" : "prescriptions"}
            </p>
          ) : null}
        </div>

        {loading && !data ? (
          <TableSkeleton rows={5} columns={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title={
              status === "pending"
                ? "Nothing waiting"
                : "No prescriptions found"
            }
            description={
              debouncedSearch || doctorFilter
                ? "Try adjusting your search or filters."
                : status === "pending"
                  ? "Every prescription has been dealt with."
                  : "Prescriptions written by doctors will appear here."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Date</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Patient</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Prescriber</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Drugs</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((prescription) => (
                  <tr key={prescription.id} className="hover:bg-ink-50/60">
                    <td className="px-5 py-3 tabular-nums text-ink-900">
                      {prescription.prescribedDate}
                    </td>
                    <td className="px-5 py-3">
                      {prescription.patient ? (
                        <>
                          {canViewPatients ? (
                            <Link
                              href={`/patients/${prescription.patient.id}`}
                              className="text-ink-900 hover:text-gold-700"
                            >
                              {prescription.patient.name}
                            </Link>
                          ) : (
                            <span className="text-ink-900">
                              {prescription.patient.name}
                            </span>
                          )}
                          <p className="font-mono text-xs text-ink-500">
                            {prescription.patient.patientNumber}
                          </p>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      {prescription.doctor?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <p className="max-w-xs truncate text-ink-700">
                        {prescription.items
                          .map((item) => item.drugName)
                          .join(", ")}
                      </p>
                      <p className="text-xs text-ink-500">
                        {prescription.items.length}{" "}
                        {prescription.items.length === 1 ? "drug" : "drugs"}
                        {prescription.notes ? " · note attached" : ""}
                      </p>
                    </td>
                    <td className="px-5 py-3">
                      <Badge
                        tone={PRESCRIPTION_STATUS_TONES[prescription.status]}
                      >
                        <span className="normal-case">
                          {PRESCRIPTION_STATUS_LABELS[prescription.status]}
                        </span>
                      </Badge>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setViewing(prescription)}
                        >
                          View
                        </Button>
                        {canDispense && prescription.status === "pending" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => {
                                setDispensingNotes("");
                                setActionError(null);
                                setActing({ prescription, status: "dispensed" });
                              }}
                            >
                              Dispense
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setDispensingNotes("");
                                setActionError(null);
                                setActing({ prescription, status: "cancelled" });
                              }}
                            >
                              Cancel
                            </Button>
                          </>
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

      {/* The full prescription, as written. */}
      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing?.patient?.name ?? "Prescription"}
        description={
          viewing
            ? `${viewing.prescribedDate} · ${viewing.doctor?.name ?? "Unknown prescriber"}`
            : ""
        }
      >
        {viewing ? (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            <ul className="flex flex-col gap-2">
              {viewing.items.map((item, index) => (
                <li
                  key={index}
                  className="rounded-lg border border-ink-200 px-3.5 py-2.5"
                >
                  <p className="text-sm font-medium text-ink-900">
                    {item.drugName}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-600">
                    {[item.dosage, item.frequency, item.duration]
                      .filter(Boolean)
                      .join(" · ") || "No dosage recorded"}
                  </p>
                  {item.instructions ? (
                    <p className="mt-0.5 text-sm text-ink-500">
                      {item.instructions}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>

            {viewing.notes ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Note to pharmacy
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-900">
                  {viewing.notes}
                </p>
              </div>
            ) : null}

            {viewing.status !== "pending" ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  {viewing.status === "dispensed" ? "Dispensed" : "Cancelled"}
                </p>
                <p className="mt-0.5 text-sm text-ink-900">
                  {viewing.dispensedBy?.name ?? "Unknown"}
                  {viewing.dispensedAt
                    ? ` · ${new Date(viewing.dispensedAt).toLocaleString()}`
                    : ""}
                </p>
                {viewing.dispensingNotes ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-600">
                    {viewing.dispensingNotes}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* Dispensing is deliberately a confirmation, not a one-click action:
          both outcomes are final. */}
      <Modal
        open={acting !== null}
        onClose={() => setActing(null)}
        title={
          acting?.status === "dispensed"
            ? "Dispense prescription"
            : "Cancel prescription"
        }
        description={
          acting
            ? `${acting.prescription.patient?.name ?? "Patient"} · ${acting.prescription.items
                .map((item) => item.drugName)
                .join(", ")}`
            : ""
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setActing(null)}
              disabled={submitting}
            >
              Back
            </Button>
            <Button onClick={() => void submitAction()} loading={submitting}>
              {acting?.status === "dispensed"
                ? "Confirm dispense"
                : "Confirm cancellation"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {actionError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
            >
              {actionError}
            </div>
          ) : null}

          <p className="text-sm text-ink-600">
            {acting?.status === "dispensed"
              ? "This records that the drugs were handed over. It cannot be undone."
              : "This withdraws the prescription. The doctor must write a new one to replace it."}
          </p>

          <TextAreaField
            label="Note"
            rows={3}
            value={dispensingNotes}
            onChange={(event) => setDispensingNotes(event.target.value)}
            placeholder={
              acting?.status === "dispensed"
                ? "Substitutions made, counselling given."
                : "Why it could not be dispensed."
            }
            maxLength={1000}
            hint="Optional."
          />
        </div>
      </Modal>
    </>
  );
}
