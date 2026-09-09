"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import {
  ComboField,
  SelectField,
  TextAreaField,
} from "@/components/ui/Field";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import { DEPARTMENT_SUGGESTIONS } from "@/lib/domain/suggestions";
import type { Paginated } from "@/types";

type Department = {
  id: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  treatmentCount: number;
  createdAt: string;
};

const PAGE_SIZE = 20;

export function DepartmentsManager({
  canCreate,
  canUpdate,
  canDelete,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const toast = useToast();

  const [data, setData] = useState<Paginated<Department> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<Department | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Department | null>(null);
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
          await api.get<Paginated<Department>>(
            `/api/departments?${params}`,
            signal,
          ),
        );
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load departments.",
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

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/departments/${pendingDelete.id}`);
      toast.success(`"${pendingDelete.name}" deleted.`);
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Could not delete the department.",
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
            <label htmlFor="dept-search" className="sr-only">
              Search departments
            </label>
            <input
              id="dept-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search departments"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm placeholder:text-ink-400 hover:border-ink-300 focus:border-gold-500"
            />
          </div>

          <div>
            <label htmlFor="dept-status" className="sr-only">
              Filter by status
            </label>
            <select
              id="dept-status"
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
                {data.total} {data.total === 1 ? "department" : "departments"}
              </p>
            ) : null}
            {canCreate ? (
              <Button size="sm" onClick={() => setEditing("new")}>
                New department
              </Button>
            ) : null}
          </div>
        </div>

        {loading && !data ? (
          <TableSkeleton rows={5} columns={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No departments yet"
            description={
              debouncedSearch || statusFilter
                ? "Try adjusting your search or filter."
                : "Create a department such as Dental, Dermatology or General Practice — whatever this hospital offers."
            }
            action={
              canCreate && !debouncedSearch && !statusFilter ? (
                <Button size="sm" onClick={() => setEditing("new")}>
                  New department
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Department</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Treatments</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((department) => (
                  <tr key={department.id} className="hover:bg-ink-50/60">
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">{department.name}</p>
                      {department.description ? (
                        <p className="max-w-md text-xs text-ink-500">
                          {department.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-ink-600">
                      {department.treatmentCount}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={department.status} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        {canUpdate ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditing(department)}
                          >
                            Edit
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-700 hover:bg-red-50"
                            onClick={() => setPendingDelete(department)}
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
        <DepartmentEditor
          department={editing === "new" ? null : editing}
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
        title="Delete this department?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" will be removed permanently. Departments that still have treatments cannot be deleted — deactivate it instead if you want to keep the records.`
            : ""
        }
        confirmLabel="Delete department"
        tone="danger"
        loading={deleting}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function DepartmentEditor({
  department,
  onClose,
  onSaved,
}: {
  department: Department | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const editing = department !== null;

  const [name, setName] = useState(department?.name ?? "");
  const [description, setDescription] = useState(department?.description ?? "");
  const [status, setStatus] = useState(department?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function save() {
    setSaving(true);
    setFieldErrors({});

    const payload = { name, description, status };

    try {
      if (editing && department) {
        await api.patch(`/api/departments/${department.id}`, payload);
        toast.success(`"${name}" updated.`);
      } else {
        await api.post("/api/departments", payload);
        toast.success(`"${name}" created.`);
      }
      await onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        if (Object.keys(err.fields).length === 0) toast.error(err.message);
      } else {
        toast.error("Could not save the department.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit "${department?.name}"` : "New department"}
      description="Departments group the treatments this hospital offers."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!name.trim()}
          >
            {editing ? "Save changes" : "Create department"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ComboField
          label="Department name"
          value={name}
          onValueChange={setName}
          error={fieldErrors.name}
          placeholder="e.g. Dermatology"
          // Suggestions only — any name this hospital uses is still accepted.
          suggestions={DEPARTMENT_SUGGESTIONS}
          hint="Start typing for suggestions, or enter your own."
          required
        />

        <TextAreaField
          label="Description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={fieldErrors.description}
          placeholder="What this department covers."
        />

        <SelectField
          label="Status"
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as "active" | "inactive")
          }
          error={fieldErrors.status}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
          hint="Inactive departments stay on record but are hidden from new bookings."
        />
      </div>
    </Modal>
  );
}
