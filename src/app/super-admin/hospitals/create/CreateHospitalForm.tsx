"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import { createHospitalSchema } from "@/schemas/hospital.schema";
import { HOSPITAL_TYPES } from "@/types";

type CreateResponse = {
  hospital: { id: string; name: string; slug: string };
  temporaryPassword: string;
  warning: string;
};

const TYPE_OPTIONS = HOSPITAL_TYPES.map((type) => ({
  value: type,
  label: type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase()),
}));

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "suspended", label: "Suspended" },
];

const INITIAL_FORM = {
  name: "",
  type: "general",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  country: "",
  postalCode: "",
  status: "active",
  adminName: "",
  adminEmail: "",
  temporaryPassword: "",
};

type FormKey = keyof typeof INITIAL_FORM;

/**
 * Validates with the SAME schema the API parses, imported rather than restated
 * so the two cannot drift. A convenience for the operator, never a control —
 * the server re-validates every field regardless.
 *
 * `temporaryPassword` is omitted when blank, exactly as the submit does: the
 * schema's `.min(8)` must not fire on an empty field that legitimately means
 * "generate one on the server".
 */
function validate(form: typeof INITIAL_FORM): Record<string, string> {
  const candidate: Record<string, string> = { ...form };
  if (!candidate.temporaryPassword) delete candidate.temporaryPassword;

  const result = createHospitalSchema.safeParse(candidate);
  if (result.success) return {};

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    // First message per field wins, matching how the API reports them.
    if (path && !(path in errors)) errors[path] = issue.message;
  }
  return errors;
}

const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+?";

/**
 * Client-side convenience so the Super Admin can see the password before
 * submitting. Uses Web Crypto, never Math.random. Leaving the field blank is
 * equally valid — the server generates one with the same policy.
 */
function generatePassword(length = 14): string {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);

  let password = "";
  for (const value of values) {
    password += PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length];
  }

  // Guarantee one of each required class regardless of what the draw produced.
  return `${password.slice(0, length - 4)}Aa9!`;
}

export function CreateHospitalForm() {
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CreateResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FormKey, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const clientErrors = useMemo(() => validate(form), [form]);

  function update(field: FormKey, value: string) {
    setForm((current) => ({ ...current, [field]: value }));

    // A server error describes the value that was sent; once the field changes
    // it no longer applies and the live client-side check takes over.
    setFieldErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
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
   * attempted — never while it is still being filled in for the first time.
   */
  function errorFor(field: FormKey): string | undefined {
    return (
      fieldErrors[field] ??
      (submitAttempted || touched[field] ? clientErrors[field] : undefined)
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);

    // Reveal every outstanding message rather than sending a request that is
    // already known to fail.
    if (Object.keys(clientErrors).length > 0) {
      setFormError("Please correct the highlighted fields.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const payload: Record<string, string> = { ...form };
      // Omit rather than send "" — the schema treats absence as "you generate it".
      if (!payload.temporaryPassword) delete payload.temporaryPassword;
      // `currency` and `logo` are deliberately absent: the schema defaults the
      // currency to INR and the hospital sets its own logo under Settings.

      const response = await api.post<CreateResponse>(
        "/api/super-admin/hospitals",
        payload,
      );

      setResult(response);
      setForm(INITIAL_FORM);
      setTouched({});
      setSubmitAttempted(false);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFieldErrors(error.fields);
        setFormError(
          Object.keys(error.fields).length > 0
            ? "Please correct the highlighted fields."
            : error.message,
        );
      } else {
        setFormError("Could not create the hospital. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPassword() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the password and copy it manually.");
    }
  }

  function closeResult() {
    setResult(null);
    /**
     * Refresh BEFORE navigating. Calling `refresh()` after `push()` re-renders
     * the route being left and cancels the navigation still in flight — the
     * same race that stopped the login redirect from happening.
     */
    router.refresh();
    router.push("/super-admin/hospitals");
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
        {formError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
          >
            {formError}
          </div>
        ) : null}

        <Card>
          <CardHeader title="Hospital information" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Hospital name"
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              onBlur={() => markTouched("name")}
              error={errorFor("name")}
              placeholder="St. Mary's General Hospital"
              maxLength={200}
              required
            />
            <SelectField
              label="Hospital type"
              value={form.type}
              onChange={(event) => update("type", event.target.value)}
              error={errorFor("type")}
              options={TYPE_OPTIONS}
              required
            />
            <TextField
              label="Email"
              type="email"
              value={form.email}
              onChange={(event) => update("email", event.target.value)}
              onBlur={() => markTouched("email")}
              error={errorFor("email")}
              placeholder="contact@hospital.com"
              maxLength={254}
              required
            />
            <TextField
              label="Phone"
              type="tel"
              value={form.phone}
              onChange={(event) => update("phone", event.target.value)}
              onBlur={() => markTouched("phone")}
              error={errorFor("phone")}
              placeholder="+91 22 2345 6789"
              inputMode="tel"
              maxLength={30}
              required
            />
            <div className="sm:col-span-2">
              <TextAreaField
                label="Address"
                rows={2}
                value={form.address}
                onChange={(event) => update("address", event.target.value)}
                onBlur={() => markTouched("address")}
                error={errorFor("address")}
                maxLength={300}
                hint="Optional."
              />
            </div>
            <TextField
              label="City"
              value={form.city}
              onChange={(event) => update("city", event.target.value)}
              onBlur={() => markTouched("city")}
              error={errorFor("city")}
              maxLength={100}
              hint="Optional."
            />
            <TextField
              label="State / Province"
              value={form.state}
              onChange={(event) => update("state", event.target.value)}
              onBlur={() => markTouched("state")}
              error={errorFor("state")}
              maxLength={100}
              hint="Optional."
            />
            <TextField
              label="Country"
              value={form.country}
              onChange={(event) => update("country", event.target.value)}
              onBlur={() => markTouched("country")}
              error={errorFor("country")}
              maxLength={100}
              hint="Optional."
            />
            <TextField
              label="Postal code"
              value={form.postalCode}
              onChange={(event) => update("postalCode", event.target.value)}
              onBlur={() => markTouched("postalCode")}
              error={errorFor("postalCode")}
              maxLength={20}
              hint="Optional."
            />
            {/*
              Logo is set by the hospital itself under Settings, and currency
              defaults to INR for every new hospital — neither belongs in the
              onboarding form. The API still accepts both, so the defaults stay
              overridable programmatically.
            */}
            <SelectField
              label="Status"
              value={form.status}
              onChange={(event) => update("status", event.target.value)}
              error={errorFor("status")}
              options={STATUS_OPTIONS}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Hospital administrator"
            description="This account receives the Hospital Admin role and must change its password on first sign-in."
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Admin name"
              value={form.adminName}
              onChange={(event) => update("adminName", event.target.value)}
              onBlur={() => markTouched("adminName")}
              error={errorFor("adminName")}
              placeholder="Dr. Jane Okafor"
              maxLength={150}
              required
            />
            <TextField
              label="Admin email"
              type="email"
              value={form.adminEmail}
              onChange={(event) => update("adminEmail", event.target.value)}
              onBlur={() => markTouched("adminEmail")}
              error={errorFor("adminEmail")}
              placeholder="admin@hospital.com"
              maxLength={254}
              required
            />

            <div className="sm:col-span-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <TextField
                    label="Temporary password"
                    value={form.temporaryPassword}
                    onChange={(event) =>
                      update("temporaryPassword", event.target.value)
                    }
                    onBlur={() => markTouched("temporaryPassword")}
                    error={errorFor("temporaryPassword")}
                    placeholder="Leave blank to generate on the server"
                    maxLength={128}
                    hint="Optional — at least 8 characters if set. Stored only as a hash, shown once after creation and never retrievable again."
                  />
                </div>
                <Button
                  variant="secondary"
                  className="sm:mb-6"
                  onClick={() =>
                    update("temporaryPassword", generatePassword())
                  }
                >
                  Generate
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => router.push("/super-admin/hospitals")}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Create hospital
          </Button>
        </div>
      </form>

      {/* One-time reveal. There is deliberately no way to see this again. */}
      <Modal
        open={result !== null}
        onClose={closeResult}
        title="Hospital created"
        description={result?.warning}
        footer={
          <>
            <Button variant="secondary" onClick={copyPassword}>
              {copied ? "Copied" : "Copy password"}
            </Button>
            <Button onClick={closeResult}>Done</Button>
          </>
        }
      >
        {result ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Hospital
              </p>
              <p className="mt-0.5 text-sm font-medium text-ink-900">
                {result.hospital.name}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Temporary password
              </p>
              <p className="mt-1 select-all break-all rounded-lg border border-gold-200 bg-gold-50 px-3 py-2.5 font-mono text-sm text-gold-900">
                {result.temporaryPassword}
              </p>
            </div>

            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              This temporary password will not be available again. Share it with
              the administrator now — they will be required to change it on
              first sign-in.
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
