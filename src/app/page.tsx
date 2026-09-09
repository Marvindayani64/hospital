import { redirect } from "next/navigation";
import { getAuthOutcome } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Entry point. Routes each visitor to the right place using the REAL auth
 * check — unlike the middleware, this runs on the Node runtime and can reach
 * the database, so it sees account status, hospital status and tokenVersion.
 */
export default async function RootPage() {
  const outcome = await getAuthOutcome();

  if (!outcome.ok) redirect("/login");

  if (outcome.user.mustChangePassword) redirect("/change-password");

  redirect(outcome.user.isSuperAdmin ? "/super-admin/dashboard" : "/dashboard");
}
