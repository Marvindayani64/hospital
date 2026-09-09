/**
 * Money handling.
 *
 * Prices are stored as INTEGER MINOR UNITS (cents, kobo, paise…), never as
 * floating-point major units. `19.99` is not exactly representable in binary
 * floating point, so summing invoice lines in Phase 7 would accumulate visible
 * rounding errors — the classic `0.1 + 0.2 !== 0.3` problem applied to money a
 * hospital actually bills.
 *
 * The API surface still speaks in major units (`price: 19.99`); conversion
 * happens once on the way in and once on the way out, inside the service layer.
 */

export type Currency = {
  code: string;
  name: string;
  symbol: string;
  /** Number of decimal places — ISO 4217 "minor unit" exponent. */
  decimals: number;
};

/**
 * A deliberately small set. Currency is hospital configuration, so adding one
 * is a data change here rather than anything structural.
 */
export const CURRENCIES: readonly Currency[] = [
  { code: "USD", name: "US Dollar", symbol: "$", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", decimals: 2 },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", decimals: 2 },
  { code: "INR", name: "Indian Rupee", symbol: "₹", decimals: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "AED ", decimals: 2 },
  { code: "ZAR", name: "South African Rand", symbol: "R", decimals: 2 },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh ", decimals: 2 },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", decimals: 2 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", decimals: 2 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", decimals: 0 },
  { code: "KRW", name: "South Korean Won", symbol: "₩", decimals: 0 },
] as const;

export const CURRENCY_CODES: readonly string[] = CURRENCIES.map((c) => c.code);

/**
 * Applied to every new hospital. Currency is fixed at onboarding and not
 * editable afterwards — treatment prices and invoice totals are stored as minor
 * units of it, so changing it later would silently reinterpret every amount.
 */
export const DEFAULT_CURRENCY = "INR";

const BY_CODE = new Map(CURRENCIES.map((currency) => [currency.code, currency]));

export function getCurrency(code: string): Currency {
  return BY_CODE.get(code) ?? BY_CODE.get(DEFAULT_CURRENCY)!;
}

/**
 * Major units -> minor units.
 *
 * Rounds to the currency's precision. `Math.round` on the scaled value is
 * enough here because the input has already been validated to at most that many
 * decimal places, so the value is never ambiguously between two minor units.
 */
export function toMinorUnits(major: number, currencyCode: string): number {
  const { decimals } = getCurrency(currencyCode);
  return Math.round(major * 10 ** decimals);
}

/** Minor units -> major units, for display and API responses. */
export function toMajorUnits(minor: number, currencyCode: string): number {
  const { decimals } = getCurrency(currencyCode);
  return minor / 10 ** decimals;
}

/** Formats minor units for display, e.g. 1999 + "USD" -> "$19.99". */
export function formatMoney(minor: number, currencyCode: string): string {
  const currency = getCurrency(currencyCode);
  const major = toMajorUnits(minor, currencyCode);

  return `${currency.symbol}${major.toLocaleString(undefined, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  })}`;
}

/**
 * Applies a percentage to an amount in minor units, rounding to the nearest
 * whole minor unit.
 *
 * Kept as a single helper so discount and tax round identically — two call
 * sites rounding differently is how invoice totals end up a cent adrift from
 * the sum of their own lines.
 */
export function percentOfMinor(minor: number, percent: number): number {
  return Math.round((minor * percent) / 100);
}

/**
 * True when a major-unit amount has no more precision than the currency allows
 * — e.g. 19.999 is rejected for USD, and 100.5 is rejected for JPY.
 */
export function hasValidPrecision(
  major: number,
  currencyCode: string,
): boolean {
  const { decimals } = getCurrency(currencyCode);
  const scaled = major * 10 ** decimals;
  // Tolerance absorbs the representation error in the input itself.
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}
