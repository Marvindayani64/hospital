"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import {
  ComboField,
  EmailField,
  SelectField,
  TextField,
} from "@/components/ui/Field";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import type { Paginated } from "@/types";

type Member = {
  id: string;
  name: string;
  email: string;
  status: "active" | "inactive";
  mustChangePassword: boolean;
  role: { id: string; name: string; isSystem: boolean } | null;
  lastLoginAt: string | null;
  activeSessions: number;
  createdAt: string;
};

/**
 * `key` is the stable machine name of a seeded role — "doctor", "receptionist"
 * and so on — and is null for a role the hospital created itself. Matching on
 * it rather than on `name` matters: an admin is free to rename "Doctor" to
 * "Consultant", and the form still needs to know it is a clinician.
 */
type Role = { id: string; name: string; isSystem: boolean; key: string | null };

/** A doctor profile with no login attached to it yet. */
type UnlinkedDoctor = { id: string; displayName: string; specialization: string };

type Confirmation =
  | { kind: "status"; member: Member; status: "active" | "inactive" }
  | { kind: "delete"; member: Member }
  | { kind: "signout"; member: Member }
  | null;

const PAGE_SIZE = 20;

export function UsersManager({
  currentUserId,
  canCreate,
  canUpdate,
  canDelete,
  canViewDoctors,
  canLinkDoctors,
}: {
  currentUserId: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canViewDoctors: boolean;
  canLinkDoctors: boolean;
}) {
  const toast = useToast();

  const [data, setData] = useState<Paginated<Member> | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [unlinkedDoctors, setUnlinkedDoctors] = useState<UnlinkedDoctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [working, setWorking] = useState(false);
  const [newCredentials, setNewCredentials] = useState<{
    name: string;
    email: string;
    temporaryPassword: string;
  } | null>(null);

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
        const result = await api.get<Paginated<Member>>(
          `/api/users?${params}`,
          signal,
        );
        setData(result);
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError ? err.message : "Could not load staff.",
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

  // Roles are needed for the assignment dropdown. Fetched once; a caller
  // without role.view simply gets an empty list and the form explains why.
  useEffect(() => {
    const controller = new AbortController();
    api
      .get<Paginated<Role>>("/api/roles?pageSize=100", controller.signal)
      .then((result) => setRoles(result.items))
      .catch(() => setRoles([]));
    return () => controller.abort();
  }, []);

  /**
   * Doctor profiles with no account attached, offered as suggestions when the
   * new member is being given the Doctor role.
   *
   * Only the UNLINKED ones: `Doctor.userId` is unique per tenant, so a profile
   * that already has a login cannot take another, and offering it would set up
   * a failure at save time.
   */
  useEffect(() => {
    if (!canViewDoctors) {
      setUnlinkedDoctors([]);
      return;
    }

    const controller = new AbortController();
    api
      .get<
        Paginated<{
          id: string;
          displayName: string;
          specialization: string;
          userId: string | null;
        }>
      >("/api/doctors?pageSize=100&status=active", controller.signal)
      .then((result) =>
        setUnlinkedDoctors(
          result.items
            .filter((doctor) => doctor.userId === null)
            .map((doctor) => ({
              id: doctor.id,
              displayName: doctor.displayName,
              specialization: doctor.specialization,
            })),
        ),
      )
      .catch(() => setUnlinkedDoctors([]));
    return () => controller.abort();
  }, [canViewDoctors]);

  async function runConfirmation() {
    if (!confirmation) return;
    setWorking(true);

    try {
      if (confirmation.kind === "status") {
        await api.put(`/api/users/${confirmation.member.id}`, {
          status: confirmation.status,
        });
        toast.success(
          `${confirmation.member.name} is now ${confirmation.status}.`,
        );
      } else if (confirmation.kind === "delete") {
        await api.del(`/api/users/${confirmation.member.id}`);
        toast.success(`${confirmation.member.name} removed.`);
      } else {
        await api.del(`/api/users/${confirmation.member.id}/sessions`);
        toast.success(`${confirmation.member.name} signed out of all devices.`);
      }
      setConfirmation(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "The action could not be completed.",
      );
    } finally {
      setWorking(false);
    }
  }

  const confirmCopy = confirmation
    ? confirmation.kind === "delete"
      ? {
          title: "Remove this member?",
          description: `${confirmation.member.name} will be deleted permanently and signed out of every device. This cannot be undone.`,
          label: "Remove member",
          danger: true,
        }
      : confirmation.kind === "signout"
        ? {
            title: "Sign out of all devices?",
            description: `${confirmation.member.name} will be signed out everywhere immediately and must log in again.`,
            label: "Sign out everywhere",
            danger: false,
          }
        : confirmation.status === "inactive"
          ? {
              title: "Deactivate this member?",
              description: `${confirmation.member.name} will be signed out immediately and cannot sign in until reactivated.`,
              label: "Deactivate",
              danger: true,
            }
          : {
              title: "Reactivate this member?",
              description: `${confirmation.member.name} will be able to sign in again. They must log in fresh — existing tokens stay invalid.`,
              label: "Reactivate",
              danger: false,
            }
    : null;

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 px-5 py-3.5">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <label htmlFor="staff-search" className="sr-only">
              Search staff
            </label>
            <input
              id="staff-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or email"
              className="h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm placeholder:text-ink-400 hover:border-ink-300 focus:border-gold-500"
            />
          </div>

          <div>
            <label htmlFor="staff-status" className="sr-only">
              Filter by status
            </label>
            <select
              id="staff-status"
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
                {data.total} {data.total === 1 ? "member" : "members"}
              </p>
            ) : null}
            {canCreate ? (
              <Button size="sm" onClick={() => setEditing("new")}>
                Add member
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
            title="No staff found"
            description={
              debouncedSearch || statusFilter
                ? "Try adjusting your search or filter."
                : "Add your first team member to get started."
            }
            action={
              canCreate && !debouncedSearch && !statusFilter ? (
                <Button size="sm" onClick={() => setEditing("new")}>
                  Add member
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[54rem] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Member</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Role</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Last sign-in</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((member) => {
                  const isSelf = member.id === currentUserId;

                  return (
                    <tr key={member.id} className="hover:bg-ink-50/60">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-ink-900">{member.name}</p>
                          {isSelf ? (
                            <Badge tone="gold">
                              <span className="normal-case">You</span>
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-ink-500">{member.email}</p>
                        {member.mustChangePassword ? (
                          <p className="mt-1 text-xs font-medium text-amber-700">
                            Password change pending
                          </p>
                        ) : null}
                      </td>

                      <td className="px-5 py-3 text-ink-600">
                        {member.role?.name ?? (
                          <span className="text-xs text-ink-400">No role</span>
                        )}
                      </td>

                      <td className="px-5 py-3">
                        <StatusBadge status={member.status} />
                        {member.activeSessions > 0 ? (
                          <p className="mt-1 text-xs text-ink-500">
                            {member.activeSessions} active{" "}
                            {member.activeSessions === 1 ? "session" : "sessions"}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-5 py-3 text-ink-600">
                        {member.lastLoginAt ? (
                          new Date(member.lastLoginAt).toLocaleString()
                        ) : (
                          <span className="text-xs text-ink-400">Never</span>
                        )}
                      </td>

                      <td className="px-5 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {canUpdate ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditing(member)}
                            >
                              Edit
                            </Button>
                          ) : null}

                          {canUpdate && member.activeSessions > 0 ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setConfirmation({ kind: "signout", member })
                              }
                            >
                              Sign out
                            </Button>
                          ) : null}

                          {/* Self-targeting actions are hidden; the API refuses
                              them regardless, so an admin cannot lock
                              themselves out. */}
                          {canUpdate && !isSelf ? (
                            <Button
                              size="sm"
                              variant={
                                member.status === "active" ? "ghost" : "secondary"
                              }
                              className={
                                member.status === "active"
                                  ? "text-red-700 hover:bg-red-50"
                                  : undefined
                              }
                              onClick={() =>
                                setConfirmation({
                                  kind: "status",
                                  member,
                                  status:
                                    member.status === "active"
                                      ? "inactive"
                                      : "active",
                                })
                              }
                            >
                              {member.status === "active"
                                ? "Deactivate"
                                : "Activate"}
                            </Button>
                          ) : null}

                          {canDelete && !isSelf ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-700 hover:bg-red-50"
                              onClick={() =>
                                setConfirmation({ kind: "delete", member })
                              }
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
        <MemberEditor
          member={editing === "new" ? null : editing}
          roles={roles}
          unlinkedDoctors={unlinkedDoctors}
          canLinkDoctors={canLinkDoctors}
          onClose={() => setEditing(null)}
          onCreated={(credentials) => {
            setEditing(null);
            setNewCredentials(credentials);
            void load();
          }}
          onUpdated={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      {/* One-time credential reveal, mirroring hospital onboarding. */}
      <Modal
        open={newCredentials !== null}
        onClose={() => setNewCredentials(null)}
        title="Member added"
        description="Share these credentials now — the password cannot be retrieved later."
        footer={
          <Button onClick={() => setNewCredentials(null)}>Done</Button>
        }
      >
        {newCredentials ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Member
              </p>
              <p className="mt-0.5 text-sm font-medium text-ink-900">
                {newCredentials.name}
              </p>
              <p className="text-sm text-ink-500">{newCredentials.email}</p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Temporary password
              </p>
              <p className="mt-1 select-all break-all rounded-lg border border-gold-200 bg-gold-50 px-3 py-2.5 font-mono text-sm text-gold-900">
                {newCredentials.temporaryPassword}
              </p>
            </div>

            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              This password will not be shown again. The member must change it
              on first sign-in before they can use the system.
            </p>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={confirmation !== null}
        onClose={() => setConfirmation(null)}
        onConfirm={() => void runConfirmation()}
        title={confirmCopy?.title ?? ""}
        description={confirmCopy?.description ?? ""}
        confirmLabel={confirmCopy?.label ?? "Confirm"}
        tone={confirmCopy?.danger ? "danger" : "primary"}
        loading={working}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function MemberEditor({
  member,
  roles,
  unlinkedDoctors,
  canLinkDoctors,
  onClose,
  onCreated,
  onUpdated,
}: {
  member: Member | null;
  roles: Role[];
  unlinkedDoctors: UnlinkedDoctor[];
  canLinkDoctors: boolean;
  onClose: () => void;
  onCreated: (credentials: {
    name: string;
    email: string;
    temporaryPassword: string;
  }) => void;
  onUpdated: () => void;
}) {
  const toast = useToast();
  const editing = member !== null;

  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [roleId, setRoleId] = useState(member?.role?.id ?? roles[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isDoctorRole =
    roles.find((role) => role.id === roleId)?.key === "doctor";

  /**
   * The doctor profile this name refers to, if any.
   *
   * Derived from the typed name rather than held in state, so it stays right
   * whether the admin picked from the list or typed the name out — and clears
   * itself the moment they edit it into something else.
   */
  const matchedDoctor =
    isDoctorRole && name.trim() !== ""
      ? (unlinkedDoctors.find(
          (doctor) =>
            doctor.displayName.trim().toLowerCase() ===
            name.trim().toLowerCase(),
        ) ?? null)
      : null;

  /**
   * Attaches the new account to the chosen doctor profile.
   *
   * Deliberately non-fatal. The member is already created by this point, and a
   * failure here must not leave the admin thinking no account exists — so it
   * reports the gap and points at where to fix it, rather than throwing away a
   * successful sign-up.
   */
  async function linkDoctorProfile(userId: string): Promise<void> {
    if (!matchedDoctor || !canLinkDoctors) return;

    try {
      await api.patch(`/api/doctors/${matchedDoctor.id}`, { userId });
      toast.success(`Linked to the ${matchedDoctor.displayName} profile.`);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? `Member saved, but the doctor profile could not be linked: ${err.message}`
          : "Member saved, but the doctor profile could not be linked. Link it under Doctors.",
      );
    }
  }

  async function save() {
    setSaving(true);
    setFieldErrors({});

    try {
      if (editing && member) {
        await api.patch(`/api/users/${member.id}`, { name, email, roleId });
        toast.success(`${name} updated.`);
        await linkDoctorProfile(member.id);
        onUpdated();
      } else {
        const result = await api.post<{
          member: Member;
          temporaryPassword: string;
        }>("/api/users", { name, email, roleId, status: "active" });

        await linkDoctorProfile(result.member.id);

        onCreated({
          name: result.member.name,
          email: result.member.email,
          temporaryPassword: result.temporaryPassword,
        });
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        if (Object.keys(err.fields).length === 0) toast.error(err.message);
      } else {
        toast.error("Could not save the member.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit ${member?.name}` : "Add a member"}
      description={
        editing
          ? "Update their details or move them to a different role."
          : "They will receive a one-time temporary password and must change it on first sign-in."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!name.trim() || !email.trim() || !roleId}
          >
            {editing ? "Save changes" : "Add member"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Role leads: what someone is determines what the rest of the form is
            for, so it is the first thing chosen rather than the last. */}
        {roles.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            No roles are available to assign. You need permission to view roles
            before you can assign one.
          </p>
        ) : (
          <SelectField
            label="Role"
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            error={fieldErrors.roleId}
            options={roles.map((role) => ({
              value: role.id,
              label: role.name,
            }))}
            hint="Determines what this member can do. Changes take effect immediately."
            required
          />
        )}

        {/* For a doctor, the name is offered from the profiles this hospital
            has already created, so the account attaches to one instead of
            becoming a second record of the same person. Still free text: a
            doctor who has no profile yet is typed in as normal. */}
        {isDoctorRole && unlinkedDoctors.length > 0 ? (
          <ComboField
            label="Full name"
            value={name}
            onValueChange={setName}
            /**
             * The list shows the specialisation so two doctors with similar
             * names are told apart, but only the name is committed — the
             * specialisation belongs to the doctor profile, not to the account.
             */
            suggestions={unlinkedDoctors.map((doctor) => ({
              value: doctor.displayName,
              label: doctor.specialization
                ? `${doctor.displayName} — ${doctor.specialization}`
                : doctor.displayName,
            }))}
            error={fieldErrors.name}
            placeholder="Dr. Jane Okafor"
            hint={
              matchedDoctor
                ? canLinkDoctors
                  ? `This account will be linked to the ${matchedDoctor.displayName} profile, so they can prescribe under it.`
                  : `Matches the ${matchedDoctor.displayName} profile, but linking it needs permission to edit doctors.`
                : "Choose a doctor profile to link this account to, or type a new name."
            }
            maxLength={150}
            required
          />
        ) : (
          <TextField
            label="Full name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={fieldErrors.name}
            placeholder="Dr. Jane Okafor"
            hint={
              isDoctorRole
                ? "No unlinked doctor profiles available. Create one under Doctors to link this account to."
                : undefined
            }
            required
          />
        )}

        <EmailField
          label="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          placeholder="jane@hospital.com"
          hint="Used to sign in. Must be unique within this hospital."
          required
        />
      </div>
    </Modal>
  );
}
