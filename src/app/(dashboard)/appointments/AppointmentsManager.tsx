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
import {
  APPOINTMENT_STATUS_TONES,
  NEXT_STATUSES,
  statusLabel,
} from "@/components/ui/appointment-status";
import { VisitFormModal } from "@/components/ui/VisitForm";
import { ApiClientError, api } from "@/lib/client/api";
import type { AppointmentStatus } from "@/models/Appointment";
import type { Paginated } from "@/types";

type Appointment = {
  id: string;
  patient: { id: string; name: string; patientNumber: string; phone: string } | null;
  doctor: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  treatment: { id: string; name: string } | null;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  status: AppointmentStatus;
  notes: string;
  cancellationReason: string;
  createdAt: string;
};

type Option = { id: string; name: string };
type PatientOption = Option & { patientNumber: string; phone: string };
type TreatmentOption = Option & {
  department: { id: string; name: string } | null;
  durationMinutes: number;
};
/** A doctor may work across several departments (Section 20), hence a list. */
type DoctorOption = Option & { departmentIds: string[] };

/**
 * Doctors bookable under a department.
 *
 * A doctor with NO departments recorded stays bookable everywhere. That
 * mirrors how availability is treated in `appointment.service.ts`: an empty
 * list means "no constraint recorded", not "never available", so a hospital
 * that has not assigned its doctors to departments is not locked out of
 * booking entirely.
 */
function doctorsForDepartment(
  doctors: DoctorOption[],
  departmentId: string,
): DoctorOption[] {
  if (!departmentId) return doctors;
  return doctors.filter(
    (doctor) =>
      doctor.departmentIds.length === 0 ||
      doctor.departmentIds.includes(departmentId),
  );
}

const PAGE_SIZE = 20;

export function AppointmentsManager({
  today,
  canCreate,
  canUpdate,
  canCancel,
  canCreateVisits,
  canViewPatients,
  canViewDoctors,
  canViewDepartments,
  canViewTreatments,
}: {
  today: string;
  canCreate: boolean;
  canUpdate: boolean;
  canCancel: boolean;
  canCreateVisits: boolean;
  canViewPatients: boolean;
  canViewDoctors: boolean;
  canViewDepartments: boolean;
  canViewTreatments: boolean;
}) {
  const toast = useToast();

  /**
   * Whether this viewer has any action at all on a booking. False for a
   * read-only role, and the Actions column is dropped rather than rendered
   * empty for every row.
   */
  const showActions = canUpdate || canCancel || canCreateVisits;

  const [data, setData] = useState<Paginated<Appointment> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [page, setPage] = useState(1);

  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [treatments, setTreatments] = useState<TreatmentOption[]>([]);

  const [booking, setBooking] = useState<Appointment | "new" | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [recordingVisit, setRecordingVisit] = useState<Appointment | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (statusFilter) params.set("status", statusFilter);
      if (doctorFilter) params.set("doctorId", doctorFilter);

      try {
        setData(
          await api.get<Paginated<Appointment>>(
            `/api/appointments?${params}`,
            signal,
          ),
        );
      } catch (err) {
        if (signal?.aborted) return;
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load appointments.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, from, to, statusFilter, doctorFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Reference data for the booking form. Each is fetched only if the user may
  // read it; the form explains any gap rather than failing silently.
  useEffect(() => {
    const controller = new AbortController();

    if (canViewPatients) {
      api
        .get<Paginated<{ id: string; fullName: string; patientNumber: string; phone: string }>>(
          "/api/patients?pageSize=100",
          controller.signal,
        )
        .then((result) =>
          setPatients(
            result.items.map((patient) => ({
              id: patient.id,
              name: patient.fullName,
              patientNumber: patient.patientNumber,
              phone: patient.phone,
            })),
          ),
        )
        .catch(() => setPatients([]));
    }

    if (canViewDoctors) {
      api
        .get<
          Paginated<{
            id: string;
            displayName: string;
            status: string;
            departments: Array<{ id: string; name: string }>;
          }>
        >("/api/doctors?pageSize=100&status=active", controller.signal)
        .then((result) =>
          setDoctors(
            result.items.map((doctor) => ({
              id: doctor.id,
              name: doctor.displayName,
              departmentIds: (doctor.departments ?? []).map((d) => d.id),
            })),
          ),
        )
        .catch(() => setDoctors([]));
    }

    if (canViewDepartments) {
      api
        .get<Paginated<Option>>(
          "/api/departments?pageSize=100&status=active",
          controller.signal,
        )
        .then((result) => setDepartments(result.items))
        .catch(() => setDepartments([]));
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
  }, [canViewPatients, canViewDoctors, canViewDepartments, canViewTreatments]);

  async function changeStatus(
    appointment: Appointment,
    status: AppointmentStatus,
  ) {
    setWorking(true);
    try {
      await api.put(`/api/appointments/${appointment.id}`, { status });
      toast.success(`Marked as ${statusLabel(status)}.`);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Could not update the appointment.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function confirmCancel() {
    if (!cancelling) return;
    setWorking(true);
    try {
      await api.put(`/api/appointments/${cancelling.id}`, {
        status: "cancelled",
        cancellationReason: cancelReason,
      });
      toast.success("Appointment cancelled.");
      setCancelling(null);
      setCancelReason("");
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Could not cancel the appointment.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-ink-200 px-5 py-3.5">
          <div>
            <label
              htmlFor="from-date"
              className="mb-1 block text-xs font-medium text-ink-600"
            >
              From
            </label>
            <input
              id="from-date"
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
              htmlFor="to-date"
              className="mb-1 block text-xs font-medium text-ink-600"
            >
              To
            </label>
            <input
              id="to-date"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
              className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
            />
          </div>

          <div>
            <label
              htmlFor="appt-status"
              className="mb-1 block text-xs font-medium text-ink-600"
            >
              Status
            </label>
            <select
              id="appt-status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
              className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
            >
              <option value="">All statuses</option>
              {Object.keys(NEXT_STATUSES).map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </div>

          {doctors.length > 0 ? (
            <div>
              <label
                htmlFor="appt-doctor"
                className="mb-1 block text-xs font-medium text-ink-600"
              >
                Doctor
              </label>
              <select
                id="appt-doctor"
                value={doctorFilter}
                onChange={(event) => {
                  setDoctorFilter(event.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-lg border border-ink-200 bg-white px-3 text-sm hover:border-ink-300 focus:border-gold-500"
              >
                <option value="">All doctors</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="ml-auto flex items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFrom("");
                setTo("");
                setStatusFilter("");
                setDoctorFilter("");
                setPage(1);
              }}
            >
              Clear
            </Button>
            {data ? (
              <p className="text-xs text-ink-500">{data.total} total</p>
            ) : null}
            {canCreate ? (
              <Button size="sm" onClick={() => setBooking("new")}>
                Book appointment
              </Button>
            ) : null}
          </div>
        </div>

        {loading && !data ? (
          <TableSkeleton rows={6} columns={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No appointments found"
            description={
              from || to || statusFilter || doctorFilter
                ? "Try widening the date range or clearing the filters."
                : "Book the first appointment to get started."
            }
            action={
              canCreate && !from && !to && !statusFilter && !doctorFilter ? (
                <Button size="sm" onClick={() => setBooking("new")}>
                  Book appointment
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">When</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Patient</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Doctor</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Service</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                  {/* Every control in this column is a write. A reader — the
                      Hospital Admin, say — would get an empty column and a
                      heading promising something that never appears. */}
                  {showActions ? (
                    <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                      Actions
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((appointment) => {
                  const nextStatuses = NEXT_STATUSES[appointment.status];

                  return (
                    <tr key={appointment.id} className="hover:bg-ink-50/60">
                      <td className="px-5 py-3">
                        <p className="font-medium tabular-nums text-ink-900">
                          {appointment.appointmentDate}
                        </p>
                        <p className="text-xs tabular-nums text-ink-500">
                          {appointment.startTime}–{appointment.endTime}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        {appointment.patient ? (
                          <>
                            <Link
                              href={`/patients/${appointment.patient.id}`}
                              className="text-ink-900 hover:text-gold-700"
                            >
                              {appointment.patient.name}
                            </Link>
                            <p className="font-mono text-xs text-ink-500">
                              {appointment.patient.patientNumber}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-ink-600">
                        {appointment.doctor?.name ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-ink-600">
                        <p>{appointment.treatment?.name ?? "Consultation"}</p>
                        <p className="text-xs text-ink-500">
                          {appointment.department?.name ?? ""}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={APPOINTMENT_STATUS_TONES[appointment.status]}>
                          <span className="normal-case">
                            {statusLabel(appointment.status)}
                          </span>
                        </Badge>
                      </td>
                      {showActions ? (
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {canUpdate && nextStatuses.length > 0 ? (
                            <>
                              {nextStatuses
                                .filter((status) => status !== "cancelled")
                                .slice(0, 1)
                                .map((status) => (
                                  <Button
                                    key={status}
                                    size="sm"
                                    variant="secondary"
                                    disabled={working}
                                    onClick={() =>
                                      void changeStatus(appointment, status)
                                    }
                                  >
                                    {statusLabel(status)}
                                  </Button>
                                ))}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setBooking(appointment)}
                              >
                                Edit
                              </Button>
                            </>
                          ) : null}
                          {/*
                            Completing an appointment does not create a visit —
                            the consultation is written up afterwards. This is
                            the handover between the two, carrying the booking's
                            details into the clinical record.
                          */}
                          {canCreateVisits &&
                          appointment.status === "completed" &&
                          appointment.patient ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setRecordingVisit(appointment)}
                            >
                              Record visit
                            </Button>
                          ) : null}
                          {canCancel && nextStatuses.includes("cancelled") ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-700 hover:bg-red-50"
                              onClick={() => setCancelling(appointment)}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                      </td>
                      ) : null}
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

      {booking ? (
        <BookingEditor
          appointment={booking === "new" ? null : booking}
          patients={patients}
          doctors={doctors}
          departments={departments}
          treatments={treatments}
          defaultDate={from || today}
          onClose={() => setBooking(null)}
          onSaved={async () => {
            setBooking(null);
            await load();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => {
          setCancelling(null);
          setCancelReason("");
        }}
        onConfirm={() => void confirmCancel()}
        title="Cancel this appointment?"
        description={
          cancelling
            ? `${cancelling.patient?.name ?? "This patient"}'s appointment on ${cancelling.appointmentDate} at ${cancelling.startTime} will be cancelled. The slot becomes available again.`
            : ""
        }
        confirmLabel="Cancel appointment"
        tone="danger"
        loading={working}
      />

      {recordingVisit?.patient ? (
        <VisitFormModal
          visit={null}
          fromAppointment={{
            id: recordingVisit.id,
            patient: {
              id: recordingVisit.patient.id,
              name: recordingVisit.patient.name,
              patientNumber: recordingVisit.patient.patientNumber,
            },
            doctorId: recordingVisit.doctor?.id ?? "",
            treatmentId: recordingVisit.treatment?.id ?? "",
            // The consultation happened on the day it was booked for, not the
            // day someone got round to writing it up.
            visitDate: recordingVisit.appointmentDate,
          }}
          patients={patients}
          doctors={doctors}
          treatments={treatments}
          defaultDate={today}
          onClose={() => setRecordingVisit(null)}
          onSaved={() => setRecordingVisit(null)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function BookingEditor({
  appointment,
  patients,
  doctors,
  departments,
  treatments,
  defaultDate,
  onClose,
  onSaved,
}: {
  appointment: Appointment | null;
  patients: PatientOption[];
  doctors: DoctorOption[];
  departments: Option[];
  treatments: TreatmentOption[];
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const editing = appointment !== null;

  const [patientId, setPatientId] = useState(appointment?.patient?.id ?? "");
  const [doctorId, setDoctorId] = useState(appointment?.doctor?.id ?? "");
  const [departmentId, setDepartmentId] = useState(
    appointment?.department?.id ?? "",
  );
  const [treatmentId, setTreatmentId] = useState(appointment?.treatment?.id ?? "");
  const [date, setDate] = useState(appointment?.appointmentDate ?? defaultDate);
  const [startTime, setStartTime] = useState(appointment?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(appointment?.endTime ?? "09:30");
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Only treatments in the chosen department can be booked — the server
  // enforces the same rule.
  const availableTreatments = departmentId
    ? treatments.filter(
        (treatment) => treatment.department?.id === departmentId,
      )
    : [];

  const availableDoctors = doctorsForDepartment(doctors, departmentId);

  /**
   * An appointment being edited may name a doctor who is no longer assigned to
   * its department. Keep them listed so the record still renders truthfully —
   * dropping them would silently blank the field and turn an unrelated edit
   * into a doctor reassignment.
   */
  const listedDoctors =
    doctorId && !availableDoctors.some((doctor) => doctor.id === doctorId)
      ? [...availableDoctors, ...doctors.filter((d) => d.id === doctorId)]
      : availableDoctors;

  /** Selecting a treatment pre-fills the end time from its configured duration. */
  function selectTreatment(id: string) {
    setTreatmentId(id);
    const treatment = treatments.find((item) => item.id === id);
    if (!treatment) return;

    const [hours, minutes] = startTime.split(":").map(Number);
    if (hours === undefined || minutes === undefined) return;

    const end = hours * 60 + minutes + treatment.durationMinutes;
    if (end >= 1440) return;

    setEndTime(
      `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
    );
  }

  async function save() {
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const payload = {
      patientId,
      doctorId,
      departmentId,
      treatmentId: treatmentId || null,
      appointmentDate: date,
      startTime,
      endTime,
      notes,
    };

    try {
      if (editing && appointment) {
        await api.patch(`/api/appointments/${appointment.id}`, payload);
        toast.success("Appointment updated.");
      } else {
        await api.post("/api/appointments", payload);
        toast.success("Appointment booked.");
      }
      await onSaved();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        // Conflicts (double-booking) and availability errors have no field, so
        // they surface at the top of the form where they will be read.
        if (Object.keys(err.fields).length === 0) setFormError(err.message);
      } else {
        setFormError("Could not save the appointment.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Reschedule appointment" : "Book an appointment"}
      description="Double-bookings and times outside the doctor's hours are rejected."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!patientId || !doctorId || !departmentId || !date}
          >
            {editing ? "Save changes" : "Book appointment"}
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

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Department"
            value={departmentId}
            onChange={(event) => {
              const nextDepartmentId = event.target.value;
              setDepartmentId(nextDepartmentId);
              // A treatment from the old department would no longer be valid.
              setTreatmentId("");
              // Nor would a doctor who does not work in the new one. Cleared
              // rather than silently left in place, which is how a booking
              // ends up with a department and a doctor that disagree.
              const stillValid = doctorsForDepartment(
                doctors,
                nextDepartmentId,
              ).some((doctor) => doctor.id === doctorId);
              if (!stillValid) setDoctorId("");
            }}
            error={fieldErrors.departmentId}
            options={[
              { value: "", label: "Select a department" },
              ...departments.map((department) => ({
                value: department.id,
                label: department.name,
              })),
            ]}
            required
          />

          <SelectField
            label="Doctor"
            value={doctorId}
            onChange={(event) => setDoctorId(event.target.value)}
            error={fieldErrors.doctorId}
            options={[
              { value: "", label: "Select a doctor" },
              ...listedDoctors.map((doctor) => ({
                value: doctor.id,
                label: doctor.name,
              })),
            ]}
            hint={
              departmentId && availableDoctors.length === 0
                ? "No doctors are assigned to this department."
                : departmentId
                  ? "Doctors working in the selected department."
                  : "Select a department first."
            }
            required
          />
        </div>

        <SelectField
          label="Treatment"
          value={treatmentId}
          onChange={(event) => selectTreatment(event.target.value)}
          error={fieldErrors.treatmentId}
          options={[
            { value: "", label: "General consultation (no treatment)" },
            ...availableTreatments.map((treatment) => ({
              value: treatment.id,
              label: `${treatment.name} (${treatment.durationMinutes} min)`,
            })),
          ]}
          hint={
            departmentId
              ? "Only treatments offered by the selected department are listed."
              : "Select a department first."
          }
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            error={fieldErrors.appointmentDate}
            required
          />
          <TextField
            label="Start"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            error={fieldErrors.startTime}
            required
          />
          <TextField
            label="End"
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            error={fieldErrors.endTime}
            required
          />
        </div>

        <TextAreaField
          label="Notes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          error={fieldErrors.notes}
          placeholder="Reason for visit, preparation instructions…"
        />
      </div>
    </Modal>
  );
}
