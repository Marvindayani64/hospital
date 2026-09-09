import { redirect } from "next/navigation";
import { getAuthOutcome } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/guard";
import type { Permission } from "@/lib/rbac/permissions";
import type { AuthContext } from "@/types";

/**
 * Permission guard for SERVER COMPONENTS.
 *
 * `requirePermission()` throws an ApiError, which is the right behaviour for a
 * route handler but reaches a page as an unhandled exception — the user sees a
 * generic "something went wrong" screen instead of being told they lack access.
 *
 * This returns the verdict instead of throwing, so a page can render a proper
 * access-denied view inside the normal dashboard shell. Genuine auth failures
 * (no session, password change pending, wrong workspace) still redirect, since
 * for those there is somewhere better to send the user.
 *
 * This decides what is DISPLAYED. Every underlying API call re-checks the same
 * permission server-side, so the page is never the thing keeping data safe.
 */
export type PageGuard = {
  allowed: boolean;
  user: AuthContext & { hospitalId: string };
};

export async function guardHospitalPage(
  permission: Permission,
): Promise<PageGuard> {
  const outcome = await getAuthOutcome();

  if (!outcome.ok) redirect("/login");
  if (outcome.user.mustChangePassword) redirect("/change-password");

  // A Super Admin has no tenant workspace and holds no tenant permissions.
  if (outcome.user.isSuperAdmin || !outcome.user.hospitalId) {
    redirect("/super-admin/dashboard");
  }

  return {
    allowed: hasPermission(outcome.user, permission),
    user: { ...outcome.user, hospitalId: outcome.user.hospitalId },
  };
}
