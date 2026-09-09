import type { NextRequest } from "next/server";
import { ok, readJson, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { updateSettingsSchema } from "@/schemas/settings.schema";
import { getSettings, updateSettings } from "@/services/settings.service";
import { requestMeta } from "@/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/hospital/settings — the caller's OWN hospital.
 *
 * There is no id in the path: the tenant comes from the authenticated context,
 * so this endpoint structurally cannot read another hospital's configuration.
 */
export const GET = route(async () => {
  const user = await requirePermission("hospital.settings.view");
  return ok(await getSettings(user.hospitalId));
});

/**
 * PATCH /api/hospital/settings
 *
 * Tenant-owned configuration only (Section 36). `status`, `currency` and `slug`
 * are absent from the schema — status is a platform control, and changing
 * currency would silently reinterpret every stored price, since amounts are
 * held as minor units of it.
 */
export const PATCH = route(async (req: NextRequest) => {
  const user = await requirePermission("hospital.settings.update");

  const input = updateSettingsSchema.parse(await readJson(req));

  const settings = await updateSettings(
    input,
    { userId: user.userId, hospitalId: user.hospitalId },
    requestMeta(req),
  );

  return ok(settings);
});
