"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Route-level error boundary. Next.js passes a redacted error in production,
 * so nothing sensitive is rendered; the digest is shown so a report can be
 * matched to a server log entry.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-5">
      <div className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 8v5M12 16.5h.01M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className="text-lg font-semibold text-ink-900">
          Something went wrong
        </h1>
        <p className="mt-1.5 text-sm text-ink-500">
          The page could not be loaded. Try again, or sign in once more if the
          problem continues.
        </p>

        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-ink-400">
            Reference: {error.digest}
          </p>
        ) : null}

        <div className="mt-6 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => reset()}>
            Try again
          </Button>
          <Button onClick={() => (window.location.href = "/login")}>
            Go to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
