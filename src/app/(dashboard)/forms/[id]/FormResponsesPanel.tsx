"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import { isFieldVisible, type FieldDefinition } from "@/lib/forms/validate";
import type { Paginated } from "@/types";

type ResponseSummary = {
  id: string;
  formVersion: number;
  patient: { id: string; name: string; patientNumber: string } | null;
  submittedBy: { id: string; name: string } | null;
  responses: Record<string, unknown>;
  submittedAt: string;
};

type ResponseDetail = ResponseSummary & {
  formName: string;
  fields: Array<FieldDefinition & { id: string; helpText: string }>;
  isHistoricalVersion: boolean;
  currentVersion: number;
};

type PatientOption = { id: string; fullName: string; patientNumber: string };

const PAGE_SIZE = 20;

function displayValue(value: unknown, field: FieldDefinition): string {
  if (value === null || value === undefined || value === "") return "—";

  if (Array.isArray(value)) {
    return value
      .map((item) => labelForValue(String(item), field))
      .join(", ");
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";

  return labelForValue(String(value), field);
}

/** Choice fields store the value, but staff should read the label. */
function labelForValue(value: string, field: FieldDefinition): string {
  const option = field.options?.find((item) => item.value === value);
  return option ? option.label : value;
}

export function FormResponsesPanel({
  formId,
  canSubmit,
  canViewPatients,
  currentVersion,
}: {
  formId: string;
  canSubmit: boolean;
  canViewPatients: boolean;
  currentVersion: number;
}) {
  const toast = useToast();

  const [data, setData] = useState<Paginated<ResponseSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [viewing, setViewing] = useState<ResponseDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [filling, setFilling] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        setData(
          await api.get<Paginated<ResponseSummary>>(
            `/api/forms/${formId}/responses?page=${page}&pageSize=${PAGE_SIZE}`,
            signal,
          ),
        );
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load responses.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [formId, page],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function openResponse(id: string) {
    setLoadingDetail(true);
    try {
      // Fetched individually because the detail carries the field definitions
      // of the version this response was answered against.
      setViewing(await api.get<ResponseDetail>(`/api/form-responses/${id}`));
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Could not load the response.",
      );
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-5 py-3.5">
          <p className="text-sm text-ink-500">
            {data ? `${data.total} submitted` : " "}
          </p>
          {canSubmit && canViewPatients ? (
            <Button size="sm" onClick={() => setFilling(true)}>
              Fill in form
            </Button>
          ) : null}
        </div>

        {loading && !data ? (
          <TableSkeleton rows={4} columns={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No responses yet"
            description={
              canSubmit
                ? "Fill this form in for a patient to see responses here."
                : "Nothing has been submitted against this form."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Patient</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Version</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Submitted</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">By</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((response) => (
                  <tr key={response.id} className="hover:bg-ink-50/60">
                    <td className="px-5 py-3">
                      <p className="text-ink-900">
                        {response.patient?.name ?? "—"}
                      </p>
                      <p className="font-mono text-xs text-ink-500">
                        {response.patient?.patientNumber ?? ""}
                      </p>
                    </td>
                    <td className="px-5 py-3">
                      <Badge
                        tone={
                          response.formVersion === currentVersion
                            ? "gold"
                            : "neutral"
                        }
                      >
                        <span className="normal-case">
                          v{response.formVersion}
                        </span>
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      {new Date(response.submittedAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-ink-600">
                      {response.submittedBy?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={loadingDetail}
                        onClick={() => void openResponse(response.id)}
                      >
                        View
                      </Button>
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

      {/* Rendered against the fields of the version it was answered on. */}
      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? `${viewing.patient?.name ?? "Response"}` : ""}
        description={
          viewing
            ? `Submitted ${new Date(viewing.submittedAt).toLocaleString()} · version ${viewing.formVersion}`
            : ""
        }
      >
        {viewing ? (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            {viewing.isHistoricalVersion ? (
              <div className="rounded-lg border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-xs text-ink-600">
                This response was submitted against version{" "}
                {viewing.formVersion}; the form is now on version{" "}
                {viewing.currentVersion}. It is shown with the questions exactly
                as they were asked.
              </div>
            ) : null}

            <dl className="flex flex-col gap-3">
              {viewing.fields
                // A field hidden by its condition was never asked, so showing
                // it as "—" would misrepresent the record.
                .filter((field) => isFieldVisible(field, viewing.responses))
                .map((field) => (
                  <div
                    key={field.id}
                    className="border-b border-ink-100 pb-3 last:border-0"
                  >
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                      {field.label}
                    </dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm text-ink-900">
                      {displayValue(viewing.responses[field.fieldName], field)}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        ) : null}
      </Modal>

      {filling ? (
        <FillFormModal
          formId={formId}
          onClose={() => setFilling(false)}
          onSubmitted={async () => {
            setFilling(false);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Renders the live form from its field definitions and submits the answers.
 * Nothing about the field types is hard-coded to any hospital's needs.
 */
function FillFormModal({
  formId,
  onClose,
  onSubmitted,
}: {
  formId: string;
  onClose: () => void;
  onSubmitted: () => void | Promise<void>;
}) {
  const toast = useToast();

  const [fields, setFields] = useState<FieldDefinition[] | null>(null);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [patientId, setPatientId] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    api
      .get<{ fields: FieldDefinition[] }>(
        `/api/forms/${formId}/fields`,
        controller.signal,
      )
      .then((result) => setFields(result.fields))
      .catch(() => setFields([]));

    api
      .get<Paginated<PatientOption>>(
        "/api/patients?pageSize=100",
        controller.signal,
      )
      .then((result) => setPatients(result.items))
      .catch(() => setPatients([]));

    return () => controller.abort();
  }, [formId]);

  function setAnswer(fieldName: string, value: unknown) {
    setAnswers((current) => ({ ...current, [fieldName]: value }));
  }

  async function submit() {
    setSubmitting(true);
    setErrors({});
    try {
      await api.post(`/api/forms/${formId}/responses`, {
        patientId,
        responses: answers,
      });
      toast.success("Response submitted.");
      await onSubmitted();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors(err.fields);
        if (Object.keys(err.fields).length === 0) toast.error(err.message);
      } else {
        toast.error("Could not submit the response.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const visibleFields = (fields ?? []).filter((field) =>
    isFieldVisible(field, answers),
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Fill in form"
      description="Answers are validated against this form's current version."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={submitting}
            disabled={!patientId || !fields}
          >
            Submit
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="fill-patient"
            className="text-sm font-medium text-ink-800"
          >
            Patient <span className="text-red-600">*</span>
          </label>
          <select
            id="fill-patient"
            value={patientId}
            onChange={(event) => setPatientId(event.target.value)}
            className="h-10 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
          >
            <option value="">Select a patient</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.fullName} ({patient.patientNumber})
              </option>
            ))}
          </select>
        </div>

        {fields === null ? (
          <p className="text-sm text-ink-500">Loading fields…</p>
        ) : (
          visibleFields.map((field) => (
            <DynamicField
              key={field.fieldName}
              field={field}
              value={answers[field.fieldName]}
              error={errors[field.fieldName]}
              onChange={(value) => setAnswer(field.fieldName, value)}
            />
          ))
        )}
      </div>
    </Modal>
  );
}

function DynamicField({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
}) {
  const inputId = `field-${field.fieldName}`;
  const base =
    "w-full rounded-lg border bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500";
  const border = error ? "border-red-400" : "border-ink-200";

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink-800">
        {field.label}
        {field.required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </label>

      {field.type === "textarea" ? (
        <textarea
          id={inputId}
          rows={3}
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className={`${base} ${border} py-2`}
        />
      ) : field.type === "boolean" ? (
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input
            id={inputId}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
            className="h-4 w-4 rounded border-ink-300 accent-gold-500"
          />
          Yes
        </label>
      ) : field.type === "select" || field.type === "radio" ? (
        <select
          id={inputId}
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className={`${base} ${border} h-10`}
        >
          <option value="">Select…</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === "multi_select" || field.type === "checkbox" ? (
        <div className="flex flex-col gap-1.5">
          {field.options?.map((option) => {
            const selected = Array.isArray(value) ? (value as string[]) : [];
            return (
              <label
                key={option.value}
                className="flex items-center gap-2 text-sm text-ink-700"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option.value]
                        : selected.filter((item) => item !== option.value),
                    )
                  }
                  className="h-4 w-4 rounded border-ink-300 accent-gold-500"
                />
                {option.label}
              </label>
            );
          })}
        </div>
      ) : (
        <input
          id={inputId}
          type={
            field.type === "number"
              ? "number"
              : field.type === "date"
                ? "date"
                : field.type === "email"
                  ? "email"
                  : "text"
          }
          value={String(value ?? "")}
          onChange={(event) =>
            onChange(
              field.type === "number" && event.target.value !== ""
                ? Number(event.target.value)
                : event.target.value,
            )
          }
          className={`${base} ${border} h-10`}
        />
      )}

      {error ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
