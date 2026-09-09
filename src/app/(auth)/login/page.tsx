import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthOutcome } from "@/lib/auth/session";
import { LoginForm } from "@/app/(auth)/login/LoginForm";
import { Skeleton } from "@/components/ui/States";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/**
 * Performs the real auth check itself (the middleware only sees that a cookie
 * exists) so an already-signed-in user is not shown the login form again.
 */
export default async function LoginPage() {
  const outcome = await getAuthOutcome();

  if (outcome.ok) {
    if (outcome.user.mustChangePassword) redirect("/change-password");
    redirect(outcome.user.isSuperAdmin ? "/super-admin/dashboard" : "/dashboard");
  }

  return (
    <>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Sign in
        </h1>
        <p className="mt-1.5 text-sm text-ink-500">
          Use the credentials issued for your hospital account.
        </p>
      </header>
      {/* LoginForm reads ?next= via useSearchParams, which requires a
          Suspense boundary. */}
      <Suspense
        fallback={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-11" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </>
  );
}
