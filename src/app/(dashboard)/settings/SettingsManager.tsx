"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmailField, PhoneField, TextAreaField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import { AuditLogPanel } from "@/app/(dashboard)/settings/AuditLogPanel";
import { cn } from "@/utils/cn";

export type HospitalSettings = {
  id: string;
  name: string;
  slug: string;
  type: string;
  email: string;
  phone: string;
  logo: string | null;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  status: string;
  currency: string;
  currencyName: string;
  defaultTaxRatePercent: number;
  invoicePrefix: string;
  invoiceFooter: string;
  appointmentSlotMinutes: number;
  notifications: {
    appointmentReminders: boolean;
    invoiceIssued: boolean;
    followUpReminders: boolean;
  };
};

type Tab = "profile" | "billing" | "notifications" | "audit";

export function SettingsManager({
  settings,
  canUpdate,
  canViewAudit,
}: {
  settings: HospitalSettings;
  canUpdate: boolean;
  canViewAudit: boolean;
}) {
  const toast = useToast();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("profile");
  const [form, setForm] = useState({
    name: settings.name,
    email: settings.email,
    phone: settings.phone,
    logo: settings.logo ?? "",
    address: settings.address,
    city: settings.city,
    state: settings.state,
    country: settings.country,
    postalCode: settings.postalCode,
    defaultTaxRatePercent: String(settings.defaultTaxRatePercent),
    invoicePrefix: settings.invoicePrefix,
    invoiceFooter: settings.invoiceFooter,
    appointmentSlotMinutes: String(settings.appointmentSlotMinutes),
  });
  const [notifications, setNotifications] = useState(settings.notifications);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(section: Tab) {
    setSaving(true);
    setFieldErrors({});

    // Only the fields on the visible section are sent, so saving one tab never
    // silently rewrites another.
    const payload =
      section === "profile"
        ? {
            name: form.name,
            email: form.email,
            phone: form.phone,
            logo: form.logo,
            address: form.address,
            city: form.city,
            state: form.state,
            country: form.country,
            postalCode: form.postalCode,
          }
        : section === "billing"
          ? {
              defaultTaxRatePercent: Number(form.defaultTaxRatePercent) || 0,
              invoicePrefix: form.invoicePrefix,
              invoiceFooter: form.invoiceFooter,
              appointmentSlotMinutes:
                Number(form.appointmentSlotMinutes) || 30,
            }
          : { notifications };

    try {
      await api.patch("/api/hospital/settings", payload);
      toast.success("Settings saved.");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        if (Object.keys(err.fields).length === 0) toast.error(err.message);
      } else {
        toast.error("Could not save the settings.");
      }
    } finally {
      setSaving(false);
    }
  }

  const tabs: Array<[Tab, string, boolean]> = [
    ["profile", "Hospital profile", true],
    ["billing", "Billing & scheduling", true],
    ["notifications", "Notifications", true],
    ["audit", "Audit log", canViewAudit],
  ];

  return (
    <>
      <div className="flex flex-wrap gap-1 border-b border-ink-200">
        {tabs
          .filter(([, , visible]) => visible)
          .map(([value, label]) => (
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
              {label}
            </button>
          ))}
      </div>

      {tab === "profile" ? (
        <Card>
          <CardHeader
            title="Hospital profile"
            description="Contact details and address shown to your staff and on invoices."
            action={
              canUpdate ? (
                <Button size="sm" loading={saving} onClick={() => void save("profile")}>
                  Save
                </Button>
              ) : undefined
            }
          />
          <CardBody className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone={settings.status === "active" ? "success" : "warning"}>
                <span className="normal-case">{settings.status}</span>
              </Badge>
              <Badge tone="neutral">
                <span className="normal-case">{settings.currencyName}</span>
              </Badge>
              <Badge tone="neutral">
                <span className="font-mono normal-case">{settings.slug}</span>
              </Badge>
            </div>

            <p className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5 text-xs text-ink-600">
              Status and currency are set by the platform administrator. Currency
              cannot be changed after onboarding — every stored price is held in
              its smallest unit, so switching would reinterpret them all.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Hospital name"
                value={form.name}
                disabled={!canUpdate}
                onChange={(event) => update("name", event.target.value)}
                error={fieldErrors.name}
              />
              <EmailField
                label="Contact email"
                value={form.email}
                disabled={!canUpdate}
                onChange={(event) => update("email", event.target.value)}
                error={fieldErrors.email}
              />
              <PhoneField
                label="Phone"
                value={form.phone}
                disabled={!canUpdate}
                onChange={(val) => update("phone", val)}
                error={fieldErrors.phone}
              />
              <TextField
                label="Logo URL"
                value={form.logo}
                disabled={!canUpdate}
                onChange={(event) => update("logo", event.target.value)}
                error={fieldErrors.logo}
                hint="Optional."
              />
            </div>

            <TextField
              label="Address"
              value={form.address}
              disabled={!canUpdate}
              onChange={(event) => update("address", event.target.value)}
              error={fieldErrors.address}
            />

            <div className="grid gap-4 sm:grid-cols-4">
              <TextField
                label="City"
                value={form.city}
                disabled={!canUpdate}
                onChange={(event) => update("city", event.target.value)}
              />
              <TextField
                label="State"
                value={form.state}
                disabled={!canUpdate}
                onChange={(event) => update("state", event.target.value)}
              />
              <TextField
                label="Country"
                value={form.country}
                disabled={!canUpdate}
                onChange={(event) => update("country", event.target.value)}
              />
              <TextField
                label="Postal code"
                value={form.postalCode}
                disabled={!canUpdate}
                onChange={(event) => update("postalCode", event.target.value)}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {tab === "billing" ? (
        <Card>
          <CardHeader
            title="Billing & scheduling"
            description="Defaults applied to new invoices and bookings."
            action={
              canUpdate ? (
                <Button size="sm" loading={saving} onClick={() => void save("billing")}>
                  Save
                </Button>
              ) : undefined
            }
          />
          <CardBody className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                label="Default tax rate (%)"
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={form.defaultTaxRatePercent}
                disabled={!canUpdate}
                onChange={(event) =>
                  update("defaultTaxRatePercent", event.target.value)
                }
                error={fieldErrors.defaultTaxRatePercent}
                hint="Applied to new invoices only."
              />
              <TextField
                label="Invoice prefix"
                value={form.invoicePrefix}
                disabled={!canUpdate}
                onChange={(event) =>
                  update("invoicePrefix", event.target.value.toUpperCase())
                }
                error={fieldErrors.invoicePrefix}
                hint="e.g. INV-000001"
              />
              <TextField
                label="Default appointment length"
                type="number"
                min={5}
                max={480}
                step={5}
                value={form.appointmentSlotMinutes}
                disabled={!canUpdate}
                onChange={(event) =>
                  update("appointmentSlotMinutes", event.target.value)
                }
                error={fieldErrors.appointmentSlotMinutes}
                hint="Minutes."
              />
            </div>

            <TextAreaField
              label="Invoice footer"
              rows={3}
              value={form.invoiceFooter}
              disabled={!canUpdate}
              onChange={(event) => update("invoiceFooter", event.target.value)}
              error={fieldErrors.invoiceFooter}
              hint="Payment terms or bank details printed on every invoice."
            />

            <p className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5 text-xs text-ink-600">
              Changing the tax rate affects invoices raised from now on. Each
              invoice stores the rate its tax was calculated from, so existing
              records are never re-taxed.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {tab === "notifications" ? (
        <Card>
          <CardHeader
            title="Notifications"
            description="Which events this hospital wants notifications for."
            action={
              canUpdate ? (
                <Button
                  size="sm"
                  loading={saving}
                  onClick={() => void save("notifications")}
                >
                  Save
                </Button>
              ) : undefined
            }
          />
          <CardBody className="flex flex-col gap-4">
            <div
              role="note"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900"
            >
              <strong className="font-medium">Not yet delivered.</strong> These
              preferences are saved and will be honoured once a delivery channel
              (email or SMS) is connected — the first external service this
              system would depend on. Nothing is sent today.
            </div>

            {(
              [
                [
                  "appointmentReminders",
                  "Appointment reminders",
                  "Remind patients before a booked appointment.",
                ],
                [
                  "invoiceIssued",
                  "Invoice issued",
                  "Notify the patient when an invoice is issued to them.",
                ],
                [
                  "followUpReminders",
                  "Follow-up reminders",
                  "Remind staff when a visit follow-up falls due.",
                ],
              ] as const
            ).map(([key, label, description]) => (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 px-3.5 py-3 hover:bg-ink-50"
              >
                <input
                  type="checkbox"
                  checked={notifications[key]}
                  disabled={!canUpdate}
                  onChange={(event) =>
                    setNotifications((current) => ({
                      ...current,
                      [key]: event.target.checked,
                    }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-ink-300 accent-gold-500"
                />
                <span>
                  <span className="block text-sm font-medium text-ink-900">
                    {label}
                  </span>
                  <span className="block text-xs text-ink-500">{description}</span>
                </span>
              </label>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {tab === "audit" && canViewAudit ? <AuditLogPanel /> : null}
    </>
  );
}
