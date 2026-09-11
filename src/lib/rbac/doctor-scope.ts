import { connectToDatabase } from "@/lib/db/connect";
import { Doctor } from "@/models";
import { tenantScoped } from "@/lib/tenant/scope";

/**
 * The doctor profile a signed-in user IS, if any.
 *
 * This is what narrows clinical listings to one clinician: a doctor's schedule
 * is their own, and an appointment the front desk assigned to a colleague is
 * not theirs to read. Staff who are not clinicians — the front desk, an
 * administrator, an accountant — have no doctor profile, so nothing narrows for
 * them and they keep the hospital-wide view their job needs.
 *
 * `null` therefore means "do not narrow", NOT "no access". Whether the data is
 * readable at all is still decided by the permission on the route.
 *
 * `Doctor.userId` is unique per tenant, so this resolves to at most one
 * profile. Kept here rather than in a service because appointments, visits and
 * the dashboard all have to apply the identical rule — three copies of it would
 * be three chances for one screen to disagree with another.
 */
export async function ownDoctorId(
  userId: string,
  hospitalId: string,
): Promise<string | null> {
  await connectToDatabase();

  const doctor = await Doctor.findOne(tenantScoped(hospitalId, { userId }))
    .select("_id")
    .lean();

  return doctor ? String(doctor._id) : null;
}
