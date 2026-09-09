import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import {
  Appointment,
  Department,
  Hospital,
  Invoice,
  Treatment,
  Visit,
} from "@/models";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import {
  assertBelongsToTenant,
  paginationMeta,
  paginationSkip,
  regexSearch,
  tenantScoped,
} from "@/lib/tenant/scope";
import {
  DEFAULT_CURRENCY,
  formatMoney,
  hasValidPrecision,
  toMajorUnits,
  toMinorUnits,
} from "@/utils/money";
import type {
  CreateTreatmentInput,
  UpdateTreatmentInput,
} from "@/schemas/treatment.schema";
import type { EntityStatus, Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

export type TreatmentSummary = {
  id: string;
  name: string;
  description: string;
  department: { id: string; name: string } | null;
  /** Major units, e.g. 19.99. */
  price: number;
  /** Integer minor units — the stored value, exposed for exact client maths. */
  priceMinor: number;
  currency: string;
  priceFormatted: string;
  durationMinutes: number;
  status: EntityStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type Actor = { userId: string; hospitalId: string };

/**
 * The hospital's billing currency. Every price in this service is interpreted
 * against it, so it is read once per operation rather than assumed.
 */
async function hospitalCurrency(hospitalId: string): Promise<string> {
  const hospital = await Hospital.findById(hospitalId).select("currency").lean();
  return hospital?.currency ?? DEFAULT_CURRENCY;
}

function toSummary(
  treatment: {
    _id: unknown;
    name: string;
    description?: string | null;
    departmentId: unknown;
    priceMinor: number;
    durationMinutes: number;
    status: string;
    metadata?: unknown;
    createdAt: Date;
  },
  currency: string,
  department: { id: string; name: string } | null,
): TreatmentSummary {
  return {
    id: String(treatment._id),
    name: treatment.name,
    description: treatment.description ?? "",
    department,
    price: toMajorUnits(treatment.priceMinor, currency),
    priceMinor: treatment.priceMinor,
    currency,
    priceFormatted: formatMoney(treatment.priceMinor, currency),
    durationMinutes: treatment.durationMinutes,
    status: treatment.status as EntityStatus,
    metadata: (treatment.metadata as Record<string, unknown>) ?? {},
    createdAt: treatment.createdAt.toISOString(),
  };
}

/**
 * Converts a major-unit price to storable minor units, rejecting more precision
 * than the currency supports (100.5 is meaningless in JPY).
 */
function priceToMinor(price: number, currency: string): number {
  if (!hasValidPrecision(price, currency)) {
    throw ApiError.validation("That price has too many decimal places.", {
      fields: {
        price: `Price must match the precision of ${currency}.`,
      },
    });
  }
  return toMinorUnits(price, currency);
}

/**
 * Cross-tenant relationship validation (Section 10). A departmentId belonging
 * to another hospital resolves to nothing and 404s, so a Hospital A treatment
 * can never be filed under a Hospital B department.
 */
async function resolveDepartment(
  departmentId: string,
  hospitalId: string,
): Promise<{ id: string; name: string }> {
  const department = await assertBelongsToTenant(
    Department,
    departmentId,
    hospitalId,
    "Department",
  );
  return { id: String(department._id), name: department.name };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listTreatments(
  hospitalId: string,
  params: {
    page: number;
    pageSize: number;
    search?: string;
    status?: EntityStatus;
    departmentId?: string;
  },
): Promise<Paginated<TreatmentSummary>> {
  await connectToDatabase();

  const filter = tenantScoped(hospitalId, {
    ...(params.status ? { status: params.status } : {}),
    ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    ...(params.search ? { name: regexSearch(params.search) } : {}),
  });

  const [treatments, total, currency] = await Promise.all([
    Treatment.find(filter)
      .sort({ name: 1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .populate<{ departmentId: { _id: unknown; name: string } | null }>(
        "departmentId",
        "name",
      )
      .lean(),
    Treatment.countDocuments(filter),
    hospitalCurrency(hospitalId),
  ]);

  return {
    items: treatments.map((treatment) =>
      toSummary(
        treatment,
        currency,
        treatment.departmentId
          ? {
              id: String(treatment.departmentId._id),
              name: treatment.departmentId.name,
            }
          : null,
      ),
    ),
    ...paginationMeta(params, total),
  };
}

export async function getTreatment(
  treatmentId: string,
  hospitalId: string,
): Promise<TreatmentSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(Treatment, treatmentId, hospitalId, "Treatment");

  const [treatment, currency] = await Promise.all([
    Treatment.findOne(tenantScoped(hospitalId, { _id: treatmentId }))
      .populate<{ departmentId: { _id: unknown; name: string } | null }>(
        "departmentId",
        "name",
      )
      .lean(),
    hospitalCurrency(hospitalId),
  ]);

  if (!treatment) throw ApiError.notFound("Treatment not found.");

  return toSummary(
    treatment,
    currency,
    treatment.departmentId
      ? {
          id: String(treatment.departmentId._id),
          name: treatment.departmentId.name,
        }
      : null,
  );
}

/**
 * Authoritative price lookup for billing (Section 27).
 *
 * Phase 7 invoice generation MUST call this rather than trusting any amount
 * sent by the client: it resolves the treatment within the caller's own tenant
 * and returns the price currently configured in the database.
 */
export async function getTreatmentPrice(
  treatmentId: string,
  hospitalId: string,
): Promise<{ priceMinor: number; currency: string; name: string }> {
  await connectToDatabase();

  const treatment = await assertBelongsToTenant(
    Treatment,
    treatmentId,
    hospitalId,
    "Treatment",
  );

  return {
    priceMinor: treatment.priceMinor,
    currency: await hospitalCurrency(hospitalId),
    name: treatment.name,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createTreatment(
  input: CreateTreatmentInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<TreatmentSummary> {
  await connectToDatabase();

  const department = await resolveDepartment(
    input.departmentId,
    actor.hospitalId,
  );

  const currency = await hospitalCurrency(actor.hospitalId);
  const priceMinor = priceToMinor(input.price, currency);

  try {
    const treatment = await Treatment.create({
      hospitalId: actor.hospitalId,
      departmentId: department.id,
      name: input.name,
      description: input.description,
      priceMinor,
      durationMinutes: input.durationMinutes,
      status: input.status,
      metadata: input.metadata,
    });

    await recordAudit({
      hospitalId: actor.hospitalId,
      userId: actor.userId,
      action: "treatment.created",
      resource: "Treatment",
      resourceId: String(treatment._id),
      metadata: {
        name: treatment.name,
        departmentId: department.id,
        priceMinor,
        currency,
      },
      meta,
    });

    return toSummary(treatment, currency, department);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict(
        "A treatment with that name already exists in this department.",
      );
    }
    throw error;
  }
}

export async function updateTreatment(
  treatmentId: string,
  input: UpdateTreatmentInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<TreatmentSummary> {
  await connectToDatabase();

  await assertBelongsToTenant(
    Treatment,
    treatmentId,
    actor.hospitalId,
    "Treatment",
  );

  const treatment = await Treatment.findOne(
    tenantScoped(actor.hospitalId, { _id: treatmentId }),
  );
  if (!treatment) throw ApiError.notFound("Treatment not found.");

  const currency = await hospitalCurrency(actor.hospitalId);

  if (input.departmentId !== undefined) {
    // Re-validated on every move, so a treatment cannot be relocated into
    // another tenant's department.
    const department = await resolveDepartment(
      input.departmentId,
      actor.hospitalId,
    );
    treatment.departmentId = new mongoose.Types.ObjectId(department.id);
  }

  if (input.name !== undefined) treatment.name = input.name;
  if (input.description !== undefined) treatment.description = input.description;
  if (input.price !== undefined) {
    treatment.priceMinor = priceToMinor(input.price, currency);
  }
  if (input.durationMinutes !== undefined) {
    treatment.durationMinutes = input.durationMinutes;
  }
  if (input.status !== undefined) treatment.status = input.status;
  if (input.metadata !== undefined) treatment.metadata = input.metadata;

  try {
    await treatment.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict(
        "A treatment with that name already exists in this department.",
      );
    }
    throw error;
  }

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "treatment.updated",
    resource: "Treatment",
    resourceId: treatmentId,
    metadata: {
      fields: Object.keys(input),
      name: treatment.name,
      ...(input.price !== undefined
        ? { priceMinor: treatment.priceMinor, currency }
        : {}),
    },
    meta,
  });

  return getTreatment(treatmentId, actor.hospitalId);
}

export async function deleteTreatment(
  treatmentId: string,
  actor: Actor,
  meta: RequestMeta,
): Promise<void> {
  await connectToDatabase();

  const treatment = await assertBelongsToTenant(
    Treatment,
    treatmentId,
    actor.hospitalId,
    "Treatment",
  );

  /**
   * Appointments reference treatments, so deleting one out from under a booking
   * would orphan it. Mirrors the department and role guards.
   *
   * Phase 7 adds invoice items, which will need the same check here.
   */
  const [appointmentCount, visitCount, invoiceCount] = await Promise.all([
    Appointment.countDocuments(tenantScoped(actor.hospitalId, { treatmentId })),
    Visit.countDocuments(tenantScoped(actor.hospitalId, { treatmentId })),
    // Invoice lines embed the treatment id, so a billed treatment is referenced.
    Invoice.countDocuments(
      tenantScoped(actor.hospitalId, { "items.treatmentId": treatmentId }),
    ),
  ]);

  if (appointmentCount > 0 || visitCount > 0 || invoiceCount > 0) {
    const parts = [
      appointmentCount > 0
        ? `${appointmentCount} ${appointmentCount === 1 ? "appointment" : "appointments"}`
        : null,
      visitCount > 0
        ? `${visitCount} ${visitCount === 1 ? "visit" : "visits"}`
        : null,
      invoiceCount > 0
        ? `${invoiceCount} ${invoiceCount === 1 ? "invoice" : "invoices"}`
        : null,
    ].filter(Boolean);

    throw ApiError.conflict(
      `This treatment is used by ${parts.join(" and ")}. Deactivate it instead to remove it from new bookings.`,
    );
  }

  await Treatment.deleteOne(
    tenantScoped(actor.hospitalId, { _id: treatmentId }),
  );

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "treatment.deleted",
    resource: "Treatment",
    resourceId: treatmentId,
    metadata: { name: treatment.name },
    meta,
  });
}
