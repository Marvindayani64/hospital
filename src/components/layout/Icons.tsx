import type { NavIcon } from "@/components/layout/nav-config";

const PATHS: Record<NavIcon, string> = {
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z",
  patients:
    "M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 8v6M22 11h-6",
  appointments:
    "M7 3v3M17 3v3M3.5 9.5h17M5 6h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 21H5a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 5 6Z",
  doctors:
    "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1",
  departments:
    "M4 21V7l8-4 8 4v14M9 21v-6h6v6M4 21h16",
  treatments:
    "M12 6v12M6 12h12M6.5 3.5h11A2 2 0 0 1 19.5 5.5v13a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z",
  forms:
    "M8 3.5h8M6 6.5h12a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V8A1.5 1.5 0 0 1 6 6.5ZM8 11h8M8 15h5",
  visits:
    "M9 12h6M12 9v6M4.5 5.5h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z",
  billing:
    "M6 3.5h12a1 1 0 0 1 1 1v16l-3-2-2 2-2-2-2 2-3-2v-14a1 1 0 0 1 1-1ZM9 8h6M9 12h6",
  // Bar chart.
  reports: "M4 20h16M7 20v-6M12 20V7M17 20v-9",
  users:
    "M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M8.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM17 4a3.5 3.5 0 0 1 0 6.8M22 20v-1.5a4 4 0 0 0-3-3.8",
  roles:
    "M12 3 4 6.5v5c0 4.5 3.3 8.3 8 9.5 4.7-1.2 8-5 8-9.5v-5L12 3ZM9.5 12l1.8 1.8L15 10",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 0 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 0 1 0-4 1.7 1.7 0 0 0 1.4-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 0 1 4 0 1.7 1.7 0 0 0 2.9 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  hospitals:
    "M3 21h18M5 21V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v16M12 7v6M9 10h6M9 17h6",
};

export function NavIconGlyph({
  name,
  className,
}: {
  name: NavIcon;
  className?: string;
}) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d={PATHS[name]}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The medical cross mark.
 *
 * The tile takes `currentColor` and the cross is drawn in `crossColor`, so the
 * two are always set as a pair. Previously the cross was hard-coded to white,
 * which made it vanish on the gold sign-in panel where the tile is also white —
 * leaving a blank rounded square.
 */
export function BrandMark({
  className,
  crossColor = "white",
}: {
  className?: string;
  /** Any CSS colour. Pair it with the tile colour set via `className`. */
  crossColor?: string;
}) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path
        d="M16 8.5v15M8.5 16h15"
        stroke={crossColor}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
