"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  ComboField,
  EmailField,
  PhoneField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import { RELATIONSHIP_SUGGESTIONS } from "@/lib/domain/suggestions";
import { createPatientSchema } from "@/schemas/patient.schema";

export type PatientRecord = {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  email: string;
  dateOfBirth: string | null;
  age: number | null;
  gender: string;
  address: string;
  emergencyContact: { name: string; relationship: string; phone: string };
  notes: string;
  createdAt: string;
};

const GENDER_OPTIONS = [
  { value: "prefer_not_to_say", label: "Prefer not to say" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
];

type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  gender: string;
  address: string;
  notes: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
};

type FormKey = keyof FormState;

/**
 * Form control → path in the submitted payload.
 *
 * The emergency contact is three flat inputs here but a nested object on the
 * wire, and the server reports its failures under the nested path, so this one
 * map resolves both client-side and server-side errors back to a control.
 */
const FIELD_PATHS: Record<FormKey, string> = {
  firstName: "firstName",
  lastName: "lastName",
  phone: "phone",
  email: "email",
  dateOfBirth: "dateOfBirth",
  gender: "gender",
  address: "address",
  notes: "notes",
  emergencyName: "emergencyContact.name",
  emergencyRelationship: "emergencyContact.relationship",
  emergencyPhone: "emergencyContact.phone",
};

function buildPayload(form: FormState) {
  return {
    firstName: form.firstName,
    lastName: form.lastName,
    phone: form.phone,
    email: form.email,
    dateOfBirth: form.dateOfBirth,
    gender: form.gender,
    address: form.address,
    notes: form.notes,
    emergencyContact: {
      name: form.emergencyName,
      relationship: form.emergencyRelationship,
      phone: form.emergencyPhone,
    },
  };
}

/**
 * Validates with the SAME schema the API parses, imported rather than restated
 * so the two cannot drift apart. This is a convenience for the person typing,
 * never a control: the server re-validates every field regardless, and nothing
 * here can be relied upon to have run.
 *
 * `createPatientSchema` is used for edits too. The form always submits every
 * field, and a patient needs a name and a phone number whether the record is
 * being created or corrected — `updatePatientSchema` only differs in allowing
 * fields to be absent, which never happens from this form.
 */
function validate(form: FormState): Record<string, string> {
  const result = createPatientSchema.safeParse(buildPayload(form));
  if (result.success) return {};

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    // First message per field wins, matching how the API reports them.
    if (path && !(path in errors)) errors[path] = issue.message;
  }
  return errors;
}

/**
 * Shared create/edit form, used by both the patients list and the patient
 * detail page so the two cannot drift apart.
 */
export function PatientFormModal({
  patient,
  onClose,
  onSaved,
}: {
  patient: PatientRecord | null;
  onClose: () => void;
  onSaved: (patient: PatientRecord) => void | Promise<void>;
}) {
  const toast = useToast();
  const editing = patient !== null;

  const [form, setForm] = useState<FormState>({
    firstName: patient?.firstName ?? "",
    lastName: patient?.lastName ?? "",
    phone: patient?.phone ?? "",
    email: patient?.email ?? "",
    dateOfBirth: patient?.dateOfBirth ?? "",
    gender: patient?.gender ?? "prefer_not_to_say",
    address: patient?.address ?? "",
    notes: patient?.notes ?? "",
    emergencyName: patient?.emergencyContact.name ?? "",
    emergencyRelationship: patient?.emergencyContact.relationship ?? "",
    emergencyPhone: patient?.emergencyContact.phone ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Partial<Record<FormKey, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const clientErrors = useMemo(() => validate(form), [form]);

  function update(field: FormKey, value: string) {
    setForm((current) => ({ ...current, [field]: value }));

    // A server error describes the value that was sent. Once the field changes
    // it no longer applies, and the live client-side check takes over.
    setServerErrors((current) => {
      const path = FIELD_PATHS[field];
      if (!(path in current)) return current;
      const next = { ...current };
      delete next[path];
      return next;
    });
  }

  function markTouched(field: FormKey) {
    setTouched((current) =>
      current[field] ? current : { ...current, [field]: true },
    );
  }

  /**
   * A field shows its error once it has been left, or once submit has been
   * attempted — never while it is still being filled in for the first time,
   * which would greet an empty form with a wall of red.
   */
  function errorFor(field: FormKey): string | undefined {
    const path = FIELD_PATHS[field];
    return (
      serverErrors[path] ??
      (submitAttempted || touched[field] ? clientErrors[path] : undefined)
    );
  }

  async function save() {
    setSubmitAttempted(true);
    // Reveals every outstanding message rather than sending a request that is
    // already known to fail.
    if (Object.keys(clientErrors).length > 0) return;

    setSaving(true);
    setServerErrors({});

    try {
      const payload = buildPayload(form);
      const saved = editing
        ? await api.patch<PatientRecord>(`/api/patients/${patient.id}`, payload)
        : await api.post<PatientRecord>("/api/patients", payload);

      toast.success(
        editing
          ? `${saved.fullName} updated.`
          : `${saved.fullName} registered as ${saved.patientNumber}.`,
      );
      await onSaved(saved);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setServerErrors(err.fields);
        if (Object.keys(err.fields).length === 0) toast.error(err.message);
      } else {
        toast.error("Could not save the patient.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit ${patient.fullName}` : "Register a patient"}
      description={
        editing
          ? `Patient number ${patient.patientNumber}`
          : "A patient number is assigned automatically."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {/*
            Deliberately not disabled while the form is incomplete: a dead
            button explains nothing. Clicking it surfaces exactly which fields
            need attention.
          */}
          <Button onClick={() => void save()} loading={saving}>
            {editing ? "Save changes" : "Register patient"}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            value={form.firstName}
            onChange={(event) => update("firstName", event.target.value)}
            onBlur={() => markTouched("firstName")}
            error={errorFor("firstName")}
            maxLength={100}
            autoComplete="off"
            required
          />
          <TextField
            label="Last name"
            value={form.lastName}
            onChange={(event) => update("lastName", event.target.value)}
            onBlur={() => markTouched("lastName")}
            error={errorFor("lastName")}
            maxLength={100}
            autoComplete="off"
            required
          />
          <PhoneField
            label="Phone"
            value={form.phone}
            onChange={(val) => update("phone", val)}
            onBlur={() => markTouched("phone")}
            error={errorFor("phone")}
            required
          />
          <EmailField
            label="Email"
            value={form.email}
            onChange={(event) => update("email", event.target.value)}
            onBlur={() => markTouched("email")}
            error={errorFor("email")}
            required
          />
          <TextField
            label="Date of birth"
            type="date"
            value={form.dateOfBirth}
            onChange={(event) => update("dateOfBirth", event.target.value)}
            onBlur={() => markTouched("dateOfBirth")}
            error={errorFor("dateOfBirth")}
            // Stops the picker offering a future date at all; the schema
            // rejects one anyway if it is typed in.
            max={new Date().toISOString().slice(0, 10)}
          />
          <SelectField
            label="Gender"
            value={form.gender}
            onChange={(event) => update("gender", event.target.value)}
            error={errorFor("gender")}
            options={GENDER_OPTIONS}
          />
        </div>

        <TextAreaField
          label="Address"
          rows={2}
          value={form.address}
          onChange={(event) => update("address", event.target.value)}
          onBlur={() => markTouched("address")}
          error={errorFor("address")}
          maxLength={300}
        />

        <fieldset className="rounded-lg border border-ink-200 px-3.5 py-3">
          <legend className="px-1 text-sm font-medium text-ink-800">
            Emergency contact
          </legend>
          <div className="mt-1 grid gap-3 sm:grid-cols-2">
            <TextField
              label="Name"
              value={form.emergencyName}
              onChange={(event) => update("emergencyName", event.target.value)}
              onBlur={() => markTouched("emergencyName")}
              error={errorFor("emergencyName")}
              maxLength={150}
            />
            {/*
              A combobox, not a select: "Guardian", "Neighbour" and every
              family term the list omits must stay typeable. The suggestions
              are a shortcut, never the allowed set.
            */}
            <ComboField
              label="Relationship"
              value={form.emergencyRelationship}
              onValueChange={(value) => update("emergencyRelationship", value)}
              onBlur={() => markTouched("emergencyRelationship")}
              error={errorFor("emergencyRelationship")}
              suggestions={RELATIONSHIP_SUGGESTIONS}
              placeholder="e.g. Spouse"
              maxLength={80}
            />
            <div className="sm:col-span-2">
              <PhoneField
                label="Phone"
                value={form.emergencyPhone}
                onChange={(val) => update("emergencyPhone", val)}
                onBlur={() => markTouched("emergencyPhone")}
                error={errorFor("emergencyPhone")}
              />
            </div>
          </div>
        </fieldset>

        <TextAreaField
          label="Notes"
          rows={3}
          value={form.notes}
          onChange={(event) => update("notes", event.target.value)}
          onBlur={() => markTouched("notes")}
          error={errorFor("notes")}
          maxLength={2000}
          hint="Administrative notes only. Clinical findings belong on a visit record."
        />
      </div>
    </Modal>
  );
}
