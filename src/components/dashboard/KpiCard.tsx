import Link from "next/link";
import { NavIconGlyph } from "@/components/layout/Icons";
import type { NavIcon } from "@/components/layout/nav-config";
import type { Trend } from "@/services/report.service";
import { cn } from "@/utils/cn";

/**
 * An executive metric tile.
 *
 * The delta is rendered from a real week-on-week comparison. When the previous
 * week held nothing there is no honest percentage to show, so the tile says so
 * rather than inventing "+100%".
 */
export function KpiCard({
  label,
  value,
  icon,
  hint,
  trend,
  href,
}: {
  label: string;
  value: string | number;
  icon: NavIcon;
  hint?: string;
  trend?: Trend | null;
  href?: string;
}) {
  const body = (
    <div className="h-full rounded-xl border border-ink-200 bg-white px-5 py-4 shadow-sm transition-colors hover:border-gold-300">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold-50 text-gold-600">
          <NavIconGlyph name={icon} />
        </span>
        <p className="truncate text-sm font-medium text-ink-600">{label}</p>
      </div>

      <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight text-ink-900">
        {value}
      </p>

      <div className="mt-1.5 min-h-5 text-xs">
        {trend ? <TrendLine trend={trend} /> : hint ? (
          <span className="text-ink-500">{hint}</span>
        ) : null}
      </div>

      {trend && hint ? (
        <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

function TrendLine({ trend }: { trend: Trend }) {
  if (trend.changePercent === null) {
    return (
      <span className="text-ink-400">
        {trend.current > 0 ? "First week with activity" : "No activity yet"}
      </span>
    );
  }

  const rising = trend.direction === "up";
  const flat = trend.direction === "flat";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        flat ? "text-ink-500" : rising ? "text-emerald-600" : "text-red-600",
      )}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d={
            flat
              ? "M4 12h16"
              : rising
                ? "M4 17 10 11l4 4 6-6M15 5h5v5"
                : "M4 7l6 6 4-4 6 6M15 19h5v-5"
          }
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {trend.changePercent > 0 ? "+" : ""}
      {trend.changePercent}%
      <span className="font-normal text-ink-500">vs last week</span>
    </span>
  );
}
