/**
 * Minimal class-name joiner. Deliberately not `clsx` + `tailwind-merge`: the
 * component set here does not override utilities across boundaries, so the
 * extra dependencies would not earn their place.
 */
export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}
