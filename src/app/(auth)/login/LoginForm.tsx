"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PasswordField, TextField } from "@/components/ui/Field";
import { ApiClientError, api } from "@/lib/client/api";

type LoginResponse = {
  user: { name: string; mustChangePassword: boolean };
  redirectTo: string;
};

export function LoginForm() {
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /**
   * The button is NEVER gated on hydration.
   *
   * An earlier version disabled it until a `useEffect` confirmed React had
   * hydrated. That was wrong: if hydration fails for any reason, the effect
   * never runs, so the form is permanently unusable with no way to recover —
   * and any "hydration stalled" fallback built on another effect cannot fire
   * either, for exactly the same reason.
   *
   * `method="post"` on the form below is what actually protects the
   * credentials: if the submit handler is not attached, the browser's native
   * fallback POSTs rather than appending email and password to the URL. That
   * guarantee holds without disabling anything.
   */

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    /**
     * Read the values from the form itself rather than from React state.
     *
     * A browser password manager can fill an input without firing a `change`
     * event, so the field looks populated while React's state is still empty —
     * and the user gets "Email is required" over a visibly filled box. Reading
     * the DOM at submit time makes autofill work like typing.
     */
    const data = new FormData(event.currentTarget);
    const submittedEmail = String(data.get("email") ?? "").trim() || email;
    const submittedPassword = String(data.get("password") ?? "") || password;

    // Keep React state in step, so the fields survive a failed attempt.
    setEmail(submittedEmail);
    setPassword(submittedPassword);

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const result = await api.post<LoginResponse>("/api/auth/login", {
        email: submittedEmail,
        password: submittedPassword,
      });

      /**
       * `next` is honoured only when it is a same-site absolute path, so a
       * crafted ?next=https://evil.example link cannot turn the login form
       * into an open redirect.
       */
      const requested = searchParams.get("next");
      const safeNext =
        requested && requested.startsWith("/") && !requested.startsWith("//")
          ? requested
          : null;

      const destination = result.user.mustChangePassword
        ? "/change-password"
        : (safeNext ?? result.redirectTo);

      /**
       * A FULL navigation, not router.replace().
       *
       * Two reasons. First, `router.replace()` followed by `router.refresh()`
       * races: the refresh invalidates the router cache and re-renders the
       * current route, cancelling the navigation that was still in flight — so
       * the user stayed on the login page despite a successful 200.
       *
       * Second, sign-in has just changed the auth cookies. Every layout and
       * server component above the destination has to be rebuilt against the
       * new session, and the client router may still hold entries rendered
       * while logged out. A document navigation guarantees the whole tree is
       * re-rendered with the new identity.
       */
      window.location.assign(destination);
      return;
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFieldErrors(error.fields);
        setFormError(
          Object.keys(error.fields).length > 0 ? null : error.message,
        );
      } else {
        setFormError("Unable to sign in right now. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      /**
       * `method="post"` matters even though JavaScript handles submission: if
       * the handler is not yet attached, the browser's native fallback must not
       * be a GET, which would append the email and password to the URL.
       */
      method="post"
      action="/login"
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

      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="username"
        placeholder="you@hospital.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldErrors.email}
        required
        autoFocus
      />

      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        placeholder="Enter your password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
        required
      />

      <Button type="submit" size="lg" fullWidth loading={submitting}>
        Sign in
      </Button>

      <p className="text-center text-xs leading-relaxed text-ink-500">
        Signing in for the first time? Use the temporary password provided by
        your administrator — you will be asked to change it immediately.
      </p>
    </form>
  );
}
