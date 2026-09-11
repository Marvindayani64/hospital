"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { ComboField, SelectField, TextField } from "@/components/ui/Field";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import { useInitialSearch } from "@/lib/client/use-initial-search";
import {
  DEPARTMENT_SUGGESTIONS,
  SPECIALISATION_SUGGESTIONS,
} from "@/lib/domain/suggestions";
import { cn } from "@/utils/cn";
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

const PAGE_SIZE = 20;

export function DoctorsManager({
  currency,
  canCreate,
  canUpdate,
  canDelete,
  canViewDepartments,
}: {
  currency: Currency;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canViewDepartments: boolean;
}) {
  const toast = useToast();

  const [data, setData] = useState<Paginated<Doctor> | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Seeded from `?search=`, so arriving from the header omnibox lands on a
  // filtered list rather than page one of everything.
  const initialSearch = useInitialSearch();
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
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
                        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-600">
                          <span className="inline-flex items-center rounded bg-gold-50 px-1.5 py-0.2 text-[10px] font-semibold text-gold-800 border border-gold-200/80">
                            Staff
                          </span>
                          <span>{doctor.linkedAccount.email}</span>
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
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
          onDepartmentCreated={(newDept) => {
            setDepartments((prev) => {
              if (prev.some((d) => d.id === newDept.id)) return prev;
              return [...prev, newDept];
            });
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

const POPULAR_DEPARTMENTS: readonly string[] = [
  "General Medicine",
  "Cardiology",
  "Paediatrics",
  "Emergency",
  "Orthopaedics",
  "Dermatology",
  "Neurology",
  "General Surgery",
  "Dentistry",
  "ENT (Otolaryngology)",
];

function DoctorEditor({
  doctor,
  departments,
  currency,
  onClose,
  onSaved,
  onDepartmentCreated,
}: {
  doctor: Doctor | null;
  departments: Department[];
  currency: Currency;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onDepartmentCreated?: (department: Department) => void;
}) {
  const toast = useToast();
  const editing = doctor !== null;

  const [displayName, setDisplayName] = useState(doctor?.displayName ?? "");
  const [specialization, setSpecialization] = useState(
    doctor?.specialization ?? "",
  );
  const [deptList, setDeptList] = useState<Department[]>(departments);
  const [newDeptInput, setNewDeptInput] = useState("");
  const [creatingDept, setCreatingDept] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const deptInputRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    setDeptList(departments);
  }, [departments]);

  useEffect(() => {
    if (!suggestionsOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        deptInputRef.current &&
        !deptInputRef.current.contains(e.target as Node)
      ) {
        setSuggestionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [suggestionsOpen]);

  function toggleDepartment(id: string) {
    setSelectedDepartments((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAddDepartment(nameToAdd?: string) {
    const rawName = (nameToAdd ?? newDeptInput).trim();
    if (!rawName) return;

    // Check if department already exists in list (case-insensitive)
    const existing = deptList.find(
      (d) => d.name.toLowerCase() === rawName.toLowerCase(),
    );

    if (existing) {
      setSelectedDepartments((current) => new Set([...current, existing.id]));
      setNewDeptInput("");
      setSuggestionsOpen(false);
      return;
    }

    setCreatingDept(true);
    try {
      const created = await api.post<Department>("/api/departments", {
        name: rawName,
        status: "active",
      });
      setDeptList((prev) => [...prev, created]);
      onDepartmentCreated?.(created);
      setSelectedDepartments((current) => new Set([...current, created.id]));
      setNewDeptInput("");
      setSuggestionsOpen(false);
      toast.success(`Department "${created.name}" created.`);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : "Could not create department.",
      );
    } finally {
      setCreatingDept(false);
    }
  }

  const query = newDeptInput.trim().toLowerCase();
  const allAvailableNames = Array.from(
    new Set([
      ...deptList.map((d) => d.name),
      ...DEPARTMENT_SUGGESTIONS,
    ]),
  );
  const matchingSuggestions = query
    ? allAvailableNames
        .filter((name) => name.toLowerCase().includes(query))
        .slice(0, 8)
    : [];

  function clearError(field: string) {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      errors.displayName = "Display name is required.";
    } else if (trimmedName.length < 2) {
      errors.displayName = "Doctor name must be at least 2 characters.";
    } else if (trimmedName.length > 150) {
      errors.displayName = "Doctor name cannot exceed 150 characters.";
    }

    const trimmedSpec = specialization.trim();
    if (!trimmedSpec) {
      errors.specialization = "Specialisation is required.";
    } else if (trimmedSpec.length > 150) {
      errors.specialization = "Specialisation cannot exceed 150 characters.";
    }

    if (selectedDepartments.size === 0) {
      errors.departments = "Please select at least one department.";
    }

    const feeStr = String(fee).trim();
    if (feeStr === "") {
      errors.consultationFee = "Consultation fee is required.";
    } else {
      const numFee = Number(feeStr);
      if (isNaN(numFee)) {
        errors.consultationFee = "Consultation fee must be a valid number.";
      } else if (numFee < 0) {
        errors.consultationFee = "Consultation fee cannot be negative.";
      } else if (numFee > 100_000_000) {
        errors.consultationFee = "Consultation fee cannot exceed 100,000,000.";
      }
    }

    if (!status) {
      errors.status = "Status is required.";
    }

    for (const w of availability) {
      if (w.startTime >= w.endTime) {
        errors.availability = "End time must be after start time for all availability windows.";
        break;
      }
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Please fill in all required fields correctly.");
      return false;
    }
    return true;
  }

  async function save() {
    if (!validate()) return;

    setSaving(true);
    setFieldErrors({});

    /**
     * `userId` is deliberately absent.
     *
     * A doctor profile is attached to a staff account from the Staff screen,
     * where the account is created. Sending it from here — even as null —
     * would UNLINK an existing doctor on every edit, because the update only
     * leaves the link alone when the field is omitted entirely.
     */
    const payload = {
      displayName: displayName.trim(),
      specialization: specialization.trim(),
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
            disabled={saving}
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
          onChange={(event) => {
            setDisplayName(event.target.value);
            clearError("displayName");
          }}
          error={fieldErrors.displayName}
          placeholder="Dr. Jane Okafor"
          required
        />

        <ComboField
          label="Specialisation"
          value={specialization}
          onValueChange={(val) => {
            setSpecialization(val);
            clearError("specialization");
          }}
          error={fieldErrors.specialization}
          placeholder="e.g. Cardiologist"
          required
          suggestions={SPECIALISATION_SUGGESTIONS}
        />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-ink-800">
              Departments
              <span className="ml-0.5 text-red-600" aria-hidden="true">
                *
              </span>
            </label>
            {selectedDepartments.size > 0 ? (
              <span className="text-xs font-semibold text-gold-700">
                {selectedDepartments.size} selected
              </span>
            ) : null}
          </div>

          {/* Quick add / search input with suggestions */}
          <div ref={deptInputRef} className="relative mb-2.5">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={newDeptInput}
                  onChange={(e) => {
                    setNewDeptInput(e.target.value);
                    setSuggestionsOpen(true);
                  }}
                  onFocus={() => setSuggestionsOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddDepartment();
                    } else if (e.key === "Escape") {
                      setSuggestionsOpen(false);
                    }
                  }}
                  placeholder="Add or search department (e.g. Cardiology)..."
                  className={cn(
                    "h-9 w-full rounded-lg border bg-white px-3 text-sm placeholder:text-ink-400 focus:outline-none",
                    fieldErrors.departments || fieldErrors.departmentIds
                      ? "border-red-400 focus:border-red-500"
                      : "border-ink-200 hover:border-ink-300 focus:border-gold-500",
                  )}
                />

                {suggestionsOpen && matchingSuggestions.length > 0 ? (
                  <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-ink-200 bg-white py-1 shadow-lg">
                    {matchingSuggestions.map((suggestion) => {
                      const isExisting = deptList.some(
                        (d) =>
                          d.name.toLowerCase() === suggestion.toLowerCase(),
                      );
                      const isAlreadySelected = deptList.some(
                        (d) =>
                          d.name.toLowerCase() === suggestion.toLowerCase() &&
                          selectedDepartments.has(d.id),
                      );
                      return (
                        <li key={suggestion}>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              void handleAddDepartment(suggestion);
                            }}
                            className={cn(
                              "flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors",
                              isAlreadySelected
                                ? "bg-gold-50/70 text-gold-900 font-medium"
                                : "text-ink-700 hover:bg-gold-50 hover:text-gold-900",
                            )}
                          >
                            <span>{suggestion}</span>
                            <span className="text-[11px] text-ink-400">
                              {isAlreadySelected
                                ? "selected"
                                : isExisting
                                  ? "select"
                                  : "+ add new"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>

              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!newDeptInput.trim() || creatingDept}
                loading={creatingDept}
                onClick={() => void handleAddDepartment()}
              >
                Add
              </Button>
            </div>
          </div>

          {/* Department List in Highlights */}
          {deptList.length === 0 ? (
            <div
              className={cn(
                "rounded-lg border border-dashed p-3",
                fieldErrors.departments || fieldErrors.departmentIds
                  ? "border-red-300 bg-red-50/30"
                  : "border-ink-200 bg-ink-50/50",
              )}
            >
              <p className="mb-2 text-xs font-medium text-ink-600">
                Quick-add popular departments:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {POPULAR_DEPARTMENTS.map((deptName) => (
                  <button
                    key={deptName}
                    type="button"
                    disabled={creatingDept}
                    onClick={() => {
                      void handleAddDepartment(deptName);
                      clearError("departments");
                      clearError("departmentIds");
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-xs font-medium text-ink-700 hover:border-gold-400 hover:bg-gold-50 hover:text-gold-900 transition-colors shadow-2xs"
                  >
                    <span className="text-gold-600 font-bold">+</span>
                    <span>{deptName}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div
                className={cn(
                  "flex flex-wrap gap-1.5 max-h-40 overflow-y-auto rounded-lg border p-2",
                  fieldErrors.departments || fieldErrors.departmentIds
                    ? "border-red-300 bg-red-50/30"
                    : "border-ink-200 bg-ink-50/40",
                )}
              >
                {deptList.map((department) => {
                  const isSelected = selectedDepartments.has(department.id);
                  return (
                    <button
                      key={department.id}
                      type="button"
                      onClick={() => {
                        toggleDepartment(department.id);
                        clearError("departments");
                        clearError("departmentIds");
                      }}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-all cursor-pointer",
                        isSelected
                          ? "border border-gold-400 bg-gold-100 text-gold-950 font-semibold shadow-xs"
                          : "border border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:bg-ink-50",
                      )}
                    >
                      {isSelected ? (
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-gold-700 shrink-0"
                        >
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      ) : (
                        <span className="text-ink-400 font-bold text-xs shrink-0">+</span>
                      )}
                      <span>{department.name}</span>
                      {isSelected ? (
                        <span className="text-gold-600 hover:text-gold-950 ml-0.5 text-xs font-bold leading-none">
                          &times;
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-ink-500">
                Click a department to toggle. Highlighted items are assigned to this doctor.
              </p>
            </div>
          )}

          {fieldErrors.departments || fieldErrors.departmentIds ? (
            <p role="alert" className="mt-1 text-xs font-medium text-red-600">
              {fieldErrors.departments || fieldErrors.departmentIds}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={`Consultation fee (${currency.code})`}
            type="number"
            min={0}
            step={currency.decimals === 0 ? 1 : 10 ** -currency.decimals}
            value={fee}
            onChange={(event) => {
              setFee(event.target.value);
              clearError("consultationFee");
            }}
            error={fieldErrors.consultationFee}
            required
          />
          <SelectField
            label="Status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as "active" | "inactive");
              clearError("status");
            }}
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            hint="Inactive doctors cannot be booked."
            required
            error={fieldErrors.status}
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ink-800">
              Weekly availability
            </p>
            <button
              type="button"
              onClick={() => {
                setAvailability((windows) => [
                  ...windows,
                  { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
                ]);
                clearError("availability");
              }}
              className="text-xs font-medium text-gold-700 hover:text-gold-800"
            >
              Add window
            </button>
          </div>

          {fieldErrors.availability ? (
            <p role="alert" className="mb-2 text-xs font-medium text-red-600">
              {fieldErrors.availability}
            </p>
          ) : null}

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
