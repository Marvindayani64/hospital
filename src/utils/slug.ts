// Combining diacritical marks, U+0300 - U+036F. Built from a string literal so
// the source file stays pure ASCII and survives any encoding change.
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Produces a slug not already taken, appending -2, -3, ... as needed.
 *
 * Takes a predicate rather than a Mongoose model so it stays decoupled from
 * any particular collection and is trivial to test.
 *
 * This is advisory only: the unique index on Hospital.slug is what actually
 * guarantees uniqueness under concurrent creates, and the caller surfaces a
 * duplicate-key error as a conflict.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base) || "hospital";

  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  // Fall back to a random discriminator rather than looping forever.
  const salt = Math.random().toString(36).slice(2, 8);
  return `${root}-${salt}`;
}
