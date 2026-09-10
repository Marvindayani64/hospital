"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import type { PrescriptionStatus } from "@/lib/domain/enums";

export type PrescriptionItem = {
  drugName: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
};

export type PrescriptionRecord = {
  id: string;
  patient: {
    id: string;
    name: string;
    patientNumber: string;
    phone: string;
  } | null;
  doctor: { id: string; name: string } | null;
  visitId: string;
  prescribedDate: string;
  items: PrescriptionItem[];
  notes: string;
  status: PrescriptionStatus;
  dispensedBy: { id: string; name: string } | null;
  dispensedAt: string | null;
  dispensingNotes: string;
  createdAt: string;
  updatedAt: string;
};

/** An appointment this prescription can be written against. */
export type PrescriptionAppointmentOption = {
  id: string;
  label: string;
};

const EMPTY_ITEM: PrescriptionItem = {
  drugName: "",
  dosage: "",
  frequency: "",
  duration: "",
  instructions: "",
};

/**
 * Writing a prescription for one patient.
 *
 * The patient is always fixed — this is only ever opened from their record, and
 * choosing the wrong person from a dropdown is precisely the mistake worth
 * designing out.
 *
 * There is no prescriber field either. The doctor writing the prescription is
 * the prescriber, so the server takes it from the session; a picker would only
 * offer the chance to put someone else's name on it.
 *
 * There is no edit mode. A prescription's drugs are immutable once written: a
 * mistake is withdrawn from the pharmacy queue and rewritten, so what was
 * originally prescribed stays on the record.
 */
export function PrescriptionFormModal({
  patient,
  prescriber,
  appointments,
  defaultAppointmentId,
  defaultDate,
  onClose,
  onSaved,
}: {
  patient: { id: string; name: string; patientNumber: string };
  /**
   * The signed-in user's own doctor profile. Null when their account is not
   * linked to one — they cannot prescribe, and the form says so instead of
   * letting them fill it in and fail on save.
   */
  prescriber: { id: string; name: string } | null;
  appointments: PrescriptionAppointmentOption[];
  defaultAppointmentId: string;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();

  const [appointmentId, setAppointmentId] = useState(defaultAppointmentId);
  const [prescribedDate, setPrescribedDate] = useState(defaultDate);
  const [items, setItems] = useState<PrescriptionItem[]>([{ ...EMPTY_ITEM }]);
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function updateItem(index: number, patch: Partial<PrescriptionItem>) {
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  const filledItems = items.filter((item) => item.drugName.trim() !== "");

  async function save() {
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    try {
      await api.post("/api/prescriptions", {
        patientId: patient.id,
        // No prescriber: the server takes it from the session.
        appointmentId: appointmentId || null,
        prescribedDate,
        // Blank rows are scaffolding, not drugs — the doctor added a row and
        // did not use it.
        items: filledItems,
        diagnosis,
        notes,
      });
      toast.success("Prescription sent to the pharmacy.");
      await onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        if (Object.keys(err.fields).length === 0) setFormError(err.message);
      } else {
        setFormError("Could not save the prescription.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Write a prescription"
      description={
        prescriber
          ? `${patient.name} (${patient.patientNumber}) · signed by ${prescriber.name} · the consultation is recorded automatically.`
          : `${patient.name} (${patient.patientNumber})`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={
              !prescriber || !prescribedDate || filledItems.length === 0
            }
          >
            Send to pharmacy
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

        {/* Nothing to fill in for the prescriber — the server works it out, and
            the header says who it will be. This only fires for a patient who
            has never been booked with anyone, written by an account with no
            doctor profile: there is genuinely no one to sign it. */}
        {prescriber ? null : (
          <div
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900"
          >
            There is no doctor to sign this prescription. Book this patient an
            appointment first, or ask a hospital admin to link your account to a
            doctor profile.
          </div>
        )}

        <div className="sm:max-w-xs">
          <TextField
            label="Date"
            type="date"
            value={prescribedDate}
            onChange={(event) => setPrescribedDate(event.target.value)}
            error={fieldErrors.prescribedDate}
            required
          />
        </div>

        {appointments.length > 0 ? (
          <SelectField
            label="Appointment"
            value={appointmentId}
            onChange={(event) => setAppointmentId(event.target.value)}
            error={fieldErrors.appointmentId}
            options={[
              { value: "", label: "Walk-in — no booking" },
              ...appointments.map((appointment) => ({
                value: appointment.id,
                label: appointment.label,
              })),
            ]}
            hint="Links the recorded consultation to the booking it came from."
          />
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink-800">
              Drugs
              <span className="ml-0.5 text-red-600" aria-hidden="true">
                *
              </span>
            </p>
            {fieldErrors.items ? (
              <p role="alert" className="text-xs font-medium text-red-600">
                {fieldErrors.items}
              </p>
            ) : null}
          </div>

          {items.map((item, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 rounded-lg border border-ink-200 p-3.5"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <TextField
                    label={`Drug ${index + 1}`}
                    value={item.drugName}
                    onChange={(event) =>
                      updateItem(index, { drugName: event.target.value })
                    }
                    placeholder="e.g. Amoxicillin"
                    maxLength={200}
                    required
                  />
                </div>
                {items.length > 1 ? (
                  <div className="pt-7">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setItems((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                      aria-label={`Remove drug ${index + 1}`}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <TextField
                  label="Dosage"
                  value={item.dosage}
                  onChange={(event) =>
                    updateItem(index, { dosage: event.target.value })
                  }
                  placeholder="500mg"
                  maxLength={100}
                />
                <TextField
                  label="Frequency"
                  value={item.frequency}
                  onChange={(event) =>
                    updateItem(index, { frequency: event.target.value })
                  }
                  placeholder="Twice daily"
                  maxLength={100}
                />
                <TextField
                  label="Duration"
                  value={item.duration}
                  onChange={(event) =>
                    updateItem(index, { duration: event.target.value })
                  }
                  placeholder="5 days"
                  maxLength={100}
                />
              </div>

              <TextField
                label="Instructions"
                value={item.instructions}
                onChange={(event) =>
                  updateItem(index, { instructions: event.target.value })
                }
                placeholder="After food"
                maxLength={500}
                hint="Optional."
              />
            </div>
          ))}

          <div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setItems((current) => [...current, { ...EMPTY_ITEM }])}
              disabled={items.length >= 30}
            >
              Add another drug
            </Button>
          </div>
        </div>

        <TextAreaField
          label="Diagnosis"
          rows={3}
          value={diagnosis}
          onChange={(event) => setDiagnosis(event.target.value)}
          error={fieldErrors.diagnosis}
          maxLength={4000}
          hint="Recorded on the consultation, not sent to the pharmacy. Optional."
        />

        <TextAreaField
          label="Note to pharmacy"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          error={fieldErrors.notes}
          placeholder="Substitutions, counselling points, urgency."
          maxLength={2000}
          hint="Optional."
        />
      </div>
    </Modal>
  );
}

type PrescriptionContext = {
  prescriber: { id: string; name: string } | null;
  appointments: PrescriptionAppointmentOption[];
};

/**
 * Opens the prescribe dialog for a patient whose prescriber and bookings are
 * not already loaded — the patients LIST, where fetching them for every row
 * would be wasted on the rows nobody clicks.
 *
 * The patient record passes its own already-loaded context straight to
 * PrescriptionFormModal instead; both end up in the same form.
 */
export function PrescriptionLauncher({
  patient,
  today,
  onClose,
  onSaved,
}: {
  patient: { id: string; name: string; patientNumber: string };
  today: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [context, setContext] = useState<PrescriptionContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    api
      .get<PrescriptionContext>(
        `/api/patients/${patient.id}/prescription-context`,
        controller.signal,
      )
      .then(setContext)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not open the prescription form.",
        );
      });

    return () => controller.abort();
  }, [patient.id]);

  if (error) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Write a prescription"
        description={`${patient.name} (${patient.patientNumber})`}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      </Modal>
    );
  }

  // Held back until the prescriber is known, so the header never renders
  // without the name it is about to sign with.
  if (!context) return null;

  return (
    <PrescriptionFormModal
      patient={patient}
      prescriber={context.prescriber}
      appointments={context.appointments}
      defaultAppointmentId={context.appointments[0]?.id ?? ""}
      defaultDate={today}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
