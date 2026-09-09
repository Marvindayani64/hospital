import { BrandMark } from "@/components/layout/Icons";

/**
 * Split layout for the unauthenticated screens: a gold brand panel on the left
 * (hidden on small screens) and the form on the right.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="relative hidden w-1/2 flex-col justify-between bg-gradient-to-br from-gold-600 via-gold-500 to-gold-700 p-10 text-white lg:flex xl:w-5/12">
        {/* White tile, gold cross — the mark reads clearly on the gold panel. */}
        <div className="flex items-center gap-2.5">
          <BrandMark className="text-white" crossColor="#c9a227" />
          <span className="text-lg font-semibold tracking-tight">
            Hospital CRM
          </span>
        </div>

        {/*
          Written for the people who actually sign in here — receptionists,
          nurses, doctors and hospital administrators — not for someone
          evaluating the platform. The previous copy described the multi-tenant
          architecture, which is invisible to a hospital's own staff.
        */}
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">
            Everything your hospital runs on, in one place.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/85">
            Patients, appointments, consultations and billing — organised so
            your team spends less time on admin and more time on care.
          </p>
        </div>

        <p className="text-xs text-white/70">
          Your patients&apos; records stay private to your hospital.
        </p>
      </aside>

      <main className="flex w-full items-center justify-center bg-white px-5 py-10 lg:w-1/2 xl:w-7/12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
