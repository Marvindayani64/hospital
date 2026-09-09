"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import type { Paginated } from "@/types";

type FormSummary = {
  id: string;
  name: string;
  description: string;
  category: string;
  status: "draft" | "published" | "archived";
  currentVersion: number;
  fieldCount: number;
  responseCount: number;
  createdAt: string;
  updatedAt: string;
};

const STATUS_TONES: Record<
  FormSummary["status"],
  "neutral" | "success" | "warning" | "gold"
> = {
  draft: "neutral",
  published: "success",
  archived: "warning",
};

const PAGE_SIZE = 20;

export function FormsManager({
  canCreate,
  canUpdate,
  canDelete,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const toast = useToast();
  const router = useRouter();

  const [data, setData] = useState<Paginated<FormSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FormSummary | null>(null);
  const [working, setWorking] = useState(false);

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
          await api.get<Paginated<FormSummary>>(`/api/forms?${params}`, signal),
        );
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError ? err.message : "Could not load forms.",
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
    setWorking(true);
    try {
      await api.del(`/api/forms/${pendingDelete.id}`);
      toast.success(`"${pendingDelete.name}" deleted.`);
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : "Could not delete the form.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 px-5 py-3.5">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <label htmlFor="form-search" className="sr-only">
              Search forms
            </label>
            <input
              id="form-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search forms"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm placeholder:text-ink-400 hover:border-ink-300 focus:border-gold-500"
            />
          </div>

          <div>
            <label htmlFor="form-status" className="sr-only">
              Filter by status
            </label>
            <select
              id="form-status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
              className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {data ? (
              <p className="text-xs text-ink-500">
                {data.total} {data.total === 1 ? "form" : "forms"}
              </p>
            ) : null}
            {canCreate ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                New form
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
            title="No forms yet"
            description={
              debouncedSearch || statusFilter
                ? "Try adjusting your search or filter."
                : "Build an intake questionnaire, consent form or clinical assessment — whatever this hospital needs."
            }
            action={
              canCreate && !debouncedSearch && !statusFilter ? (
                <Button size="sm" onClick={() => setCreating(true)}>
                  New form
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Form</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Version</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Fields</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Responses</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((form) => (
                  <tr key={form.id} className="hover:bg-ink-50/60">
                    <td className="px-5 py-3">
                      <Link
                        href={`/forms/${form.id}`}
                        className="font-medium text-ink-900 hover:text-gold-700"
                      >
                        {form.name}
                      </Link>
                      {form.category ? (
                        <p className="text-xs text-ink-500">{form.category}</p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONES[form.status]}>
                        <span className="normal-case">{form.status}</span>
                      </Badge>
                    </td>
                    <td className="px-5 py-3 tabular-nums text-ink-600">
                      v{form.currentVersion}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-ink-600">
                      {form.fieldCount}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-ink-600">
                      {form.responseCount}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Link href={`/forms/${form.id}`}>
                          <Button size="sm" variant="secondary">
                            {canUpdate ? "Open builder" : "View"}
                          </Button>
                        </Link>
                        {canDelete ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-700 hover:bg-red-50"
                            onClick={() => setPendingDelete(form)}
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

      {creating ? (
        <CreateFormModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            // Straight into the builder — a form with no fields is not useful.
            router.push(`/forms/${id}`);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete this form?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" and its field definitions will be removed permanently. Forms with submitted responses cannot be deleted — archive them instead.`
            : ""
        }
        confirmLabel="Delete form"
        tone="danger"
        loading={working}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function CreateFormModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function save() {
    setSaving(true);
    setFieldErrors({});
    try {
      const form = await api.post<{ id: string }>("/api/forms", {
        name,
        description,
        category,
      });
      toast.success(`"${name}" created. Add its fields next.`);
      onCreated(form.id);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        if (Object.keys(err.fields).length === 0) toast.error(err.message);
      } else {
        toast.error("Could not create the form.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New form"
      description="Give it a name — you will add the questions next."
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
            Create form
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Form name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={fieldErrors.name}
          placeholder="e.g. Hair Assessment"
          required
        />
        <TextField
          label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          error={fieldErrors.category}
          placeholder="e.g. intake, consent, assessment"
          hint="Optional. Used to group forms."
        />
        <TextAreaField
          label="Description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={fieldErrors.description}
        />
      </div>
    </Modal>
  );
}
