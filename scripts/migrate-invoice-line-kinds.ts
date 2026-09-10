/**
 * One-off migration: stamps `kind` onto invoice lines written before the field
 * existed, so old invoices break down field-wise like new ones.
 *
 *   npx tsx scripts/migrate-invoice-line-kinds.ts
 *
 * Without it those lines fall back to "treatment or ad-hoc" on read, which puts
 * every historical consultation fee in the "other charges" bucket.
 *
 * Classification, in order:
 *   - a line with a `treatmentId`            -> treatment
 *   - a line whose description begins with
 *     "Consultation" (how billing.service
 *     has always labelled a doctor's fee)    -> consultation, and its doctorId
 *     is recovered from the invoice's appointment where there is one
 *   - anything else                          -> adhoc
 *
 * The description match is a heuristic and is the reason this is a migration
 * rather than something done silently on read: guessing is acceptable once,
 * under a script someone ran deliberately, and not on every request.
 *
 * Safe to run repeatedly.
 */
import { config } from "dotenv";
import mongoose from "mongoose";

config({ path: ".env.local" });
config({ path: ".env" });

async function main(): Promise<void> {
  const { connectToDatabase } = await import("../src/lib/db/connect");
  await connectToDatabase();

  console.log(`Connected to ${mongoose.connection.db?.databaseName}\n`);

  const db = mongoose.connection.db!;
  const invoices = db.collection("invoices");
  const appointments = db.collection("appointments");

  const pending = await invoices
    .find({ "items.kind": { $exists: false } })
    .toArray();

  console.log(`invoices with unstamped lines: ${pending.length}`);

  let treatment = 0;
  let consultation = 0;
  let adhoc = 0;

  for (const invoice of pending) {
    const appointment = invoice.appointmentId
      ? await appointments.findOne({ _id: invoice.appointmentId })
      : null;

    const items = (invoice.items ?? []).map((item: Record<string, unknown>) => {
      if (item.kind) return item;

      if (item.treatmentId) {
        treatment += 1;
        return { ...item, kind: "treatment", doctorId: null };
      }

      if (String(item.description ?? "").startsWith("Consultation")) {
        consultation += 1;
        return {
          ...item,
          kind: "consultation",
          // Recoverable only when the invoice came from a booking.
          doctorId: appointment?.doctorId ?? null,
        };
      }

      adhoc += 1;
      return { ...item, kind: "adhoc", doctorId: null };
    });

    await invoices.updateOne({ _id: invoice._id }, { $set: { items } });
  }

  console.log(`\nlines stamped:`);
  console.log(`  treatment:    ${treatment}`);
  console.log(`  consultation: ${consultation}`);
  console.log(`  adhoc:        ${adhoc}`);

  const remaining = await invoices.countDocuments({
    "items.kind": { $exists: false },
  });
  console.log(`\ninvoices still unstamped: ${remaining}`);
}

main()
  .catch((error: unknown) => {
    console.error(
      "\nmigrate-invoice-line-kinds failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
