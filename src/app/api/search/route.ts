import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, route } from "@/lib/api/response";
import { requireHospitalUser } from "@/lib/auth/session";
import { searchWorkspace } from "@/services/search.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(200).default(""),
});

/**
 * GET /api/search?q= — the header omnibox.
 *
 * Needs only an authenticated hospital user: each collection is searched ONLY
 * when the caller holds its `.view` permission, so the permission check lives
 * with the data rather than on the route. Results are always tenant-scoped.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireHospitalUser();

  const { searchParams } = new URL(req.url);
  const { q } = querySchema.parse({ q: searchParams.get("q") ?? undefined });

  return ok(await searchWorkspace(user, q));
});
