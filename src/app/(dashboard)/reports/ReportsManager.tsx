"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { ApiClientError, api } from "@/lib/client/api";
import { statusLabel } from "@/components/ui/appointment-status";

type ReportSummary = {
  from: string;
  to: string;
  currency: string;
  revenue: {
    invoicedFormatted: string;
    collectedFormatted: string;
    invoiceCount: number;
    paymentCount: number;
    byMethod: Array<{
      method: string;
      amountFormatted: string;
      count: number;
    }>;
  } | null;
  activity: {
    appointments: number;
    appointmentsByStatus: Array<{ status: string; count: number }>;
    visits: number;
    newPatients: number;
  } | null;
  topTreatments: Array<{
    name: string;
    quantity: number;
    revenueFormatted: string;
  }>;
};

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

export function ReportsManager({
  defaultFrom,
  defaultTo,
}: {
  defaultFrom: string;
  defaultTo: string;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [data, setData] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        setData(
          await api.get<ReportSummary>(
            `/api/reports/summary?from=${from}&to=${to}`,
            signal,
          ),
        );
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load the report.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [from, to],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <>
      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="report-from"
              className="mb-1 block text-xs font-medium text-ink-600"
            >
              From
            </label>
            <input
              id="report-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
            />
          </div>
          <div>
            <label
              htmlFor="report-to"
              className="mb-1 block text-xs font-medium text-ink-600"
            >
              To
            </label>
            <input
              id="report-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
            />
          </div>
          <Button variant="secondary" loading={loading} onClick={() => void load()}>
            Refresh
          </Button>
        </CardBody>
      </Card>

      {error ? (
        <Card>
          <ErrorState message={error} onRetry={() => void load()} />
        </Card>
      ) : !data ? null : !data.revenue && !data.activity ? (
        <Card>
          <EmptyState
            title="Nothing to report"
            description="Your role does not include access to billing or clinical figures."
          />
        </Card>
      ) : (
        <>
          {data.revenue ? (
            <Card>
              <CardHeader
                title="Revenue"
                description={`Invoices issued and payments received between ${data.from} and ${data.to}`}
              />
              <CardBody className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Metric
                    label="Invoiced"
                    value={data.revenue.invoicedFormatted}
                    hint={`${data.revenue.invoiceCount} invoice${data.revenue.invoiceCount === 1 ? "" : "s"} issued`}
                  />
                  <Metric
                    label="Collected"
                    value={data.revenue.collectedFormatted}
                    hint={`${data.revenue.paymentCount} payment${data.revenue.paymentCount === 1 ? "" : "s"} received`}
                  />
                </div>

                {data.revenue.byMethod.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                      By payment method
                    </p>
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-ink-100">
                        {data.revenue.byMethod.map((row) => (
                          <tr key={row.method}>
                            <td className="py-2 capitalize text-ink-700">
                              {row.method.replace("_", " ")}
                            </td>
                            <td className="py-2 text-right tabular-nums text-ink-500">
                              {row.count}
                            </td>
                            <td className="py-2 text-right font-medium tabular-nums text-ink-900">
                              {row.amountFormatted}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {data.topTreatments.length > 0 ? (
            <Card>
              <CardHeader
                title="Top treatments by revenue"
                description="From issued invoices in this period."
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                      <th className="px-5 py-2.5 font-semibold">Treatment</th>
                      <th className="px-5 py-2.5 text-right font-semibold">
                        Quantity
                      </th>
                      <th className="px-5 py-2.5 text-right font-semibold">
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {data.topTreatments.map((row) => (
                      <tr key={row.name}>
                        <td className="px-5 py-2.5 text-ink-900">{row.name}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-ink-600">
                          {row.quantity}
                        </td>
                        <td className="px-5 py-2.5 text-right font-medium tabular-nums text-ink-900">
                          {row.revenueFormatted}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {data.activity ? (
            <Card>
              <CardHeader title="Activity" />
              <CardBody className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Metric
                    label="Appointments"
                    value={data.activity.appointments}
                  />
                  <Metric label="Visits recorded" value={data.activity.visits} />
                  <Metric
                    label="New patients"
                    value={data.activity.newPatients}
                  />
                </div>

                {data.activity.appointmentsByStatus.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Appointments by status
                    </p>
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-ink-100">
                        {data.activity.appointmentsByStatus.map((row) => (
                          <tr key={row.status}>
                            <td className="py-2 capitalize text-ink-700">
                              {statusLabel(row.status)}
                            </td>
                            <td className="py-2 text-right font-medium tabular-nums text-ink-900">
                              {row.count}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
