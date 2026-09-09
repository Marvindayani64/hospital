"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import type { Currency } from "@/utils/money";
import type { Paginated } from "@/types";

type Treatment = {
  id: string;
  name: string;
  description: string;
  department: { id: string; name: string } | null;
  price: number;
  priceMinor: number;
  currency: string;
  priceFormatted: string;
  durationMinutes: number;
  status: "active" | "inactive";
  metadata: Record<string, unknown>;
  createdAt: string;
};

type Department = { id: string; name: string; status: string };

const PAGE_SIZE = 20;

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function TreatmentsManager({
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

  const [data, setData] = useState<Paginated<Treatment> | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<Treatment | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Treatment | null>(null);
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
      if (departmentFilter) params.set("departmentId", departmentFilter);

      try {
        setData(
          await api.get<Paginated<Treatment>>(
            `/api/treatments?${params}`,
            signal,
          ),
        );
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load treatments.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, debouncedSearch, statusFilter, departmentFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Needed for the department filter and the create/edit form.
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
      await api.del(`/api/treatments/${pendingDelete.id}`);
      toast.success(`"${pendingDelete.name}" deleted.`);
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Could not delete the treatment.",
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
            <label htmlFor="treatment-search" className="sr-only">
              Search treatments
            </label>
            <input
              id="treatment-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search treatments"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm placeholder:text-ink-400 hover:border-ink-300 focus:border-gold-500"
            />
          </div>

          {departments.length > 0 ? (
            <div>
              <label htmlFor="treatment-dept" className="sr-only">
                Filter by department
              </label>
              <select
                id="treatment-dept"
                value={departmentFilter}
                onChange={(event) => {
                  setDepartmentFilter(event.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
              >
                <option value="">All departments</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label htmlFor="treatment-status" className="sr-only">
              Filter by status
            </label>
            <select
              id="treatment-status"
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
                {data.total} {data.total === 1 ? "treatment" : "treatments"}
              </p>
            ) : null}
            {canCreate ? (
              <Button
                size="sm"
                onClick={() => setEditing("new")}
                disabled={departments.length === 0}
                title={
                  departments.length === 0
                    ? "Create a department first"
                    : undefined
                }
              >
                New treatment
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
            title="No treatments yet"
            description={
              debouncedSearch || statusFilter || departmentFilter
                ? "Try adjusting your search or filters."
                : departments.length === 0
                  ? "Create a department first — every treatment belongs to one."
                  : "Add the services this hospital offers, each with its own price."
            }
            action={
              canCreate &&
              departments.length > 0 &&
              !debouncedSearch &&
              !statusFilter &&
              !departmentFilter ? (
                <Button size="sm" onClick={() => setEditing("new")}>
                  New treatment
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[50rem] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Treatment</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Department</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    Price
                  </th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Duration</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((treatment) => (
                  <tr key={treatment.id} className="hover:bg-ink-50/60">
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">{treatment.name}</p>
                      {treatment.description ? (
                        <p className="max-w-sm truncate text-xs text-ink-500">
                          {treatment.description}
                        </p>
                      ) : null}
                      {Object.keys(treatment.metadata).length > 0 ? (
                        <p className="mt-1 text-xs text-ink-400">
                          {Object.entries(treatment.metadata)
                            .map(([key, value]) => `${key}: ${String(value)}`)
                            .join(" · ")}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      {treatment.department?.name ?? (
                        <span className="text-xs text-ink-400">None</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums text-ink-900">
                      {treatment.priceFormatted}
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      {formatDuration(treatment.durationMinutes)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={treatment.status} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        {canUpdate ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditing(treatment)}
                          >
                            Edit
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-700 hover:bg-red-50"
                            onClick={() => setPendingDelete(treatment)}
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
        <TreatmentEditor
          treatment={editing === "new" ? null : editing}
          departments={departments}
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
        title="Delete this treatment?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" will be removed permanently. Deactivate it instead if you want to keep it on record.`
            : ""
        }
        confirmLabel="Delete treatment"
        tone="danger"
        loading={deleting}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

type MetadataRow = { key: string; value: string };

function TreatmentEditor({
  treatment,
  departments,
  currency,
  onClose,
  onSaved,
}: {
  treatment: Treatment | null;
  departments: Department[];
  currency: Currency;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const editing = treatment !== null;

  const [name, setName] = useState(treatment?.name ?? "");
  const [description, setDescription] = useState(treatment?.description ?? "");
  const [departmentId, setDepartmentId] = useState(
    treatment?.department?.id ?? departments[0]?.id ?? "",
  );
  // Held as a string so the field does not fight the user mid-typing.
  const [price, setPrice] = useState(
    treatment ? treatment.price.toFixed(currency.decimals) : "",
  );
  const [durationMinutes, setDurationMinutes] = useState(
    String(treatment?.durationMinutes ?? 30),
  );
  const [status, setStatus] = useState(treatment?.status ?? "active");
  const [metadata, setMetadata] = useState<MetadataRow[]>(
    treatment
      ? Object.entries(treatment.metadata).map(([key, value]) => ({
          key,
          value: String(value),
        }))
      : [],
  );
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const priceNumber = Number(price);
  const priceValid = price.trim() !== "" && Number.isFinite(priceNumber) && priceNumber >= 0;

  async function save() {
    setSaving(true);
    setFieldErrors({});

    const metadataObject: Record<string, string> = {};
    for (const row of metadata) {
      const key = row.key.trim();
      if (key) metadataObject[key] = row.value;
    }

    const payload = {
      departmentId,
      name,
      description,
      price: priceNumber,
      durationMinutes: Number(durationMinutes),
      status,
      metadata: metadataObject,
    };

    try {
      if (editing && treatment) {
        await api.patch(`/api/treatments/${treatment.id}`, payload);
        toast.success(`"${name}" updated.`);
      } else {
        await api.post("/api/treatments", payload);
        toast.success(`"${name}" created.`);
      }
      await onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        if (Object.keys(err.fields).length === 0) toast.error(err.message);
      } else {
        toast.error("Could not save the treatment.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit "${treatment?.name}"` : "New treatment"}
      description={`Priced in ${currency.name} (${currency.code}).`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!name.trim() || !departmentId || !priceValid}
          >
            {editing ? "Save changes" : "Create treatment"}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        <TextField
          label="Treatment name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={fieldErrors.name}
          placeholder="e.g. Root Canal Treatment"
          required
        />

        <SelectField
          label="Department"
          value={departmentId}
          onChange={(event) => setDepartmentId(event.target.value)}
          error={fieldErrors.departmentId}
          options={departments.map((department) => ({
            value: department.id,
            label: department.name,
          }))}
          required
        />

        <TextAreaField
          label="Description"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={fieldErrors.description}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={`Price (${currency.code})`}
            type="number"
            inputMode="decimal"
            min={0}
            step={currency.decimals === 0 ? 1 : 10 ** -currency.decimals}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            error={fieldErrors.price}
            placeholder={currency.decimals === 0 ? "5000" : "0.00"}
            hint={`Charged in ${currency.symbol.trim() || currency.code}.`}
            required
          />

          <TextField
            label="Duration (minutes)"
            type="number"
            min={1}
            max={1440}
            step={5}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
            error={fieldErrors.durationMinutes}
            hint="Used for appointment slots."
            required
          />
        </div>

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
        />

        {/* Free-form attributes: what makes one hospital's catalogue differ
            from another's without any code change. */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ink-800">
              Custom attributes
            </p>
            <button
              type="button"
              onClick={() =>
                setMetadata((rows) => [...rows, { key: "", value: "" }])
              }
              className="text-xs font-medium text-gold-700 hover:text-gold-800"
            >
              Add attribute
            </button>
          </div>

          {metadata.length === 0 ? (
            <p className="text-xs text-ink-500">
              Optional. Record anything specific to how your hospital works —
              sessions included, equipment required, aftercare notes.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {metadata.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    aria-label={`Attribute ${index + 1} name`}
                    value={row.key}
                    onChange={(event) =>
                      setMetadata((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, key: event.target.value } : r,
                        ),
                      )
                    }
                    placeholder="Name"
                    className="h-9 w-2/5 rounded-lg border border-ink-200 px-2.5 text-sm hover:border-ink-300 focus:border-gold-500"
                  />
                  <input
                    aria-label={`Attribute ${index + 1} value`}
                    value={row.value}
                    onChange={(event) =>
                      setMetadata((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, value: event.target.value } : r,
                        ),
                      )
                    }
                    placeholder="Value"
                    className="h-9 flex-1 rounded-lg border border-ink-200 px-2.5 text-sm hover:border-ink-300 focus:border-gold-500"
                  />
                  <button
                    type="button"
                    aria-label={`Remove attribute ${index + 1}`}
                    onClick={() =>
                      setMetadata((rows) => rows.filter((_, i) => i !== index))
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
