import { connectToDatabase } from "@/lib/db/connect";
import { Counter } from "@/models";

/**
 * Returns the next value in a per-tenant sequence.
 *
 * The `$inc` + `upsert` combination is atomic at the document level, so
 * concurrent callers are handed distinct values without a transaction. This is
 * the fix for the `count() + 1` race described in Section 19.
 */
export async function nextSequence(
  hospitalId: string,
  key: string,
): Promise<number> {
  await connectToDatabase();

  const counter = await Counter.findOneAndUpdate(
    { hospitalId, key },
    { $inc: { seq: 1 } },
    {
      new: true,
      upsert: true,
      // Ensures the document is returned even on the very first insert.
      setDefaultsOnInsert: true,
    },
  ).lean();

  return counter?.seq ?? 1;
}

/**
 * Formats a sequence value as a human-readable reference, e.g. `PAT-000001`.
 * Numbers beyond the padding width simply grow — they are never truncated.
 */
export function formatReference(prefix: string, seq: number, width = 6): string {
  return `${prefix}-${String(seq).padStart(width, "0")}`;
}
