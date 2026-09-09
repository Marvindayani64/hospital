/**
 * Creates the platform Super Admin.
 *
 *   npm run seed
 *
 * Idempotent: re-running reports the existing account rather than creating a
 * duplicate or resetting the password. Reads SUPER_ADMIN_* from .env.local.
 */
import { config } from "dotenv";
import mongoose from "mongoose";

config({ path: ".env.local" });
config({ path: ".env" });

async function main(): Promise<void> {
  const { connectToDatabase } = await import("../src/lib/db/connect");
  const { User } = await import("../src/models");
  const { hashPassword, checkPasswordPolicy } = await import(
    "../src/lib/auth/password"
  );

  const email = (process.env.SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD ?? "";
  const name = process.env.SUPER_ADMIN_NAME ?? "Platform Super Admin";

  if (!email || !password) {
    throw new Error(
      "SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set in .env.local",
    );
  }

  const policyIssues = checkPasswordPolicy(password);
  if (policyIssues.length > 0) {
    throw new Error(
      `SUPER_ADMIN_PASSWORD does not meet the password policy:\n` +
        policyIssues.map((issue) => `  - ${issue}`).join("\n"),
    );
  }

  await connectToDatabase();
  console.log("Connected to MongoDB.");

  // Super Admins are the `hospitalId: null` namespace of the compound
  // {hospitalId, email} unique index.
  const existing = await User.findOne({ email, hospitalId: null });

  if (existing) {
    console.log(`Super Admin already exists: ${email} (no changes made).`);
    return;
  }

  await User.create({
    hospitalId: null,
    name,
    email,
    passwordHash: await hashPassword(password),
    roleId: null,
    isSuperAdmin: true,
    status: "active",
    // The seed password comes from the operator's own environment file, so it
    // is not a temporary credential that must be rotated on first use.
    mustChangePassword: false,
    tokenVersion: 0,
  });

  console.log(`Super Admin created: ${email}`);
  console.log("Sign in at http://localhost:3000/login");
}

main()
  .catch((error: unknown) => {
    console.error(
      "\nSeed failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
