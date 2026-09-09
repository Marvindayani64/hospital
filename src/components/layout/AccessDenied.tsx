import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";

/**
 * Shown when an authenticated member reaches a page their role does not cover.
 * Names the missing permission so they can tell their administrator exactly
 * what to grant, rather than just reporting "it doesn't work".
 */
export function AccessDenied({
  permission,
  what,
}: {
  permission: string;
  what: string;
}) {
  return (
    <Card className="mx-auto max-w-lg">
      <CardBody className="flex flex-col items-center px-6 py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold-50 text-gold-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1 className="text-base font-semibold text-ink-900">
          You do not have access to {what}
        </h1>
        <p className="mt-1.5 max-w-sm text-sm text-ink-500">
          Your role does not include the{" "}
          <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-xs text-ink-700">
            {permission}
          </code>{" "}
          permission. Ask a hospital administrator if you need it.
        </p>

        <Link href="/dashboard" className="mt-6">
          <Button variant="secondary">Back to dashboard</Button>
        </Link>
      </CardBody>
    </Card>
  );
}
