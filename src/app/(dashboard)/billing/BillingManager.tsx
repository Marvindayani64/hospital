"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import { PAYMENT_METHODS } from "@/lib/domain/enums";
import type { Currency } from "@/utils/money";
import type { Paginated } from "@/types";
import { cn } from "@/utils/cn";

type InvoiceLine = {
  id: string;
  treatmentId: string | null;
  description: string;
  quantity: number;
  unitPriceFormatted: string;
  lineTotalFormatted: string;
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  patient: { id: string; name: string; patientNumber: string } | null;
  items: InvoiceLine[];
  currency: string;
  discountType: "none" | "fixed" | "percent";
  discountValue: number;
  taxRatePercent: number;
  subtotalFormatted: string;
  discountFormatted: string;
  taxFormatted: string;
  totalFormatted: string;
  totalMinor: number;
  amountPaidFormatted: string;
  balanceDueMinor: number;
  balanceDueFormatted: string;
  paymentStatus: "unpaid" | "partially_paid" | "paid";
  status: "draft" | "issued" | "cancelled";
  notes: string;
  createdAt: string;
};

type Payment = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  patient: { id: string; name: string; patientNumber: string } | null;
  amountFormatted: string;
  method: string;
  reference: string;
  receivedBy: { id: string; name: string } | null;
  paidAt: string;
};

type PatientOption = { id: string; fullName: string; patientNumber: string };
type TreatmentOption = {
  id: string;
  name: string;
  priceFormatted: string;
};

const PAGE_SIZE = 20;

const STATUS_TONES: Record<Invoice["status"], "neutral" | "gold" | "danger"> = {
  draft: "neutral",
  issued: "gold",
  cancelled: "danger",
};

const PAYMENT_TONES: Record<
  Invoice["paymentStatus"],
  "neutral" | "warning" | "success"
> = {
  unpaid: "neutral",
  partially_paid: "warning",
  paid: "success",
};

export function BillingManager({
  currency,
  defaultTaxRatePercent,
  canViewInvoices,
  canCreate,
  canUpdate,
  canDelete,
  canViewPayments,
  canRecordPayment,
  canViewPatients,
  canViewTreatments,
}: {
  currency: Currency;
  defaultTaxRatePercent: number;
  canViewInvoices: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canViewPayments: boolean;
  canRecordPayment: boolean;
  canViewPatients: boolean;
  canViewTreatments: boolean;
}) {
  const toast = useToast();

  const [tab, setTab] = useState<"invoices" | "payments">(
    canViewInvoices ? "invoices" : "payments",
  );

  const [invoices, setInvoices] = useState<Paginated<Invoice> | null>(null);
  const [payments, setPayments] = useState<Paginated<Payment> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [treatments, setTreatments] = useState<TreatmentOption[]>([]);

  const [composing, setComposing] = useState<Invoice | "new" | null>(null);
  const [viewing, setViewing] = useState<Invoice | null>(null);
  const [payingFor, setPayingFor] = useState<Invoice | null>(null);
  const [pendingAction, setPendingAction] = useState<
    { kind: "issue" | "cancel" | "delete"; invoice: Invoice } | null
  >(null);
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

      try {
        if (tab === "invoices") {
          if (debouncedSearch) params.set("search", debouncedSearch);
          if (statusFilter) params.set("status", statusFilter);
          setInvoices(
            await api.get<Paginated<Invoice>>(`/api/invoices?${params}`, signal),
          );
        } else {
          setPayments(
            await api.get<Paginated<Payment>>(`/api/payments?${params}`, signal),
          );
        }
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError ? err.message : "Could not load billing.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [tab, page, debouncedSearch, statusFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();

    if (canViewPatients) {
      api
        .get<Paginated<PatientOption>>(
          "/api/patients?pageSize=100",
          controller.signal,
        )
        .then((result) => setPatients(result.items))
        .catch(() => setPatients([]));
    }

    if (canViewTreatments) {
      api
        .get<Paginated<TreatmentOption>>(
          "/api/treatments?pageSize=100&status=active",
          controller.signal,
        )
        .then((result) => setTreatments(result.items))
        .catch(() => setTreatments([]));
    }

    return () => controller.abort();
  }, [canViewPatients, canViewTreatments]);

  async function runAction() {
    if (!pendingAction) return;
    setWorking(true);
    const { kind, invoice } = pendingAction;

    try {
      if (kind === "delete") {
        await api.del(`/api/invoices/${invoice.id}`);
        toast.success(`${invoice.invoiceNumber} deleted.`);
      } else {
        await api.put(`/api/invoices/${invoice.id}`, {
          status: kind === "issue" ? "issued" : "cancelled",
        });
        toast.success(
          kind === "issue"
            ? `${invoice.invoiceNumber} issued.`
            : `${invoice.invoiceNumber} cancelled.`,
        );
      }
      setPendingAction(null);
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

  const actionCopy = pendingAction
    ? pendingAction.kind === "issue"
      ? {
          title: "Issue this invoice?",
          description: `${pendingAction.invoice.invoiceNumber} will be finalised at ${pendingAction.invoice.totalFormatted} and can no longer be edited. Payments can then be recorded against it.`,
          label: "Issue invoice",
          danger: false,
        }
      : pendingAction.kind === "cancel"
        ? {
            title: "Cancel this invoice?",
            description: `${pendingAction.invoice.invoiceNumber} will be voided. This cannot be undone, and an invoice with payments against it cannot be cancelled.`,
            label: "Cancel invoice",
            danger: true,
          }
        : {
            title: "Delete this draft?",
            description: `${pendingAction.invoice.invoiceNumber} will be removed permanently. Only unissued drafts can be deleted.`,
            label: "Delete draft",
            danger: true,
          }
    : null;

  return (
    <>
      <div className="flex gap-1 border-b border-ink-200">
        {([
          ["invoices", "Invoices", canViewInvoices],
          ["payments", "Payments", canViewPayments],
        ] as const)
          .filter(([, , visible]) => visible)
          .map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value);
                setPage(1);
              }}
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                tab === value
                  ? "border-gold-500 text-gold-800"
                  : "border-transparent text-ink-500 hover:text-ink-800",
              )}
            >
              {label}
            </button>
          ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 px-5 py-3.5">
          {tab === "invoices" ? (
            <>
              <div className="min-w-0 flex-1 sm:max-w-xs">
                <label htmlFor="invoice-search" className="sr-only">
                  Search invoices
                </label>
                <input
                  id="invoice-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by invoice number"
                  className="h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm placeholder:text-ink-400 hover:border-ink-300 focus:border-gold-500"
                />
              </div>
              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
              >
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="issued">Issued</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </>
          ) : null}

          <div className="ml-auto flex items-center gap-3">
            {tab === "invoices" && invoices ? (
              <p className="text-xs text-ink-500">{invoices.total} invoices</p>
            ) : null}
            {tab === "payments" && payments ? (
              <p className="text-xs text-ink-500">{payments.total} payments</p>
            ) : null}
            {tab === "invoices" && canCreate ? (
              <Button
                size="sm"
                onClick={() => setComposing("new")}
                disabled={treatments.length === 0 && patients.length === 0}
              >
                New invoice
              </Button>
            ) : null}
          </div>
        </div>

        {loading && !invoices && !payments ? (
          <TableSkeleton rows={5} columns={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : tab === "invoices" ? (
          !invoices || invoices.items.length === 0 ? (
            <EmptyState
              title="No invoices"
              description={
                debouncedSearch || statusFilter
                  ? "Try adjusting your search or filter."
                  : "Raise an invoice from your treatment catalogue."
              }
              action={
                canCreate && !debouncedSearch && !statusFilter ? (
                  <Button size="sm" onClick={() => setComposing("new")}>
                    New invoice
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th scope="col" className="px-5 py-2.5 font-semibold">Invoice</th>
                    <th scope="col" className="px-5 py-2.5 font-semibold">Patient</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-semibold">Total</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-semibold">Balance</th>
                    <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {invoices.items.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-ink-50/60">
                      <td className="px-5 py-3">
                        <p className="font-mono text-xs font-medium text-ink-900">
                          {invoice.invoiceNumber}
                        </p>
                        <p className="text-xs text-ink-500">
                          {new Date(invoice.createdAt).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        {invoice.patient ? (
                          <Link
                            href={`/patients/${invoice.patient.id}`}
                            className="text-ink-900 hover:text-gold-700"
                          >
                            {invoice.patient.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-medium tabular-nums text-ink-900">
                        {invoice.totalFormatted}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink-700">
                        {invoice.balanceDueFormatted}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={STATUS_TONES[invoice.status]}>
                            <span className="normal-case">{invoice.status}</span>
                          </Badge>
                          {invoice.status === "issued" ? (
                            <Badge tone={PAYMENT_TONES[invoice.paymentStatus]}>
                              <span className="normal-case">
                                {invoice.paymentStatus.replace("_", " ")}
                              </span>
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setViewing(invoice)}
                          >
                            View
                          </Button>

                          {canUpdate && invoice.status === "draft" ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setComposing(invoice)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  setPendingAction({ kind: "issue", invoice })
                                }
                              >
                                Issue
                              </Button>
                            </>
                          ) : null}

                          {canRecordPayment &&
                          invoice.status === "issued" &&
                          invoice.balanceDueMinor > 0 ? (
                            <Button
                              size="sm"
                              onClick={() => setPayingFor(invoice)}
                            >
                              Record payment
                            </Button>
                          ) : null}

                          {canUpdate && invoice.status === "issued" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-700 hover:bg-red-50"
                              onClick={() =>
                                setPendingAction({ kind: "cancel", invoice })
                              }
                            >
                              Cancel
                            </Button>
                          ) : null}

                          {canDelete && invoice.status === "draft" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-700 hover:bg-red-50"
                              onClick={() =>
                                setPendingAction({ kind: "delete", invoice })
                              }
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
          )
        ) : !payments || payments.items.length === 0 ? (
          <EmptyState
            title="No payments"
            description="Payments recorded against invoices appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Date</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Invoice</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Patient</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">Amount</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Method</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Received by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {payments.items.map((payment) => (
                  <tr key={payment.id} className="hover:bg-ink-50/60">
                    <td className="px-5 py-3 text-ink-600">
                      {new Date(payment.paidAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-900">
                      {payment.invoiceNumber}
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      {payment.patient?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums text-ink-900">
                      {payment.amountFormatted}
                    </td>
                    <td className="px-5 py-3 capitalize text-ink-600">
                      {payment.method.replace("_", " ")}
                      {payment.reference ? (
                        <p className="text-xs text-ink-400">{payment.reference}</p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      {payment.receivedBy?.name ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(() => {
          const current = tab === "invoices" ? invoices : payments;
          if (!current || current.totalPages <= 1) return null;
          return (
            <CardBody className="flex items-center justify-between border-t border-ink-200">
              <p className="text-xs text-ink-500">
                Page {current.page} of {current.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= current.totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </CardBody>
          );
        })()}
      </Card>

      {/* Read-only invoice */}
      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing?.invoiceNumber ?? ""}
        description={
          viewing
            ? `${viewing.patient?.name ?? "Unknown patient"} · ${new Date(viewing.createdAt).toLocaleDateString()}`
            : ""
        }
      >
        {viewing ? (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 font-semibold">Item</th>
                  <th className="py-2 text-right font-semibold">Qty</th>
                  <th className="py-2 text-right font-semibold">Unit</th>
                  <th className="py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {viewing.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 text-ink-900">{item.description}</td>
                    <td className="py-2 text-right tabular-nums text-ink-600">
                      {item.quantity}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-600">
                      {item.unitPriceFormatted}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-900">
                      {item.lineTotalFormatted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="flex flex-col gap-1.5 border-t border-ink-200 pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-600">Subtotal</dt>
                <dd className="tabular-nums text-ink-900">
                  {viewing.subtotalFormatted}
                </dd>
              </div>
              {viewing.discountType !== "none" ? (
                <div className="flex justify-between">
                  <dt className="text-ink-600">
                    Discount
                    {viewing.discountType === "percent"
                      ? ` (${viewing.discountValue}%)`
                      : ""}
                  </dt>
                  <dd className="tabular-nums text-ink-900">
                    −{viewing.discountFormatted}
                  </dd>
                </div>
              ) : null}
              {viewing.taxRatePercent > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-ink-600">
                    Tax ({viewing.taxRatePercent}%)
                  </dt>
                  <dd className="tabular-nums text-ink-900">
                    {viewing.taxFormatted}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-semibold">
                <dt className="text-ink-900">Total</dt>
                <dd className="tabular-nums text-ink-900">
                  {viewing.totalFormatted}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-600">Paid</dt>
                <dd className="tabular-nums text-emerald-700">
                  {viewing.amountPaidFormatted}
                </dd>
              </div>
              <div className="flex justify-between font-medium">
                <dt className="text-ink-900">Balance due</dt>
                <dd className="tabular-nums text-ink-900">
                  {viewing.balanceDueFormatted}
                </dd>
              </div>
            </dl>

            {viewing.notes ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Notes
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-700">
                  {viewing.notes}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {composing ? (
        <InvoiceComposer
          invoice={composing === "new" ? null : composing}
          patients={patients}
          treatments={treatments}
          currency={currency}
          defaultTaxRatePercent={defaultTaxRatePercent}
          onClose={() => setComposing(null)}
          onSaved={async () => {
            setComposing(null);
            await load();
          }}
        />
      ) : null}

      {payingFor ? (
        <PaymentModal
          invoice={payingFor}
          currency={currency}
          onClose={() => setPayingFor(null)}
          onSaved={async () => {
            setPayingFor(null);
            await load();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        onConfirm={() => void runAction()}
        title={actionCopy?.title ?? ""}
        description={actionCopy?.description ?? ""}
        confirmLabel={actionCopy?.label ?? "Confirm"}
        tone={actionCopy?.danger ? "danger" : "primary"}
        loading={working}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

type ComposerLine = { treatmentId: string; quantity: number };

function InvoiceComposer({
  invoice,
  patients,
  treatments,
  currency,
  defaultTaxRatePercent,
  onClose,
  onSaved,
}: {
  invoice: Invoice | null;
  patients: PatientOption[];
  treatments: TreatmentOption[];
  currency: Currency;
  defaultTaxRatePercent: number;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const editing = invoice !== null;

  const [patientId, setPatientId] = useState(invoice?.patient?.id ?? "");
  const [lines, setLines] = useState<ComposerLine[]>(
    invoice?.items
      .filter((item) => item.treatmentId)
      .map((item) => ({
        treatmentId: item.treatmentId!,
        quantity: item.quantity,
      })) ?? [],
  );
  const [discountType, setDiscountType] = useState<Invoice["discountType"]>(
    invoice?.discountType ?? "none",
  );
  const [discountValue, setDiscountValue] = useState(
    String(invoice?.discountValue ?? 0),
  );
  const [taxRatePercent, setTaxRatePercent] = useState(
    String(invoice?.taxRatePercent ?? defaultTaxRatePercent),
  );
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function addLine() {
    const first = treatments[0];
    if (!first) return;
    setLines((current) => [...current, { treatmentId: first.id, quantity: 1 }]);
  }

  async function save() {
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    /**
     * Only treatment ids and quantities are sent — there is no price field.
     * The server reads every price from the catalogue.
     */
    const payload = {
      items: lines.map((line) => ({
        treatmentId: line.treatmentId,
        quantity: line.quantity,
      })),
      discountType,
      discountValue: Number(discountValue) || 0,
      taxRatePercent: Number(taxRatePercent) || 0,
      notes,
    };

    try {
      if (editing && invoice) {
        await api.patch(`/api/invoices/${invoice.id}`, payload);
        toast.success("Invoice updated.");
      } else {
        await api.post("/api/invoices", { ...payload, patientId });
        toast.success("Draft invoice created.");
      }
      await onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        if (Object.keys(err.fields).length === 0) setFormError(err.message);
      } else {
        setFormError("Could not save the invoice.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit ${invoice.invoiceNumber}` : "New invoice"}
      description="Prices come from your treatment catalogue and are calculated on the server."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!patientId || lines.length === 0}
          >
            {editing ? "Save draft" : "Create draft"}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        {formError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
          >
            {formError}
          </div>
        ) : null}

        {editing ? (
          <div className="rounded-lg border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Patient
            </p>
            <p className="mt-0.5 text-ink-900">{invoice.patient?.name}</p>
          </div>
        ) : (
          <SelectField
            label="Patient"
            value={patientId}
            onChange={(event) => setPatientId(event.target.value)}
            error={fieldErrors.patientId}
            options={[
              { value: "", label: "Select a patient" },
              ...patients.map((patient) => ({
                value: patient.id,
                label: `${patient.fullName} (${patient.patientNumber})`,
              })),
            ]}
            required
          />
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ink-800">Lines</p>
            <button
              type="button"
              onClick={addLine}
              disabled={treatments.length === 0}
              className="text-xs font-medium text-gold-700 hover:text-gold-800 disabled:opacity-50"
            >
              Add line
            </button>
          </div>

          {treatments.length === 0 ? (
            <p className="text-xs text-amber-700">
              No active treatments available. Add treatments to your catalogue
              first.
            </p>
          ) : lines.length === 0 ? (
            <p className="text-xs text-ink-500">Add at least one line.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {lines.map((line, index) => {
                const treatment = treatments.find(
                  (item) => item.id === line.treatmentId,
                );
                return (
                  <div key={index} className="flex items-center gap-2">
                    <select
                      aria-label={`Line ${index + 1} treatment`}
                      value={line.treatmentId}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((l, i) =>
                            i === index
                              ? { ...l, treatmentId: event.target.value }
                              : l,
                          ),
                        )
                      }
                      className="h-9 flex-1 rounded-lg border border-ink-200 px-2.5 text-sm hover:border-ink-300 focus:border-gold-500"
                    >
                      {treatments.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} — {item.priceFormatted}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      aria-label={`Line ${index + 1} quantity`}
                      min={1}
                      value={line.quantity}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((l, i) =>
                            i === index
                              ? { ...l, quantity: Number(event.target.value) || 1 }
                              : l,
                          ),
                        )
                      }
                      className="h-9 w-20 rounded-lg border border-ink-200 px-2.5 text-sm hover:border-ink-300 focus:border-gold-500"
                    />
                    <button
                      type="button"
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() =>
                        setLines((current) =>
                          current.filter((_, i) => i !== index),
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
                    {treatment ? (
                      <span className="sr-only">
                        {treatment.name} at {treatment.priceFormatted}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          {fieldErrors.items ? (
            <p role="alert" className="mt-1 text-xs font-medium text-red-600">
              {fieldErrors.items}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            label="Discount"
            value={discountType}
            onChange={(event) =>
              setDiscountType(event.target.value as Invoice["discountType"])
            }
            options={[
              { value: "none", label: "None" },
              { value: "fixed", label: `Fixed (${currency.code})` },
              { value: "percent", label: "Percentage" },
            ]}
          />
          <TextField
            label={discountType === "percent" ? "Discount %" : "Discount amount"}
            type="number"
            min={0}
            value={discountValue}
            disabled={discountType === "none"}
            onChange={(event) => setDiscountValue(event.target.value)}
            error={fieldErrors.discountValue}
          />
          <TextField
            label="Tax %"
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={taxRatePercent}
            onChange={(event) => setTaxRatePercent(event.target.value)}
            error={fieldErrors.taxRatePercent}
          />
        </div>

        <TextAreaField
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          error={fieldErrors.notes}
        />

        <p className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5 text-xs text-ink-600">
          Totals are calculated on the server from your catalogue prices. They
          will appear once the draft is saved.
        </p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function PaymentModal({
  invoice,
  currency,
  onClose,
  onSaved,
}: {
  invoice: Invoice;
  currency: Currency;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    try {
      await api.post("/api/payments", {
        invoiceId: invoice.id,
        amount: Number(amount),
        method,
        reference,
        notes,
      });
      toast.success("Payment recorded.");
      await onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        if (Object.keys(err.fields).length === 0) setFormError(err.message);
      } else {
        setFormError("Could not record the payment.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Record payment — ${invoice.invoiceNumber}`}
      description={`Balance due ${invoice.balanceDueFormatted}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!amount || Number(amount) <= 0}
          >
            Record payment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {formError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
          >
            {formError}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <TextField
            label={`Amount (${currency.code})`}
            type="number"
            min={0}
            step={currency.decimals === 0 ? 1 : 10 ** -currency.decimals}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            error={fieldErrors.amount}
            className="flex-1"
            required
          />
          <Button
            variant="secondary"
            className="mt-6"
            onClick={() =>
              setAmount(
                (invoice.balanceDueMinor / 10 ** currency.decimals).toFixed(
                  currency.decimals,
                ),
              )
            }
          >
            Pay in full
          </Button>
        </div>

        <SelectField
          label="Method"
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          error={fieldErrors.method}
          options={PAYMENT_METHODS.map((value) => ({
            value,
            label: value.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          }))}
          required
        />

        <TextField
          label="Reference"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          error={fieldErrors.reference}
          hint="Transaction id, cheque number or claim reference."
        />

        <TextAreaField
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          error={fieldErrors.notes}
        />
      </div>
    </Modal>
  );
}
