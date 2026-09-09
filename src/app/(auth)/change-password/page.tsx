import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthOutcome } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/app/(auth)/change-password/ChangePasswordForm";

export const metadata: Metadata = { title: "Change password" };
export const dynamic = "force-dynamic";

/**
 * Reachable both as a forced first-login step and as a voluntary password
 * change. The server-side guard in requireAuth() is what actually blocks the
 * rest of the app while `mustChangePassword` is set — this page just presents
 * the form.
 */
export default async function ChangePasswordPage() {
  const outcome = await getAuthOutcome();

  if (!outcome.ok) redirect("/login");

  const forced = outcome.user.mustChangePassword;

  return (
    <>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          {forced ? "Set a new password" : "Change password"}
        </h1>
        <p className="mt-1.5 text-sm text-ink-500">
          {forced
            ? "Your account uses a temporary password. Choose a new one to continue."
            : "Choose a new password for your account."}
        </p>
      </header>

      {forced ? (
        <div className="mb-5 rounded-lg border border-gold-200 bg-gold-50 px-3.5 py-3 text-sm text-gold-900">
          You will not be able to reach the dashboard until this is done.
        </div>
      ) : null}

      <ChangePasswordForm forced={forced} />
    </>
  );
}
