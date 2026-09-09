import type { ClientSession } from "mongoose";
import { AuditLog } from "@/models";
import type { RequestMeta } from "@/utils/request";

/**
 * Keys that must never reach the audit log, whatever a caller passes in
 * (Sections 28 and 49). This is a backstop — call sites are expected not to
 * supply them in the first place.
 */
const REDACTED_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "confirmpassword",
  "temporarypassword",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "tokenhash",
  "secret",
  "authorization",
  "cookie",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase())
      ? "[redacted]"
      : redact(item, depth + 1);
  }
  return output;
}

export type AuditEntry = {
  /** `null` for platform-level actions performed by a Super Admin. */
  hospitalId: string | null;
  userId: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
};

/**
 * Writes an audit record. Auditing must never break the operation it is
 * recording, so failures are logged and swallowed — with one exception: when a
 * session is supplied the write joins the caller's transaction and is allowed
 * to fail it, because a rolled-back hospital creation must not leave a
 * "hospital.created" entry behind.
 */
export async function recordAudit(
  entry: AuditEntry,
  session?: ClientSession | null,
): Promise<void> {
  const doc = {
    hospitalId: entry.hospitalId,
    userId: entry.userId,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    metadata: redact(entry.metadata ?? {}) as Record<string, unknown>,
    ipAddress: entry.meta?.ipAddress ?? "",
    userAgent: entry.meta?.userAgent ?? "",
  };

  if (session) {
    await AuditLog.create([doc], { session });
    return;
  }

  try {
    await AuditLog.create(doc);
  } catch (error) {
    console.error("[audit] failed to write audit log:", error);
  }
}
