import mongoose, { type ClientSession } from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { runAtomically } from "@/lib/db/transaction";
import { Hospital, Role, User, type HospitalDoc } from "@/models";
import {
  DEFAULT_ROLE_TEMPLATES,
  HOSPITAL_ADMIN_ROLE_KEY,
} from "@/lib/rbac/default-roles";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { uniqueSlug } from "@/utils/slug";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import { revokeAllUserTokens } from "@/services/auth.service";
import { regexSearch } from "@/lib/tenant/scope";
import type { CreateHospitalInput, UpdateHospitalInput } from "@/schemas/hospital.schema";
import type { HospitalStatus, Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

export type HospitalSummary = {
  id: string;
  name: string;
  slug: string;
  type: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  status: HospitalStatus;
  admin: { id: string; name: string; email: string } | null;
  createdAt: string;
};

function toSummary(
  hospital: HospitalDoc,
  admin: { _id: unknown; name: string; email: string } | null,
): HospitalSummary {
  return {
    id: String(hospital._id),
    name: hospital.name,
    slug: hospital.slug,
    type: hospital.type,
    email: hospital.email,
    phone: hospital.phone,
    city: hospital.city ?? "",
    country: hospital.country ?? "",
    status: hospital.status as HospitalStatus,
    admin: admin
      ? { id: String(admin._id), name: admin.name, email: admin.email }
      : null,
    createdAt: hospital.createdAt.toISOString(),
  };
}

// --------------------------------------------------------------------------
// Creation (Sections 4, 46, 47)
// --------------------------------------------------------------------------

export type CreateHospitalResult = {
  hospital: HospitalSummary;
  /**
   * Returned to the Super Admin exactly once, in the creation response only.
   * It is never persisted in plain text and no endpoint can retrieve it later.
   */
  temporaryPassword: string;
};

export async function createHospitalWithAdmin(
  input: CreateHospitalInput,
  actor: { userId: string },
  meta: RequestMeta,
): Promise<CreateHospitalResult> {
  await connectToDatabase();

  const temporaryPassword =
    input.temporaryPassword ?? generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const slug = await uniqueSlug(input.name, async (candidate) =>
    Boolean(await Hospital.exists({ slug: candidate })),
  );

  // Tracks what the fallback path created, so a failure can be compensated
  // when the deployment has no transaction support.
  const created: { hospitalId?: mongoose.Types.ObjectId } = {};

  const hospital = await runAtomically(
    async (session: ClientSession | null) => {
      const opts = session ? { session } : {};

      // 1. Hospital
      const [hospitalDoc] = await Hospital.create(
        [
          {
            name: input.name,
            slug,
            type: input.type,
            email: input.email,
            phone: input.phone,
            logo: input.logo || null,
            address: input.address,
            city: input.city,
            state: input.state,
            country: input.country,
            postalCode: input.postalCode,
            status: input.status,
            currency: input.currency,
            tokenVersion: 0,
          },
        ],
        opts,
      );

      if (!hospitalDoc) throw ApiError.internal("Hospital could not be created.");
      created.hospitalId = hospitalDoc._id;

      // 2. Default roles for this tenant (Section 48)
      const roleDocs = await Role.create(
        DEFAULT_ROLE_TEMPLATES.map((template) => ({
          hospitalId: hospitalDoc._id,
          name: template.name,
          key: template.key,
          description: template.description,
          permissions: template.permissions,
          isSystem: true,
        })),
        opts,
      );

      const adminRole = roleDocs.find(
        (role) => role.key === HOSPITAL_ADMIN_ROLE_KEY,
      );
      if (!adminRole) {
        throw ApiError.internal("Default roles could not be created.");
      }

      // 3. Hospital Admin, holding only the hash of the temporary password
      const [adminUser] = await User.create(
        [
          {
            hospitalId: hospitalDoc._id,
            name: input.adminName,
            email: input.adminEmail,
            passwordHash,
            roleId: adminRole._id,
            isSuperAdmin: false,
            status: "active",
            mustChangePassword: true,
            tokenVersion: 0,
          },
        ],
        opts,
      );

      if (!adminUser) {
        throw ApiError.internal("Hospital administrator could not be created.");
      }

      // 4. Audit trail — joins the transaction so it rolls back with everything
      // else. No credentials are recorded.
      await recordAudit(
        {
          hospitalId: String(hospitalDoc._id),
          userId: actor.userId,
          action: "hospital.created",
          resource: "Hospital",
          resourceId: String(hospitalDoc._id),
          metadata: {
            name: hospitalDoc.name,
            slug: hospitalDoc.slug,
            type: hospitalDoc.type,
            adminEmail: adminUser.email,
            adminUserId: String(adminUser._id),
          },
          meta,
        },
        session,
      );

      return toSummary(hospitalDoc, adminUser);
    },
    {
      // Non-transactional fallback only: unwind whatever was written.
      compensate: async () => {
        if (!created.hospitalId) return;
        await Promise.allSettled([
          User.deleteMany({ hospitalId: created.hospitalId }),
          Role.deleteMany({ hospitalId: created.hospitalId }),
          Hospital.deleteOne({ _id: created.hospitalId }),
        ]);
      },
    },
  ).catch((error: unknown) => {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict(
        "A hospital with that name, or an administrator with that email, already exists.",
      );
    }
    throw error;
  });

  return { hospital, temporaryPassword };
}

// --------------------------------------------------------------------------
// Reads
// --------------------------------------------------------------------------

export type ListHospitalsParams = {
  page: number;
  pageSize: number;
  search?: string;
  status?: HospitalStatus;
};

export async function listHospitals(
  params: ListHospitalsParams,
): Promise<Paginated<HospitalSummary>> {
  await connectToDatabase();

  const filter: Record<string, unknown> = {};
  if (params.status) filter.status = params.status;

  if (params.search) {
    // regexSearch escapes metacharacters AND marks the operator as trusted, so
    // the globally enabled sanitizeFilter does not neutralise it.
    const matcher = regexSearch(params.search);
    filter.$or = [{ name: matcher }, { email: matcher }, { city: matcher }];
  }

  const skip = (params.page - 1) * params.pageSize;

  const [hospitals, total] = await Promise.all([
    Hospital.find(filter).sort({ createdAt: -1 }).skip(skip).limit(params.pageSize),
    Hospital.countDocuments(filter),
  ]);

  // One query for the admins of the page's hospitals, rather than N queries.
  const admins = await User.find({
    hospitalId: mongoose.trusted({ $in: hospitals.map((h) => h._id) }),
    isSuperAdmin: false,
  })
    .select("hospitalId name email roleId")
    .populate<{ roleId: { key: string | null } | null }>("roleId", "key")
    .lean();

  const adminByHospital = new Map<string, { _id: unknown; name: string; email: string }>();
  for (const admin of admins) {
    if (admin.roleId?.key !== HOSPITAL_ADMIN_ROLE_KEY) continue;
    const key = String(admin.hospitalId);
    if (!adminByHospital.has(key)) {
      adminByHospital.set(key, {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
      });
    }
  }

  return {
    items: hospitals.map((hospital) =>
      toSummary(hospital, adminByHospital.get(String(hospital._id)) ?? null),
    ),
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}

export async function getHospital(id: string): Promise<HospitalSummary> {
  await connectToDatabase();

  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound("Hospital not found.");

  const hospital = await Hospital.findById(id);
  if (!hospital) throw ApiError.notFound("Hospital not found.");

  const admin = await User.findOne({ hospitalId: hospital._id })
    .select("name email roleId")
    .populate<{ roleId: { key: string | null } | null }>("roleId", "key")
    .lean();

  const adminSummary =
    admin && admin.roleId?.key === HOSPITAL_ADMIN_ROLE_KEY
      ? { _id: admin._id, name: admin.name, email: admin.email }
      : null;

  return toSummary(hospital, adminSummary);
}

export type PlatformStats = {
  total: number;
  active: number;
  inactive: number;
  suspended: number;
  recent: HospitalSummary[];
};

export async function getPlatformStats(): Promise<PlatformStats> {
  await connectToDatabase();

  const [counts, recent] = await Promise.all([
    Hospital.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Hospital.find().sort({ createdAt: -1 }).limit(5),
  ]);

  const byStatus = new Map(counts.map((row) => [row._id, row.count]));

  return {
    total: counts.reduce((sum, row) => sum + row.count, 0),
    active: byStatus.get("active") ?? 0,
    inactive: byStatus.get("inactive") ?? 0,
    suspended: byStatus.get("suspended") ?? 0,
    recent: recent.map((hospital) => toSummary(hospital, null)),
  };
}

// --------------------------------------------------------------------------
// Updates
// --------------------------------------------------------------------------

export async function updateHospital(
  id: string,
  input: UpdateHospitalInput,
  actor: { userId: string },
  meta: RequestMeta,
): Promise<HospitalSummary> {
  await connectToDatabase();

  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound("Hospital not found.");

  const hospital = await Hospital.findById(id);
  if (!hospital) throw ApiError.notFound("Hospital not found.");

  // `status` is deliberately absent here — it flows through
  // changeHospitalStatus so the tokenVersion bump can never be skipped.
  Object.assign(hospital, input);
  await hospital.save();

  await recordAudit({
    hospitalId: String(hospital._id),
    userId: actor.userId,
    action: "hospital.updated",
    resource: "Hospital",
    resourceId: String(hospital._id),
    metadata: { fields: Object.keys(input) },
    meta,
  });

  return toSummary(hospital, null);
}

/**
 * Changes hospital status and, on any transition away from `active`, bumps
 * `Hospital.tokenVersion`.
 *
 * That single write invalidates every outstanding access token belonging to
 * every user of the tenant, with no bulk update of the User collection
 * (Section 8a). Refresh tokens are revoked separately so no new access token
 * can be minted either.
 */
export async function changeHospitalStatus(
  id: string,
  status: HospitalStatus,
  actor: { userId: string },
  meta: RequestMeta,
): Promise<HospitalSummary> {
  await connectToDatabase();

  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound("Hospital not found.");

  const hospital = await Hospital.findById(id);
  if (!hospital) throw ApiError.notFound("Hospital not found.");

  const previous = hospital.status;
  if (previous === status) return toSummary(hospital, null);

  hospital.status = status;
  // Bump on every transition, including back to active: a token minted while
  // the hospital was active must not survive a suspend-then-reactivate cycle.
  hospital.tokenVersion += 1;
  await hospital.save();

  if (status !== "active") {
    // Stop the refresh endpoint handing out fresh access tokens.
    const users = await User.find({ hospitalId: hospital._id }).select("_id").lean();
    await Promise.all(
      users.map((user) => revokeAllUserTokens(String(user._id))),
    );
  }

  await recordAudit({
    hospitalId: String(hospital._id),
    userId: actor.userId,
    action: `hospital.status_changed`,
    resource: "Hospital",
    resourceId: String(hospital._id),
    metadata: { from: previous, to: status, tokenVersion: hospital.tokenVersion },
    meta,
  });

  return toSummary(hospital, null);
}
