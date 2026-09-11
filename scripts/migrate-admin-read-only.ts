/**
 * One-off migration: makes every existing Hospital Admin role read-only over
 * operational records, matching the new default in lib/rbac/default-roles.ts.
 *
 *   npx tsx scripts/migrate-admin-read-only.ts
 *
 * Roles are seeded once, at hospital creation, so changing the template only
 * reaches NEW hospitals. Without this an existing admin keeps every permission
 * and still sees Register patient, Write prescription and the invoice actions.
 *
 * What it does, per hospital, to the `hospital_admin` role only:
 *   - REMOVES  patient/appointment/visit/prescription/invoice/payment writes
 *   - KEEPS    the matching `.view` of each, and everything to do with running
 *              the hospital: doctors, treatments, departments, staff, roles,
 *              settings, audit
 *
 * This TAKES PERMISSIONS AWAY, which is the point, but it is worth saying
 * plainly: an admin who was entering patients or invoices will stop being able
 * to. Permissions on a system role stay editable, so anything here can be
 * granted back from the Roles screen without a migration.
 *
 * Safe to run repeatedly.
 */
import { config } from "dotenv";
import mongoose from "mongoose";
import { DEFAULT_ROLE_TEMPLATES } from "../src/lib/rbac/default-roles";

config({ path: ".env.local" });
config({ path: ".env" });

async function main(): Promise<void> {
  const { connectToDatabase } = await import("../src/lib/db/connect");
  await connectToDatabase();

  console.log(`Connected to ${mongoose.connection.db?.databaseName}\n`);

  const template = DEFAULT_ROLE_TEMPLATES.find(
    (t) => t.key === "hospital_admin",
  );
  if (!template) throw new Error("No hospital_admin template found.");

  const wanted = [...template.permissions];
  const roles = mongoose.connection.db!.collection("roles");

  const admins = await roles.find({ key: "hospital_admin" }).toArray();
  console.log(`hospital_admin roles: ${admins.length}`);

  let changed = 0;
  const removedTally = new Map<string, number>();

  for (const role of admins) {
    const current: string[] = (role.permissions ?? []) as string[];
    const removed = current.filter((p) => !wanted.includes(p as never));

    if (removed.length === 0) continue;

    for (const p of removed) {
      removedTally.set(p, (removedTally.get(p) ?? 0) + 1);
    }

    await roles.updateOne(
      { _id: role._id },
      { $set: { permissions: wanted, description: template.description } },
    );
    changed += 1;
  }

  console.log(`roles updated: ${changed}`);

  if (removedTally.size > 0) {
    console.log("\npermissions removed (role count):");
    for (const [permission, count] of [...removedTally].sort()) {
      console.log(`  ${permission}: ${count}`);
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      "\nmigrate-admin-read-only failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
