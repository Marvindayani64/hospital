"use client";

import { useSearchParams } from "next/navigation";

/**
 * The `search` term a page was linked with, for seeding a manager's search box.
 *
 * This is what makes the header omnibox land somewhere useful: selecting a
 * doctor navigates to `/doctors?search=Dr%20Rao`, and the list arrives already
 * filtered instead of dumping the caller on page one of everything.
 *
 * Read through `useSearchParams` rather than `window.location` so the server
 * and the client render the same markup — a value that only exists in the
 * browser would break hydration.
 */
export function useInitialSearch(): string {
  return useSearchParams().get("search") ?? "";
}
