"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { cn } from "@/utils/cn";

type SearchHitType = "patient" | "doctor" | "invoice";

type SearchHit = {
  id: string;
  type: SearchHitType;
  title: string;
  subtitle: string;
  href: string;
};

type SearchResults = { query: string; hits: SearchHit[] };

const TYPE_LABELS: Record<SearchHitType, string> = {
  patient: "Patient",
  doctor: "Doctor",
  invoice: "Invoice",
};

const TYPE_STYLES: Record<SearchHitType, string> = {
  patient: "bg-gold-50 text-gold-700",
  doctor: "bg-sky-50 text-sky-700",
  invoice: "bg-emerald-50 text-emerald-700",
};

/**
 * The header omnibox.
 *
 * Results come from /api/search, which decides what may be searched from the
 * caller's permissions — this component never filters anything itself, so a
 * change to a role takes effect without touching the UI.
 */
export function GlobalSearch() {
  const router = useRouter();

  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = term.trim();

  useEffect(() => {
    if (query.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const timer = window.setTimeout(() => {
      api
        .get<SearchResults>(
          `/api/search?q=${encodeURIComponent(query)}`,
          controller.signal,
        )
        .then((results) => {
          setHits(results.hits);
          setHighlighted(results.hits.length > 0 ? 0 : -1);
        })
        .catch(() => {
          // An aborted request is the expected outcome of typing another key,
          // and must not blank the list the next response is about to fill.
          if (controller.signal.aborted) return;
          setHits([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  // Close when the click lands anywhere else on the page.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function choose(hit: SearchHit) {
    setOpen(false);
    setTerm("");
    setHits([]);
    router.push(hit.href);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (hits.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlighted((index) => (index + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlighted((index) => (index - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      const hit = hits[highlighted];
      if (hit) {
        event.preventDefault();
        choose(hit);
      }
    }
  }

  const showPanel = open && query.length >= 2;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <span
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"
        aria-hidden="true"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>

      <input
        ref={inputRef}
        type="search"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search patients, doctors, invoices…"
        aria-label="Search the workspace"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        role="combobox"
        aria-autocomplete="list"
        className="w-full rounded-full border border-ink-200 bg-ink-50 py-2 pl-10 pr-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-gold-400 focus:bg-white focus:outline-none"
      />

      {showPanel ? (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-xl border border-ink-200 bg-white py-1 shadow-lg"
        >
          {loading && hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-500">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-500">
              Nothing matches “{query}”.
            </p>
          ) : (
            hits.map((hit, index) => (
              <button
                key={`${hit.type}-${hit.id}`}
                type="button"
                role="option"
                aria-selected={index === highlighted}
                // onMouseDown, not onClick: the input's blur would otherwise
                // close the panel before the click could land.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(hit);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left",
                  index === highlighted ? "bg-ink-50" : "bg-white",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">
                    {hit.title}
                  </span>
                  <span className="block truncate text-xs text-ink-500">
                    {hit.subtitle}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    TYPE_STYLES[hit.type],
                  )}
                >
                  {TYPE_LABELS[hit.type]}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
