/**
 * One-off migration: `in_progress` was removed from the appointment status
 * enum, leaving confirmed → checked_in → completed as the front-desk
 * progression.
 *
 *   npx tsx scripts/migrate-appointment-statuses.ts
 *
 * Any row still holding `in_progress` is moved to `checked_in` — the patient is
 * with the hospital but the visit is not finished, which is what in-progress
 * meant. Left alone, such a row has no entry in the status transition table or
 * the UI tone map, so the appointments board throws when it renders.
 *
 * Safe to run repeatedly; it is a no-op once there are no stale rows.
 */
import { config } from "dotenv";
import mongoose from "mongoose";

config({ path: ".env.local" });
config({ path: ".env" });

async function main(): Promise<void> {
  const { connectToDatabase } = await import("../src/lib/db/connect");
  await connectToDatabase();
  console.log(`Connected to ${mongoose.connection.db?.databaseName}`);

  const collection = mongoose.connection.db!.collection("appointments");
  const stale = await collection.countDocuments({ status: "in_progress" });
  console.log(`appointments with status=in_progress: ${stale}`);

  if (stale > 0) {
    // occupiesSlot is unchanged in substance (both statuses hold the slot), but
    // it is set explicitly so the derived field cannot drift.
    const result = await collection.updateMany(
      { status: "in_progress" },
      { $set: { status: "checked_in", occupiesSlot: true } },
    );
    console.log(`migrated ${result.modifiedCount} to checked_in`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      "\nmigrate-appointment-statuses failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
