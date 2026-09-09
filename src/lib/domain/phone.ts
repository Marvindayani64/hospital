/**
 * Indian phone numbers.
 *
 * The rule is fixed to India rather than derived per tenant: `Hospital.country`
 * is free text with no dialling information behind it, so there is nothing
 * reliable to read. Keeping it in ONE module means making it per-tenant later
 * is a change here plus a lookup, not a hunt through schemas and forms.
 *
 * This module has NO imports. The patient form validates against the same Zod
 * schema the API parses, so these helpers run in the browser as well as on the
 * server.
 */

/** Separators people actually type between digits. */
const SEPARATORS = /[\s\-().]/g;

/**
 * An optional country or trunk prefix, then the 10-digit subscriber number.
 * Indian mobile numbers begin with 6, 7, 8 or 9.
 *
 * The alternation is ordered longest-first so `0091…` is not consumed as a
 * lone trunk `0`. A bare 10-digit number that happens to start "91" still
 * matches: the prefix branch leaves too few digits behind, and the pattern
 * backtracks to treating the whole thing as the subscriber number.
 */
const INDIAN_MOBILE = /^(?:\+91|0091|91|0)?([6-9]\d{9})$/;

export const INDIA_PHONE_PLACEHOLDER = "+91 98765 43210";

export const INDIA_PHONE_MESSAGE =
  "Enter a valid Indian mobile number, e.g. +91 98765 43210.";

/**
 * The 10 national digits, or `null` when the value is not a valid Indian
 * mobile number. Accepts `+91`, `0091`, `91` and a leading `0`, with or without
 * spaces, hyphens, dots or brackets.
 */
export function indianMobileDigits(value: string): string | null {
  const match = INDIAN_MOBILE.exec(value.replace(SEPARATORS, ""));
  return match?.[1] ?? null;
}

export function isIndianMobile(value: string): boolean {
  return indianMobileDigits(value) !== null;
}

/**
 * `9876543210` -> `+91 98765 43210`.
 *
 * Returns the input untouched when it is not a valid Indian mobile number, so
 * it is safe to call on anything — including values stored before this rule
 * existed.
 */
export function formatIndianMobile(value: string): string {
  const digits = indianMobileDigits(value);
  if (!digits) return value;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}
