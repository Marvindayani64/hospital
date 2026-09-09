# Working rules for this repo

Prefer the smallest check that actually proves the change. Re-running everything
"to be safe" is slow and proves nothing extra.

## Verification

Run the **one suite that covers what you touched**, not all eight:

| Suite | Covers |
|---|---|
| `verify:auth` | login, tokens, refresh, CSRF, password change |
| `verify:tenancy` | users, roles, permissions, cross-tenant isolation |
| `verify:catalog` | departments, treatments, pricing, currency |
| `verify:clinical` | patients, doctors, appointments |
| `verify:forms` | form builder, responses, versioning |
| `verify:visits` | visits, consultations |
| `verify:billing` | invoices, payments |
| `verify:admin` | dashboard, settings, audit log, reports |

Run **all eight only** before declaring a phase complete, or after changing
something shared: `middleware.ts`, `lib/auth/*`, `lib/tenant/scope.ts`,
`lib/rbac/*`, `models/*`, `utils/money.ts`.

For a UI-only change (copy, colours, layout), a `curl` of the page is enough —
the suites do not test markup, so running them proves nothing.

**The suites need a production server.** The dev server compiles routes on
demand and evicts them; the suites exhaust it and routes start returning 404,
which looks like a broken app but is not:

```
npm run build && npm run start   # then run the suites
```

Dev-mode 404s and crashed suites are almost always this — check before
investigating the app.

## Typecheck and lint

Once, after a coherent set of edits — not after each file. `npx tsc --noEmit`
and `npx eslint .` together, and only re-run what failed.

## The dev server

- **One at a time.** If startup says `Port 3000 is in use ... using 3001`, an
  old server is still running. Two servers sharing `.next` corrupts the client
  bundle, which presents as hydration failing (dead buttons, no redirects).
- **Never `npm run build` while `npm run dev` is running** — they share `.next`
  and the mix breaks both.
- **Do not restart for source edits.** Fast Refresh handles `.tsx`/`.ts` under
  `src/`. Restart only for `next.config.ts`, `middleware.ts`, or `.env*`.
- When it does need a reset: stop every node process for this repo, delete
  `.next`, then start **one** server.
- After changing an index definition in `models/*`, run `npm run sync-indexes`.
  Mongoose will not alter an existing index by itself.

## Tools

Use `Read`, `Grep` and `Glob` rather than `cat`, `grep` and `find` via the
shell. Batch independent commands into one call instead of several round trips.

Do not re-read a file straight after writing it — the write already succeeded.

## Things worth knowing before changing them

- **Money is integer minor units.** `19.99` is stored as `1999`. Never store a
  float. `utils/money.ts` has the conversions.
- **`sanitizeFilter` is on globally.** Any deliberate query operator must be
  wrapped: `mongoose.trusted({ $gt: ... })`. Forgetting it raises a CastError,
  not a silent bug.
- **Client components must not import from `@/models/*`** — that pulls Mongoose
  into the browser bundle. Shared enums live in `lib/domain/enums.ts`.
- **`hospitalId` always comes from the auth context**, never from a request
  body or query string.
- Deleting is guarded throughout (a role in use, a treatment on an invoice, a
  patient with history). Add the guard when you add a reference.

## Reporting

Say what was verified and how. If something was not checked, say so rather than
implying it passed.
