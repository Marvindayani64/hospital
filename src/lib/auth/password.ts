import bcrypt from "bcryptjs";
import { randomInt } from "crypto";

/**
 * bcryptjs is used rather than the native `bcrypt` binding: it needs no
 * node-gyp toolchain, which keeps `npm install` working on Windows and in slim
 * containers. Swap in argon2 later by replacing only this module.
 */
const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Burns roughly the same CPU as a real comparison. Called on the login path
 * when no user matched, so response timing does not reveal whether an email is
 * registered on the platform.
 */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO1qJ7pQXKvJqLZ4mZzUeYqOe0fS9dGDa";

export async function fakePasswordCheck(): Promise<void> {
  await bcrypt.compare("timing-equalisation-placeholder", DUMMY_HASH);
}

// --------------------------------------------------------------------------
// Password policy (Section 7)
// --------------------------------------------------------------------------

export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
  description:
    "At least 8 characters, including an uppercase letter, a lowercase letter, a number and a special character.",
} as const;

export type PasswordPolicyIssue = string;

export function checkPasswordPolicy(password: string): PasswordPolicyIssue[] {
  const issues: PasswordPolicyIssue[] = [];

  if (password.length < PASSWORD_POLICY.minLength) {
    issues.push(`Must be at least ${PASSWORD_POLICY.minLength} characters.`);
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    issues.push(`Must be at most ${PASSWORD_POLICY.maxLength} characters.`);
  }
  if (!/[A-Z]/.test(password)) issues.push("Must contain an uppercase letter.");
  if (!/[a-z]/.test(password)) issues.push("Must contain a lowercase letter.");
  if (!/[0-9]/.test(password)) issues.push("Must contain a number.");
  if (!/[^A-Za-z0-9]/.test(password)) {
    issues.push("Must contain a special character.");
  }

  return issues;
}

// --------------------------------------------------------------------------
// Temporary password generation (Sections 4 & 5)
// --------------------------------------------------------------------------

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O — ambiguous when read aloud
const LOWER = "abcdefghijkmnopqrstuvwxyz"; // no l
const DIGITS = "23456789"; // no 0, 1
const SPECIAL = "!@#$%^&*-_=+?";

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)]!;
}

/**
 * Cryptographically random temporary password that satisfies the policy by
 * construction. Generated server-side, shown to the Super Admin exactly once,
 * and never persisted in plain text.
 */
export function generateTemporaryPassword(length = 14): string {
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
  const all = UPPER + LOWER + DIGITS + SPECIAL;

  const rest = Array.from({ length: Math.max(length, 8) - required.length }, () =>
    pick(all),
  );

  const chars = [...required, ...rest];

  // Fisher-Yates with a CSPRNG so the required characters are not always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join("");
}
