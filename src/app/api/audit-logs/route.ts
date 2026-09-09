import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/api/response";
import { requirePermission } from "@/lib/rbac/guard";
import { listAuditLogsSchema } from "@/schemas/settings.schema";
import {
  listAuditActions,
  listAuditActors,
  listAuditLogs,
} from "@/services/settings.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/audit-logs — this hospital's audit trail (Sections 28, 49).
 *
 * Gated on `audit.view`, an extension to the spec's Section 11 catalogue: Phase
 * 8 requires audit logs but no permission was listed for reading them, and an
 * audit trail is more sensitive than the settings screen it would otherwise
 * have shared a permission with.
 *
 * Entries were redacted on write (audit.service.ts strips password, token and
 * secret keys), so nothing sensitive can surface here even if a call site
 * passed something it should not have.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requirePermission("audit.view");

  const { searchParams } = new URL(req.url);

  // `?filters=1` returns the filter vocabulary rather than a page of entries.
  if (searchParams.get("filters") === "1") {
    const [actions, actors] = await Promise.all([
      listAuditActions(user.hospitalId),
      listAuditActors(user.hospitalId),
    ]);
    return ok({ actions, actors });
  }

  const params = listAuditLogsSchema.parse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    action: searchParams.get("action") ?? undefined,
    resource: searchParams.get("resource") ?? undefined,
    userId: searchParams.get("userId") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });

  return ok(await listAuditLogs(user.hospitalId, params));
});
