import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/api/response";
import { requireHospitalUser } from "@/lib/auth/session";
import { reportRangeSchema } from "@/schemas/settings.schema";
import { getReportSummary } from "@/services/report.service";
import { ApiError } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Like the dashboard, each section is computed only for a caller who holds the
 * permission for its data — revenue needs `invoice.view` / `payment.view`,
 * activity needs the clinical permissions. Sections the caller cannot see come
 * back as `null` rather than zeroed, so an empty figure is never mistaken for a
 * real one.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireHospitalUser();

  const { searchParams } = new URL(req.url);
  const range = reportRangeSchema.parse({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });

  if (range.to < range.from) {
    throw ApiError.validation("The end date must be on or after the start date.", {
      fields: { to: "End date is before the start date." },
    });
  }

  return ok(await getReportSummary(user, range));
});
