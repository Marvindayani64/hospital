import { connectToDatabase } from "@/lib/db/connect";
import { AuditLog, Hospital, User } from "@/models";
import { ApiError, isDuplicateKeyError } from "@/lib/api/errors";
import { recordAudit } from "@/services/audit.service";
import {
  escapeRegex,
  paginationMeta,
  paginationSkip,
  tenantScoped,
} from "@/lib/tenant/scope";
import { getCurrency } from "@/utils/money";
import mongoose from "mongoose";
import type { UpdateSettingsInput } from "@/schemas/settings.schema";
import type { Paginated } from "@/types";
import type { RequestMeta } from "@/utils/request";

export type HospitalSettings = {
  id: string;
  name: string;
  slug: string;
  type: string;
  email: string;
  phone: string;
  logo: string | null;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;

  /** Platform-controlled; shown read-only so the tenant knows where it stands. */
  status: string;
  currency: string;
  currencyName: string;

  defaultTaxRatePercent: number;
  invoicePrefix: string;
  invoiceFooter: string;
  appointmentSlotMinutes: number;
  notifications: {
    appointmentReminders: boolean;
    invoiceIssued: boolean;
    followUpReminders: boolean;
  };
};

type Actor = { userId: string; hospitalId: string };

function toSettings(hospital: {
  _id: unknown;
  name: string;
  slug: string;
  type: string;
  email: string;
  phone: string;
  logo?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  status: string;
  currency: string;
  defaultTaxRatePercent: number;
  settings?: {
    invoicePrefix?: string | null;
    invoiceFooter?: string | null;
    appointmentSlotMinutes?: number | null;
    notifications?: {
      appointmentReminders?: boolean;
      invoiceIssued?: boolean;
      followUpReminders?: boolean;
    } | null;
  } | null;
}): HospitalSettings {
  const settings = hospital.settings ?? {};
  const notifications = settings.notifications ?? {};

  return {
    id: String(hospital._id),
    name: hospital.name,
    slug: hospital.slug,
    type: hospital.type,
    email: hospital.email,
    phone: hospital.phone,
    logo: hospital.logo ?? null,
    address: hospital.address ?? "",
    city: hospital.city ?? "",
    state: hospital.state ?? "",
    country: hospital.country ?? "",
    postalCode: hospital.postalCode ?? "",

    status: hospital.status,
    currency: hospital.currency,
    currencyName: getCurrency(hospital.currency).name,

    defaultTaxRatePercent: hospital.defaultTaxRatePercent,
    invoicePrefix: settings.invoicePrefix ?? "INV",
    invoiceFooter: settings.invoiceFooter ?? "",
    appointmentSlotMinutes: settings.appointmentSlotMinutes ?? 30,
    notifications: {
      appointmentReminders: notifications.appointmentReminders ?? false,
      invoiceIssued: notifications.invoiceIssued ?? false,
      followUpReminders: notifications.followUpReminders ?? false,
    },
  };
}

export async function getSettings(hospitalId: string): Promise<HospitalSettings> {
  await connectToDatabase();

  const hospital = await Hospital.findById(hospitalId).lean();
  if (!hospital) throw ApiError.notFound("Hospital not found.");

  return toSettings(hospital);
}

export async function updateSettings(
  input: UpdateSettingsInput,
  actor: Actor,
  meta: RequestMeta,
): Promise<HospitalSettings> {
  await connectToDatabase();

  /**
   * Scoped to the actor's own hospital, so a Hospital Admin can only ever edit
   * their own tenant — there is no id in the request to point elsewhere.
   */
  const hospital = await Hospital.findById(actor.hospitalId);
  if (!hospital) throw ApiError.notFound("Hospital not found.");

  const profileFields = [
    "name",
    "email",
    "phone",
    "address",
    "city",
    "state",
    "country",
    "postalCode",
  ] as const;

  for (const field of profileFields) {
    if (input[field] !== undefined) hospital.set(field, input[field]);
  }

  if (input.logo !== undefined) hospital.logo = input.logo || null;
  if (input.defaultTaxRatePercent !== undefined) {
    hospital.defaultTaxRatePercent = input.defaultTaxRatePercent;
  }

  if (input.invoicePrefix !== undefined) {
    hospital.set("settings.invoicePrefix", input.invoicePrefix);
  }
  if (input.invoiceFooter !== undefined) {
    hospital.set("settings.invoiceFooter", input.invoiceFooter);
  }
  if (input.appointmentSlotMinutes !== undefined) {
    hospital.set("settings.appointmentSlotMinutes", input.appointmentSlotMinutes);
  }

  if (input.notifications) {
    for (const [key, value] of Object.entries(input.notifications)) {
      if (value !== undefined) {
        hospital.set(`settings.notifications.${key}`, value);
      }
    }
  }

  try {
    await hospital.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw ApiError.conflict("A hospital with that name already exists.");
    }
    throw error;
  }

  await recordAudit({
    hospitalId: actor.hospitalId,
    userId: actor.userId,
    action: "hospital.settings_updated",
    resource: "Hospital",
    resourceId: actor.hospitalId,
    metadata: { fields: Object.keys(input) },
    meta,
  });

  return getSettings(actor.hospitalId);
}

// ---------------------------------------------------------------------------
// Audit log (Sections 28, 49)
// ---------------------------------------------------------------------------

export type AuditEntrySummary = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actor: { id: string; name: string; email: string } | null;
  metadata: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
};

export async function listAuditLogs(
  hospitalId: string,
  params: {
    page: number;
    pageSize: number;
    action?: string;
    resource?: string;
    userId?: string;
    from?: string;
    to?: string;
  },
): Promise<Paginated<AuditEntrySummary>> {
  await connectToDatabase();

  const createdAt: Record<string, Date> = {};
  if (params.from) createdAt.$gte = new Date(`${params.from}T00:00:00.000Z`);
  // Inclusive of the whole end day.
  if (params.to) createdAt.$lte = new Date(`${params.to}T23:59:59.999Z`);

  const filter = tenantScoped(hospitalId, {
    ...(params.action
      ? {
          action: mongoose.trusted({
            $regex: escapeRegex(params.action),
            $options: "i",
          }),
        }
      : {}),
    ...(params.resource ? { resource: params.resource } : {}),
    ...(params.userId && mongoose.isValidObjectId(params.userId)
      ? { userId: params.userId }
      : {}),
    ...(Object.keys(createdAt).length > 0
      ? { createdAt: mongoose.trusted(createdAt) }
      : {}),
  });

  const [entries, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(paginationSkip(params))
      .limit(params.pageSize)
      .populate<{ userId: { _id: unknown; name: string; email: string } | null }>(
        "userId",
        "name email",
      )
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  return {
    items: entries.map((entry) => ({
      id: String(entry._id),
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      actor: entry.userId
        ? {
            id: String(entry.userId._id),
            name: entry.userId.name,
            email: entry.userId.email,
          }
        : null,
      // Already redacted on write by audit.service.ts.
      metadata: (entry.metadata as Record<string, unknown>) ?? {},
      ipAddress: entry.ipAddress ?? "",
      userAgent: entry.userAgent ?? "",
      createdAt: entry.createdAt.toISOString(),
    })),
    ...paginationMeta(params, total),
  };
}

/** Distinct action names present in this tenant's log, for the filter UI. */
export async function listAuditActions(hospitalId: string): Promise<string[]> {
  await connectToDatabase();

  const actions = await AuditLog.distinct("action", { hospitalId });
  return (actions as string[]).sort();
}

/** Staff who appear in this tenant's audit log, for the filter UI. */
export async function listAuditActors(
  hospitalId: string,
): Promise<Array<{ id: string; name: string }>> {
  await connectToDatabase();

  const users = await User.find(tenantScoped(hospitalId))
    .select("name")
    .sort({ name: 1 })
    .limit(200)
    .lean();

  return users.map((user) => ({ id: String(user._id), name: user.name }));
}
