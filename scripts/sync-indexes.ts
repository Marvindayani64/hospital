/**
 * Synchronises MongoDB indexes with the current Mongoose schemas.
 *
 *   npm run sync-indexes
 *
 * Mongoose's `autoIndex` creates missing indexes, but it will NOT modify or
 * drop one that already exists with different options — it silently leaves the
 * old definition in place, or errors on conflict. `syncIndexes()` drops indexes
 * that are no longer declared and builds the current ones.
 *
 * Run this after changing any index definition. It is safe to run repeatedly.
 *
 * CAUTION: index builds lock collections briefly. On a large production
 * database, build indexes in the background out of hours instead.
 */
import { config } from "dotenv";
import mongoose from "mongoose";

config({ path: ".env.local" });
config({ path: ".env" });

async function main(): Promise<void> {
  const { connectToDatabase } = await import("../src/lib/db/connect");

  // connectToDatabase() imports the model barrel, so every model is registered
  // by the time this returns.
  await connectToDatabase();
  console.log(`Connected to ${mongoose.connection.db?.databaseName}\n`);

  /**
   * Derived from Mongoose's registry rather than a hand-written list, so a
   * model added in a later phase is covered automatically — a hardcoded list
   * silently skips new models, which is exactly the kind of drift this script
   * exists to prevent.
   */
  const modelNames = Object.keys(mongoose.models).sort();

  for (const name of modelNames) {
    const model = mongoose.models[name];

    if (!model) {
      console.log(`  ${name}: not registered, skipped`);
      continue;
    }

    try {
      // Returns the names of any indexes it dropped.
      const dropped = await model.syncIndexes();
      const current = await model.collection.indexes();
      console.log(
        `  ${name}: ${current.length} indexes` +
          (dropped.length > 0 ? ` (dropped ${dropped.join(", ")})` : ""),
      );
    } catch (error) {
      console.error(
        `  ${name}: FAILED — ${error instanceof Error ? error.message : error}`,
      );
      process.exitCode = 1;
    }
  }

  console.log("\nIndex synchronisation complete.");
}

main()
  .catch((error: unknown) => {
    console.error(
      "\nsync-indexes failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
