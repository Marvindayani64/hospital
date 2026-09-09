"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { ComboField, SelectField, TextField } from "@/components/ui/Field";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import { SPECIALISATION_SUGGESTIONS } from "@/lib/domain/suggestions";
import { WEEKDAY_NAMES } from "@/utils/time";
import type { Currency } from "@/utils/money";
import type { Paginated } from "@/types";

type AvailabilityWindow = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

type Doctor = {
  id: string;
  displayName: string;
  specialization: string;
  userId: string | null;
  linkedAccount: { id: string; name: string; email: string } | null;
  departments: Array<{ id: string; name: string }>;
  consultationFee: number;
  consultationFeeMinor: number;
  currency: string;
  consultationFeeFormatted: string;
  availability: AvailabilityWindow[];
  status: "active" | "inactive";
  createdAt: string;
};

type Department = { id: string; name: string };
type StaffMember = { id: string; name: string; email: string };

const PAGE_SIZE = 20;

export function DoctorsManager({
  currency,
  canCreate,
  canUpdate,
  canDelete,
  canViewDepartments,
  canViewUsers,
}: {
  currency: Currency;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canViewDepartments: boolean;
  canViewUsers: boolean;
}) {
  const toast = useToast();

  const [data, setData] = useState<Paginated<Doctor> | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<Doctor | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Doctor | null>(null);
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
      if (statusFilter) params.set("status", statusFilter);

      try {
        setData(
          await api.get<Paginated<Doctor>>(`/api/doctors?${params}`, signal),
        );
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError ? err.message : "Could not load doctors.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, debouncedSearch, statusFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!canViewDepartments) return;
    const controller = new AbortController();
    api
      .get<Paginated<Department>>("/api/departments?pageSize=100", controller.signal)
      .then((result) => setDepartments(result.items))
      .catch(() => setDepartments([]));
    return () => controller.abort();
  }, [canViewDepartments]);

  useEffect(() => {
    if (!canViewUsers) return;
    const controller = new AbortController();
    api
      .get<Paginated<StaffMember>>("/api/users?pageSize=100", controller.signal)
      .then((result) => setStaff(result.items))
      .catch(() => setStaff([]));
    return () => controller.abort();
  }, [canViewUsers]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/doctors/${pendingDelete.id}`);
      toast.success(`${pendingDelete.displayName} removed.`);
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Could not delete the doctor.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 px-5 py-3.5">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <label htmlFor="doctor-search" className="sr-only">
              Search doctors
            </label>
            <input
              id="doctor-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or specialization"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm placeholder:text-ink-400 hover:border-ink-300 focus:border-gold-500"
            />
          </div>

          <div>
            <label htmlFor="doctor-status" className="sr-only">
              Filter by status
            </label>
            <select
              id="doctor-status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
              className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {data ? (
              <p className="text-xs text-ink-500">
                {data.total} {data.total === 1 ? "doctor" : "doctors"}
              </p>
            ) : null}
            {canCreate ? (
              <Button size="sm" onClick={() => setEditing("new")}>
                Add doctor
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
            title="No doctors yet"
            description={
              debouncedSearch || statusFilter
                ? "Try adjusting your search or filter."
                : "Add the practitioners patients can book with."
            }
            action={
              canCreate && !debouncedSearch && !statusFilter ? (
                <Button size="sm" onClick={() => setEditing("new")}>
                  Add doctor
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Doctor</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Departments</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Availability</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">Fee</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((doctor) => (
                  <tr key={doctor.id} className="hover:bg-ink-50/60">
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">
                        {doctor.displayName}
                      </p>
                      {doctor.specialization ? (
                        <p className="text-xs text-ink-500">
                          {doctor.specialization}
                        </p>
                      ) : null}
                      {doctor.linkedAccount ? (
                        <p className="mt-0.5 text-xs text-ink-400">
                          {doctor.linkedAccount.email}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3">
                      {doctor.departments.length === 0 ? (
                        <span className="text-xs text-ink-400">None</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {doctor.departments.map((department) => (
                            <Badge key={department.id}>
                              <span className="normal-case">
                                {department.name}
                              </span>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-600">
                      {doctor.availability.length === 0 ? (
                        <span className="text-ink-400">Not set</span>
                      ) : (
                        <span>
                          {doctor.availability.length}{" "}
                          {doctor.availability.length === 1 ? "window" : "windows"}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-ink-900">
                      {doctor.consultationFeeFormatted}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={doctor.status} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        {canUpdate ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditing(doctor)}
                          >
                            Edit
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-700 hover:bg-red-50"
                            onClick={() => setPendingDelete(doctor)}
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
        <DoctorEditor
          doctor={editing === "new" ? null : editing}
          departments={departments}
          staff={staff}
          currency={currency}
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
        title="Delete this doctor?"
        description={
          pendingDelete
            ? `${pendingDelete.displayName} will be removed permanently. Doctors with appointment history cannot be deleted — deactivate them instead.`
            : ""
        }
        confirmLabel="Delete doctor"
        tone="danger"
        loading={deleting}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function DoctorEditor({
  doctor,
  departments,
  staff,
  currency,
  onClose,
  onSaved,
}: {
  doctor: Doctor | null;
  departments: Department[];
  staff: StaffMember[];
  currency: Currency;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const editing = doctor !== null;

  const [displayName, setDisplayName] = useState(doctor?.displayName ?? "");
  const [specialization, setSpecialization] = useState(
    doctor?.specialization ?? "",
  );
  const [userId, setUserId] = useState(doctor?.userId ?? "");
  const [selectedDepartments, setSelectedDepartments] = useState<Set<string>>(
    new Set(doctor?.departments.map((department) => department.id) ?? []),
  );
  const [fee, setFee] = useState(
    doctor ? doctor.consultationFee.toFixed(currency.decimals) : "0",
  );
  const [availability, setAvailability] = useState<AvailabilityWindow[]>(
    doctor?.availability ?? [],
  );
  const [status, setStatus] = useState(doctor?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function toggleDepartment(id: string) {
    setSelectedDepartments((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setFieldErrors({});

    const payload = {
      displayName,
      specialization,
      userId: userId || null,
      departmentIds: [...selectedDepartments],
      consultationFee: Number(fee) || 0,
      availability,
      status,
    };

    try {
      if (editing && doctor) {
        await api.patch(`/api/doctors/${doctor.id}`, payload);
        toast.success(`${displayName} updated.`);
      } else {
        await api.post("/api/doctors", payload);
        toast.success(`${displayName} added.`);
      }
      await onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        if (Object.keys(err.fields).length === 0) toast.error(err.message);
      } else {
        toast.error("Could not save the doctor.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit ${doctor.displayName}` : "Add a doctor"}
      description="Availability windows limit when this doctor can be booked."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!displayName.trim()}
          >
            {editing ? "Save changes" : "Add doctor"}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        <TextField
          label="Display name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={fieldErrors.displayName}
          placeholder="Dr. Jane Okafor"
          required
        />

        <ComboField
          label="Specialisation"
          value={specialization}
          onValueChange={setSpecialization}
          error={fieldErrors.specialization}
          placeholder="e.g. Cardiologist"
          suggestions={SPECIALISATION_SUGGESTIONS}
        />

        <SelectField
          label="Linked staff account"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          error={fieldErrors.userId}
          options={[
            { value: "", label: "No linked account" },
            ...staff.map((member) => ({
              value: member.id,
              label: `${member.name} (${member.email})`,
            })),
          ]}
          hint="Optional. Link a login so this doctor can sign in."
        />

        <div>
          <p className="mb-2 text-sm font-medium text-ink-800">Departments</p>
          {departments.length === 0 ? (
            <p className="text-xs text-ink-500">
              No departments available to assign.
            </p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {departments.map((department) => (
                <label
                  key={department.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedDepartments.has(department.id)}
                    onChange={() => toggleDepartment(department.id)}
                    className="h-4 w-4 rounded border-ink-300 accent-gold-500"
                  />
                  {department.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={`Consultation fee (${currency.code})`}
            type="number"
            min={0}
            step={currency.decimals === 0 ? 1 : 10 ** -currency.decimals}
            value={fee}
            onChange={(event) => setFee(event.target.value)}
            error={fieldErrors.consultationFee}
          />
          <SelectField
            label="Status"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as "active" | "inactive")
            }
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            hint="Inactive doctors cannot be booked."
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ink-800">
              Weekly availability
            </p>
            <button
              type="button"
              onClick={() =>
                setAvailability((windows) => [
                  ...windows,
                  { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
                ])
              }
              className="text-xs font-medium text-gold-700 hover:text-gold-800"
            >
              Add window
            </button>
          </div>

          {availability.length === 0 ? (
            <p className="text-xs text-ink-500">
              No windows set — this doctor can be booked at any time. Add windows
              to restrict bookings to their working hours.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {availability.map((window, index) => (
                <div key={index} className="flex items-center gap-2">
                  <select
                    aria-label={`Window ${index + 1} day`}
                    value={window.dayOfWeek}
                    onChange={(event) =>
                      setAvailability((windows) =>
                        windows.map((w, i) =>
                          i === index
                            ? { ...w, dayOfWeek: Number(event.target.value) }
                            : w,
                        ),
                      )
                    }
                    className="h-9 flex-1 rounded-lg border border-ink-200 px-2 text-sm hover:border-ink-300 focus:border-gold-500"
                  >
                    {WEEKDAY_NAMES.map((name, dayIndex) => (
                      <option key={name} value={dayIndex}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    aria-label={`Window ${index + 1} start time`}
                    value={window.startTime}
                    onChange={(event) =>
                      setAvailability((windows) =>
                        windows.map((w, i) =>
                          i === index ? { ...w, startTime: event.target.value } : w,
                        ),
                      )
                    }
                    className="h-9 rounded-lg border border-ink-200 px-2 text-sm hover:border-ink-300 focus:border-gold-500"
                  />
                  <input
                    type="time"
                    aria-label={`Window ${index + 1} end time`}
                    value={window.endTime}
                    onChange={(event) =>
                      setAvailability((windows) =>
                        windows.map((w, i) =>
                          i === index ? { ...w, endTime: event.target.value } : w,
                        ),
                      )
                    }
                    className="h-9 rounded-lg border border-ink-200 px-2 text-sm hover:border-ink-300 focus:border-gold-500"
                  />
                  <button
                    type="button"
                    aria-label={`Remove window ${index + 1}`}
                    onClick={() =>
                      setAvailability((windows) =>
                        windows.filter((_, i) => i !== index),
                      )
                    }
                    className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M6 6l12 12M18 6 6 18"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
