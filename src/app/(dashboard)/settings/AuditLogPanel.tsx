"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { ApiClientError, api } from "@/lib/client/api";
import type { Paginated } from "@/types";

type AuditEntry = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actor: { id: string; name: string; email: string } | null;
  metadata: Record<string, unknown>;
  ipAddress: string;
  createdAt: string;
};

const PAGE_SIZE = 25;

/** Destructive actions read differently from routine ones at a glance. */
function toneFor(action: string): "neutral" | "gold" | "danger" | "success" {
  if (/deleted|cancelled|force_logout|suspend/.test(action)) return "danger";
  if (/created|issued/.test(action)) return "success";
  if (/login|logout|password/.test(action)) return "gold";
  return "neutral";
}

export function AuditLogPanel() {
  const [data, setData] = useState<Paginated<AuditEntry> | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [actors, setActors] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (actionFilter) params.set("action", actionFilter);
      if (userFilter) params.set("userId", userFilter);
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      try {
        setData(
          await api.get<Paginated<AuditEntry>>(`/api/audit-logs?${params}`, signal),
        );
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load the audit log.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, actionFilter, userFilter, from, to],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ actions: string[]; actors: Array<{ id: string; name: string }> }>(
        "/api/audit-logs?filters=1",
        controller.signal,
      )
      .then((result) => {
        setActions(result.actions);
        setActors(result.actors);
      })
      .catch(() => {
        setActions([]);
        setActors([]);
      });
    return () => controller.abort();
  }, []);

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-ink-200 px-5 py-3.5">
        <div>
          <label
            htmlFor="audit-action"
            className="mb-1 block text-xs font-medium text-ink-600"
          >
            Action
          </label>
          <select
            id="audit-action"
            value={actionFilter}
            onChange={(event) => {
              setActionFilter(event.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
          >
            <option value="">All actions</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="audit-user"
            className="mb-1 block text-xs font-medium text-ink-600"
          >
            Staff member
          </label>
          <select
            id="audit-user"
            value={userFilter}
            onChange={(event) => {
              setUserFilter(event.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
          >
            <option value="">Anyone</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="audit-from"
            className="mb-1 block text-xs font-medium text-ink-600"
          >
            From
          </label>
          <input
            id="audit-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
          />
        </div>

        <div>
          <label
            htmlFor="audit-to"
            className="mb-1 block text-xs font-medium text-ink-600"
          >
            To
          </label>
          <input
            id="audit-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setActionFilter("");
              setUserFilter("");
              setFrom("");
              setTo("");
              setPage(1);
            }}
          >
            Clear
          </Button>
          {data ? (
            <p className="text-xs text-ink-500">{data.total} entries</p>
          ) : null}
        </div>
      </div>

      {loading && !data ? (
        <TableSkeleton rows={6} columns={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No audit entries"
          description={
            actionFilter || userFilter || from || to
              ? "Try widening the filters."
              : "Administrative and clinical actions will be recorded here."
          }
        />
      ) : (
        <ul className="divide-y divide-ink-100">
          {data.items.map((entry) => {
            const hasDetail = Object.keys(entry.metadata).length > 0;
            const isOpen = expanded === entry.id;

            return (
              <li key={entry.id} className="px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={toneFor(entry.action)}>
                        <span className="font-mono normal-case">
                          {entry.action}
                        </span>
                      </Badge>
                      <span className="text-xs text-ink-500">
                        {entry.resource}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-ink-700">
                      {entry.actor
                        ? `${entry.actor.name} (${entry.actor.email})`
                        : "System"}
                    </p>
                    <p className="text-xs text-ink-500">
                      {new Date(entry.createdAt).toLocaleString()}
                      {entry.ipAddress ? ` · ${entry.ipAddress}` : ""}
                    </p>
                  </div>

                  {hasDetail ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpanded(isOpen ? null : entry.id)}
                    >
                      {isOpen ? "Hide" : "Details"}
                    </Button>
                  ) : null}
                </div>

                {isOpen ? (
                  <pre className="mt-2 overflow-x-auto rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-700">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ul>
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
  );
}
