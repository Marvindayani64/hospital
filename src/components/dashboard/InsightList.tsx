import Link from "next/link";
import type { InsightItem } from "@/services/report.service";
import { cn } from "@/utils/cn";

const SEVERITY_STYLES: Record<InsightItem["severity"], string> = {
  critical: "bg-red-50 text-red-700 ring-red-100",
  warning: "bg-amber-50 text-amber-700 ring-amber-100",
  info: "bg-ink-100 text-ink-700 ring-ink-200",
};

/**
 * Alerts and approvals.
 *
 * Every row is a real, actionable count derived from this hospital's own data,
 * and links to the screen where it can be cleared. An item with a count of zero
 * is never produced — an empty list is the good outcome, not a missing figure.
 */
export function InsightList({
  items,
  emptyTitle,
  emptyDescription,
}: {
  items: InsightItem[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (items.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm font-medium text-ink-700">{emptyTitle}</p>
        <p className="mt-1 text-sm text-ink-500">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-ink-100">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={item.href}
            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-ink-50"
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums ring-1",
                SEVERITY_STYLES[item.severity],
              )}
            >
              {item.count}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink-900">
                {item.title}
              </span>
              <span className="block truncate text-xs text-ink-500">
                {item.detail}
              </span>
            </span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="shrink-0 text-ink-300"
            >
              <path
                d="m9 6 6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </li>
      ))}
    </ul>
  );
}
