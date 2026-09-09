import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-5">
      <div className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-8 text-center shadow-sm">
        <p className="text-4xl font-semibold text-gold-500">404</p>
        <h1 className="mt-2 text-lg font-semibold text-ink-900">
          Page not found
        </h1>
        <p className="mt-1.5 text-sm text-ink-500">
          The page you are looking for does not exist, or you do not have access
          to it.
        </p>
        <div className="mt-6 flex justify-center">
          <Link href="/">
            <Button>Back to your dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
