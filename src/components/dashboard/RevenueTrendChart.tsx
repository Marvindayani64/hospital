"use client";

import { useState } from "react";
import { formatMoney } from "@/utils/money";

export type RevenuePoint = {
  month: string;
  label: string;
  amountMinor: number;
  amountFormatted: string;
};

/**
 * Twelve months of collected revenue.
 *
 * Drawn as raw SVG rather than a charting library: the whole shape is a path
 * and a fill, and pulling in a dependency for that would cost more bundle than
 * the page it decorates. The viewBox is a flat 0–100 grid stretched to the
 * container (`preserveAspectRatio="none"`), so a point's x position is exactly
 * its percentage across — which is what lets the HTML labels and the hover
 * marker line up with the path without measuring anything.
 *
 * Nothing renders inside the SVG that would be distorted by that stretch:
 * strokes use `vector-effect`, and every label and dot is HTML on top.
 */
export function RevenueTrendChart({
  points,
  currency,
}: {
  points: RevenuePoint[];
  currency: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <p className="px-5 py-10 text-center text-sm text-ink-500">
        Not enough history to draw a trend yet.
      </p>
    );
  }

  const max = Math.max(...points.map((point) => point.amountMinor), 1);

  /**
   * Each month owns an equal column and its point sits at the column's centre,
   * so the plotted point, its hover target and its axis label are all at the
   * same percentage — no measuring, and nothing drifts as the card resizes.
   */
  const step = 100 / points.length;

  const coordinates = points.map((point, index) => ({
    x: (index + 0.5) * step,
    // SVG y grows downward, so a larger amount must sit closer to zero. The
    // top 6% is left clear so the peak never touches the card border.
    y: 100 - (point.amountMinor / max) * 94,
  }));

  const first = coordinates[0]!;
  const last = coordinates[coordinates.length - 1]!;

  // Held level across the outer half-columns so the fill still reaches both
  // edges of the card rather than floating inside it.
  const line = [
    `M0 ${first.y}`,
    ...coordinates.map((point) => `L${point.x} ${point.y}`),
    `L100 ${last.y}`,
  ].join(" ");

  const area = `${line} L100 100 L0 100 Z`;

  const activePoint = active === null ? null : points[active];
  const activeCoordinate = active === null ? null : coordinates[active];

  return (
    <div className="px-5 pb-4 pt-2">
      <div className="flex gap-3">
        {/* Value axis. Four labels is enough to read the scale. */}
        <div className="flex w-16 shrink-0 flex-col justify-between py-0.5 text-right text-[11px] tabular-nums text-ink-400">
          {[1, 0.66, 0.33, 0].map((fraction) => (
            <span key={fraction}>
              {formatMoney(Math.round(max * fraction), currency)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Gridlines sit behind the plot and stay crisp at any width. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            {[0, 1, 2, 3].map((index) => (
              <span key={index} className="block h-px w-full bg-ink-100" />
            ))}
          </div>

          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="relative block h-52 w-full"
            role="img"
            aria-label={`Revenue collected over the last ${points.length} months`}
          >
            <defs>
              <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-gold-400)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--color-gold-400)" stopOpacity="0" />
              </linearGradient>
            </defs>

            <path d={area} fill="url(#revenue-fill)" />
            <path
              d={line}
              fill="none"
              stroke="var(--color-gold-500)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {activeCoordinate ? (
              <line
                x1={activeCoordinate.x}
                y1="0"
                x2={activeCoordinate.x}
                y2="100"
                stroke="var(--color-gold-300)"
                strokeWidth="1"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>

          {/* Hover targets: one full-height column per month. */}
          <div className="absolute inset-0 flex">
            {points.map((point, index) => (
              <button
                key={point.month}
                type="button"
                aria-label={`${point.label}: ${point.amountFormatted}`}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onBlur={() => setActive(null)}
                className="h-full flex-1 cursor-default"
              />
            ))}
          </div>

          {activeCoordinate ? (
            <span
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-gold-500 shadow"
              style={{
                left: `${activeCoordinate.x}%`,
                top: `${activeCoordinate.y}%`,
              }}
            />
          ) : null}

          {activePoint && activeCoordinate ? (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-ink-200 bg-white px-3 py-2 shadow-lg"
              style={{
                left: `${Math.min(88, Math.max(12, activeCoordinate.x))}%`,
                top: `${Math.max(14, activeCoordinate.y - 6)}%`,
              }}
            >
              <p className="text-[11px] font-medium text-ink-500">
                {activePoint.label} {activePoint.month.slice(0, 4)}
              </p>
              <p className="text-sm font-semibold tabular-nums text-ink-900">
                {activePoint.amountFormatted}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Month axis, aligned to the plot area by the same left offset. */}
      <div className="mt-2 flex pl-19">
        {points.map((point, index) => (
          <span
            key={point.month}
            className={
              index === active
                ? "flex-1 text-center text-[11px] font-semibold text-ink-700"
                : "flex-1 text-center text-[11px] text-ink-400"
            }
          >
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
}
