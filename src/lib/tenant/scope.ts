import mongoose, { type FilterQuery, type Model } from "mongoose";
import { ApiError } from "@/lib/api/errors";

/**
 * Tenant scoping helpers.
 *
 * These exist so that "remember the hospitalId" is never something a developer
 * has to remember. Every hospital-owned query goes through `tenantScoped`, and
 * every reference to another document goes through `assertBelongsToTenant`.
 *
 * The `hospitalId` passed in must always come from the authenticated context
 * (`requireHospitalUser`, `requirePermission`, `getTenantId`) — never from
 * request input.
 */

/**
 * Minimal shape a tenant-owned document must have. Kept deliberately loose
 * (`unknown`, optional) so that the concrete document type is still inferred at
 * each call site: `assertBelongsToTenant(User, ...)` returns a `UserDoc`, not a
 * narrowed base type with its fields erased.
 */
type TenantOwned = { hospitalId?: unknown };

/**
 * Merges the tenant discriminator into a filter.
 *
 * `hospitalId` is applied LAST so a caller-supplied filter can never override
 * it — even if request-derived keys somehow reached the filter object.
 */
export function tenantScoped<T extends TenantOwned>(
  hospitalId: string,
  filter: FilterQuery<T> = {},
): FilterQuery<T> {
  return { ...filter, hospitalId } as FilterQuery<T>;
}

/**
 * Rejects a malformed id before it reaches Mongo.
 *
 * Returning 404 rather than 400 keeps the response identical to "exists but
 * belongs to another tenant", so probing cannot distinguish the two.
 */
export function assertValidObjectId(id: string, what = "Resource"): void {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound(`${what} not found.`);
  }
}

/**
 * Loads a document by id, but only if it belongs to this tenant.
 *
 * This is the Section 10 cross-tenant relationship check. Using it to resolve
 * every referenced id means a Hospital A record can never be linked to a
 * Hospital B record: the lookup simply finds nothing and 404s, which also
 * avoids confirming that the other tenant's id exists.
 */
export async function assertBelongsToTenant<T extends TenantOwned>(
  model: Model<T>,
  id: string,
  hospitalId: string,
  what = "Resource",
): Promise<T> {
  assertValidObjectId(id, what);

  const document = await model
    .findOne(tenantScoped<T>(hospitalId, { _id: id } as FilterQuery<T>))
    .lean<T | null>();

  if (!document) throw ApiError.notFound(`${what} not found.`);

  return document;
}

/** Existence check that does not pull the whole document back. */
export async function existsInTenant<T extends TenantOwned>(
  model: Model<T>,
  id: string,
  hospitalId: string,
): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  const found = await model.exists(
    tenantScoped<T>(hospitalId, { _id: id } as FilterQuery<T>),
  );
  return Boolean(found);
}

/**
 * Escapes regex metacharacters so a user-supplied search string is matched
 * literally instead of being interpreted as a pattern (which would allow
 * catastrophic backtracking against the database).
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A case-insensitive "contains" matcher for a user-supplied search term.
 *
 * IMPORTANT: `sanitizeFilter` is enabled globally (see lib/db/connect.ts). It
 * defends against query-selector injection by wrapping ANY object value whose
 * keys start with `$` in an `$eq` — which would turn this operator into a
 * literal comparison against the object itself. `mongoose.trusted()` marks the
 * operator as deliberately written by us rather than arriving from a request
 * body, so it is left intact.
 *
 * Every intentional query operator in this codebase must be wrapped the same
 * way. Forgetting produces a loud CastError, not a silent security hole.
 */
export function regexSearch(term: string) {
  return mongoose.trusted({ $regex: escapeRegex(term), $options: "i" });
}

export type PaginationParams = { page: number; pageSize: number };

export function paginationSkip({ page, pageSize }: PaginationParams): number {
  return (page - 1) * pageSize;
}

export function paginationMeta(
  { page, pageSize }: PaginationParams,
  total: number,
) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
