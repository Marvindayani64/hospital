"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import type { Permission, PermissionGroup } from "@/lib/rbac/permissions";
import type { Paginated } from "@/types";
import { cn } from "@/utils/cn";

type Role = {
  id: string;
  name: string;
  description: string;
  key: string | null;
  isSystem: boolean;
  permissions: Permission[];
  memberCount: number;
  createdAt: string;
};

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; role: Role }
  | null;

export function RolesManager({
  groups,
  canCreate,
  canUpdate,
  canDelete,
}: {
  groups: PermissionGroup[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const toast = useToast();

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [pendingDelete, setPendingDelete] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<Paginated<Role>>(
        "/api/roles?pageSize=100",
        signal,
      );
      setRoles(result.items);
    } catch (err) {
      if (signal?.aborted) return;
      setError(
        err instanceof ApiClientError ? err.message : "Could not load roles.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/roles/${pendingDelete.id}`);
      toast.success(`Role "${pendingDelete.name}" deleted.`);
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : "Could not delete the role.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-5 py-3.5">
          <p className="text-sm text-ink-500">
            {roles ? `${roles.length} ${roles.length === 1 ? "role" : "roles"}` : " "}
          </p>
          {canCreate ? (
            <Button size="sm" onClick={() => setEditor({ mode: "create" })}>
              New role
            </Button>
          ) : null}
        </div>

        {loading && !roles ? (
          <TableSkeleton rows={5} columns={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !roles || roles.length === 0 ? (
          <EmptyState
            title="No roles yet"
            description="Create a role to define what a group of staff can do."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {roles.map((role) => (
              <li key={role.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink-900">{role.name}</p>
                      {role.isSystem ? (
                        <Badge tone="gold">
                          <span className="normal-case">Default</span>
                        </Badge>
                      ) : null}
                      <span className="text-xs text-ink-500">
                        {role.memberCount}{" "}
                        {role.memberCount === 1 ? "member" : "members"}
                      </span>
                    </div>
                    {role.description ? (
                      <p className="mt-0.5 max-w-2xl text-sm text-ink-500">
                        {role.description}
                      </p>
                    ) : null}
                    <p className="mt-1.5 text-xs text-ink-500">
                      {role.permissions.length} of{" "}
                      {groups.reduce((n, g) => n + g.permissions.length, 0)}{" "}
                      permissions granted
                    </p>
                  </div>

                  <div className="flex gap-1.5">
                    {canUpdate ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditor({ mode: "edit", role })}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {canDelete && !role.isSystem ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-700 hover:bg-red-50"
                        onClick={() => setPendingDelete(role)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editor ? (
        <RoleEditor
          groups={groups}
          state={editor}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await load();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete this role?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" will be removed permanently. Roles that still have members assigned cannot be deleted.`
            : ""
        }
        confirmLabel="Delete role"
        tone="danger"
        loading={deleting}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function RoleEditor({
  groups,
  state,
  onClose,
  onSaved,
}: {
  groups: PermissionGroup[];
  state: NonNullable<EditorState>;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const editing = state.mode === "edit";
  const role = editing ? state.role : null;

  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<Set<Permission>>(
    new Set(role?.permissions ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function toggle(permission: Permission) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  function toggleGroup(group: PermissionGroup) {
    const allSelected = group.permissions.every((p) => selected.has(p));
    setSelected((current) => {
      const next = new Set(current);
      for (const permission of group.permissions) {
        if (allSelected) next.delete(permission);
        else next.add(permission);
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setFieldErrors({});

    const payload = {
      name,
      description,
      permissions: [...selected],
    };

    try {
      if (editing && role) {
        await api.patch(`/api/roles/${role.id}`, payload);
        toast.success(`Role "${name}" updated.`);
      } else {
        await api.post("/api/roles", payload);
        toast.success(`Role "${name}" created.`);
      }
      await onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        if (Object.keys(err.fields).length === 0) toast.error(err.message);
      } else {
        toast.error("Could not save the role.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit "${role?.name}"` : "New role"}
      description={
        editing && role?.isSystem
          ? "This is a default role. You can rename it and change its permissions, but it cannot be deleted."
          : "Choose the actions members with this role may perform."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!name.trim()}>
            {editing ? "Save changes" : "Create role"}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        <TextField
          label="Role name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={fieldErrors.name}
          placeholder="e.g. Senior Receptionist"
          required
        />

        <TextAreaField
          label="Description"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={fieldErrors.description}
          placeholder="What this role is for."
        />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ink-800">Permissions</p>
            <p className="text-xs text-ink-500">{selected.size} selected</p>
          </div>

          {fieldErrors.permissions ? (
            <p role="alert" className="mb-2 text-xs font-medium text-red-600">
              {fieldErrors.permissions}
            </p>
          ) : null}

          <div className="flex flex-col gap-3">
            {groups.map((group) => {
              const allSelected = group.permissions.every((p) =>
                selected.has(p),
              );
              const someSelected =
                !allSelected && group.permissions.some((p) => selected.has(p));

              return (
                <fieldset
                  key={group.resource}
                  className="rounded-lg border border-ink-200 px-3.5 py-3"
                >
                  <legend className="flex items-center gap-2 px-1">
                    <span className="text-sm font-medium text-ink-800">
                      {group.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group)}
                      className="text-xs font-medium text-gold-700 hover:text-gold-800"
                    >
                      {allSelected ? "Clear all" : "Select all"}
                    </button>
                    {someSelected ? (
                      <span className="text-xs text-ink-400">partial</span>
                    ) : null}
                  </legend>

                  <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                    {group.permissions.map((permission) => {
                      const checked = selected.has(permission);
                      // "patient.create" -> "create"
                      const action = permission.split(".").slice(1).join(".");

                      return (
                        <label
                          key={permission}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                            checked
                              ? "bg-gold-50 text-gold-900"
                              : "text-ink-600 hover:bg-ink-50",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(permission)}
                            className="h-4 w-4 shrink-0 rounded border-ink-300 accent-gold-500"
                          />
                          <span className="truncate">{action}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
