"use client";

import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { PasswordField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, api } from "@/lib/client/api";
import { cn } from "@/utils/cn";

type ChangePasswordResponse = { changed: boolean; redirectTo: string };

/**
 * Mirrors the server-side policy in lib/auth/password.ts. Client-side checking
 * is for feedback only — the server re-validates every rule (Section 41).
 */
const RULES: Array<{ label: string; test: (value: string) => boolean }> = [
  { label: "At least 8 characters", test: (v) => v.length >= 8 },
  { label: "An uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { label: "A lowercase letter", test: (v) => /[a-z]/.test(v) },
  { label: "A number", test: (v) => /[0-9]/.test(v) },
  { label: "A special character", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const toast = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /**
   * Deliberately NOT gated on hydration — see the note in LoginForm. Disabling
   * the button until an effect runs makes the form unrecoverable if hydration
   * ever fails. `method="post"` on the form is what keeps the passwords out of
   * the URL, and it needs no JavaScript to work.
   */
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const ruleResults = useMemo(
    () => RULES.map((rule) => ({ ...rule, passed: rule.test(newPassword) })),
    [newPassword],
  );

  const allRulesPass = ruleResults.every((rule) => rule.passed);
  const passwordsMatch =
    confirmPassword.length > 0 && newPassword === confirmPassword;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    /**
     * Read from the form rather than React state — a password manager can fill
     * "current password" without firing a change event. See LoginForm.
     */
    const data = new FormData(event.currentTarget);
    const current = String(data.get("currentPassword") ?? "") || currentPassword;
    const next = String(data.get("newPassword") ?? "") || newPassword;
    const confirm = String(data.get("confirmPassword") ?? "") || confirmPassword;

    setCurrentPassword(current);
    setNewPassword(next);
    setConfirmPassword(confirm);

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const result = await api.post<ChangePasswordResponse>(
        "/api/auth/change-password",
        {
          currentPassword: current,
          newPassword: next,
          confirmPassword: confirm,
        },
      );

      toast.success("Password updated. You have been signed out on other devices.");
      /**
       * Full navigation for the same reasons as the login form: `replace()`
       * followed by `refresh()` cancels the pending navigation, and a password
       * change reissues the auth cookies, so every layout above the destination
       * must be rebuilt against the new session.
       */
      window.location.assign(result.redirectTo);
      return;
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFieldErrors(error.fields);
        setFormError(
          Object.keys(error.fields).length > 0 ? null : error.message,
        );
      } else {
        setFormError("Unable to change your password right now.");
      }
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      /**
       * Same reasoning as the login form: if React has not hydrated yet, the
       * browser's native fallback must not be a GET, which would put the old
       * and new passwords in the URL and browser history.
       */
      method="post"
      action="/change-password"
      className="flex flex-col gap-4"
      noValidate
    >
      {formError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
        >
          {formError}
        </div>
      ) : null}

      <PasswordField
        label={forced ? "Temporary password" : "Current password"}
        name="currentPassword"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        error={fieldErrors.currentPassword}
        required
        autoFocus
      />

      <PasswordField
        label="New password"
        name="newPassword"
        autoComplete="new-password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        error={fieldErrors.newPassword}
        required
      />

      <ul className="-mt-1 flex flex-col gap-1" aria-label="Password requirements">
        {ruleResults.map((rule) => (
          <li
            key={rule.label}
            className={cn(
              "flex items-center gap-2 text-xs",
              rule.passed ? "text-emerald-700" : "text-ink-500",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] font-bold",
                rule.passed
                  ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                  : "border-ink-200 text-transparent",
              )}
            >
              ✓
            </span>
            {rule.label}
          </li>
        ))}
      </ul>

      <PasswordField
        label="Confirm new password"
        name="confirmPassword"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={
          fieldErrors.confirmPassword ??
          (confirmPassword.length > 0 && !passwordsMatch
            ? "Passwords do not match."
            : undefined)
        }
        required
      />

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={submitting}
        disabled={
          !allRulesPass || !passwordsMatch || currentPassword.length === 0
        }
      >
        Update password
      </Button>
    </form>
  );
}
