"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { SelectField, TextField } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import { FIELD_TYPES, CHOICE_TYPES, type FieldType } from "@/lib/domain/enums";
import { FormResponsesPanel } from "@/app/(dashboard)/forms/[id]/FormResponsesPanel";
import { cn } from "@/utils/cn";

type FieldOption = { label: string; value: string };

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "is_empty"
  | "is_not_empty";

export type BuilderField = {
  id?: string;
  label: string;
  fieldName: string;
  type: FieldType;
  required: boolean;
  options: FieldOption[];
  validation: Record<string, number | string | null | undefined>;
  placeholder: string;
  helpText: string;
  defaultValue: unknown;
  conditionalLogic: {
    fieldName: string;
    operator: ConditionOperator;
    value?: unknown;
  } | null;
};

export type FormDetail = {
  id: string;
  name: string;
  description: string;
  category: string;
  status: "draft" | "published" | "archived";
  currentVersion: number;
  fieldCount: number;
  responseCount: number;
  fields: BuilderField[];
  editWillCreateVersion: boolean;
};

const TYPE_LABELS: Record<FieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  number: "Number",
  email: "Email",
  phone: "Phone",
  date: "Date",
  select: "Dropdown",
  multi_select: "Multi-select",
  radio: "Radio buttons",
  checkbox: "Checkboxes",
  boolean: "Yes / No",
  file: "File reference",
  image: "Image reference",
};

/** Turns "Do you smoke?" into "do_you_smoke". */
function toFieldName(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  // Field names must start with a letter.
  return /^[a-z]/.test(base) ? base : `field_${base}`.slice(0, 80);
}

function blankField(existing: BuilderField[]): BuilderField {
  let index = existing.length + 1;
  let fieldName = `question_${index}`;
  while (existing.some((field) => field.fieldName === fieldName)) {
    index += 1;
    fieldName = `question_${index}`;
  }

  return {
    label: `Question ${index}`,
    fieldName,
    type: "text",
    required: false,
    options: [],
    validation: {},
    placeholder: "",
    helpText: "",
    defaultValue: null,
    conditionalLogic: null,
  };
}

export function FormBuilder({
  form,
  canUpdate,
  canSubmit,
  canViewPatients,
}: {
  form: FormDetail;
  canUpdate: boolean;
  canSubmit: boolean;
  canViewPatients: boolean;
}) {
  const toast = useToast();
  const router = useRouter();

  const [fields, setFields] = useState<BuilderField[]>(form.fields);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    form.fields.length > 0 ? 0 : null,
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmVersion, setConfirmVersion] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [tab, setTab] = useState<"build" | "responses">("build");

  const readOnly = !canUpdate || form.status === "archived";
  const selected = selectedIndex !== null ? fields[selectedIndex] : undefined;

  function mutate(next: BuilderField[]) {
    setFields(next);
    setDirty(true);
  }

  function updateField(index: number, patch: Partial<BuilderField>) {
    mutate(
      fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );
  }

  function addField() {
    const next = [...fields, blankField(fields)];
    mutate(next);
    setSelectedIndex(next.length - 1);
  }

  function removeField(index: number) {
    const next = fields.filter((_, i) => i !== index);
    mutate(next);
    setSelectedIndex(next.length === 0 ? null : Math.max(0, index - 1));
  }

  /** Reorder via buttons — keyboard-accessible, unlike drag-and-drop alone. */
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;

    const next = [...fields];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    mutate(next);
    setSelectedIndex(target);
  }

  async function persist() {
    setSaving(true);
    try {
      const result = await api.put<{ newVersion: number | null; message: string }>(
        `/api/forms/${form.id}/fields`,
        {
          fields: fields.map((field) => ({
            label: field.label,
            fieldName: field.fieldName,
            type: field.type,
            required: field.required,
            options: field.options,
            validation: field.validation,
            placeholder: field.placeholder,
            helpText: field.helpText,
            defaultValue: field.defaultValue,
            conditionalLogic: field.conditionalLogic,
          })),
        },
      );

      toast.success(result.message);
      setDirty(false);
      setConfirmVersion(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : "Could not save the fields.",
      );
    } finally {
      setSaving(false);
    }
  }

  function save() {
    // Warn before forking a version, so the consequence is a decision rather
    // than a surprise.
    if (form.editWillCreateVersion) setConfirmVersion(true);
    else void persist();
  }

  async function changeStatus(status: "draft" | "published" | "archived") {
    setPublishing(true);
    try {
      await api.patch(`/api/forms/${form.id}`, { status });
      toast.success(
        status === "published"
          ? "Form published — it can now receive responses."
          : `Form moved to ${status}.`,
      );
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : "Could not change the status.",
      );
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">
              {form.name}
            </h1>
            <Badge
              tone={
                form.status === "published"
                  ? "success"
                  : form.status === "archived"
                    ? "warning"
                    : "neutral"
              }
            >
              <span className="normal-case">{form.status}</span>
            </Badge>
            <Badge tone="gold">
              <span className="normal-case">v{form.currentVersion}</span>
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {form.responseCount} submitted{" "}
            {form.responseCount === 1 ? "response" : "responses"}
            {form.description ? ` · ${form.description}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/forms">
            <Button variant="secondary">Back to forms</Button>
          </Link>
          {canUpdate && form.status === "draft" ? (
            <Button
              variant="secondary"
              loading={publishing}
              onClick={() => void changeStatus("published")}
            >
              Publish
            </Button>
          ) : null}
          {canUpdate && form.status === "published" ? (
            <Button
              variant="secondary"
              loading={publishing}
              onClick={() => void changeStatus("archived")}
            >
              Archive
            </Button>
          ) : null}
          {canUpdate && form.status === "archived" ? (
            <Button
              variant="secondary"
              loading={publishing}
              onClick={() => void changeStatus("draft")}
            >
              Restore to draft
            </Button>
          ) : null}
          {!readOnly ? (
            <Button onClick={save} loading={saving} disabled={!dirty}>
              {dirty ? "Save fields" : "Saved"}
            </Button>
          ) : null}
        </div>
      </div>

      {form.editWillCreateVersion && !readOnly ? (
        <div className="rounded-lg border border-gold-200 bg-gold-50 px-4 py-3 text-sm text-gold-900">
          This version already has responses. Saving changes will create{" "}
          <strong>version {form.currentVersion + 1}</strong> — existing responses
          stay on version {form.currentVersion} and are not altered.
        </div>
      ) : null}

      {form.status === "archived" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This form is archived. It cannot be edited or receive new responses
          until it is restored to draft.
        </div>
      ) : null}

      <div className="flex gap-1 border-b border-ink-200">
        {(["build", "responses"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === value
                ? "border-gold-500 text-gold-800"
                : "border-transparent text-ink-500 hover:text-ink-800",
            )}
          >
            {value === "build" ? "Build" : `Responses (${form.responseCount})`}
          </button>
        ))}
      </div>

      {tab === "responses" ? (
        <FormResponsesPanel
          formId={form.id}
          canSubmit={canSubmit && form.status === "published"}
          canViewPatients={canViewPatients}
          currentVersion={form.currentVersion}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Field list */}
          <Card>
            <CardHeader
              title="Fields"
              description={`${fields.length} ${fields.length === 1 ? "field" : "fields"} in this version`}
              action={
                !readOnly ? (
                  <Button size="sm" onClick={addField}>
                    Add field
                  </Button>
                ) : undefined
              }
            />
            {fields.length === 0 ? (
              <EmptyState
                title="No fields yet"
                description="Add the questions this form should ask."
                action={
                  !readOnly ? (
                    <Button size="sm" onClick={addField}>
                      Add field
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {fields.map((field, index) => (
                  <li
                    key={`${field.fieldName}-${index}`}
                    className={cn(
                      "flex items-center gap-3 px-5 py-3",
                      selectedIndex === index && "bg-gold-50/60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedIndex(index)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium text-ink-900">
                        {field.label}
                        {field.required ? (
                          <span className="ml-1 text-red-600" aria-hidden="true">
                            *
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate font-mono text-xs text-ink-500">
                        {field.fieldName} · {TYPE_LABELS[field.type]}
                        {field.conditionalLogic ? " · conditional" : ""}
                      </p>
                    </button>

                    {!readOnly ? (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          aria-label={`Move ${field.label} up`}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                          className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="m6 15 6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${field.label} down`}
                          disabled={index === fields.length - 1}
                          onClick={() => move(index, 1)}
                          className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${field.label}`}
                          onClick={() => removeField(index)}
                          className="rounded p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Field editor */}
          <Card className="h-fit">
            <CardHeader title="Field settings" />
            <CardBody>
              {!selected || selectedIndex === null ? (
                <p className="text-sm text-ink-500">
                  Select a field to edit its settings.
                </p>
              ) : (
                <FieldSettings
                  field={selected}
                  index={selectedIndex}
                  allFields={fields}
                  readOnly={readOnly}
                  onChange={(patch) => updateField(selectedIndex, patch)}
                />
              )}
            </CardBody>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={confirmVersion}
        onClose={() => setConfirmVersion(false)}
        onConfirm={() => void persist()}
        title={`Create version ${form.currentVersion + 1}?`}
        description={`This form has ${form.responseCount} submitted ${
          form.responseCount === 1 ? "response" : "responses"
        }. Saving creates a new version for future submissions. Existing responses stay on version ${form.currentVersion} and are not modified.`}
        confirmLabel={`Save as v${form.currentVersion + 1}`}
        loading={saving}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function FieldSettings({
  field,
  index,
  allFields,
  readOnly,
  onChange,
}: {
  field: BuilderField;
  index: number;
  allFields: BuilderField[];
  readOnly: boolean;
  onChange: (patch: Partial<BuilderField>) => void;
}) {
  const isChoice = CHOICE_TYPES.includes(field.type);
  const isText = ["text", "textarea"].includes(field.type);
  const isNumber = field.type === "number";

  // A field can only depend on one that appears before it, otherwise the
  // condition could reference an answer the patient has not reached.
  const conditionCandidates = allFields.slice(0, index);

  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Label"
        value={field.label}
        disabled={readOnly}
        onChange={(event) => {
          const label = event.target.value;
          // Keep the machine key in step while it is still auto-derived.
          const wasAuto =
            field.fieldName === toFieldName(field.label) ||
            /^question_\d+$/.test(field.fieldName);
          onChange(
            wasAuto ? { label, fieldName: toFieldName(label) } : { label },
          );
        }}
      />

      <TextField
        label="Field name"
        value={field.fieldName}
        disabled={readOnly}
        onChange={(event) =>
          onChange({ fieldName: event.target.value.toLowerCase() })
        }
        hint="The key answers are stored under. Lowercase, no spaces."
      />

      <SelectField
        label="Type"
        value={field.type}
        disabled={readOnly}
        onChange={(event) => {
          const type = event.target.value as FieldType;
          onChange({
            type,
            // Options are meaningless outside the choice types.
            options: CHOICE_TYPES.includes(type) ? field.options : [],
          });
        }}
        options={FIELD_TYPES.map((type) => ({
          value: type,
          label: TYPE_LABELS[type],
        }))}
      />

      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={field.required}
          disabled={readOnly}
          onChange={(event) => onChange({ required: event.target.checked })}
          className="h-4 w-4 rounded border-ink-300 accent-gold-500"
        />
        Required
      </label>

      <TextField
        label="Placeholder"
        value={field.placeholder}
        disabled={readOnly}
        onChange={(event) => onChange({ placeholder: event.target.value })}
      />

      <TextField
        label="Help text"
        value={field.helpText}
        disabled={readOnly}
        onChange={(event) => onChange({ helpText: event.target.value })}
      />

      {isChoice ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ink-800">Options</p>
            {!readOnly ? (
              <button
                type="button"
                onClick={() =>
                  onChange({
                    options: [...field.options, { label: "", value: "" }],
                  })
                }
                className="text-xs font-medium text-gold-700 hover:text-gold-800"
              >
                Add option
              </button>
            ) : null}
          </div>

          {field.options.length === 0 ? (
            <p className="text-xs text-red-600">
              Choice fields need at least one option.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {field.options.map((option, optionIndex) => (
                <div key={optionIndex} className="flex items-center gap-2">
                  <input
                    aria-label={`Option ${optionIndex + 1} label`}
                    value={option.label}
                    disabled={readOnly}
                    placeholder="Label"
                    onChange={(event) => {
                      const label = event.target.value;
                      onChange({
                        options: field.options.map((o, i) =>
                          i === optionIndex
                            ? {
                                label,
                                // Derive the stored value from the label until
                                // it has been edited by hand.
                                value:
                                  o.value === "" || o.value === toFieldName(o.label)
                                    ? toFieldName(label)
                                    : o.value,
                              }
                            : o,
                        ),
                      });
                    }}
                    className="h-9 w-1/2 rounded-lg border border-ink-200 px-2.5 text-sm hover:border-ink-300 focus:border-gold-500 disabled:bg-ink-50"
                  />
                  <input
                    aria-label={`Option ${optionIndex + 1} value`}
                    value={option.value}
                    disabled={readOnly}
                    placeholder="value"
                    onChange={(event) =>
                      onChange({
                        options: field.options.map((o, i) =>
                          i === optionIndex
                            ? { ...o, value: event.target.value }
                            : o,
                        ),
                      })
                    }
                    className="h-9 flex-1 rounded-lg border border-ink-200 px-2.5 font-mono text-xs hover:border-ink-300 focus:border-gold-500 disabled:bg-ink-50"
                  />
                  {!readOnly ? (
                    <button
                      type="button"
                      aria-label={`Remove option ${optionIndex + 1}`}
                      onClick={() =>
                        onChange({
                          options: field.options.filter(
                            (_, i) => i !== optionIndex,
                          ),
                        })
                      }
                      className="rounded p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {isText || isNumber ? (
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={isNumber ? "Minimum" : "Min length"}
            type="number"
            disabled={readOnly}
            value={String(
              (isNumber ? field.validation.min : field.validation.minLength) ?? "",
            )}
            onChange={(event) => {
              const raw = event.target.value;
              const value = raw === "" ? null : Number(raw);
              onChange({
                validation: {
                  ...field.validation,
                  [isNumber ? "min" : "minLength"]: value,
                },
              });
            }}
          />
          <TextField
            label={isNumber ? "Maximum" : "Max length"}
            type="number"
            disabled={readOnly}
            value={String(
              (isNumber ? field.validation.max : field.validation.maxLength) ?? "",
            )}
            onChange={(event) => {
              const raw = event.target.value;
              const value = raw === "" ? null : Number(raw);
              onChange({
                validation: {
                  ...field.validation,
                  [isNumber ? "max" : "maxLength"]: value,
                },
              });
            }}
          />
        </div>
      ) : null}

      {/* Conditional display */}
      <div className="rounded-lg border border-ink-200 px-3.5 py-3">
        <p className="mb-2 text-sm font-medium text-ink-800">
          Show only when…
        </p>

        {conditionCandidates.length === 0 ? (
          <p className="text-xs text-ink-500">
            Add a field above this one to make it conditional.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <select
              aria-label="Condition field"
              value={field.conditionalLogic?.fieldName ?? ""}
              disabled={readOnly}
              onChange={(event) =>
                onChange({
                  conditionalLogic: event.target.value
                    ? {
                        fieldName: event.target.value,
                        operator: field.conditionalLogic?.operator ?? "equals",
                        value: field.conditionalLogic?.value ?? "",
                      }
                    : null,
                })
              }
              className="h-9 rounded-lg border border-ink-200 px-2.5 text-sm hover:border-ink-300 focus:border-gold-500 disabled:bg-ink-50"
            >
              <option value="">Always show</option>
              {conditionCandidates.map((candidate) => (
                <option key={candidate.fieldName} value={candidate.fieldName}>
                  {candidate.label}
                </option>
              ))}
            </select>

            {field.conditionalLogic ? (
              <>
                <select
                  aria-label="Condition operator"
                  value={field.conditionalLogic.operator}
                  disabled={readOnly}
                  onChange={(event) =>
                    onChange({
                      conditionalLogic: {
                        ...field.conditionalLogic!,
                        operator: event.target.value as ConditionOperator,
                      },
                    })
                  }
                  className="h-9 rounded-lg border border-ink-200 px-2.5 text-sm hover:border-ink-300 focus:border-gold-500 disabled:bg-ink-50"
                >
                  <option value="equals">equals</option>
                  <option value="not_equals">does not equal</option>
                  <option value="contains">contains</option>
                  <option value="is_not_empty">is answered</option>
                  <option value="is_empty">is not answered</option>
                </select>

                {!["is_empty", "is_not_empty"].includes(
                  field.conditionalLogic.operator,
                ) ? (
                  <input
                    aria-label="Condition value"
                    value={String(field.conditionalLogic.value ?? "")}
                    disabled={readOnly}
                    placeholder="Value"
                    onChange={(event) =>
                      onChange({
                        conditionalLogic: {
                          ...field.conditionalLogic!,
                          value: event.target.value,
                        },
                      })
                    }
                    className="h-9 rounded-lg border border-ink-200 px-2.5 text-sm hover:border-ink-300 focus:border-gold-500 disabled:bg-ink-50"
                  />
                ) : null}

                <p className="text-xs text-ink-500">
                  A hidden field is never required, so this will not block
                  submission.
                </p>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
