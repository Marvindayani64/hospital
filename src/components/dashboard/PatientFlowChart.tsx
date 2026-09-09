"use client";

import { useState } from "react";

export type FlowPoint = {
  date: string;
  label: string;
  appointments: number;
  visits: number;
};

/**
 * Seven days of booked appointments against consultations actually recorded.
 *
 * The gap between the two bars is the point of the chart: appointments that
 * never became a visit are patients who did not turn up, or consultations the
 * doctor has not written up yet.
 *
 * Plain elements rather than SVG — bars are rectangles, and percentage heights
 * stay crisp at any width without a viewBox to reason about.
 */
export function PatientFlowChart({
  points,
  showAppointments,
  showVisits,
}: {
  points: FlowPoint[];
  showAppointments: boolean;
  showVisits: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(
    1,
    ...points.map((point) =>
      Math.max(
        showAppointments ? point.appointments : 0,
        showVisits ? point.visits : 0,
      ),
    ),
  );

  return (
    <div className="px-5 pb-4 pt-2">
      <div className="flex items-center gap-4 pb-3 text-xs text-ink-500">
        {showAppointments ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-gold-400" />
            Appointments
          </span>
        ) : null}
        {showVisits ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-ink-300" />
            Visits recorded
          </span>
        ) : null}
      </div>

      <div className="relative flex h-48 items-end gap-1.5">
        {points.map((point, index) => {
          const isActive = index === active;

          return (
            <div
              key={point.date}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              className="relative flex h-full flex-1 flex-col justify-end"
            >
              {isActive ? (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-max -translate-x-1/2 rounded-lg border border-ink-200 bg-white px-3 py-2 shadow-lg">
                  <p className="text-[11px] font-medium text-ink-500">
                    {point.date}
                  </p>
                  {showAppointments ? (
                    <p className="text-xs tabular-nums text-ink-900">
                      {point.appointments} appointment
                      {point.appointments === 1 ? "" : "s"}
                    </p>
                  ) : null}
                  {showVisits ? (
                    <p className="text-xs tabular-nums text-ink-900">
                      {point.visits} visit{point.visits === 1 ? "" : "s"}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex h-full items-end justify-center gap-1">
                {showAppointments ? (
                  <Bar
                    value={point.appointments}
                    max={max}
                    className={isActive ? "bg-gold-500" : "bg-gold-400"}
                  />
                ) : null}
                {showVisits ? (
                  <Bar
                    value={point.visits}
                    max={max}
                    className={isActive ? "bg-ink-400" : "bg-ink-300"}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-1.5">
        {points.map((point, index) => (
          <span
            key={point.date}
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

function Bar({
  value,
  max,
  className,
}: {
  value: number;
  max: number;
  className: string;
}) {
  return (
    <span
      className={`w-3 rounded-t-sm transition-colors ${className}`}
      // A zero stays visible as a 2px stub, so an empty day reads as "none"
      // rather than as a missing bar.
      style={{ height: value === 0 ? "2px" : `${(value / max) * 100}%` }}
    />
  );
}
