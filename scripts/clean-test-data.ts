/**
 * Removes hospitals created by the `verify:*` suites, leaving real ones alone.
 *
 *   npm run clean:test-data            # dry run — reports, changes nothing
 *   npm run clean:test-data -- --yes   # actually delete
 *
 * A hospital is treated as test data only when EVERY one of its users has a
 * test-pattern email. One real account is enough to protect the whole tenant,
 * which is the safe direction to err in.
 *
 * Platform Super Admins are never touched.
 */
export {};

import { config } from "dotenv";
import mongoose from "mongoose";

config({ path: ".env.local" });
config({ path: ".env" });

/** Email domains used by the verification suites and the demo seed. */
const TEST_EMAIL =
  /(@example\.test|@testclinic\.example|@x\.test|@admin\.test|@billing\.test|@forms\.test|@visits\.test|@alpha\.test|@hair\.test|@demo[a-z0-9]*\.test)$/i;

/** Every collection that carries a `hospitalId`. */
const TENANT_COLLECTIONS = [
  "appointments",
  "auditlogs",
  "counters",
  "departments",
  "doctors",
  "formfields",
  "formresponses",
  "forms",
  "invoices",
  "patients",
  "payments",
  "refreshtokens",
  "roles",
  "treatments",
  "users",
  "visits",
] as const;

async function main(): Promise<void> {
  const apply = process.argv.includes("--yes");

  await mongoose.connect(process.env.MONGODB_URI!);
  const db = mongoose.connection.db!;
  console.log(`Database: ${db.databaseName}`);
  console.log(apply ? "Mode: DELETE\n" : "Mode: dry run (pass --yes to delete)\n");

  const hospitals = await db.collection("hospitals").find({}).toArray();

  const doomed: Array<{ id: mongoose.Types.ObjectId; name: string }> = [];
  const kept: Array<{ name: string; reason: string }> = [];

  for (const hospital of hospitals) {
    const users = await db
      .collection("users")
      .find({ hospitalId: hospital._id }, { projection: { email: 1 } })
      .toArray();

    const realUser = users.find((u) => !TEST_EMAIL.test(String(u.email)));

    if (realUser) {
      kept.push({ name: hospital.name, reason: String(realUser.email) });
    } else {
      doomed.push({ id: hospital._id, name: hospital.name });
    }
  }

  console.log(`KEEPING ${kept.length} hospital(s):`);
  for (const k of kept) console.log(`  ${k.name}  (real user: ${k.reason})`);

  console.log(`\nREMOVING ${doomed.length} test hospital(s).`);

  if (doomed.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const ids = doomed.map((d) => d.id);
  let total = 0;

  for (const name of TENANT_COLLECTIONS) {
    const filter = { hospitalId: { $in: ids } };
    const count = await db.collection(name).countDocuments(filter);
    if (count === 0) continue;

    if (apply) await db.collection(name).deleteMany(filter);
    total += count;
    console.log(`  ${String(count).padStart(6)}  ${name}`);
  }

  const hospitalFilter = { _id: { $in: ids } };
  if (apply) await db.collection("hospitals").deleteMany(hospitalFilter);
  total += doomed.length;
  console.log(`  ${String(doomed.length).padStart(6)}  hospitals`);

  /**
   * Refresh tokens for platform Super Admins carry `hospitalId: null`, so the
   * tenant sweep above misses them. Expired and revoked ones are dead weight.
   */
  const staleTokens = {
    $or: [
      { expiresAt: { $lt: new Date() } },
      { revokedAt: { $ne: null } },
    ],
  };
  const staleCount = await db.collection("refreshtokens").countDocuments(staleTokens);
  if (staleCount > 0) {
    if (apply) await db.collection("refreshtokens").deleteMany(staleTokens);
    total += staleCount;
    console.log(`  ${String(staleCount).padStart(6)}  refreshtokens (expired/revoked)`);
  }

  console.log(
    `\n${apply ? "Deleted" : "Would delete"} ${total} documents across ${doomed.length} hospitals.`,
  );

  if (apply) {
    console.log("\nRemaining:");
    for (const name of ["hospitals", "users", "patients", "auditlogs"]) {
      console.log(`  ${String(await db.collection(name).countDocuments()).padStart(6)}  ${name}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Cleanup failed:", error);
  process.exitCode = 1;
});
