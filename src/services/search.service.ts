import { connectToDatabase } from "@/lib/db/connect";
import { Doctor, Hospital, Invoice, Patient } from "@/models";
import { regexSearch, tenantScoped } from "@/lib/tenant/scope";
import { DEFAULT_CURRENCY, formatMoney } from "@/utils/money";
import type { AuthContext } from "@/types";
import type { Permission } from "@/lib/rbac/permissions";

/**
 * Workspace quick search — the omnibox in the application header.
 *
 * Two rules make this safe to put on every page:
 *
 *   1. Every query is tenant-scoped, so one hospital can never surface
 *      another's records however the term is crafted.
 *   2. A collection is only searched when the caller holds its `.view`
 *      permission. A receptionist searching "INV-000012" gets nothing back
 *      because invoices are never queried for them, not because the row was
 *      filtered out afterwards.
 *
 * The term is matched literally: `regexSearch` escapes metacharacters, so a
 * search for `.*` finds patients whose details contain that text rather than
 * scanning the whole collection.
 */

export type SearchHitType = "patient" | "doctor" | "invoice";

export type SearchHit = {
  id: string;
  type: SearchHitType;
  title: string;
  subtitle: string;
  /** Where selecting the hit navigates to. */
  href: string;
};

export type SearchResults = {
  query: string;
  hits: SearchHit[];
};

/** Per collection. Enough to be useful in a dropdown, small enough to stay fast. */
const PER_TYPE = 5;

function has(user: AuthContext, permission: Permission): boolean {
  return !user.isSuperAdmin && user.permissions.includes(permission);
}

export async function searchWorkspace(
  user: AuthContext & { hospitalId: string },
  term: string,
): Promise<SearchResults> {
  const query = term.trim();

  // A single character matches almost everything; not worth a database round
  // trip, and the dropdown would be noise.
  if (query.length < 2) return { query, hits: [] };

  await connectToDatabase();

  const hospitalId = user.hospitalId;
  const canPatients = has(user, "patient.view");
  const canDoctors = has(user, "doctor.view");
  const canInvoices = has(user, "invoice.view");

  const matcher = regexSearch(query);

  const [patients, doctors, invoices, hospital] = await Promise.all([
    canPatients
      ? Patient.find(
          tenantScoped(hospitalId, {
            $or: [
              { firstName: matcher },
              { lastName: matcher },
              { phone: matcher },
              { patientNumber: matcher },
              { email: matcher },
            ],
          }),
        )
          .sort({ lastName: 1, firstName: 1 })
          .limit(PER_TYPE)
          .select("firstName lastName patientNumber phone")
          .lean()
      : [],
    canDoctors
      ? Doctor.find(
          tenantScoped(hospitalId, {
            $or: [{ displayName: matcher }, { specialization: matcher }],
          }),
        )
          .sort({ displayName: 1 })
          .limit(PER_TYPE)
          .select("displayName specialization status")
          .lean()
      : [],
    canInvoices
      ? Invoice.find(tenantScoped(hospitalId, { invoiceNumber: matcher }))
          .sort({ createdAt: -1 })
          .limit(PER_TYPE)
          .select("invoiceNumber totalMinor status")
          .lean()
      : [],
    canInvoices
      ? Hospital.findById(hospitalId).select("currency").lean()
      : null,
  ]);

  const currency = hospital?.currency ?? DEFAULT_CURRENCY;

  const hits: SearchHit[] = [
    ...patients.map((patient) => ({
      id: String(patient._id),
      type: "patient" as const,
      title: `${patient.firstName} ${patient.lastName}`.trim(),
      subtitle: [patient.patientNumber, patient.phone]
        .filter(Boolean)
        .join(" · "),
      href: `/patients/${String(patient._id)}`,
    })),
    ...doctors.map((doctor) => ({
      id: String(doctor._id),
      type: "doctor" as const,
      title: doctor.displayName,
      subtitle:
        [doctor.specialization, doctor.status === "inactive" ? "Inactive" : ""]
          .filter(Boolean)
          .join(" · ") || "Doctor",
      href: `/doctors?search=${encodeURIComponent(doctor.displayName)}`,
    })),
    ...invoices.map((invoice) => ({
      id: String(invoice._id),
      type: "invoice" as const,
      title: invoice.invoiceNumber,
      subtitle: `${formatMoney(invoice.totalMinor, currency)} · ${invoice.status}`,
      href: `/billing?search=${encodeURIComponent(invoice.invoiceNumber)}`,
    })),
  ];

  return { query, hits };
}
