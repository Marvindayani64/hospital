/**
 * One-off migration: back-fills the prescription permissions onto the system
 * roles of hospitals that already existed when the module landed.
 *
 *   npx tsx scripts/migrate-prescription-roles.ts
 *
 * Roles are seeded once, at hospital creation, and their permission arrays are
 * then owned by the tenant. So adding entries to DEFAULT_ROLE_TEMPLATES only
 * reaches NEW hospitals — without this, an existing hospital's doctors cannot
 * prescribe and nobody can dispense until an admin edits the roles by hand.
 *
 * What it does, per hospital:
 *   - hospital_admin  += every prescription permission
 *   - doctor          += prescription.create, prescription.view
 *   - nurse           += prescription.view
 *   - pharmacist       — created if absent (the role is new)
 *
 * Only ever ADDS. A hospital that has deliberately removed a permission from a
 * role gets it back, which is the lesser of the two evils against a role that
 * silently cannot do its job; nothing else about the role is touched.
 *
 * Safe to run repeatedly.
 */
import { config } from "dotenv";
import mongoose from "mongoose";
import { DEFAULT_ROLE_TEMPLATES } from "../src/lib/rbac/default-roles";

config({ path: ".env.local" });
config({ path: ".env" });

const ADDITIONS: Record<string, string[]> = {
  hospital_admin: [
    "prescription.create",
    "prescription.view",
    "prescription.dispense",
  ],
  doctor: ["prescription.create", "prescription.view"],
  nurse: ["prescription.view"],
};

async function main(): Promise<void> {
  const { connectToDatabase } = await import("../src/lib/db/connect");
  const { Role } = await import("../src/models");

  await connectToDatabase();
  console.log(`Connected to ${mongoose.connection.db?.databaseName}\n`);

  const hospitalIds = await Role.distinct("hospitalId");
  console.log(`${hospitalIds.length} hospital(s) with roles\n`);

  const pharmacistTemplate = DEFAULT_ROLE_TEMPLATES.find(
    (template) => template.key === "pharmacist",
  );
  if (!pharmacistTemplate) throw new Error("No pharmacist role template found.");

  let granted = 0;
  let created = 0;

  for (const hospitalId of hospitalIds) {
    for (const [key, permissions] of Object.entries(ADDITIONS)) {
      const result = await Role.updateOne(
        { hospitalId, key },
        // $addToSet with $each is idempotent: already-present entries are
        // skipped rather than duplicated.
        {
          $addToSet: {
            permissions: mongoose.trusted({ $each: permissions }),
          },
        },
      );
      if (result.modifiedCount > 0) granted += 1;
    }

    const existing = await Role.findOne({ hospitalId, key: "pharmacist" });
    if (!existing) {
      await Role.create({
        hospitalId,
        key: pharmacistTemplate.key,
        name: pharmacistTemplate.name,
        description: pharmacistTemplate.description,
        permissions: [...pharmacistTemplate.permissions],
        isSystem: true,
      });
      created += 1;
    }
  }

  console.log(`Roles updated with new permissions: ${granted}`);
  console.log(`Pharmacist roles created: ${created}`);
}

main()
  .catch((error: unknown) => {
    console.error(
      "\nmigrate-prescription-roles failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
