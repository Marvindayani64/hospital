/**
 * Appointment time handling.
 *
 * Times are stored as a calendar date (`YYYY-MM-DD`) plus minutes-from-midnight
 * integers, both interpreted as the hospital's LOCAL WALL-CLOCK time.
 *
 * Storing an absolute UTC instant would be wrong here: a clinic that books
 * "09:00 Tuesday" means nine in the morning at that clinic, and it must keep
 * meaning that across daylight-saving transitions. Keeping the wall-clock value
 * also makes overlap detection exact integer arithmetic, with no timezone maths
 * anywhere in the booking path.
 *
 * LIMITATION: comparisons between hospitals in different timezones, and
 * reminder scheduling, need a `timezone` field on Hospital. That lands with
 * notifications in Phase 8; nothing in Phase 4 requires it.
 */

/** `YYYY-MM-DD`. */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `HH:mm`, 24-hour. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];

  // Round-trip through Date to reject 2025-02-30 and similar.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** "09:30" -> 570. Returns null when the input is not a valid time. */
export function timeToMinutes(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 570 -> "09:30". */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * Day of week for a `YYYY-MM-DD` string: 0 = Sunday … 6 = Saturday.
 * Computed in UTC so the server's own timezone cannot shift the result.
 */
export function dayOfWeek(dateString: string): number {
  const [year, month, day] = dateString.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * Half-open interval overlap: [aStart, aEnd) vs [bStart, bEnd).
 *
 * Half-open is what makes back-to-back bookings legal — an appointment ending
 * at 10:00 does not collide with one starting at 10:00.
 */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Today in the server's local calendar, as `YYYY-MM-DD`. */
export function todayDateString(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
