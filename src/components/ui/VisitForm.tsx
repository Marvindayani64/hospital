"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";

export type VisitRecord = {
  id: string;
  patient: { id: string; name: string; patientNumber: string } | null;
  doctor: { id: string; name: string } | null;
  appointmentId: string | null;
  treatment: { id: string; name: string } | null;
  visitDate: string;
  symptoms: string;
  diagnosis: string;
  notes: string;
  recommendations: string;
  followUpDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VisitOption = { id: string; name: string };
export type VisitPatientOption = VisitOption & { patientNumber: string };

/**
 * Prefill for a visit being written up straight from its booking.
 *
 * A visit is NOT created when an appointment completes — the consultation is
 * written up afterwards, which is why `visitDate` is a field of its own rather
 * than the record's `createdAt`. This carries the booking's details across so
 * the clinician is not re-entering what the system already knows, and supplies
 * the `appointmentId` that links the two.
 */
export type VisitAppointmentSource = {
  id: string;
  patient: { id: string; name: string; patientNumber: string };
  doctorId: string;
  treatmentId: string;
  visitDate: string;
};

/**
 * Shared create/edit form, used by the visits list and by "Record visit" on a
 * completed appointment, so the two cannot drift apart.
 *
 * Treatment, symptoms, diagnosis and recommendations are all optional — a
 * consultation may be recorded with none of them filled in. Only the patient,
 * the doctor and the date are required.
 *
 * Notes and the follow-up date are deliberately NOT collected here. They still
 * exist on the model, in the schemas and on stored records, and the read-only
 * view still displays them; this form simply does not capture them.
 *
 * That is why the payloads below omit those keys rather than sending empty
 * values: every field in `updateVisitSchema` is applied only when it is
 * `!== undefined`, so omitting preserves whatever a record already holds.
 * Sending `""` would silently erase existing content on every save.
 */
export function VisitFormModal({
  visit,
  fromAppointment = null,
  patients,
  doctors,
  treatments,
  defaultDate,
  onClose,
  onSaved,
}: {
  visit: VisitRecord | null;
  fromAppointment?: VisitAppointmentSource | null;
  patients: VisitPatientOption[];
  doctors: VisitOption[];
  treatments: VisitOption[];
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const editing = visit !== null;

  /**
   * The patient is fixed both when editing (moving a clinical record to another
   * patient is never a legitimate correction) and when recording against an
   * appointment (the booking already determines whose record this is — and the
   * server rejects an appointment belonging to a different patient anyway).
   */
  const lockedPatient = visit?.patient ?? fromAppointment?.patient ?? null;
  const patientLocked = editing || fromAppointment !== null;

  const [patientId, setPatientId] = useState(
    visit?.patient?.id ?? fromAppointment?.patient.id ?? "",
  );
  const [doctorId, setDoctorId] = useState(
    visit?.doctor?.id ?? fromAppointment?.doctorId ?? "",
  );
  const [treatmentId, setTreatmentId] = useState(
    visit?.treatment?.id ?? fromAppointment?.treatmentId ?? "",
  );
  const [visitDate, setVisitDate] = useState(
    visit?.visitDate ?? fromAppointment?.visitDate ?? defaultDate,
  );
  const [symptoms, setSymptoms] = useState(visit?.symptoms ?? "");
  const [diagnosis, setDiagnosis] = useState(visit?.diagnosis ?? "");
  const [recommendations, setRecommendations] = useState(
    visit?.recommendations ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const payload = {
      doctorId,
      treatmentId: treatmentId || null,
      visitDate,
      symptoms,
      diagnosis,
      recommendations,
    };

    try {
      if (editing && visit) {
        await api.patch(`/api/visits/${visit.id}`, payload);
        toast.success("Visit updated.");
      } else {
        await api.post("/api/visits", {
          ...payload,
          patientId,
          // Null for a walk-in; the server stores an explicit null and the
          // partial unique index keeps one visit per appointment.
          appointmentId: fromAppointment?.id ?? null,
        });
        toast.success("Visit recorded.");
      }
      await onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        if (Object.keys(err.fields).length === 0) setFormError(err.message);
      } else {
        setFormError("Could not save the visit.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Edit visit" : "Record a visit"}
      description={
        editing
          ? "The patient and originating appointment cannot be changed."
          : fromAppointment
            ? "Linked to the selected appointment. Details are prefilled from the booking."
            : "Record the consultation against a patient."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!patientId || !doctorId || !visitDate}
          >
            {editing ? "Save changes" : "Record visit"}
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

        {patientLocked ? (
          <div className="rounded-lg border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Patient
            </p>
            <p className="mt-0.5 text-ink-900">
              {lockedPatient?.name} ({lockedPatient?.patientNumber})
            </p>
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
                label: `${patient.name} (${patient.patientNumber})`,
              })),
            ]}
            required
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Doctor"
            value={doctorId}
            onChange={(event) => setDoctorId(event.target.value)}
            error={fieldErrors.doctorId}
            options={[
              { value: "", label: "Select a doctor" },
              ...doctors.map((doctor) => ({
                value: doctor.id,
                label: doctor.name,
              })),
            ]}
            required
          />
          <TextField
            label="Visit date"
            type="date"
            value={visitDate}
            onChange={(event) => setVisitDate(event.target.value)}
            error={fieldErrors.visitDate}
            required
          />
        </div>

        {/* All four below are optional — a consultation can be recorded with
            none of them completed. */}
        <SelectField
          label="Treatment"
          value={treatmentId}
          onChange={(event) => setTreatmentId(event.target.value)}
          error={fieldErrors.treatmentId}
          options={[
            { value: "", label: "None" },
            ...treatments.map((treatment) => ({
              value: treatment.id,
              label: treatment.name,
            })),
          ]}
          hint="Optional."
        />

        <TextAreaField
          label="Symptoms"
          rows={3}
          value={symptoms}
          onChange={(event) => setSymptoms(event.target.value)}
          error={fieldErrors.symptoms}
          placeholder="Presenting complaint and history."
          maxLength={4000}
          hint="Optional."
        />

        <TextAreaField
          label="Diagnosis"
          rows={3}
          value={diagnosis}
          onChange={(event) => setDiagnosis(event.target.value)}
          error={fieldErrors.diagnosis}
          maxLength={4000}
          hint="Optional."
        />

        <TextAreaField
          label="Recommendations"
          rows={3}
          value={recommendations}
          onChange={(event) => setRecommendations(event.target.value)}
          error={fieldErrors.recommendations}
          placeholder="Treatment plan, prescriptions, advice."
          maxLength={4000}
          hint="Optional."
        />
      </div>
    </Modal>
  );
}
