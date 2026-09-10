/**
 * One-off migration: strips the `form.*` permissions from every stored role.
 *
 *   npx tsx scripts/migrate-remove-form-permissions.ts
 *
 * The Forms module is gone, so `form.create`, `form.view`, `form.update`,
 * `form.delete` and `form.submit` are no longer in the permission catalogue.
 * Role documents still holding them are not merely untidy: `Role.permissions`
 * validates every entry against that catalogue on save, so the next edit of an
 * affected role would fail validation on values the admin never touched.
 *
 * Reads are unaffected either way — `sanitizePermissions` already drops
 * anything unknown — so this is about keeping roles editable.
 *
 * Safe to run repeatedly.
 */
import { config } from "dotenv";
import mongoose from "mongoose";

config({ path: ".env.local" });
config({ path: ".env" });

const REMOVED = [
  "form.create",
  "form.view",
  "form.update",
  "form.delete",
  "form.submit",
];

async function main(): Promise<void> {
  const { connectToDatabase } = await import("../src/lib/db/connect");
  await connectToDatabase();

  console.log(`Connected to ${mongoose.connection.db?.databaseName}\n`);

  // The raw collection, not the model: the model's enum no longer contains
  // these values, which is precisely what we are clearing out.
  const roles = mongoose.connection.db!.collection("roles");

  const before = await roles.countDocuments({ permissions: { $in: REMOVED } });
  console.log(`roles holding a form.* permission: ${before}`);

  if (before > 0) {
    const result = await roles.updateMany(
      { permissions: { $in: REMOVED } },
      // Cast: the driver's PullOperator types do not model `$in` inside `$pull`
      // against an untyped collection, though the server accepts it.
      { $pull: { permissions: { $in: REMOVED } } } as never,
    );
    console.log(`cleaned: ${result.modifiedCount}`);
  }

  const after = await roles.countDocuments({ permissions: { $in: REMOVED } });
  console.log(`remaining: ${after}`);
}

main()
  .catch((error: unknown) => {
    console.error(
      "\nmigrate-remove-form-permissions failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
